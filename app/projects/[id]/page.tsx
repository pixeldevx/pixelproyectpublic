"use client"

import React, { useState, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, Upload, File, FileText, Download, Trash2, Clock, AlertCircle, Folder, Users, Plus, X, Calendar, CreditCard, RefreshCw, Loader2, Search, ClipboardList, DollarSign, Link2, ShieldCheck, BookOpen, BarChart3, Package, Map as MapIcon, BriefcaseBusiness, Code2 } from 'lucide-react';
import { doc, getDoc, collection, query, where, onSnapshot, addDoc, deleteDoc, serverTimestamp, updateDoc, setDoc, arrayUnion, arrayRemove, orderBy, writeBatch, getDocs, Timestamp } from '@/lib/supabase/document-store';
import { ref, uploadBytes, getDownloadURL, deleteObject } from '@/lib/supabase/storage-shim';
import { db, storage } from '@/lib/backend';
import { isBootstrapAdminEmail } from '@/lib/bootstrap-admins';
import { useAuth } from '@/hooks/useAuth';
import { useRolePermissions } from '@/hooks/useRolePermissions';
import Link from 'next/link';
import { ProjectRateCards } from '@/components/projects/ProjectRateCards';
import { ProjectBudget } from '@/components/projects/ProjectBudget';
import ProjectBilling from '@/components/projects/ProjectBilling';
import { ProjectGantt } from '@/components/projects/ProjectGantt';
import { ProjectDocumentsTree } from '@/components/projects/ProjectDocumentsTree';
import { ProjectDocumentViewer } from '@/components/projects/ProjectDocumentViewer';
import { ProjectDriveRepositories } from '@/components/projects/ProjectDriveRepositories';
import { ProjectInventory } from '@/components/projects/ProjectInventory';
import { ProjectSpatialMap } from '@/components/projects/ProjectSpatialMap';
import { ProjectAdministration } from '@/components/projects/ProjectAdministration';
import { ProjectQuality } from '@/components/projects/ProjectQuality';
import { ProjectLogbook } from '@/components/projects/ProjectLogbook';
import { ProjectScrum } from '@/components/projects/ProjectScrum';
import { TaskDetailsModal } from '@/components/projects/TaskDetailsModal';
import { TaskCommentsModal } from '@/components/projects/TaskCommentsModal';
import { TaskStatusReportModal } from '@/components/projects/TaskStatusReportModal';
import { StartWorkflowModal } from '@/components/projects/StartWorkflowModal';
import { CreateTaskModal } from '@/components/projects/modals/CreateTaskModal';
import { BulkWorkflowIterationsModal } from '@/components/projects/modals/BulkWorkflowIterationsModal';
import { EditTaskStructureModal } from '@/components/projects/modals/EditTaskStructureModal';
import { IncrementTaskValueModal } from '@/components/projects/modals/IncrementTaskValueModal';
import { UploadDocumentModal } from '@/components/projects/modals/UploadDocumentModal';
import { AssignMemberModal } from '@/components/projects/modals/AssignMemberModal';
import { RemoveMemberModal } from '@/components/projects/modals/RemoveMemberModal';
import { CompleteTaskModal } from '@/components/projects/modals/CompleteTaskModal';
import { CompleteSubtaskFormModal, SubtaskCompletionSubmission } from '@/components/projects/modals/CompleteSubtaskFormModal';
import { CustomForm } from '@/components/projects/WorkflowStepFormBuilderModal';
import { ProjectOrgChart } from '@/components/projects/ProjectOrgChart';
import { handleDataError, OperationType } from '@/lib/backend-utils';
import { toast } from 'sonner';
import Image from 'next/image';
import { belongsToAnyOrganization, getOrganizationIds } from '@/lib/organizations';
import {
  getCompletionStatusForTask,
  getProgressForTaskStatus,
  getRemainingScheduleDays,
  getResumedDueDate,
  getTaskDateValue,
  isCompletedTaskStatus,
} from '@/lib/taskProgress';
import { notifyTaskAssignment } from '@/lib/notifications';
import {
  getStaticRateCardAssignee,
  getStaticRateCardSources,
  isInvalidRateCardUnits,
  normalizeRateCardUnits,
} from '@/lib/rate-card-config';
import {
  getIncrementalRateBinding,
  isRateDrivenIncrementalTask,
  syncRateDrivenIncrementalTasksForRate,
} from '@/lib/incremental-rate-tasks';
import { sanitizeTaskTitleForSave } from '@/lib/task-title';
import {
  applyWorkflowStepReferenceDurations,
  applyWorkflowStepSchedule,
  getWorkflowTotalPlannedDays,
  normalizeWorkflowDayCountingEnabled,
  normalizeWorkflowScheduleMode,
} from '@/lib/workflow-schedule';
import { isDynamicWorkflowAssignee, isWorkflowTaskType } from '@/lib/workflow-routing';
import { addTraceableRateCardMovementToBatch } from '@/lib/rate-card-trace';
import { isScrumTask, isSoftwareProject } from '@/lib/scrum';

const getTaskTitle = (task: any) => task?.title || task?.name || 'Tarea';
const DEFAULT_TASK_GROUP_ID = '__ungrouped__';
const DEFAULT_TASK_GROUP_NAME = 'Sin grupo';
const DEFAULT_TASK_GROUP_COLOR = '#94a3b8';
const PROJECT_BUDGET_ACCESS_ROLES = new Set(['admin', 'org_admin', 'manager', 'coordinador']);
const DELETE_TASK_CHUNK_SIZE = 6;
const DELETE_RATE_REVERSAL_CHUNK_SIZE = 8;

type TaskDeleteMode = 'single' | 'bulk' | 'tree';

type TaskDeleteRequest = {
  ids: string[];
  title: string;
  isBulk?: boolean;
  mode?: TaskDeleteMode;
  dependentHint?: number;
};

type DeletionProgress = {
  stage: string;
  processed: number;
  total: number;
  detail?: string;
};

const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0));

const toDateInputValue = (value: any) => {
  const date = getTaskDateValue(value);
  if (!date) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseDateInputValue = (value: string) => {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toTraceableDate = (value: any) => {
  const date = getTaskDateValue(value);
  return date ? date.toISOString().slice(0, 10) : null;
};

const stripWorkflowStepRuntime = (step: any = {}) => {
  const nextStep = { ...step };
  [
    'status',
    'completed',
    'completedAt',
    'completedBy',
    'startedAt',
    'startedBy',
    'formData',
    'returnedAt',
    'returnedBy',
    'stoppedAt',
    'stoppedBy',
    'resumedAt',
    'resumedBy',
  ].forEach((key) => {
    delete nextStep[key];
  });
  return nextStep;
};

const taskReceivesWorkflowStructure = (task: any) =>
  isWorkflowTaskType(task?.type) || Array.isArray(task?.workflowSteps);

const workflowStepHasRuntime = (step: any = {}) => {
  const status = String(step.status || '').toLowerCase();
  const hasExecutedStatus = status && !['not_started', 'no iniciado', 'todo', 'pending', 'pendiente'].includes(status);

  return Boolean(
    hasExecutedStatus ||
      step.startedAt ||
      step.startedBy ||
      step.startedByMemberId ||
      step.completedAt ||
      step.completedBy ||
      step.completedByMemberId ||
      step.returnedAt ||
      step.returnedBy ||
      step.restartedAt ||
      step.formData
  );
};

const mergeWorkflowStepStructure = (currentStep: any = {}, structuralStep: any = {}, index: number) => {
  const currentAssignedTo = currentStep.assignedTo;
  const shouldPreserveResolvedAssignee =
    workflowStepHasRuntime(currentStep) &&
    currentAssignedTo &&
    !isDynamicWorkflowAssignee(currentAssignedTo);

  return {
    ...currentStep,
    ...stripWorkflowStepRuntime(structuralStep),
    label: structuralStep.label || currentStep.label || `Paso ${index + 1}`,
    status: currentStep.status || 'not_started',
    assignedTo: shouldPreserveResolvedAssignee
      ? currentAssignedTo
      : structuralStep.assignedTo ?? currentStep.assignedTo,
  };
};

const resetWorkflowStepRuntime = (step: any = {}) => ({
  ...stripWorkflowStepRuntime(step),
  status: 'not_started',
  completed: false,
});

const normalizeCompletedTaskStatus = (status: string, task: any) => {
  return getCompletionStatusForTask(status, task);
};

const isWorkflowManualCompletionStatus = (status: string) =>
  status === 'completed' || status === 'completed_late' || status === 'listo';

const isDynamicRateCardEnabled = (source: any) =>
  Boolean(source?.dynamicRateCard || source?.rateCardMode === 'dynamic' || source?.dynamicRateCardConfig);

const isManualStaticRateCardEnabled = (source: any) =>
  Boolean(source?.isRateCardTask && source?.rateCardId && source?.autoAddUnits === false && !isDynamicRateCardEnabled(source));

const getTaskCompletionForm = (task: any): CustomForm | null =>
  task?.completionForm || task?.subtaskCompletionForm || null;

const taskHasCompletionForm = (task: any) => {
  const form = getTaskCompletionForm(task);
  if (!form) return false;

  return Boolean(
    (Array.isArray(form.fields) && form.fields.length > 0) ||
    (Array.isArray(form.rateCards) && form.rateCards.length > 0) ||
    form.rateCardId ||
    form.dynamicRateCard ||
    form.rateCardMode === 'dynamic' ||
    form.dynamicRateCardConfig
  );
};

const taskShouldAskCompletionForm = (task: any) =>
  Boolean(task?.parentTaskId && taskHasCompletionForm(task));

const getDynamicRateCardUnits = (source: any) =>
  normalizeRateCardUnits(source?.dynamicRateCardConfig?.defaultUnits ?? source?.unitsToAdd);

const shouldRequestDynamicRateCardUnits = (source: any) =>
  source?.autoAddUnits === false || source?.dynamicRateCardConfig?.promptForUnits === true;

const normalizeEmailAddress = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const GLOBAL_ADMIN_ASSIGNMENT_ROLES = new Set(['admin', 'org_admin', 'manager', 'coordinador']);

const isGlobalAdminMember = (member: any) => {
  const normalizedEmail = normalizeEmailAddress(member?.email);
  return (
    member?.systemRole === 'admin' ||
    member?.role === 'admin' ||
    member?.profileRole === 'admin' ||
    isBootstrapAdminEmail(normalizedEmail) ||
    String(member?.roleName || '').toLowerCase() === 'administrador global'
  );
};

const getRateCardDateKeys = (date = new Date()) => {
  const year = date.getFullYear();
  const dateKey = date.toISOString().slice(0, 10);
  const monthKey = `${year}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  const startOfYear = new Date(year, 0, 1);
  const dayOfYear = Math.floor((date.getTime() - startOfYear.getTime()) / 86400000) + 1;
  const weekKey = `${year}-W${String(Math.ceil(dayOfYear / 7)).padStart(2, '0')}`;

  return { dateKey, weekKey, monthKey };
};

export default function ProjectDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = params.id as string;
  const { user, userRole, userOrganizationId, userOrganizationIds } = useAuth();
  const userId = user?.uid || '';
  const { permissions: rolePermissions, loading: rolePermissionsLoading } = useRolePermissions(userRole);

  const [project, setProject] = useState<any>(null);
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [projectLoadError, setProjectLoadError] = useState('');
  const [documentsLoaded, setDocumentsLoaded] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadTargetFolderId, setUploadTargetFolderId] = useState<string | null>(null);
  const [documentSearchQuery, setDocumentSearchQuery] = useState('');
  const [previewDocument, setPreviewDocument] = useState<any | null>(null);

  const [documentToDelete, setDocumentToDelete] = useState<{id: string, storagePath: string, name: string, versionStoragePaths: string[]} | null>(null);
  const [taskToDelete, setTaskToDelete] = useState<TaskDeleteRequest | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletionProgress, setDeletionProgress] = useState<DeletionProgress | null>(null);

  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [userProfiles, setUserProfiles] = useState<any[]>([]);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);

  const [activeTab, setActiveTab] = useState<'documents' | 'drive' | 'inventory' | 'map' | 'tasks' | 'scrum' | 'logbook' | 'quality' | 'rateCards' | 'budget' | 'administration' | 'billing' | 'orgChart'>('tasks');
  const [showDocumentIssueAlert, setShowDocumentIssueAlert] = useState(false);
  const canAccessProjectBudget = PROJECT_BUDGET_ACCESS_ROLES.has(userRole || '');

  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'tasksList') {
      setActiveTab('tasks');
      return;
    }
    if (tabParam && ['documents', 'drive', 'inventory', 'map', 'tasks', 'scrum', 'logbook', 'quality', 'rateCards', 'budget', 'administration', 'billing', 'orgChart'].includes(tabParam)) {
      setActiveTab(tabParam as any);
    }
  }, [searchParams]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [rateCards, setRateCards] = useState<any[]>([]);
  const [budgetLines, setBudgetLines] = useState<any[]>([]);

  const syncRateDrivenTasksForRateIds = async (
    rateCardIds: Array<string | null | undefined>,
    options: { fetchFreshTasks?: boolean } = {},
  ) => {
    const uniqueRateCardIds = Array.from(new Set(rateCardIds.filter(Boolean))) as string[];
    if (uniqueRateCardIds.length === 0) return;

    await Promise.all(
      uniqueRateCardIds.map((rateCardId) =>
        syncRateDrivenIncrementalTasksForRate({
          projectId,
          rateCardId,
          tasks: options.fetchFreshTasks ? undefined : tasks,
        }),
      ),
    );
  };

  const [isCreateTaskModalOpen, setIsCreateTaskModalOpen] = useState(false);
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const [isTaskDocsModalOpen, setIsTaskDocsModalOpen] = useState(false);
  const [selectedTaskForDocs, setSelectedTaskForDocs] = useState<any>(null);
  const [isStartWorkflowModalOpen, setIsStartWorkflowModalOpen] = useState(false);
  const [selectedTaskForStartWorkflow, setSelectedTaskForStartWorkflow] = useState<any>(null);
  const [taskForStructureEdit, setTaskForStructureEdit] = useState<any>(null);
  const [selectedTaskForIncrement, setSelectedTaskForIncrement] = useState<any>(null);
  const [selectedTaskForComments, setSelectedTaskForComments] = useState<any>(null);
  const [taskForBulkIterations, setTaskForBulkIterations] = useState<any>(null);
  const [openedTaskDeepLink, setOpenedTaskDeepLink] = useState('');
  const [isTaskStatusReportOpen, setIsTaskStatusReportOpen] = useState(false);
  const [taskForPause, setTaskForPause] = useState<any>(null);
  const [pauseReason, setPauseReason] = useState('');
  const [taskForReschedule, setTaskForReschedule] = useState<any>(null);
  const [rescheduleStartDate, setRescheduleStartDate] = useState('');
  const [rescheduleEndDate, setRescheduleEndDate] = useState('');
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [dynamicRateCardStatusChange, setDynamicRateCardStatusChange] = useState<{
    taskId: string;
    newStatus: string;
    task: any;
  } | null>(null);
  const [completionFormStatusChange, setCompletionFormStatusChange] = useState<{
    taskId: string;
    newStatus: string;
    task: any;
  } | null>(null);
  const [dynamicRateCardAssignee, setDynamicRateCardAssignee] = useState('');
  const [dynamicRateCardId, setDynamicRateCardId] = useState('');
  const [dynamicRateCardUnits, setDynamicRateCardUnits] = useState<number | ''>(1);
  const [dynamicRateCardComment, setDynamicRateCardComment] = useState('');

  useEffect(() => {
    const taskIdParam = searchParams.get('taskId') || searchParams.get('task');
    if (!taskIdParam || tasks.length === 0) return;

    const focusParam = searchParams.get('focus') || 'comments';
    const deepLinkKey = `${projectId}:${taskIdParam}:${focusParam}`;
    if (openedTaskDeepLink === deepLinkKey) return;

    const linkedTask = tasks.find((task) => task.id === taskIdParam);
    if (!linkedTask) return;

    setActiveTab('tasks');
    if (focusParam === 'docs' || focusParam === 'details') {
      setSelectedTaskForDocs(linkedTask);
      setIsTaskDocsModalOpen(true);
    } else {
      setSelectedTaskForComments(linkedTask);
    }
    setOpenedTaskDeepLink(deepLinkKey);
  }, [openedTaskDeepLink, projectId, searchParams, tasks]);

  const managedOrganizationIds = React.useMemo(
    () => (userOrganizationIds.length > 0 ? userOrganizationIds : userOrganizationId ? [userOrganizationId] : []),
    [userOrganizationId, userOrganizationIds]
  );
  const teamMembersWithSystemProfiles = React.useMemo(() => {
    const profilesById = new Map<string, any>();
    const profilesByEmail = new Map<string, any>();

    userProfiles.forEach((profile) => {
      if (profile.id) profilesById.set(profile.id, profile);
      if (profile.uid) profilesById.set(profile.uid, profile);
      if (profile.authUserId) profilesById.set(profile.authUserId, profile);
      const email = normalizeEmailAddress(profile.email);
      if (email) profilesByEmail.set(email, profile);
    });

    const enrichedMembers = teamMembers.map((member) => {
      const profile =
        profilesById.get(member.id) ||
        profilesById.get(member.uid) ||
        profilesById.get(member.authUserId) ||
        profilesByEmail.get(normalizeEmailAddress(member.email));

      if (!profile) return member;

      const profileOrganizationIds = getOrganizationIds(profile);
      const memberOrganizationIds = getOrganizationIds(member);

      return {
        ...member,
        authUserId: member.authUserId || profile.authUserId || profile.uid || profile.id,
        systemRole: member.systemRole || profile.role || profile.systemRole,
        profileRole: profile.role || profile.systemRole,
        organizationId: member.organizationId || profile.organizationId || null,
        organizationIds: memberOrganizationIds.length > 0 ? memberOrganizationIds : profileOrganizationIds,
        photoURL: member.photoURL || profile.photoURL || null,
        signatureUrl: member.signatureUrl || profile.signatureUrl || null,
        signatureStoragePath: member.signatureStoragePath || profile.signatureStoragePath || null,
        roleName: member.roleName || profile.roleName || profile.position || profile.jobTitle || null,
        identificationType: member.identificationType || profile.identificationType || 'CC',
        identificationNumber: member.identificationNumber || profile.identificationNumber || profile.documentNumber || '',
        phone: member.phone || profile.phone || profile.mobile || '',
        address: member.address || profile.address || '',
        city: member.city || profile.city || '',
        bankAccounts: Array.isArray(member.bankAccounts) && member.bankAccounts.length > 0 ? member.bankAccounts : profile.bankAccounts || [],
      };
    });

    const knownMemberKeys = new Set<string>();
    enrichedMembers.forEach((member) => {
      if (member.id) knownMemberKeys.add(`id:${member.id}`);
      if (member.authUserId) knownMemberKeys.add(`id:${member.authUserId}`);
      const email = normalizeEmailAddress(member.email);
      if (email) knownMemberKeys.add(`email:${email}`);
    });

    const syntheticGlobalAdmins = userProfiles
      .filter((profile) => isGlobalAdminMember(profile))
      .filter((profile) => {
        const email = normalizeEmailAddress(profile.email);
        return !knownMemberKeys.has(`id:${profile.id}`) && !knownMemberKeys.has(`id:${profile.uid}`) && !(email && knownMemberKeys.has(`email:${email}`));
      })
      .map((profile) => ({
        id: profile.id || profile.uid || profile.authUserId,
        authUserId: profile.authUserId || profile.uid || profile.id,
        email: profile.email || '',
        name: profile.displayName || profile.name || profile.email?.split('@')[0] || 'Administrador Global',
        displayName: profile.displayName || profile.name || profile.email?.split('@')[0] || 'Administrador Global',
        photoURL: profile.photoURL || null,
        signatureUrl: profile.signatureUrl || null,
        signatureStoragePath: profile.signatureStoragePath || null,
        roleName: 'Administrador Global',
        identificationType: profile.identificationType || 'CC',
        identificationNumber: profile.identificationNumber || profile.documentNumber || '',
        phone: profile.phone || profile.mobile || '',
        address: profile.address || '',
        city: profile.city || '',
        bankAccounts: profile.bankAccounts || [],
        systemRole: 'admin',
        profileRole: 'admin',
        organizationId: profile.organizationId || null,
        organizationIds: getOrganizationIds(profile),
      }))
      .filter((member) => member.id);

    return [...syntheticGlobalAdmins, ...enrichedMembers];
  }, [teamMembers, userProfiles]);

  const currentGlobalAdminAssignee = React.useMemo(() => {
    if (!user || userRole !== 'admin') return null;

    const currentEmail = normalizeEmailAddress(user.email);
    const existingMember = teamMembersWithSystemProfiles.find((member) =>
      member.id === user.uid ||
      member.authUserId === user.uid ||
      normalizeEmailAddress(member.email) === currentEmail
    );

    if (existingMember) {
      return {
        ...existingMember,
        authUserId: existingMember.authUserId || user.uid,
        roleName: existingMember.roleName || 'Administrador Global',
        systemRole: existingMember.systemRole || 'admin',
      };
    }

    return {
      id: user.uid,
      authUserId: user.uid,
      email: user.email || '',
      name: user.displayName || user.email?.split('@')[0] || 'Administrador Global',
      displayName: user.displayName || user.email?.split('@')[0] || 'Administrador Global',
      photoURL: user.photoURL || null,
      roleName: 'Administrador Global',
      systemRole: 'admin',
      organizationId: null,
      organizationIds: [],
    };
  }, [teamMembersWithSystemProfiles, user, userRole]);

  const teamMembersForAssignment = React.useMemo(() => {
    if (!currentGlobalAdminAssignee) return teamMembersWithSystemProfiles;
    if (teamMembersWithSystemProfiles.some((member) => member.id === currentGlobalAdminAssignee.id)) return teamMembersWithSystemProfiles;
    return [currentGlobalAdminAssignee, ...teamMembersWithSystemProfiles];
  }, [currentGlobalAdminAssignee, teamMembersWithSystemProfiles]);


  useEffect(() => {
    if (!userId || !projectId) return;

    let projectResolved = false;
    setLoading(true);
    setTasksLoading(true);
    setProjectLoadError('');
    const projectLoadTimeout = window.setTimeout(() => {
      if (projectResolved) return;
      setLoading(false);
      setProjectLoadError('El proyecto está tardando demasiado en responder. Puedes reintentar sin cerrar tu sesión.');
    }, 15000);

    // Fetch project details (realtime)
    const docRef = doc(db, 'projects', projectId);
    const unsubscribeProject = onSnapshot(docRef, (docSnap) => {
      projectResolved = true;
      window.clearTimeout(projectLoadTimeout);
      if (docSnap.exists()) {
        setProject({ id: docSnap.id, ...docSnap.data() });
        setProjectLoadError('');
        setLoading(false);
      } else {
        setLoading(false);
        setProjectLoadError('El proyecto no existe o ya no está disponible.');
        router.push('/projects');
      }
    }, (error) => {
      handleDataError(error, OperationType.GET, `projects/${projectId}`);
      projectResolved = true;
      window.clearTimeout(projectLoadTimeout);
      setLoading(false);
      setProjectLoadError('No fue posible cargar los datos básicos del proyecto. Reintenta la conexión.');
    });

    // Listen to tasks
    const qTasks = query(collection(db, 'projects', projectId, 'tasks'), orderBy('createdAt', 'desc'));
    const unsubscribeTasks = onSnapshot(qTasks, (snapshot) => {
      const tasksData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setTasks(tasksData);
      setTasksLoading(false);
    }, (error) => {
      handleDataError(error, OperationType.LIST, `projects/${projectId}/tasks`);
      setTasksLoading(false);
    });

    // Fetch all team members
    const qTeam = query(collection(db, 'team_members'));
    const unsubscribeTeam = onSnapshot(qTeam, (snapshot) => {
      const teamData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setTeamMembers(teamData);
    }, (error) => {
      handleDataError(error, OperationType.LIST, 'team_members');
    });

    if (!GLOBAL_ADMIN_ASSIGNMENT_ROLES.has(userRole || '')) {
      setUserProfiles([]);
    }

    const unsubscribeUsers = GLOBAL_ADMIN_ASSIGNMENT_ROLES.has(userRole || '')
      ? onSnapshot(query(collection(db, 'users')), (snapshot) => {
          const profilesData = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));
          setUserProfiles(profilesData);
        }, (error) => {
          handleDataError(error, OperationType.LIST, 'users');
          setUserProfiles([]);
        })
      : () => {};

    // Listen to rate cards
    const qRateCards = query(collection(db, 'projects', projectId, 'rateCards'));
    const unsubscribeRateCards = onSnapshot(qRateCards, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setRateCards(data);
    }, (error) => {
      handleDataError(error, OperationType.LIST, `projects/${projectId}/rateCards`);
    });

    // Listen to budget lines
    const qBudgetLines = query(collection(db, 'projects', projectId, 'budgetLines'));
    const unsubscribeBudgetLines = onSnapshot(qBudgetLines, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setBudgetLines(data);
    }, (error) => {
      handleDataError(error, OperationType.LIST, `projects/${projectId}/budgetLines`);
    });

    return () => {
      window.clearTimeout(projectLoadTimeout);
      unsubscribeProject();
      unsubscribeTasks();
      unsubscribeTeam();
      unsubscribeUsers();
      unsubscribeRateCards();
      unsubscribeBudgetLines();
    };
  }, [userId, projectId, router, userRole]);

  useEffect(() => {
    if (!userId || !projectId || activeTab !== 'documents') return;

    setDocumentsLoaded(false);
    const documentsQuery = query(collection(db, 'projects', projectId, 'documents'));
    const unsubscribeDocs = onSnapshot(documentsQuery, (snapshot) => {
      const docsData = snapshot.docs.map(documentSnapshot => ({
        id: documentSnapshot.id,
        ...documentSnapshot.data(),
      }));
      setDocuments(docsData);
      setDocumentsLoaded(true);
    }, (error) => {
      handleDataError(error, OperationType.LIST, `projects/${projectId}/documents`);
      setDocumentsLoaded(true);
    });

    return () => unsubscribeDocs();
  }, [activeTab, projectId, userId]);

  const confirmDeleteDocument = (docId: string, storagePath: string, name: string, versionStoragePaths: string[] = []) => {
    setDocumentToDelete({ id: docId, storagePath, name, versionStoragePaths });
  };

  const executeDeleteDocument = async () => {
    if (!documentToDelete) return;
    if (!canDeleteDocuments) {
      toast.error('No tienes permisos para eliminar documentos de este proyecto.');
      setDocumentToDelete(null);
      return;
    }

    setIsDeleting(true);
    try {
      // Delete from Storage
      const storagePaths = [...new Set([
        documentToDelete.storagePath,
        ...documentToDelete.versionStoragePaths,
      ].filter(Boolean))];
      await Promise.all(storagePaths.map((storagePath) => deleteObject(ref(storage, storagePath))));

      // Delete from Supabase
      await deleteDoc(doc(db, 'projects', projectId, 'documents', documentToDelete.id));

      setDocumentToDelete(null);
    } catch (error: any) {
      console.error("Error deleting document:", error);
      toast.error(`Error al eliminar el documento: ${error.message || 'Error desconocido'}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const [memberToRemove, setMemberToRemove] = useState<{id: string, name: string} | null>(null);

  const handleRemoveMember = (memberId: string) => {
    const member = teamMembersForAssignment.find(m => m.id === memberId);
    if (member) {
      setMemberToRemove({ id: memberId, name: member.name || member.email });
    }
  };

  const canManageProject = userRole === 'admin' || userRole === 'coordinador' || project?.ownerId === user?.uid;
  const canCreateTasks = rolePermissions.taskCreate;
  const canEditTaskStatus = rolePermissions.taskEditStatus;
  const canEditTaskDetails = rolePermissions.taskEditDetails;
  const canManageScrumLifecycle = Boolean(
    canEditTaskDetails &&
    (
      ['admin', 'org_admin', 'manager', 'gerente', 'project_manager', 'coordinador', 'coordinator'].includes(userRole || '') ||
      project?.ownerId === user?.uid
    )
  );
  const canEditTaskDates = rolePermissions.taskEditDates;
  const canAddSubtasks = rolePermissions.taskAddSubtasks;
  const canDeleteTasks = rolePermissions.taskDelete;
  const canEditTaskStructure =
    rolePermissions.taskEditStructure &&
    (userRole !== 'org_admin' || !project?.organizationId || belongsToAnyOrganization(project, managedOrganizationIds));
  const canManageDriveRepositories =
    userRole === 'admin' ||
    (userRole === 'org_admin' && (!project?.organizationId || belongsToAnyOrganization(project, managedOrganizationIds)));
  const hasDocumentManagementScope =
    userRole !== 'org_admin' ||
    !project?.organizationId ||
    belongsToAnyOrganization(project, managedOrganizationIds);
  const canViewDocuments = Boolean(rolePermissions.documentView);
  const canUploadDocuments = Boolean(rolePermissions.documentUpload) && hasDocumentManagementScope;
  const canManageDocumentAccess = Boolean(rolePermissions.documentManageAccess) && hasDocumentManagementScope;
  const canDeleteDocuments = Boolean(rolePermissions.documentDelete) && hasDocumentManagementScope;

  const openUploadDocumentModal = (folderId: string | null = null) => {
    setUploadTargetFolderId(folderId);
    setIsUploadModalOpen(true);
  };

  const closeUploadDocumentModal = () => {
    setIsUploadModalOpen(false);
    setUploadTargetFolderId(null);
  };

  const handleCreateDocumentFolder = async (name: string, parentFolderId: string | null) => {
    if (!canUploadDocuments || !user) {
      toast.error('No tienes permisos para crear carpetas en este proyecto.');
      return;
    }

    const cleanName = name.trim();
    if (!cleanName) return;

    const siblingExists = documents.some((document) =>
      document?.itemKind === 'folder' &&
      !document?.taskId &&
      (document?.parentFolderId || null) === (parentFolderId || null) &&
      String(document?.name || '').trim().toLowerCase() === cleanName.toLowerCase()
    );

    if (siblingExists) {
      toast.warning('Ya existe una carpeta con ese nombre en esta ubicación.');
      return;
    }

    await addDoc(collection(db, 'projects', projectId, 'documents'), {
      projectId,
      name: cleanName,
      type: 'folder',
      itemKind: 'folder',
      scope: 'project',
      parentFolderId: parentFolderId || null,
      createdAt: serverTimestamp(),
      uploadedAt: serverTimestamp(),
      createdBy: user.uid,
      uploadedBy: user.uid,
      accessMode: parentFolderId ? 'inherit' : 'all',
      allowedMemberIds: [],
      providerPathVersion: 'structured-v2',
    });

    toast.success('Carpeta creada');
  };

  const handleUpdateDocumentFolderAccess = async (
    folderId: string,
    accessMode: 'all' | 'restricted',
    allowedMemberIds: string[]
  ) => {
    if (!canManageDocumentAccess || !user) {
      toast.error('No tienes permisos para gestionar la seguridad documental.');
      return;
    }

    if (accessMode === 'restricted' && allowedMemberIds.length === 0) {
      toast.warning('Selecciona al menos una persona autorizada.');
      return;
    }

    await updateDoc(doc(db, 'projects', projectId, 'documents', folderId), {
      accessMode,
      allowedMemberIds: accessMode === 'restricted' ? allowedMemberIds : [],
      accessUpdatedAt: serverTimestamp(),
      accessUpdatedBy: user.uid,
      accessPolicyVersion: 'folder-inheritance-v1',
    });
    toast.success(accessMode === 'restricted' ? 'Carpeta protegida.' : 'Seguridad de carpeta actualizada.');
  };

  const canViewProjectInventory = Boolean(rolePermissions.inventoryProjectView);
  const hasInventoryManagementScope =
    userRole !== 'org_admin' ||
    !project?.organizationId ||
    belongsToAnyOrganization(project, managedOrganizationIds);
  const canManageInventory =
    Boolean(rolePermissions.inventoryProjectManage) &&
    hasInventoryManagementScope;
  const hasProjectAdministrationScope =
    userRole !== 'org_admin' ||
    !project?.organizationId ||
    belongsToAnyOrganization(project, managedOrganizationIds);
  const canViewProjectAdministration =
    Boolean(rolePermissions.administrationProjectView) &&
    hasProjectAdministrationScope;
  const canManageProjectAdministration =
    Boolean(rolePermissions.administrationProjectManage) &&
    hasProjectAdministrationScope;
  const canValidateProjectAdministration =
    Boolean(rolePermissions.administrationProjectValidate) &&
    hasProjectAdministrationScope;
  const canEditProjectAccountingClosures =
    Boolean(rolePermissions.administrationClosureEdit) &&
    hasProjectAdministrationScope;
  const canEditProjectAccountingClosureDate =
    Boolean(rolePermissions.administrationClosureDateEdit) &&
    hasProjectAdministrationScope;
  const canDeleteProjectAccountingClosures =
    Boolean(rolePermissions.administrationClosureDelete) &&
    hasProjectAdministrationScope;
  const canDeleteProjectAdministrativeReceipts =
    Boolean(rolePermissions.administrationReceiptDelete) &&
    hasProjectAdministrationScope;
  const canConfigureProjectAdministration =
    Boolean(rolePermissions.administrationConfigManage) &&
    hasProjectAdministrationScope;
  const canDeleteLogbookEntries =
    userRole === 'admin' ||
    userRole === 'manager' ||
    (userRole === 'org_admin' && (!project?.organizationId || belongsToAnyOrganization(project, managedOrganizationIds)));
  const canManageWorkflowTemplates =
    userRole === 'admin' ||
    (userRole === 'org_admin' && (!project?.organizationId || belongsToAnyOrganization(project, managedOrganizationIds)));

  useEffect(() => {
    if (rolePermissionsLoading || activeTab !== 'inventory' || canViewProjectInventory) return;
    setActiveTab('tasks');
    toast.error('No tienes permisos para ver el inventario de este proyecto.');
  }, [activeTab, canViewProjectInventory, rolePermissionsLoading]);

  useEffect(() => {
    if (rolePermissionsLoading || activeTab !== 'administration' || canViewProjectAdministration) return;
    setActiveTab('tasks');
    toast.error('No tienes permisos para ver el módulo administrativo de este proyecto.');
  }, [activeTab, canViewProjectAdministration, rolePermissionsLoading]);

  useEffect(() => {
    if (rolePermissionsLoading || activeTab !== 'documents' || canViewDocuments) return;
    setActiveTab('tasks');
    toast.error('No tienes permisos para ver la documentación de este proyecto.');
  }, [activeTab, canViewDocuments, rolePermissionsLoading]);

  const taskGroups = React.useMemo(
    () =>
      Array.isArray(project?.taskGroups)
        ? [...project.taskGroups].sort((left: any, right: any) => {
            const leftOrder = left.order ?? 0;
            const rightOrder = right.order ?? 0;
            if (leftOrder !== rightOrder) return leftOrder - rightOrder;
            return String(left.name || '').localeCompare(String(right.name || ''));
          })
        : [],
    [project?.taskGroups]
  );

  const currentGlobalAdminAssigneeId = currentGlobalAdminAssignee?.id || '';
  const canAssignGlobalAdmins = GLOBAL_ADMIN_ASSIGNMENT_ROLES.has(userRole || '');
  const projectOrganizationIds = getOrganizationIds(project);
  const projectAssignedMemberIds = new Set((project?.assignedTeamMembers || []).filter(Boolean));
  const organizationTeamMembers = teamMembersForAssignment.filter((member) => {
    if (member.id === currentGlobalAdminAssigneeId) return true;
    if (canAssignGlobalAdmins && isGlobalAdminMember(member)) return true;
    if (projectOrganizationIds.length === 0) return true;
    const memberOrganizationIds = getOrganizationIds(member);
    return memberOrganizationIds.some((organizationId) => projectOrganizationIds.includes(organizationId));
  });
  const projectAssignableTeamMembers = organizationTeamMembers.filter((member) => {
    if (member.id === currentGlobalAdminAssigneeId) return true;
    if (canAssignGlobalAdmins && isGlobalAdminMember(member)) return true;
    return projectAssignedMemberIds.has(member.id);
  });
  const projectOrgChartTeamMembers = React.useMemo(() => {
    const assignedIds = Array.from(new Set((project?.assignedTeamMembers || []).filter(Boolean)));
    const membersById = new Map<string, any>();

    [...teamMembersForAssignment, ...teamMembersWithSystemProfiles].forEach((member) => {
      if (member?.id && !membersById.has(member.id)) {
        membersById.set(member.id, member);
      }
    });

    return assignedIds
      .map((memberId) => membersById.get(String(memberId)))
      .filter(Boolean);
  }, [project?.assignedTeamMembers, teamMembersForAssignment, teamMembersWithSystemProfiles]);

  const currentActorName = React.useMemo(() => {
    const currentEmail = normalizeEmailAddress(user?.email);
    const currentId = user?.uid;
    const candidates = [...projectAssignableTeamMembers, ...teamMembersForAssignment, ...teamMembersWithSystemProfiles];
    const actor = candidates.find((member) => {
      if (!member) return false;
      if (currentId && [member.id, member.uid, member.authUserId].includes(currentId)) return true;
      return currentEmail && normalizeEmailAddress(member.email) === currentEmail;
    });

    return (
      actor?.name ||
      actor?.displayName ||
      user?.email ||
      user?.displayName ||
      'Usuario'
    );
  }, [projectAssignableTeamMembers, teamMembersForAssignment, teamMembersWithSystemProfiles, user?.displayName, user?.email, user?.uid]);

  const collectDependentTaskIds = (taskId: string) => {
    const taskIds = new Set<string>([taskId]);
    let foundNewDependent = true;

    while (foundNewDependent) {
      foundNewDependent = false;
      tasks.forEach((currentTask) => {
        if (currentTask.parentTaskId && taskIds.has(currentTask.parentTaskId) && !taskIds.has(currentTask.id)) {
          taskIds.add(currentTask.id);
          foundNewDependent = true;
        }
      });
    }

    return taskIds;
  };

  const handleUpdateTaskProgress = async (taskId: string, newProgress: number, task: any) => {
    if (!task) return;
    if (!canEditTaskDetails) {
      toast.error('No tienes permisos para editar los detalles de tareas.');
      return;
    }
    if (isWorkflowTaskType(task.type) && newProgress >= 100) {
      toast.warning('Los workflows se finalizan aprobando sus pasos. Desde la tarea general solo se pueden iniciar en Trabajando.');
      return;
    }
    try {
      if (newProgress === 100 && task.requiresDocument && !task.linkedDocumentId) {
        setCompletingTaskId(taskId);
        return;
      }

      if (newProgress === 100 && taskShouldAskCompletionForm(task)) {
        await handleUpdateTaskStatus(taskId, 'completed', task);
        return;
      }

      let status = 'in_progress';
      if (newProgress === 0) status = 'todo';
      if (newProgress === 100) status = 'completed';
      status = normalizeCompletedTaskStatus(status, task);

      const batch = writeBatch(db);
      const taskRef = doc(db, 'projects', projectId, 'tasks', taskId);

      // Handle Rate Card update
      if (task.isRateCardTask && task.rateCardId && task.unitsToAdd) {
        if (!isWorkflowTaskType(task.type)) {
          // Proportional for non-workflow
          const oldProgress = task.progress || 0;
          const deltaProgress = newProgress - oldProgress;
          const unitsDelta = (deltaProgress / 100) * normalizeRateCardUnits(task.unitsToAdd, 0);

          if (unitsDelta !== 0) {
            addTraceableRateCardMovementToBatch(batch, {
              projectId,
              task,
              rateCardId: task.rateCardId,
              assignedTo: task.assignedTo || null,
              units: Math.abs(unitsDelta),
              source: 'task_progress_update',
              rateCardSourceKey: `task_progress:${oldProgress}->${newProgress}`,
              comment: `Avance de tarea actualizado de ${oldProgress}% a ${newProgress}%.`,
              occurredAt: new Date(),
              actor: {
                id: user?.uid || null,
                email: user?.email || null,
                name: user?.displayName || user?.email || null,
              },
              reversal: unitsDelta < 0,
              completionMode: 'task_progress_update',
            });
          }
        } else {
          // For workflow, only if completing/reverting the whole task
          const wasCompleted = task.status === 'completed' || task.status === 'completed_late';
          const isCompleted = status === 'completed' || status === 'completed_late';

          if (wasCompleted !== isCompleted) {
            const units = normalizeRateCardUnits(task.unitsToAdd);
            addTraceableRateCardMovementToBatch(batch, {
              projectId,
              task,
              rateCardId: task.rateCardId,
              assignedTo: task.assignedTo || null,
              units,
              source: 'workflow_task_status_update',
              rateCardSourceKey: 'workflow_task_completion',
              comment: isCompleted ? 'Workflow marcado como completado.' : 'Workflow devuelto desde completado.',
              occurredAt: new Date(),
              actor: {
                id: user?.uid || null,
                email: user?.email || null,
                name: user?.displayName || user?.email || null,
              },
              reversal: !isCompleted,
              completionMode: 'workflow_task_status_update',
            });

            // Also update all steps if completing/reverting the whole task
            if (task.workflowSteps) {
              const updatedSteps = task.workflowSteps.map((step: any, stepIndex: number) => {
                const stepWasApproved = step.status === 'listo';
                const stepIsApproved = isCompleted;

                const stepRateCardSources = getStaticRateCardSources(step);
                if (stepWasApproved !== stepIsApproved && stepRateCardSources.length > 0) {
                  stepRateCardSources.forEach((stepRateCardSource) => {
                    const stepUnits = normalizeRateCardUnits(stepRateCardSource.unitsToAdd);
                    const stepAssignee = getStaticRateCardAssignee(stepRateCardSource, step.assignedTo);
                    addTraceableRateCardMovementToBatch(batch, {
                      projectId,
                      task,
                      rateCardId: stepRateCardSource.rateCardId,
                      assignedTo: stepAssignee || null,
                      units: stepUnits,
                      source: 'workflow_step_status_update',
                      rateCardSourceKey: stepRateCardSource.key || `workflow_step:${stepIndex}`,
                      stepIndex,
                      stepName: step?.name || step?.title || `Paso ${stepIndex + 1}`,
                      comment: stepIsApproved ? 'Paso marcado como listo desde el cierre del workflow.' : 'Paso revertido desde el estado del workflow.',
                      occurredAt: new Date(),
                      actor: {
                        id: user?.uid || null,
                        email: user?.email || null,
                        name: user?.displayName || user?.email || null,
                      },
                      reversal: !stepIsApproved,
                      completionMode: 'workflow_step_status_update',
                    });
                  });
                }
                return { ...step, status: stepIsApproved ? 'listo' : 'not_started' };
              });

              batch.update(taskRef, { workflowSteps: updatedSteps });
            }
          }
        }
      }

      batch.update(taskRef, {
        progress: newProgress,
        status: status,
        updatedAt: serverTimestamp()
      });

      await batch.commit();
    } catch (error: any) {
      console.error("Error updating task:", error);
      toast.error(`Error al actualizar la tarea: ${error.message}`);
    }
  };

  const handleUpdateTaskValue = async (taskId: string, newValue: number, task: any) => {
    if (!task) return;
    if (!canEditTaskDetails) {
      toast.error('No tienes permisos para editar los detalles de tareas.');
      return;
    }
    const delegatesIncrementToSubtasks =
      task.type === 'quantitative' &&
      (task.incrementDelegatedToSubtasks || task.isParentTask || Number(task.totalSubtasks || 0) > 0);
    if (delegatesIncrementToSubtasks) {
      toast.info('Esta tarea incremental delega su avance en sus subtareas. Actualiza las subtareas para completar la matriz.');
      return;
    }
    if (!task.indicatorValue) return;
    if (isRateDrivenIncrementalTask(task)) {
      toast.info('Esta tarea incremental se actualiza únicamente con el Rate Card configurado.');
      await syncRateDrivenTasksForRateIds([getIncrementalRateBinding(task)?.rateCardId]);
      return;
    }
    try {
      const targetValue = Number(task.indicatorValue);
      const safeValue = Math.min(Math.max(Number(newValue) || 0, 0), targetValue);
      const progress = Math.min(100, Math.round((safeValue / targetValue) * 100));
      const requiresCompletionDocument = progress === 100 && task.requiresDocument && !task.linkedDocumentId;

      let status = 'in_progress';
      if (progress === 0) status = 'todo';
      if (progress === 100) status = requiresCompletionDocument ? 'in_progress' : 'completed';

      const batch = writeBatch(db);
      const taskRef = doc(db, 'projects', projectId, 'tasks', taskId);

      // Handle Rate Card update for non-workflow tasks
      if (!isWorkflowTaskType(task.type) && task.isRateCardTask && task.rateCardId && task.unitsToAdd) {
        const oldProgress = task.progress || 0;
        const deltaProgress = progress - oldProgress;
        const unitsDelta = (deltaProgress / 100) * normalizeRateCardUnits(task.unitsToAdd, 0);

        if (unitsDelta !== 0) {
          addTraceableRateCardMovementToBatch(batch, {
            projectId,
            task,
            rateCardId: task.rateCardId,
            assignedTo: task.assignedTo || null,
            units: Math.abs(unitsDelta),
            source: 'task_value_progress_update',
            rateCardSourceKey: `task_value_progress:${oldProgress}->${progress}`,
            comment: `Avance cuantitativo actualizado de ${oldProgress}% a ${progress}%.`,
            occurredAt: new Date(),
            actor: {
              id: user?.uid || null,
              email: user?.email || null,
              name: user?.displayName || user?.email || null,
            },
            reversal: unitsDelta < 0,
            completionMode: 'task_value_progress_update',
          });
        }
      }

      if (task.incrementForm?.rateCardId) {
        const units = normalizeRateCardUnits(task.incrementForm.unitsToAdd);
        addTraceableRateCardMovementToBatch(batch, {
          projectId,
          task,
          rateCardId: task.incrementForm.rateCardId,
          assignedTo: task.assignedTo || null,
          units,
          source: 'increment_form_update',
          rateCardSourceKey: `increment_form:${task.currentValue || 0}->${safeValue}`,
          comment: 'Movimiento registrado desde formulario incremental de tarea.',
          occurredAt: new Date(),
          actor: {
            id: user?.uid || null,
            email: user?.email || null,
            name: user?.displayName || user?.email || null,
          },
          completionMode: 'increment_form_update',
        });
      }

      batch.update(taskRef, {
        currentValue: safeValue,
        progress: progress,
        status: status,
        updatedAt: serverTimestamp()
      });

      await batch.commit();

      if (task.parentTaskId) {
        const { updateParentTaskStatus } = await import('@/lib/taskUtils');
        await updateParentTaskStatus(projectId, task.parentTaskId);
      }

      if (requiresCompletionDocument) {
        setCompletingTaskId(taskId);
        toast.info('La tarea llegó a la meta. Adjunta el documento requerido para completarla.');
      }
    } catch (error: any) {
      console.error("Error updating task value:", error);
      toast.error(`Error al actualizar el valor de la tarea: ${error.message}`);
    }
  };

  const handleIncrementTaskValue = async (
    task: any,
    amount: number,
    formData: Record<string, any>,
    comment: string
  ) => {
    if (!canEditTaskDetails) {
      toast.error('No tienes permisos para registrar incrementos en tareas.');
      return;
    }

    if (!task) return;

    const delegatesIncrementToSubtasks =
      task.type === 'quantitative' &&
      (task.incrementDelegatedToSubtasks || task.isParentTask || Number(task.totalSubtasks || 0) > 0);
    if (delegatesIncrementToSubtasks) {
      toast.info('Esta tarea incremental delega su avance en sus subtareas. Registra los incrementos en cada subtarea.');
      return;
    }

    if (!task.indicatorValue) {
      toast.warning('Esta tarea no tiene una meta válida configurada.');
      return;
    }

    if (isRateDrivenIncrementalTask(task)) {
      toast.info('Esta tarea incremental solo puede avanzar con movimientos del Rate Card configurado.');
      await syncRateDrivenTasksForRateIds([getIncrementalRateBinding(task)?.rateCardId]);
      return;
    }

    const incrementAmount = Number(amount);
    const targetValue = Number(task.indicatorValue);
    const currentValue = Number(task.currentValue || 0);

    if (!incrementAmount || incrementAmount <= 0) {
      toast.warning('Ingresa un incremento mayor a cero.');
      return;
    }

    if (!targetValue || targetValue <= 0) {
      toast.warning('Esta tarea no tiene una meta válida configurada.');
      return;
    }

    const nextValue = Math.min(targetValue, currentValue + incrementAmount);
    const appliedAmount = nextValue - currentValue;

    if (appliedAmount <= 0) {
      toast.info('La tarea ya alcanzó la meta.');
      return;
    }

    try {
      const progress = Math.min(100, Math.round((nextValue / targetValue) * 100));
      const requiresCompletionDocument = progress === 100 && task.requiresDocument && !task.linkedDocumentId;
      let status = 'in_progress';
      if (progress === 0) status = 'todo';
      if (progress === 100) status = requiresCompletionDocument ? 'in_progress' : 'completed';

      const batch = writeBatch(db);
      const taskRef = doc(db, 'projects', projectId, 'tasks', task.id);

      if (!isWorkflowTaskType(task.type) && task.isRateCardTask && task.rateCardId && task.unitsToAdd) {
        const oldProgress = task.progress || 0;
        const deltaProgress = progress - oldProgress;
        const unitsDelta = (deltaProgress / 100) * normalizeRateCardUnits(task.unitsToAdd, 0);

        if (unitsDelta !== 0) {
          addTraceableRateCardMovementToBatch(batch, {
            projectId,
            task,
            rateCardId: task.rateCardId,
            assignedTo: task.assignedTo || null,
            units: Math.abs(unitsDelta),
            source: 'incremental_task_progress_update',
            rateCardSourceKey: `incremental_task_progress:${oldProgress}->${progress}`,
            comment: `Avance incremental actualizado de ${oldProgress}% a ${progress}%.`,
            occurredAt: new Date(),
            actor: {
              id: user?.uid || null,
              email: user?.email || null,
              name: user?.displayName || user?.email || null,
            },
            reversal: unitsDelta < 0,
            completionMode: 'incremental_task_progress_update',
          });
        }
      }

      batch.update(taskRef, {
        currentValue: nextValue,
        progress,
        status,
        updatedAt: serverTimestamp(),
        incrementHistory: arrayUnion({
          id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
          amount: appliedAmount,
          requestedAmount: incrementAmount,
          previousValue: currentValue,
          nextValue,
          indicator: task.indicator || '',
          formData: Object.keys(formData || {}).length > 0 ? formData : null,
          comment: comment.trim() || null,
          createdAt: new Date().toISOString(),
          createdBy: user?.uid || 'unknown',
        }),
      });

      await batch.commit();

      if (task.parentTaskId) {
        const { updateParentTaskStatus } = await import('@/lib/taskUtils');
        await updateParentTaskStatus(projectId, task.parentTaskId);
      }

      if (requiresCompletionDocument) {
        setCompletingTaskId(task.id);
        toast.info('La tarea llegó a la meta. Adjunta el documento requerido para completarla.');
      } else {
        toast.success(`Incremento registrado: ${nextValue}/${targetValue} ${task.indicator || ''}`.trim());
      }
    } catch (error: any) {
      console.error("Error incrementing task value:", error);
      throw error;
    }
  };

  const handleSyncTaskValue = async (taskId: string, task: any) => {
    if (!task || !task.syncExternal) return;
    if (!canEditTaskDetails) {
      toast.error('No tienes permisos para sincronizar tareas.');
      return;
    }

    try {
      // Simulate external DB sync
      // In a real scenario, this would be a fetch to an API
      const simulatedValue = (task.currentValue || 0) + Math.floor(Math.random() * 5) + 1;
      const finalValue = Math.min(simulatedValue, task.indicatorValue);

      await handleUpdateTaskValue(taskId, finalValue, task);
      toast.success(`Sincronizado con éxito. Nuevo valor: ${finalValue} ${task.indicator}`);
    } catch (error: any) {
      console.error("Error syncing task:", error);
      toast.error(`Error al sincronizar: ${error.message}`);
    }
  };

  const resetDynamicRateCardFields = (task: any = null) => {
    setDynamicRateCardAssignee(task?.assignedTo || '');
    setDynamicRateCardId(task?.rateCardId || '');
    setDynamicRateCardUnits(getDynamicRateCardUnits(task));
    setDynamicRateCardComment('');
  };

  const addDynamicRateCardChargeToBatch = (
    batch: ReturnType<typeof writeBatch>,
    params: {
      task: any;
      rateCardId: string;
      assigneeId: string;
      units: number;
      source: string;
      rateCardSourceKey?: string | null;
      comment?: string | null;
      reversal?: boolean;
    },
  ) => {
    const amount = Number(params.units);
    if (!params.rateCardId || !params.assigneeId || !Number.isFinite(amount)) return null;

    const now = new Date();
    const entry = addTraceableRateCardMovementToBatch(batch, {
      projectId,
      task: params.task,
      rateCardId: params.rateCardId,
      assignedTo: params.assigneeId,
      units: params.reversal ? Math.abs(amount) : amount,
      source: params.source,
      rateCardSourceKey: params.rateCardSourceKey || params.source,
      comment: params.comment || null,
      occurredAt: now,
      actor: {
        id: user?.uid || null,
        email: user?.email || null,
        name: user?.displayName || user?.email || null,
      },
      reversal: Boolean(params.reversal),
      completionMode: 'project_dynamic_rate_charge',
    });
    if (!entry) return null;

    return {
      entryId: entry.id,
      rateCardId: params.rateCardId,
      assignedTo: params.assigneeId,
      units: entry.units,
      source: params.source,
      rateCardSourceKey: entry.rateCardSourceKey || params.rateCardSourceKey || params.source,
      reversal: Boolean(params.reversal),
      createdAt: now.toISOString(),
    };
  };

  const handleUpdateTaskStatus = async (taskId: string, newStatus: string, task: any, dynamicCharge?: {
    assigneeId: string;
    rateCardId: string;
    units: number;
    comment?: string | null;
  }, statusAction?: {
    comment?: string | null;
    reschedule?: {
      start: Date;
      end: Date;
    };
  }, completionSubmission?: SubtaskCompletionSubmission) => {
    if (!task) return;
    if (!canEditTaskStatus) {
      toast.error('No tienes permisos para cambiar el estado de tareas.');
      return;
    }
    try {
      if (task.isParentTask) {
        toast.info("El estado de esta tarea madre se actualiza automáticamente según sus subtareas.");
        return;
      }

      if (newStatus === 'rescheduled') {
        if (!canEditTaskDates) {
          toast.error('Necesitas permiso para editar fechas antes de reprogramar tareas.');
          return;
        }

        if (!statusAction?.reschedule) {
          setTaskForReschedule(task);
          setRescheduleStartDate(toDateInputValue(task.startDate || task.start || new Date()));
          setRescheduleEndDate(toDateInputValue(task.endDate || task.end || new Date()));
          setRescheduleReason('');
          return;
        }

        if (!statusAction.comment?.trim()) {
          toast.warning('Agrega el argumento de la reprogramación.');
          return;
        }
      }

      if (newStatus === 'stuck' && task.status !== 'stuck' && !statusAction?.comment?.trim()) {
        setTaskForPause(task);
        setPauseReason('');
        return;
      }

      if (isWorkflowTaskType(task.type) && isWorkflowManualCompletionStatus(newStatus)) {
        toast.warning('Un workflow no se puede marcar como Listo manualmente. Debe completarse aprobando todos sus pasos.');
        return;
      }

      if (isWorkflowTaskType(task.type) && !['in_progress', 'stuck', 'rescheduled'].includes(newStatus) && newStatus !== task.status) {
        toast.warning('Desde el estado general solo puedes iniciar, estancar o reprogramar el workflow.');
        return;
      }

      if (newStatus === 'completed' && task.requiresDocument && !task.linkedDocumentId) {
        setCompletingTaskId(taskId);
        return;
      }

      const isRescheduleAction = newStatus === 'rescheduled';
      const finalStatus = isRescheduleAction ? 'in_progress' : normalizeCompletedTaskStatus(newStatus, task);

      // If it's a workflow and moving to in-progress, show the start modal
      if (!isRescheduleAction && isWorkflowTaskType(task.type) && finalStatus === 'in_progress' && task.status === 'todo') {
        setSelectedTaskForStartWorkflow(task);
        setIsStartWorkflowModalOpen(true);
        return;
      }

      const progress = getProgressForTaskStatus(finalStatus, task.progress);
      const taskHasDynamicRateCard = isDynamicRateCardEnabled(task);
      const taskHasManualStaticRateCard = isManualStaticRateCardEnabled(task);
      const taskNeedsCompletionRateCardCharge = taskHasDynamicRateCard || taskHasManualStaticRateCard;
      const wasCompleted = isCompletedTaskStatus(task.status);
      const isCompleted = isCompletedTaskStatus(finalStatus);
      const needsCompletionForm = taskShouldAskCompletionForm(task);
      const actionDate = new Date();
      const actionTimestamp = Timestamp.fromDate(actionDate);
      const actorName = currentActorName;
      const previousStatus = task.status || null;
      const statusHistoryEntry: any = {
        id: `${taskId}-status-${isRescheduleAction ? 'rescheduled' : finalStatus}-${Date.now()}`,
        status: isRescheduleAction ? 'rescheduled' : finalStatus,
        effectiveStatus: finalStatus,
        previousStatus,
        action: isRescheduleAction ? 'reschedule' : finalStatus === 'stuck' ? 'pause' : previousStatus === 'stuck' && finalStatus === 'in_progress' ? 'resume' : 'status',
        changedBy: user?.uid || null,
        changedByEmail: user?.email || null,
        changedByName: actorName,
        timestamp: actionTimestamp,
        source: 'project_tasks',
        comment: statusAction?.comment?.trim() || null,
      };

      if (needsCompletionForm && isCompleted && !wasCompleted && !completionSubmission) {
        setCompletionFormStatusChange({ taskId, newStatus, task });
        return;
      }

      if (taskNeedsCompletionRateCardCharge && isCompleted && !wasCompleted && !dynamicCharge && !completionSubmission) {
        setDynamicRateCardStatusChange({ taskId, newStatus, task });
        resetDynamicRateCardFields(task);
        return;
      }

      const batch = writeBatch(db);
      const taskRef = doc(db, 'projects', projectId, 'tasks', taskId);
      let dynamicRateCardCharge: any = null;
      let completionRateCardCharges: any[] = [];
      const completionForm = getTaskCompletionForm(task);

      if (completionSubmission && completionForm && isCompleted && !wasCompleted) {
        const staticSources = getStaticRateCardSources({ form: completionForm });
        staticSources.forEach((source) => {
          const units = source.autoAddUnits === false
            ? Number(completionSubmission.staticRateCardUnits[source.key] ?? 0)
            : normalizeRateCardUnits(source.unitsToAdd);
          const assigneeId = getStaticRateCardAssignee(
            source,
            task.assignedTo || user?.uid,
            completionSubmission.staticRateCardAssignees[source.key],
          );

          if (!source.rateCardId || !assigneeId || !Number.isFinite(units)) return;

          const charge = addDynamicRateCardChargeToBatch(batch, {
            task,
            rateCardId: source.rateCardId,
            assigneeId,
            units,
            source: source.source === 'form' ? 'subtask_completion_form' : 'subtask_completion_step',
            rateCardSourceKey: source.key,
            comment: completionSubmission.comment,
          });

          if (charge) completionRateCardCharges.push(charge);
        });

        if (completionSubmission.dynamicRateCard) {
          const charge = addDynamicRateCardChargeToBatch(batch, {
            task,
            rateCardId: completionSubmission.dynamicRateCard.rateCardId,
            assigneeId: completionSubmission.dynamicRateCard.assigneeId,
            units: completionSubmission.dynamicRateCard.units,
            source: 'subtask_completion_form_dynamic',
            rateCardSourceKey: `dynamic:${completionSubmission.dynamicRateCard.rateCardId}`,
            comment: completionSubmission.comment,
          });

          if (charge) completionRateCardCharges.push(charge);
        }

        statusHistoryEntry.comment = completionSubmission.comment;
        statusHistoryEntry.formData = completionSubmission.formData;
        statusHistoryEntry.completionFormTitle = completionForm.title || 'Formulario de cierre';
        statusHistoryEntry.completionRateCardCharges = completionRateCardCharges;
      }

      if (needsCompletionForm && wasCompleted && !isCompleted && Array.isArray(task.completionRateCardLastCharges)) {
        task.completionRateCardLastCharges.forEach((lastCharge: any) => {
          if (!lastCharge?.rateCardId || !lastCharge?.assignedTo) return;
          const charge = addDynamicRateCardChargeToBatch(batch, {
            task,
            rateCardId: lastCharge.rateCardId,
            assigneeId: lastCharge.assignedTo,
            units: -Math.abs(Number(lastCharge.units || 0)),
            source: 'subtask_completion_form_reversal',
            rateCardSourceKey: lastCharge.rateCardSourceKey || lastCharge.source || 'subtask_completion_form',
            comment: 'Reverso automático por cambio de estado desde finalizada.',
            reversal: true,
          });
          if (charge) completionRateCardCharges.push(charge);
        });
      }

      // Handle Rate Card update
      if (task.isRateCardTask && task.rateCardId && task.unitsToAdd) {
        if (!isWorkflowTaskType(task.type)) {
          if (!taskHasManualStaticRateCard) {
            // Proportional for non-workflow tasks with automatic units.
            const oldProgress = task.progress || 0;
            const deltaProgress = progress - oldProgress;
            const unitsDelta = (deltaProgress / 100) * normalizeRateCardUnits(task.unitsToAdd, 0);

            if (unitsDelta !== 0) {
              addTraceableRateCardMovementToBatch(batch, {
                projectId,
                task,
                rateCardId: task.rateCardId,
                assignedTo: task.assignedTo || null,
                units: Math.abs(unitsDelta),
                source: 'task_status_form_progress_update',
                rateCardSourceKey: `task_status_form_progress:${oldProgress}->${progress}`,
                comment: `Avance actualizado de ${oldProgress}% a ${progress}% desde formulario de estado.`,
                occurredAt: new Date(),
                actor: {
                  id: user?.uid || null,
                  email: user?.email || null,
                  name: user?.displayName || user?.email || null,
                },
                reversal: unitsDelta < 0,
                completionMode: 'task_status_form_progress_update',
              });
            }
          }
        } else {
          // For workflow, only if completing the whole task
          const wasCompleted = task.status === 'completed' || task.status === 'completed_late';
          const isCompleted = finalStatus === 'completed' || finalStatus === 'completed_late';

          if (wasCompleted !== isCompleted) {
            const units = normalizeRateCardUnits(task.unitsToAdd);
            addTraceableRateCardMovementToBatch(batch, {
              projectId,
              task,
              rateCardId: task.rateCardId,
              assignedTo: task.assignedTo || null,
              units,
              source: 'workflow_status_form_update',
              rateCardSourceKey: 'workflow_status_form_completion',
              comment: isCompleted ? 'Workflow completado desde formulario de estado.' : 'Workflow revertido desde formulario de estado.',
              occurredAt: new Date(),
              actor: {
                id: user?.uid || null,
                email: user?.email || null,
                name: user?.displayName || user?.email || null,
              },
              reversal: !isCompleted,
              completionMode: 'workflow_status_form_update',
            });

            // Also update all steps if completing/reverting the whole task
            if (task.workflowSteps) {
              const updatedSteps = task.workflowSteps.map((step: any, stepIndex: number) => {
                const stepWasApproved = step.status === 'listo';
                const stepIsApproved = isCompleted;

                const stepRateCardSources = getStaticRateCardSources(step);
                if (stepWasApproved !== stepIsApproved && stepRateCardSources.length > 0) {
                  stepRateCardSources.forEach((stepRateCardSource) => {
                    const stepUnits = normalizeRateCardUnits(stepRateCardSource.unitsToAdd);
                    const stepAssignee = getStaticRateCardAssignee(stepRateCardSource, step.assignedTo);
                    addTraceableRateCardMovementToBatch(batch, {
                      projectId,
                      task,
                      rateCardId: stepRateCardSource.rateCardId,
                      assignedTo: stepAssignee || null,
                      units: stepUnits,
                      source: 'workflow_step_status_form_update',
                      rateCardSourceKey: stepRateCardSource.key || `workflow_step_status_form:${stepIndex}`,
                      stepIndex,
                      stepName: step?.name || step?.title || `Paso ${stepIndex + 1}`,
                      comment: stepIsApproved ? 'Paso marcado como listo desde formulario de estado.' : 'Paso revertido desde formulario de estado.',
                      occurredAt: new Date(),
                      actor: {
                        id: user?.uid || null,
                        email: user?.email || null,
                        name: user?.displayName || user?.email || null,
                      },
                      reversal: !stepIsApproved,
                      completionMode: 'workflow_step_status_form_update',
                    });
                  });
                }
                return { ...step, status: stepIsApproved ? 'listo' : 'not_started' };
              });

              batch.update(taskRef, { workflowSteps: updatedSteps });
            }
          }
        }
      }

      if (taskNeedsCompletionRateCardCharge && isCompleted && !wasCompleted && dynamicCharge) {
        dynamicRateCardCharge = addDynamicRateCardChargeToBatch(batch, {
          task,
          rateCardId: taskHasManualStaticRateCard ? task.rateCardId : dynamicCharge.rateCardId,
          assigneeId: taskHasManualStaticRateCard ? (task.assignedTo || dynamicCharge.assigneeId) : dynamicCharge.assigneeId,
          units: dynamicCharge.units,
          source: taskHasManualStaticRateCard ? 'project_task_status_manual_units' : 'project_task_status',
          rateCardSourceKey: taskHasManualStaticRateCard ? `project_task_status_manual_units:${task.rateCardId}` : `project_task_status:${dynamicCharge.rateCardId}`,
          comment: dynamicCharge.comment || null,
        });
      }

      if (taskNeedsCompletionRateCardCharge && wasCompleted && !isCompleted && task.dynamicRateCardLastCharge) {
        const lastCharge = task.dynamicRateCardLastCharge;
        dynamicRateCardCharge = addDynamicRateCardChargeToBatch(batch, {
          task,
          rateCardId: lastCharge.rateCardId,
          assigneeId: lastCharge.assignedTo,
          units: -Math.abs(Number(lastCharge.units || 0)),
          source: 'project_task_status_reversal',
          rateCardSourceKey: lastCharge.rateCardSourceKey || lastCharge.source || `project_task_status:${lastCharge.rateCardId}`,
          comment: 'Reverso automático por cambio de estado desde finalizada.',
          reversal: true,
        });
      }

      const taskUpdate: any = {
        status: finalStatus,
        progress: progress,
        priority: task.priority || 'medium',
        updatedAt: actionTimestamp,
        statusHistory: arrayUnion(statusHistoryEntry),
      };

      if (isRescheduleAction && statusAction?.reschedule) {
        const { start, end } = statusAction.reschedule;
        taskUpdate.startDate = start;
        taskUpdate.endDate = end;
        taskUpdate.start = start;
        taskUpdate.end = end;
        taskUpdate.schedulePause = null;
        statusHistoryEntry.previousStartDate = toTraceableDate(task.startDate || task.start);
        statusHistoryEntry.previousEndDate = toTraceableDate(task.endDate || task.end);
        statusHistoryEntry.newStartDate = toTraceableDate(start);
        statusHistoryEntry.newEndDate = toTraceableDate(end);
      }

      if (finalStatus === 'stuck' && task.status !== 'stuck') {
        const remainingDays = getRemainingScheduleDays(task.endDate || task.end, actionDate);
        taskUpdate.schedulePause = {
          pausedAt: actionTimestamp,
          pausedBy: user?.uid || null,
          pausedByEmail: user?.email || null,
          pausedByName: actorName,
          reason: statusAction?.comment?.trim() || null,
          previousStatus,
          remainingDays,
          originalStartDate: toTraceableDate(task.startDate || task.start),
          originalEndDate: toTraceableDate(task.endDate || task.end),
        };
        statusHistoryEntry.remainingDaysAtPause = remainingDays;
      }

      if (task.status === 'stuck' && finalStatus === 'in_progress') {
        const remainingDays = task.schedulePause?.remainingDays;
        const resumedEndDate =
          remainingDays === null || remainingDays === undefined
            ? getTaskDateValue(task.endDate || task.end) || actionDate
            : getResumedDueDate(remainingDays, actionDate);
        taskUpdate.endDate = resumedEndDate;
        taskUpdate.end = resumedEndDate;
        taskUpdate.schedulePauseHistory = arrayUnion({
          ...(task.schedulePause || {}),
          resumedAt: actionTimestamp,
          resumedBy: user?.uid || null,
          resumedByEmail: user?.email || null,
          resumedByName: actorName,
          resumedEndDate: toTraceableDate(resumedEndDate),
        });
        taskUpdate.schedulePause = null;
        statusHistoryEntry.remainingDaysRestored = remainingDays ?? null;
        statusHistoryEntry.previousEndDate = toTraceableDate(task.endDate || task.end);
        statusHistoryEntry.newEndDate = toTraceableDate(resumedEndDate);
      }

      if (dynamicRateCardCharge && !dynamicRateCardCharge.reversal && dynamicCharge) {
        taskUpdate.dynamicRateCardLastCharge = dynamicRateCardCharge;
      } else if (taskNeedsCompletionRateCardCharge && wasCompleted && !isCompleted) {
        taskUpdate.dynamicRateCardLastCharge = null;
      }

      if (completionSubmission && completionForm && isCompleted && !wasCompleted) {
        taskUpdate.completionFormData = completionSubmission.formData;
        taskUpdate.completionFormHistory = arrayUnion({
          id: `${taskId}-completion-form-${Date.now()}`,
          formTitle: completionForm.title || 'Formulario de cierre',
          formData: completionSubmission.formData,
          comment: completionSubmission.comment,
          rateCardCharges: completionRateCardCharges,
          completedBy: user?.uid || null,
          completedByEmail: user?.email || null,
          completedByName: actorName,
          timestamp: actionTimestamp,
        });
        taskUpdate.completionRateCardLastCharges = completionRateCardCharges;
      } else if (needsCompletionForm && wasCompleted && !isCompleted) {
        taskUpdate.completionRateCardLastCharges = [];
      }

      batch.update(taskRef, taskUpdate);

      await batch.commit();
      await syncRateDrivenTasksForRateIds([
        dynamicRateCardCharge?.rateCardId,
        ...completionRateCardCharges.map((charge) => charge?.rateCardId),
      ]);

      if (task.parentTaskId) {
        const { updateParentTaskStatus } = await import('@/lib/taskUtils');
        await updateParentTaskStatus(projectId, task.parentTaskId);
      }
    } catch (error: any) {
      console.error("Error updating task status:", error);
      toast.error(`Error al actualizar el estado de la tarea: ${error.message}`);
    }
  };

  const confirmDynamicRateCardStatusChange = async () => {
    if (!dynamicRateCardStatusChange) return;
    const taskRequestsUnits = shouldRequestDynamicRateCardUnits(dynamicRateCardStatusChange.task);

    if (
      !dynamicRateCardAssignee ||
      !dynamicRateCardId ||
      (taskRequestsUnits && isInvalidRateCardUnits(dynamicRateCardUnits))
    ) {
      toast.warning('Completa la persona, el perfil y las unidades del Rate Card.');
      return;
    }
    if (!projectAssignableTeamMembers.some((member) => member.id === dynamicRateCardAssignee)) {
      toast.warning('La persona seleccionada debe pertenecer a la organización y al proyecto.');
      return;
    }

    await handleUpdateTaskStatus(
      dynamicRateCardStatusChange.taskId,
      dynamicRateCardStatusChange.newStatus,
      dynamicRateCardStatusChange.task,
      {
        assigneeId: dynamicRateCardAssignee,
        rateCardId: dynamicRateCardId,
        units: taskRequestsUnits
          ? Number(dynamicRateCardUnits)
          : getDynamicRateCardUnits(dynamicRateCardStatusChange.task),
        comment: dynamicRateCardComment.trim() || null,
      },
    );

      setDynamicRateCardStatusChange(null);
      resetDynamicRateCardFields();
  };

  const confirmPauseTask = async () => {
    if (!taskForPause) return;
    const cleanReason = pauseReason.trim();
    if (!cleanReason) {
      toast.warning('Describe por qué se estanca la tarea.');
      return;
    }

    await handleUpdateTaskStatus(taskForPause.id, 'stuck', taskForPause, undefined, {
      comment: cleanReason,
    });
    setTaskForPause(null);
    setPauseReason('');
  };

  const confirmRescheduleTask = async () => {
    if (!taskForReschedule) return;
    const start = parseDateInputValue(rescheduleStartDate);
    const end = parseDateInputValue(rescheduleEndDate);
    const cleanReason = rescheduleReason.trim();

    if (!start || !end) {
      toast.warning('Selecciona fecha de inicio y fecha fin.');
      return;
    }

    if (start.getTime() > end.getTime()) {
      toast.warning('La fecha de inicio no puede ser posterior a la fecha fin.');
      return;
    }

    if (!cleanReason) {
      toast.warning('Agrega el argumento de la reprogramación.');
      return;
    }

    await handleUpdateTaskStatus(taskForReschedule.id, 'rescheduled', taskForReschedule, undefined, {
      comment: cleanReason,
      reschedule: { start, end },
    });
    setTaskForReschedule(null);
    setRescheduleStartDate('');
    setRescheduleEndDate('');
    setRescheduleReason('');
  };


  const handleDeleteTask = (taskId: string) => {
    if (!canDeleteTasks) {
      toast.error('No tienes permisos para eliminar tareas.');
      return;
    }

    const task = tasks.find(t => t.id === taskId);
    if (task) {
      setTaskToDelete({ ids: [taskId], title: getTaskTitle(task), isBulk: false, mode: 'single' });
    }
  };

  const handleDeleteTaskTree = (taskId: string) => {
    if (!canDeleteTasks) {
      toast.error('No tienes permisos para eliminar tareas.');
      return;
    }

    const task = tasks.find(t => t.id === taskId);
    if (!task) {
      toast.error('No se encontró la tarea matriz para eliminar.');
      return;
    }

    const dependentIds = collectDependentTaskIds(taskId);
    setTaskToDelete({
      ids: [taskId],
      title: getTaskTitle(task),
      isBulk: false,
      mode: 'tree',
      dependentHint: Math.max(0, dependentIds.size - 1),
    });
  };

  const handleDeleteTasks = (taskIds: string[]) => {
    if (!canDeleteTasks) {
      toast.error('No tienes permisos para eliminar tareas.');
      return;
    }

    const uniqueIds = Array.from(new Set(taskIds)).filter((taskId) => tasks.some((task) => task.id === taskId));
    if (uniqueIds.length === 0) {
      toast.error('No se encontraron tareas para eliminar.');
      return;
    }

    if (uniqueIds.length === 1) {
      handleDeleteTask(uniqueIds[0]);
      return;
    }

    const previewTitles = uniqueIds
      .map((taskId) => tasks.find((task) => task.id === taskId))
      .filter(Boolean)
      .slice(0, 3)
      .map((task) => getTaskTitle(task));

    setTaskToDelete({
      ids: uniqueIds,
      title: `${uniqueIds.length} tareas seleccionadas${previewTitles.length ? `: ${previewTitles.join(', ')}${uniqueIds.length > previewTitles.length ? '...' : ''}` : ''}`,
      isBulk: true,
      mode: 'bulk',
    });
  };

  const executeDeleteTask = async () => {
    if (!taskToDelete) return;
    setIsDeleting(true);
    setDeletionProgress({
      stage: 'Preparando eliminación',
      processed: 0,
      total: Math.max(taskToDelete.ids.length, 1),
      detail: 'Validando tareas seleccionadas',
    });

    try {
      const rootTasks = taskToDelete.ids
        .map((taskId) => tasks.find((task) => task.id === taskId))
        .filter(Boolean);

      if (rootTasks.length === 0) {
        setTaskToDelete(null);
        toast.error('No se encontraron tareas para eliminar.');
        return;
      }

      const collectTaskTreeFromLoadedTasks = async (rootTask: any, rootIndex: number) => {
        const taskMap = new Map<string, any>();
        const taskRefs = new Map<string, ReturnType<typeof doc>>();
        const localDependentIds = collectDependentTaskIds(rootTask.id);

        localDependentIds.forEach((taskId) => {
          const loadedTask = tasks.find((candidate) => candidate.id === taskId);
          if (!loadedTask) return;
          taskMap.set(taskId, loadedTask);
          taskRefs.set(taskId, doc(db, 'projects', projectId, 'tasks', taskId));
        });

        if (!taskMap.has(rootTask.id)) {
          taskMap.set(rootTask.id, rootTask);
          taskRefs.set(rootTask.id, doc(db, 'projects', projectId, 'tasks', rootTask.id));
        }

        setDeletionProgress({
          stage: 'Identificando dependientes',
          processed: rootIndex,
          total: rootTasks.length,
          detail: `${getTaskTitle(rootTask)} · ${taskMap.size} encontradas`,
        });
        await yieldToBrowser();

        return { taskMap, taskRefs };
      };

      const revertRateCard = (t: any, batchToUse: ReturnType<typeof writeBatch>) => {
        if (t.isRateCardTask && t.rateCardId && t.unitsToAdd) {
          if (!isWorkflowTaskType(t.type)) {
            const units = (t.progress / 100) * normalizeRateCardUnits(t.unitsToAdd, 0);
            if (units !== 0) {
              addTraceableRateCardMovementToBatch(batchToUse, {
                projectId,
                task: t,
                rateCardId: t.rateCardId,
                assignedTo: t.assignedTo || null,
                units,
                source: 'task_delete_reversal',
                rateCardSourceKey: `task_delete_reversal:${t.progress || 0}`,
                comment: 'Reverso registrado al eliminar o limpiar la tarea.',
                occurredAt: new Date(),
                actor: {
                  id: user?.uid || null,
                  email: user?.email || null,
                  name: user?.displayName || user?.email || null,
                },
                reversal: true,
                completionMode: 'task_delete_reversal',
              });
            }
          } else if (t.status === 'completed' || t.status === 'completed_late') {
            const units = normalizeRateCardUnits(t.unitsToAdd);
            addTraceableRateCardMovementToBatch(batchToUse, {
              projectId,
              task: t,
              rateCardId: t.rateCardId,
              assignedTo: t.assignedTo || null,
              units,
              source: 'workflow_task_delete_reversal',
              rateCardSourceKey: 'workflow_task_delete_reversal',
              comment: 'Reverso registrado al eliminar o limpiar el workflow.',
              occurredAt: new Date(),
              actor: {
                id: user?.uid || null,
                email: user?.email || null,
                name: user?.displayName || user?.email || null,
              },
              reversal: true,
              completionMode: 'workflow_task_delete_reversal',
            });
          }
        }

        // Revert step-level rate cards
        if (isWorkflowTaskType(t.type) && t.workflowSteps) {
          t.workflowSteps.forEach((step: any, stepIndex: number) => {
            const stepRateCardSources = getStaticRateCardSources(step);
            if (step.completed && stepRateCardSources.length > 0) {
              stepRateCardSources.forEach((stepRateCardSource) => {
                const units = normalizeRateCardUnits(stepRateCardSource.unitsToAdd);
                const stepAssignee = getStaticRateCardAssignee(stepRateCardSource, step.assignedTo);
                addTraceableRateCardMovementToBatch(batchToUse, {
                  projectId,
                  task: t,
                  rateCardId: stepRateCardSource.rateCardId,
                  assignedTo: stepAssignee || null,
                  units,
                  source: 'workflow_step_delete_reversal',
                  rateCardSourceKey: stepRateCardSource.key || `workflow_step_delete_reversal:${stepIndex}`,
                  stepIndex,
                  stepName: step?.name || step?.title || null,
                  comment: 'Reverso de paso registrado al eliminar o limpiar el workflow.',
                  occurredAt: new Date(),
                  actor: {
                    id: user?.uid || null,
                    email: user?.email || null,
                    name: user?.displayName || user?.email || null,
                  },
                  reversal: true,
                  completionMode: 'workflow_step_delete_reversal',
                });
              });
            }
          });
        }
      };

      const taskMap = new Map<string, any>();
      const taskRefs = new Map<string, ReturnType<typeof doc>>();

      for (let index = 0; index < rootTasks.length; index += 1) {
        const rootTask = rootTasks[index];
        const collected = await collectTaskTreeFromLoadedTasks(rootTask, index);
        collected.taskMap.forEach((taskToRemove, taskId) => {
          taskMap.set(taskId, taskToRemove);
        });
        collected.taskRefs.forEach((taskRef, taskId) => {
          taskRefs.set(taskId, taskRef);
        });

        setDeletionProgress({
          stage: 'Identificando dependientes',
          processed: index + 1,
          total: rootTasks.length,
          detail: `${taskMap.size} tareas y subtareas encontradas`,
        });
      }

      const taskIdsToDelete = new Set(taskMap.keys());
      const taskIdsToDeleteArray = Array.from(taskIdsToDelete);
      const parentTaskIdsToRefresh = new Set(
        rootTasks
          .map((rootTask: any) => rootTask.parentTaskId)
          .filter((parentTaskId: string | undefined): parentTaskId is string => typeof parentTaskId === 'string' && !taskIdsToDelete.has(parentTaskId))
      );

      setDeletionProgress({
        stage: 'Protegiendo historial asociado',
        processed: taskIdsToDeleteArray.length,
        total: taskIdsToDeleteArray.length,
        detail: 'Documentos, calidad y bitácora se conservan como historial para evitar tiempos de espera en proyectos pesados',
      });
      await yieldToBrowser();

      const taskEntriesToDelete = Array.from(taskMap.entries());
      for (let index = 0; index < taskEntriesToDelete.length; index += DELETE_TASK_CHUNK_SIZE) {
        const chunk = taskEntriesToDelete.slice(index, index + DELETE_TASK_CHUNK_SIZE);

        setDeletionProgress({
          stage: 'Eliminando tareas',
          processed: Math.min(index + chunk.length, taskEntriesToDelete.length),
          total: taskEntriesToDelete.length,
          detail: `${Math.min(index + chunk.length, taskEntriesToDelete.length)}/${taskEntriesToDelete.length} eliminadas`,
        });

        for (const [taskId] of chunk) {
          await deleteDoc(taskRefs.get(taskId) || doc(db, 'projects', projectId, 'tasks', taskId));
          await yieldToBrowser();
        }
      }

      let rateCardReversalFailed = false;
      for (let index = 0; index < taskEntriesToDelete.length; index += DELETE_RATE_REVERSAL_CHUNK_SIZE) {
        const chunk = taskEntriesToDelete.slice(index, index + DELETE_RATE_REVERSAL_CHUNK_SIZE);
        const rateBatch = writeBatch(db);

        chunk.forEach(([, taskToRemove]) => {
          revertRateCard(taskToRemove, rateBatch);
        });

        setDeletionProgress({
          stage: 'Ajustando rate cards',
          processed: Math.min(index + chunk.length, taskEntriesToDelete.length),
          total: taskEntriesToDelete.length,
          detail: `${Math.min(index + chunk.length, taskEntriesToDelete.length)}/${taskEntriesToDelete.length} revisadas`,
        });

        try {
          await rateBatch.commit();
        } catch (rateError) {
          rateCardReversalFailed = true;
          console.warn('No se pudieron registrar todos los reversos de rate cards durante la eliminación:', rateError);
          break;
        }
        await yieldToBrowser();
      }

      if (parentTaskIdsToRefresh.size > 0) {
        setDeletionProgress({
          stage: 'Recalculando tareas padre',
          processed: 0,
          total: parentTaskIdsToRefresh.size,
          detail: 'Actualizando progreso de matrices afectadas',
        });
        try {
          const { updateParentTaskStatus } = await import('@/lib/taskUtils');
          await Promise.all(Array.from(parentTaskIdsToRefresh).map((parentTaskId) => updateParentTaskStatus(projectId, parentTaskId)));
        } catch (parentRefreshError) {
          console.warn('No se pudieron recalcular todas las tareas padre después de eliminar:', parentRefreshError);
          toast.warning('Las tareas se eliminaron, pero algunas matrices padre podrían requerir recálculo al refrescar.');
        }
      }

      setTaskToDelete(null);
      toast.success(taskIdsToDelete.size > 1 ? `${taskIdsToDelete.size} tareas y dependientes eliminados correctamente` : "Tarea eliminada correctamente");
      if (rateCardReversalFailed) {
        toast.warning('Las tareas se eliminaron, pero algunos ajustes de rate cards deberán revisarse desde el panel de saneamiento.');
      }
    } catch (error: any) {
      console.error("Error deleting task:", error);
      toast.error(`Error al eliminar la tarea: ${error.message}`);
    } finally {
      setIsDeleting(false);
      setDeletionProgress(null);
    }
  };

  const handleReorderTasks = async (newTasks: any[]) => {
    if (!canEditTaskDetails) {
      toast.error('No tienes permisos para reordenar tareas.');
      return;
    }

    try {
      // Update local state first for immediate feedback
      setTasks(newTasks);

      // Update Supabase for each task that changed its order
      const promises = newTasks.map((task) => {
        return updateDoc(doc(db, 'projects', projectId, 'tasks', task.id), {
          displayOrder: task.displayOrder,
          groupId: task.groupId || null,
          updatedAt: serverTimestamp()
        });
      });

      await Promise.all(promises);
    } catch (error: any) {
      console.error("Error reordering tasks:", error);
    }
  };

  const handleUpdateTaskDates = async (taskId: string, start: Date, end: Date, task: any) => {
    if (!task) return;
    if (!canEditTaskDates) {
      toast.error('No tienes permisos para editar fechas de tareas.');
      return;
    }
    try {
      await updateDoc(doc(db, 'projects', projectId, 'tasks', taskId), {
        startDate: start,
        endDate: end,
        start,
        end,
        updatedAt: serverTimestamp()
      });
    } catch (error: any) {
      console.error("Error updating task dates:", error);
      toast.error(`Error al actualizar las fechas de la tarea: ${error.message}`);
    }
  };

  const handleUpdateTaskTitle = async (taskId: string, title: string, task: any) => {
    if (!task) return;
    if (!canEditTaskDetails && !canEditTaskStructure) {
      toast.error('No tienes permisos para editar el nombre de tareas.');
      return;
    }
    const cleanTitle = sanitizeTaskTitleForSave(task, title);
    if (!cleanTitle) {
      toast.warning('El nombre de la tarea no puede estar vacío.');
      return;
    }

    const titleUpdate = task.externalWorkflowId
      ? {
          title: task.externalWorkflowId,
          name: task.externalWorkflowId,
          originalTitle: cleanTitle,
        }
      : {
          title: cleanTitle,
          name: cleanTitle,
        };

    try {
      await updateDoc(doc(db, 'projects', projectId, 'tasks', taskId), {
        ...titleUpdate,
        updatedAt: serverTimestamp()
      });
      setTasks((currentTasks) =>
        currentTasks.map((currentTask) =>
          currentTask.id === taskId
            ? { ...currentTask, ...titleUpdate }
            : currentTask
        )
      );
      toast.success('Nombre de la tarea actualizado');
    } catch (error: any) {
      console.error("Error updating task title:", error);
      toast.error(`Error al actualizar el nombre: ${error.message}`);
    }
  };

  const handleRepairMissingTaskMatrix = async (matrixTask: any) => {
    if (!matrixTask?.isRecoveredMatrix) return;
    if (!canEditTaskDetails && !canEditTaskStructure) {
      toast.error('No tienes permisos para reparar matrices de tareas.');
      return;
    }

    const matrixTaskId = matrixTask.missingParentTaskId || matrixTask.id;
    if (!matrixTaskId) {
      toast.error('No se encontró el identificador de la matriz.');
      return;
    }

    const localChildTasks = tasks.filter((candidate) => candidate.parentTaskId === matrixTaskId);
    let childTasks = localChildTasks;

    try {
      const childSnapshot = await getDocs(
        query(collection(db, 'projects', projectId, 'tasks'), where('parentTaskId', '==', matrixTaskId))
      );
      const databaseChildTasks = childSnapshot.docs.map((childDoc) => ({ id: childDoc.id, ...childDoc.data() }));
      if (databaseChildTasks.length > childTasks.length) {
        childTasks = databaseChildTasks;
      }
    } catch (error) {
      console.warn('Could not load full matrix children before repair:', error);
    }

    if (childTasks.length === 0) {
      toast.error('No se encontraron subtareas asociadas a esta matriz.');
      return;
    }

    const firstChild = childTasks[0];
    const title = sanitizeTaskTitleForSave(
      { ...matrixTask, externalWorkflowId: null },
      matrixTask.originalTitle ||
        matrixTask.title ||
        firstChild.matrixTaskTitle ||
        firstChild.parentTaskTitle ||
        firstChild.parentTitle ||
        firstChild.originalTitle ||
        getTaskTitle(firstChild)
    );
    if (!title) {
      toast.warning('No fue posible inferir el nombre de la matriz.');
      return;
    }

    const childStartDates = childTasks
      .map((task) => getTaskDateValue(task.startDate || task.start))
      .filter((date): date is Date => Boolean(date));
    const childEndDates = childTasks
      .map((task) => getTaskDateValue(task.endDate || task.end))
      .filter((date): date is Date => Boolean(date));
    const fallbackDate = new Date();
    const startDate = childStartDates.length
      ? new Date(Math.min(...childStartDates.map((date) => date.getTime())))
      : getTaskDateValue(matrixTask.startDate || matrixTask.start) || fallbackDate;
    const endDate = childEndDates.length
      ? new Date(Math.max(...childEndDates.map((date) => date.getTime())))
      : getTaskDateValue(matrixTask.endDate || matrixTask.end) || startDate;
    const progress = Math.round(
      childTasks.reduce((sum, childTask) => sum + Number(childTask.progress || 0), 0) / childTasks.length
    );
    const allChildrenCompleted = childTasks.every((childTask) => isCompletedTaskStatus(childTask.status));
    const hasLateCompletion = childTasks.some((childTask) => childTask.status === 'completed_late');
    const hasPausedChild = childTasks.some((childTask) => childTask.status === 'stuck' || childTask.status === 'detenido');
    const hasStartedChild = childTasks.some((childTask) =>
      ['in_progress', 'en_curso', 'trabajando', 'reproceso', 'completed', 'completed_late', 'listo'].includes(childTask.status)
    );
    const status = allChildrenCompleted
      ? hasLateCompletion ? 'completed_late' : 'completed'
      : hasPausedChild ? 'stuck'
        : hasStartedChild ? 'in_progress'
          : 'todo';
    const repairToastId = toast.loading(`Reparando matriz "${title}"...`);

    try {
      const parentRef = doc(db, 'projects', projectId, 'tasks', matrixTaskId);
      const existingParent = await getDoc(parentRef);
      const existingParentData = existingParent.exists() ? existingParent.data() || {} : {};
      const structuralWorkflowSteps = Array.isArray(firstChild.workflowSteps)
        ? firstChild.workflowSteps.map(stripWorkflowStepRuntime)
        : [];
      const nowIso = new Date().toISOString();
      const matrixBase: any = {
        projectId,
        title,
        name: title,
        originalTitle: title,
        description: firstChild.description || matrixTask.description || '',
        startDate,
        endDate,
        start: startDate,
        end: endDate,
        assignedTo: firstChild.assignedTo || matrixTask.assignedTo || '',
        indicator: firstChild.indicator || null,
        indicatorValue: firstChild.indicatorValue || null,
        status,
        progress,
        type: isWorkflowTaskType(firstChild.type) ? firstChild.type : structuralWorkflowSteps.length > 0 ? 'workflow' : (firstChild.type || 'state'),
        requiresDocument: Boolean(firstChild.requiresDocument || matrixTask.requiresDocument),
        linkedDocumentId: null,
        isRateCardTask: Boolean(firstChild.isRateCardTask || matrixTask.isRateCardTask),
        rateCardMode: firstChild.rateCardMode || matrixTask.rateCardMode || null,
        dynamicRateCard: Boolean(firstChild.dynamicRateCard || matrixTask.dynamicRateCard),
        dynamicRateCardConfig: firstChild.dynamicRateCardConfig || matrixTask.dynamicRateCardConfig || null,
        rateCardId: firstChild.rateCardId || matrixTask.rateCardId || null,
        unitsToAdd: firstChild.unitsToAdd ?? matrixTask.unitsToAdd ?? null,
        autoAddUnits: firstChild.autoAddUnits !== false,
        syncExternal: Boolean(firstChild.syncExternal || matrixTask.syncExternal),
        priority: firstChild.priority || matrixTask.priority || 'medium',
        groupId: firstChild.groupId || matrixTask.groupId || null,
        currentValue: 0,
        parentTaskId: null,
        isParentTask: true,
        totalSubtasks: childTasks.length,
        totalCycles: Math.max(childTasks.length, Number(matrixTask.totalCycles || firstChild.totalCycles || 0)),
        workflowSteps: structuralWorkflowSteps,
        currentStepIndex: 0,
        workflowHistory: Array.isArray(existingParentData.workflowHistory) ? existingParentData.workflowHistory : [],
        workflowCycles: Math.max(childTasks.length, Number(matrixTask.totalCycles || firstChild.totalCycles || 1)),
        currentCycle: 1,
        externalWorkflowId: null,
        isRecoveredMatrix: false,
        missingParentTaskId: null,
        recoveredMatrix: true,
        recoveredChildCount: childTasks.length,
        recoveredBy: user?.uid || null,
        displayOrder: Math.min(...childTasks.map((childTask) => Number(childTask.displayOrder || 0)).filter((value) => Number.isFinite(value)), tasks.length) - 1,
      };
      const matrixPayload: any = {
        ...matrixBase,
        recoveredAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      if (!existingParent.exists()) {
        matrixPayload.createdAt = serverTimestamp();
        matrixPayload.createdBy = user?.uid || null;
      }

      toast.loading(`Guardando matriz padre de ${childTasks.length} subtareas...`, { id: repairToastId });
      await setDoc(parentRef, matrixPayload, { merge: true });

      toast.loading('Verificando reparación en Supabase...', { id: repairToastId });
      const savedParent = await getDoc(parentRef);
      if (!savedParent.exists()) {
        throw new Error('Supabase no confirmó la creación del documento matriz.');
      }

      const localMatrixTask = {
        id: matrixTaskId,
        ...existingParentData,
        ...matrixBase,
        recoveredAt: nowIso,
        updatedAt: nowIso,
        createdAt: existingParentData.createdAt || nowIso,
        createdBy: existingParentData.createdBy || user?.uid || null,
      };

      setTasks((currentTasks) => {
        if (currentTasks.some((currentTask) => currentTask.id === matrixTaskId)) {
          return currentTasks.map((currentTask) =>
            currentTask.id === matrixTaskId ? { ...currentTask, ...localMatrixTask } : currentTask
          );
        }

        return [localMatrixTask, ...currentTasks];
      });

      toast.loading('Recalculando progreso de la matriz...', { id: repairToastId });
      const { updateParentTaskStatus } = await import('@/lib/taskUtils');
      await updateParentTaskStatus(projectId, matrixTaskId);

      toast.success(`Matriz "${title}" reparada con ${childTasks.length} subtareas.`, { id: repairToastId });
    } catch (error: any) {
      console.error('Error repairing missing task matrix:', error);
      toast.error(error?.message || 'No se pudo reparar la matriz de tareas.', { id: repairToastId });
    }
  };

  const handleUpdateTaskPriority = async (taskId: string, priority: string, task: any) => {
    if (!task) return;
    if (!canEditTaskDetails) {
      toast.error('No tienes permisos para editar la prioridad de tareas.');
      return;
    }

    try {
      const taskRef = doc(db, 'projects', projectId, 'tasks', taskId);
      await updateDoc(taskRef, { priority, updatedAt: serverTimestamp() });
      toast.success('Prioridad actualizada');
    } catch (error) {
      console.error('Error updating task priority:', error);
      toast.error('Error al actualizar la prioridad');
    }
  };

  const handleUpdateTaskAssignee = async (taskId: string, assignedTo: string, task: any) => {
    if (!task) return;
    if (!canEditTaskDetails) {
      toast.error('No tienes permisos para editar el responsable de tareas.');
      return;
    }
    if (assignedTo && !projectAssignableTeamMembers.some((member) => member.id === assignedTo)) {
      toast.error('Solo puedes asignar personas que pertenezcan a la organización y al proyecto.');
      return;
    }

    try {
      const taskRef = doc(db, 'projects', projectId, 'tasks', taskId);
      await updateDoc(taskRef, { assignedTo, updatedAt: serverTimestamp() });
      if (assignedTo && assignedTo !== task.assignedTo && !isCompletedTaskStatus(task.status)) {
        void notifyTaskAssignment({
          projectId,
          taskId,
          assigneeId: assignedTo,
          eventType: 'task_assigned',
          source: 'task_assignee_changed',
        });
      }
      toast.success('Asignado actualizado');
    } catch (error) {
      console.error('Error updating task assignee:', error);
      toast.error('Error al actualizar el asignado');
    }
  };

  const handleCreateTaskGroup = async (name: string, color: string) => {
    if (!project) return;
    if (!canEditTaskDetails) {
      toast.error('No tienes permisos para administrar grupos.');
      return;
    }

    const cleanName = name.trim().replace(/\s+/g, ' ');
    if (!cleanName) {
      toast.warning('Ingresa el nombre del grupo.');
      return;
    }

    try {
      const nextGroups = [
        ...taskGroups,
        {
          id: `task_group_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: cleanName,
          color,
          order: taskGroups.length,
          createdAt: new Date().toISOString(),
          createdBy: user?.uid || null,
        },
      ];

      await updateDoc(doc(db, 'projects', projectId), {
        taskGroups: nextGroups,
        updatedAt: serverTimestamp(),
      });
      toast.success('Grupo creado.');
    } catch (error: any) {
      console.error('Error creating task group:', error);
      toast.error(error?.message || 'No se pudo crear el grupo.');
    }
  };

  const handleUpdateTaskGroupDefinition = async (groupId: string, updates: any) => {
    if (!project) return;
    if (!canEditTaskDetails) {
      toast.error('No tienes permisos para administrar grupos.');
      return;
    }

    const requestedName =
      typeof updates.name === 'string'
        ? updates.name.trim().replace(/\s+/g, ' ')
        : undefined;
    const existingGroup = taskGroups.find((group: any) => group.id === groupId);
    const now = new Date().toISOString();
    const nextGroups = existingGroup
      ? taskGroups.map((group: any) =>
          group.id === groupId
            ? {
                ...group,
                ...updates,
                name: requestedName || group.name,
                updatedAt: now,
              }
            : group
        )
      : [
          ...taskGroups,
          {
            id: groupId,
            name: requestedName || (groupId === DEFAULT_TASK_GROUP_ID ? DEFAULT_TASK_GROUP_NAME : 'Nuevo grupo'),
            color: updates.color || (groupId === DEFAULT_TASK_GROUP_ID ? DEFAULT_TASK_GROUP_COLOR : '#579bfc'),
            order: groupId === DEFAULT_TASK_GROUP_ID ? -1 : taskGroups.length,
            createdAt: now,
            createdBy: user?.uid || null,
            updatedAt: now,
          },
        ];

    try {
      await updateDoc(doc(db, 'projects', projectId), {
        taskGroups: nextGroups,
        updatedAt: serverTimestamp(),
      });
    } catch (error: any) {
      console.error('Error updating task group:', error);
      toast.error(error?.message || 'No se pudo actualizar el grupo.');
    }
  };

  const handleDeleteTaskGroup = async (groupId: string) => {
    if (!project) return;
    if (!canEditTaskDetails) {
      toast.error('No tienes permisos para administrar grupos.');
      return;
    }
    if (groupId === DEFAULT_TASK_GROUP_ID) {
      toast.warning('El grupo predeterminado no se puede eliminar, solo renombrar o cambiar de color.');
      return;
    }

    const group = taskGroups.find((candidate: any) => candidate.id === groupId);
    if (!group) return;

    const confirmed = window.confirm(`¿Eliminar el grupo "${group.name}"? Las tareas quedarán sin grupo.`);
    if (!confirmed) return;

    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'projects', projectId), {
        taskGroups: taskGroups.filter((candidate: any) => candidate.id !== groupId),
        updatedAt: serverTimestamp(),
      });

      tasks
        .filter((task) => task.groupId === groupId)
        .forEach((task) => {
          batch.update(doc(db, 'projects', projectId, 'tasks', task.id), {
            groupId: null,
            updatedAt: serverTimestamp(),
          });
        });

      await batch.commit();
      toast.success('Grupo eliminado.');
    } catch (error: any) {
      console.error('Error deleting task group:', error);
      toast.error(error?.message || 'No se pudo eliminar el grupo.');
    }
  };

  const handleUpdateTaskGroup = async (taskId: string, groupId: string, task: any) => {
    if (!task) return;
    if (!canEditTaskDetails) {
      toast.error('No tienes permisos para editar grupos de tareas.');
      return;
    }
    const normalizedGroupId = groupId === DEFAULT_TASK_GROUP_ID ? '' : groupId;
    if (normalizedGroupId && !taskGroups.some((group: any) => group.id === normalizedGroupId)) {
      toast.error('El grupo seleccionado no existe.');
      return;
    }

    try {
      await updateDoc(doc(db, 'projects', projectId, 'tasks', taskId), {
        groupId: normalizedGroupId || null,
        updatedAt: serverTimestamp(),
      });
      setTasks((currentTasks) =>
        currentTasks.map((currentTask) =>
          currentTask.id === taskId ? { ...currentTask, groupId: normalizedGroupId || null } : currentTask
        )
      );
      toast.success(normalizedGroupId ? 'Tarea agregada al grupo.' : 'Tarea agregada al grupo predeterminado.');
    } catch (error: any) {
      console.error('Error updating task group assignment:', error);
      toast.error(error?.message || 'No se pudo actualizar el grupo de la tarea.');
    }
  };

  const handleCreateSubtask = async (
    parentTask: any,
    subtask: {
      title: string;
      description: string;
      assignedTo: string;
      priority: string;
      status: string;
      startDate: string;
      endDate: string;
      completionForm?: CustomForm;
      isIncremental?: boolean;
      incrementIndicator?: string;
      incrementTarget?: number;
      incrementMode?: "manual" | "rate_card";
      incrementRateCardId?: string;
      incrementFilterByAssignee?: boolean;
      incrementAssigneeId?: string;
      incrementFilterByDate?: boolean;
      incrementStartDate?: string;
      incrementEndDate?: string;
    }
  ) => {
    if (!user || !parentTask) return;
    if (!canAddSubtasks) {
      toast.error('No tienes permisos para crear subtareas.');
      return;
    }

    const cleanTitle = subtask.title.trim();
    if (!cleanTitle) {
      toast.warning('Ingresa el nombre de la subtarea.');
      return;
    }

    const subtaskStartDate = new Date(`${subtask.startDate}T00:00:00`);
    const subtaskEndDate = new Date(`${subtask.endDate}T00:00:00`);
    if (Number.isNaN(subtaskStartDate.getTime()) || Number.isNaN(subtaskEndDate.getTime())) {
      toast.warning('Define fechas válidas para la subtarea.');
      return;
    }

    const currentSubtasks = tasks.filter((candidate) => candidate.parentTaskId === parentTask.id);
    const batch = writeBatch(db);
    const subtaskRef = doc(collection(db, 'projects', projectId, 'tasks'));
    const parentIsIncremental = parentTask.type === 'quantitative';
    const subtaskIsIncremental = parentIsIncremental && Boolean(subtask.isIncremental);
    const subtaskIncrementalRateBinding = subtaskIsIncremental && subtask.incrementMode === 'rate_card' && subtask.incrementRateCardId
      ? {
          enabled: true,
          rateCardId: subtask.incrementRateCardId,
          assigneeMode: subtask.incrementFilterByAssignee ? 'fixed' : 'any',
          assignedTo: subtask.incrementFilterByAssignee ? subtask.incrementAssigneeId || null : null,
          dateMode: subtask.incrementFilterByDate ? 'range' : 'any',
          startDate: subtask.incrementFilterByDate && subtask.incrementStartDate
            ? new Date(`${subtask.incrementStartDate}T00:00:00`)
            : null,
          endDate: subtask.incrementFilterByDate && subtask.incrementEndDate
            ? new Date(`${subtask.incrementEndDate}T23:59:59`)
            : null,
          activatedAt: new Date(),
        }
      : null;
    const subtaskStatus = parentIsIncremental ? 'todo' : subtask.status || 'todo';
    const progress = subtaskIsIncremental
      ? 0
      : subtaskStatus === 'completed' || subtaskStatus === 'completed_late'
        ? 100
        : subtaskStatus === 'in_progress'
          ? 10
          : 0;

    try {
      batch.set(subtaskRef, {
        projectId,
        title: cleanTitle,
        name: cleanTitle,
        description: subtask.description.trim(),
        startDate: subtaskStartDate,
        endDate: subtaskEndDate,
        start: subtaskStartDate,
        end: subtaskEndDate,
        assignedTo: subtask.assignedTo || parentTask.assignedTo || '',
        indicator: subtaskIsIncremental ? subtask.incrementIndicator || parentTask.indicator || 'avance' : null,
        indicatorValue: subtaskIsIncremental ? Number(subtask.incrementTarget || 0) : null,
        status: subtaskStatus,
        progress,
        type: subtaskIsIncremental ? 'quantitative' : 'state',
        requiresDocument: false,
        linkedDocumentId: null,
        isRateCardTask: false,
        rateCardMode: null,
        dynamicRateCard: false,
        dynamicRateCardConfig: null,
        completionForm: subtask.completionForm || null,
        completionFormData: null,
        completionRateCardLastCharges: [],
        rateCardId: null,
        unitsToAdd: null,
        autoAddUnits: true,
        syncExternal: false,
        priority: subtask.priority || parentTask.priority || 'medium',
        groupId: parentTask.groupId || null,
        currentValue: 0,
        incrementForm: null,
        incrementalRateBinding: subtaskIncrementalRateBinding,
        incrementSource: subtaskIsIncremental ? (subtaskIncrementalRateBinding ? 'rate_card' : 'manual') : null,
        incrementHistory: subtaskIsIncremental ? [] : null,
        incrementDelegatedFromParentTaskId: subtaskIsIncremental ? parentTask.id : null,
        parentTaskId: parentTask.id,
        displayOrder: tasks.length + currentSubtasks.length + 1,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: user.uid,
      });

      batch.update(doc(db, 'projects', projectId, 'tasks', parentTask.id), {
        isParentTask: true,
        totalSubtasks: currentSubtasks.length + 1,
        incrementDelegatedToSubtasks: parentIsIncremental ? true : Boolean(parentTask.incrementDelegatedToSubtasks),
        ...(parentIsIncremental
          ? {
              indicator: 'avance subtareas',
              indicatorValue: 100,
              currentValue: Number(parentTask.progress || 0),
              incrementSource: 'subtasks',
              incrementalRateBinding: null,
              incrementForm: null,
            }
          : {}),
        updatedAt: serverTimestamp(),
      });

      await batch.commit();

      const { updateParentTaskStatus } = await import('@/lib/taskUtils');
      await updateParentTaskStatus(projectId, parentTask.id);

      toast.success('Subtarea creada correctamente.');
    } catch (error: any) {
      console.error("Error creating subtask:", error);
      toast.error(`Error al crear la subtarea: ${error.message}`);
      throw error;
    }
  };

  const handleUpdateSubtaskCompletionForm = async (subtask: any, form: CustomForm | undefined) => {
    if (!subtask?.id) return;
    if (!canEditTaskStructure && !canAddSubtasks) {
      toast.error('No tienes permisos para modificar formularios de subtareas.');
      return;
    }

    try {
      await updateDoc(doc(db, 'projects', projectId, 'tasks', subtask.id), {
        completionForm: form || null,
        updatedAt: serverTimestamp(),
      });
      toast.success(form ? 'Formulario de subtarea actualizado.' : 'Formulario de subtarea eliminado.');
    } catch (error: any) {
      console.error('Error updating subtask completion form:', error);
      toast.error(error?.message || 'No se pudo actualizar el formulario de la subtarea.');
      throw error;
    }
  };

  const handleUpdateTaskStructure = async (
    task: any,
    updates: {
      title: string;
      quantitative?: { indicator: string; indicatorValue: number };
      workflowSteps?: any[];
      workflowScheduleMode?: string;
      workflowDayCountingEnabled?: boolean;
      rateCard?: any;
      incrementalRateBinding?: any;
    }
  ) => {
    if (!task) return;

    if (!canEditTaskStructure) {
      toast.error('No tienes permisos para editar la estructura de tareas.');
      return;
    }

    const cleanTitle = sanitizeTaskTitleForSave(task, updates.title);
    if (!cleanTitle) {
      toast.warning('El nombre de la tarea no puede estar vacío.');
      return;
    }

    const shouldUpdateWorkflow = Array.isArray(updates.workflowSteps);
    const workflowScheduleMode = normalizeWorkflowScheduleMode(updates.workflowScheduleMode || task.workflowScheduleMode);
    const workflowDayCountingEnabled = normalizeWorkflowDayCountingEnabled(
      updates.workflowDayCountingEnabled ?? task.workflowDayCountingEnabled
    );
    const structuralSteps = shouldUpdateWorkflow
      ? updates.workflowSteps!.map(stripWorkflowStepRuntime)
      : [];
    const dependentTaskIds = shouldUpdateWorkflow ? collectDependentTaskIds(task.id) : new Set<string>([task.id]);
    const hasIncrementalSubtasks =
      task.type === 'quantitative' &&
      !task.parentTaskId &&
      tasks.some((candidate) => candidate.parentTaskId === task.id);

    try {
      const batch = writeBatch(db);

      dependentTaskIds.forEach((taskId) => {
        const currentTask = tasks.find((candidate) => candidate.id === taskId);
        if (!currentTask) return;
        const isWorkflowIteration = Boolean(currentTask.externalWorkflowId);
        const isEditedIncrementalParent = currentTask.id === task.id && hasIncrementalSubtasks;

        const updateData: any = {
          title: isWorkflowIteration ? currentTask.externalWorkflowId : cleanTitle,
          name: isWorkflowIteration ? currentTask.externalWorkflowId : cleanTitle,
          updatedAt: serverTimestamp(),
        };
        if (isWorkflowIteration) {
          updateData.originalTitle = cleanTitle;
        }

        if (shouldUpdateWorkflow && taskReceivesWorkflowStructure(currentTask)) {
          const updatedSteps = structuralSteps.map((step, index) =>
            mergeWorkflowStepStructure(currentTask.workflowSteps?.[index], step, index)
          );
          const referenceWorkflowSteps = applyWorkflowStepReferenceDurations(updatedSteps);
          const taskStartDate = getTaskDateValue(currentTask.startDate || currentTask.start);
          const scheduledWorkflow = workflowDayCountingEnabled && taskStartDate
            ? applyWorkflowStepSchedule(updatedSteps, taskStartDate, workflowScheduleMode)
            : null;
          updateData.workflowSteps = scheduledWorkflow?.steps || referenceWorkflowSteps;
          updateData.workflowScheduleMode = workflowScheduleMode;
          updateData.workflowDayCountingEnabled = workflowDayCountingEnabled;
          updateData.workflowTotalPlannedDays =
            scheduledWorkflow?.workflowTotalPlannedDays || getWorkflowTotalPlannedDays(referenceWorkflowSteps);
          if (scheduledWorkflow) {
            updateData.startDate = scheduledWorkflow.workflowStartDate;
            updateData.start = scheduledWorkflow.workflowStartDate;
            updateData.endDate = scheduledWorkflow.workflowEndDate;
            updateData.end = scheduledWorkflow.workflowEndDate;
          }
          updateData.currentStepIndex =
            updatedSteps.length > 0
              ? Math.min(currentTask.currentStepIndex || 0, updatedSteps.length - 1)
              : 0;
        }

        if (updates.rateCard) {
          updateData.isRateCardTask = updates.rateCard.isRateCardTask;
          updateData.rateCardMode = updates.rateCard.rateCardMode;
          updateData.dynamicRateCard = updates.rateCard.dynamicRateCard;
          updateData.dynamicRateCardConfig = updates.rateCard.dynamicRateCardConfig;
          updateData.rateCardId = updates.rateCard.rateCardId;
          updateData.unitsToAdd = updates.rateCard.unitsToAdd;
          updateData.autoAddUnits = updates.rateCard.autoAddUnits;
          updateData.syncExternal = updates.rateCard.rateCardId
            ? Boolean(rateCards.find((rateCard) => rateCard.id === updates.rateCard.rateCardId)?.syncExternal)
            : false;
        }

        if (updates.quantitative && currentTask.id === task.id) {
          updateData.indicator = isEditedIncrementalParent ? 'avance subtareas' : updates.quantitative.indicator;
          updateData.indicatorValue = isEditedIncrementalParent ? 100 : Number(updates.quantitative.indicatorValue);
          if (isEditedIncrementalParent) {
            updateData.currentValue = Number(currentTask.progress || 0);
          }
        }

        if (isEditedIncrementalParent) {
          updateData.incrementalRateBinding = null;
          updateData.incrementSource = 'subtasks';
          updateData.incrementDelegatedToSubtasks = true;
          updateData.incrementForm = null;
        } else {
          updateData.incrementalRateBinding = updates.incrementalRateBinding || null;
          updateData.incrementSource = updates.incrementalRateBinding ? 'rate_card' : 'manual';
        }

        batch.update(doc(db, 'projects', projectId, 'tasks', taskId), updateData);
      });

      await batch.commit();
      await syncRateDrivenTasksForRateIds(
        [updates.incrementalRateBinding?.rateCardId],
        { fetchFreshTasks: true },
      );

      setTasks((currentTasks) =>
        currentTasks.map((currentTask) => {
          if (!dependentTaskIds.has(currentTask.id)) return currentTask;
          const isEditedIncrementalParent = currentTask.id === task.id && hasIncrementalSubtasks;

          const updatedTask: any = {
            ...currentTask,
          };

          updatedTask.title = currentTask.externalWorkflowId ? currentTask.externalWorkflowId : cleanTitle;
          updatedTask.name = currentTask.externalWorkflowId ? currentTask.externalWorkflowId : cleanTitle;
          if (currentTask.externalWorkflowId) {
            updatedTask.originalTitle = cleanTitle;
          }

          if (shouldUpdateWorkflow && taskReceivesWorkflowStructure(currentTask)) {
            const updatedSteps = structuralSteps.map((step, index) =>
              mergeWorkflowStepStructure(currentTask.workflowSteps?.[index], step, index)
            );
            const referenceWorkflowSteps = applyWorkflowStepReferenceDurations(updatedSteps);
            const taskStartDate = getTaskDateValue(currentTask.startDate || currentTask.start);
            const scheduledWorkflow = workflowDayCountingEnabled && taskStartDate
              ? applyWorkflowStepSchedule(updatedSteps, taskStartDate, workflowScheduleMode)
              : null;
            updatedTask.workflowSteps = scheduledWorkflow?.steps || referenceWorkflowSteps;
            updatedTask.workflowScheduleMode = workflowScheduleMode;
            updatedTask.workflowDayCountingEnabled = workflowDayCountingEnabled;
            updatedTask.workflowTotalPlannedDays =
              scheduledWorkflow?.workflowTotalPlannedDays || getWorkflowTotalPlannedDays(referenceWorkflowSteps);
            if (scheduledWorkflow) {
              updatedTask.startDate = scheduledWorkflow.workflowStartDate;
              updatedTask.start = scheduledWorkflow.workflowStartDate;
              updatedTask.endDate = scheduledWorkflow.workflowEndDate;
              updatedTask.end = scheduledWorkflow.workflowEndDate;
            }
            updatedTask.currentStepIndex =
              updatedSteps.length > 0
                ? Math.min(currentTask.currentStepIndex || 0, updatedSteps.length - 1)
                : 0;
          }

          if (updates.rateCard) {
            updatedTask.isRateCardTask = updates.rateCard.isRateCardTask;
            updatedTask.rateCardMode = updates.rateCard.rateCardMode;
            updatedTask.dynamicRateCard = updates.rateCard.dynamicRateCard;
            updatedTask.dynamicRateCardConfig = updates.rateCard.dynamicRateCardConfig;
            updatedTask.rateCardId = updates.rateCard.rateCardId;
            updatedTask.unitsToAdd = updates.rateCard.unitsToAdd;
            updatedTask.autoAddUnits = updates.rateCard.autoAddUnits;
            updatedTask.syncExternal = updates.rateCard.rateCardId
              ? Boolean(rateCards.find((rateCard) => rateCard.id === updates.rateCard.rateCardId)?.syncExternal)
              : false;
          }

          if (updates.quantitative && currentTask.id === task.id) {
            updatedTask.indicator = isEditedIncrementalParent ? 'avance subtareas' : updates.quantitative.indicator;
            updatedTask.indicatorValue = isEditedIncrementalParent ? 100 : Number(updates.quantitative.indicatorValue);
            if (isEditedIncrementalParent) {
              updatedTask.currentValue = Number(currentTask.progress || 0);
            }
          }

          if (isEditedIncrementalParent) {
            updatedTask.incrementalRateBinding = null;
            updatedTask.incrementSource = 'subtasks';
            updatedTask.incrementDelegatedToSubtasks = true;
            updatedTask.incrementForm = null;
          } else {
            updatedTask.incrementalRateBinding = updates.incrementalRateBinding || null;
            updatedTask.incrementSource = updatedTask.incrementalRateBinding ? 'rate_card' : 'manual';
          }

          return updatedTask;
        })
      );

      toast.success(
        dependentTaskIds.size === 1
          ? 'Estructura de tarea actualizada.'
          : `Estructura replicada en ${dependentTaskIds.size} tareas dependientes.`
      );
    } catch (error: any) {
      console.error("Error updating task structure:", error);
      toast.error(`Error al actualizar la estructura: ${error.message}`);
      throw error;
    }
  };

  const handleResetWorkflowTask = async (task: any) => {
    if (!task || !isWorkflowTaskType(task.type)) return;

    if (!canEditTaskDetails) {
      toast.error('No tienes permisos para reiniciar workflows.');
      return;
    }

    const confirmed = window.confirm(
      `¿Reiniciar el flujo "${getTaskTitle(task)}"? La tarea volverá a Pendiente y se limpiará el avance actual.`
    );
    if (!confirmed) return;

    try {
      const batch = writeBatch(db);
      const taskRef = doc(db, 'projects', projectId, 'tasks', task.id);
      const actionAt = new Date();
      const affectedRateCardIds = new Set<string>();
      const actor = {
        id: user?.uid || null,
        email: user?.email || null,
        name: currentActorName,
      };

      (task.workflowSteps || []).forEach((step: any, stepIndex: number) => {
        const stepRateCardSources = getStaticRateCardSources(step);
        if (step.status === 'listo' && stepRateCardSources.length > 0) {
          stepRateCardSources.forEach((stepRateCardSource) => {
            const stepUnits = normalizeRateCardUnits(stepRateCardSource.unitsToAdd);
            const stepAssignee = getStaticRateCardAssignee(stepRateCardSource, step.assignedTo);
            if (stepAssignee && stepUnits > 0) {
              addTraceableRateCardMovementToBatch(batch, {
                projectId,
                task,
                rateCardId: stepRateCardSource.rateCardId,
                assignedTo: stepAssignee,
                units: stepUnits,
                source: 'workflow_reset_step_reversal',
                rateCardSourceKey: stepRateCardSource.key,
                stepIndex,
                stepName: step.name || step.title || step.label || `Paso ${stepIndex + 1}`,
                comment: 'Reverso automático por reinicio completo del workflow.',
                occurredAt: actionAt,
                actor,
                reversal: true,
                completionMode: 'workflow_reset',
              });
              affectedRateCardIds.add(stepRateCardSource.rateCardId);
            }
          });
        }
      });

      if ((task.status === 'completed' || task.status === 'completed_late') && task.isRateCardTask && task.rateCardId) {
        const taskUnits = normalizeRateCardUnits(task.unitsToAdd);
        if (task.assignedTo && taskUnits > 0) {
          addTraceableRateCardMovementToBatch(batch, {
            projectId,
            task,
            rateCardId: task.rateCardId,
            assignedTo: task.assignedTo,
            units: taskUnits,
            source: 'workflow_reset_task_reversal',
            rateCardSourceKey: 'task:workflow-completion',
            comment: 'Reverso automático del Rate Card de la tarea por reinicio del workflow.',
            occurredAt: actionAt,
            actor,
            reversal: true,
            completionMode: 'workflow_reset',
          });
          affectedRateCardIds.add(task.rateCardId);
        }
      }

      const resetTitle = task.originalTitle || getTaskTitle(task);
      const resetHistoryEntry = {
        action: 'reset',
        comment: 'Workflow reiniciado',
        userId: user?.uid || null,
        userEmail: user?.email || null,
        userName: currentActorName,
        timestamp: new Date().toISOString(),
      };

      batch.update(taskRef, {
        title: resetTitle,
        name: resetTitle,
        status: 'todo',
        progress: 0,
        currentStepIndex: 0,
        workflowSteps: (task.workflowSteps || []).map(resetWorkflowStepRuntime),
        workflowHistory: [resetHistoryEntry, ...(task.workflowHistory || [])],
        completedAt: null,
        completedBy: null,
        completedByMemberId: null,
        externalWorkflowId: null,
        initialObservation: null,
        startDocumentId: null,
        linkedDocumentId: null,
        updatedAt: serverTimestamp(),
      });

      await batch.commit();

      await Promise.all(
        Array.from(affectedRateCardIds).map((rateCardId) =>
          syncRateDrivenIncrementalTasksForRate({ projectId, rateCardId }),
        ),
      );

      if (task.parentTaskId) {
        const { updateParentTaskStatus } = await import('@/lib/taskUtils');
        await updateParentTaskStatus(projectId, task.parentTaskId);
      }

      toast.success('Workflow reiniciado correctamente.');
    } catch (error: any) {
      console.error('Error resetting workflow task:', error);
      toast.error(error?.message || 'No se pudo reiniciar el workflow.');
      throw error;
    }
  };

  const getDocTypeBadge = (type: string) => {
    switch (type) {
      case 'contract': return <span className="bg-indigo-50 text-indigo-700 px-2 py-1 rounded-md text-xs font-medium">Contrato</span>;
      case 'proposal': return <span className="bg-emerald-50 text-emerald-700 px-2 py-1 rounded-md text-xs font-medium">Propuesta</span>;
      case 'other': return <span className="bg-slate-100 text-slate-700 px-2 py-1 rounded-md text-xs font-medium">Otro</span>;
      default: return <span className="bg-slate-100 text-slate-700 px-2 py-1 rounded-md text-xs font-medium">{type}</span>;
    }
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64 text-slate-500">
          Cargando detalles del proyecto...
        </div>
      </DashboardLayout>
    );
  }

  if (!project) {
    return (
      <DashboardLayout>
        <div className="mx-auto flex min-h-[420px] max-w-xl items-center justify-center px-4">
          <Card className="w-full border-amber-200 shadow-sm">
            <CardContent className="flex flex-col items-center px-6 py-10 text-center">
              <div className="rounded-full bg-amber-50 p-3 text-amber-600">
                <AlertCircle size={28} />
              </div>
              <h1 className="mt-4 text-xl font-black text-slate-900">No pudimos abrir el proyecto</h1>
              <p className="mt-2 max-w-md text-sm font-medium leading-6 text-slate-500">
                {projectLoadError || 'La conexión no devolvió los datos del proyecto.'}
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push('/projects')}
                >
                  Volver a proyectos
                </Button>
                <Button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="bg-indigo-600 text-white hover:bg-indigo-700"
                >
                  <RefreshCw size={15} className="mr-2" />
                  Reintentar
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  // Check if minimum required documents are present
  const hasContract = documents.some(d => d.type === 'contract');
  const hasProposal = documents.some(d => d.type === 'proposal');
  const missingRequiredDocuments = documentsLoaded
    ? [
        !hasContract ? 'Contrato firmado' : null,
        !hasProposal ? 'Propuesta técnica/comercial' : null,
      ].filter(Boolean) as string[]
    : [];
  const pendingRateCardTask = dynamicRateCardStatusChange?.task || null;
  const pendingManualStaticRateCard = pendingRateCardTask ? isManualStaticRateCardEnabled(pendingRateCardTask) : false;
  const lockPendingRateCardAssignee = Boolean(pendingManualStaticRateCard && pendingRateCardTask?.assignedTo);
  const lockPendingRateCardProfile = Boolean(pendingManualStaticRateCard && pendingRateCardTask?.rateCardId);
  const pendingRateCardRequestsUnits = pendingRateCardTask ? shouldRequestDynamicRateCardUnits(pendingRateCardTask) : false;
  const standardProjectTasks = isSoftwareProject(project)
    ? tasks.filter((task) => !isScrumTask(task))
    : tasks;

  return (
    <DashboardLayout>
      <div className="mb-4">
        <Link href="/projects" className="inline-flex items-center text-sm text-slate-500 hover:text-indigo-600 mb-3 transition-colors">
          <ArrowLeft size={16} className="mr-1" /> Volver a Proyectos
        </Link>
        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-bold tracking-tight text-slate-900">{project.name}</h1>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                project.status === 'active' ? 'bg-amber-100 text-amber-800' :
                project.status === 'completed' ? 'bg-emerald-100 text-emerald-800' :
                'bg-slate-100 text-slate-800'
              }`}>
                {project.status === 'active' ? 'Activo' : project.status === 'completed' ? 'Completado' : 'En Pausa'}
              </span>
            </div>
            <p className="mt-1 max-w-3xl truncate text-sm text-slate-500">{project.description || 'Sin descripción'}</p>
          </div>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <span className="rounded-md bg-slate-50 px-2.5 py-1">{tasks.length} tareas</span>
            {missingRequiredDocuments.length > 0 && (
              <button
                type="button"
                onClick={() => setShowDocumentIssueAlert(true)}
                className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2.5 py-1 font-semibold text-amber-700 transition-colors hover:bg-amber-100"
              >
                <AlertCircle size={13} />
                {missingRequiredDocuments.length} alerta{missingRequiredDocuments.length > 1 ? 's' : ''}
              </button>
            )}
          </div>
        </div>
      </div>

      {missingRequiredDocuments.length > 0 && showDocumentIssueAlert && (
        <div className="fixed right-5 top-20 z-40 w-[min(360px,calc(100vw-2.5rem))] rounded-xl border border-amber-200 bg-white p-4 shadow-2xl">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-full bg-amber-50 p-2 text-amber-600">
              <AlertCircle size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Documentación pendiente</h3>
                  <p className="mt-1 text-xs text-slate-500">Faltan documentos obligatorios del proyecto.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowDocumentIssueAlert(false)}
                  className="rounded-full p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Cerrar alerta"
                >
                  <X size={15} />
                </button>
              </div>
              <div className="mt-3 space-y-1">
                {missingRequiredDocuments.map((documentName) => (
                  <div key={documentName} className="rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
                    {documentName}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('documents');
                  setShowDocumentIssueAlert(false);
                }}
                className="mt-3 inline-flex h-8 items-center rounded-md bg-indigo-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-indigo-700"
              >
                Ir a Documentos
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mb-5 rounded-xl border border-slate-200 bg-white px-2 shadow-sm">
        <div className="flex gap-1 overflow-x-auto">
          <button
            onClick={() => setActiveTab('tasks')}
            className={`min-h-11 whitespace-nowrap rounded-lg px-3 text-sm font-semibold transition-colors ${
              activeTab === 'tasks'
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
            }`}
          >
            <div className="flex items-center gap-2">
              <Calendar size={16} />
              Tareas
            </div>
          </button>
          {isSoftwareProject(project) && (
            <button
              onClick={() => setActiveTab('scrum')}
              className={`min-h-11 whitespace-nowrap rounded-lg px-3 text-sm font-semibold transition-colors ${
                activeTab === 'scrum'
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <Code2 size={16} />
                Scrum
              </div>
            </button>
          )}
          <button
            onClick={() => setActiveTab('documents')}
            className={`min-h-11 whitespace-nowrap rounded-lg px-3 text-sm font-semibold transition-colors ${
              activeTab === 'documents'
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
            }`}
          >
            <div className="flex items-center gap-2">
              <FileText size={16} />
              Documentos
            </div>
          </button>
          <button
            onClick={() => setActiveTab('drive')}
            className={`min-h-11 whitespace-nowrap rounded-lg px-3 text-sm font-semibold transition-colors ${
              activeTab === 'drive'
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
            }`}
          >
            <div className="flex items-center gap-2">
              <Link2 size={16} />
              Drive
            </div>
          </button>
          {canViewProjectInventory && (
            <button
              onClick={() => setActiveTab('inventory')}
              className={`min-h-11 whitespace-nowrap rounded-lg px-3 text-sm font-semibold transition-colors ${
                activeTab === 'inventory'
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <Package size={16} />
                Inventario
              </div>
            </button>
          )}
          <button
            onClick={() => setActiveTab('map')}
            className={`min-h-11 whitespace-nowrap rounded-lg px-3 text-sm font-semibold transition-colors ${
              activeTab === 'map'
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
            }`}
          >
            <div className="flex items-center gap-2">
              <MapIcon size={16} />
              Mapa
            </div>
          </button>
          <button
            onClick={() => setActiveTab('logbook')}
            className={`min-h-11 whitespace-nowrap rounded-lg px-3 text-sm font-semibold transition-colors ${
              activeTab === 'logbook'
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
            }`}
          >
            <div className="flex items-center gap-2">
              <BookOpen size={16} />
              Bitácora
            </div>
          </button>
          <button
            onClick={() => setActiveTab('quality')}
            className={`min-h-11 whitespace-nowrap rounded-lg px-3 text-sm font-semibold transition-colors ${
              activeTab === 'quality'
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
            }`}
          >
            <div className="flex items-center gap-2">
              <ShieldCheck size={16} />
              Gestión de calidad
            </div>
          </button>
          <button
            onClick={() => setActiveTab('rateCards')}
            className={`min-h-11 whitespace-nowrap rounded-lg px-3 text-sm font-semibold transition-colors ${
              activeTab === 'rateCards'
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
            }`}
          >
            <div className="flex items-center gap-2">
              <CreditCard size={16} />
              Rate Cards
            </div>
          </button>
          {canAccessProjectBudget && (
            <button
              onClick={() => setActiveTab('budget')}
              className={`min-h-11 whitespace-nowrap rounded-lg px-3 text-sm font-semibold transition-colors ${
                activeTab === 'budget'
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <DollarSign size={16} />
                Presupuesto
              </div>
            </button>
          )}
          {canViewProjectAdministration && (
            <button
              onClick={() => setActiveTab('administration')}
              className={`min-h-11 whitespace-nowrap rounded-lg px-3 text-sm font-semibold transition-colors ${
                activeTab === 'administration'
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <BriefcaseBusiness size={16} />
                Administrativo
              </div>
            </button>
          )}
          <button
            onClick={() => setActiveTab('billing')}
            className={`min-h-11 whitespace-nowrap rounded-lg px-3 text-sm font-semibold transition-colors ${
              activeTab === 'billing'
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
            }`}
          >
            <div className="flex items-center gap-2">
              <FileText size={16} />
              Facturación
            </div>
          </button>
          <button
            onClick={() => setActiveTab('orgChart')}
            className={`min-h-11 whitespace-nowrap rounded-lg px-3 text-sm font-semibold transition-colors ${
              activeTab === 'orgChart'
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
            }`}
          >
            <div className="flex items-center gap-2">
              <Users size={16} />
              Organigrama
            </div>
          </button>
        </div>
      </div>

      {activeTab === 'documents' && (
        <div className="space-y-6">
          {!canViewDocuments ? (
            <Card className="border-slate-200 shadow-sm">
              <CardContent className="flex flex-col items-center justify-center px-6 py-16 text-center">
                <ShieldCheck className="mb-4 h-12 w-12 text-slate-300" />
                <h3 className="text-xl font-black text-slate-900">Documentación protegida</h3>
                <p className="mt-2 max-w-lg text-sm font-medium text-slate-500">
                  Tu rol no tiene habilitado el acceso a los documentos de este proyecto.
                </p>
              </CardContent>
            </Card>
          ) : !documentsLoaded ? (
            <Card className="border-slate-200 shadow-sm">
              <CardContent className="flex items-center justify-center gap-3 px-6 py-16 text-sm font-semibold text-slate-500">
                <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
                Cargando documentos del proyecto...
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex flex-col items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center">
                <div className="relative w-full sm:w-96">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Buscar por nombre, archivo o tarea..."
                    value={documentSearchQuery}
                    onChange={(e) => setDocumentSearchQuery(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-4 text-sm transition-all focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
                {canUploadDocuments && (
                  <Button
                    onClick={() => openUploadDocumentModal(null)}
                    className="w-full bg-indigo-600 text-white hover:bg-indigo-700 sm:w-auto"
                  >
                    <Upload size={16} className="mr-2" />
                    Subir Documento
                  </Button>
                )}
              </div>

              <Card className="border-slate-200 shadow-sm">
                <CardHeader className="border-b border-slate-100 bg-slate-50/50 pb-4">
                  <CardTitle className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                    <Folder size={18} className="text-indigo-500" />
                    Gestor documental del proyecto
                  </CardTitle>
                  <CardDescription className="text-sm text-slate-500">
                    Documentos organizados por proyecto, tareas y subtareas, listos para S3.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-4">
                  <ProjectDocumentsTree
                    documents={documents}
                    tasks={tasks}
                    onDeleteDocument={confirmDeleteDocument}
                    onViewDocument={setPreviewDocument}
                    onCreateFolder={handleCreateDocumentFolder}
                    onUploadToFolder={openUploadDocumentModal}
                    onUpdateFolderAccess={handleUpdateDocumentFolderAccess}
                    searchQuery={documentSearchQuery}
                    currentUser={user}
                    teamMembers={projectAssignableTeamMembers}
                    canManageAccess={canManageDocumentAccess}
                    canDeleteDocuments={canDeleteDocuments}
                    canCreateFolders={canUploadDocuments}
                  />
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}

      {activeTab === 'drive' && (
        <ProjectDriveRepositories
          projectId={projectId}
          project={project}
          teamMembers={teamMembers}
          currentUser={user}
          canManage={canManageDriveRepositories}
        />
      )}

      {activeTab === 'inventory' && (
        <ProjectInventory
          projectId={projectId}
          project={project}
          teamMembers={projectAssignableTeamMembers}
          currentUser={user}
          canView={canViewProjectInventory}
          canManage={canManageInventory}
        />
      )}

      {activeTab === 'map' && (
        <ProjectSpatialMap
          projectId={projectId}
          project={project}
          tasks={tasks}
          teamMembers={projectAssignableTeamMembers}
          taskGroups={taskGroups}
          currentUser={user}
          canManage={canEditTaskDetails}
        />
      )}

      {activeTab === 'logbook' && (
        <ProjectLogbook
          projectId={projectId}
          project={project}
          tasks={tasks}
          teamMembers={projectAssignableTeamMembers}
          currentUser={user}
          canCreateTasks={canCreateTasks}
          canAddSubtasks={canAddSubtasks}
          canDeleteEntries={canDeleteLogbookEntries}
        />
      )}

      {activeTab === 'quality' && (
        <ProjectQuality
          projectId={projectId}
          teamMembers={projectAssignableTeamMembers}
          currentUser={user}
          canManage={canEditTaskStructure}
        />
      )}

      {activeTab === 'scrum' && isSoftwareProject(project) && (
        <ProjectScrum
          projectId={projectId}
          project={project}
          tasks={tasks}
          teamMembers={projectAssignableTeamMembers}
          currentUser={user}
          canCreateItems={canCreateTasks}
          canManage={canEditTaskDetails}
          canMoveItems={canEditTaskStatus}
          canManageLifecycle={canManageScrumLifecycle}
          canViewDocuments={canViewDocuments}
          canUploadDocuments={canUploadDocuments}
          canManageDocumentAccess={canManageDocumentAccess}
          canDeleteDocuments={canDeleteDocuments}
        />
      )}

      {activeTab === 'tasks' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <Calendar size={20} className="text-indigo-500" />
                Tareas
              </h2>
              <p className="text-sm text-slate-500 mt-1">Seguimiento y progreso de las tareas del proyecto.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setIsTaskStatusReportOpen(true)}
                disabled={standardProjectTasks.length === 0}
                className="border-indigo-100 text-indigo-700 hover:bg-indigo-50"
              >
                <BarChart3 size={16} className="mr-2" />
                Indicadores
              </Button>
              {canCreateTasks && (
                <Button
                  onClick={() => setIsCreateTaskModalOpen(true)}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  <Plus size={16} className="mr-2" />
                  {isSoftwareProject(project) ? 'Nueva tarea general' : 'Nueva Tarea'}
                </Button>
              )}
            </div>
          </div>

          {isSoftwareProject(project) && (
            <div className="flex flex-col gap-3 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-950 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-black">El trabajo del sprint se gestiona en Desarrollo</p>
                <p className="mt-0.5 text-xs leading-5 text-indigo-700">Esta vista conserva únicamente tareas operativas generales para evitar avances duplicados o estados Scrum desincronizados.</p>
              </div>
              <Button type="button" variant="outline" onClick={() => setActiveTab('scrum')} className="shrink-0 border-indigo-200 bg-white font-bold text-indigo-700 hover:bg-indigo-100">
                <Code2 size={15} className="mr-2" /> Abrir Desarrollo
              </Button>
            </div>
          )}

          {/* Tasks List / Gantt */}
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="p-0">
              {tasksLoading ? (
                <div className="flex min-h-[320px] items-center justify-center gap-3 text-sm font-semibold text-slate-500">
                  <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
                  Cargando tareas del proyecto...
                </div>
              ) : (
                <ProjectGantt
                  tasks={standardProjectTasks}
                  teamMembers={teamMembersForAssignment}
                  assigneeOptions={projectAssignableTeamMembers}
                  taskGroups={taskGroups}
                  onUpdateTaskProgress={canEditTaskDetails ? handleUpdateTaskProgress : undefined}
                  onUpdateTaskValue={canEditTaskDetails ? handleUpdateTaskValue : undefined}
                  onUpdateTaskStatus={canEditTaskStatus ? handleUpdateTaskStatus : undefined}
                  onUpdateTaskPriority={canEditTaskDetails ? handleUpdateTaskPriority : undefined}
                  onUpdateTaskAssignee={canEditTaskDetails ? handleUpdateTaskAssignee : undefined}
                  onUpdateTaskGroup={canEditTaskDetails ? handleUpdateTaskGroup : undefined}
                  onDeleteTask={canDeleteTasks ? handleDeleteTask : undefined}
                  onDeleteTasks={canDeleteTasks ? handleDeleteTasks : undefined}
                  onDeleteTaskTree={canDeleteTasks ? handleDeleteTaskTree : undefined}
                  onSyncTask={canEditTaskDetails ? handleSyncTaskValue : undefined}
                  onReorderTasks={canEditTaskDetails ? handleReorderTasks : undefined}
                  onUpdateTaskDates={canEditTaskDates ? handleUpdateTaskDates : undefined}
                  onUpdateTaskTitle={canEditTaskDetails ? handleUpdateTaskTitle : undefined}
                  onCreateTaskGroup={canEditTaskDetails ? handleCreateTaskGroup : undefined}
                  onUpdateTaskGroupDefinition={canEditTaskDetails ? handleUpdateTaskGroupDefinition : undefined}
                  onDeleteTaskGroup={canEditTaskDetails ? handleDeleteTaskGroup : undefined}
                  onOpenIncrementTask={canEditTaskDetails ? setSelectedTaskForIncrement : undefined}
                  canEditTaskDetails={canEditTaskDetails}
                  canEditTaskDates={canEditTaskDates}
                  canEditTaskStatus={canEditTaskStatus}
                  canAddSubtasks={canAddSubtasks}
                  canEditTaskStructure={canEditTaskStructure}
                  canDeleteTasks={canDeleteTasks}
                  onEditTaskStructure={setTaskForStructureEdit}
                  onAddSubtask={canAddSubtasks ? setTaskForStructureEdit : undefined}
                  onOpenTaskDocs={(taskId, task) => {
                    setSelectedTaskForDocs(task);
                    setIsTaskDocsModalOpen(true);
                  }}
                  onOpenTaskComments={setSelectedTaskForComments}
                  onResetWorkflowTask={canEditTaskDetails ? handleResetWorkflowTask : undefined}
                  onCreateBulkWorkflowIterations={canCreateTasks && canAddSubtasks ? setTaskForBulkIterations : undefined}
                  onRepairMissingTaskMatrix={canEditTaskDetails || canEditTaskStructure ? handleRepairMissingTaskMatrix : undefined}
                  onCreateTask={canCreateTasks ? () => setIsCreateTaskModalOpen(true) : undefined}
                />
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Task Details Modal */}
      <TaskDetailsModal
        isOpen={isTaskDocsModalOpen}
        onClose={() => {
          setIsTaskDocsModalOpen(false);
          setSelectedTaskForDocs(null);
        }}
        task={selectedTaskForDocs}
        projectId={projectId}
        project={project}
        tasks={tasks}
        currentUser={user}
        teamMembers={projectAssignableTeamMembers}
        canViewDocuments={canViewDocuments}
        canUploadDocuments={canUploadDocuments}
        canManageDocumentAccess={canManageDocumentAccess}
        canDeleteDocuments={canDeleteDocuments}
        onResetWorkflowTask={canEditTaskDetails ? handleResetWorkflowTask : undefined}
      />

      <TaskCommentsModal
        isOpen={!!selectedTaskForComments}
        onClose={() => setSelectedTaskForComments(null)}
        projectId={projectId}
        task={selectedTaskForComments}
        currentUser={user}
        teamMembers={teamMembersForAssignment}
        footerActions={
          isWorkflowTaskType(selectedTaskForComments?.type) && canEditTaskDetails ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setSelectedTaskForDocs(selectedTaskForComments);
                setSelectedTaskForComments(null);
                setIsTaskDocsModalOpen(true);
              }}
              className="border-indigo-100 text-indigo-700 hover:bg-indigo-50"
            >
              <ClipboardList size={15} className="mr-2" />
              Gestionar pasos
            </Button>
          ) : null
        }
      />

      <TaskStatusReportModal
        isOpen={isTaskStatusReportOpen}
        onClose={() => setIsTaskStatusReportOpen(false)}
        tasks={tasks}
        taskGroups={taskGroups}
        teamMembers={teamMembersForAssignment}
      />

      {/* Start Workflow Modal */}
      <StartWorkflowModal
        isOpen={isStartWorkflowModalOpen}
        onClose={() => {
          setIsStartWorkflowModalOpen(false);
          setSelectedTaskForStartWorkflow(null);
        }}
        task={selectedTaskForStartWorkflow}
        parentTask={selectedTaskForStartWorkflow?.parentTaskId ? tasks.find((task) => task.id === selectedTaskForStartWorkflow.parentTaskId) : null}
        projectId={projectId}
        userId={user?.uid || ''}
        user={user}
        teamMembers={projectAssignableTeamMembers}
      />

      {activeTab === 'rateCards' && (
        <div className="mt-6">
          <ProjectRateCards projectId={projectId} currentUser={user} tasks={tasks} teamMembers={teamMembersForAssignment} budgetLines={budgetLines} />
        </div>
      )}

      {activeTab === 'budget' && (
        <div className="mt-6">
          {canAccessProjectBudget ? (
            <ProjectBudget projectId={projectId} rateCards={rateCards} tasks={tasks} teamMembers={projectAssignableTeamMembers} />
          ) : (
            <section className="rounded-xl border border-amber-200 bg-white p-8 text-center shadow-sm">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-amber-50 text-amber-700 ring-1 ring-amber-100">
                <ShieldCheck size={28} />
              </div>
              <h2 className="mt-4 text-2xl font-black tracking-tight text-slate-950">Presupuesto protegido</h2>
              <p className="mx-auto mt-2 max-w-2xl text-sm font-medium leading-6 text-slate-500">
                Este módulo contiene información financiera del proyecto. Solo pueden ingresar gerentes, coordinadores,
                administradores de organización y administradores globales.
              </p>
              <div className="mt-5 flex justify-center">
                <Button type="button" onClick={() => setActiveTab('tasks')} className="bg-indigo-600 font-bold text-white hover:bg-indigo-700">
                  Volver a tareas
                </Button>
              </div>
            </section>
          )}
        </div>
      )}

      {activeTab === 'administration' && (
        <div className="mt-6">
          <ProjectAdministration
            projectId={projectId}
            project={project}
            tasks={tasks}
            teamMembers={projectAssignableTeamMembers}
            approvalTeamMembers={organizationTeamMembers}
            currentUser={user}
            userRole={userRole}
            canView={canViewProjectAdministration}
            canManage={canManageProjectAdministration}
            canValidate={canValidateProjectAdministration}
            canEditAccountingClosures={canEditProjectAccountingClosures}
            canEditAccountingClosureDate={canEditProjectAccountingClosureDate}
            canDeleteAccountingClosures={canDeleteProjectAccountingClosures}
            canDeleteAdministrativeReceipts={canDeleteProjectAdministrativeReceipts}
            canConfigure={canConfigureProjectAdministration}
          />
        </div>
      )}

      {activeTab === 'billing' && (
        <div className="mt-6">
          <ProjectBilling
            projectId={projectId}
            rateCards={rateCards}
            tasks={tasks}
          />
        </div>
      )}

      {activeTab === 'orgChart' && (
        <div className="mt-6">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <Users size={20} className="text-indigo-500" />
                Organigrama del Proyecto
              </h2>
              <p className="text-sm text-slate-500 mt-1">Visualiza y edita la estructura organizacional del equipo.</p>
            </div>
          </div>
          <ProjectOrgChart projectId={projectId} project={project} teamMembers={projectOrgChartTeamMembers} />
        </div>
      )}

      {/* Team Members Section Moved to Bottom */}
      <div className="mt-12 grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
        <Card className="lg:col-span-3 border-slate-200 shadow-sm">
          <CardHeader className="pb-4 border-b border-slate-100 bg-slate-50/50 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <Users size={18} className="text-indigo-500" />
                Equipo del Proyecto
              </CardTitle>
              <CardDescription className="text-sm text-slate-500">
                Miembros asignados a este proyecto.
              </CardDescription>
            </div>
            {canManageProject && (
              <Button onClick={() => setIsAssignModalOpen(true)} variant="outline" size="sm" className="h-8">
                <Plus size={16} className="mr-1" /> Asignar Miembro
              </Button>
            )}
          </CardHeader>
          <CardContent className="pt-6">
            {(!project.assignedTeamMembers || project.assignedTeamMembers.length === 0) ? (
              <div className="text-center py-6 text-slate-500 text-sm">
                No hay miembros asignados a este proyecto.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {project.assignedTeamMembers.map((memberId: string) => {
                  const member = teamMembersForAssignment.find(m => m.id === memberId);
                  if (!member) return null;

                  return (
                    <div key={memberId} className="flex items-center justify-between p-3 border border-slate-200 rounded-lg bg-white">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm overflow-hidden relative">
                          {member.photoURL ? (
                            <Image src={member.photoURL} alt={member.name} fill className="object-cover" referrerPolicy="no-referrer" />
                          ) : (
                            member.name.charAt(0).toUpperCase()
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-900">{member.name}</p>
                          <p className="text-xs text-slate-500">{member.roleName}</p>
                        </div>
                      </div>
                      {canManageProject && (
                        <button
                          onClick={() => handleRemoveMember(memberId)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                          title="Remover"
                        >
                          <X size={16} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Delete Confirmation Modal */}
      {documentToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 m-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 text-red-600 mb-4">
              <div className="p-2 bg-red-100 rounded-full">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900">Eliminar Documento</h3>
            </div>

            <p className="text-slate-600 mb-6">
              ¿Estás seguro de que deseas eliminar el documento <strong className="text-slate-900">&quot;{documentToDelete.name}&quot;</strong>?
              Esta acción no se puede deshacer y el archivo será borrado permanentemente.
            </p>

            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => setDocumentToDelete(null)}
                disabled={isDeleting}
                className="border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </Button>
              <Button
                onClick={executeDeleteDocument}
                disabled={isDeleting}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {isDeleting ? 'Eliminando...' : 'Sí, eliminar documento'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Task Modal */}
	      {taskToDelete && (
	        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
	          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 m-4 animate-in fade-in zoom-in-95 duration-200">
	            <div className="flex items-center gap-3 text-red-600 mb-4">
	              <div className="p-2 bg-red-100 rounded-full">
	                <AlertCircle className="w-6 h-6" />
	              </div>
	              <h3 className="text-lg font-semibold text-slate-900">
	                {taskToDelete.mode === 'tree' ? 'Eliminar matriz y dependientes' : taskToDelete.isBulk ? 'Eliminar tareas' : 'Eliminar Tarea'}
	              </h3>
	            </div>

	            <p className="text-slate-600 mb-6">
	              {taskToDelete.mode === 'tree' ? (
	                <>
	                  ¿Eliminar la tarea matriz <strong className="text-slate-900">&quot;{taskToDelete.title}&quot;</strong>
	                  {taskToDelete.dependentHint ? <> y sus <strong className="text-slate-900">{taskToDelete.dependentHint} dependientes detectadas</strong></> : null}?
	                  {' '}Se eliminarán la matriz, sus subtareas y workflows. Los documentos, calidad y bitácora se conservarán como historial asociado para evitar bloqueos en proyectos pesados. Esta acción no se puede deshacer.
	                </>
	              ) : taskToDelete.isBulk ? (
	                <>
	                  ¿Estás seguro de que deseas eliminar <strong className="text-slate-900">{taskToDelete.ids.length} tareas seleccionadas</strong>?
	                  {' '}También se eliminarán sus subtareas y workflows. Los documentos, calidad y bitácora se conservarán como historial asociado. Esta acción no se puede deshacer.
	                </>
	              ) : (
	                <>
	                  ¿Estás seguro de que deseas eliminar la tarea <strong className="text-slate-900">&quot;{taskToDelete.title}&quot;</strong>?
	                  {' '}Esta acción no se puede deshacer.
	                </>
	              )}
	            </p>

	            {isDeleting && deletionProgress && (
	              <div className="mb-6 rounded-xl border border-red-100 bg-red-50/70 p-3">
	                <div className="mb-2 flex items-center justify-between gap-3">
	                  <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-red-700">
	                    <Loader2 size={16} className="shrink-0 animate-spin" />
	                    <span className="truncate">{deletionProgress.stage}</span>
	                  </div>
	                  <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-red-700">
	                    {deletionProgress.total > 0 ? `${Math.min(deletionProgress.processed, deletionProgress.total)}/${deletionProgress.total}` : '...'}
	                  </span>
	                </div>
	                <div className="h-2 overflow-hidden rounded-full bg-white">
	                  <div
	                    className="h-full rounded-full bg-red-600 transition-all duration-300"
	                    style={{
	                      width: `${deletionProgress.total > 0 ? Math.min(100, Math.round((deletionProgress.processed / deletionProgress.total) * 100)) : 12}%`,
	                    }}
	                  />
	                </div>
	                {deletionProgress.detail && (
	                  <p className="mt-2 text-xs font-medium text-red-700/80">{deletionProgress.detail}</p>
	                )}
	              </div>
	            )}

	            <div className="flex justify-end gap-3">
	              <Button
	                variant="outline"
	                onClick={() => setTaskToDelete(null)}
	                disabled={isDeleting}
	                className="border-slate-200 text-slate-700 hover:bg-slate-50"
	              >
	                Cancelar
	              </Button>
	              <Button
	                onClick={executeDeleteTask}
	                disabled={isDeleting}
	                className="bg-red-600 hover:bg-red-700 text-white"
	              >
	                {isDeleting ? 'Eliminando...' : taskToDelete.mode === 'tree' ? 'Sí, eliminar matriz' : taskToDelete.isBulk ? 'Sí, eliminar tareas' : 'Sí, eliminar tarea'}
	              </Button>
	            </div>
	          </div>
	        </div>
	      )}

      {/* Remove Member Modal */}
      <RemoveMemberModal
        memberToRemove={memberToRemove}
        onClose={() => setMemberToRemove(null)}
        projectId={projectId}
        teamMembers={teamMembers}
      />
      {/* Assign Team Member Modal */}
      <AssignMemberModal
        isOpen={isAssignModalOpen}
        onClose={() => setIsAssignModalOpen(false)}
        projectId={projectId}
        teamMembers={organizationTeamMembers}
        project={project}
      />

      {/* Task Completion Modal with Document Upload */}
      <CompleteTaskModal
        isOpen={!!completingTaskId}
        onClose={() => setCompletingTaskId(null)}
        projectId={projectId}
        taskId={completingTaskId}
        task={tasks.find(t => t.id === completingTaskId) || null}
        user={user}
      />

      <CompleteSubtaskFormModal
        isOpen={Boolean(completionFormStatusChange)}
        onClose={() => setCompletionFormStatusChange(null)}
        task={completionFormStatusChange?.task || null}
        user={user}
        project={project}
        tasks={tasks}
        teamMembers={projectAssignableTeamMembers}
        rateCards={rateCards}
        onSubmit={async (submission) => {
          if (!completionFormStatusChange) return;
          await handleUpdateTaskStatus(
            completionFormStatusChange.taskId,
            completionFormStatusChange.newStatus,
            completionFormStatusChange.task,
            undefined,
            undefined,
            submission,
          );
          setCompletionFormStatusChange(null);
        }}
      />

      <IncrementTaskValueModal
        isOpen={!!selectedTaskForIncrement}
        onClose={() => setSelectedTaskForIncrement(null)}
        task={selectedTaskForIncrement}
        onSubmit={handleIncrementTaskValue}
      />

      {dynamicRateCardStatusChange && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 p-6">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  {pendingManualStaticRateCard ? 'Registrar unidades de Rate Card' : 'Asignar Rate Card'}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  {dynamicRateCardStatusChange.task.title || dynamicRateCardStatusChange.task.name || 'Tarea'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDynamicRateCardStatusChange(null);
                  resetDynamicRateCardFields();
                }}
                className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4 bg-slate-50 p-6">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Persona que aporta <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={dynamicRateCardAssignee}
                    onChange={(e) => setDynamicRateCardAssignee(e.target.value)}
                    disabled={lockPendingRateCardAssignee}
                    className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:bg-slate-100 disabled:text-slate-500"
                  >
                    <option value="">Seleccionar...</option>
                    {projectAssignableTeamMembers.map((member) => (
                      <option key={member.id} value={member.id}>{member.name || member.email}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Perfil de Rate Card <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={dynamicRateCardId}
                    onChange={(e) => setDynamicRateCardId(e.target.value)}
                    disabled={lockPendingRateCardProfile}
                    className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:bg-slate-100 disabled:text-slate-500"
                  >
                    <option value="">Seleccionar...</option>
                    {rateCards.map((rateCard) => (
                      <option key={rateCard.id} value={rateCard.id}>{rateCard.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {pendingRateCardRequestsUnits ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Unidades <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={dynamicRateCardUnits}
                    onChange={(e) => setDynamicRateCardUnits(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              ) : (
                <div className="rounded-lg border border-emerald-100 bg-white px-3 py-2 text-sm text-emerald-700">
                  Auto suma: se cargarán <strong>{getDynamicRateCardUnits(dynamicRateCardStatusChange.task)}</strong> unidades configuradas.
                </div>
              )}

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Comentario</label>
                <textarea
                  value={dynamicRateCardComment}
                  onChange={(e) => setDynamicRateCardComment(e.target.value)}
                  className="h-20 w-full resize-none rounded-lg border border-slate-200 bg-white p-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  placeholder="Detalle opcional del aporte..."
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-100 p-6">
              <Button
                variant="outline"
                onClick={() => {
                  setDynamicRateCardStatusChange(null);
                  resetDynamicRateCardFields();
                }}
              >
                Cancelar
              </Button>
              <Button
                onClick={confirmDynamicRateCardStatusChange}
                disabled={!dynamicRateCardAssignee || !dynamicRateCardId || (pendingRateCardRequestsUnits && isInvalidRateCardUnits(dynamicRateCardUnits))}
                className="bg-emerald-600 text-white hover:bg-emerald-700"
              >
                Guardar y finalizar
              </Button>
            </div>
          </div>
        </div>
      )}

      {taskForPause && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-100 p-6">
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-orange-600">Pausa de vencimiento</p>
                <h3 className="mt-1 text-xl font-black text-slate-950">Estancar tarea</h3>
                <p className="mt-1 truncate text-sm font-semibold text-slate-500">
                  {getTaskTitle(taskForPause)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setTaskForPause(null);
                  setPauseReason('');
                }}
                className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                aria-label="Cerrar"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4 bg-slate-50 p-6">
              <div className="rounded-xl border border-orange-100 bg-orange-50 p-4 text-sm font-medium leading-6 text-orange-800">
                Al estancar esta tarea se congela su vencimiento. Cuando vuelva a Trabajando, se recalculará la fecha fin con los mismos días que quedaban al momento de la pausa.
              </div>
              <div>
                <label className="mb-2 block text-sm font-bold text-slate-700">
                  Motivo de la pausa <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={pauseReason}
                  onChange={(event) => setPauseReason(event.target.value)}
                  className="h-28 w-full resize-none rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20"
                  placeholder="Ej. Esperamos información externa, bloqueo operativo, dependencia pendiente..."
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-100 p-6">
              <Button
                variant="outline"
                onClick={() => {
                  setTaskForPause(null);
                  setPauseReason('');
                }}
              >
                Cancelar
              </Button>
              <Button
                onClick={confirmPauseTask}
                disabled={!pauseReason.trim()}
                className="bg-orange-600 text-white hover:bg-orange-700"
              >
                <Clock size={16} className="mr-2" />
                Pausar vencimiento
              </Button>
            </div>
          </div>
        </div>
      )}

      {taskForReschedule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-100 p-6">
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-indigo-600">Reprogramación de tarea</p>
                <h3 className="mt-1 text-xl font-black text-slate-950">Cambiar cronograma</h3>
                <p className="mt-1 truncate text-sm font-semibold text-slate-500">
                  {getTaskTitle(taskForReschedule)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setTaskForReschedule(null);
                  setRescheduleStartDate('');
                  setRescheduleEndDate('');
                  setRescheduleReason('');
                }}
                className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                aria-label="Cerrar"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4 bg-slate-50 p-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-bold text-slate-700">
                    Nueva fecha inicio <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={rescheduleStartDate}
                    onChange={(event) => setRescheduleStartDate(event.target.value)}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-bold text-slate-700">
                    Nueva fecha fin <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={rescheduleEndDate}
                    onChange={(event) => setRescheduleEndDate(event.target.value)}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-700">
                  Argumento de la reprogramación <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={rescheduleReason}
                  onChange={(event) => setRescheduleReason(event.target.value)}
                  className="h-28 w-full resize-none rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                  placeholder="Explica quién o qué originó el cambio, el acuerdo y el nuevo compromiso..."
                />
              </div>

              <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-sm font-medium leading-6 text-indigo-800">
                La tarea quedará nuevamente en Trabajando y esta acción quedará registrada en interacciones con las fechas anteriores, las nuevas fechas y el responsable del cambio.
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-100 p-6">
              <Button
                variant="outline"
                onClick={() => {
                  setTaskForReschedule(null);
                  setRescheduleStartDate('');
                  setRescheduleEndDate('');
                  setRescheduleReason('');
                }}
              >
                Cancelar
              </Button>
              <Button
                onClick={confirmRescheduleTask}
                disabled={!rescheduleStartDate || !rescheduleEndDate || !rescheduleReason.trim()}
                className="bg-indigo-600 text-white hover:bg-indigo-700"
              >
                <Calendar size={16} className="mr-2" />
                Reprogramar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Create Task Modal */}
      {canCreateTasks && (
        <CreateTaskModal
          isOpen={isCreateTaskModalOpen}
          onClose={() => setIsCreateTaskModalOpen(false)}
          projectId={projectId}
          project={project}
          user={user}
          teamMembers={projectAssignableTeamMembers}
          rateCards={rateCards}
          taskGroups={taskGroups}
          tasksLength={tasks.length}
          canManageWorkflowTemplates={canManageWorkflowTemplates}
          userRole={userRole}
          templateScopeOrganizationIds={managedOrganizationIds}
        />
      )}
      {canCreateTasks && canAddSubtasks && (
        <BulkWorkflowIterationsModal
          isOpen={!!taskForBulkIterations}
          onClose={() => setTaskForBulkIterations(null)}
          projectId={projectId}
          task={taskForBulkIterations}
          user={user}
          teamMembers={projectAssignableTeamMembers}
          tasks={tasks}
        />
      )}
      <EditTaskStructureModal
        isOpen={!!taskForStructureEdit}
        onClose={() => setTaskForStructureEdit(null)}
        projectId={projectId}
        task={taskForStructureEdit}
        user={user}
        teamMembers={projectAssignableTeamMembers}
        rateCards={rateCards}
        project={project}
        subtasks={taskForStructureEdit ? tasks.filter((task) => task.parentTaskId === taskForStructureEdit.id) : []}
        canEditTaskStructure={canEditTaskStructure}
        canManageWorkflowTemplates={canManageWorkflowTemplates}
        userRole={userRole}
        templateScopeOrganizationIds={managedOrganizationIds}
        onCreateSubtask={canAddSubtasks ? handleCreateSubtask : undefined}
        onUpdateSubtaskCompletionForm={canAddSubtasks || canEditTaskStructure ? handleUpdateSubtaskCompletionForm : undefined}
        onSave={async (updates) => {
          if (!taskForStructureEdit) return;
          await handleUpdateTaskStructure(taskForStructureEdit, updates);
        }}
      />
      <UploadDocumentModal
        isOpen={isUploadModalOpen}
        onClose={closeUploadDocumentModal}
        projectId={projectId}
        user={user}
        project={project}
        tasks={tasks}
        documents={documents}
        initialFolderId={uploadTargetFolderId}
        teamMembers={projectAssignableTeamMembers}
        canManageAccess={canManageDocumentAccess}
      />
      <ProjectDocumentViewer
        document={previewDocument}
        isOpen={!!previewDocument}
        onClose={() => setPreviewDocument(null)}
      />

    </DashboardLayout>
  );
}
