"use client"

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Banknote,
  BriefcaseBusiness,
  CheckCircle2,
  ClipboardCheck,
  CreditCard,
  Download,
  FolderKanban,
  ReceiptText,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  X,
  WalletCards,
} from 'lucide-react';
import { toast } from 'sonner';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import {
  collection,
  collectionGroup,
  onSnapshot,
  orderBy,
  query,
  where,
} from '@/lib/supabase/document-store';
import { db } from '@/lib/backend';
import { useAuth } from '@/hooks/useAuth';
import { useRolePermissions } from '@/hooks/useRolePermissions';
import { belongsToAnyOrganization, organizationNameFor } from '@/lib/organizations';
import { resolveContractorAccountApprovalConfig } from '@/lib/contractor-account-workflow';
import { ProjectAdministration } from '@/components/projects/ProjectAdministration';
import {
  buildAdministrativeAdvanceStatusReport,
  generateAdministrativeAdvanceStatusPdf,
} from '@/lib/administrative-advance-status-report';
import {
  calculateAdministrativeAdvanceFinancials,
  isLegalizedAdministrativeReceipt,
} from '@/lib/administrative-advance-metrics';

type ProjectRow = {
  id: string;
  name?: string;
  description?: string;
  ownerId?: string;
  organizationId?: string;
  organizationIds?: string[];
  assignedUsers?: string[];
  assignedEmails?: string[];
  assignedTeamMembers?: string[];
  status?: string;
};

type TeamMemberRow = {
  id: string;
  uid?: string;
  name?: string;
  displayName?: string;
  email?: string;
  authUserId?: string;
  organizationId?: string;
  organizationIds?: string[];
};

type TaskRow = {
  id: string;
  projectId?: string;
  projectName?: string;
  organizationId?: string;
  [key: string]: any;
};

type ReceiptStatus =
  | 'submitted'
  | 'approved'
  | 'approved_modified'
  | 'audit_pending'
  | 'audit_passed'
  | 'audit_alert'
  | 'returned'
  | 'rejected';

type AdvanceReceipt = {
  id?: string;
  status?: ReceiptStatus;
  amount?: number;
  documentType?: string;
  createdAt?: any;
  reviewedAt?: any;
  resubmittedAt?: any;
  accountingAuditedAt?: any;
  accountingAuditStatus?: string;
  billingPaymentId?: string;
};

type TravelAdvance = {
  id: string;
  projectId: string;
  requesterId?: string;
  customId?: string | null;
  requesterName?: string;
  requesterEmail?: string;
  destination?: string;
  department?: string;
  municipality?: string;
  purpose?: string;
  travelStart?: string;
  travelEnd?: string;
  status?: 'submitted' | 'pending_payment' | 'partially_paid' | 'paid' | 'approved' | 'completed' | 'returned' | 'rejected' | 'closed';
  amountRequested?: number;
  amountApproved?: number;
  amountLegalized?: number;
  amountReturned?: number;
  amountCompensated?: number;
  balance?: number;
  receipts?: AdvanceReceipt[];
  paymentSupport?: { id?: string; documentId?: string; billingPaymentId?: string; amount?: number } | null;
  paymentSupports?: Array<{ id?: string; documentId?: string; billingPaymentId?: string; amount?: number }>;
  amountPaid?: number;
  paymentBalance?: number;
  paymentProgress?: number;
  reconciliationStatus?: string;
  createdAt?: any;
  approvedAt?: any;
  paidAt?: any;
  completedAt?: any;
  closedAt?: any;
};

type BillingPaymentRow = {
  id: string;
  projectId: string;
  advanceId?: string;
  receiptId?: string;
  source?: string;
  status?: string;
  amount?: number;
};

type AdvancePerson = {
  key: string;
  name: string;
  email: string;
};

type StatusFilter =
  | 'all'
  | 'submitted'
  | 'pending_payment'
  | 'legalization'
  | 'completed'
  | 'closed'
  | 'returned'
  | 'rejected';

const ADMIN_ORGANIZATION_SCOPE_ROLES = new Set(['admin', 'org_admin', 'manager', 'gerente', 'project_manager', 'coordinador', 'coordinator']);

const statusMeta: Record<string, { label: string; className: string; dotClassName: string }> = {
  submitted: {
    label: 'Por aprobar',
    className: 'bg-amber-50 text-amber-700 ring-amber-100',
    dotClassName: 'bg-amber-500',
  },
  pending_payment: {
    label: 'Por pagar',
    className: 'bg-violet-50 text-violet-700 ring-violet-100',
    dotClassName: 'bg-violet-500',
  },
  partially_paid: {
    label: 'Abonado · saldo pendiente',
    className: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-100',
    dotClassName: 'bg-fuchsia-500',
  },
  paid: {
    label: 'Pagado · legalización',
    className: 'bg-sky-50 text-sky-700 ring-sky-100',
    dotClassName: 'bg-sky-500',
  },
  approved: {
    label: 'En legalización',
    className: 'bg-sky-50 text-sky-700 ring-sky-100',
    dotClassName: 'bg-sky-500',
  },
  completed: {
    label: 'Conciliación',
    className: 'bg-cyan-50 text-cyan-700 ring-cyan-100',
    dotClassName: 'bg-cyan-500',
  },
  closed: {
    label: 'Conciliado',
    className: 'bg-teal-50 text-teal-700 ring-teal-100',
    dotClassName: 'bg-teal-500',
  },
  returned: {
    label: 'Devuelto',
    className: 'bg-orange-50 text-orange-700 ring-orange-100',
    dotClassName: 'bg-orange-500',
  },
  rejected: {
    label: 'Rechazado',
    className: 'bg-rose-50 text-rose-700 ring-rose-100',
    dotClassName: 'bg-rose-500',
  },
};

const normalizeEmail = (value?: string | null) => String(value || '').trim().toLowerCase();

const normalizeIdentityToken = (value?: string | null) => String(value || '').trim().toLowerCase();

const normalizeText = (value: unknown) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const asNumber = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const formatMoney = (value: unknown) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(asNumber(value));

const getDateValue = (value: any): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === 'function') return value.toDate();
  if (typeof value === 'string') {
    const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnlyMatch) {
      const [, year, month, day] = dateOnlyMatch;
      const localDate = new Date(Number(year), Number(month) - 1, Number(day));
      return Number.isNaN(localDate.getTime()) ? null : localDate;
    }
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getDateTime = (value: any) => getDateValue(value)?.getTime() || 0;

const getAdvanceStatusMeta = (status?: string) => statusMeta[status || 'submitted'] || statusMeta.submitted;

const advanceMatchesStatusFilter = (advance: TravelAdvance, filter: StatusFilter) => {
  if (filter === 'all') return true;
  if (filter === 'legalization') {
    return advance.status === 'partially_paid' || advance.status === 'paid' || advance.status === 'approved';
  }
  if (filter === 'pending_payment') {
    return advance.status === 'pending_payment' || advance.status === 'partially_paid';
  }
  if (filter === 'closed') return advance.status === 'closed' || advance.reconciliationStatus === 'reconciled';
  return advance.status === filter;
};

const getPaymentProgress = (advance: TravelAdvance) => {
  const financials = calculateAdministrativeAdvanceFinancials(advance);
  const approved = financials.approved;
  if (approved <= 0) return 0;
  return Math.min(100, Math.round((financials.paid / approved) * 100));
};

const getProjectIdFromAdvanceSnapshot = (snapshot: any, data: any) =>
  data.projectId || snapshot.ref?.parent?.parent?.id || '';

const getProjectIdFromTaskSnapshot = (snapshot: any, data: any) =>
  data.projectId || snapshot.ref?.parent?.parent?.id || '';

const getAdvanceRecordKey = (advance: Pick<TravelAdvance, 'projectId' | 'id'>) =>
  `${advance.projectId}:${advance.id}`;

const buildAdvancePersonDirectory = (teamMembers: TeamMemberRow[]) => {
  const aliases = new Map<string, string>();
  const people = new Map<string, AdvancePerson>();

  teamMembers.forEach((member) => {
    const email = normalizeEmail(member.email);
    const teamMemberId = normalizeIdentityToken(member.id);
    const authUserId = normalizeIdentityToken(member.authUserId || member.uid);
    const key = teamMemberId
      ? `team:${teamMemberId}`
      : authUserId
        ? `user:${authUserId}`
        : email
          ? `email:${email}`
          : '';
    if (!key) return;

    const current = people.get(key);
    people.set(key, {
      key,
      name: current?.name || member.displayName || member.name || email || 'Persona sin nombre',
      email: current?.email || email,
    });

    [member.id, member.authUserId, member.uid, email].forEach((value) => {
      const token = normalizeIdentityToken(value);
      if (token) aliases.set(token, key);
    });
  });

  return { aliases, people };
};

const resolveAdvancePerson = (
  advance: Pick<TravelAdvance, 'requesterId' | 'requesterEmail' | 'requesterName'>,
  directory: ReturnType<typeof buildAdvancePersonDirectory>
): AdvancePerson => {
  const email = normalizeEmail(advance.requesterEmail);
  const requesterId = normalizeIdentityToken(advance.requesterId);
  const resolvedKey = [requesterId, email]
    .map((token) => directory.aliases.get(token))
    .find(Boolean);
  const key = resolvedKey || (email ? `email:${email}` : requesterId ? `user:${requesterId}` : `name:${normalizeText(advance.requesterName) || 'sin-identidad'}`);
  const known = directory.people.get(key);
  return {
    key,
    name: known?.name || advance.requesterName || email || 'Persona sin nombre',
    email: known?.email || email,
  };
};

const buildCurrentUserIds = (user: any, teamMembers: TeamMemberRow[]) => {
  const email = normalizeEmail(user?.email);
  return Array.from(new Set([
    user?.uid,
    ...teamMembers
      .filter((member) => member.authUserId === user?.uid || normalizeEmail(member.email) === email)
      .map((member) => member.id),
  ].filter(Boolean)));
};

const recordBelongsToCurrentUser = (
  record: { requesterId?: string | null; contractorId?: string | null; requesterEmail?: string | null; contractorEmail?: string | null },
  user: any,
  currentUserIds: string[]
) => {
  const email = normalizeEmail(user?.email);
  const currentIds = new Set(currentUserIds.map(String));
  const recordIds = [record.requesterId, record.contractorId].filter(Boolean).map(String);
  const recordEmails = [record.requesterEmail, record.contractorEmail].map(normalizeEmail).filter(Boolean);
  return recordIds.some((id) => currentIds.has(id)) || Boolean(email && recordEmails.includes(email));
};

const userCanAccessProject = ({
  project,
  user,
  userRole,
  managedOrganizationIds,
  currentUserIds,
}: {
  project: ProjectRow;
  user: any;
  userRole?: string | null;
  managedOrganizationIds: string[];
  currentUserIds: string[];
}) => {
  if (userRole === 'admin') return true;

  const projectInManagedOrg =
    managedOrganizationIds.length === 0 ||
    belongsToAnyOrganization(project, managedOrganizationIds);

  if (userRole === 'org_admin') return projectInManagedOrg;

  if (
    userRole &&
    ADMIN_ORGANIZATION_SCOPE_ROLES.has(userRole) &&
    managedOrganizationIds.length > 0 &&
    projectInManagedOrg
  ) {
    return true;
  }

  const assignedUsers = Array.isArray(project.assignedUsers) ? project.assignedUsers : [];
  const assignedTeamMembers = Array.isArray(project.assignedTeamMembers) ? project.assignedTeamMembers : [];
  const assignedEmails = Array.isArray(project.assignedEmails) ? project.assignedEmails.map(normalizeEmail) : [];
  const directlyAssigned =
    project.ownerId === user?.uid ||
    assignedUsers.includes(user?.uid || '') ||
    assignedEmails.includes(normalizeEmail(user?.email)) ||
    assignedTeamMembers.some((memberId) => currentUserIds.includes(memberId));

  return directlyAssigned && projectInManagedOrg;
};

function MetricCard({
  label,
  value,
  detail,
  icon,
  tone,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: React.ReactNode;
  tone: 'indigo' | 'emerald' | 'amber' | 'sky' | 'rose';
}) {
  const tones = {
    indigo: 'border-indigo-100 bg-indigo-50/70 text-indigo-700',
    emerald: 'border-emerald-100 bg-emerald-50/70 text-emerald-700',
    amber: 'border-amber-100 bg-amber-50/70 text-amber-700',
    sky: 'border-sky-100 bg-sky-50/70 text-sky-700',
    rose: 'border-rose-100 bg-rose-50/70 text-rose-700',
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">{label}</p>
          <p className="mt-2 text-2xl font-black tracking-tight text-slate-950">{value}</p>
          <p className="mt-1 truncate text-xs font-bold text-slate-500">{detail}</p>
        </div>
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${tones[tone]}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ canAccess }: { canAccess: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-6 py-14 text-center shadow-sm">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-slate-50 text-slate-400 ring-1 ring-slate-100">
        {canAccess ? <BriefcaseBusiness size={24} /> : <ShieldCheck size={24} />}
      </div>
      <h2 className="mt-4 text-lg font-black text-slate-950">
        {canAccess ? 'Sin anticipos administrativos para mostrar' : 'Módulo administrativo protegido'}
      </h2>
      <p className="mx-auto mt-2 max-w-xl text-sm font-semibold leading-6 text-slate-500">
        {canAccess
          ? 'Cuando existan anticipos en los proyectos donde tienes alcance administrativo aparecerán en este tablero.'
          : 'Tu rol no tiene activo el permiso para ver anticipos y costos administrativos.'}
      </p>
    </div>
  );
}

export default function AdministrationOverviewPage() {
  const { user, userRole, userOrganizationId, userOrganizationIds } = useAuth();
  const { permissions, loading: permissionsLoading } = useRolePermissions(userRole);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMemberRow[]>([]);
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [advances, setAdvances] = useState<TravelAdvance[]>([]);
  const [billingPayments, setBillingPayments] = useState<BillingPaymentRow[]>([]);
  const [billingPaymentsLoaded, setBillingPaymentsLoaded] = useState(false);
  const [billingPaymentsError, setBillingPaymentsError] = useState(false);
  const [advancesLoaded, setAdvancesLoaded] = useState(false);
  const [operationProjectTasks, setOperationProjectTasks] = useState<TaskRow[]>([]);
  const [operationProjectTasksLoading, setOperationProjectTasksLoading] = useState(false);
  const [multiProjectActivityTasks, setMultiProjectActivityTasks] = useState<TaskRow[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('all');
  const [selectedOrganizationId, setSelectedOrganizationId] = useState('all');
  const [selectedPersonKey, setSelectedPersonKey] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [showClosed, setShowClosed] = useState(false);
  const [isStatusReportOpen, setIsStatusReportOpen] = useState(false);
  const [statusReportGeneratedAt, setStatusReportGeneratedAt] = useState(() => new Date());
  const [isGeneratingStatusReport, setIsGeneratingStatusReport] = useState(false);

  const canAccessAdministration = Boolean(user);
  const hasAdministrativeControl = Boolean(
    permissions.administrationProjectView &&
      (
        permissions.administrationProjectManage ||
        permissions.administrationProjectValidate ||
        permissions.administrationClosureEdit ||
        permissions.administrationClosureDateEdit ||
        permissions.administrationClosureDelete ||
        permissions.administrationReceiptDelete ||
        userRole === 'admin' ||
        userRole === 'org_admin' ||
        (userRole ? ADMIN_ORGANIZATION_SCOPE_ROLES.has(userRole) : false)
      )
  );
  const canManageAdministration = Boolean(hasAdministrativeControl && permissions.administrationProjectManage);
  const canValidateAdministration = Boolean(hasAdministrativeControl && permissions.administrationProjectValidate);
  const canEditAccountingClosures = Boolean(hasAdministrativeControl && permissions.administrationClosureEdit);
  const canEditAccountingClosureDate = Boolean(hasAdministrativeControl && permissions.administrationClosureDateEdit);
  const canDeleteAccountingClosures = Boolean(hasAdministrativeControl && permissions.administrationClosureDelete);
  const canDeleteAdministrativeReceipts = Boolean(hasAdministrativeControl && permissions.administrationReceiptDelete);
  const canConfigureAdministration = Boolean(hasAdministrativeControl && permissions.administrationConfigManage);
  const loading = canAccessAdministration && !advancesLoaded;
  const managedOrganizationIds = useMemo(
    () => (userOrganizationIds.length > 0 ? userOrganizationIds : userOrganizationId ? [userOrganizationId] : []),
    [userOrganizationId, userOrganizationIds]
  );
  const currentUserIds = useMemo(() => buildCurrentUserIds(user, teamMembers), [teamMembers, user]);

  useEffect(() => {
    if (!user || !canAccessAdministration) {
      return;
    }

    const unsubscribeProjects = onSnapshot(
      query(collection(db, 'projects')),
      (snapshot) => {
        setProjects(snapshot.docs.map((projectDoc) => ({ id: projectDoc.id, ...projectDoc.data() } as ProjectRow)));
      },
      (error) => {
        console.error('Error loading projects for administration overview:', error);
      }
    );

    const unsubscribeTeam = onSnapshot(
      query(collection(db, 'team_members')),
      (snapshot) => {
        setTeamMembers(snapshot.docs.map((teamDoc) => ({ id: teamDoc.id, ...teamDoc.data() } as TeamMemberRow)));
      },
      (error) => {
        console.error('Error loading team members for administration overview:', error);
      }
    );

    const unsubscribeOrganizations = onSnapshot(
      query(collection(db, 'organizations')),
      (snapshot) => {
        setOrganizations(snapshot.docs.map((organizationDoc) => ({ id: organizationDoc.id, ...organizationDoc.data() })));
      },
      (error) => {
        console.error('Error loading organizations for administration overview:', error);
      }
    );

    const unsubscribeAdvances = onSnapshot(
      query(collectionGroup(db, 'advanceRequests'), orderBy('createdAt', 'desc')),
      (snapshot) => {
        setAdvances(
          snapshot.docs.map((advanceDoc) => {
            const data = advanceDoc.data();
            return {
              id: advanceDoc.id,
              ...data,
              projectId: getProjectIdFromAdvanceSnapshot(advanceDoc, data),
            } as TravelAdvance;
          })
        );
        setAdvancesLoaded(true);
      },
      (error) => {
        console.error('Error loading global advances:', error);
        setAdvancesLoaded(true);
      }
    );

    const unsubscribeBillingPayments = onSnapshot(
      query(collectionGroup(db, 'billingPayments')),
      (snapshot) => {
        setBillingPayments(
          snapshot.docs.map((paymentDoc) => {
            const data = paymentDoc.data();
            return {
              id: paymentDoc.id,
              ...data,
              projectId: getProjectIdFromTaskSnapshot(paymentDoc, data),
            } as BillingPaymentRow;
          })
        );
        setBillingPaymentsLoaded(true);
        setBillingPaymentsError(false);
      },
      (error) => {
        console.error('Error loading billing payments for administration overview:', error);
        setBillingPayments([]);
        setBillingPaymentsLoaded(true);
        setBillingPaymentsError(true);
      }
    );

    return () => {
      unsubscribeProjects();
      unsubscribeTeam();
      unsubscribeOrganizations();
      unsubscribeAdvances();
      unsubscribeBillingPayments();
    };
  }, [canAccessAdministration, user]);

  const scopedProjects = useMemo(
    () =>
      projects.filter((project) => {
        const canAccessNormally = userCanAccessProject({
          project,
          user,
          userRole,
          managedOrganizationIds,
          currentUserIds,
        });
        if (canAccessNormally) return true;

        const organizationIds = [project.organizationId, ...(project.organizationIds || [])].filter(Boolean);
        const organization = organizations.find((candidate) => organizationIds.includes(candidate.id));
        const projectConfig = (project as any).contractorAccountApprovalConfig || {};
        const approvalConfig = resolveContractorAccountApprovalConfig(
          projectConfig,
          organization?.contractorAccountApprovalConfig
        );
        return Object.values(approvalConfig).some((value) => currentUserIds.includes(String(value || '')));
      }),
    [currentUserIds, managedOrganizationIds, organizations, projects, user, userRole]
  );

  const scopedProjectIds = useMemo(() => new Set(scopedProjects.map((project) => project.id)), [scopedProjects]);
  const projectById = useMemo(() => new Map(scopedProjects.map((project) => [project.id, project])), [scopedProjects]);

  const visibleOrganizations = useMemo(() => {
    const organizationIds = new Set(scopedProjects.flatMap((project) => [project.organizationId, ...(project.organizationIds || [])].filter(Boolean)));
    return organizations
      .filter((organization) => organizationIds.has(organization.id))
      .sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')));
  }, [organizations, scopedProjects]);

  const visibleProjects = useMemo(() => {
    return scopedProjects
      .filter((project) => selectedOrganizationId === 'all' || belongsToAnyOrganization(project, [selectedOrganizationId]))
      .sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')));
  }, [scopedProjects, selectedOrganizationId]);

  const requestedProjectId = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('projectId')
    : null;

  useEffect(() => {
    if (!requestedProjectId || !scopedProjects.some((project) => project.id === requestedProjectId)) return;
    const requestedProject = scopedProjects.find((project) => project.id === requestedProjectId);
    const synchronizationId = window.setTimeout(() => {
      setSelectedProjectId(requestedProjectId);
      if (requestedProject?.organizationId) setSelectedOrganizationId(requestedProject.organizationId);
    }, 0);
    return () => window.clearTimeout(synchronizationId);
  }, [requestedProjectId, scopedProjects]);
  const activeSelectedProjectId = useMemo(
    () =>
      selectedProjectId === 'all' || visibleProjects.some((project) => project.id === selectedProjectId)
        ? selectedProjectId
        : 'all',
    [selectedProjectId, visibleProjects]
  );
  const visibleProjectIds = useMemo(() => visibleProjects.map((project) => project.id), [visibleProjects]);
  const operationProject = useMemo(
    () => activeSelectedProjectId === 'all'
      ? null
      : visibleProjects.find((project) => project.id === activeSelectedProjectId) || null,
    [activeSelectedProjectId, visibleProjects]
  );
  const activeOperationProjectId = operationProject?.id || '';
  const operationActivityTasks = useMemo(() => {
    const byKey = new Map<string, TaskRow>();
    [...multiProjectActivityTasks, ...operationProjectTasks].forEach((task) => {
      if (!task?.id) return;
      const taskProjectId = task.projectId || activeOperationProjectId;
      byKey.set(`${taskProjectId}:${task.id}`, {
        ...task,
        projectId: taskProjectId,
        projectName: task.projectName || projectById.get(taskProjectId)?.name || operationProject?.name || '',
      });
    });
    return [...byKey.values()];
  }, [activeOperationProjectId, multiProjectActivityTasks, operationProject?.name, operationProjectTasks, projectById]);

  useEffect(() => {
    if (!canAccessAdministration || !activeOperationProjectId) {
      setOperationProjectTasks([]);
      setOperationProjectTasksLoading(false);
      return;
    }

    setOperationProjectTasksLoading(true);
    const unsubscribe = onSnapshot(
      query(collection(db, 'projects', activeOperationProjectId, 'tasks'), orderBy('createdAt', 'desc')),
      (snapshot) => {
        setOperationProjectTasks(
          snapshot.docs.map((taskDoc) => {
            const data = taskDoc.data();
            return {
              id: taskDoc.id,
              ...data,
              projectId: data.projectId || activeOperationProjectId,
              projectName: data.projectName || operationProject?.name || '',
            } as TaskRow;
          })
        );
        setOperationProjectTasksLoading(false);
      },
      (error) => {
        console.error('Error loading tasks for global administration workspace:', error);
        setOperationProjectTasks([]);
        setOperationProjectTasksLoading(false);
      }
    );

    return () => unsubscribe();
  }, [activeOperationProjectId, canAccessAdministration, operationProject?.name]);

  useEffect(() => {
    if (!canAccessAdministration || visibleProjectIds.length === 0) {
      setMultiProjectActivityTasks([]);
      return;
    }

    const projectIdsForQuery = visibleProjectIds.slice(0, 100);
    const unsubscribe = onSnapshot(
      query(collectionGroup(db, 'tasks'), where('projectId', 'in', projectIdsForQuery)),
      (snapshot) => {
        setMultiProjectActivityTasks(
          snapshot.docs
            .map((taskDoc) => {
              const data = taskDoc.data();
              const taskProjectId = getProjectIdFromTaskSnapshot(taskDoc, data);
              if (!taskProjectId || !scopedProjectIds.has(taskProjectId)) return null;
              const sourceProject = projectById.get(taskProjectId);
              return {
                id: taskDoc.id,
                ...data,
                projectId: taskProjectId,
                projectName: data.projectName || sourceProject?.name || '',
              } as TaskRow;
            })
            .filter(Boolean) as TaskRow[]
        );
      },
      (error) => {
        console.error('Error loading cross-project activities for contractor accounts:', error);
        setMultiProjectActivityTasks([]);
      }
    );

    return () => unsubscribe();
  }, [canAccessAdministration, projectById, scopedProjectIds, visibleProjectIds]);

  const personDirectory = useMemo(() => buildAdvancePersonDirectory(teamMembers), [teamMembers]);
  const advancePersonByRecordKey = useMemo(() => {
    const resolved = new Map<string, AdvancePerson>();
    advances.forEach((advance) => {
      resolved.set(getAdvanceRecordKey(advance), resolveAdvancePerson(advance, personDirectory));
    });
    return resolved;
  }, [advances, personDirectory]);

  const activeBillingPaymentByKey = useMemo(() => {
    const paymentsByKey = new Map<string, BillingPaymentRow>();
    billingPayments
      .filter((payment) => scopedProjectIds.has(payment.projectId))
      .filter((payment) => payment.source === 'advance_receipt' && payment.status !== 'cancelled')
      .forEach((payment) => paymentsByKey.set(`${payment.projectId}:${payment.id}`, payment));
    return paymentsByKey;
  }, [billingPayments, scopedProjectIds]);

  const realCostByAdvanceKey = useMemo(() => {
    const costs = new Map<string, number>();
    const claimedPaymentKeys = new Set<string>();
    [...advances]
      .sort((left, right) => getAdvanceRecordKey(left).localeCompare(getAdvanceRecordKey(right), 'es'))
      .forEach((advance) => {
      let realCost = 0;
      const seenReceiptIds = new Set<string>();
      (advance.receipts || [])
        .filter(isLegalizedAdministrativeReceipt)
        .forEach((receipt) => {
          const receiptId = String(receipt.id || '').trim();
          const paymentId = String(receipt.billingPaymentId || '').trim();
          if (!paymentId || (receiptId && seenReceiptIds.has(receiptId))) return;
          if (receiptId) seenReceiptIds.add(receiptId);

          const paymentKey = `${advance.projectId}:${paymentId}`;
          const payment = activeBillingPaymentByKey.get(paymentKey);
          if (!payment || claimedPaymentKeys.has(paymentKey)) return;
          if (payment.advanceId && payment.advanceId !== advance.id) return;
          if (payment.receiptId && receiptId && payment.receiptId !== receiptId) return;

          claimedPaymentKeys.add(paymentKey);
          realCost += asNumber(payment.amount);
        });
      costs.set(getAdvanceRecordKey(advance), realCost);
    });
    return costs;
  }, [activeBillingPaymentByKey, advances]);

  const scopeFilteredAdvances = useMemo(() => {
    const search = normalizeText(searchTerm);
    const visibleProjectIds = new Set(visibleProjects.map((project) => project.id));

    return advances
      .filter((advance) => scopedProjectIds.has(advance.projectId))
      .filter((advance) => hasAdministrativeControl || recordBelongsToCurrentUser(advance, user, currentUserIds))
      .filter((advance) => visibleProjectIds.has(advance.projectId))
      .filter((advance) => activeSelectedProjectId === 'all' || advance.projectId === activeSelectedProjectId)
      .filter((advance) => showClosed || (advance.status !== 'closed' && advance.reconciliationStatus !== 'reconciled'))
      .filter((advance) => {
        if (!search) return true;
        const project = projectById.get(advance.projectId);
        const organizationName = project ? organizationNameFor(project, organizations) : '';
        return [
          advance.customId,
          advance.requesterName,
          advance.requesterEmail,
          advance.destination,
          advance.department,
          advance.municipality,
          advance.purpose,
          project?.name,
          organizationName,
          advance.status,
        ]
          .filter(Boolean)
          .some((value) => normalizeText(value).includes(search));
      })
      .sort((left, right) => getDateTime(right.createdAt || right.approvedAt) - getDateTime(left.createdAt || left.approvedAt));
  }, [
    activeSelectedProjectId,
    advances,
    currentUserIds,
    hasAdministrativeControl,
    organizations,
    projectById,
    scopedProjectIds,
    searchTerm,
    showClosed,
    user,
    visibleProjects,
  ]);

  const personOptions = useMemo(() => {
    const options = new Map<string, AdvancePerson & { advanceCount: number }>();
    scopeFilteredAdvances.filter((advance) => advanceMatchesStatusFilter(advance, statusFilter)).forEach((advance) => {
      const person = advancePersonByRecordKey.get(getAdvanceRecordKey(advance)) || resolveAdvancePerson(advance, personDirectory);
      const current = options.get(person.key);
      options.set(person.key, {
        ...person,
        advanceCount: (current?.advanceCount || 0) + 1,
      });
    });
    return [...options.values()].sort((left, right) => left.name.localeCompare(right.name, 'es'));
  }, [advancePersonByRecordKey, personDirectory, scopeFilteredAdvances, statusFilter]);

  const activeSelectedPersonKey = useMemo(
    () => selectedPersonKey === 'all' || personOptions.some((person) => person.key === selectedPersonKey)
      ? selectedPersonKey
      : 'all',
    [personOptions, selectedPersonKey]
  );

  const selectedPerson = useMemo(
    () => personOptions.find((person) => person.key === activeSelectedPersonKey) || null,
    [activeSelectedPersonKey, personOptions]
  );

  const baseFilteredAdvances = useMemo(
    () => scopeFilteredAdvances.filter((advance) => {
      if (activeSelectedPersonKey === 'all') return true;
      return advancePersonByRecordKey.get(getAdvanceRecordKey(advance))?.key === activeSelectedPersonKey;
    }),
    [activeSelectedPersonKey, advancePersonByRecordKey, scopeFilteredAdvances]
  );

  const filteredAdvances = useMemo(
    () => baseFilteredAdvances.filter((advance) => advanceMatchesStatusFilter(advance, statusFilter)),
    [baseFilteredAdvances, statusFilter]
  );

  const totals = useMemo(() => {
    const activeAdvances = filteredAdvances
      .map((advance) => ({ advance, financials: calculateAdministrativeAdvanceFinancials(advance) }))
      .filter(({ financials }) => financials.operational);
    const requested = activeAdvances.reduce((sum, item) => sum + item.financials.requested, 0);
    const approved = activeAdvances.reduce((sum, item) => sum + item.financials.approved, 0);
    const justified = activeAdvances.reduce((sum, item) => sum + item.financials.justified, 0);
    const legalized = activeAdvances.reduce((sum, item) => sum + item.financials.legalized, 0);
    const paid = activeAdvances.reduce((sum, item) => sum + item.financials.paid, 0);
    const paymentBase = activeAdvances.reduce((sum, item) => sum + item.financials.approved, 0);
    const costReal = activeAdvances.reduce(
      (sum, item) => sum + asNumber(realCostByAdvanceKey.get(getAdvanceRecordKey(item.advance))),
      0
    );

    return {
      requested,
      approved,
      paid,
      paymentProgress: paymentBase > 0 ? Math.min(100, Math.round((paid / paymentBase) * 100)) : 0,
      justified,
      legalized,
      costReal,
      submitted: baseFilteredAdvances.filter((advance) => advance.status === 'submitted').length,
      pendingPayment: baseFilteredAdvances.filter((advance) => advance.status === 'pending_payment' || advance.status === 'partially_paid').length,
      partiallyPaid: baseFilteredAdvances.filter((advance) => advance.status === 'partially_paid' || (getPaymentProgress(advance) > 0 && getPaymentProgress(advance) < 100)).length,
      legalizing: baseFilteredAdvances.filter((advance) => advance.status === 'partially_paid' || advance.status === 'paid' || advance.status === 'approved').length,
      conciliation: baseFilteredAdvances.filter((advance) => advance.status === 'completed').length,
      closed: baseFilteredAdvances.filter((advance) => advance.status === 'closed' || advance.reconciliationStatus === 'reconciled').length,
    };
  }, [baseFilteredAdvances, filteredAdvances, realCostByAdvanceKey]);

  const statusReportScopeLabel = useMemo(() => {
    const selectedProject = projectById.get(activeSelectedProjectId);
    if (selectedProject) {
      return `${selectedProject.name || selectedProject.id} · ${organizationNameFor(selectedProject, organizations)}`;
    }
    const selectedOrganization = visibleOrganizations.find((organization) => organization.id === selectedOrganizationId);
    if (selectedOrganization) {
      return `${selectedOrganization.name || selectedOrganization.id} · ${visibleProjects.length} proyecto${visibleProjects.length === 1 ? '' : 's'}`;
    }
    return `Todos los proyectos con acceso · ${visibleProjects.length} proyecto${visibleProjects.length === 1 ? '' : 's'}`;
  }, [activeSelectedProjectId, organizations, projectById, selectedOrganizationId, visibleOrganizations, visibleProjects.length]);

  const statusReportFiltersLabel = useMemo(() => {
    const labels: Record<StatusFilter, string> = {
      all: 'Todos los estados',
      submitted: 'Por aprobar',
      pending_payment: 'Por pagar',
      legalization: 'En legalización',
      completed: 'Por conciliar',
      closed: 'Conciliados',
      returned: 'Devueltos',
      rejected: 'Rechazados',
    };
    return [
      `Estado: ${labels[statusFilter]}`,
      selectedPerson ? `Persona: ${selectedPerson.name}` : 'Todas las personas',
      showClosed ? 'Incluye conciliados' : 'Conciliados ocultos',
      searchTerm.trim() ? `Búsqueda: “${searchTerm.trim()}”` : 'Sin filtro de texto',
    ].join(' · ');
  }, [searchTerm, selectedPerson, showClosed, statusFilter]);

  const administrativeStatusReport = useMemo(
    () =>
      buildAdministrativeAdvanceStatusReport({
        advances: filteredAdvances.map((advance) => {
          const project = projectById.get(advance.projectId);
          const person = advancePersonByRecordKey.get(getAdvanceRecordKey(advance)) || resolveAdvancePerson(advance, personDirectory);
          return {
            id: advance.id,
            customId: advance.customId,
            projectId: advance.projectId,
            projectName: project?.name || advance.projectId,
            organizationName: organizationNameFor(project || {}, organizations),
            requesterId: advance.requesterId,
            requesterKey: person.key,
            requesterName: person.name,
            requesterEmail: person.email,
            destination: advance.destination,
            status: advance.status,
            reconciliationStatus: advance.reconciliationStatus,
            amountRequested: advance.amountRequested,
            amountApproved: advance.amountApproved,
            amountLegalized: advance.amountLegalized,
            amountReturned: advance.amountReturned,
            amountPaid: advance.amountPaid,
            paymentSupport: advance.paymentSupport,
            paymentSupports: advance.paymentSupports,
            realCost: realCostByAdvanceKey.get(getAdvanceRecordKey(advance)) || 0,
            travelStart: advance.travelStart,
            travelEnd: advance.travelEnd,
            createdAt: advance.createdAt,
            approvedAt: advance.approvedAt,
            paidAt: advance.paidAt,
            completedAt: advance.completedAt,
            closedAt: advance.closedAt,
            receipts: advance.receipts || [],
          };
        }),
        generatedAt: statusReportGeneratedAt,
        scopeLabel: statusReportScopeLabel,
        filtersLabel: statusReportFiltersLabel,
      }),
    [advancePersonByRecordKey, filteredAdvances, organizations, personDirectory, projectById, realCostByAdvanceKey, statusReportFiltersLabel, statusReportGeneratedAt, statusReportScopeLabel]
  );

  const administrativeDetailByKey = useMemo(
    () => new Map(
      administrativeStatusReport.advances.map((row) => [
        `${row.projectId}:${row.recordId}`,
        row,
      ])
    ),
    [administrativeStatusReport.advances]
  );

  const administrativeTotalsReconciled = useMemo(() => {
    const monetaryKeys = [
      'requested',
      'approved',
      'paid',
      'paymentPending',
      'justified',
      'legalized',
      'returnedCash',
      'realCost',
      'justificationPending',
      'administrativePendingAmount',
    ] as const;
    const countKeys = [
      'advanceCount',
      'withLegalizations',
      'withoutLegalizations',
      'administrativePendingTasks',
      'administrativeAlertCount',
      'administrativeDelayCount',
      'justificationDelayCount',
    ] as const;
    const peopleSumsMatch = [...monetaryKeys, ...countKeys].every((key) => {
      const peopleTotal = administrativeStatusReport.people.reduce((sum, person) => sum + person[key], 0);
      return Math.abs(peopleTotal - administrativeStatusReport.totals[key]) < 0.01;
    });
    const detailTotals = administrativeStatusReport.advances.reduce(
      (current, row) => ({
        advanceCount: current.advanceCount + 1,
        withLegalizations: current.withLegalizations + (row.receiptCount > 0 ? 1 : 0),
        withoutLegalizations: current.withoutLegalizations + (row.receiptCount === 0 ? 1 : 0),
        requested: current.requested + row.requested,
        approved: current.approved + row.approved,
        paid: current.paid + row.paid,
        paymentPending: current.paymentPending + row.paymentPending,
        justified: current.justified + row.justified,
        legalized: current.legalized + row.legalized,
        returnedCash: current.returnedCash + row.returnedCash,
        realCost: current.realCost + row.realCost,
        justificationPending: current.justificationPending + row.justificationPending,
        administrativePendingAmount: current.administrativePendingAmount + row.administrativePendingAmount,
        administrativePendingTasks: current.administrativePendingTasks + row.administrativePendingTasks,
        administrativeAlertCount: current.administrativeAlertCount + (row.hasAdministrativeAlert ? 1 : 0),
        administrativeDelayCount: current.administrativeDelayCount + (row.hasAdministrativeDelay ? 1 : 0),
        justificationDelayCount: current.justificationDelayCount + (row.hasJustificationDelay ? 1 : 0),
      }),
      {
        advanceCount: 0,
        withLegalizations: 0,
        withoutLegalizations: 0,
        requested: 0,
        approved: 0,
        paid: 0,
        paymentPending: 0,
        justified: 0,
        legalized: 0,
        returnedCash: 0,
        realCost: 0,
        justificationPending: 0,
        administrativePendingAmount: 0,
        administrativePendingTasks: 0,
        administrativeAlertCount: 0,
        administrativeDelayCount: 0,
        justificationDelayCount: 0,
      }
    );
    const detailSumsMatch = [...monetaryKeys, ...countKeys].every(
      (key) => Math.abs(detailTotals[key] - administrativeStatusReport.totals[key]) < 0.01
    );
    const queuedTasks = administrativeStatusReport.queues.reduce((sum, queue) => sum + queue.itemCount, 0);
    const directTotalsMatch = [
      [totals.requested, administrativeStatusReport.totals.requested],
      [totals.approved, administrativeStatusReport.totals.approved],
      [totals.paid, administrativeStatusReport.totals.paid],
      [totals.justified, administrativeStatusReport.totals.justified],
      [totals.legalized, administrativeStatusReport.totals.legalized],
      [totals.costReal, administrativeStatusReport.totals.realCost],
    ].every(([direct, reconciled]) => Math.abs(direct - reconciled) < 0.01);
    return peopleSumsMatch && detailSumsMatch && directTotalsMatch && queuedTasks === administrativeStatusReport.totals.administrativePendingTasks;
  }, [administrativeStatusReport, totals]);

  const reconciledPaymentProgress = administrativeStatusReport.totals.approved > 0
    ? Math.min(100, Math.round((administrativeStatusReport.totals.paid / administrativeStatusReport.totals.approved) * 100))
    : 0;

  const openAdministrativeStatusReport = () => {
    setStatusReportGeneratedAt(new Date());
    setIsStatusReportOpen(true);
  };

  const openProjectWorkspace = (projectId: string) => {
    setSelectedProjectId(projectId);
    window.setTimeout(() => {
      document.getElementById('administration-project-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  };

  const downloadAdministrativeStatusReport = async () => {
    if (administrativeStatusReport.advances.length === 0) {
      toast.warning('No hay anticipos en el alcance seleccionado para generar el informe.');
      return;
    }
    setIsGeneratingStatusReport(true);
    const toastId = toast.loading('Generando el informe de estado de anticipos...');
    try {
      const bytes = await generateAdministrativeAdvanceStatusPdf(administrativeStatusReport);
      const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const dateToken = statusReportGeneratedAt.toISOString().slice(0, 10);
      anchor.href = url;
      anchor.download = `informe-estado-anticipos-${dateToken}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success('Informe de estado de anticipos generado.', { id: toastId });
    } catch (error: any) {
      console.error('Error generating administrative advance status report:', error);
      toast.error(error?.message || 'No se pudo generar el informe de estado de anticipos.', { id: toastId });
    } finally {
      setIsGeneratingStatusReport(false);
    }
  };

  const statusFilters: Array<{ id: StatusFilter; label: string; count: number }> = [
    { id: 'all', label: 'Todos', count: baseFilteredAdvances.length },
    { id: 'submitted', label: 'Por aprobar', count: totals.submitted },
    { id: 'pending_payment', label: 'Por pagar', count: totals.pendingPayment },
    { id: 'legalization', label: 'Legalización', count: totals.legalizing },
    { id: 'completed', label: 'Conciliación', count: totals.conciliation },
    { id: 'closed', label: 'Conciliados', count: totals.closed },
    { id: 'returned', label: 'Devueltos', count: baseFilteredAdvances.filter((advance) => advance.status === 'returned').length },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-md bg-indigo-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-indigo-700 ring-1 ring-indigo-100">
                  <BriefcaseBusiness size={13} />
                  Centro de control global
                </span>
                <span className={`rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${
                  billingPaymentsError
                    ? 'bg-rose-50 text-rose-700'
                    : billingPaymentsLoaded
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-slate-100 text-slate-500'
                }`}>
                  {billingPaymentsError ? 'Datos financieros parciales' : billingPaymentsLoaded ? 'Datos en vivo' : 'Verificando datos'}
                </span>
              </div>
              <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-950">Administración</h1>
              <p className="mt-1 text-sm font-semibold text-slate-500">
                Un solo alcance para consultar cifras, responsables, alertas e ingresar a la operación de cada proyecto.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-600">
                {visibleProjects.length} proyectos
              </span>
              <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-600">
                {filteredAdvances.length} anticipos
              </span>
              {hasAdministrativeControl && (
                <button
                  type="button"
                  onClick={openAdministrativeStatusReport}
                  disabled={filteredAdvances.length === 0}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-black text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <BarChart3 size={16} />
                  Ver informe general
                </button>
              )}
            </div>
          </div>
        </section>

        {!canAccessAdministration && !permissionsLoading ? (
          <EmptyState canAccess={false} />
        ) : (
          <>
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
              <MetricCard label="Solicitado" value={formatMoney(administrativeStatusReport.totals.requested)} detail="Total filtrado" icon={<WalletCards size={20} />} tone="indigo" />
              <MetricCard label="Aprobado" value={formatMoney(administrativeStatusReport.totals.approved)} detail={`${totals.submitted} por aprobar`} icon={<ClipboardCheck size={20} />} tone="amber" />
              <MetricCard label="Pagado / abonado" value={formatMoney(administrativeStatusReport.totals.paid)} detail={`${reconciledPaymentProgress}% desembolsado · ${totals.partiallyPaid} abonados`} icon={<CreditCard size={20} />} tone="sky" />
              <MetricCard label="Justificado vigente" value={formatMoney(administrativeStatusReport.totals.justified)} detail="Excluye soportes devueltos" icon={<ReceiptText size={20} />} tone="sky" />
              <MetricCard label="Legalizado" value={formatMoney(administrativeStatusReport.totals.legalized)} detail="Validado por administración" icon={<CheckCircle2 size={20} />} tone="emerald" />
              <MetricCard
                label="Costo real verificado"
                value={billingPaymentsLoaded && !billingPaymentsError ? formatMoney(administrativeStatusReport.totals.realCost) : '—'}
                detail={billingPaymentsError ? 'No se pudo verificar la fuente de pagos' : billingPaymentsLoaded ? 'Pagos vinculados a soportes válidos' : 'Verificando pagos vinculados'}
                icon={<Banknote size={20} />}
                tone="rose"
              />
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-slate-950">
                    <SlidersHorizontal size={17} className="text-indigo-600" />
                    <h2 className="text-sm font-black">Alcance del centro de control</h2>
                  </div>
                  <p className="mt-1 text-xs font-semibold text-slate-500">Los mismos filtros actualizan indicadores, personas, anticipos y PDF.</p>
                </div>
                {selectedPerson && (
                  <button
                    type="button"
                    onClick={() => setSelectedPersonKey('all')}
                    className="text-xs font-black text-indigo-600 transition hover:text-indigo-800"
                  >
                    Limpiar persona: {selectedPerson.name}
                  </button>
                )}
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-[minmax(280px,1.5fr)_repeat(4,minmax(170px,1fr))_auto]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Buscar por ID, solicitante, proyecto, municipio o justificación..."
                    className="h-11 w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-10 pr-4 text-sm font-semibold text-slate-700 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/15"
                  />
                </div>
                <select
                  value={selectedOrganizationId}
                  onChange={(event) => setSelectedOrganizationId(event.target.value)}
                  className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15"
                >
                  <option value="all">Todas las organizaciones</option>
                  {visibleOrganizations.map((organization) => (
                    <option key={organization.id} value={organization.id}>{organization.name || organization.id}</option>
                  ))}
                </select>
                <select
                  value={activeSelectedProjectId}
                  onChange={(event) => setSelectedProjectId(event.target.value)}
                  className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15"
                >
                  <option value="all">Todos los proyectos</option>
                  {visibleProjects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name || project.id}</option>
                  ))}
                </select>
                <select
                  value={activeSelectedPersonKey}
                  onChange={(event) => setSelectedPersonKey(event.target.value)}
                  className="h-11 min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15"
                >
                  <option value="all">Todas las personas</option>
                  {personOptions.map((person) => (
                    <option key={person.key} value={person.key}>
                      {person.name} · {person.advanceCount}
                    </option>
                  ))}
                </select>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                  className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15"
                >
                  {statusFilters.map((filter) => (
                    <option key={filter.id} value={filter.id}>{filter.label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setShowClosed((current) => !current)}
                  className={`h-11 rounded-lg border px-4 text-sm font-black transition md:col-span-2 xl:col-span-1 ${
                    showClosed
                      ? 'border-teal-200 bg-teal-50 text-teal-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {showClosed ? 'Ocultar conciliados' : 'Mostrar conciliados'}
                </button>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {statusFilters.map((filter) => (
                  <button
                    key={filter.id}
                    type="button"
                    onClick={() => setStatusFilter(filter.id)}
                    className={`rounded-lg border px-3 py-2 text-xs font-black transition ${
                      statusFilter === filter.id
                        ? 'border-indigo-200 bg-indigo-600 text-white shadow-sm'
                        : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-indigo-100 hover:bg-indigo-50 hover:text-indigo-700'
                    }`}
                  >
                    {filter.label}
                    <span className={`ml-2 rounded-md px-1.5 py-0.5 ${statusFilter === filter.id ? 'bg-white/20 text-white' : 'bg-white text-slate-500'}`}>
                      {filter.count}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            {loading || permissionsLoading ? (
              <div className="rounded-lg border border-slate-200 bg-white px-6 py-16 text-center text-sm font-semibold text-slate-500 shadow-sm">
                Cargando tablero administrativo...
              </div>
            ) : (
              <>
                {administrativeStatusReport.people.length > 0 && (
                  <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <Users size={17} className="text-indigo-600" />
                          <h2 className="text-sm font-black text-slate-950">Tablero por persona</h2>
                        </div>
                        <p className="mt-1 text-xs font-semibold text-slate-500">
                          Desagregado financiero y carga administrativa del alcance seleccionado.
                        </p>
                      </div>
                      <span className={`inline-flex w-fit items-center gap-2 rounded-lg px-3 py-2 text-xs font-black ring-1 ${
                        billingPaymentsError
                          ? 'bg-rose-50 text-rose-700 ring-rose-100'
                          : !billingPaymentsLoaded
                            ? 'bg-slate-100 text-slate-600 ring-slate-200'
                            : administrativeTotalsReconciled
                              ? 'bg-emerald-50 text-emerald-700 ring-emerald-100'
                              : 'bg-amber-50 text-amber-700 ring-amber-100'
                      }`}>
                        {billingPaymentsLoaded && !billingPaymentsError && administrativeTotalsReconciled
                          ? <CheckCircle2 size={15} />
                          : <AlertTriangle size={15} />}
                        {billingPaymentsError
                          ? 'Costo real sin verificar'
                          : !billingPaymentsLoaded
                            ? 'Verificando pagos'
                            : administrativeTotalsReconciled
                              ? 'Totales conciliados'
                              : 'Revisar conciliación'}
                      </span>
                    </div>

                    <div className="hidden overflow-x-auto lg:block">
                      <table className="w-full min-w-[1050px] border-collapse text-left">
                        <thead>
                          <tr className="border-b border-slate-100 bg-white text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
                            <th className="px-4 py-3">Persona</th>
                            <th className="px-3 py-3">Alcance</th>
                            <th className="px-3 py-3 text-right">Girado</th>
                            <th className="px-3 py-3 text-right">Justificado vigente</th>
                            <th className="px-3 py-3 text-right">Legalizado</th>
                            <th className="px-3 py-3 text-right">Pendiente justificar</th>
                            <th className="px-3 py-3">Gestión</th>
                            <th className="px-4 py-3 text-right">Filtro</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {administrativeStatusReport.people.map((person) => {
                            const hasDelays = person.administrativeDelayCount > 0 || person.justificationDelayCount > 0;
                            const isSelected = person.personKey === activeSelectedPersonKey;
                            return (
                              <tr key={person.personKey} className={isSelected ? 'bg-indigo-50/60' : 'transition hover:bg-slate-50/70'}>
                                <td className="px-4 py-3">
                                  <p className="max-w-[220px] truncate text-sm font-black text-slate-900">{person.requesterName}</p>
                                  <p className="mt-0.5 max-w-[220px] truncate text-[11px] font-semibold text-slate-400">{person.requesterEmail || 'Sin correo'}</p>
                                </td>
                                <td className="px-3 py-3 text-xs font-bold text-slate-600">
                                  {person.advanceCount} anticipo{person.advanceCount === 1 ? '' : 's'} · {person.projectCount} proyecto{person.projectCount === 1 ? '' : 's'}
                                </td>
                                <td className="whitespace-nowrap px-3 py-3 text-right text-sm font-black text-slate-800">{formatMoney(person.paid)}</td>
                                <td className="whitespace-nowrap px-3 py-3 text-right text-sm font-black text-indigo-700">{formatMoney(person.justified)}</td>
                                <td className="whitespace-nowrap px-3 py-3 text-right text-sm font-black text-emerald-700">{formatMoney(person.legalized)}</td>
                                <td className="whitespace-nowrap px-3 py-3 text-right text-sm font-black text-amber-700">{formatMoney(person.justificationPending)}</td>
                                <td className="px-3 py-3">
                                  <span className={`inline-flex rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-[0.1em] ${
                                    hasDelays
                                      ? 'bg-rose-50 text-rose-700'
                                      : person.administrativePendingTasks > 0
                                        ? 'bg-amber-50 text-amber-700'
                                        : 'bg-emerald-50 text-emerald-700'
                                  }`}>
                                    {hasDelays
                                      ? `${person.administrativeDelayCount + person.justificationDelayCount} demoras`
                                      : person.administrativePendingTasks > 0
                                        ? `${person.administrativePendingTasks} pendientes`
                                        : 'Al día'}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <button
                                    type="button"
                                    onClick={() => setSelectedPersonKey(isSelected ? 'all' : person.personKey)}
                                    className={`rounded-lg px-3 py-2 text-xs font-black transition ${
                                      isSelected
                                        ? 'bg-indigo-600 text-white'
                                        : 'border border-slate-200 bg-white text-indigo-700 hover:border-indigo-200 hover:bg-indigo-50'
                                    }`}
                                  >
                                    {isSelected ? 'Quitar filtro' : 'Ver persona'}
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="divide-y divide-slate-100 lg:hidden">
                      {administrativeStatusReport.people.map((person) => {
                        const hasDelays = person.administrativeDelayCount > 0 || person.justificationDelayCount > 0;
                        const isSelected = person.personKey === activeSelectedPersonKey;
                        return (
                          <article key={person.personKey} className={isSelected ? 'bg-indigo-50/60 p-4' : 'p-4'}>
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-black text-slate-900">{person.requesterName}</p>
                                <p className="mt-1 text-xs font-semibold text-slate-500">{person.advanceCount} anticipos · {person.projectCount} proyectos</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => setSelectedPersonKey(isSelected ? 'all' : person.personKey)}
                                className="shrink-0 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-xs font-black text-indigo-700"
                              >
                                {isSelected ? 'Quitar' : 'Filtrar'}
                              </button>
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                              <div className="rounded-lg bg-slate-50 p-2"><span className="block font-bold text-slate-400">Girado</span><strong className="text-slate-900">{formatMoney(person.paid)}</strong></div>
                              <div className="rounded-lg bg-indigo-50 p-2"><span className="block font-bold text-indigo-400">Justificado</span><strong className="text-indigo-700">{formatMoney(person.justified)}</strong></div>
                              <div className="rounded-lg bg-emerald-50 p-2"><span className="block font-bold text-emerald-500">Legalizado</span><strong className="text-emerald-700">{formatMoney(person.legalized)}</strong></div>
                              <div className="rounded-lg bg-amber-50 p-2"><span className="block font-bold text-amber-500">Pendiente</span><strong className="text-amber-700">{formatMoney(person.justificationPending)}</strong></div>
                            </div>
                            <p className={`mt-3 text-xs font-black ${hasDelays ? 'text-rose-700' : 'text-emerald-700'}`}>
                              {hasDelays ? `${person.administrativeDelayCount + person.justificationDelayCount} demoras detectadas` : `${person.administrativePendingTasks} gestiones pendientes`}
                            </p>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                )}

                {filteredAdvances.length === 0 ? (
                  <EmptyState canAccess />
                ) : (
                  <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex flex-col gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h2 className="text-sm font-black text-slate-950">Anticipos por controlar</h2>
                        <p className="mt-1 text-xs font-semibold text-slate-500">Vista operativa compacta con cifras reconstruidas desde los soportes.</p>
                      </div>
                      <p className="text-xs font-black text-slate-500">{filteredAdvances.length} registros</p>
                    </div>

                    <div className="hidden overflow-x-auto lg:block">
                      <table className="w-full min-w-[1220px] border-collapse text-left">
                        <thead>
                          <tr className="border-b border-slate-100 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
                            <th className="px-4 py-3">Persona</th>
                            <th className="px-3 py-3">Anticipo / proyecto</th>
                            <th className="px-3 py-3">Etapa</th>
                            <th className="px-3 py-3 text-right">Girado</th>
                            <th className="px-3 py-3 text-right">Justificado vigente</th>
                            <th className="px-3 py-3 text-right">Legalizado</th>
                            <th className="px-3 py-3 text-right">Pendiente</th>
                            <th className="px-3 py-3">Control</th>
                            <th className="px-4 py-3 text-right">Acción</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredAdvances.map((advance) => {
                            const project = projectById.get(advance.projectId);
                            const person = advancePersonByRecordKey.get(getAdvanceRecordKey(advance)) || resolveAdvancePerson(advance, personDirectory);
                            const financials = calculateAdministrativeAdvanceFinancials(advance);
                            const meta = getAdvanceStatusMeta(advance.status);
                            const displayId = String(advance.customId || advance.id);
                            const detail = administrativeDetailByKey.get(getAdvanceRecordKey(advance));
                            const hasAlert = Boolean(detail?.hasAdministrativeAlert || detail?.hasJustificationDelay);
                            return (
                              <tr key={getAdvanceRecordKey(advance)} className="transition hover:bg-slate-50/70">
                                <td className="px-4 py-3">
                                  <p className="max-w-[190px] truncate text-sm font-black text-slate-900">{person.name}</p>
                                  <p className="mt-0.5 max-w-[190px] truncate text-[11px] font-semibold text-slate-400">{person.email || 'Sin correo'}</p>
                                </td>
                                <td className="px-3 py-3">
                                  <div className="flex items-center gap-2">
                                    <span className="rounded-md bg-indigo-50 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-indigo-700">ID {displayId}</span>
                                    <span className="max-w-[190px] truncate text-xs font-black text-slate-700">{project?.name || advance.projectId}</span>
                                  </div>
                                  <p className="mt-1 max-w-[300px] truncate text-[11px] font-semibold text-slate-400">{advance.destination || advance.purpose || 'Sin detalle'}</p>
                                </td>
                                <td className="px-3 py-3">
                                  <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-[0.1em] ring-1 ${meta.className}`}>
                                    <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClassName}`} />
                                    {detail?.stage || meta.label}
                                  </span>
                                </td>
                                <td className="whitespace-nowrap px-3 py-3 text-right text-sm font-black text-slate-800">{formatMoney(financials.paid)}</td>
                                <td className="whitespace-nowrap px-3 py-3 text-right text-sm font-black text-indigo-700">{formatMoney(financials.justified)}</td>
                                <td className="whitespace-nowrap px-3 py-3 text-right text-sm font-black text-emerald-700">{formatMoney(financials.legalized)}</td>
                                <td className="whitespace-nowrap px-3 py-3 text-right text-sm font-black text-amber-700">{formatMoney(financials.justificationPending)}</td>
                                <td className="px-3 py-3">
                                  <span className={`inline-flex max-w-[190px] truncate rounded-md px-2 py-1 text-[10px] font-black ${
                                    hasAlert ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'
                                  }`} title={detail?.alertLabel || 'Sin alerta'}>
                                    {detail?.alertLabel || (financials.operational ? 'Sin alerta' : 'Registro rechazado')}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <button
                                    type="button"
                                    onClick={() => openProjectWorkspace(advance.projectId)}
                                    className="inline-flex h-9 items-center gap-2 rounded-lg bg-indigo-600 px-3 text-xs font-black text-white transition hover:bg-indigo-700"
                                  >
                                    Gestionar aquí
                                    <ArrowRight size={14} />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="divide-y divide-slate-100 lg:hidden">
                      {filteredAdvances.map((advance) => {
                        const project = projectById.get(advance.projectId);
                        const person = advancePersonByRecordKey.get(getAdvanceRecordKey(advance)) || resolveAdvancePerson(advance, personDirectory);
                        const financials = calculateAdministrativeAdvanceFinancials(advance);
                        const meta = getAdvanceStatusMeta(advance.status);
                        const displayId = String(advance.customId || advance.id);
                        const detail = administrativeDetailByKey.get(getAdvanceRecordKey(advance));
                        return (
                          <article key={getAdvanceRecordKey(advance)} className="p-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-[0.1em] ring-1 ${meta.className}`}>{detail?.stage || meta.label}</span>
                              <span className="rounded-md bg-indigo-50 px-2 py-1 text-[10px] font-black text-indigo-700">ID {displayId}</span>
                            </div>
                            <h3 className="mt-3 truncate text-base font-black text-slate-950">{person.name}</h3>
                            <p className="mt-1 truncate text-xs font-semibold text-slate-500">{project?.name || advance.projectId} · {advance.destination || 'Sin destino'}</p>
                            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                              <div className="rounded-lg bg-slate-50 p-2"><span className="block font-bold text-slate-400">Girado</span><strong>{formatMoney(financials.paid)}</strong></div>
                              <div className="rounded-lg bg-indigo-50 p-2"><span className="block font-bold text-indigo-400">Justificado</span><strong className="text-indigo-700">{formatMoney(financials.justified)}</strong></div>
                              <div className="rounded-lg bg-emerald-50 p-2"><span className="block font-bold text-emerald-500">Legalizado</span><strong className="text-emerald-700">{formatMoney(financials.legalized)}</strong></div>
                              <div className="rounded-lg bg-amber-50 p-2"><span className="block font-bold text-amber-500">Pendiente</span><strong className="text-amber-700">{formatMoney(financials.justificationPending)}</strong></div>
                            </div>
                            <div className="mt-3 flex items-center justify-between gap-3">
                              <p className={`truncate text-xs font-black ${detail?.hasAdministrativeAlert || detail?.hasJustificationDelay ? 'text-rose-700' : 'text-emerald-700'}`}>
                                {detail?.alertLabel || 'Sin alerta'}
                              </p>
                              <button
                                type="button"
                                onClick={() => openProjectWorkspace(advance.projectId)}
                                className="shrink-0 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-black text-white"
                              >
                                Gestionar
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                )}
              </>
            )}

            <section id="administration-project-workspace" className="scroll-mt-4 overflow-hidden rounded-xl border border-indigo-100 bg-white shadow-sm">
              {operationProject ? (
                <>
                  <div className="flex flex-col gap-3 border-b border-indigo-100 bg-indigo-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-indigo-500">Operación dentro del centro global</p>
                      <h2 className="mt-1 truncate text-base font-black text-slate-950">{operationProject.name || operationProject.id}</h2>
                      <p className="mt-0.5 truncate text-xs font-semibold text-slate-500">{organizationNameFor(operationProject, organizations)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedProjectId('all')}
                        className="h-9 rounded-lg border border-indigo-100 bg-white px-3 text-xs font-black text-indigo-700 transition hover:bg-indigo-100"
                      >
                        Volver al resumen global
                      </button>
                      <Link
                        href={`/projects/${operationProject.id}?tab=administration`}
                        className="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-950 px-3 text-xs font-black text-white transition hover:bg-slate-800"
                      >
                        Abrir proyecto
                        <ArrowRight size={14} />
                      </Link>
                    </div>
                  </div>
                  <div className="p-3">
                    {operationProjectTasksLoading && (
                      <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500">
                        Cargando tareas del proyecto seleccionado...
                      </div>
                    )}
                    <ProjectAdministration
                      key={operationProject.id}
                      projectId={operationProject.id}
                      project={operationProject}
                      presentation="embedded"
                      tasks={operationProjectTasks}
                      contractorActivityTasks={operationActivityTasks}
                      teamMembers={teamMembers}
                      approvalTeamMembers={teamMembers}
                      currentUser={user}
                      userRole={userRole}
                      canView
                      canManage={canManageAdministration}
                      canValidate={canValidateAdministration}
                      canEditAccountingClosures={canEditAccountingClosures}
                      canEditAccountingClosureDate={canEditAccountingClosureDate}
                      canDeleteAccountingClosures={canDeleteAccountingClosures}
                      canDeleteAdministrativeReceipts={canDeleteAdministrativeReceipts}
                      canConfigure={canConfigureAdministration}
                    />
                  </div>
                </>
              ) : (
                <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100">
                      <FolderKanban size={19} />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-sm font-black text-slate-950">Gestiona un proyecto sin salir del centro global</h2>
                      <p className="mt-1 text-xs font-semibold text-slate-500">Selecciona un proyecto arriba o usa “Gestionar aquí” en cualquier anticipo.</p>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-lg bg-slate-50 px-3 py-2 text-xs font-black text-slate-500 ring-1 ring-slate-100">
                    {visibleProjects.length} disponibles
                  </span>
                </div>
              )}
            </section>
          </>
        )}

        {isStatusReportOpen && hasAdministrativeControl && (
          <div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/65 p-3 backdrop-blur-sm sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="administrative-status-report-title"
            onMouseDown={(event) => {
              if (event.currentTarget === event.target) setIsStatusReportOpen(false);
            }}
          >
            <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
              <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="inline-flex items-center gap-2 rounded-md bg-indigo-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-indigo-700">
                    <BarChart3 size={13} />
                    Balance administrativo
                  </div>
                  <h2 id="administrative-status-report-title" className="mt-2 text-2xl font-black tracking-tight text-slate-950">
                    Informe de estado de anticipos
                  </h2>
                  <p className="mt-1 text-sm font-semibold text-slate-500">{administrativeStatusReport.scopeLabel}</p>
                  <p className="mt-1 text-xs font-medium text-slate-400">{administrativeStatusReport.filtersLabel}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void downloadAdministrativeStatusReport()}
                    disabled={isGeneratingStatusReport || administrativeStatusReport.advances.length === 0}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-black text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Download size={16} className={isGeneratingStatusReport ? 'animate-bounce' : ''} />
                    {isGeneratingStatusReport ? 'Generando...' : 'Descargar PDF'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsStatusReportOpen(false)}
                    className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                    aria-label="Cerrar informe"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              <div className="overflow-y-auto p-5">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                  {[
                    ['Anticipos', String(administrativeStatusReport.totals.advanceCount), `${administrativeStatusReport.totals.withLegalizations} con legalizaciones`],
                    ['Girado / abonado', formatMoney(administrativeStatusReport.totals.paid), `${administrativeStatusReport.totals.paymentPending > 0 ? formatMoney(administrativeStatusReport.totals.paymentPending) : '$ 0'} por pagar`],
                    ['Justificado vigente', formatMoney(administrativeStatusReport.totals.justified), 'Sin soportes devueltos'],
                    ['Legalizado', formatMoney(administrativeStatusReport.totals.legalized), 'Validado administrativamente'],
                    ['Pendiente justificar', formatMoney(administrativeStatusReport.totals.justificationPending), `${administrativeStatusReport.totals.withoutLegalizations} sin legalizaciones`],
                    ['Costo real', billingPaymentsLoaded && !billingPaymentsError ? formatMoney(administrativeStatusReport.totals.realCost) : '—', billingPaymentsError ? 'Fuente de pagos no disponible' : 'Pagos verificados'],
                  ].map(([label, value, detail]) => (
                    <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{label}</p>
                      <p className="mt-2 text-xl font-black tracking-tight text-slate-950">{value}</p>
                      <p className="mt-1 text-xs font-bold text-slate-500">{detail}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  <div className={`rounded-xl border p-4 ${administrativeStatusReport.totals.administrativeDelayCount > 0 ? 'border-rose-200 bg-rose-50' : 'border-emerald-200 bg-emerald-50'}`}>
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${administrativeStatusReport.totals.administrativeDelayCount > 0 ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {administrativeStatusReport.totals.administrativeDelayCount > 0 ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
                      </div>
                      <div>
                        <p className="text-sm font-black text-slate-950">Demoras administrativas</p>
                        <p className="mt-1 text-2xl font-black text-slate-950">{administrativeStatusReport.totals.administrativeDelayCount}</p>
                        <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">
                          Anticipos con una aprobación, pago, validación, auditoría o conciliación pendiente durante {administrativeStatusReport.administrativeDelayDays} días o más.
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className={`rounded-xl border p-4 ${administrativeStatusReport.totals.justificationDelayCount > 0 ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${administrativeStatusReport.totals.justificationDelayCount > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {administrativeStatusReport.totals.justificationDelayCount > 0 ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
                      </div>
                      <div>
                        <p className="text-sm font-black text-slate-950">Demoras de justificación</p>
                        <p className="mt-1 text-2xl font-black text-slate-950">{administrativeStatusReport.totals.justificationDelayCount}</p>
                        <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">
                          Anticipos que ya superaron su fecha final y conservan dinero girado sin legalización válida ni devolución.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <section className="mt-5 overflow-hidden rounded-xl border border-slate-200">
                  <div className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="text-sm font-black text-slate-950">Tablero por persona</h3>
                      <p className="mt-1 text-xs font-semibold text-slate-500">Cada fila aporta directamente al total general del informe.</p>
                    </div>
                    <span className={`inline-flex w-fit items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${
                      administrativeTotalsReconciled && billingPaymentsLoaded && !billingPaymentsError
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}>
                      <CheckCircle2 size={13} />
                      {administrativeTotalsReconciled && billingPaymentsLoaded && !billingPaymentsError ? 'Suma verificada' : 'Verificación parcial'}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[920px] border-collapse text-left">
                      <thead>
                        <tr className="border-b border-slate-100 text-[10px] font-black uppercase tracking-[0.13em] text-slate-400">
                          <th className="px-4 py-3">Persona</th>
                          <th className="px-3 py-3">Alcance</th>
                          <th className="px-3 py-3 text-right">Girado</th>
                          <th className="px-3 py-3 text-right">Justificado</th>
                          <th className="px-3 py-3 text-right">Legalizado</th>
                          <th className="px-3 py-3 text-right">Pendiente</th>
                          <th className="px-4 py-3 text-right">Gestiones / demoras</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {administrativeStatusReport.people.map((person) => (
                          <tr key={person.personKey}>
                            <td className="px-4 py-3">
                              <p className="max-w-[210px] truncate text-sm font-black text-slate-900">{person.requesterName}</p>
                              <p className="mt-0.5 max-w-[210px] truncate text-[11px] font-semibold text-slate-400">{person.requesterEmail || 'Sin correo'}</p>
                            </td>
                            <td className="px-3 py-3 text-xs font-bold text-slate-600">{person.advanceCount} anticipos · {person.projectCount} proyectos</td>
                            <td className="whitespace-nowrap px-3 py-3 text-right text-sm font-black text-slate-800">{formatMoney(person.paid)}</td>
                            <td className="whitespace-nowrap px-3 py-3 text-right text-sm font-black text-indigo-700">{formatMoney(person.justified)}</td>
                            <td className="whitespace-nowrap px-3 py-3 text-right text-sm font-black text-emerald-700">{formatMoney(person.legalized)}</td>
                            <td className="whitespace-nowrap px-3 py-3 text-right text-sm font-black text-amber-700">{formatMoney(person.justificationPending)}</td>
                            <td className="whitespace-nowrap px-4 py-3 text-right text-xs font-black text-slate-600">
                              {person.administrativePendingTasks} / {person.administrativeDelayCount + person.justificationDelayCount}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <div className="mt-5 grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
                  <section className="overflow-hidden rounded-xl border border-slate-200">
                    <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                      <h3 className="text-sm font-black text-slate-950">Carga pendiente de administración</h3>
                      <p className="mt-1 text-xs font-semibold text-slate-500">
                        {administrativeStatusReport.totals.administrativePendingTasks} tareas o soportes requieren gestión.
                      </p>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {administrativeStatusReport.queues.map((queue) => (
                        <div key={queue.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-black text-slate-800">{queue.label}</p>
                            <p className="mt-1 text-xs font-semibold text-slate-500">
                              {queue.advanceCount} anticipo{queue.advanceCount === 1 ? '' : 's'} · {queue.itemCount} tarea{queue.itemCount === 1 ? '' : 's'}
                              {queue.oldestDays !== null ? ` · máximo ${queue.oldestDays} días` : ''}
                            </p>
                          </div>
                          <p className="text-sm font-black text-slate-950">{formatMoney(queue.amount)}</p>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="overflow-hidden rounded-xl border border-slate-200">
                    <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                      <h3 className="text-sm font-black text-slate-950">Quién debe legalizaciones</h3>
                      <p className="mt-1 text-xs font-semibold text-slate-500">Responsables ordenados por vencimiento y saldo pendiente.</p>
                    </div>
                    <div className="max-h-[330px] divide-y divide-slate-100 overflow-y-auto">
                      {administrativeStatusReport.debtors.length === 0 ? (
                        <div className="px-4 py-10 text-center text-sm font-bold text-emerald-700">No hay obligaciones de justificación pendientes.</div>
                      ) : (
                        administrativeStatusReport.debtors.map((debtor) => (
                          <div key={`${debtor.requesterEmail}-${debtor.requesterName}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-black text-slate-800">{debtor.requesterName}</p>
                              <p className="mt-1 truncate text-xs font-semibold text-slate-500">
                                {debtor.advanceCount} anticipo{debtor.advanceCount === 1 ? '' : 's'} · {debtor.overdueCount} vencido{debtor.overdueCount === 1 ? '' : 's'}
                                {debtor.oldestOverdueDays > 0 ? ` · hasta ${debtor.oldestOverdueDays} días` : ''}
                              </p>
                            </div>
                            <p className="text-sm font-black text-amber-700">{formatMoney(debtor.pending)}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </section>
                </div>

                <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-xs font-semibold leading-5 text-indigo-800">
                  El PDF incluye el balance financiero, las tareas administrativas, los responsables de legalización y el detalle de cada anticipo. Los soportes pendientes de validación se atribuyen a administración; los devueltos continúan a cargo del solicitante.
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
