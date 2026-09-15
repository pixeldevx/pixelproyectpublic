import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getBootstrapAdminEmailSet } from '@/lib/bootstrap-admins';
import {
  CONTRACTOR_ACCOUNT_STAGE_LABELS,
  getContractorAccountConfiguredApproverId,
  resolveContractorAccountApprovalConfig,
  type ContractorAccountStatus,
} from '@/lib/contractor-account-workflow';
import { getOrganizationIds } from '@/lib/organizations';
import {
  emptyUserReassignmentCounts,
  mergeUserReassignmentCounts,
  projectIdFromReassignmentDocument,
  ReassignmentDocument,
  transformUserReassignmentDocument,
  UserReassignmentContext,
  UserReassignmentIdentity,
} from '@/lib/user-reassignment';

export const runtime = 'nodejs';
export const maxDuration = 60;

const DOCUMENTS_TABLE = 'app_documents';
const ADMIN_EMAILS = getBootstrapAdminEmailSet();
const PAGE_SIZE = 1000;
const WRITE_CHUNK_SIZE = 150;

type AdminClient = any;

type AppDocumentRow = ReassignmentDocument & {
  created_at?: string;
  updated_at?: string;
};

const json = (body: Record<string, any>, status = 200) => NextResponse.json(body, { status });
const normalizeEmail = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : '';

const getBearerToken = (request: NextRequest) => {
  const header = request.headers.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? token : '';
};

const getAdminClient = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Falta configurar SUPABASE_SERVICE_ROLE_KEY en el entorno de Vercel.');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
};

const findUserProfile = async (supabase: AdminClient, userId: string, email: string) => {
  const { data: byId, error: byIdError } = await supabase
    .from(DOCUMENTS_TABLE)
    .select('collection_path,doc_id,data')
    .eq('collection_path', 'users')
    .eq('doc_id', userId)
    .maybeSingle();
  if (byIdError) throw byIdError;
  if (byId) return byId as AppDocumentRow;

  const { data: byEmail, error: byEmailError } = await supabase
    .from(DOCUMENTS_TABLE)
    .select('collection_path,doc_id,data')
    .eq('collection_path', 'users')
    .eq('data->>email', email)
    .limit(1)
    .maybeSingle();
  if (byEmailError) throw byEmailError;
  return (byEmail || null) as AppDocumentRow | null;
};

const ensureGlobalAdmin = async (supabase: AdminClient, token: string) => {
  if (!token) return { error: json({ error: 'Sesión no encontrada.' }, 401) };
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.email) return { error: json({ error: 'Sesión inválida.' }, 401) };

  const email = normalizeEmail(data.user.email);
  const profile = await findUserProfile(supabase, data.user.id, email);
  const role = profile?.data?.role || profile?.data?.systemRole;
  if (!ADMIN_EMAILS.has(email) && role !== 'admin') {
    return { error: json({ error: 'Solo el administrador global puede reasignar usuarios.' }, 403) };
  }
  return { user: data.user, email };
};

const listProfileRows = async (supabase: AdminClient) => {
  const { data, error } = await supabase
    .from(DOCUMENTS_TABLE)
    .select('collection_path,doc_id,data')
    .in('collection_path', ['users', 'team_members']);
  if (error) throw error;
  return (data || []) as AppDocumentRow[];
};

const getAppDocumentRow = async (supabase: AdminClient, collectionPath: string, docId: string) => {
  const { data, error } = await supabase
    .from(DOCUMENTS_TABLE)
    .select('collection_path,doc_id,data')
    .eq('collection_path', collectionPath)
    .eq('doc_id', docId)
    .maybeSingle();
  if (error) throw error;
  return (data || null) as AppDocumentRow | null;
};

const buildIdentity = async (
  supabase: AdminClient,
  userId: string,
  profileRows: AppDocumentRow[],
): Promise<UserReassignmentIdentity> => {
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error) throw error;
  const authUser = data?.user;
  if (!authUser?.id || !authUser.email) throw new Error('Uno de los usuarios seleccionados ya no existe.');

  const email = normalizeEmail(authUser.email);
  const userProfile = profileRows.find((row) =>
    row.collection_path === 'users' && (
      row.doc_id === authUser.id ||
      row.data?.authUserId === authUser.id ||
      normalizeEmail(row.data?.email) === email
    )
  );
  const teamProfiles = profileRows.filter((row) =>
    row.collection_path === 'team_members' && (
      row.doc_id === authUser.id ||
      row.data?.authUserId === authUser.id ||
      normalizeEmail(row.data?.email) === email
    )
  );
  const primaryTeamProfile = teamProfiles.find((row) => row.data?.authUserId === authUser.id) || teamProfiles[0];
  const metadata = authUser.user_metadata || {};

  return {
    authUserId: authUser.id,
    memberId: primaryTeamProfile?.doc_id || authUser.id,
    memberIds: Array.from(new Set([authUser.id, ...teamProfiles.map((row) => row.doc_id)].filter(Boolean))),
    email,
    displayName:
      userProfile?.data?.displayName ||
      primaryTeamProfile?.data?.name ||
      metadata.displayName ||
      metadata.full_name ||
      metadata.name ||
      email.split('@')[0],
    photoURL:
      userProfile?.data?.photoURL ||
      primaryTeamProfile?.data?.photoURL ||
      metadata.photoURL ||
      metadata.avatar_url ||
      null,
  };
};

const listPagedDocuments = async (
  supabase: AdminClient,
  filter: { exact?: string; pattern?: string },
) => {
  const rows: AppDocumentRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let request = supabase
      .from(DOCUMENTS_TABLE)
      .select('collection_path,doc_id,data')
      .order('collection_path', { ascending: true })
      .order('doc_id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    request = filter.exact
      ? request.eq('collection_path', filter.exact)
      : request.like('collection_path', filter.pattern);

    const { data, error } = await request;
    if (error) throw error;
    const page = (data || []) as AppDocumentRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
};

const listOperationalDocuments = async (supabase: AdminClient) => {
  const groups = await Promise.all([
    listPagedDocuments(supabase, { exact: 'projects' }),
    listPagedDocuments(supabase, { exact: 'organizations' }),
    listPagedDocuments(supabase, { exact: 'workflow_templates' }),
    listPagedDocuments(supabase, { pattern: 'projects/%/tasks' }),
    listPagedDocuments(supabase, { pattern: 'projects/%/contractorPaymentRequests' }),
    listPagedDocuments(supabase, { pattern: 'projects/%/orgChart' }),
  ]);
  return groups.flat();
};

const analyzeReassignment = (documents: AppDocumentRow[], context: UserReassignmentContext) => {
  const counts = emptyUserReassignmentCounts();
  const projectIds = new Set<string>();
  const changedRows: AppDocumentRow[] = [];
  const contractorAccountChanges: Array<{ before: AppDocumentRow; after: AppDocumentRow }> = [];
  const projectsById = new Map(
    documents.filter((row) => row.collection_path === 'projects').map((row) => [row.doc_id, row.data])
  );
  const organizationsById = new Map(
    documents.filter((row) => row.collection_path === 'organizations').map((row) => [row.doc_id, row.data])
  );
  const sourceIdentities = new Set([
    context.source.authUserId,
    ...context.source.memberIds,
    context.source.email,
  ].map(normalizeEmail).filter(Boolean));

  for (const document of documents) {
    let documentContext = context;
    if (/^projects\/[^/]+\/contractorPaymentRequests$/.test(document.collection_path)) {
      const projectId = projectIdFromReassignmentDocument(document) || '';
      const project = projectsById.get(projectId) || {};
      const organization = organizationsById.get(getOrganizationIds(project)[0] || '') || {};
      const status = String(document.data.status || 'submitted') as ContractorAccountStatus;
      const effectiveConfig = resolveContractorAccountApprovalConfig(
        project.contractorAccountApprovalConfig,
        organization.contractorAccountApprovalConfig
      );
      const fallbackCandidates = status === 'returned'
        ? [
            document.data.contractorId,
            document.data.contractorAuthUserId,
            document.data.contractorEmail,
            document.data.requesterSignature?.signerUserId,
            document.data.requesterSignature?.signerMemberId,
            document.data.requesterSignature?.email,
          ]
        : [getContractorAccountConfiguredApproverId(effectiveConfig, status)];
      const fallbackOwnerId = fallbackCandidates.find((value) => sourceIdentities.has(normalizeEmail(value))) || null;
      documentContext = {
        ...context,
        contractorAccountFallbackOwnerMatches: Boolean(fallbackOwnerId),
        contractorAccountFallbackOwnerId: fallbackOwnerId ? String(fallbackOwnerId) : null,
      };
    }
    const transformed = transformUserReassignmentDocument(document, documentContext);
    mergeUserReassignmentCounts(counts, transformed.counts);
    if (!transformed.changed) continue;
    const changedRow = {
      collection_path: transformed.collection_path,
      doc_id: transformed.doc_id,
      data: transformed.data,
    };
    changedRows.push(changedRow);
    if (/^projects\/[^/]+\/contractorPaymentRequests$/.test(document.collection_path)) {
      contractorAccountChanges.push({ before: document, after: changedRow });
    }
    const projectId = projectIdFromReassignmentDocument(document);
    if (projectId) projectIds.add(projectId);
  }

  return { counts, projectIds: Array.from(projectIds), changedRows, contractorAccountChanges };
};

const writeAudit = async (
  supabase: AdminClient,
  operationId: string,
  data: Record<string, any>,
) => {
  const source = data.source || {};
  const target = data.target || {};
  const requestedBy = data.requestedBy || {};
  const { error } = await supabase.from('user_reassignment_audit').upsert({
    operation_id: operationId,
    status: data.status,
    source_user_id: source.authUserId,
    source_email: source.email,
    target_user_id: target.authUserId,
    target_email: target.email,
    reason: data.reason,
    requested_by_id: requestedBy.id,
    requested_by_email: requestedBy.email,
    counts: data.counts || {},
    affected_project_ids: data.affectedProjectIds || [],
    details: {
      source,
      target,
      ratesPreserved: data.ratesPreserved === true,
      historicalDataPreserved: data.historicalDataPreserved === true,
      preservedCollections: data.preservedCollections || [],
      contractorAccountConflicts: data.contractorAccountConflicts || 0,
      notificationFailures: data.notificationFailures || 0,
    },
    started_at: data.startedAt,
    completed_at: data.completedAt || null,
    failed_at: data.failedAt || null,
    error: data.error || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'operation_id' });
  if (error) throw error;
};

const writeChangedRows = async (supabase: AdminClient, rows: AppDocumentRow[], changedAt: string) => {
  for (let index = 0; index < rows.length; index += WRITE_CHUNK_SIZE) {
    const chunk = rows.slice(index, index + WRITE_CHUNK_SIZE);
    const { error } = await supabase.from(DOCUMENTS_TABLE).upsert(
      chunk.map((row) => ({
        collection_path: row.collection_path,
        doc_id: row.doc_id,
        data: row.data,
        updated_at: changedAt,
      })),
      { onConflict: 'collection_path,doc_id' },
    );
    if (error) throw error;
  }
};

type ContractorAccountAtomicChange = { before: AppDocumentRow; after: AppDocumentRow };

const isContractorAccountRow = (row: ReassignmentDocument) =>
  /^projects\/[^/]+\/contractorPaymentRequests$/.test(row.collection_path);

const applyContractorAccountAtomicChange = async (
  supabase: AdminClient,
  change: ContractorAccountAtomicChange,
) => {
  const before = change.before.data;
  const after = change.after.data;
  const status = String(before.status || 'submitted') as ContractorAccountStatus;
  const history = Array.isArray(after.approvalRouteReassignmentHistory)
    ? after.approvalRouteReassignmentHistory
    : [];
  const historyEntry = history[history.length - 1] || {};
  const { data, error } = await supabase.rpc('app_reassign_contractor_account_approver', {
    p_project_id: projectIdFromReassignmentDocument(change.before),
    p_account_id: change.before.doc_id,
    p_expected_status: status,
    p_expected_stage: String(before.currentApprovalStage || status),
    p_expected_assignment_event_id: String(before.currentAssignmentEventId || ''),
    p_expected_approver_id: String(before.currentApproverId || ''),
    p_expected_approver_member_id: String(before.currentApproverMemberId || ''),
    p_expected_approver_auth_user_id: String(before.currentApproverAuthUserId || ''),
    p_expected_approver_email: String(before.currentApproverEmail || ''),
    p_next_approver_id: String(after.currentApproverId || ''),
    p_next_approver_member_id: String(after.currentApproverMemberId || ''),
    p_next_approver_auth_user_id: after.currentApproverAuthUserId || null,
    p_next_approver_email: after.currentApproverEmail || null,
    p_next_approver_label: CONTRACTOR_ACCOUNT_STAGE_LABELS[status] || status,
    p_next_assignment_event_id: String(after.currentAssignmentEventId || ''),
    p_history_entry: historyEntry,
  });
  if (error) throw error;
  return data as { applied?: boolean; reason?: string } | null;
};

const markProfiles = async (
  supabase: AdminClient,
  profileRows: AppDocumentRow[],
  context: UserReassignmentContext,
  operationId: string,
  reason: string,
  actor: { id: string; email: string },
) => {
  const sourceRows = profileRows.filter((row) =>
    (row.collection_path === 'users' || row.collection_path === 'team_members') &&
    (row.doc_id === context.source.authUserId || context.source.memberIds.includes(row.doc_id) || row.data?.authUserId === context.source.authUserId)
  );
  const targetRows = profileRows.filter((row) =>
    (row.collection_path === 'users' || row.collection_path === 'team_members') &&
    (row.doc_id === context.target.authUserId || context.target.memberIds.includes(row.doc_id) || row.data?.authUserId === context.target.authUserId)
  );
  const sourceOrganizationIds = Array.from(new Set(sourceRows.flatMap((row) => [
    ...(Array.isArray(row.data?.organizationIds) ? row.data.organizationIds : []),
    row.data?.organizationId,
  ]).filter((value): value is string => typeof value === 'string' && Boolean(value))));

  const rows = [
    ...sourceRows.map((row) => ({
      ...row,
      data: {
        ...row.data,
        operationalReassignment: {
          operationId,
          targetUserId: context.target.authUserId,
          targetMemberId: context.target.memberId,
          targetEmail: context.target.email,
          targetName: context.target.displayName,
          reason,
          reassignedAt: context.changedAt,
          reassignedBy: actor,
        },
        updatedAt: context.changedAt,
      },
    })),
    ...targetRows.map((row) => {
      const history = Array.isArray(row.data?.operationalReassignmentsReceived)
        ? row.data.operationalReassignmentsReceived
        : [];
      const targetOrganizationIds = Array.from(new Set([
        ...(Array.isArray(row.data?.organizationIds) ? row.data.organizationIds : []),
        row.data?.organizationId,
        ...sourceOrganizationIds,
      ].filter((value): value is string => typeof value === 'string' && Boolean(value))));
      return {
        ...row,
        data: {
          ...row.data,
          operationalReassignmentsReceived: [
            ...history.filter((entry: any) => entry?.operationId !== operationId),
            {
              operationId,
              sourceUserId: context.source.authUserId,
              sourceEmail: context.source.email,
              sourceName: context.source.displayName,
              reason,
              reassignedAt: context.changedAt,
              reassignedBy: actor,
            },
          ],
          organizationId: row.data?.organizationId || targetOrganizationIds[0] || null,
          organizationIds: targetOrganizationIds,
          updatedAt: context.changedAt,
        },
      };
    }),
  ];

  await writeChangedRows(supabase, rows, context.changedAt);
};

const getPayloadIds = (requestUrl: string) => {
  const url = new URL(requestUrl);
  return {
    sourceUserId: (url.searchParams.get('sourceUserId') || '').trim(),
    targetUserId: (url.searchParams.get('targetUserId') || '').trim(),
  };
};

const prepareAnalysis = async (
  supabase: AdminClient,
  sourceUserId: string,
  targetUserId: string,
  metadata: Pick<UserReassignmentContext, 'actor' | 'operationId' | 'reason'> = {},
) => {
  if (!sourceUserId || !targetUserId) throw new Error('Selecciona el usuario origen y el usuario destino.');
  if (sourceUserId === targetUserId) throw new Error('El usuario destino debe ser diferente al usuario origen.');

  const profileRows = await listProfileRows(supabase);
  const [source, target, documents] = await Promise.all([
    buildIdentity(supabase, sourceUserId, profileRows),
    buildIdentity(supabase, targetUserId, profileRows),
    listOperationalDocuments(supabase),
  ]);
  const changedAt = new Date().toISOString();
  const context: UserReassignmentContext = { source, target, changedAt, ...metadata };
  const analysis = analyzeReassignment(documents, context);
  return { profileRows, context, analysis };
};

export async function GET(request: NextRequest) {
  try {
    const supabase = getAdminClient();
    const authResult = await ensureGlobalAdmin(supabase, getBearerToken(request));
    if ('error' in authResult) return authResult.error;

    const { sourceUserId, targetUserId } = getPayloadIds(request.url);
    const { context, analysis } = await prepareAnalysis(supabase, sourceUserId, targetUserId);
    return json({
      source: context.source,
      target: context.target,
      counts: analysis.counts,
      projectIds: analysis.projectIds,
      ratesPreserved: true,
      historicalDataPreserved: true,
    });
  } catch (error: any) {
    console.error('Error previewing user reassignment:', error);
    const message = error?.message || 'No fue posible analizar la reasignación.';
    return json({ error: message }, message.includes('Selecciona') || message.includes('diferente') ? 400 : 500);
  }
}

export async function POST(request: NextRequest) {
  const supabase = getAdminClient();
  let operationId = crypto.randomUUID();
  let auditData: Record<string, any> | null = null;

  try {
    const bearerToken = getBearerToken(request);
    const authResult = await ensureGlobalAdmin(supabase, bearerToken);
    if ('error' in authResult) return authResult.error;

    const payload = await request.json();
    const sourceUserId = typeof payload.sourceUserId === 'string' ? payload.sourceUserId.trim() : '';
    const targetUserId = typeof payload.targetUserId === 'string' ? payload.targetUserId.trim() : '';
    const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
    if (reason.length < 8) {
      return json({ error: 'Describe el motivo de la reasignación (mínimo 8 caracteres).' }, 400);
    }

    const actor = { id: authResult.user.id, email: authResult.email };
    const { profileRows, context, analysis } = await prepareAnalysis(
      supabase,
      sourceUserId,
      targetUserId,
      {
        actor: { ...actor, name: authResult.user.user_metadata?.displayName || authResult.user.email || null },
        operationId,
        reason,
      }
    );
    auditData = {
      operationId,
      status: 'processing',
      source: context.source,
      target: context.target,
      reason,
      requestedBy: actor,
      startedAt: context.changedAt,
      counts: analysis.counts,
      affectedProjectIds: analysis.projectIds,
      ratesPreserved: true,
      historicalDataPreserved: true,
      preservedCollections: ['rateCards', 'rateCardEntries', 'qualityEvents', 'administrativeEvents', 'comments'],
    };
    await writeAudit(supabase, operationId, auditData);

    const nonContractorRows = analysis.changedRows.filter((row) => !isContractorAccountRow(row));
    await writeChangedRows(supabase, nonContractorRows, context.changedAt);

    const appliedContractorChanges: ContractorAccountAtomicChange[] = [];
    const contractorAccountConflicts = new Set<string>();
    let pendingContractorChanges = analysis.contractorAccountChanges;
    for (let attempt = 0; attempt < 3 && pendingContractorChanges.length > 0; attempt += 1) {
      const results = await Promise.all(pendingContractorChanges.map(async (change) => ({
        change,
        result: await applyContractorAccountAtomicChange(supabase, change),
      })));
      const staleChanges = results.filter(({ result }) =>
        ['stale_stage', 'stale_assignment'].includes(String(result?.reason || ''))
      );

      results.forEach(({ change, result }) => {
        if (result?.applied) {
          appliedContractorChanges.push(change);
          contractorAccountConflicts.delete(`${change.before.collection_path}:${change.before.doc_id}`);
        } else if (['stale_stage', 'stale_assignment', 'not_found'].includes(String(result?.reason || ''))) {
          contractorAccountConflicts.add(`${change.before.collection_path}:${change.before.doc_id}`);
        }
      });

      if (attempt === 2 || staleChanges.length === 0) {
        pendingContractorChanges = [];
        continue;
      }

      const refreshedChanges = await Promise.all(staleChanges.map(async ({ change }) => {
        const currentRow = await getAppDocumentRow(
          supabase,
          change.before.collection_path,
          change.before.doc_id
        );
        if (!currentRow) return null;
        const transformed = transformUserReassignmentDocument(currentRow, context);
        if (!transformed.changed) return null;
        return {
          before: currentRow,
          after: {
            collection_path: transformed.collection_path,
            doc_id: transformed.doc_id,
            data: transformed.data,
          },
        } satisfies ContractorAccountAtomicChange;
      }));
      pendingContractorChanges = refreshedChanges.filter(Boolean) as ContractorAccountAtomicChange[];
    }

    await markProfiles(supabase, profileRows, context, operationId, reason, actor);

    const contractorAccountAssignments = appliedContractorChanges
      .map(({ after }) => ({
        projectId: projectIdFromReassignmentDocument(after),
        taskId: after.doc_id,
        assigneeId: after.data.currentApproverId,
        assignmentStage: after.data.currentApprovalStage || after.data.status,
        notificationEventId: after.data.currentAssignmentEventId,
      }))
      .filter((assignment) => assignment.projectId && assignment.assigneeId && assignment.notificationEventId);
    const notificationResults = await Promise.allSettled(
      contractorAccountAssignments.map(async (assignment) => {
        const response = await fetch(new URL('/api/notifications/task-assigned', request.url), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${bearerToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...assignment,
            eventType: 'contractor_account_assigned',
            source: 'user_reassignment',
          }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(`No se pudo notificar la cuenta ${assignment.taskId}.`);
        if (body?.skipped && !['duplicate_event', 'stale_contractor_account_assignment'].includes(String(body.reason || ''))) {
          throw new Error(`La notificación de la cuenta ${assignment.taskId} fue omitida.`);
        }
      })
    );
    const notificationFailures = notificationResults.filter((result) => result.status === 'rejected').length;
    const appliedContractorAccountCount = appliedContractorChanges.length;
    const finalCounts = {
      ...analysis.counts,
      documents: analysis.counts.documents - analysis.counts.contractorAccounts + appliedContractorAccountCount,
      contractorAccounts: appliedContractorAccountCount,
    };

    auditData = {
      ...auditData,
      status: 'completed',
      completedAt: new Date().toISOString(),
      counts: finalCounts,
      contractorAccountConflicts: contractorAccountConflicts.size,
      notificationFailures,
    };
    await writeAudit(supabase, operationId, auditData);

    return json({
      operationId,
      message: finalCounts.documents > 0
        ? 'La responsabilidad operativa fue reasignada correctamente.'
        : 'No había asignaciones operativas pendientes para trasladar.',
      counts: finalCounts,
      projectIds: analysis.projectIds,
      ratesPreserved: true,
      historicalDataPreserved: true,
      notificationFailures,
      contractorAccountConflicts: contractorAccountConflicts.size,
    });
  } catch (error: any) {
    console.error('Error executing user reassignment:', error);
    if (auditData) {
      try {
        await writeAudit(supabase, operationId, {
          ...auditData,
          status: 'failed',
          failedAt: new Date().toISOString(),
          error: error?.message || 'Error desconocido',
        });
      } catch (auditError) {
        console.error('Error recording failed user reassignment:', auditError);
      }
    }
    return json({ error: error?.message || 'No fue posible completar la reasignación.' }, 500);
  }
}
