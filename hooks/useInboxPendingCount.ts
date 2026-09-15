"use client"

import { useEffect, useMemo, useState } from 'react';
import { collection, collectionGroup, getDocs, onSnapshot, query, where } from '@/lib/supabase/document-store';
import { db } from '@/lib/backend';
import { useAuth } from '@/hooks/useAuth';
import { canLoadProjectForUser } from '@/lib/project-access';
import { isWorkflowTaskType } from '@/lib/workflow-routing';
import { isScrumInboxEligible } from '@/lib/scrum';
import {
  CONTRACTOR_ACCOUNT_ACTIVE_STATUSES,
  getContractorAccountConfiguredApproverId,
  resolveContractorAccountApprovalConfig,
  type ContractorAccountStatus,
} from '@/lib/contractor-account-workflow';

const terminalStatuses = new Set(['completed', 'completed_late', 'listo']);

const addActorAliases = (target: string[], profile: any, documentId?: string) => {
  [
    documentId,
    profile?.id,
    profile?.authUserId,
    profile?.userId,
    profile?.uid,
    profile?.memberId,
    profile?.email,
  ].forEach((value) => {
    const normalized = String(value || '').trim();
    if (normalized) target.push(normalized);
  });
};

const matchesActor = (candidateValues: unknown[], actorIds: string[]) => {
  const actorKeys = new Set(actorIds.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean));
  return candidateValues.some((value) => actorKeys.has(String(value || '').trim().toLowerCase()));
};

const isAssignedToCurrentUser = (task: any, assignedIds: string[]) => {
  if (task?.assignedTo && assignedIds.includes(task.assignedTo)) return true;
  if (Array.isArray(task?.assignedUsers) && task.assignedUsers.some((id: string) => assignedIds.includes(id))) return true;
  if (Array.isArray(task?.assignedTeamMembers) && task.assignedTeamMembers.some((id: string) => assignedIds.includes(id))) return true;
  return false;
};

const isWorkflowPendingForUser = (task: any, assignedIds: string[]) => {
  if (!isWorkflowTaskType(task?.type) || !Array.isArray(task?.workflowSteps)) return false;
  const currentStep = task.workflowSteps[task.currentStepIndex || 0];
  return Boolean(
    currentStep?.assignedTo &&
    assignedIds.includes(currentStep.assignedTo) &&
    ['en_curso', 'reproceso', 'pending', 'detenido'].includes(currentStep.status)
  );
};

const isTaskPendingForUser = (task: any, assignedIds: string[]) => {
  const status = task?.status || 'todo';
  if (terminalStatuses.has(status)) return false;
  if (isWorkflowTaskType(task?.type) && Array.isArray(task?.workflowSteps)) {
    return isWorkflowPendingForUser(task, assignedIds);
  }
  if (!isScrumInboxEligible(task)) return false;
  return isAssignedToCurrentUser(task, assignedIds);
};

export function useInboxPendingCount(enabled = true) {
  const { user, userRole, userOrganizationId, userOrganizationIds } = useAuth();
  const [count, setCount] = useState(0);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const managedOrganizationIds = useMemo(
    () => (userOrganizationIds.length > 0 ? userOrganizationIds : userOrganizationId ? [userOrganizationId] : []),
    [userOrganizationId, userOrganizationIds]
  );

  useEffect(() => {
    let cancelled = false;

    const loadMemberIds = async () => {
      if (!enabled || !user?.email) {
        setMemberIds([]);
        return;
      }

      const nextIds = [user.uid, user.email].filter(Boolean) as string[];
      const teamQuery = query(collection(db, 'team_members'), where('email', '==', user.email));
      const teamSnapshot = await getDocs(teamQuery);
      teamSnapshot.docs.forEach((teamDoc) => addActorAliases(nextIds, teamDoc.data(), teamDoc.id));

      if (!cancelled) {
        setMemberIds(Array.from(new Set(nextIds)));
      }
    };

    loadMemberIds().catch((error) => {
      console.error('Error loading inbox member ids:', error);
      if (!cancelled) setMemberIds(user?.uid ? [user.uid] : []);
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, user?.email, user?.uid]);

  useEffect(() => {
    if (!enabled || !user || memberIds.length === 0) {
      return;
    }

    let accessibleProjectIds = new Set<string>();
    let projectsById = new Map<string, any>();
    let organizationsById = new Map<string, any>();
    let allTasks: Array<{ projectId: string; task: any }> = [];
    let allContractorAccounts: Array<{ projectId: string; account: any }> = [];

    const updateCount = () => {
      const taskCount = allTasks
        .filter(({ projectId }) => accessibleProjectIds.has(projectId))
        .filter(({ task }) => isTaskPendingForUser(task, memberIds))
        .length;
      const contractorAccountCount = allContractorAccounts
        .filter(({ projectId, account }) => {
          const status = String(account?.status || '') as ContractorAccountStatus;
          if (!CONTRACTOR_ACCOUNT_ACTIVE_STATUSES.includes(status)) return false;
          const persistedOwners = [
            account?.currentApproverId,
            account?.currentApproverMemberId,
            account?.currentApproverAuthUserId,
            account?.currentApproverEmail,
          ].filter((value) => String(value || '').trim());
          const project = projectsById.get(projectId) || {};
          const organizationId = [
            project.organizationId,
            ...(Array.isArray(project.organizationIds) ? project.organizationIds : []),
          ].filter(Boolean)[0];
          const organization = organizationsById.get(String(organizationId || ''));
          const config = resolveContractorAccountApprovalConfig(
            project.contractorAccountApprovalConfig,
            organization?.contractorAccountApprovalConfig
          );
          const fallbackOwners = status === 'returned'
            ? [
                account?.contractorId,
                account?.contractorAuthUserId,
                account?.contractorEmail,
                account?.requesterSignature?.signerUserId,
                account?.requesterSignature?.signerMemberId,
                account?.requesterSignature?.email,
              ]
            : [getContractorAccountConfiguredApproverId(config, status)];
          return matchesActor(persistedOwners.length > 0 ? persistedOwners : fallbackOwners, memberIds);
        })
        .length;
      setCount(taskCount + contractorAccountCount);
    };

    const unsubscribeProjects = onSnapshot(
      query(collection(db, 'projects')),
      (projectSnapshot) => {
        const projects = projectSnapshot.docs.map((projectDoc) => ({ id: projectDoc.id, ...projectDoc.data() }));
        projectsById = new Map(projects.map((project) => [project.id, project]));
        accessibleProjectIds = new Set(projects
          .filter((project) => {
            return canLoadProjectForUser(project, {
              assignedIds: memberIds,
              managedOrganizationIds,
              userId: user.uid,
              userRole,
            });
          })
          .map(project => project.id));
        updateCount();
      },
      (error) => {
        console.error('Error loading inbox projects:', error);
        setCount(0);
      }
    );

    const unsubscribeOrganizations = onSnapshot(
      query(collection(db, 'organizations')),
      (organizationSnapshot) => {
        organizationsById = new Map(
          organizationSnapshot.docs.map((organizationDoc) => [
            organizationDoc.id,
            { id: organizationDoc.id, ...organizationDoc.data() },
          ])
        );
        updateCount();
      },
      (error) => {
        console.error('Error loading organizations for inbox count:', error);
      },
    );

    const unsubscribeTasks = onSnapshot(
      query(collectionGroup(db, 'tasks')),
      (taskSnapshot) => {
        allTasks = taskSnapshot.docs.map((taskDoc) => ({
          projectId: taskDoc.ref.parent.parent?.id || '',
          task: taskDoc.data(),
        }));
        updateCount();
      },
      (error) => {
        console.error('Error loading inbox tasks:', error);
        setCount(0);
      },
    );

    const unsubscribeContractorAccounts = onSnapshot(
      query(collectionGroup(db, 'contractorPaymentRequests')),
      (accountSnapshot) => {
        allContractorAccounts = accountSnapshot.docs.map((accountDoc) => ({
          projectId: accountDoc.ref.parent.parent?.id || '',
          account: accountDoc.data(),
        }));
        updateCount();
      },
      (error) => {
        console.error('Error loading contractor account inbox count:', error);
      },
    );

    return () => {
      unsubscribeProjects();
      unsubscribeOrganizations();
      unsubscribeTasks();
      unsubscribeContractorAccounts();
    };
  }, [enabled, managedOrganizationIds, memberIds, user, userRole]);

  return enabled && user && memberIds.length > 0 ? count : 0;
}
