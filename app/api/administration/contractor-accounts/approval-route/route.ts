import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getBootstrapAdminEmailSet } from '@/lib/bootstrap-admins';
import { getOrganizationIds } from '@/lib/organizations';
import { normalizeRolePermissions, resolveRolePermissions } from '@/lib/permissions';
import {
  CONTRACTOR_ACCOUNT_STAGE_LABELS,
  CONTRACTOR_ACCOUNT_STATUS_CONFIG_KEYS,
  normalizeContractorAccountApprovalConfig,
  resolveContractorAccountApprovalConfig,
  type ContractorAccountStatus,
} from '@/lib/contractor-account-workflow';

export const runtime = 'nodejs';
export const maxDuration = 60;

const DOCUMENTS_TABLE = 'app_documents';
const PAGE_SIZE = 1000;
const ADMIN_EMAILS = getBootstrapAdminEmailSet();
const OPERATION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{7,119}$/;

type AppDocumentRow = {
  collection_path: string;
  doc_id: string;
  data: Record<string, any>;
};

type RouteScope = 'project' | 'organization';

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
const normalize = (value: unknown) => String(value || '').trim().toLowerCase();
const clean = (value: unknown) => String(value || '').trim();
const asObject = (value: unknown) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
);

const getBearerToken = (request: NextRequest) => {
  const [scheme, token] = (request.headers.get('authorization') || '').split(' ');
  return scheme?.toLowerCase() === 'bearer' ? token : '';
};

const getAdminClient = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('Falta configurar Supabase en el servidor.');
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
};

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

const listDocuments = async (supabase: any, collectionPaths: string[]) => {
  const rows: AppDocumentRow[] = [];
  if (collectionPaths.length === 0) return rows;
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(DOCUMENTS_TABLE)
      .select('collection_path,doc_id,data')
      .in('collection_path', collectionPaths)
      .order('collection_path', { ascending: true })
      .order('doc_id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data || []) as AppDocumentRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
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

const isGlobalAdminCandidate = (data: Record<string, any>) => [
  data.role,
  data.userRole,
  data.systemRole,
  data.profileRole,
  data.position,
  data.cargo,
].map(normalize).some((value) => (
  value === 'admin' ||
  value === 'administrador global' ||
  value === 'global_admin' ||
  value === 'global-admin' ||
  value.includes('administrador global')
));

const resolveDirectoryPerson = (
  configuredId: string,
  directoryRows: AppDocumentRow[],
): DirectoryPerson | null => {
  const wanted = normalize(configuredId);
  if (!wanted) return null;
  const directMatches = directoryRows.filter((row) => rowAliases(row).includes(wanted));
  if (directMatches.length === 0) return null;

  const teamRow = directMatches.find((row) => row.collection_path === 'team_members') ||
    directoryRows.find((row) => row.collection_path === 'team_members' && directMatches.some((match) => rowsShareAlias(row, match))) ||
    null;
  const userRow = directMatches.find((row) => row.collection_path === 'users') ||
    directoryRows.find((row) => row.collection_path === 'users' && directMatches.some((match) => rowsShareAlias(row, match))) ||
    (teamRow
      ? directoryRows.find((row) => row.collection_path === 'users' && rowsShareAlias(row, teamRow))
      : null) ||
    null;
  const primary = teamRow || userRow || directMatches[0];
  const aliases = Array.from(new Set([
    configuredId,
    ...(teamRow ? rowAliases(teamRow) : []),
    ...(userRow ? rowAliases(userRow) : []),
  ].map(normalize).filter(Boolean)));
  const memberId = clean(teamRow?.doc_id || teamRow?.data?.id || configuredId);
  const authUserId = clean(
    teamRow?.data?.authUserId || teamRow?.data?.userId || teamRow?.data?.uid || userRow?.doc_id
  ) || null;
  const email = clean(teamRow?.data?.email || userRow?.data?.email || primary.data?.email).toLowerCase() || null;
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

const actorProfiles = (rows: AppDocumentRow[], userId: string, email: string) => rows.filter((row) => (
  rowAliases(row).includes(normalize(userId)) || rowAliases(row).includes(normalize(email))
));

const actorIdentitySet = (profiles: AppDocumentRow[], userId: string, email: string) => new Set([
  normalize(userId),
  normalize(email),
  ...profiles.flatMap(rowAliases),
].filter(Boolean));

const projectMemberValues = (project: Record<string, any>) => [
  project.ownerId,
  ...(Array.isArray(project.assignedUsers) ? project.assignedUsers : []),
  ...(Array.isArray(project.assignedTeamMembers) ? project.assignedTeamMembers : []),
  ...(Array.isArray(project.assignedEmails) ? project.assignedEmails : []),
].map(normalize).filter(Boolean);

const personCanServeScope = (
  person: DirectoryPerson,
  scope: RouteScope,
  targetId: string,
  projects: AppDocumentRow[],
) => {
  if (isGlobalAdminCandidate(person.data)) return true;
  const personOrganizations = new Set(getOrganizationIds(person.data));
  if (scope === 'organization') return personOrganizations.has(targetId);
  const project = projects[0]?.data || {};
  if (getOrganizationIds(project).some((id) => personOrganizations.has(id))) return true;
  const aliases = new Set(person.aliases);
  return projectMemberValues(project).some((value) => aliases.has(value));
};

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
      source: 'contractor_account_route_updated',
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || `No se pudo notificar la cuenta ${assignment.accountId}.`);
  if (body?.skipped && !['duplicate_event', 'stale_contractor_account_assignment'].includes(String(body.reason || ''))) {
    throw new Error(`La notificación de la cuenta ${assignment.accountId} fue omitida.`);
  }
};

export async function POST(request: NextRequest) {
  try {
    const supabase = getAdminClient();
    const bearerToken = getBearerToken(request);
    const { data: authData, error: authError } = await supabase.auth.getUser(bearerToken);
    const authUser = authData?.user;
    if (authError || !authUser?.id || !authUser.email) {
      return json({ error: 'Sesión inválida.' }, 401);
    }

    const payload = await request.json();
    const scope = payload.scope === 'organization' ? 'organization' : payload.scope === 'project' ? 'project' : null;
    const targetId = clean(payload.targetId);
    const operationId = clean(payload.operationId);
    const nextConfig = normalizeContractorAccountApprovalConfig(payload.nextConfig);
    if (!scope || !targetId || !OPERATION_ID_PATTERN.test(operationId)) {
      return json({ error: 'La solicitud para actualizar la ruta está incompleta.' }, 400);
    }

    const [targetRow, permissionRow, directoryRows, projectRows] = await Promise.all([
      getDocumentRow(supabase, scope === 'project' ? 'projects' : 'organizations', targetId),
      getDocumentRow(supabase, 'settings', 'rolePermissions'),
      listDocuments(supabase, ['team_members', 'users']),
      listDocuments(supabase, ['projects']),
    ]);
    if (!targetRow) return json({ error: scope === 'project' ? 'Proyecto no encontrado.' : 'Organización no encontrada.' }, 404);

    const email = normalize(authUser.email);
    const profiles = actorProfiles(directoryRows, authUser.id, email);
    const exactUserProfile = profiles.find((row) => row.collection_path === 'users' && row.doc_id === authUser.id) ||
      profiles.find((row) => row.collection_path === 'users' && normalize(row.data?.authUserId) === normalize(authUser.id)) ||
      profiles.find((row) => row.collection_path === 'users' && normalize(row.data?.email) === email);
    const exactTeamProfile = profiles.find((row) => row.collection_path === 'team_members' && normalize(row.data?.authUserId) === normalize(authUser.id)) ||
      profiles.find((row) => row.collection_path === 'team_members' && normalize(row.data?.email) === email);
    const actorData = { ...exactTeamProfile?.data, ...exactUserProfile?.data };
    const role = normalize(
      exactUserProfile?.data?.role || exactUserProfile?.data?.systemRole || exactUserProfile?.data?.userRole ||
      exactTeamProfile?.data?.systemRole || exactTeamProfile?.data?.userRole || exactTeamProfile?.data?.role ||
      'user'
    );
    const isGlobalAdmin = ADMIN_EMAILS.has(email) || role === 'admin';
    const normalizedPermissionConfig = normalizeRolePermissions(permissionRow?.data);
    const permissions = resolveRolePermissions(normalizedPermissionConfig, role);
    const identities = actorIdentitySet(profiles, authUser.id, email);
    const actorOrganizations = new Set(profiles.flatMap((profile) => getOrganizationIds(profile.data)));

    const projects = scope === 'project'
      ? projectRows.filter((row) => row.doc_id === targetId)
      : projectRows.filter((row) => getOrganizationIds(row.data)[0] === targetId);
    if (scope === 'project' && projects.length !== 1) {
      return json({ error: 'El proyecto cambió mientras se preparaba la ruta. Intenta nuevamente.', retryable: true }, 409);
    }
    const targetOrganizations = scope === 'project' ? getOrganizationIds(targetRow.data) : [targetId];
    const isProjectMember = scope === 'project' && projectMemberValues(targetRow.data).some((value) => identities.has(value));
    const sharesOrganization = targetOrganizations.some((id) => actorOrganizations.has(id));
    if (!isGlobalAdmin && (!permissions.orgChartManage || (!sharesOrganization && !isProjectMember))) {
      return json({ error: 'No tienes permiso para modificar esta ruta de aprobación.' }, 403);
    }

    const organizationRows = await listDocuments(supabase, ['organizations']);
    const organizationsById = new Map(organizationRows.map((row) => [row.doc_id, row]));
    const selectedPeople = new Map<string, DirectoryPerson>();
    for (const approverId of Object.values(nextConfig).filter(Boolean)) {
      const person = resolveDirectoryPerson(approverId, directoryRows);
      if (!person) {
        return json({ error: `El responsable seleccionado (${approverId}) ya no existe.` }, 422);
      }
      const personStatus = normalize(person.data.status || person.data.userStatus);
      if (person.data.isActive === false || ['inactive', 'disabled', 'archived', 'inactivo'].includes(personStatus)) {
        return json({ error: `${person.displayName} está inactivo y no puede recibir cuentas de cobro.` }, 422);
      }
      if (!person.email) {
        return json({ error: `${person.displayName} no tiene correo y no puede recibir la tarea ni sus alertas.` }, 422);
      }
      if (!personCanServeScope(person, scope, targetId, projects)) {
        return json({ error: `${person.displayName} no pertenece al ámbito de esta ruta de aprobación.` }, 422);
      }
      selectedPeople.set(normalize(approverId), person);
    }

    let effectiveRouteError = '';
    const projectPlans = projects.map((projectRow) => {
      const organizationId = getOrganizationIds(projectRow.data)[0] || '';
      const organizationConfig = organizationsById.get(organizationId)?.data?.contractorAccountApprovalConfig;
      const previousEffectiveConfig = resolveContractorAccountApprovalConfig(
        projectRow.data.contractorAccountApprovalConfig,
        organizationConfig,
      );
      const nextEffectiveConfig = scope === 'project'
        ? resolveContractorAccountApprovalConfig(nextConfig, organizationConfig)
        : resolveContractorAccountApprovalConfig(projectRow.data.contractorAccountApprovalConfig, nextConfig);
      const stages = Object.entries(CONTRACTOR_ACCOUNT_STATUS_CONFIG_KEYS).map(([status, configKey]) => {
        const previousApproverId = clean(previousEffectiveConfig[configKey]);
        const previousPerson = previousApproverId
          ? resolveDirectoryPerson(previousApproverId, directoryRows)
          : null;
        const nextApproverId = clean(nextEffectiveConfig[configKey]);
        const nextPerson = nextApproverId
          ? selectedPeople.get(normalize(nextApproverId)) || resolveDirectoryPerson(nextApproverId, directoryRows)
          : null;
        if (nextApproverId && !nextPerson && !effectiveRouteError) {
          effectiveRouteError = `El responsable configurado para ${CONTRACTOR_ACCOUNT_STAGE_LABELS[status as ContractorAccountStatus] || status} ya no existe.`;
        } else if (nextApproverId && nextPerson && !nextPerson.email && !effectiveRouteError) {
          effectiveRouteError = `${nextPerson.displayName} no tiene correo y no puede recibir la tarea de ${CONTRACTOR_ACCOUNT_STAGE_LABELS[status as ContractorAccountStatus] || status}.`;
        } else if (nextApproverId && nextPerson && !effectiveRouteError) {
          const nextPersonRole = normalize(
            nextPerson.data.role || nextPerson.data.systemRole || nextPerson.data.userRole || 'user'
          );
          const nextPersonCanOpenAdministration =
            ADMIN_EMAILS.has(normalize(nextPerson.email)) ||
            isGlobalAdminCandidate(nextPerson.data) ||
            resolveRolePermissions(normalizedPermissionConfig, nextPersonRole).administrationProjectView;
          if (!nextPersonCanOpenAdministration) {
            effectiveRouteError = `${nextPerson.displayName} no tiene permiso para abrir el módulo administrativo. Activa “Ver anticipos y costos del proyecto” para su rol antes de asignarle este paso.`;
          }
        }
        return {
          status,
          configKey,
          previousApproverId: previousApproverId || null,
          previousApproverMemberId: previousPerson?.memberId || previousApproverId || null,
          previousApproverAuthUserId: previousPerson?.authUserId || null,
          previousApproverEmail: previousPerson?.email || null,
          previousApproverName: previousPerson?.displayName || previousApproverId || null,
          previousApproverAliases: previousPerson?.aliases || (previousApproverId ? [normalize(previousApproverId)] : []),
          nextApproverId: nextApproverId || null,
          nextApproverMemberId: nextPerson?.memberId || nextApproverId || null,
          nextApproverAuthUserId: nextPerson?.authUserId || null,
          nextApproverEmail: nextPerson?.email || null,
          nextApproverName: nextPerson?.displayName || nextApproverId || null,
          nextApproverLabel: CONTRACTOR_ACCOUNT_STAGE_LABELS[status as ContractorAccountStatus] || status,
          nextApproverAliases: nextPerson?.aliases || (nextApproverId ? [normalize(nextApproverId)] : []),
        };
      });
      return {
        projectId: projectRow.doc_id,
        expectedProjectConfig: asObject(projectRow.data.contractorAccountApprovalConfig),
        stages,
      };
    });
    if (effectiveRouteError) return json({ error: effectiveRouteError }, 422);

    const targetPatch = scope === 'project'
      ? {
          contractorAccountApprovalConfigSource: Object.values(nextConfig).some(Boolean) ? 'project' : 'organization',
        }
      : {
          name: clean(payload.organizationName) || clean(targetRow.data.name),
        };
    const actor = {
      id: authUser.id,
      email: authUser.email,
      name: clean(actorData.displayName || actorData.name || authUser.email),
    };

    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      'app_update_contractor_account_approval_route',
      {
        p_scope: scope,
        p_target_id: targetId,
        p_expected_config: asObject(targetRow.data.contractorAccountApprovalConfig),
        p_next_config: nextConfig,
        p_target_patch: targetPatch,
        p_project_plans: projectPlans,
        p_actor: actor,
        p_operation_id: operationId,
      }
    );
    if (rpcError) throw rpcError;

    const result = asObject(rpcResult);
    if (result.applied !== true) {
      const reason = clean(result.reason);
      if (reason === 'missing_responsible') {
        return json({
          error: `No puedes dejar ${result.stageLabel || result.status || 'el paso actual'} sin responsable porque tiene cuentas activas.`,
          retryable: false,
        }, 422);
      }
      if (['stale_config', 'stale_project_config', 'stale_account'].includes(reason)) {
        return json({ error: 'La ruta o una cuenta cambió al mismo tiempo. Pixel volverá a comprobarla.', retryable: true }, 409);
      }
      if (reason === 'operation_in_progress') {
        return json({ error: 'La misma actualización todavía se está confirmando.', retryable: true }, 409);
      }
      if (reason === 'operation_conflict') {
        return json({ error: 'El identificador de esta actualización ya fue utilizado con otros datos.', retryable: false }, 409);
      }
      if (reason === 'target_not_found') {
        return json({ error: 'El proyecto o la organización ya no existe.', retryable: false }, 404);
      }
      if (reason === 'invalid_request') {
        return json({ error: 'La ruta contiene datos inválidos.', retryable: false }, 400);
      }
      return json({ error: 'No fue posible confirmar la nueva ruta de aprobación.', retryable: false }, 409);
    }

    const assignments = Array.isArray(result.assignments) ? result.assignments : [];
    const notificationResults = await Promise.allSettled(
      assignments.map((assignment) => postAssignmentNotification(request, bearerToken, assignment))
    );
    const notificationFailureCount = notificationResults.filter((entry) => entry.status === 'rejected').length;

    return json({
      reassignedCount: Number(result.reassignedCount || 0),
      concurrentChangeCount: 0,
      reconciliationFailureCount: 0,
      notificationFailureCount,
    });
  } catch (error: any) {
    console.error('Error updating contractor account approval route:', error);
    return json({ error: error?.message || 'No fue posible actualizar la ruta de aprobación.', retryable: true }, 500);
  }
}
