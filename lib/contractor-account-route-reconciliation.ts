import { supabase } from '@/lib/backend';
import {
  normalizeContractorAccountApprovalConfig,
  type ContractorAccountApprovalConfig,
} from '@/lib/contractor-account-workflow';

type ApprovalRouteScope = 'project' | 'organization';

type SaveApprovalRouteInput = {
  scope: ApprovalRouteScope;
  targetId: string;
  nextConfig: ContractorAccountApprovalConfig;
  organizationName?: string;
};

type SaveApprovalRouteResult = {
  reassignedCount: number;
  concurrentChangeCount: number;
  reconciliationFailureCount: number;
  notificationFailureCount: number;
};

const RETRYABLE_STATUSES = new Set([409, 500, 502, 503, 504]);

const wait = (milliseconds: number) => new Promise((resolve) => {
  window.setTimeout(resolve, milliseconds);
});

/**
 * Persists an approval route and reconciles every account currently parked in
 * one of its stages. The server performs both writes in a single transaction;
 * this client only retries the same idempotent operation when transport or
 * concurrency failures occur.
 */
export const saveContractorAccountRouteAndReconcile = async ({
  scope,
  targetId,
  nextConfig,
  organizationName,
}: SaveApprovalRouteInput): Promise<SaveApprovalRouteResult> => {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) {
    throw new Error('Tu sesión venció antes de guardar la ruta de aprobación.');
  }

  const operationId = crypto.randomUUID();
  const body = JSON.stringify({
    scope,
    targetId,
    operationId,
    nextConfig: normalizeContractorAccountApprovalConfig(nextConfig),
    ...(scope === 'organization' ? { organizationName: String(organizationName || '').trim() } : {}),
  });

  let lastError = 'No fue posible guardar la ruta de aprobación.';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetch('/api/administration/contractor-accounts/approval-route', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body,
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
      if (attempt === 2) throw new Error(lastError);
      await wait(250 * (attempt + 1));
      continue;
    }

    const result = await response.json().catch(() => null) as (SaveApprovalRouteResult & {
      error?: string;
      retryable?: boolean;
    }) | null;

    if (response.ok) {
      const normalizedResult = {
        reassignedCount: Number(result?.reassignedCount || 0),
        concurrentChangeCount: Number(result?.concurrentChangeCount || 0),
        reconciliationFailureCount: Number(result?.reconciliationFailureCount || 0),
        notificationFailureCount: Number(result?.notificationFailureCount || 0),
      };
      if (normalizedResult.notificationFailureCount > 0 && attempt < 2) {
        await wait(250 * (attempt + 1));
        continue;
      }
      return normalizedResult;
    }

    lastError = result?.error || `No fue posible guardar la ruta (error ${response.status}).`;
    const shouldRetry = result?.retryable === true || RETRYABLE_STATUSES.has(response.status);
    if (!shouldRetry || attempt === 2) throw new Error(lastError);
    await wait(250 * (attempt + 1));
  }

  throw new Error(lastError);
};
