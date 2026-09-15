import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { POST as dispatchAdvanceRequestNotification } from '@/app/api/notifications/advance-requested/route';
import { getServerSupabase, writeDocument } from '@/lib/github/server';
import { ADVANCE_REQUEST_NOTIFICATION_EVENT_TYPE } from '@/lib/notifications/advance-request-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DOCUMENTS_TABLE = 'app_documents';
const MARKER_COLLECTION = 'notification_events';
const MARKER_EVENT_TYPE = 'advance_request_notification_dispatch';
const SCAN_PAGE_SIZE = 100;
const MAX_SCAN_ROWS = 5_000;
const MAX_DISPATCHES_PER_RUN = 10;
const DISPATCH_CONCURRENCY = 2;
const PROCESSING_LEASE_MS = 8 * 60 * 1_000;
const TERMINAL_SKIP_REASONS = new Set([
  'advance_not_submitted',
  'advance_predates_rule',
  'invalid_advance_project',
  'no_configured_recipients',
  'no_eligible_recipients',
  'rule_disabled',
  'unattested_advance',
  'unverified_advance_creator',
]);

type AppDocumentRow = {
  doc_id: string;
  data: Record<string, any>;
  created_at: string;
};

type AdvanceCandidate = {
  projectId: string;
  advanceId: string;
  markerId: string;
};

const cleanIdentifier = (value: unknown, maxLength = 180) => {
  const identifier = String(value || '').trim().slice(0, maxLength);
  return /^[A-Za-z0-9_-]+$/.test(identifier) ? identifier : '';
};

const cleanText = (value: unknown, maxLength = 500) =>
  String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);

const stableId = (value: string) =>
  crypto.createHash('sha256').update(value).digest('hex');

const markerIdFor = (projectId: string, advanceId: string) =>
  `advance-request-dispatch-${stableId(`${projectId}:${advanceId}`)}`;

const secureEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const requireCronAuthorization = (request: NextRequest) => {
  const secret = String(process.env.CRON_SECRET || '');
  const authorization = request.headers.get('authorization') || '';
  return Boolean(secret) && secureEqual(authorization, `Bearer ${secret}`);
};

const getRetryDelayMinutes = (attempts: number) =>
  Math.min(60, 5 * (2 ** Math.min(Math.max(attempts - 1, 0), 4)));

const markerIsEligible = (marker: Record<string, any> | undefined) => {
  if (!marker) return true;
  if (marker.status === 'completed' || marker.status === 'skipped') return false;
  const now = Date.now();
  if (marker.status === 'processing') {
    const leaseUntil = new Date(String(marker.leaseUntil || '')).getTime();
    if (Number.isFinite(leaseUntil) && leaseUntil > now) return false;
  }
  const nextAttemptAt = new Date(String(marker.nextAttemptAt || '')).getTime();
  return !Number.isFinite(nextAttemptAt) || nextAttemptAt <= now;
};

const markerForCandidate = (
  candidate: AdvanceCandidate,
  marker: Record<string, any> | undefined,
) => {
  if (!marker) return undefined;
  if (
    marker.eventType !== MARKER_EVENT_TYPE
    || cleanIdentifier(marker.projectId) !== candidate.projectId
    || cleanIdentifier(marker.advanceId) !== candidate.advanceId
  ) return undefined;
  return marker;
};

const summarizeDispatch = (body: Record<string, any>) => ({
  notified: Math.max(0, Number(body.notified) || 0),
  failed: Math.max(0, Number(body.failed) || 0),
  partial: Math.max(0, Number(body.partial) || 0),
  skipped: typeof body.skipped === 'number' ? Math.max(0, body.skipped) : 0,
  reason: cleanText(body.reason, 120) || null,
});

const classifyDispatch = (
  response: NextResponse,
  body: Record<string, any>,
) => {
  const results = Array.isArray(body.results) ? body.results : [];
  const deliveryInProgress = results.some(
    (result: Record<string, any>) => result?.reason === 'delivery_in_progress',
  );
  if (
    response.ok
    && body.ok === true
    && !deliveryInProgress
    && Number(body.failed || 0) === 0
    && Number(body.partial || 0) === 0
  ) {
    return { status: 'completed' as const, terminal: true };
  }
  if (response.ok && body.skipped === true && TERMINAL_SKIP_REASONS.has(String(body.reason || ''))) {
    return { status: 'skipped' as const, terminal: true };
  }
  if (response.status === 404 || response.status === 409) {
    return { status: 'skipped' as const, terminal: true };
  }
  return { status: 'retry' as const, terminal: false };
};

const listAttestedAdvanceSubmissions = async (
  supabase: any,
  offset: number,
): Promise<{ candidates: AdvanceCandidate[]; rawCount: number }> => {
  const { data, error } = await supabase
    .from(DOCUMENTS_TABLE)
    .select('doc_id,data,created_at')
    .eq('collection_path', MARKER_COLLECTION)
    .eq('data->>eventType', 'advance_request_submission_attested')
    .order('created_at', { ascending: false })
    .order('doc_id', { ascending: true })
    .range(offset, offset + SCAN_PAGE_SIZE - 1);
  if (error) throw error;

  const rows: AppDocumentRow[] = data || [];
  const candidates = rows.flatMap((row) => {
    const projectId = cleanIdentifier(row.data?.projectId);
    const advanceId = cleanIdentifier(row.data?.advanceId);
    if (!projectId || !advanceId) return [];
    return [{ projectId, advanceId, markerId: markerIdFor(projectId, advanceId) }];
  });
  return { candidates, rawCount: rows.length };
};

const listMarkers = async (supabase: any, markerIds: string[]) => {
  if (markerIds.length === 0) return new Map<string, Record<string, any>>();
  const { data, error } = await supabase
    .from(DOCUMENTS_TABLE)
    .select('doc_id,data')
    .eq('collection_path', MARKER_COLLECTION)
    .in('doc_id', markerIds);
  if (error) throw error;
  return new Map<string, Record<string, any>>(
    (data || []).map((row: { doc_id: string; data: Record<string, any> }) => [
      row.doc_id,
      row.data || {},
    ]),
  );
};

export async function GET(request: NextRequest) {
  if (!requireCronAuthorization(request)) {
    return NextResponse.json({ error: 'Cron no autorizado.' }, { status: 401 });
  }

  try {
    const supabase = getServerSupabase();
    const eligible: AdvanceCandidate[] = [];
    const markerById = new Map<string, Record<string, any>>();
    let scanned = 0;
    for (let offset = 0; offset < MAX_SCAN_ROWS; offset += SCAN_PAGE_SIZE) {
      const { candidates: page, rawCount } = await listAttestedAdvanceSubmissions(supabase, offset);
      scanned += rawCount;
      const pageMarkers = await listMarkers(supabase, page.map((candidate) => candidate.markerId));
      pageMarkers.forEach((value, key) => markerById.set(key, value));
      eligible.push(...page.filter(
        (candidate) => markerIsEligible(
          markerForCandidate(candidate, pageMarkers.get(candidate.markerId)),
        ),
      ));
      if (eligible.length >= MAX_DISPATCHES_PER_RUN || rawCount < SCAN_PAGE_SIZE) break;
    }
    eligible.splice(MAX_DISPATCHES_PER_RUN);
    const outcomes: Array<{ status: 'completed' | 'skipped' | 'retry' }> = [];

    const processCandidate = async (candidate: AdvanceCandidate) => {
      const existing = markerForCandidate(candidate, markerById.get(candidate.markerId)) || {};
      const attempts = Math.max(0, Number(existing.attempts) || 0) + 1;
      const startedAt = new Date().toISOString();
      await writeDocument(supabase, MARKER_COLLECTION, candidate.markerId, {
        eventType: MARKER_EVENT_TYPE,
        sourceEventType: ADVANCE_REQUEST_NOTIFICATION_EVENT_TYPE,
        projectId: candidate.projectId,
        advanceId: candidate.advanceId,
        status: 'processing',
        attempts,
        startedAt,
        leaseUntil: new Date(Date.now() + PROCESSING_LEASE_MS).toISOString(),
        nextAttemptAt: null,
      }, false);

      let response: NextResponse;
      let body: Record<string, any>;
      try {
        const internalRequest = new NextRequest(
          new URL('/api/notifications/advance-requested', request.url),
          {
            method: 'POST',
            headers: {
              Authorization: request.headers.get('authorization') || '',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              projectId: candidate.projectId,
              advanceId: candidate.advanceId,
            }),
          },
        );
        response = await dispatchAdvanceRequestNotification(internalRequest);
        body = await response.json().catch(() => ({}));
      } catch (error: any) {
        response = NextResponse.json({}, { status: 500 });
        body = { error: cleanText(error?.message || 'dispatch_failed') };
      }

      const classification = classifyDispatch(response, body);
      const finishedAt = new Date().toISOString();
      const retryDelay = getRetryDelayMinutes(attempts);
      await writeDocument(supabase, MARKER_COLLECTION, candidate.markerId, {
        eventType: MARKER_EVENT_TYPE,
        sourceEventType: ADVANCE_REQUEST_NOTIFICATION_EVENT_TYPE,
        projectId: candidate.projectId,
        advanceId: candidate.advanceId,
        status: classification.status,
        attempts,
        startedAt,
        finishedAt,
        leaseUntil: null,
        nextAttemptAt: classification.terminal
          ? null
          : new Date(Date.now() + retryDelay * 60 * 1_000).toISOString(),
        httpStatus: response.status,
        result: summarizeDispatch(body),
        lastError: classification.terminal ? null : cleanText(body.error || 'delivery_incomplete'),
      }, false);
      outcomes.push({ status: classification.status });
    };

    for (let index = 0; index < eligible.length; index += DISPATCH_CONCURRENCY) {
      await Promise.all(
        eligible.slice(index, index + DISPATCH_CONCURRENCY).map(processCandidate),
      );
    }

    return NextResponse.json({
      ok: true,
      scanned,
      eligible: eligible.length,
      completed: outcomes.filter((outcome) => outcome.status === 'completed').length,
      skipped: outcomes.filter((outcome) => outcome.status === 'skipped').length,
      retry: outcomes.filter((outcome) => outcome.status === 'retry').length,
    });
  } catch (error: any) {
    console.error('Advance request notification reconciliation failed:', error);
    return NextResponse.json(
      { error: error?.message || 'No fue posible reconciliar las alertas de anticipos.' },
      { status: 500 },
    );
  }
}
