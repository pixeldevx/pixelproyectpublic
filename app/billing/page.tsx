"use client"

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CreditCard,
  Download,
  Edit3,
  FileText,
  Landmark,
  Plus,
  Receipt,
  Search,
  ShieldCheck,
  Trash2,
  WalletCards,
  X,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import {
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from '@/lib/supabase/document-store';
import { db, auth } from '@/lib/backend';
import { useAuth } from '@/hooks/useAuth';
import { useRolePermissions } from '@/hooks/useRolePermissions';
import { belongsToAnyOrganization, organizationNameFor } from '@/lib/organizations';
import {
  getRateCardCostValue,
  getRateCardIncomeValue,
  normalizeDecimalInput,
} from '@/lib/rate-card-config';
import { toast } from 'sonner';

type InvoiceStatus = 'pending' | 'partial' | 'paid' | 'cancelled';
type PaymentStatus = 'scheduled' | 'paid' | 'cancelled';
type BillingView = 'overview' | 'invoices' | 'payments' | 'budget';

type ProjectRow = {
  id: string;
  name?: string;
  description?: string;
  ownerId?: string;
  organizationId?: string;
  organizationIds?: string[];
  organizationName?: string;
  organizationNames?: string[];
  assignedUsers?: string[];
  assignedEmails?: string[];
  assignedTeamMembers?: string[];
  status?: string;
  [key: string]: any;
};

type Invoice = {
  id: string;
  projectId: string;
  invoiceNumber?: string;
  description?: string;
  amount?: number;
  collectedAmount?: number;
  date?: any;
  dueDate?: any;
  status?: InvoiceStatus;
  budgetLineId?: string | null;
  budgetPieceId?: string | null;
  notes?: string;
  createdAt?: any;
  createdBy?: string;
};

type BillingPayment = {
  id: string;
  projectId: string;
  description?: string;
  vendor?: string;
  amount?: number;
  date?: any;
  status?: PaymentStatus;
  budgetLineId?: string | null;
  budgetPieceId?: string | null;
  notes?: string;
  createdAt?: any;
  createdBy?: string;
};

type BudgetPieceRef = {
  id: string;
  name: string;
  category?: string;
  total: number;
};

type BudgetLineSummary = {
  id: string;
  projectId: string;
  projectName: string;
  organizationName: string;
  name: string;
  color: string;
  currency: string;
  planned: number;
  estimatedIncome: number;
  estimatedCost: number;
  realIncome: number;
  collected: number;
  realCost: number;
  pendingCollection: number;
  margin: number;
  pieces: BudgetPieceRef[];
};

const todayInput = () => new Date().toISOString().split('T')[0];

const emptyInvoiceForm = () => ({
  projectId: '',
  invoiceNumber: '',
  description: '',
  amount: '',
  collectedAmount: '',
  date: todayInput(),
  dueDate: '',
  status: 'pending' as InvoiceStatus,
  budgetLineId: '',
  budgetPieceId: '',
  notes: '',
});

const emptyPaymentForm = () => ({
  projectId: '',
  description: '',
  vendor: '',
  amount: '',
  date: todayInput(),
  status: 'paid' as PaymentStatus,
  budgetLineId: '',
  budgetPieceId: '',
  notes: '',
});

const statusStyles: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700 ring-amber-100',
  partial: 'bg-blue-50 text-blue-700 ring-blue-100',
  paid: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  scheduled: 'bg-indigo-50 text-indigo-700 ring-indigo-100',
  cancelled: 'bg-slate-100 text-slate-500 ring-slate-200',
};

const statusLabels: Record<string, string> = {
  pending: 'Pendiente',
  partial: 'Parcial',
  paid: 'Pagado',
  scheduled: 'Programado',
  cancelled: 'Cancelado',
};

const moneyFormatter = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

const compactMoneyFormatter = new Intl.NumberFormat('es-CO', {
  notation: 'compact',
  compactDisplay: 'short',
  maximumFractionDigits: 1,
});

const numberFormatter = new Intl.NumberFormat('es-CO');

const formatMoney = (value: any) => moneyFormatter.format(normalizeDecimalInput(value, 0));
const formatCompactMoney = (value: any) => `$${compactMoneyFormatter.format(normalizeDecimalInput(value, 0))}`;
const normalizeEmail = (value: any) => String(value || '').trim().toLowerCase();
const normalizeOrgToken = (value: any) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');

const pushOrganizationToken = (tokens: Set<string>, value: any) => {
  const token = normalizeOrgToken(value);
  if (token) tokens.add(token);
};

const addOrganizationSourceTokens = (tokens: Set<string>, source: any) => {
  if (!source) return;

  if (typeof source === 'string') {
    pushOrganizationToken(tokens, source);
    return;
  }

  if (Array.isArray(source)) {
    source.forEach((item) => addOrganizationSourceTokens(tokens, item));
    return;
  }

  if (typeof source === 'object') {
    [
      source.id,
      source.name,
      source.displayName,
      source.label,
      source.slug,
      source.code,
      source.organizationId,
      source.organizationName,
    ].forEach((value) => pushOrganizationToken(tokens, value));
  }
};

const collectProjectOrganizationTokens = (project: any) => {
  const tokens = new Set<string>();
  [
    project?.organizationId,
    project?.organizationIds,
    project?.organizationName,
    project?.organizationNames,
    project?.organization,
    project?.organizations,
    project?.client,
    project?.clientName,
    project?.company,
    project?.companyName,
    project?.tenantId,
    project?.tenantName,
  ].forEach((source) => addOrganizationSourceTokens(tokens, source));
  return tokens;
};

const organizationTokensFor = (organizationId: string, organizations: any[]) => {
  const tokens = new Set<string>();
  pushOrganizationToken(tokens, organizationId);
  const organization = organizations.find((item) => item.id === organizationId);
  addOrganizationSourceTokens(tokens, organization);
  return tokens;
};

const projectMatchesOrganization = (project: any, organizationId: string, organizations: any[]) => {
  if (organizationId === 'all') return true;
  const projectTokens = collectProjectOrganizationTokens(project);
  const expectedTokens = organizationTokensFor(organizationId, organizations);
  return Array.from(expectedTokens).some((token) => projectTokens.has(token));
};

const projectBelongsToManagedOrganizations = (project: any, managedOrganizationIds: string[], organizations: any[]) => {
  if (managedOrganizationIds.length === 0) return true;
  return managedOrganizationIds.some((organizationId) => projectMatchesOrganization(project, organizationId, organizations));
};

const getLegacyOrganizationLabel = (project: any): string | null => {
  const candidates = [
    project?.organizationName,
    project?.organization,
    project?.clientName,
    project?.client,
    project?.companyName,
    project?.company,
    project?.tenantName,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    if (candidate && typeof candidate === 'object') {
      const label = candidate.name || candidate.displayName || candidate.label || candidate.id;
      if (typeof label === 'string' && label.trim()) return label.trim();
    }
  }

  if (Array.isArray(project?.organizationNames)) {
    const names = project.organizationNames.filter((name: unknown) => typeof name === 'string' && name.trim());
    if (names.length > 0) return names.join(', ');
  }

  return null;
};

const billingOrganizationNameFor = (project: any, organizations: any[]) => {
  const resolved = organizationNameFor(project, organizations);
  return resolved !== 'Sin organización' ? resolved : getLegacyOrganizationLabel(project) || resolved;
};

const getEmbeddedCollectionItems = (project: ProjectRow, keys: string[]) => {
  return keys.flatMap((key) => {
    const value = project[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
      return Object.entries(value).map(([id, item]) => ({
        id,
        ...(typeof item === 'object' && item ? item : { value: item }),
      }));
    }
    return [];
  });
};

const normalizeEmbeddedCollection = <T extends { id: string; projectId: string }>(
  project: ProjectRow,
  keys: string[]
) =>
  getEmbeddedCollectionItems(project, keys).map((item: any, index) => ({
    id: item?.id || `${project.id}-${keys[0]}-${index}`,
    projectId: item?.projectId || project.id,
    ...item,
  })) as T[];

const mergeProjectRows = <T extends { id: string; projectId: string }>(primaryRows: T[], fallbackRows: T[]) => {
  const rowsByKey = new Map<string, T>();
  [...fallbackRows, ...primaryRows].forEach((row) => {
    if (!row?.id || !row?.projectId) return;
    rowsByKey.set(`${row.projectId}/${row.id}`, row);
  });
  return Array.from(rowsByKey.values());
};

const toDate = (value: any): Date | null => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toDateInput = (value: any) => {
  const date = toDate(value);
  return date ? date.toISOString().split('T')[0] : '';
};

const formatDate = (value: any) => {
  const date = toDate(value);
  if (!date) return 'Sin fecha';
  return date.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
};

const getTime = (value: any) => toDate(value)?.getTime() || 0;

const csvEscape = (value: any) => `"${String(value ?? '').replace(/"/g, '""')}"`;

const getProjectIdFromSnapshot = (snapshotDoc: any, data: any) => {
  if (data?.projectId) return data.projectId;
  const path = snapshotDoc?.ref?.path || '';
  const segments = path.split('/');
  const projectIndex = segments.indexOf('projects');
  return projectIndex >= 0 ? segments[projectIndex + 1] || '' : '';
};

const buildUserIds = (user: any, teamMembers: any[]) => {
  const ids = new Set<string>();
  const userUid = user?.uid || '';
  const userEmail = normalizeEmail(user?.email);

  if (userUid) ids.add(userUid);
  teamMembers.forEach((member) => {
    const memberEmail = normalizeEmail(member.email);
    if (member.id && memberEmail && memberEmail === userEmail) ids.add(member.id);
    if (member.id && member.authUserId && member.authUserId === userUid) ids.add(member.id);
    if (member.id && member.uid && member.uid === userUid) ids.add(member.id);
  });

  return Array.from(ids);
};

const getActiveMonthCount = (piece: any) => {
  if (Array.isArray(piece?.activeMonths) && piece.activeMonths.length > 0) return piece.activeMonths.length;
  return normalizeDecimalInput(piece?.duration, 1);
};

const getPieceTotal = (piece: any) =>
  normalizeDecimalInput(piece?.quantity, 0) *
  getActiveMonthCount(piece) *
  normalizeDecimalInput(piece?.multiplier, 0) *
  normalizeDecimalInput(piece?.unitCost, 0);

const getBudgetPieces = (line: any): BudgetPieceRef[] => {
  const rawPieces = Array.isArray(line?.components)
    ? line.components
    : Array.isArray(line?.pieces)
      ? line.pieces
      : [];

  if (rawPieces.length > 0) {
    return rawPieces.map((piece: any, index: number) => ({
      id: piece?.id || `${line.id}-piece-${index}`,
      name: piece?.name || piece?.label || `Pieza ${index + 1}`,
      category: piece?.category || piece?.categoryLabel || 'general',
      total: getPieceTotal(piece),
    }));
  }

  if (normalizeDecimalInput(line?.plannedAmount, 0) > 0) {
    return [{
      id: 'base-budget',
      name: 'Presupuesto base',
      category: 'general',
      total: normalizeDecimalInput(line?.plannedAmount, 0),
    }];
  }

  return [];
};

const getLinePlannedAmount = (line: any) => {
  const piecesTotal = getBudgetPieces(line).reduce((sum, piece) => sum + piece.total, 0);
  return piecesTotal || normalizeDecimalInput(line?.plannedAmount, 0);
};

const getInvoiceCollectedAmount = (invoice: Invoice) => {
  if (invoice.status === 'cancelled') return 0;
  if (invoice.status === 'paid' && invoice.collectedAmount === undefined) return normalizeDecimalInput(invoice.amount, 0);
  return normalizeDecimalInput(invoice.collectedAmount, 0);
};

function MetricCard({
  label,
  value,
  detail,
  icon,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
  tone: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">{label}</p>
          <p className="mt-2 truncate text-2xl font-black tracking-tight text-slate-950">{value}</p>
          <p className="mt-1 text-sm font-bold text-slate-500">{detail}</p>
        </div>
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ${tone}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

export default function BillingPage() {
  const { user, userRole, userOrganizationId, userOrganizationIds } = useAuth();
  const { permissions: rolePermissions } = useRolePermissions(userRole);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<BillingPayment[]>([]);
  const [budgetLines, setBudgetLines] = useState<any[]>([]);
  const [rateCards, setRateCards] = useState<any[]>([]);
  const [rateCardEntries, setRateCardEntries] = useState<any[]>([]);
  const [activeView, setActiveView] = useState<BillingView>('overview');
  const [selectedProjectId, setSelectedProjectId] = useState('all');
  const [selectedOrganizationId, setSelectedOrganizationId] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [modalType, setModalType] = useState<'invoice' | 'payment' | null>(null);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [editingPayment, setEditingPayment] = useState<BillingPayment | null>(null);
  const [invoiceForm, setInvoiceForm] = useState(emptyInvoiceForm);
  const [paymentForm, setPaymentForm] = useState(emptyPaymentForm);

  const canAccessBilling = Boolean(rolePermissions.billingOverview);
  const canManageBilling = Boolean(rolePermissions.billingManage);
  const managedOrganizationIds = useMemo(
    () => (userOrganizationIds.length > 0 ? userOrganizationIds : userOrganizationId ? [userOrganizationId] : []),
    [userOrganizationId, userOrganizationIds]
  );
  const canSeeAllOrganizations = userRole === 'admin' && managedOrganizationIds.length === 0;

  useEffect(() => {
    if (!user || !canAccessBilling) return;

    const unsubscribeOrganizations = onSnapshot(
      query(collection(db, 'organizations')),
      (snapshot) => setOrganizations(snapshot.docs.map((orgDoc) => ({ id: orgDoc.id, ...orgDoc.data() }))),
      (error) => console.error('Error loading billing organizations:', error)
    );

    const unsubscribeProjects = onSnapshot(
      query(collection(db, 'projects')),
      (snapshot) => {
        const rows = snapshot.docs.map((projectDoc) => ({ id: projectDoc.id, ...projectDoc.data() } as ProjectRow));
        rows.sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')));
        setProjects(rows);
        setLoading(false);
      },
      (error) => {
        console.error('Error loading billing projects:', error);
        setLoading(false);
      }
    );

    const unsubscribeTeam = onSnapshot(
      query(collection(db, 'team_members')),
      (snapshot) => setTeamMembers(snapshot.docs.map((memberDoc) => ({ id: memberDoc.id, ...memberDoc.data() }))),
      (error) => console.error('Error loading billing team members:', error)
    );

    const unsubscribeInvoices = onSnapshot(
      query(collectionGroup(db, 'invoices'), orderBy('date', 'desc')),
      (snapshot) => {
        setInvoices(snapshot.docs.map((invoiceDoc) => {
          const data = invoiceDoc.data();
          return {
            id: invoiceDoc.id,
            projectId: getProjectIdFromSnapshot(invoiceDoc, data),
            ...data,
          } as Invoice;
        }));
      },
      (error) => console.error('Error loading global invoices:', error)
    );

    const unsubscribePayments = onSnapshot(
      query(collectionGroup(db, 'billingPayments'), orderBy('date', 'desc')),
      (snapshot) => {
        setPayments(snapshot.docs.map((paymentDoc) => {
          const data = paymentDoc.data();
          return {
            id: paymentDoc.id,
            projectId: getProjectIdFromSnapshot(paymentDoc, data),
            ...data,
          } as BillingPayment;
        }));
      },
      (error) => console.error('Error loading global payments:', error)
    );

    const unsubscribeBudgetLines = onSnapshot(
      query(collectionGroup(db, 'budgetLines')),
      (snapshot) => {
        setBudgetLines(snapshot.docs.map((budgetDoc) => {
          const data = budgetDoc.data();
          return {
            id: budgetDoc.id,
            projectId: getProjectIdFromSnapshot(budgetDoc, data),
            ...data,
          };
        }));
      },
      (error) => console.error('Error loading global budget lines:', error)
    );

    const unsubscribeRateCards = onSnapshot(
      query(collectionGroup(db, 'rateCards')),
      (snapshot) => {
        setRateCards(snapshot.docs.map((rateCardDoc) => {
          const data = rateCardDoc.data();
          return {
            id: rateCardDoc.id,
            projectId: getProjectIdFromSnapshot(rateCardDoc, data),
            ...data,
          };
        }));
      },
      (error) => console.error('Error loading global rate cards:', error)
    );

    const unsubscribeRateEntries = onSnapshot(
      query(collectionGroup(db, 'rateCardEntries')),
      (snapshot) => {
        setRateCardEntries(snapshot.docs.map((entryDoc) => {
          const data = entryDoc.data();
          return {
            id: entryDoc.id,
            projectId: getProjectIdFromSnapshot(entryDoc, data),
            ...data,
          };
        }));
      },
      (error) => console.error('Error loading global rate entries:', error)
    );

    return () => {
      unsubscribeOrganizations();
      unsubscribeProjects();
      unsubscribeTeam();
      unsubscribeInvoices();
      unsubscribePayments();
      unsubscribeBudgetLines();
      unsubscribeRateCards();
      unsubscribeRateEntries();
    };
  }, [canAccessBilling, user]);

  const currentUserIds = useMemo(() => buildUserIds(user, teamMembers), [teamMembers, user]);

  const scopedProjects = useMemo(() => {
    return projects.filter((project) => {
      if (canSeeAllOrganizations) return true;

      const projectInManagedOrg =
        managedOrganizationIds.length > 0 &&
        (belongsToAnyOrganization(project, managedOrganizationIds) ||
          projectBelongsToManagedOrganizations(project, managedOrganizationIds, organizations));
      if (userRole === 'org_admin') return projectInManagedOrg;

      const assignedUsers = Array.isArray(project.assignedUsers) ? project.assignedUsers : [];
      const assignedTeamMembers = Array.isArray(project.assignedTeamMembers) ? project.assignedTeamMembers : [];
      const assignedEmails = Array.isArray(project.assignedEmails) ? project.assignedEmails.map(normalizeEmail) : [];
      const userEmail = normalizeEmail(user?.email);
      const directlyAssigned =
        project.ownerId === user?.uid ||
        assignedUsers.includes(user?.uid || '') ||
        assignedEmails.includes(userEmail) ||
        assignedTeamMembers.some((memberId) => currentUserIds.includes(memberId));

      return directlyAssigned || projectInManagedOrg;
    });
  }, [canSeeAllOrganizations, currentUserIds, managedOrganizationIds, organizations, projects, user?.email, user?.uid, userRole]);

  const scopedProjectIds = useMemo(() => new Set(scopedProjects.map((project) => project.id)), [scopedProjects]);
  const projectById = useMemo(() => new Map(scopedProjects.map((project) => [project.id, project])), [scopedProjects]);

  const visibleProjects = useMemo(() => {
    return scopedProjects.filter(
      (project) =>
        selectedOrganizationId === 'all' ||
        belongsToAnyOrganization(project, [selectedOrganizationId]) ||
        projectMatchesOrganization(project, selectedOrganizationId, organizations)
    );
  }, [organizations, scopedProjects, selectedOrganizationId]);
  const visibleProjectIds = useMemo(() => new Set(visibleProjects.map((project) => project.id)), [visibleProjects]);

  const embeddedInvoices = useMemo(
    () => scopedProjects.flatMap((project) => normalizeEmbeddedCollection<Invoice>(project, ['invoices', 'billingInvoices', 'facturas'])),
    [scopedProjects]
  );
  const embeddedPayments = useMemo(
    () => scopedProjects.flatMap((project) => normalizeEmbeddedCollection<BillingPayment>(project, ['billingPayments', 'payments', 'pagos'])),
    [scopedProjects]
  );
  const embeddedBudgetLines = useMemo(
    () => scopedProjects.flatMap((project) => normalizeEmbeddedCollection<any>(project, ['budgetLines', 'budgetLineItems'])),
    [scopedProjects]
  );
  const embeddedRateCards = useMemo(
    () => scopedProjects.flatMap((project) => normalizeEmbeddedCollection<any>(project, ['rateCards'])),
    [scopedProjects]
  );
  const embeddedRateEntries = useMemo(
    () => scopedProjects.flatMap((project) => normalizeEmbeddedCollection<any>(project, ['rateCardEntries', 'rateEntries'])),
    [scopedProjects]
  );

  const scopedInvoices = useMemo(
    () => mergeProjectRows(invoices.filter((invoice) => scopedProjectIds.has(invoice.projectId)), embeddedInvoices),
    [embeddedInvoices, invoices, scopedProjectIds]
  );
  const scopedPayments = useMemo(
    () => mergeProjectRows(payments.filter((payment) => scopedProjectIds.has(payment.projectId)), embeddedPayments),
    [embeddedPayments, payments, scopedProjectIds]
  );
  const scopedBudgetLines = useMemo(
    () => mergeProjectRows(budgetLines.filter((line) => scopedProjectIds.has(line.projectId)), embeddedBudgetLines),
    [budgetLines, embeddedBudgetLines, scopedProjectIds]
  );
  const scopedRateCards = useMemo(
    () => mergeProjectRows(rateCards.filter((card) => scopedProjectIds.has(card.projectId)), embeddedRateCards),
    [embeddedRateCards, rateCards, scopedProjectIds]
  );
  const scopedRateEntries = useMemo(
    () => mergeProjectRows(rateCardEntries.filter((entry) => scopedProjectIds.has(entry.projectId)), embeddedRateEntries),
    [embeddedRateEntries, rateCardEntries, scopedProjectIds]
  );

  const rateCardActuals = useMemo(() => {
    return scopedRateCards.map((card) => {
      const entries = scopedRateEntries.filter((entry) => entry.projectId === card.projectId && entry.rateCardId === card.id);
      const unitsFromEntries = entries.reduce((sum, entry) => sum + normalizeDecimalInput(entry.units ?? entry.quantity ?? entry.value, 0), 0);
      const userStatsTotal = card.userStats
        ? Object.values(card.userStats).reduce((sum: number, value: any) => sum + normalizeDecimalInput(value, 0), 0)
        : 0;
      const units = Math.max(normalizeDecimalInput(card.currentValue, 0), unitsFromEntries, userStatsTotal);
      const reworkUnits = normalizeDecimalInput(card.reworkValue, 0);
      const entryIncome = entries.reduce((sum, entry) => sum + normalizeDecimalInput(entry.income ?? entry.incomeValue, 0), 0);
      const entryCost = entries.reduce((sum, entry) => sum + normalizeDecimalInput(entry.cost ?? entry.costValue, 0), 0);
      const estimatedIncome = entryIncome || getRateCardIncomeValue(units, card);
      const estimatedCost = entryCost || getRateCardCostValue(units + reworkUnits, card);

      return {
        ...card,
        units,
        reworkUnits,
        entryCount: entries.length,
        estimatedIncome,
        estimatedCost,
      };
    });
  }, [scopedRateCards, scopedRateEntries]);

  const budgetSummaries = useMemo<BudgetLineSummary[]>(() => {
    return scopedBudgetLines.map((line) => {
      const project = projectById.get(line.projectId);
      const pieces = getBudgetPieces(line);
      const planned = getLinePlannedAmount(line);
      const relatedRates = rateCardActuals.filter((card) => card.projectId === line.projectId && card.budgetLineId === line.id);
      const lineInvoices = scopedInvoices.filter((invoice) => invoice.status !== 'cancelled' && invoice.projectId === line.projectId && invoice.budgetLineId === line.id);
      const linePayments = scopedPayments.filter((payment) => payment.status !== 'cancelled' && payment.projectId === line.projectId && payment.budgetLineId === line.id);
      const realIncome = lineInvoices.reduce((sum, invoice) => sum + normalizeDecimalInput(invoice.amount, 0), 0);
      const collected = lineInvoices.reduce((sum, invoice) => sum + getInvoiceCollectedAmount(invoice), 0);
      const realCost = linePayments
        .filter((payment) => payment.status === 'paid')
        .reduce((sum, payment) => sum + normalizeDecimalInput(payment.amount, 0), 0);
      const estimatedIncome = relatedRates.reduce((sum, card) => sum + normalizeDecimalInput(card.estimatedIncome, 0), 0);
      const estimatedCost = relatedRates.reduce((sum, card) => sum + normalizeDecimalInput(card.estimatedCost, 0), 0);

      return {
        id: line.id,
        projectId: line.projectId,
        projectName: project?.name || line.projectId,
        organizationName: billingOrganizationNameFor(project || {}, organizations),
        name: line.name || line.description || 'Línea sin nombre',
        color: line.color || '#4f46e5',
        currency: line.currency || 'COP',
        planned,
        estimatedIncome,
        estimatedCost,
        realIncome,
        collected,
        realCost,
        pendingCollection: Math.max(realIncome - collected, 0),
        margin: collected - realCost,
        pieces,
      };
    });
  }, [organizations, projectById, rateCardActuals, scopedBudgetLines, scopedInvoices, scopedPayments]);

  const filteredInvoices = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();

    return scopedInvoices
      .filter((invoice) => visibleProjectIds.has(invoice.projectId))
      .filter((invoice) => selectedProjectId === 'all' || invoice.projectId === selectedProjectId)
      .filter((invoice) => statusFilter === 'all' || invoice.status === statusFilter)
      .filter((invoice) => {
        if (!search) return true;
        const project = projectById.get(invoice.projectId);
        return [
          invoice.invoiceNumber,
          invoice.description,
          invoice.notes,
          project?.name,
          billingOrganizationNameFor(project || {}, organizations),
          invoice.status,
        ].filter(Boolean).some((value) => String(value).toLowerCase().includes(search));
      })
      .sort((left, right) => getTime(right.date || right.createdAt) - getTime(left.date || left.createdAt));
  }, [organizations, projectById, scopedInvoices, searchTerm, selectedProjectId, statusFilter, visibleProjectIds]);

  const filteredPayments = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();

    return scopedPayments
      .filter((payment) => visibleProjectIds.has(payment.projectId))
      .filter((payment) => selectedProjectId === 'all' || payment.projectId === selectedProjectId)
      .filter((payment) => statusFilter === 'all' || payment.status === statusFilter)
      .filter((payment) => {
        if (!search) return true;
        const project = projectById.get(payment.projectId);
        return [
          payment.description,
          payment.vendor,
          payment.notes,
          project?.name,
          billingOrganizationNameFor(project || {}, organizations),
          payment.status,
        ].filter(Boolean).some((value) => String(value).toLowerCase().includes(search));
      })
      .sort((left, right) => getTime(right.date || right.createdAt) - getTime(left.date || left.createdAt));
  }, [organizations, projectById, scopedPayments, searchTerm, selectedProjectId, statusFilter, visibleProjectIds]);

  const filteredBudgetSummaries = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();

    return budgetSummaries
      .filter((line) => visibleProjectIds.has(line.projectId))
      .filter((line) => selectedProjectId === 'all' || line.projectId === selectedProjectId)
      .filter((line) => !search || [line.name, line.projectName, line.organizationName].some((value) => value.toLowerCase().includes(search)))
      .sort((left, right) => right.planned - left.planned || left.projectName.localeCompare(right.projectName));
  }, [budgetSummaries, searchTerm, selectedProjectId, visibleProjectIds]);

  const totals = useMemo(() => {
    const activeInvoices = filteredInvoices.filter((invoice) => invoice.status !== 'cancelled');
    const activePayments = filteredPayments.filter((payment) => payment.status !== 'cancelled');
    const totalInvoiced = activeInvoices.reduce((sum, invoice) => sum + normalizeDecimalInput(invoice.amount, 0), 0);
    const totalCollected = activeInvoices.reduce((sum, invoice) => sum + getInvoiceCollectedAmount(invoice), 0);
    const totalPaidCosts = activePayments
      .filter((payment) => payment.status === 'paid')
      .reduce((sum, payment) => sum + normalizeDecimalInput(payment.amount, 0), 0);
    const scheduledCosts = activePayments
      .filter((payment) => payment.status === 'scheduled')
      .reduce((sum, payment) => sum + normalizeDecimalInput(payment.amount, 0), 0);
    const totalPlanned = filteredBudgetSummaries.reduce((sum, line) => sum + line.planned, 0);
    const estimatedIncome = rateCardActuals
      .filter((card) => visibleProjectIds.has(card.projectId))
      .filter((card) => selectedProjectId === 'all' || card.projectId === selectedProjectId)
      .reduce((sum, card) => sum + normalizeDecimalInput(card.estimatedIncome, 0), 0);
    const estimatedCost = rateCardActuals
      .filter((card) => visibleProjectIds.has(card.projectId))
      .filter((card) => selectedProjectId === 'all' || card.projectId === selectedProjectId)
      .reduce((sum, card) => sum + normalizeDecimalInput(card.estimatedCost, 0), 0);

    return {
      totalPlanned,
      estimatedIncome,
      estimatedCost,
      estimatedMargin: estimatedIncome - estimatedCost,
      totalInvoiced,
      totalCollected,
      pendingCollection: Math.max(totalInvoiced - totalCollected, 0),
      totalPaidCosts,
      scheduledCosts,
      realMargin: totalCollected - totalPaidCosts,
      realMarginPercent: totalCollected > 0 ? ((totalCollected - totalPaidCosts) / totalCollected) * 100 : 0,
      projectCount: new Set([
        ...filteredInvoices.map((invoice) => invoice.projectId),
        ...filteredPayments.map((payment) => payment.projectId),
        ...filteredBudgetSummaries.map((line) => line.projectId),
      ]).size,
    };
  }, [filteredBudgetSummaries, filteredInvoices, filteredPayments, rateCardActuals, selectedProjectId, visibleProjectIds]);

  const chartData = useMemo(() => [
    { name: 'Plan', Planificado: totals.totalPlanned, Ingresos: 0, Costos: 0 },
    { name: 'Rate Cards', Planificado: 0, Ingresos: totals.estimatedIncome, Costos: totals.estimatedCost },
    { name: 'Real', Planificado: 0, Ingresos: totals.totalCollected, Costos: totals.totalPaidCosts },
  ], [totals]);

  const selectedInvoiceLine = budgetSummaries.find((line) => line.projectId === invoiceForm.projectId && line.id === invoiceForm.budgetLineId);
  const selectedPaymentLine = budgetSummaries.find((line) => line.projectId === paymentForm.projectId && line.id === paymentForm.budgetLineId);
  const selectedProjectBudgetLines = budgetSummaries.filter((line) => line.projectId === (modalType === 'invoice' ? invoiceForm.projectId : paymentForm.projectId));

  const openInvoiceModal = (invoice?: Invoice) => {
    const defaultProjectId = invoice?.projectId || (selectedProjectId !== 'all' ? selectedProjectId : visibleProjects[0]?.id || '');
    setEditingPayment(null);
    setEditingInvoice(invoice || null);
    setInvoiceForm(invoice ? {
      projectId: invoice.projectId,
      invoiceNumber: invoice.invoiceNumber || '',
      description: invoice.description || '',
      amount: String(invoice.amount || ''),
      collectedAmount: invoice.collectedAmount !== undefined ? String(invoice.collectedAmount) : '',
      date: toDateInput(invoice.date) || todayInput(),
      dueDate: toDateInput(invoice.dueDate),
      status: invoice.status || 'pending',
      budgetLineId: invoice.budgetLineId || '',
      budgetPieceId: invoice.budgetPieceId || '',
      notes: invoice.notes || '',
    } : { ...emptyInvoiceForm(), projectId: defaultProjectId });
    setModalType('invoice');
  };

  const openPaymentModal = (payment?: BillingPayment) => {
    const defaultProjectId = payment?.projectId || (selectedProjectId !== 'all' ? selectedProjectId : visibleProjects[0]?.id || '');
    setEditingInvoice(null);
    setEditingPayment(payment || null);
    setPaymentForm(payment ? {
      projectId: payment.projectId,
      description: payment.description || '',
      vendor: payment.vendor || '',
      amount: String(payment.amount || ''),
      date: toDateInput(payment.date) || todayInput(),
      status: payment.status || 'paid',
      budgetLineId: payment.budgetLineId || '',
      budgetPieceId: payment.budgetPieceId || '',
      notes: payment.notes || '',
    } : { ...emptyPaymentForm(), projectId: defaultProjectId });
    setModalType('payment');
  };

  const closeModal = () => {
    setModalType(null);
    setEditingInvoice(null);
    setEditingPayment(null);
  };

  const handleInvoiceSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!auth.currentUser || !canManageBilling || !invoiceForm.projectId) return;

    const amount = normalizeDecimalInput(invoiceForm.amount, 0);
    const collectedAmount = invoiceForm.status === 'paid'
      ? normalizeDecimalInput(invoiceForm.collectedAmount || amount, amount)
      : invoiceForm.status === 'cancelled'
        ? 0
        : normalizeDecimalInput(invoiceForm.collectedAmount, 0);
    const invoiceData = {
      projectId: invoiceForm.projectId,
      invoiceNumber: invoiceForm.invoiceNumber.trim(),
      description: invoiceForm.description.trim(),
      amount,
      collectedAmount,
      date: new Date(invoiceForm.date),
      dueDate: invoiceForm.dueDate ? new Date(invoiceForm.dueDate) : null,
      status: invoiceForm.status,
      budgetLineId: invoiceForm.budgetLineId || null,
      budgetPieceId: invoiceForm.budgetPieceId || null,
      notes: invoiceForm.notes.trim(),
      updatedAt: serverTimestamp(),
    };

    try {
      if (editingInvoice) {
        await updateDoc(doc(db, `projects/${editingInvoice.projectId}/invoices`, editingInvoice.id), invoiceData);
        toast.success('Factura actualizada');
      } else {
        await addDoc(collection(db, `projects/${invoiceForm.projectId}/invoices`), {
          ...invoiceData,
          createdAt: serverTimestamp(),
          createdBy: auth.currentUser.uid,
        });
        toast.success('Factura creada');
      }
      closeModal();
    } catch (error) {
      console.error('Error saving global invoice:', error);
      toast.error('No se pudo guardar la factura');
    }
  };

  const handlePaymentSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!auth.currentUser || !canManageBilling || !paymentForm.projectId) return;

    const paymentData = {
      projectId: paymentForm.projectId,
      description: paymentForm.description.trim(),
      vendor: paymentForm.vendor.trim(),
      amount: normalizeDecimalInput(paymentForm.amount, 0),
      date: new Date(paymentForm.date),
      status: paymentForm.status,
      budgetLineId: paymentForm.budgetLineId || null,
      budgetPieceId: paymentForm.budgetPieceId || null,
      notes: paymentForm.notes.trim(),
      updatedAt: serverTimestamp(),
    };

    try {
      if (editingPayment) {
        await updateDoc(doc(db, `projects/${editingPayment.projectId}/billingPayments`, editingPayment.id), paymentData);
        toast.success('Pago actualizado');
      } else {
        await addDoc(collection(db, `projects/${paymentForm.projectId}/billingPayments`), {
          ...paymentData,
          createdAt: serverTimestamp(),
          createdBy: auth.currentUser.uid,
        });
        toast.success('Pago registrado');
      }
      closeModal();
    } catch (error) {
      console.error('Error saving global payment:', error);
      toast.error('No se pudo guardar el pago real');
    }
  };

  const handleDeleteInvoice = async (invoice: Invoice) => {
    if (!canManageBilling || !confirm('¿Eliminar esta factura?')) return;
    try {
      await deleteDoc(doc(db, `projects/${invoice.projectId}/invoices`, invoice.id));
      toast.success('Factura eliminada');
    } catch (error) {
      console.error('Error deleting invoice:', error);
      toast.error('No se pudo eliminar la factura');
    }
  };

  const handleDeletePayment = async (payment: BillingPayment) => {
    if (!canManageBilling || !confirm('¿Eliminar este pago real?')) return;
    try {
      await deleteDoc(doc(db, `projects/${payment.projectId}/billingPayments`, payment.id));
      toast.success('Pago eliminado');
    } catch (error) {
      console.error('Error deleting payment:', error);
      toast.error('No se pudo eliminar el pago');
    }
  };

  const downloadCsvReport = () => {
    const invoiceRows = filteredInvoices.map((invoice) => {
      const project = projectById.get(invoice.projectId);
      return [
        'Factura',
        project?.name || invoice.projectId,
        billingOrganizationNameFor(project || {}, organizations),
        invoice.invoiceNumber || '',
        invoice.description || '',
        formatDate(invoice.date),
        statusLabels[invoice.status || 'pending'],
        normalizeDecimalInput(invoice.amount, 0),
        getInvoiceCollectedAmount(invoice),
        '',
      ];
    });
    const paymentRows = filteredPayments.map((payment) => {
      const project = projectById.get(payment.projectId);
      return [
        'Pago',
        project?.name || payment.projectId,
        billingOrganizationNameFor(project || {}, organizations),
        '',
        payment.description || '',
        formatDate(payment.date),
        statusLabels[payment.status || 'paid'],
        '',
        '',
        normalizeDecimalInput(payment.amount, 0),
      ];
    });
    const headers = ['Tipo', 'Proyecto', 'Organización', 'Número factura', 'Descripción', 'Fecha', 'Estado', 'Facturado', 'Cobrado', 'Pagado'];
    const csv = [headers.map(csvEscape).join(','), ...[...invoiceRows, ...paymentRows].map((row) => row.map(csvEscape).join(','))].join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `facturacion-global-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!canAccessBilling) {
    return (
      <DashboardLayout>
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <ShieldCheck className="mx-auto h-12 w-12 text-slate-300" />
          <h1 className="mt-4 text-2xl font-black text-slate-950">Acceso restringido</h1>
          <p className="mx-auto mt-2 max-w-xl text-sm font-medium text-slate-500">
            La facturación global requiere permiso activo. Pídele a un administrador habilitarlo desde la consola de permisos.
          </p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="relative border-b border-slate-100 bg-slate-950 px-5 py-6 text-white">
            <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(90deg,rgba(255,255,255,.08)_1px,transparent_1px),linear-gradient(rgba(255,255,255,.08)_1px,transparent_1px)] [background-size:24px_24px]" />
            <div className="relative flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="max-w-4xl">
                <div className="inline-flex items-center gap-2 rounded bg-emerald-400/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-emerald-200 ring-1 ring-emerald-300/20">
                  <Landmark size={14} />
                  Finanzas reales multi-proyecto
                </div>
                <h1 className="mt-3 text-3xl font-black tracking-tight">Facturación global</h1>
                <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-300">
                  Gestiona facturas, cobros y pagos reales desde un solo lugar, cruzando proyectos, organizaciones, presupuesto planificado y avance operativo por Rate Cards.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={downloadCsvReport} disabled={filteredInvoices.length + filteredPayments.length === 0} className="h-11 bg-white font-black text-slate-950 hover:bg-slate-100">
                  <Download size={16} className="mr-2" />
                  Descargar
                </Button>
                {canManageBilling && (
                  <>
                    <Button type="button" onClick={() => openPaymentModal()} variant="outline" className="h-11 border-white/20 bg-white/10 font-black text-white hover:bg-white/20">
                      <CreditCard size={16} className="mr-2" />
                      Nuevo pago
                    </Button>
                    <Button type="button" onClick={() => openInvoiceModal()} className="h-11 bg-emerald-400 font-black text-slate-950 hover:bg-emerald-300">
                      <Plus size={16} className="mr-2" />
                      Nueva factura
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          <MetricCard label="Facturado" value={formatMoney(totals.totalInvoiced)} detail={`${numberFormatter.format(filteredInvoices.length)} facturas`} icon={<FileText size={21} />} tone="bg-blue-50 text-blue-700 ring-blue-100" />
          <MetricCard label="Cobrado" value={formatMoney(totals.totalCollected)} detail={`${formatMoney(totals.pendingCollection)} pendiente`} icon={<Receipt size={21} />} tone="bg-emerald-50 text-emerald-700 ring-emerald-100" />
          <MetricCard label="Pagos reales" value={formatMoney(totals.totalPaidCosts)} detail={`${formatMoney(totals.scheduledCosts)} programado`} icon={<CreditCard size={21} />} tone="bg-rose-50 text-rose-700 ring-rose-100" />
          <MetricCard label="Margen real" value={formatMoney(totals.realMargin)} detail={`${totals.realMarginPercent.toFixed(1)}% sobre lo cobrado`} icon={<BarChart3 size={21} />} tone="bg-indigo-50 text-indigo-700 ring-indigo-100" />
          <MetricCard label="Presupuesto" value={formatMoney(totals.totalPlanned)} detail={`${totals.projectCount} proyectos con movimiento`} icon={<WalletCards size={21} />} tone="bg-cyan-50 text-cyan-700 ring-cyan-100" />
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 xl:grid-cols-[1fr_220px_220px_180px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Buscar factura, pago, proyecto, organización o estado..."
                className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
              />
            </div>
            <select
              value={selectedOrganizationId}
              onChange={(event) => {
                setSelectedOrganizationId(event.target.value);
                setSelectedProjectId('all');
              }}
              className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-600 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
            >
              <option value="all">Todas las organizaciones</option>
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>{organization.name || organization.id}</option>
              ))}
            </select>
            <select
              value={selectedProjectId}
              onChange={(event) => setSelectedProjectId(event.target.value)}
              className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-600 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
            >
              <option value="all">Todos los proyectos</option>
              {visibleProjects.map((project) => (
                <option key={project.id} value={project.id}>{project.name || project.id}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-600 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
            >
              <option value="all">Todos los estados</option>
              <option value="pending">Pendientes</option>
              <option value="partial">Parciales</option>
              <option value="paid">Pagadas / pagados</option>
              <option value="scheduled">Programados</option>
              <option value="cancelled">Cancelados</option>
            </select>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="text-xl font-black text-slate-950">Centro financiero</h2>
              <p className="text-sm font-semibold text-slate-500">Planificado vs operativo estimado vs realidad financiera.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {([
                ['overview', 'Resumen'],
                ['invoices', `Facturas ${filteredInvoices.length}`],
                ['payments', `Pagos ${filteredPayments.length}`],
                ['budget', `Presupuesto ${filteredBudgetSummaries.length}`],
              ] as Array<[BillingView, string]>).map(([view, label]) => (
                <button
                  key={view}
                  type="button"
                  onClick={() => setActiveView(view)}
                  className={`rounded-lg px-3 py-2 text-sm font-black transition ${
                    activeView === view
                      ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-16">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-indigo-600" />
            </div>
          ) : activeView === 'overview' ? (
            <div className="grid gap-5 p-4 xl:grid-cols-[1fr_380px]">
              <div className="min-h-80 rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="text-lg font-black text-slate-950">Comparativo financiero</h3>
                <p className="text-sm font-semibold text-slate-500">El Rate Card es estimado operativo; facturas y pagos son realidad.</p>
                <div className="mt-4 h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 12, fontWeight: 700 }} />
                      <YAxis tickFormatter={(value) => formatCompactMoney(value)} tick={{ fill: '#64748b', fontSize: 11 }} width={80} />
                      <RechartsTooltip formatter={(value: any) => formatMoney(value)} />
                      <Bar dataKey="Planificado" fill="#6366f1" radius={[8, 8, 0, 0]} />
                      <Bar dataKey="Ingresos" fill="#10b981" radius={[8, 8, 0, 0]} />
                      <Bar dataKey="Costos" fill="#ef4444" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="space-y-3">
                <InfoPanel title="Estimado por Rate Cards" value={formatMoney(totals.estimatedIncome)} detail={`Costo estimado ${formatMoney(totals.estimatedCost)} · margen ${formatMoney(totals.estimatedMargin)}`} tone="bg-indigo-50 text-indigo-700 ring-indigo-100" />
                <InfoPanel title="Real cobrado vs pagado" value={formatMoney(totals.realMargin)} detail={`Cobrado ${formatMoney(totals.totalCollected)} · pagado ${formatMoney(totals.totalPaidCosts)}`} tone={totals.realMargin >= 0 ? 'bg-emerald-50 text-emerald-700 ring-emerald-100' : 'bg-red-50 text-red-700 ring-red-100'} />
                <InfoPanel title="Bolsa planificada" value={formatMoney(totals.totalPlanned)} detail={`${numberFormatter.format(filteredBudgetSummaries.length)} líneas presupuestales en alcance`} tone="bg-cyan-50 text-cyan-700 ring-cyan-100" />
              </div>
            </div>
          ) : activeView === 'invoices' ? (
            <InvoiceTable invoices={filteredInvoices} projectById={projectById} organizations={organizations} canManage={canManageBilling} onEdit={openInvoiceModal} onDelete={handleDeleteInvoice} />
          ) : activeView === 'payments' ? (
            <PaymentTable payments={filteredPayments} projectById={projectById} organizations={organizations} canManage={canManageBilling} onEdit={openPaymentModal} onDelete={handleDeletePayment} />
          ) : (
            <BudgetTable lines={filteredBudgetSummaries} />
          )}
        </section>

        {modalType === 'invoice' && (
          <BillingModal title={editingInvoice ? 'Editar factura' : 'Nueva factura'} onClose={closeModal}>
            <form onSubmit={handleInvoiceSubmit} className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Proyecto">
                  <select
                    required
                    value={invoiceForm.projectId}
                    onChange={(event) => setInvoiceForm({ ...invoiceForm, projectId: event.target.value, budgetLineId: '', budgetPieceId: '' })}
                    className="billing-input"
                  >
                    <option value="">Selecciona proyecto</option>
                    {visibleProjects.map((project) => (
                      <option key={project.id} value={project.id}>{project.name || project.id}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Estado">
                  <select value={invoiceForm.status} onChange={(event) => setInvoiceForm({ ...invoiceForm, status: event.target.value as InvoiceStatus })} className="billing-input">
                    <option value="pending">Pendiente</option>
                    <option value="partial">Parcial</option>
                    <option value="paid">Pagada</option>
                    <option value="cancelled">Cancelada</option>
                  </select>
                </Field>
                <Field label="Número de factura">
                  <input required value={invoiceForm.invoiceNumber} onChange={(event) => setInvoiceForm({ ...invoiceForm, invoiceNumber: event.target.value })} className="billing-input" placeholder="FAC-001" />
                </Field>
                <Field label="Descripción">
                  <input required value={invoiceForm.description} onChange={(event) => setInvoiceForm({ ...invoiceForm, description: event.target.value })} className="billing-input" placeholder="Concepto facturado" />
                </Field>
                <Field label="Valor facturado">
                  <input required type="number" step="0.01" value={invoiceForm.amount} onChange={(event) => setInvoiceForm({ ...invoiceForm, amount: event.target.value })} className="billing-input" />
                </Field>
                <Field label="Valor cobrado">
                  <input type="number" step="0.01" value={invoiceForm.collectedAmount} onChange={(event) => setInvoiceForm({ ...invoiceForm, collectedAmount: event.target.value })} className="billing-input" placeholder="0 si sigue pendiente" />
                </Field>
                <Field label="Fecha de factura">
                  <input type="date" value={invoiceForm.date} onChange={(event) => setInvoiceForm({ ...invoiceForm, date: event.target.value })} className="billing-input" />
                </Field>
                <Field label="Fecha límite de cobro">
                  <input type="date" value={invoiceForm.dueDate} onChange={(event) => setInvoiceForm({ ...invoiceForm, dueDate: event.target.value })} className="billing-input" />
                </Field>
              </div>
              <BudgetSelector
                lines={selectedProjectBudgetLines}
                selectedLineId={invoiceForm.budgetLineId}
                selectedPieceId={invoiceForm.budgetPieceId}
                selectedLine={selectedInvoiceLine}
                onLineChange={(budgetLineId) => setInvoiceForm({ ...invoiceForm, budgetLineId, budgetPieceId: '' })}
                onPieceChange={(budgetPieceId) => setInvoiceForm({ ...invoiceForm, budgetPieceId })}
              />
              <Field label="Notas">
                <textarea value={invoiceForm.notes} onChange={(event) => setInvoiceForm({ ...invoiceForm, notes: event.target.value })} className="billing-input min-h-24" placeholder="Notas internas de cobro, radicado, acta o soporte." />
              </Field>
              <ModalActions onCancel={closeModal} submitLabel={editingInvoice ? 'Guardar factura' : 'Crear factura'} />
            </form>
          </BillingModal>
        )}

        {modalType === 'payment' && (
          <BillingModal title={editingPayment ? 'Editar pago real' : 'Nuevo pago real'} onClose={closeModal}>
            <form onSubmit={handlePaymentSubmit} className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Proyecto">
                  <select
                    required
                    value={paymentForm.projectId}
                    onChange={(event) => setPaymentForm({ ...paymentForm, projectId: event.target.value, budgetLineId: '', budgetPieceId: '' })}
                    className="billing-input"
                  >
                    <option value="">Selecciona proyecto</option>
                    {visibleProjects.map((project) => (
                      <option key={project.id} value={project.id}>{project.name || project.id}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Estado">
                  <select value={paymentForm.status} onChange={(event) => setPaymentForm({ ...paymentForm, status: event.target.value as PaymentStatus })} className="billing-input">
                    <option value="paid">Pagado</option>
                    <option value="scheduled">Programado</option>
                    <option value="cancelled">Cancelado</option>
                  </select>
                </Field>
                <Field label="Proveedor / tercero">
                  <input value={paymentForm.vendor} onChange={(event) => setPaymentForm({ ...paymentForm, vendor: event.target.value })} className="billing-input" placeholder="Proveedor, contratista o profesional" />
                </Field>
                <Field label="Descripción">
                  <input required value={paymentForm.description} onChange={(event) => setPaymentForm({ ...paymentForm, description: event.target.value })} className="billing-input" placeholder="Concepto pagado" />
                </Field>
                <Field label="Valor pagado">
                  <input required type="number" step="0.01" value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} className="billing-input" />
                </Field>
                <Field label="Fecha de pago">
                  <input type="date" value={paymentForm.date} onChange={(event) => setPaymentForm({ ...paymentForm, date: event.target.value })} className="billing-input" />
                </Field>
              </div>
              <BudgetSelector
                lines={selectedProjectBudgetLines}
                selectedLineId={paymentForm.budgetLineId}
                selectedPieceId={paymentForm.budgetPieceId}
                selectedLine={selectedPaymentLine}
                onLineChange={(budgetLineId) => setPaymentForm({ ...paymentForm, budgetLineId, budgetPieceId: '' })}
                onPieceChange={(budgetPieceId) => setPaymentForm({ ...paymentForm, budgetPieceId })}
              />
              <Field label="Notas">
                <textarea value={paymentForm.notes} onChange={(event) => setPaymentForm({ ...paymentForm, notes: event.target.value })} className="billing-input min-h-24" placeholder="Soporte, factura del proveedor, orden de compra o comentario operativo." />
              </Field>
              <ModalActions onCancel={closeModal} submitLabel={editingPayment ? 'Guardar pago' : 'Registrar pago'} />
            </form>
          </BillingModal>
        )}

        <style jsx global>{`
          .billing-input {
            height: 44px;
            width: 100%;
            border-radius: 0.75rem;
            border: 1px solid #dbe4f0;
            background: white;
            padding: 0 0.9rem;
            font-size: 0.875rem;
            font-weight: 700;
            color: #334155;
            outline: none;
            transition: border-color .18s ease, box-shadow .18s ease;
          }
          textarea.billing-input {
            height: auto;
            padding-top: 0.8rem;
            padding-bottom: 0.8rem;
          }
          .billing-input:focus {
            border-color: #6366f1;
            box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.12);
          }
        `}</style>
      </div>
    </DashboardLayout>
  );
}

function InfoPanel({ title, value, detail, tone }: { title: string; value: string; detail: string; tone: string }) {
  return (
    <div className={`rounded-xl p-4 ring-1 ${tone}`}>
      <p className="text-[11px] font-black uppercase tracking-[0.16em] opacity-80">{title}</p>
      <p className="mt-2 text-2xl font-black tracking-tight">{value}</p>
      <p className="mt-1 text-sm font-bold opacity-80">{detail}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-black uppercase tracking-[0.14em] text-slate-400">{label}</span>
      {children}
    </label>
  );
}

function BillingModal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-5">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-indigo-600">Gestión financiera</p>
            <h3 className="text-2xl font-black tracking-tight text-slate-950">{title}</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
            <X size={22} />
          </button>
        </div>
        <div className="overflow-y-auto p-5">
          {children}
        </div>
      </div>
    </div>
  );
}

function BudgetSelector({
  lines,
  selectedLineId,
  selectedPieceId,
  selectedLine,
  onLineChange,
  onPieceChange,
}: {
  lines: BudgetLineSummary[];
  selectedLineId: string;
  selectedPieceId: string;
  selectedLine?: BudgetLineSummary;
  onLineChange: (lineId: string) => void;
  onPieceChange: (pieceId: string) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Asociación presupuestal</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <select value={selectedLineId} onChange={(event) => onLineChange(event.target.value)} className="billing-input">
          <option value="">Sin línea de presupuesto</option>
          {lines.map((line) => (
            <option key={`${line.projectId}-${line.id}`} value={line.id}>{line.name}</option>
          ))}
        </select>
        <select value={selectedPieceId} onChange={(event) => onPieceChange(event.target.value)} className="billing-input" disabled={!selectedLine}>
          <option value="">Sin pieza específica</option>
          {(selectedLine?.pieces || []).map((piece) => (
            <option key={piece.id} value={piece.id}>{piece.name}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function ModalActions({ onCancel, submitLabel }: { onCancel: () => void; submitLabel: string }) {
  return (
    <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
      <Button type="button" variant="outline" onClick={onCancel} className="border-slate-200 font-black">
        Cancelar
      </Button>
      <Button type="submit" className="bg-indigo-600 font-black text-white hover:bg-indigo-700">
        {submitLabel}
      </Button>
    </div>
  );
}

function InvoiceTable({
  invoices,
  projectById,
  organizations,
  canManage,
  onEdit,
  onDelete,
}: {
  invoices: Invoice[];
  projectById: Map<string, ProjectRow>;
  organizations: any[];
  canManage: boolean;
  onEdit: (invoice: Invoice) => void;
  onDelete: (invoice: Invoice) => void;
}) {
  if (invoices.length === 0) return <EmptyState label="No hay facturas en el alcance seleccionado." />;

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-100">
        <thead className="bg-slate-50">
          <tr className="text-left text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">
            <th className="px-5 py-4">Factura</th>
            <th className="px-5 py-4">Proyecto</th>
            <th className="px-5 py-4">Fecha</th>
            <th className="px-5 py-4">Estado</th>
            <th className="px-5 py-4 text-right">Facturado</th>
            <th className="px-5 py-4 text-right">Cobrado</th>
            <th className="px-5 py-4 text-right">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {invoices.map((invoice) => {
            const project = projectById.get(invoice.projectId);
            return (
              <tr key={`${invoice.projectId}-${invoice.id}`} className="hover:bg-blue-50/40">
                <td className="px-5 py-4">
                  <p className="font-black text-slate-950">{invoice.invoiceNumber || 'Sin número'}</p>
                  <p className="mt-1 max-w-sm truncate text-xs font-bold text-slate-500">{invoice.description || 'Sin descripción'}</p>
                </td>
                <td className="px-5 py-4">
                  <p className="font-black text-slate-700">{project?.name || invoice.projectId}</p>
                  <p className="text-xs font-bold text-emerald-700">{billingOrganizationNameFor(project || {}, organizations)}</p>
                </td>
                <td className="px-5 py-4 text-sm font-bold text-slate-600">{formatDate(invoice.date)}</td>
                <td className="px-5 py-4">
                  <span className={`rounded px-2 py-1 text-xs font-black ring-1 ${statusStyles[invoice.status || 'pending']}`}>
                    {statusLabels[invoice.status || 'pending']}
                  </span>
                </td>
                <td className="px-5 py-4 text-right font-black text-slate-950">{formatMoney(invoice.amount)}</td>
                <td className="px-5 py-4 text-right font-black text-emerald-700">{formatMoney(getInvoiceCollectedAmount(invoice))}</td>
                <td className="px-5 py-4">
                  <RowActions canManage={canManage} editLabel="Editar factura" deleteLabel="Eliminar factura" onEdit={() => onEdit(invoice)} onDelete={() => onDelete(invoice)} projectId={invoice.projectId} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PaymentTable({
  payments,
  projectById,
  organizations,
  canManage,
  onEdit,
  onDelete,
}: {
  payments: BillingPayment[];
  projectById: Map<string, ProjectRow>;
  organizations: any[];
  canManage: boolean;
  onEdit: (payment: BillingPayment) => void;
  onDelete: (payment: BillingPayment) => void;
}) {
  if (payments.length === 0) return <EmptyState label="No hay pagos reales en el alcance seleccionado." />;

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-100">
        <thead className="bg-slate-50">
          <tr className="text-left text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">
            <th className="px-5 py-4">Pago</th>
            <th className="px-5 py-4">Proyecto</th>
            <th className="px-5 py-4">Fecha</th>
            <th className="px-5 py-4">Estado</th>
            <th className="px-5 py-4 text-right">Valor</th>
            <th className="px-5 py-4 text-right">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {payments.map((payment) => {
            const project = projectById.get(payment.projectId);
            return (
              <tr key={`${payment.projectId}-${payment.id}`} className="hover:bg-rose-50/30">
                <td className="px-5 py-4">
                  <p className="font-black text-slate-950">{payment.description || 'Pago sin descripción'}</p>
                  <p className="mt-1 max-w-sm truncate text-xs font-bold text-slate-500">{payment.vendor || 'Sin tercero'} {payment.notes ? `· ${payment.notes}` : ''}</p>
                </td>
                <td className="px-5 py-4">
                  <p className="font-black text-slate-700">{project?.name || payment.projectId}</p>
                  <p className="text-xs font-bold text-emerald-700">{billingOrganizationNameFor(project || {}, organizations)}</p>
                </td>
                <td className="px-5 py-4 text-sm font-bold text-slate-600">{formatDate(payment.date)}</td>
                <td className="px-5 py-4">
                  <span className={`rounded px-2 py-1 text-xs font-black ring-1 ${statusStyles[payment.status || 'paid']}`}>
                    {statusLabels[payment.status || 'paid']}
                  </span>
                </td>
                <td className="px-5 py-4 text-right font-black text-rose-700">{formatMoney(payment.amount)}</td>
                <td className="px-5 py-4">
                  <RowActions canManage={canManage} editLabel="Editar pago" deleteLabel="Eliminar pago" onEdit={() => onEdit(payment)} onDelete={() => onDelete(payment)} projectId={payment.projectId} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BudgetTable({ lines }: { lines: BudgetLineSummary[] }) {
  if (lines.length === 0) return <EmptyState label="No hay líneas presupuestales en el alcance seleccionado." />;

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-100">
        <thead className="bg-slate-50">
          <tr className="text-left text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">
            <th className="px-5 py-4">Línea</th>
            <th className="px-5 py-4">Proyecto</th>
            <th className="px-5 py-4 text-right">Plan</th>
            <th className="px-5 py-4 text-right">Rate Cards</th>
            <th className="px-5 py-4 text-right">Real</th>
            <th className="px-5 py-4 text-right">Margen</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {lines.map((line) => (
            <tr key={`${line.projectId}-${line.id}`} className="hover:bg-slate-50">
              <td className="px-5 py-4">
                <div className="flex items-center gap-2">
                  <span className="h-8 w-2 rounded-full" style={{ backgroundColor: line.color }} />
                  <div>
                    <p className="font-black text-slate-950">{line.name}</p>
                    <p className="text-xs font-bold text-slate-500">{line.pieces.length} piezas</p>
                  </div>
                </div>
              </td>
              <td className="px-5 py-4">
                <p className="font-black text-slate-700">{line.projectName}</p>
                <p className="text-xs font-bold text-emerald-700">{line.organizationName}</p>
              </td>
              <td className="px-5 py-4 text-right font-black text-indigo-700">{formatMoney(line.planned)}</td>
              <td className="px-5 py-4 text-right">
                <p className="font-black text-emerald-700">{formatMoney(line.estimatedIncome)}</p>
                <p className="text-xs font-bold text-rose-600">Costo {formatMoney(line.estimatedCost)}</p>
              </td>
              <td className="px-5 py-4 text-right">
                <p className="font-black text-emerald-700">{formatMoney(line.collected)}</p>
                <p className="text-xs font-bold text-rose-600">Pago {formatMoney(line.realCost)}</p>
              </td>
              <td className={`px-5 py-4 text-right font-black ${line.margin >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatMoney(line.margin)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RowActions({
  canManage,
  editLabel,
  deleteLabel,
  onEdit,
  onDelete,
  projectId,
}: {
  canManage: boolean;
  editLabel: string;
  deleteLabel: string;
  onEdit: () => void;
  onDelete: () => void;
  projectId: string;
}) {
  return (
    <div className="flex justify-end gap-2">
      <Link href={`/projects/${projectId}?tab=billing`}>
        <Button type="button" size="sm" variant="outline" className="h-9 border-slate-200 font-black">
          Abrir
          <ArrowRight size={14} className="ml-1" />
        </Button>
      </Link>
      {canManage && (
        <>
          <Button type="button" size="icon" variant="ghost" onClick={onEdit} title={editLabel} className="h-9 w-9 text-slate-500 hover:text-indigo-700">
            <Edit3 size={16} />
          </Button>
          <Button type="button" size="icon" variant="ghost" onClick={onDelete} title={deleteLabel} className="h-9 w-9 text-slate-400 hover:bg-red-50 hover:text-red-600">
            <Trash2 size={16} />
          </Button>
        </>
      )}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="py-16 text-center">
      <AlertTriangle className="mx-auto h-11 w-11 text-slate-300" />
      <p className="mt-3 text-sm font-bold text-slate-500">{label}</p>
    </div>
  );
}
