import { NextRequest, NextResponse } from 'next/server';
import { getWorkspaceServerClient, workspaceErrorStatus } from '@/lib/workspaces/server';
import { getBootstrapAdminEmailSet } from '@/lib/bootstrap-admins';
import { getOrganizationIds } from '@/lib/organizations';
import {
  CONTRACTOR_ACCOUNT_STAGE_LABELS,
  getContractorAccountConfiguredApproverId,
  resolveContractorAccountApprovalConfig,
  type ContractorAccountStatus,
} from '@/lib/contractor-account-workflow';

export const runtime = 'nodejs';
export const maxDuration = 60;

const DOCUMENTS_TABLE = 'app_documents';
const PAGE_SIZE = 1000;
const ADMIN_EMAILS = getBootstrapAdminEmailSet();
const OPERATION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{7,119}$/;

type ContractorAccountAction = 'approve' | 'account' | 'pay' | 'return' | 'reject' | 'reactivate';

type AppDocumentRow = {
  collection_path: string;
  doc_id: string;
  data: Record<string, any>;
};

type DirectoryPerson = {
  configuredId: string;
  memberId: string;
  authUserId: string | null;
  email: string | null;
  displayName: string;
  aliases: string[];
  data: Record<string, any>;
};

const json = (body: Record<string, any>, status = 200) => NextResponse.json(body, { status });
const clean = (value: unknown) => String(value || '').trim();
const normalize = (value: unknown) => clean(value).toLowerCase();
const asObject = (value: unknown) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
);

const getBearerToken = (request: NextRequest) => {
  const [scheme, token] = (request.headers.get('authorization') || '').split(' ');
  return scheme?.toLowerCase() === 'bearer' ? token : '';
};

const getAdminClient = getWorkspaceServerClient;

const getDocumentRow = async (supabase: any, collectionPath: string, docId: string) => {
  const { data, error } = await supabase
    .from(DOCUMENTS_TABLE)
    .select('collection_path,doc_id,data')
    .eq('collection_path', collectionPath)
    .eq('doc_id', docId)
    .maybeSingle();
  if (error) throw error;
  return (data || null) as AppDocumentRow | null;
};

const listDirectoryRows = async (supabase: any) => {
  const rows: AppDocumentRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(DOCUMENTS_TABLE)
      .select('collection_path,doc_id,data')
      .in('collection_path', ['team_members', 'users'])
      .order('collection_path', { ascending: true })
      .order('doc_id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data || []) as AppDocumentRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
};

const rowAliases = (row: AppDocumentRow) => Array.from(new Set([
  row.doc_id,
  row.data?.id,
  row.data?.memberId,
  row.data?.authUserId,
  row.data?.userId,
  row.data?.uid,
  row.data?.email,
].map(normalize).filter(Boolean)));

const rowsShareAlias = (left: AppDocumentRow, right: AppDocumentRow) => {
  const rightAliases = new Set(rowAliases(right));
  return rowAliases(left).some((alias) => rightAliases.has(alias));
};

const rowBelongsToAuthenticatedActor = (
  row: AppDocumentRow,
  userId: string,
) => row.collection_path === 'users'
  ? row.doc_id === userId
  : row.collection_path === 'team_members' && [
      row.data?.authUserId,
      row.data?.uid,
      row.data?.userId,
    ].some((value) => clean(value) === userId);

const getTimestampScore = (value: unknown) => {
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const source = asObject(value);
  const seconds = Number(source.seconds ?? source._seconds ?? 0);
  return Number.isFinite(seconds) ? seconds * 1000 : 0;
};

const isActorSignaturePath = (value: unknown, userId: string) => {
  const segments = clean(value).split('/').filter(Boolean);
  const signatureDirectoryIndex = segments.lastIndexOf('profile_signatures');
  const fileName = signatureDirectoryIndex >= 0 ? segments[signatureDirectoryIndex + 1] || '' : '';
  return fileName.startsWith(`${userId}_`) && !fileName.includes('..');
};

const resolveDirectoryPerson = (configuredId: string, rows: AppDocumentRow[]): DirectoryPerson | null => {
  const wanted = normalize(configuredId);
  if (!wanted) return null;
  const direct = rows.filter((row) => rowAliases(row).includes(wanted));
  if (direct.length === 0) return null;

  const teamRow = direct.find((row) => row.collection_path === 'team_members') ||
    rows.find((row) => row.collection_path === 'team_members' && direct.some((match) => rowsShareAlias(row, match))) ||
    null;
  const userRow = direct.find((row) => row.collection_path === 'users') ||
    rows.find((row) => row.collection_path === 'users' && direct.some((match) => rowsShareAlias(row, match))) ||
    (teamRow ? rows.find((row) => row.collection_path === 'users' && rowsShareAlias(row, teamRow)) : null) ||
    null;
  const primary = teamRow || userRow || direct[0];
  const aliases = Array.from(new Set([
    configuredId,
    ...(teamRow ? rowAliases(teamRow) : []),
    ...(userRow ? rowAliases(userRow) : []),
  ].map(normalize).filter(Boolean)));
  const memberId = clean(teamRow?.doc_id || teamRow?.data?.id || configuredId);
  const authUserId = clean(
    teamRow?.data?.authUserId || teamRow?.data?.userId || teamRow?.data?.uid || userRow?.doc_id
  ) || null;
  const email = normalize(teamRow?.data?.email || userRow?.data?.email || primary.data?.email) || null;
  const displayName = clean(
    teamRow?.data?.name || teamRow?.data?.displayName || teamRow?.data?.fullName ||
    userRow?.data?.displayName || userRow?.data?.name || primary.data?.name || email || configuredId
  );

  return {
    configuredId,
    memberId,
    authUserId,
    email,
    displayName,
    aliases,
    data: { ...userRow?.data, ...teamRow?.data },
  };
};

const resolveFirstDirectoryPerson = (values: unknown[], rows: AppDocumentRow[]) => {
  for (const value of values) {
    const person = resolveDirectoryPerson(clean(value), rows);
    if (person) return person;
  }
  return null;
};

const uniqueAliases = (...groups: unknown[][]) => Array.from(new Set(
  groups.flat().map(normalize).filter(Boolean)
));

const aliasesIntersect = (left: string[], right: string[]) => {
  const rightSet = new Set(right.map(normalize));
  return left.some((value) => rightSet.has(normalize(value)));
};

const nextStatusForAction = (
  action: ContractorAccountAction,
  account: Record<string, any>,
): ContractorAccountStatus | null => {
  const status = clean(account.status || 'submitted') as ContractorAccountStatus;
  if (action === 'reactivate') {
    const returnedStage = clean(account.returnedFromStage) as ContractorAccountStatus;
    return ['submitted', 'boss_approved', 'operations_approved', 'quality_approved', 'hr_approved', 'accounted'].includes(returnedStage)
      ? returnedStage
      : null;
  }
  if (action === 'approve') {
    return ({
      submitted: 'boss_approved',
      boss_approved: 'operations_approved',
      operations_approved: 'quality_approved',
      quality_approved: 'hr_approved',
    } as Partial<Record<ContractorAccountStatus, ContractorAccountStatus>>)[status] || null;
  }
  if (action === 'account') return status === 'hr_approved' ? 'accounted' : null;
  if (action === 'pay') return status === 'accounted' ? 'paid' : null;
  if (action === 'return') return 'returned';
  if (action === 'reject') return 'rejected';
  return null;
};

const buildAssignment = (
  person: DirectoryPerson,
  status: ContractorAccountStatus,
  label?: string,
) => ({
  id: person.configuredId || person.memberId || person.authUserId || person.email,
  configuredId: person.configuredId,
  memberId: person.memberId || null,
  authUserId: person.authUserId,
  email: person.email,
  name: person.displayName,
  label: label || CONTRACTOR_ACCOUNT_STAGE_LABELS[status] || status,
  status,
  aliases: person.aliases,
});

const postAssignmentNotification = async (
  request: NextRequest,
  bearerToken: string,
  assignment: Record<string, any>,
) => {
  const response = await fetch(new URL('/api/notifications/task-assigned', request.url), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      projectId: assignment.projectId,
      taskId: assignment.accountId,
      assigneeId: assignment.assigneeId,
      eventType: 'contractor_account_assigned',
      assignmentStage: assignment.status,
      notificationEventId: assignment.assignmentEventId,
      source: 'contractor_account_action',
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || 'La acción se guardó, pero no se pudo enviar su notificación.');
  return body;
};

export async function POST(request: NextRequest) {
  try {
    const supabase = await getAdminClient(request);
    const bearerToken = getBearerToken(request);
    const { data: authData, error: authError } = await supabase.auth.getUser(bearerToken);
    const authUser = authData?.user;
    if (authError || !authUser?.id || !authUser.email) {
      return json({ error: 'Sesión inválida.' }, 401);
    }

    const body = asObject(await request.json());
    const projectId = clean(body.projectId);
    const accountId = clean(body.accountId);
    const operationId = clean(body.operationId);
    const expectedStatus = clean(body.expectedStatus) as ContractorAccountStatus;
    const expectedStage = clean(body.expectedStage || body.expectedStatus) as ContractorAccountStatus;
    const expectedAssignmentEventId = clean(body.expectedAssignmentEventId);
    const action = clean(body.action) as ContractorAccountAction;
    const comment = clean(body.comment).slice(0, 4000);
    if (!projectId || !accountId || !OPERATION_ID_PATTERN.test(operationId) || !expectedStatus || !expectedStage || !['approve', 'account', 'pay', 'return', 'reject', 'reactivate'].includes(action)) {
      return json({ error: 'La solicitud para actualizar la cuenta está incompleta.' }, 400);
    }

    const accountPath = `projects/${projectId}/contractorPaymentRequests`;
    const [projectRow, accountRow, directoryRows] = await Promise.all([
      getDocumentRow(supabase, 'projects', projectId),
      getDocumentRow(supabase, accountPath, accountId),
      listDirectoryRows(supabase),
    ]);
    if (!projectRow) return json({ error: 'Proyecto no encontrado.' }, 404);
    if (!accountRow) return json({ error: 'Cuenta de cobro no encontrada.' }, 404);

    const account = accountRow.data || {};
    const currentStatus = clean(account.status || 'submitted') as ContractorAccountStatus;
    const currentAssignmentEventId = clean(account.currentAssignmentEventId);
    const currentStage = clean(account.currentApprovalStage || currentStatus) as ContractorAccountStatus;
    const liveStateMatchesExpectation = currentStatus === expectedStatus &&
      currentStage === expectedStage &&
      currentAssignmentEventId === expectedAssignmentEventId;

    const actorProfileRows = directoryRows.filter((row) => rowBelongsToAuthenticatedActor(row, authUser.id));
    const canonicalUserProfile = actorProfileRows.find((row) => (
      row.collection_path === 'users' && row.doc_id === authUser.id
    )) || null;
    const canonicalRole = normalize(canonicalUserProfile?.data?.role || canonicalUserProfile?.data?.systemRole || 'user');
    const actorAliases = uniqueAliases(
      [authUser.id, authUser.email],
      actorProfileRows.flatMap(rowAliases),
    );
    const actorTeamProfile = actorProfileRows.find((row) => row.collection_path === 'team_members') || null;
    const actorProfileData = { ...actorTeamProfile?.data, ...canonicalUserProfile?.data };
    const actorName = clean(
      actorProfileData.displayName || actorProfileData.name || authUser.user_metadata?.displayName || authUser.email
    );
    const isGlobalAdmin = ['owner', 'admin'].includes(supabase.workspace.role);

    const organizationId = getOrganizationIds(projectRow.data)[0] || '';
    const organizationRow = organizationId
      ? await getDocumentRow(supabase, 'organizations', organizationId)
      : null;
    const approvalConfig = resolveContractorAccountApprovalConfig(
      projectRow.data?.contractorAccountApprovalConfig,
      organizationRow?.data?.contractorAccountApprovalConfig,
    );

    const persistedOwnerValues = [
      account.currentApproverId,
      account.currentApproverMemberId,
      account.currentApproverAuthUserId,
      account.currentApproverEmail,
    ];
    const configuredCurrentOwnerId = getContractorAccountConfiguredApproverId(approvalConfig, expectedStatus);
    const persistedOwnerSeeds = persistedOwnerValues.filter((value) => clean(value));
    const currentOwnerSeeds = persistedOwnerSeeds.length > 0
      ? persistedOwnerSeeds
      : configuredCurrentOwnerId ? [configuredCurrentOwnerId] : [];
    const currentOwnerPerson = resolveFirstDirectoryPerson(currentOwnerSeeds, directoryRows);
    const currentOwnerAliases = uniqueAliases(
      currentOwnerSeeds,
      currentOwnerPerson?.aliases || [],
    );
    const isCurrentOwner = aliasesIntersect(actorAliases, currentOwnerAliases);
    if (liveStateMatchesExpectation && !isGlobalAdmin && !isCurrentOwner) {
      return json({ error: 'Esta cuenta está asignada a otro responsable.' }, 403);
    }
    if (action === 'reactivate' && !isGlobalAdmin) {
      return json({ error: 'Solo el Administrador Global puede reactivar una cuenta devuelta sin una nueva radicación.' }, 403);
    }

    const nextStatus = nextStatusForAction(action, { ...account, status: expectedStatus });
    const activeStatuses = ['submitted', 'boss_approved', 'operations_approved', 'quality_approved', 'hr_approved', 'accounted'];
    if (!nextStatus || (['return', 'reject'].includes(action) && !activeStatuses.includes(expectedStatus))) {
      return json({ error: 'La acción ya no corresponde al estado actual de la cuenta.', retryable: true }, 409);
    }

    let nextAssignment: Record<string, any> = {};
    if (nextStatus === 'returned') {
      const requesterValues = [
        account.requesterSignature?.signerUserId,
        account.contractorAuthUserId,
        account.contractorId,
        account.requesterSignature?.signerMemberId,
        account.contractorEmail,
        account.requesterSignature?.email,
      ];
      const requesterPerson = resolveFirstDirectoryPerson(requesterValues, directoryRows);
      const requesterId = clean(
        requesterPerson?.configuredId || account.requesterSignature?.signerUserId ||
        account.contractorAuthUserId || account.contractorId || account.contractorEmail
      );
      if (!requesterId) return json({ error: 'No se pudo identificar al contratista que debe subsanar la cuenta.' }, 422);
      nextAssignment = requesterPerson
        ? buildAssignment(requesterPerson, 'returned', 'Contratista · debe subsanar')
        : {
            id: requesterId,
            configuredId: requesterId,
            memberId: clean(account.contractorId) || null,
            authUserId: clean(account.contractorAuthUserId || account.requesterSignature?.signerUserId) || null,
            email: normalize(account.contractorEmail || account.requesterSignature?.email) || null,
            name: clean(account.contractorName || account.requesterSignature?.name || requesterId),
            label: 'Contratista · debe subsanar',
            status: 'returned',
            aliases: uniqueAliases(requesterValues),
          };
    } else if (!['paid', 'rejected'].includes(nextStatus)) {
      const configuredNextOwnerId = getContractorAccountConfiguredApproverId(approvalConfig, nextStatus);
      const nextOwner = configuredNextOwnerId
        ? resolveDirectoryPerson(configuredNextOwnerId, directoryRows)
        : null;
      if (!configuredNextOwnerId || !nextOwner) {
        return json({ error: `Configura un responsable válido para ${CONTRACTOR_ACCOUNT_STAGE_LABELS[nextStatus] || nextStatus} antes de avanzar.` }, 422);
      }
      const personStatus = normalize(nextOwner.data.status || nextOwner.data.userStatus);
      if (nextOwner.data.isActive === false || ['inactive', 'disabled', 'archived', 'inactivo'].includes(personStatus)) {
        return json({ error: `${nextOwner.displayName} está inactivo y no puede recibir la cuenta.` }, 422);
      }
      if (!nextOwner.email) return json({ error: `${nextOwner.displayName} no tiene correo para recibir la tarea.` }, 422);
      nextAssignment = buildAssignment(nextOwner, nextStatus);
    }

    let signature: Record<string, any> | null = null;
    if (['approve', 'account', 'pay'].includes(action)) {
      const signatureProfile = actorProfileRows
        .filter((row) => isActorSignaturePath(row.data?.signatureStoragePath, authUser.id))
        .sort((left, right) => {
          const timestampDifference = getTimestampScore(right.data?.signatureUpdatedAt) - getTimestampScore(left.data?.signatureUpdatedAt);
          if (timestampDifference !== 0) return timestampDifference;
          if (left.collection_path === right.collection_path) return 0;
          return left.collection_path === 'users' ? -1 : 1;
        })[0] || null;
      const signatureStoragePath = clean(signatureProfile?.data?.signatureStoragePath);
      if (!signatureProfile || !signatureStoragePath) {
        return json({ error: 'Carga nuevamente tu firma en el perfil antes de completar esta etapa.' }, 422);
      }
      signature = {
        signatureStoragePath,
        ...(clean(signatureProfile.data.signatureUrl) ? { signatureUrl: clean(signatureProfile.data.signatureUrl) } : {}),
        signerUserId: authUser.id,
        ...(signatureProfile.collection_path === 'team_members' ? { signerMemberId: signatureProfile.doc_id } : {}),
        name: actorName,
        email: normalize(authUser.email),
        jobTitle: clean(
          actorTeamProfile?.data?.roleName || actorTeamProfile?.data?.position || actorTeamProfile?.data?.jobTitle ||
          canonicalUserProfile?.data?.jobTitle || 'Sin cargo configurado'
        ),
        signedAt: new Date().toISOString(),
      };
    }

    const accountingReference = clean(body.accountingReference);
    if (action === 'account' && !accountingReference) {
      return json({ error: 'Ingresa la referencia contable antes de contabilizar la cuenta.' }, 422);
    }

    let paymentSupport: Record<string, any> | null = null;
    if (action === 'pay') {
      const requestedSupport = asObject(body.paymentSupport);
      const documentId = clean(requestedSupport.documentId);
      const documentRow = documentId
        ? await getDocumentRow(supabase, `projects/${projectId}/documents`, documentId)
        : null;
      const document = documentRow?.data || {};
      const uploaderAliases = uniqueAliases([document.uploadedBy]);
      if (
        !documentRow ||
        clean(document.projectId) !== projectId ||
        clean(document.contractorAccountId) !== accountId ||
        clean(document.contractorAccountDocumentKind) !== 'paymentSupport' ||
        clean(document.documentContext) !== 'contractorAccountPayment' ||
        clean(document.administrativeRequestType) !== 'contractorAccount' ||
        clean(document.itemKind) !== 'file' ||
        clean(document.storagePath) === '' ||
        uploaderAliases.length === 0 ||
        !aliasesIntersect(actorAliases, uploaderAliases)
      ) {
        return json({ error: 'El soporte de pago no pertenece a esta cuenta o no fue cargado por el responsable actual.' }, 422);
      }
      paymentSupport = {
        kind: 'paymentSupport',
        label: 'Soporte de pago de cuenta de cobro',
        documentId: documentRow.doc_id,
        fileName: clean(document.fileName || document.name),
        fileSize: Number(document.fileSize || 0),
        fileUrl: clean(document.downloadURL || document.url),
        storagePath: clean(document.storagePath),
        uploadedAt: document.uploadedAt || document.createdAt || new Date().toISOString(),
        uploadedBy: authUser.id,
        uploadedByName: actorName,
      };
    }

    const actor = {
      id: authUser.id,
      email: normalize(authUser.email),
      name: actorName,
      aliases: actorAliases,
      expectedApproverId: clean(account.currentApproverId || configuredCurrentOwnerId) || null,
    };
    const { data: rpcData, error: rpcError } = await supabase.rpc('app_apply_contractor_account_action', {
      p_project_id: projectId,
      p_account_id: accountId,
      p_action: action,
      p_operation_id: operationId,
      p_expected_status: expectedStatus,
      p_expected_stage: expectedStage,
      p_expected_assignment_event_id: expectedAssignmentEventId || null,
      p_organization_id: organizationId || null,
      p_expected_project_config: asObject(projectRow.data?.contractorAccountApprovalConfig),
      p_expected_organization_config: asObject(organizationRow?.data?.contractorAccountApprovalConfig),
      p_actor: actor,
      p_is_global_admin: isGlobalAdmin,
      p_current_owner_aliases: currentOwnerAliases,
      p_next_assignment: nextAssignment,
      p_comment: comment,
      p_signature: signature,
      p_accounting_reference: action === 'account' ? accountingReference : null,
      p_accounting_note: action === 'account' ? clean(body.accountingNote) : null,
      p_payment_support: paymentSupport,
    });
    if (rpcError) throw rpcError;

    const result = asObject(rpcData);
    if (result.applied !== true) {
      const reason = clean(result.reason);
      if (reason === 'forbidden') return json({ error: 'Esta cuenta ya no está asignada a tu usuario.' }, 403);
      if (reason === 'not_found' || reason === 'project_not_found') return json({ error: 'Cuenta de cobro o proyecto no encontrado.' }, 404);
      if (reason === 'missing_responsible') return json({ error: 'La siguiente etapa no tiene un responsable válido.' }, 422);
      if (reason === 'missing_signature') return json({ error: 'La firma del perfil autenticado no está disponible.' }, 422);
      if (reason === 'missing_accounting_reference') return json({ error: 'La referencia contable es obligatoria.' }, 422);
      if (reason === 'missing_payment_support') return json({ error: 'El soporte de pago es obligatorio.' }, 422);
      if (reason === 'invalid_payment_support') return json({ error: 'El soporte de pago ya no es válido para esta cuenta.' }, 422);
      if (reason === 'missing_comment') return json({ error: 'La observación es obligatoria.' }, 422);
      if (reason === 'invalid_return_assignee') return json({ error: 'No se pudo confirmar al contratista que recibirá la devolución.' }, 422);
      if (reason === 'invalid_returned_stage') return json({ error: 'La devolución no conserva un paso de origen válido y requiere revisión administrativa.' }, 422);
      if (reason === 'operation_conflict') return json({ error: 'La misma operación ya fue utilizada con datos diferentes.' }, 409);
      if (reason === 'operation_in_progress') return json({ error: 'La operación aún se está procesando. Espera un momento y actualiza la vista.', retryable: true }, 409);
      const stale = ['stale_account', 'stale_config', 'stale_organization', 'invalid_assignment'].includes(reason);
      return json({
        error: stale
          ? 'La cuenta cambió mientras la revisabas. Actualiza la vista e inténtalo de nuevo.'
          : 'La acción ya no corresponde al estado actual de la cuenta.',
        retryable: stale,
      }, 409);
    }

    let notification: Record<string, any> | null = null;
    let notificationError: string | null = null;
    if (result.assignment?.assigneeId) {
      try {
        notification = await postAssignmentNotification(request, bearerToken, result.assignment);
      } catch (error) {
        notificationError = error instanceof Error ? error.message : 'No se pudo enviar la notificación.';
        console.error('Contractor account action notification failed:', error);
      }
    }

    return json({
      ok: true,
      status: result.status,
      assignment: result.assignment || null,
      notification,
      notificationError,
    });
  } catch (error: any) {
    console.error('Error applying contractor account action:', error);
    return json({ error: error?.message || 'No fue posible actualizar la cuenta de cobro.' }, workspaceErrorStatus(error));
  }
}
