export type UserReassignmentIdentity = {
  authUserId: string;
  memberId: string;
  memberIds: string[];
  email: string;
  displayName: string;
  photoURL?: string | null;
};

export type UserReassignmentContext = {
  source: UserReassignmentIdentity;
  target: UserReassignmentIdentity;
  changedAt: string;
  actor?: { id: string | null; email: string | null; name?: string | null };
  operationId?: string;
  reason?: string;
  contractorAccountFallbackOwnerMatches?: boolean;
  contractorAccountFallbackOwnerId?: string | null;
};

export type UserReassignmentCounts = {
  documents: number;
  references: number;
  projects: number;
  activeTasks: number;
  workflowSteps: number;
  workflowTemplates: number;
  approvalRoutes: number;
  contractorAccounts: number;
  meetings: number;
  orgChartNodes: number;
};

export type ReassignmentDocument = {
  collection_path: string;
  doc_id: string;
  data: Record<string, any>;
};

export const emptyUserReassignmentCounts = (): UserReassignmentCounts => ({
  documents: 0,
  references: 0,
  projects: 0,
  activeTasks: 0,
  workflowSteps: 0,
  workflowTemplates: 0,
  approvalRoutes: 0,
  contractorAccounts: 0,
  meetings: 0,
  orgChartNodes: 0,
});

const ACTIVE_TASK_STATUSES = new Set(['todo', 'in_progress', 'pending', 'working', 'active']);
const APPROVAL_ROLE_KEYS = [
  'immediateBossId',
  'operationsManagerId',
  'qualityComplianceId',
  'humanTalentId',
  'accountingId',
  'administrationId',
] as const;
const ACTIVE_CONTRACTOR_ACCOUNT_APPROVAL_STATUSES = new Set([
  'submitted',
  'boss_approved',
  'operations_approved',
  'quality_approved',
  'hr_approved',
  'accounted',
  'returned',
]);

const sourceIdSet = (context: UserReassignmentContext) =>
  new Set([
    context.source.authUserId,
    ...context.source.memberIds,
  ].filter(Boolean));

const replaceScalar = (
  value: unknown,
  sourceIds: Set<string>,
  replacement: string,
  counts: UserReassignmentCounts,
) => {
  if (typeof value !== 'string' || !sourceIds.has(value)) {
    return { value, changed: false };
  }

  counts.references += 1;
  return { value: replacement, changed: true };
};

const replaceIdArray = (
  value: unknown,
  sourceIds: Set<string>,
  replacement: string,
  counts: UserReassignmentCounts,
) => {
  if (!Array.isArray(value)) return { value, changed: false };

  let changed = false;
  const replaced = value.map((item) => {
    if (typeof item === 'string' && sourceIds.has(item)) {
      counts.references += 1;
      changed = true;
      return replacement;
    }
    return item;
  });

  if (!changed) return { value, changed: false };

  const seen = new Set<string>();
  const deduplicated = replaced.filter((item) => {
    const key = typeof item === 'string' ? `string:${item}` : `json:${JSON.stringify(item)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { value: deduplicated, changed: true };
};

const replaceEmailArray = (
  value: unknown,
  sourceEmail: string,
  targetEmail: string,
  counts: UserReassignmentCounts,
) => {
  if (!Array.isArray(value) || !sourceEmail) return { value, changed: false };
  let changed = false;
  const replaced = value.map((item) => {
    if (typeof item === 'string' && item.trim().toLowerCase() === sourceEmail) {
      counts.references += 1;
      changed = true;
      return targetEmail;
    }
    return item;
  });

  if (!changed) return { value, changed: false };
  const deduplicated = Array.from(new Set(replaced));
  return { value: deduplicated, changed: true };
};

const isCompletedWorkflowStep = (step: Record<string, any>) => {
  const status = String(step.status || '').trim().toLowerCase();
  return step.completed === true || ['completed', 'completed_late', 'finalized', 'closed'].includes(status);
};

const transformRateBinding = (
  binding: unknown,
  context: UserReassignmentContext,
  counts: UserReassignmentCounts,
) => {
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
    return { value: binding, changed: false };
  }

  const sourceIds = sourceIdSet(context);
  const current = binding as Record<string, any>;
  const assigned = replaceScalar(current.assignedTo, sourceIds, context.target.memberId, counts);
  if (!assigned.changed) return { value: binding, changed: false };

  return {
    value: { ...current, assignedTo: assigned.value },
    changed: true,
  };
};

const transformWorkflowStep = (
  step: unknown,
  context: UserReassignmentContext,
  counts: UserReassignmentCounts,
  preserveCompleted: boolean,
) => {
  if (!step || typeof step !== 'object' || Array.isArray(step)) {
    return { value: step, changed: false };
  }

  const current = step as Record<string, any>;
  if (preserveCompleted && isCompletedWorkflowStep(current)) {
    return { value: step, changed: false };
  }

  const sourceIds = sourceIdSet(context);
  let changed = false;
  const next = { ...current };

  for (const key of ['assignedTo', 'nextStepAssignee'] as const) {
    const result = replaceScalar(current[key], sourceIds, context.target.memberId, counts);
    if (result.changed) {
      next[key] = result.value;
      changed = true;
    }
  }

  if (Array.isArray(current.rateCards)) {
    let rateCardsChanged = false;
    const rateCards = current.rateCards.map((binding: unknown) => {
      const result = transformRateBinding(binding, context, counts);
      rateCardsChanged ||= result.changed;
      return result.value;
    });
    if (rateCardsChanged) {
      next.rateCards = rateCards;
      changed = true;
    }
  }

  const dynamicConfig = transformRateBinding(current.dynamicRateCardConfig, context, counts);
  if (dynamicConfig.changed) {
    next.dynamicRateCardConfig = dynamicConfig.value;
    changed = true;
  }

  if (changed) counts.workflowSteps += 1;
  return { value: changed ? next : step, changed };
};

const transformWorkflowSteps = (
  value: unknown,
  context: UserReassignmentContext,
  counts: UserReassignmentCounts,
  preserveCompleted: boolean,
) => {
  if (!Array.isArray(value)) return { value, changed: false };
  let changed = false;
  const steps = value.map((step) => {
    const result = transformWorkflowStep(step, context, counts, preserveCompleted);
    changed ||= result.changed;
    return result.value;
  });
  return { value: changed ? steps : value, changed };
};

const transformApprovalConfig = (
  value: unknown,
  context: UserReassignmentContext,
  counts: UserReassignmentCounts,
) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { value, changed: false };
  }

  const current = value as Record<string, any>;
  const sourceIds = sourceIdSet(context);
  const next = { ...current };
  let changed = false;

  for (const key of APPROVAL_ROLE_KEYS) {
    const result = replaceScalar(current[key], sourceIds, context.target.memberId, counts);
    if (result.changed) {
      next[key] = result.value;
      counts.approvalRoutes += 1;
      changed = true;
    }
  }

  return { value: changed ? next : value, changed };
};

const transformProject = (
  data: Record<string, any>,
  context: UserReassignmentContext,
  counts: UserReassignmentCounts,
) => {
  const sourceIds = sourceIdSet(context);
  const next = { ...data };
  let changed = false;

  const owner = replaceScalar(data.ownerId, sourceIds, context.target.authUserId, counts);
  if (owner.changed) {
    next.ownerId = owner.value;
    changed = true;
  }

  const assignedUsers = replaceIdArray(data.assignedUsers, sourceIds, context.target.authUserId, counts);
  if (assignedUsers.changed) {
    next.assignedUsers = assignedUsers.value;
    changed = true;
  }

  const assignedMembers = replaceIdArray(data.assignedTeamMembers, sourceIds, context.target.memberId, counts);
  if (assignedMembers.changed) {
    next.assignedTeamMembers = assignedMembers.value;
    changed = true;
  }

  const assignedEmails = replaceEmailArray(
    data.assignedEmails,
    context.source.email,
    context.target.email,
    counts,
  );
  if (assignedEmails.changed) {
    next.assignedEmails = assignedEmails.value;
    changed = true;
  }

  const approvalConfig = transformApprovalConfig(data.contractorAccountApprovalConfig, context, counts);
  if (approvalConfig.changed) {
    next.contractorAccountApprovalConfig = approvalConfig.value;
    changed = true;
  }

  if (changed) counts.projects += 1;
  return { data: changed ? next : data, changed };
};

const transformTask = (
  data: Record<string, any>,
  context: UserReassignmentContext,
  counts: UserReassignmentCounts,
) => {
  const status = String(data.status || '').trim().toLowerCase();
  if (!ACTIVE_TASK_STATUSES.has(status)) return { data, changed: false };

  const sourceIds = sourceIdSet(context);
  const next = { ...data };
  let changed = false;
  let meetingChanged = false;

  const assignedTo = replaceScalar(data.assignedTo, sourceIds, context.target.memberId, counts);
  if (assignedTo.changed) {
    next.assignedTo = assignedTo.value;
    changed = true;
  }

  for (const key of ['assignedUsers', 'assignedTeamMembers', 'meetingParticipantIds', 'meetingPendingParticipantIds'] as const) {
    const result = replaceIdArray(data[key], sourceIds, context.target.memberId, counts);
    if (result.changed) {
      next[key] = result.value;
      if (key.startsWith('meeting')) meetingChanged = true;
      changed = true;
    }
  }

  const workflowSteps = transformWorkflowSteps(data.workflowSteps, context, counts, true);
  if (workflowSteps.changed) {
    next.workflowSteps = workflowSteps.value;
    changed = true;
  }

  if (meetingChanged) counts.meetings += 1;
  if (changed) counts.activeTasks += 1;
  return { data: changed ? next : data, changed };
};

const transformWorkflowTemplate = (
  data: Record<string, any>,
  context: UserReassignmentContext,
  counts: UserReassignmentCounts,
) => {
  const steps = transformWorkflowSteps(data.steps, context, counts, false);
  if (!steps.changed) return { data, changed: false };
  counts.workflowTemplates += 1;
  return { data: { ...data, steps: steps.value }, changed: true };
};

const transformContractorAccount = (
  data: Record<string, any>,
  context: UserReassignmentContext,
  counts: UserReassignmentCounts,
) => {
  const status = String(data.status || '').trim().toLowerCase();
  if (!ACTIVE_CONTRACTOR_ACCOUNT_APPROVAL_STATUSES.has(status)) {
    return { data, changed: false };
  }

  const sourceIds = sourceIdSet(context);
  const sourceEmail = context.source.email.trim().toLowerCase();
  const currentValues = [
    data.currentApproverId,
    data.currentApproverMemberId,
    data.currentApproverAuthUserId,
  ].map((value) => String(value || '').trim());
  const currentEmail = String(data.currentApproverEmail || '').trim().toLowerCase();
  const ownsCurrentStep = currentValues.some((value) => sourceIds.has(value)) ||
    Boolean(sourceEmail && currentEmail === sourceEmail) ||
    context.contractorAccountFallbackOwnerMatches === true;
  if (!ownsCurrentStep) return { data, changed: false };

  counts.references += currentValues.filter((value) => sourceIds.has(value)).length +
    (sourceEmail && currentEmail === sourceEmail ? 1 : 0) +
    (context.contractorAccountFallbackOwnerMatches ? 1 : 0);
  counts.contractorAccounts += 1;
  const history = Array.isArray(data.approvalRouteReassignmentHistory)
    ? data.approvalRouteReassignmentHistory
    : [];
  const assignmentEventId = `user-reassignment-${context.changedAt}-${context.target.authUserId}`;

  return {
    changed: true,
    data: {
      ...data,
      currentApproverId: context.target.memberId,
      currentApproverMemberId: context.target.memberId,
      currentApproverAuthUserId: context.target.authUserId,
      currentApproverEmail: context.target.email,
      currentAssignmentEventId: assignmentEventId,
      ...(status === 'returned' ? {
        correctionAssigneeId: context.target.memberId,
        correctionAssigneeMemberId: context.target.memberId,
        correctionAssigneeAuthUserId: context.target.authUserId,
        correctionAssigneeEmail: context.target.email,
      } : {}),
      approvalRouteReassignmentHistory: [
        ...history,
        {
          stage: status,
          configKey: 'userReassignment',
          scope: 'user_reassignment',
          operationId: context.operationId || null,
          reason: context.reason || null,
          fromApproverId: data.currentApproverId || context.contractorAccountFallbackOwnerId || context.source.memberId,
          fromApproverName: context.source.displayName,
          fromApproverEmail: data.currentApproverEmail || context.source.email,
          toApproverId: context.target.memberId,
          toApproverName: context.target.displayName,
          toApproverEmail: context.target.email,
          actorId: context.actor?.id || null,
          actorName: context.actor?.name || context.actor?.email || 'Reasignación integral de usuario',
          actorEmail: context.actor?.email || null,
          at: context.changedAt,
        },
      ],
    },
  };
};

const transformOrgChart = (
  data: Record<string, any>,
  context: UserReassignmentContext,
  counts: UserReassignmentCounts,
) => {
  if (!Array.isArray(data.nodes)) return { data, changed: false };
  const sourceIds = sourceIdSet(context);
  let changed = false;

  const nodes = data.nodes.map((node: unknown) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
    const currentNode = node as Record<string, any>;
    const nodeData = currentNode.data;
    if (!nodeData || typeof nodeData !== 'object' || Array.isArray(nodeData)) return node;
    if (!sourceIds.has(String(nodeData.memberId || ''))) return node;

    counts.references += 1;
    counts.orgChartNodes += 1;
    changed = true;
    return {
      ...currentNode,
      data: {
        ...nodeData,
        memberId: context.target.memberId,
        member: context.target.displayName,
        photoURL: context.target.photoURL || null,
      },
    };
  });

  return { data: changed ? { ...data, nodes } : data, changed };
};

export const transformUserReassignmentDocument = (
  document: ReassignmentDocument,
  context: UserReassignmentContext,
) => {
  const counts = emptyUserReassignmentCounts();
  const { collection_path: collectionPath, data } = document;
  let transformed = { data, changed: false };

  if (collectionPath === 'projects') {
    transformed = transformProject(data, context, counts);
  } else if (collectionPath === 'organizations') {
    const approvalConfig = transformApprovalConfig(data.contractorAccountApprovalConfig, context, counts);
    transformed = approvalConfig.changed
      ? { data: { ...data, contractorAccountApprovalConfig: approvalConfig.value }, changed: true }
      : { data, changed: false };
  } else if (collectionPath === 'workflow_templates') {
    transformed = transformWorkflowTemplate(data, context, counts);
  } else if (/^projects\/[^/]+\/tasks$/.test(collectionPath)) {
    transformed = transformTask(data, context, counts);
  } else if (/^projects\/[^/]+\/contractorPaymentRequests$/.test(collectionPath)) {
    transformed = transformContractorAccount(data, context, counts);
  } else if (/^projects\/[^/]+\/orgChart$/.test(collectionPath)) {
    transformed = transformOrgChart(data, context, counts);
  }

  if (!transformed.changed) {
    return { ...document, changed: false, counts };
  }

  counts.documents = 1;
  return {
    ...document,
    changed: true,
    counts,
    data: {
      ...transformed.data,
      updatedAt: context.changedAt,
    },
  };
};

export const mergeUserReassignmentCounts = (
  target: UserReassignmentCounts,
  source: UserReassignmentCounts,
) => {
  (Object.keys(target) as Array<keyof UserReassignmentCounts>).forEach((key) => {
    target[key] += source[key];
  });
  return target;
};

export const projectIdFromReassignmentDocument = (document: ReassignmentDocument) => {
  if (document.collection_path === 'projects') return document.doc_id;
  const match = document.collection_path.match(/^projects\/([^/]+)\//);
  return match?.[1] || null;
};
