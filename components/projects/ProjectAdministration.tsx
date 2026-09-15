"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import {
  AlertCircle,
  ArrowUpDown,
  ArrowRight,
  Banknote,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  ClipboardCheck,
  CreditCard,
  Download,
  Eye,
  EyeOff,
  FileImage,
  FileText,
  FolderKanban,
  Inbox,
  ExternalLink,
  Loader2,
  MapPin,
  PencilLine,
  Plus,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UploadCloud,
  WalletCards,
  X,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { Button } from '@/components/ui/button';
import { SecureDocumentLink } from '@/components/projects/SecureDocumentLink';
import { addDoc, arrayUnion, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where } from '@/lib/supabase/document-store';
import { db, storage, supabase } from '@/lib/backend';
import {
  ref,
  uploadBytes,
  getDownloadURL,
  getAuthorizedDownloadBlob,
  getAuthorizedDownloadURL,
  getStoragePathFromDownloadUrl,
  deleteObject,
} from '@/lib/supabase/storage-shim';
import { buildDocumentStoragePath, getDocumentFolderStorageSegments } from '@/lib/document-storage';
import { ensureManagedDocumentFolderPath } from '@/lib/document-folders';
import { isCompletedTaskStatus } from '@/lib/taskProgress';
import {
  AdvanceDossierReport,
  generateAdvanceDossierPdf,
} from '@/lib/advance-dossier-pdf';
import {
  ContractorAccountPdfReport,
  generateContractorAccountPdf,
} from '@/lib/contractor-account-report-pdf';
import {
  getRateCardCostValue,
  getRateCardIncomeValue,
  normalizeDecimalInput,
} from '@/lib/rate-card-config';
import { getOrganizationIds } from '@/lib/organizations';
import { notifyAdvanceRequestSubmitted, notifyTaskAssignment } from '@/lib/notifications';
import {
  getContractorAccountConfiguredApproverId as getConfiguredContractorAccountApproverId,
  resolveContractorAccountApprovalConfig,
  type ContractorAccountStatus,
} from '@/lib/contractor-account-workflow';
import {
  PdfPasswordCancelledError,
  preparePdfForUpload,
  type PdfPasswordRequest,
  type PreparedPdfUpload,
} from '@/lib/pdf-normalization';

type ColombiaDepartment = {
  department: string;
  municipalities: string[];
};

type ExpenseCategory = {
  id: string;
  name: string;
  defaultDailyAmount?: number;
  unitLabel?: string;
  active?: boolean;
  requiresCufe?: boolean;
  color?: string;
  description?: string;
};

type CostCenterDomain = {
  id: string;
  name: string;
  code?: string;
  active?: boolean;
  description?: string;
};

type ContractorAccountPayerDomain = {
  id: string;
  name: string;
  taxId: string;
  address?: string;
  city?: string;
  active?: boolean;
};

type ContractorBankAccount = {
  id: string;
  bankName: string;
  accountType: string;
  accountNumber: string;
  holderName?: string;
  holderDocument?: string;
  isDefault?: boolean;
};

type AdvanceItem = {
  id: string;
  categoryId: string;
  categoryName: string;
  days: number;
  unitAmount: number;
  amount: number;
  note?: string;
  billingPaymentId?: string;
  customAmount?: boolean;
};

type CostCenterAllocation = {
  id: string;
  domainId?: string;
  name: string;
  percentage: number;
  amount: number;
  note?: string;
};

type ReceiptDocumentType = 'invoice' | 'cash_receipt';

type ReceiptStatus = 'submitted' | 'approved' | 'approved_modified' | 'audit_pending' | 'audit_passed' | 'audit_alert' | 'returned' | 'rejected';

type ReceiptFieldChange = {
  field: string;
  label: string;
  previousValue: string | number | null;
  nextValue: string | number | null;
};

type ReceiptRevision = {
  type: 'returned' | 'resubmitted' | 'approved' | 'approved_modified' | 'audit_pending' | 'audit_passed' | 'audit_alert' | 'support_replaced' | 'pdf_normalized';
  actorId?: string | null;
  actorName?: string;
  at: string;
  comment?: string;
  changes?: ReceiptFieldChange[];
};

type PdfNormalizationTrace = {
  status: 'normalized';
  method: 'pdfjs-rasterized-v1';
  originalDocumentId: string;
  originalStoragePath: string;
  originalFileName: string;
  originalFileSize: number;
  originalSha256: string;
  normalizedSha256: string;
  normalizedAt: string;
  normalizedBy?: string | null;
  normalizedByName?: string;
  pageCount: number;
};

type DianProviderHistoryItem = {
  rowNumber: number;
  documentType: string;
  documentTypeKind: 'invoice' | 'credit_note' | 'debit_note' | 'other';
  invoiceNumber: string;
  taxId: string;
  businessName: string;
  amount: number;
  date: string;
};

type AdvanceReceipt = {
  id: string;
  documentType?: ReceiptDocumentType;
  categoryId: string;
  categoryName: string;
  costCenterId?: string;
  costCenterName?: string;
  costCenterSource?: 'manual' | 'ai' | 'advance_provisional' | 'administrative_edit';
  amount: number;
  date: string;
  businessName: string;
  taxId?: string;
  invoiceNumber?: string;
  cufe?: string;
  description?: string;
  fileName?: string;
  fileSize?: number;
  fileUrl?: string;
  storagePath?: string;
  documentId?: string;
  pdfNormalization?: PdfNormalizationTrace;
  status: ReceiptStatus;
  createdAt: string;
  createdBy?: string | null;
  createdByName?: string;
  reviewedAt?: string;
  reviewedBy?: string | null;
  reviewedByName?: string;
  reviewComment?: string;
  revisionCount?: number;
  revisions?: ReceiptRevision[];
  approvalChanges?: ReceiptFieldChange[];
  correctionNote?: string;
  resubmittedAt?: string;
  resubmittedBy?: string | null;
  resubmittedByName?: string;
  dianVerificationStatus?: 'pending' | 'confirmed' | 'failed' | 'not_applicable';
  dianLookupOpenedAt?: string;
  dianVerifiedAt?: string;
  dianVerifiedBy?: string | null;
  dianVerifiedByName?: string;
  dianDocumentUrl?: string;
  dianVerificationSource?: 'official_portal' | 'audit_base';
  accountingAuditStatus?: 'pending' | 'matched' | 'alert' | 'not_applicable';
  accountingAuditBatchId?: string;
  accountingAuditBatchName?: string;
  accountingAuditedAt?: string;
  accountingAuditedBy?: string | null;
  accountingAuditedByName?: string;
  accountingAuditMessage?: string;
  accountingAuditMatch?: {
    cufe?: string;
    invoiceNumber?: string;
    taxId?: string;
    businessName?: string;
    amount?: number;
    date?: string;
    documentType?: string;
    rowNumber?: number;
  };
  accountingAuditSeverity?: 'info' | 'warning' | 'critical';
  accountingAuditRecommendation?: string;
  accountingAuditProviderHistory?: DianProviderHistoryItem[];
  accountingAuditCreditNotes?: DianProviderHistoryItem[];
  accountingClosureId?: string;
  accountingClosureKind?: 'partial' | 'final';
  accountingClosureSequence?: number;
  accountingClosedAt?: string;
  billingPaymentId?: string;
  aiExtracted?: boolean;
  aiConfidence?: number;
  aiWarnings?: string[];
};

type AdvancePaymentSupport = {
  documentId: string;
  fileName: string;
  fileSize: number;
  fileUrl: string;
  storagePath: string;
  amount: number;
  date: string;
  reference?: string;
  note?: string;
  billingPaymentId?: string;
  paidAt: string;
  paidBy?: string | null;
  paidByName?: string;
  sequence?: number;
  kind?: 'partial' | 'final' | 'full';
};

type AdvanceReconciliationSupport = {
  documentId: string;
  fileName: string;
  fileSize: number;
  fileUrl: string;
  storagePath: string;
  amount: number;
  date: string;
  reference?: string;
  note?: string;
  billingPaymentId?: string;
  uploadedAt: string;
  uploadedBy?: string | null;
  uploadedByName?: string;
};

type AdvanceReconciliationStatus = 'pending_validation' | 'pending_return' | 'pending_compensation' | 'ready' | 'reconciled';

type AdvanceReportScope = 'advance' | 'payment' | 'justifications' | 'partialClose' | 'reconciliation' | 'full';
type DianAuditStatusFilter = 'all' | 'pending' | 'alerts' | 'passed';

type AdvanceAccountingClosure = {
  id: string;
  kind: 'partial' | 'final';
  sequence: number;
  title: string;
  createdAt: string;
  createdBy?: string | null;
  createdByName?: string;
  receiptIds: string[];
  receiptSnapshots: AdvanceReceipt[];
  amount: number;
  supportCount: number;
  previousClosedAmount: number;
  cumulativeClosedAmount: number;
  pendingAcceptedAmount: number;
  reportScope: 'partialClose';
  auditBatchIds?: string[];
  auditBatchNames?: string[];
  automaticallyAuditedReceiptIds?: string[];
  excludedReceiptSummary?: Array<{
    receiptId: string;
    invoiceNumber?: string;
    provider?: string;
    amount: number;
    reason: string;
  }>;
  note?: string;
  updatedAt?: string;
  updatedBy?: string | null;
  updatedByName?: string;
  revisionCount?: number;
  editNote?: string;
};

type AdvanceSignatureSnapshot = {
  signatureUrl: string;
  signatureStoragePath?: string;
  signerUserId: string;
  signerMemberId?: string;
  name: string;
  email: string;
  jobTitle: string;
  signedAt: string;
};

type AiReceiptDraft = {
  id: string;
  file: File;
  fileName: string;
  fileSize: number;
  fileType: string;
  documentType: ReceiptDocumentType;
  categoryId: string;
  categoryName?: string;
  costCenterId: string;
  costCenterName?: string;
  amount: string;
  date: string;
  businessName: string;
  taxId: string;
  invoiceNumber: string;
  cufe: string;
  description: string;
  confidence?: number;
  warnings?: string[];
  status: 'ready' | 'error';
  error?: string;
  preparedPdf?: PreparedPdfUpload;
};

type TravelAdvance = {
  id: string;
  customId?: string | null;
  customIdNormalized?: string | null;
  projectId: string;
  requesterId: string;
  requesterName: string;
  requesterEmail?: string;
  destination: string;
  department?: string;
  municipality?: string;
  purpose: string;
  travelStart: string;
  travelEnd: string;
  taskId?: string;
  taskTitle?: string;
  taskIds?: string[];
  taskTitles?: string[];
  status: 'submitted' | 'pending_payment' | 'partially_paid' | 'paid' | 'approved' | 'completed' | 'returned' | 'rejected' | 'closed';
  items: AdvanceItem[];
  receipts?: AdvanceReceipt[];
  accountingClosures?: AdvanceAccountingClosure[];
  lastAccountingClosureAt?: any;
  finalAccountingClosureId?: string | null;
  dianAuditBatches?: Array<{
    id: string;
    fileName: string;
    rowCount: number;
    matchedCount: number;
    alertCount: number;
    uploadedAt: string;
    uploadedBy?: string | null;
    uploadedByName?: string;
  }>;
  amountRequested: number;
  amountApproved: number;
  amountLegalized: number;
  balance: number;
  amountReturned?: number;
  returnComment?: string;
  returnedAt?: any;
  returnedBy?: string | null;
  returnedByName?: string;
  costCenters?: CostCenterAllocation[];
  costCenterId?: string | null;
  costCenterName?: string | null;
  adminComment?: string;
  requesterSignature?: AdvanceSignatureSnapshot;
  approvalSignature?: AdvanceSignatureSnapshot;
  paymentSupport?: AdvancePaymentSupport;
  paymentSupports?: AdvancePaymentSupport[];
  amountPaid?: number;
  paymentBalance?: number;
  paymentProgress?: number;
  returnSupport?: AdvanceReconciliationSupport;
  compensationSupport?: AdvanceReconciliationSupport;
  reconciliationStatus?: AdvanceReconciliationStatus;
  amountCompensated?: number;
  reconciledAt?: any;
  reconciledBy?: string | null;
  reconciledByName?: string;
  paymentApprovedAt?: any;
  paymentApprovedBy?: string | null;
  paymentApprovedByName?: string;
  paidAt?: any;
  createdAt?: any;
  updatedAt?: any;
  submittedAt?: any;
  approvedAt?: any;
  completedAt?: any;
  completedBy?: string | null;
  completedByName?: string;
  closedAt?: any;
  administrativeEditedAt?: any;
  administrativeEditedBy?: string | null;
  administrativeEditedByName?: string;
};

type AdvanceEditForm = {
  customId: string;
  department: string;
  municipality: string;
  purpose: string;
  travelStart: string;
  travelEnd: string;
  amountReturned: string;
  returnComment: string;
  costCenters: CostCenterAllocation[];
  items: AdvanceItem[];
};

type ContractorAccountStageFilter = 'all' | 'mine' | ContractorAccountStatus;
type ContractorAccountSort = 'recent' | 'oldest' | 'amount_desc';
type ContractorAccountView = 'all' | 'approvals' | 'humanTalent' | 'accounting' | 'administration' | 'paid' | 'returned' | 'rejected';

type ContractorAccountDocumentKind = 'chargeAccount' | 'activityReport' | 'parafiscals' | 'paymentSupport';

type ContractorAccountDocument = {
  kind: ContractorAccountDocumentKind;
  label: string;
  documentId: string;
  fileName: string;
  fileSize: number;
  fileUrl: string;
  storagePath: string;
  uploadedAt: string;
  uploadedBy?: string | null;
  uploadedByName?: string;
};

type ContractorAccountApproval = {
  stage: ContractorAccountStatus;
  actorId?: string | null;
  actorName?: string;
  actorEmail?: string | null;
  at: string;
  comment?: string;
  signature?: AdvanceSignatureSnapshot;
  performedByGlobalAdmin?: boolean;
  expectedApproverId?: string | null;
};

type ContractorAccountAdministrativeEdit = {
  actorId?: string | null;
  actorName?: string;
  actorEmail?: string | null;
  at: string;
  preservedStatus: ContractorAccountStatus;
  changedFields: string[];
};

type ContractorAccountActivityItem = {
  key: string;
  type: 'task' | 'subtask' | 'workflow_step';
  projectId?: string | null;
  projectName?: string;
  taskId: string;
  taskTitle: string;
  parentTaskId?: string | null;
  rootTaskId?: string | null;
  rootTaskTitle?: string;
  stepIndex?: number | null;
  stepLabel?: string | null;
  status?: string;
  date?: string;
  completedAt?: string;
  dueDate?: string;
  timing?: 'on_time' | 'late' | 'without_schedule';
  daysLate?: number;
  description?: string;
  executionDetail?: string;
  groupId?: string;
  groupName?: string;
};

type ContractorQualitySnapshot = {
  reviewed: number;
  accepted: number;
  rejected: number;
  acceptedWithObservations?: number;
  cleanAccepted?: number;
  approvalRate?: number | null;
  observationRate?: number | null;
  score: number | null;
  events: Array<{
    id: string;
    taskTitle: string;
    stepLabel?: string | null;
    result?: string;
    causeLabel?: string | null;
    causeLabels?: string[];
    qualityStatus?: string;
    approvedWithObservations?: boolean;
    comment?: string;
    date?: string;
  }>;
};

type ContractorRateSnapshot = {
  income: number;
  cost: number;
  margin: number;
  movements: number;
  rows: Array<{
    rateCardId: string;
    name: string;
    units: number;
    income: number;
    cost: number;
    margin: number;
    movements: number;
    unitLabel?: string;
  }>;
};

type ContractorPerformanceSnapshot = {
  selectedCompleted: number;
  completedOnTime: number;
  completedLate: number;
  completedWithoutSchedule: number;
  openOverdue: number;
  alerts: Array<{
    key: string;
    taskTitle: string;
    stepLabel?: string | null;
    kind: 'open_overdue' | 'completed_late';
    dueDate?: string;
    completedAt?: string;
    daysLate: number;
  }>;
};

type ContractorProductivityComparison = {
  roleLabel: string;
  peerCount: number;
  rows: Array<{
    rateCardId: string;
    name: string;
    unitLabel: string;
    contractorUnits: number;
    peerAverageUnits: number;
    peerTopUnits: number;
    contractorRank: number;
    professionalCount: number;
    deltaVsAveragePct: number | null;
    professionals: Array<{
      memberId: string;
      name: string;
      units: number;
      isContractor: boolean;
    }>;
  }>;
};

type ContractorPaymentRequest = {
  id: string;
  projectId: string;
  contractorId: string;
  contractorAuthUserId?: string;
  contractorName: string;
  contractorEmail?: string;
  contractorIdentificationType?: string;
  contractorIdentificationNumber?: string;
  contractorPhone?: string;
  contractorAddress?: string;
  contractorCity?: string;
  customId?: string;
  issueDate?: string;
  issueCity?: string;
  concept?: string;
  payer?: Omit<ContractorAccountPayerDomain, 'active'>;
  bankAccount?: ContractorBankAccount;
  periodStart: string;
  periodEnd: string;
  honorariumAmount: number;
  socialSecurityBase: number;
  estimatedMinimumWages: number;
  taskIds: string[];
  taskTitles: string[];
  activityKeys?: string[];
  activityItems?: ContractorAccountActivityItem[];
  activitySummary?: string;
  activitySnapshot?: {
    totalTasks: number;
    completedTasks: number;
    activeTasks: number;
    overdueTasks: number;
    onTimeTasks: number;
    qualitySummary: string;
    rateIncome: number;
    rateCost: number;
    rateMargin: number;
    rateMovements: number;
  };
  qualitySnapshot?: ContractorQualitySnapshot;
  rateSnapshot?: ContractorRateSnapshot;
  performanceSnapshot?: ContractorPerformanceSnapshot;
  productivityComparison?: ContractorProductivityComparison;
  projectName?: string;
  requesterSignature?: AdvanceSignatureSnapshot;
  reassignedAt?: any;
  reassignedBy?: string | null;
  reassignedByName?: string;
  reassignmentComment?: string;
  reassignmentHistory?: Array<{
    fromContractorId?: string;
    fromContractorName?: string;
    fromContractorEmail?: string;
    toContractorId: string;
    toContractorName: string;
    toContractorEmail?: string;
    actorId?: string | null;
    actorName?: string;
    at: string;
    comment?: string;
  }>;
  administrativeEditHistory?: ContractorAccountAdministrativeEdit[];
  approvalRouteReassignmentHistory?: Array<{
    stage: ContractorAccountStatus;
    configKey?: string;
    scope?: 'project' | 'organization' | 'user_reassignment';
    operationId?: string | null;
    reason?: string | null;
    fromApproverId?: string | null;
    fromApproverName?: string;
    fromApproverEmail?: string | null;
    toApproverId?: string | null;
    toApproverName?: string;
    toApproverEmail?: string | null;
    actorId?: string | null;
    actorName?: string;
    actorEmail?: string | null;
    at: string;
  }>;
  administrativelyEditedAt?: any;
  administrativelyEditedBy?: string | null;
  administrativelyEditedByName?: string;
  generatedDocuments?: Array<{
    kind: 'chargeAccount' | 'activityReport';
    label: string;
    generatedAt: string;
  }>;
  parafiscalsValidation?: {
    baseAmount: number;
    minimumWage: number;
    estimatedMinimumWages: number;
    status: 'pending_manual_review';
    note: string;
  };
  status: ContractorAccountStatus;
  currentApproverId?: string | null;
  currentApproverMemberId?: string | null;
  currentApproverAuthUserId?: string | null;
  currentApproverEmail?: string | null;
  currentApproverLabel?: string | null;
  currentApprovalStage?: ContractorAccountStatus | null;
  currentAssignmentEventId?: string | null;
  correctionAssigneeId?: string | null;
  correctionAssigneeMemberId?: string | null;
  correctionAssigneeAuthUserId?: string | null;
  correctionAssigneeEmail?: string | null;
  documents: ContractorAccountDocument[];
  approvals?: ContractorAccountApproval[];
  returnComment?: string;
  returnedAt?: any;
  returnedBy?: string | null;
  returnedByName?: string;
  returnedFromStage?: ContractorAccountStatus;
  returnHistory?: Array<{
    fromStage: ContractorAccountStatus;
    returnedToId?: string | null;
    returnedToEmail?: string | null;
    actorId?: string | null;
    actorName?: string;
    comment?: string;
    at: string;
  }>;
  resubmissionHistory?: Array<{
    actorId?: string | null;
    actorName?: string;
    targetStage: ContractorAccountStatus;
    targetApproverId?: string | null;
    kind?: 'contractor_resubmission' | 'global_reactivation';
    comment?: string;
    at: string;
  }>;
  rejectedAt?: any;
  rejectedBy?: string | null;
  rejectedByName?: string;
  accountingReference?: string;
  accountingNote?: string;
  accountedAt?: any;
  accountedBy?: string | null;
  accountedByName?: string;
  paymentSupport?: ContractorAccountDocument;
  paidAt?: any;
  paidBy?: string | null;
  paidByName?: string;
  createdAt?: any;
  createdBy?: string | null;
  createdByName?: string;
  submittedAt?: any;
  updatedAt?: any;
};

type BillingPayment = {
  id: string;
  amount?: number;
  status?: string;
  source?: string;
  advanceId?: string;
  date?: any;
  reference?: string | null;
  notes?: string | null;
  supportDocumentId?: string;
  supportStoragePath?: string;
};

type ReviewAction =
  | { type: 'approveAdvance'; advance: TravelAdvance }
  | { type: 'returnAdvance'; advance: TravelAdvance }
  | { type: 'rejectAdvance'; advance: TravelAdvance }
  | { type: 'deleteAdvance'; advance: TravelAdvance }
  | { type: 'returnReceipt'; advance: TravelAdvance; receipt: AdvanceReceipt }
  | { type: 'deleteReceipt'; advance: TravelAdvance; receipt: AdvanceReceipt }
  | null;

type ReceiptEditorMode = 'review' | 'correction' | 'audit' | 'administrative';

type ReceiptEditorState = {
  mode: ReceiptEditorMode;
  advance: TravelAdvance;
  receipt: AdvanceReceipt;
};

type ReceiptEditorForm = {
  documentType: ReceiptDocumentType;
  categoryId: string;
  costCenterId: string;
  amount: string;
  date: string;
  businessName: string;
  taxId: string;
  invoiceNumber: string;
  cufe: string;
  description: string;
  correctionNote: string;
  dianVerificationStatus: 'pending' | 'confirmed' | 'failed' | 'not_applicable';
  dianLookupOpenedAt: string;
  dianVerifiedAt: string;
  dianDocumentUrl: string;
  dianVerificationSource?: 'official_portal' | 'audit_base';
};

type ProjectAdministrationProps = {
  projectId: string;
  project?: any;
  presentation?: 'standalone' | 'embedded';
  tasks?: any[];
  contractorActivityTasks?: any[];
  teamMembers?: any[];
  approvalTeamMembers?: any[];
  currentUser: any;
  userRole?: string | null;
  canView: boolean;
  canManage: boolean;
  canValidate: boolean;
  canEditAccountingClosures: boolean;
  canEditAccountingClosureDate: boolean;
  canDeleteAccountingClosures: boolean;
  canDeleteAdministrativeReceipts: boolean;
  canConfigure: boolean;
};

type AdvanceTaskStatusFilter = 'active' | 'all' | 'pending' | 'in_progress' | 'blocked' | 'completed';

const UNGROUPED_TASK_GROUP_ID = '__ungrouped__';

const normalizeTaskSearchText = (value: unknown) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const getTaskStatusMeta = (task: any) => {
  const status = String(task?.status || '').toLowerCase();
  if (isCompletedTaskStatus(status)) {
    return { key: 'completed', label: 'Finalizada', className: 'bg-emerald-50 text-emerald-700 ring-emerald-100' };
  }
  if (['cancelled', 'canceled', 'deleted'].includes(status)) {
    return { key: 'cancelled', label: 'Cancelada', className: 'bg-slate-100 text-slate-500 ring-slate-200' };
  }
  if (status === 'stuck') {
    return { key: 'blocked', label: 'Bloqueada', className: 'bg-rose-50 text-rose-700 ring-rose-100' };
  }
  if (status === 'paused') {
    return { key: 'blocked', label: 'Pausada', className: 'bg-amber-50 text-amber-700 ring-amber-100' };
  }
  if (['in_progress', 'started'].includes(status)) {
    return { key: 'in_progress', label: 'En curso', className: 'bg-sky-50 text-sky-700 ring-sky-100' };
  }
  return { key: 'pending', label: 'Pendiente', className: 'bg-slate-50 text-slate-600 ring-slate-200' };
};

const DEFAULT_CATEGORIES: Array<Omit<ExpenseCategory, 'id'>> = [
  {
    name: 'Transporte',
    defaultDailyAmount: 70000,
    unitLabel: 'dia',
    active: true,
    color: '#2563eb',
    description: 'Movilidad urbana, intermunicipal o logística de desplazamiento.',
  },
  {
    name: 'Alimentación',
    defaultDailyAmount: 65000,
    unitLabel: 'dia',
    active: true,
    color: '#059669',
    description: 'Viáticos de comida durante actividades de campo.',
  },
  {
    name: 'Hospedaje',
    defaultDailyAmount: 180000,
    unitLabel: 'noche',
    active: true,
    color: '#7c3aed',
    description: 'Alojamiento aprobado para desplazamientos operativos.',
  },
  {
    name: 'Peajes y parqueaderos',
    defaultDailyAmount: 35000,
    unitLabel: 'dia',
    active: true,
    color: '#f97316',
    description: 'Peajes, parqueaderos y costos menores de transporte.',
  },
];

const DEFAULT_COST_CENTERS: Array<Omit<CostCenterDomain, 'id'>> = [
  {
    name: 'Centro de costos principal',
    code: 'PRINCIPAL',
    active: true,
    description: 'Centro de costos general del proyecto.',
  },
];

const DEFAULT_CONTRACTOR_ACCOUNT_PAYERS: Array<Omit<ContractorAccountPayerDomain, 'id'>> = [
  {
    name: 'REALTIX S.A.S',
    taxId: '900.317.973-8',
    city: 'Bogotá D.C.',
    active: true,
  },
];

const COLOMBIA_LEGAL_MINIMUM_WAGE = 1750000;

const CONTRACTOR_ACCOUNT_GENERATED_DOCUMENTS: Array<{ kind: 'chargeAccount' | 'activityReport'; label: string }> = [
  { kind: 'chargeAccount', label: 'Cuenta de cobro en PDF' },
  { kind: 'activityReport', label: 'Informe contractual detallado en PDF' },
];

const CONTRACTOR_ACCOUNT_UPLOAD_DOCUMENTS: Array<{ kind: ContractorAccountDocumentKind; label: string; required: boolean }> = [
  { kind: 'parafiscals', label: 'Soporte de parafiscales', required: true },
];

const CONTRACTOR_ACCOUNT_STEPS: Array<{ status: ContractorAccountStatus; label: string; shortLabel: string }> = [
  { status: 'submitted', label: 'Jefe inmediato', shortLabel: 'Jefe' },
  { status: 'boss_approved', label: 'Gerencia de operaciones', shortLabel: 'Operaciones' },
  { status: 'operations_approved', label: 'Calidad y cumplimiento', shortLabel: 'Calidad' },
  { status: 'quality_approved', label: 'Talento humano', shortLabel: 'TH' },
  { status: 'hr_approved', label: 'Contabilidad', shortLabel: 'Contabilidad' },
  { status: 'accounted', label: 'Administración y pago', shortLabel: 'Administración' },
];

const CONTRACTOR_ACCOUNT_STATUS_META: Record<ContractorAccountStatus, { label: string; className: string }> = {
  submitted: { label: 'Por aprobar jefe inmediato', className: 'bg-amber-50 text-amber-700 ring-amber-100' },
  boss_approved: { label: 'Por gerencia operaciones', className: 'bg-sky-50 text-sky-700 ring-sky-100' },
  operations_approved: { label: 'Por calidad y cumplimiento', className: 'bg-indigo-50 text-indigo-700 ring-indigo-100' },
  quality_approved: { label: 'Por talento humano', className: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-100' },
  hr_approved: { label: 'Pendiente de contabilidad', className: 'bg-violet-50 text-violet-700 ring-violet-100' },
  accounted: { label: 'Por administración y pago', className: 'bg-cyan-50 text-cyan-700 ring-cyan-100' },
  paid: { label: 'Pagada', className: 'bg-emerald-50 text-emerald-700 ring-emerald-100' },
  returned: { label: 'Devuelta para subsanar', className: 'bg-orange-50 text-orange-700 ring-orange-100' },
  rejected: { label: 'Cuenta de cobro rechazada', className: 'bg-rose-50 text-rose-700 ring-rose-100' },
};

const CONTRACTOR_ACCOUNT_APPROVAL_LABELS: Partial<Record<ContractorAccountStatus, string>> = {
  boss_approved: 'Aprobación del jefe inmediato',
  operations_approved: 'Aprobación de gerencia de operaciones',
  quality_approved: 'Aprobación de calidad y cumplimiento',
  hr_approved: 'Aprobación de talento humano',
  accounted: 'Contabilización',
  paid: 'Pago administrativo',
};

const getNextContractorAccountStatus = (status: ContractorAccountStatus): ContractorAccountStatus | null => {
  const transitions: Partial<Record<ContractorAccountStatus, ContractorAccountStatus>> = {
    submitted: 'boss_approved',
    returned: 'submitted',
    boss_approved: 'operations_approved',
    operations_approved: 'quality_approved',
    quality_approved: 'hr_approved',
    hr_approved: 'accounted',
    accounted: 'paid',
  };
  return transitions[status] || null;
};

const getContractorAccountApprovalTarget = (
  account: Pick<ContractorPaymentRequest, 'status' | 'returnedFromStage'>,
  allowReturnedGlobalOverride = false
): ContractorAccountStatus | null => {
  if (allowReturnedGlobalOverride && account.status === 'returned') {
    const returnedStage = account.returnedFromStage;
    return returnedStage && CONTRACTOR_ACCOUNT_STEPS.some((step) => step.status === returnedStage)
      ? returnedStage
      : 'submitted';
  }
  return getNextContractorAccountStatus(account.status);
};

const getContractorAccountAdministrativeChangedFields = (
  account: ContractorPaymentRequest,
  values: {
    customId: string;
    issueDate: string;
    issueCity: string;
    payer: Omit<ContractorAccountPayerDomain, 'active'>;
    contractorIdentificationType: string;
    contractorIdentificationNumber: string;
    contractorPhone: string;
    contractorAddress: string;
    contractorCity: string;
    concept: string;
    bankAccount: ContractorBankAccount;
    periodStart: string;
    periodEnd: string;
    honorariumAmount: number;
    activityKeys: string[];
    activitySummary: string;
    documents: ContractorAccountDocument[];
  }
) => {
  const changes: string[] = [];
  const changed = (label: string, previousValue: unknown, nextValue: unknown) => {
    const normalize = (value: unknown) => Array.isArray(value)
      ? [...value].map(String).sort().join('|')
      : String(value ?? '').trim();
    if (normalize(previousValue) !== normalize(nextValue)) changes.push(label);
  };

  changed('Consecutivo', account.customId, values.customId);
  changed('Fecha de emisión', account.issueDate, values.issueDate);
  changed('Ciudad de emisión', account.issueCity, values.issueCity);
  changed('Empresa pagadora', account.payer?.id || account.payer?.name, values.payer.id || values.payer.name);
  changed('Tipo de identificación', account.contractorIdentificationType, values.contractorIdentificationType);
  changed('Identificación', account.contractorIdentificationNumber, values.contractorIdentificationNumber);
  changed('Teléfono', account.contractorPhone, values.contractorPhone);
  changed('Dirección', account.contractorAddress, values.contractorAddress);
  changed('Ciudad del contratista', account.contractorCity, values.contractorCity);
  changed('Concepto', account.concept, values.concept);
  changed('Banco', account.bankAccount?.bankName, values.bankAccount.bankName);
  changed('Tipo de cuenta bancaria', account.bankAccount?.accountType, values.bankAccount.accountType);
  changed('Número de cuenta bancaria', account.bankAccount?.accountNumber, values.bankAccount.accountNumber);
  changed('Inicio del periodo', account.periodStart, values.periodStart);
  changed('Fin del periodo', account.periodEnd, values.periodEnd);
  changed('Honorarios', account.honorariumAmount, values.honorariumAmount);
  changed('Actividades relacionadas', account.activityKeys || [], values.activityKeys);
  changed('Resumen de actividades', account.activitySummary, values.activitySummary);
  changed(
    'Documentos soporte',
    (account.documents || []).map((document) => `${document.kind}:${document.documentId || document.fileName}`),
    values.documents.map((document) => `${document.kind}:${document.documentId || document.fileName}`)
  );

  return changes;
};

const buildEmptyContractorAccountForm = () => ({
  customId: '',
  issueDate: todayInputValue(),
  issueCity: '',
  payerDomainId: '',
  contractorIdentificationType: 'CC',
  contractorIdentificationNumber: '',
  contractorPhone: '',
  contractorAddress: '',
  contractorCity: '',
  concept: '',
  bankAccountId: '',
  bankName: '',
  bankAccountType: 'Ahorros',
  bankAccountNumber: '',
  saveBankAccountToProfile: true,
  periodStart: todayInputValue(),
  periodEnd: todayInputValue(),
  honorariumAmount: '',
  taskIds: [] as string[],
  activityKeys: [] as string[],
  activitySummary: '',
  accountingReference: '',
  accountingNote: '',
});

const inputClass =
  'h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15';
const textareaClass =
  'min-h-24 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15';

const money = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

const asNumber = (value: any) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const formatMoney = (value: any) => money.format(asNumber(value));

const formatSupportFileSize = (size?: number) => {
  const bytes = asNumber(size);
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const safeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const roundCurrency = (value: any) => Math.round(asNumber(value) * 100) / 100;

const buildDefaultCostCenter = (
  amount = 0,
  domain?: Pick<CostCenterDomain, 'id' | 'name'>
): CostCenterAllocation => ({
  id: safeId(),
  domainId: domain?.id,
  name: domain?.name || 'Centro de costos principal',
  percentage: 100,
  amount: roundCurrency(amount),
  note: '',
});

const normalizeCostCenters = (centers: CostCenterAllocation[] | undefined, totalAmount = 0) => {
  const base = centers && centers.length > 0 ? centers : [buildDefaultCostCenter(totalAmount)];
  const normalized = base.map((center, index) => {
    const percentage = Math.max(0, asNumber(center.percentage));
    return {
      id: center.id || safeId(),
      domainId: center.domainId,
      name: String(center.name || `Centro de costos ${index + 1}`).trim() || `Centro de costos ${index + 1}`,
      percentage,
      amount: roundCurrency(totalAmount > 0 ? (totalAmount * percentage) / 100 : center.amount),
      note: center.note || '',
    };
  });

  if (normalized.length === 1 && totalAmount > 0) {
    normalized[0].percentage = 100;
    normalized[0].amount = roundCurrency(totalAmount);
  }

  return normalized;
};

const getCostCenterPercentTotal = (centers?: CostCenterAllocation[]) =>
  roundCurrency((centers || []).reduce((sum, center) => sum + asNumber(center.percentage), 0));

const costCentersAreBalanced = (centers?: CostCenterAllocation[]) =>
  Math.abs(getCostCenterPercentTotal(centers) - 100) < 0.01;

const getAdvancePrimaryCostCenter = (advance: Partial<TravelAdvance>) => {
  const firstAllocation = (advance.costCenters || []).find(
    (center) => center?.domainId || String(center?.name || '').trim()
  );
  return {
    id: String(firstAllocation?.domainId || advance.costCenterId || '').trim(),
    name: String(firstAllocation?.name || advance.costCenterName || 'Centro de costos principal').trim(),
  };
};

const getReceiptCostCenter = (
  receipt: Partial<AdvanceReceipt>,
  advance: Partial<TravelAdvance>
) => {
  const directId = String(receipt.costCenterId || '').trim();
  const directName = String(receipt.costCenterName || '').trim();
  if (directId || directName) {
    return {
      id: directId,
      name: directName || 'Centro de costos sin nombre',
      provisional: receipt.costCenterSource === 'advance_provisional',
    };
  }

  const fallback = getAdvancePrimaryCostCenter(advance);
  return {
    ...fallback,
    provisional: true,
  };
};

const getAdvanceFinancialCoverage = (advance: Partial<TravelAdvance>) => {
  const approved = asNumber(advance.amountApproved || advance.amountRequested);
  const legalized = asNumber(advance.amountLegalized);
  const returnedCash = asNumber(advance.amountReturned);
  const covered = roundCurrency(legalized + returnedCash);
  const balance = roundCurrency(approved - covered);

  return {
    approved,
    legalized,
    returnedCash,
    covered,
    balance,
    overage: Math.max(0, roundCurrency(covered - approved)),
    progress: approved > 0 ? Math.min(100, Math.round((covered / approved) * 100)) : 0,
    isFullyCovered: approved > 0 && covered >= approved,
  };
};

const getAdvancePaymentSupports = (advance: Partial<TravelAdvance>) => {
  const supports = Array.isArray(advance.paymentSupports) ? advance.paymentSupports.filter(Boolean) : [];
  const legacySupport = advance.paymentSupport;
  const hasLegacyInList =
    legacySupport &&
    supports.some((support) =>
      Boolean(legacySupport.billingPaymentId && support.billingPaymentId === legacySupport.billingPaymentId) ||
      Boolean(legacySupport.documentId && support.documentId === legacySupport.documentId)
    );

  return (
    legacySupport && !hasLegacyInList
      ? [legacySupport, ...supports]
      : supports.length > 0
        ? supports
        : legacySupport
          ? [legacySupport]
          : []
  ).sort((left, right) => {
    const leftDate = getDateValue(left.date || left.paidAt)?.getTime() || 0;
    const rightDate = getDateValue(right.date || right.paidAt)?.getTime() || 0;
    if (leftDate !== rightDate) return leftDate - rightDate;
    return asNumber(left.sequence) - asNumber(right.sequence);
  });
};

const getAdvancePaymentSummary = (advance: Partial<TravelAdvance>) => {
  const approved = roundCurrency(advance.amountApproved || advance.amountRequested);
  const supports = getAdvancePaymentSupports(advance);
  const paid = roundCurrency(
    supports.reduce((sum, support) => sum + asNumber(support.amount), 0) || asNumber(advance.amountPaid)
  );
  const balance = Math.max(0, roundCurrency(approved - paid));
  const progress = approved > 0 ? Math.min(100, Math.round((paid / approved) * 100)) : 0;

  return {
    approved,
    supports,
    paid,
    balance,
    progress,
    hasPayment: paid > 0 || supports.length > 0 || Boolean(advance.paymentSupport),
    isFullyPaid: approved > 0 && paid + 0.01 >= approved,
    isPartiallyPaid: paid > 0 && approved > 0 && paid + 0.01 < approved,
  };
};

const canAdvanceReceivePayment = (advance: Partial<TravelAdvance>) => {
  const paymentSummary = getAdvancePaymentSummary(advance);
  if (!advance.approvalSignature) return false;
  if (paymentSummary.approved <= 0 || paymentSummary.balance <= 0.01) return false;
  if (['submitted', 'returned', 'rejected', 'closed'].includes(String(advance.status || ''))) return false;
  if (isAdvanceReconciled(advance)) return false;
  return true;
};

const isAdvanceFullyPaidForQueue = (advance: Partial<TravelAdvance>) => {
  const paymentSummary = getAdvancePaymentSummary(advance);
  return paymentSummary.isFullyPaid || (advance.status === 'paid' && paymentSummary.balance <= 0.01);
};

const getAdvanceJustifiedAmount = (advance: Partial<TravelAdvance>) =>
  roundCurrency(
    (advance.receipts || [])
      .filter((receipt) => receipt.status !== 'rejected')
      .reduce((sum, receipt) => sum + asNumber(receipt.amount), 0)
  );

const getAdvanceReconciliation = (advance: Partial<TravelAdvance>) => {
  const anticipated = asNumber(advance.amountApproved || advance.amountRequested);
  const justified = getAdvanceJustifiedAmount(advance);
  const legalized = asNumber(advance.amountLegalized);
  const difference = roundCurrency(legalized - anticipated);
  return {
    anticipated,
    justified,
    legalized,
    difference,
    returnRequired: Math.max(0, roundCurrency(-difference)),
    compensationRequired: Math.max(0, difference),
    isExact: Math.abs(difference) < 0.01,
  };
};

const isAdvanceReconciled = (advance: Partial<TravelAdvance>) =>
  advance.reconciliationStatus === 'reconciled' || advance.status === 'closed';

const getAdvanceAccountingClosures = (advance: Partial<TravelAdvance>) =>
  [...(advance.accountingClosures || [])].sort((left, right) => {
    const sequenceDiff = asNumber(left.sequence) - asNumber(right.sequence);
    if (sequenceDiff !== 0) return sequenceDiff;
    const leftDate = getDateValue(left.createdAt)?.getTime() || 0;
    const rightDate = getDateValue(right.createdAt)?.getTime() || 0;
    return leftDate - rightDate;
  });

const getClosedAccountingReceiptIds = (advance: Partial<TravelAdvance>) => {
  const ids = new Set<string>();
  getAdvanceAccountingClosures(advance).forEach((closure) => {
    (closure.receiptIds || []).forEach((receiptId) => ids.add(receiptId));
  });
  (advance.receipts || []).forEach((receipt) => {
    if (receipt.accountingClosureId) ids.add(receipt.id);
  });
  return ids;
};

const getUnclosedAccountingAcceptedReceipts = (advance: Partial<TravelAdvance>) => {
  const closedIds = getClosedAccountingReceiptIds(advance);
  return (advance.receipts || []).filter(
    (receipt) => isAccountingAcceptedReceipt(receipt) && !closedIds.has(receipt.id)
  );
};

const getAccountingClosureReceipts = (
  closure: AdvanceAccountingClosure,
  advance: Partial<TravelAdvance>
) =>
  Array.isArray(closure.receiptSnapshots)
    ? closure.receiptSnapshots
    : (advance.receipts || []).filter((receipt) => (closure.receiptIds || []).includes(receipt.id));

const hasFinalAccountingClosure = (advance: Partial<TravelAdvance>) =>
  getAdvanceAccountingClosures(advance).some((closure) => closure.kind === 'final') ||
  Boolean(advance.finalAccountingClosureId);

const isAdvanceReadyForTotalAccountingClosure = (advance: Partial<TravelAdvance>) =>
  advance.status === 'completed' || advance.status === 'closed' || Boolean(advance.completedAt);

const hasBlockingAccountingClosureReceipts = (advance: Partial<TravelAdvance>) =>
  (advance.receipts || []).some(
    (receipt) => receipt.status !== 'rejected' && !isAccountingAcceptedReceipt(receipt)
  );

const getAdvanceReportAvailability = (advance: Partial<TravelAdvance>) => {
  const paymentSummary = getAdvancePaymentSummary(advance);
  const hasPayment = paymentSummary.hasPayment;
  const hasLegalizations = (advance.receipts || []).some(
    (receipt) => isApprovedReceipt(receipt)
  );
  const hasPartialClose =
    getUnclosedAccountingAcceptedReceipts(advance).length > 0 ||
    getAdvanceAccountingClosures(advance).length > 0;
  const hasEnteredReconciliation =
    advance.status === 'completed' ||
    advance.status === 'closed' ||
    Boolean(advance.completedAt);
  const hasFinalReport =
    advance.status === 'closed' &&
    advance.reconciliationStatus === 'reconciled';

  return {
    advance: true,
    payment: hasPayment,
    justifications: hasLegalizations,
    partialClose: hasPartialClose,
    reconciliation: hasEnteredReconciliation,
    full: hasFinalReport,
  } satisfies Record<AdvanceReportScope, boolean>;
};

const getSafeFileToken = (value: any) =>
  String(value || 'anticipo')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'anticipo';

const downloadBlob = (fileName: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

type ContractorGeneratedDocumentKind = 'chargeAccount' | 'activityReport';
type ContractorDownloadKind = ContractorGeneratedDocumentKind | 'completeDossier';

const bytesToPdfBlob = (bytes: Uint8Array) => {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Blob([buffer], { type: 'application/pdf' });
};

const getContractorReportSignatureAsset = async (signature?: AdvanceSignatureSnapshot) => {
  let signatureAsset: { imageBlob?: Blob; imageUrl?: string; imageFileName?: string } = {};
  const signaturePath =
    signature?.signatureStoragePath ||
    getStoragePathFromDownloadUrl(signature?.signatureUrl);
  try {
    if (signaturePath) {
      signatureAsset = {
        imageBlob: await getAuthorizedDownloadBlob(ref(storage, signaturePath)),
        imageFileName: signaturePath.split('/').pop() || 'firma.png',
      };
    } else if (signature?.signatureUrl) {
      signatureAsset = { imageUrl: signature.signatureUrl };
    }
  } catch (error) {
    console.warn('La firma no pudo descargarse; el informe conservará los datos del firmante.', error);
  }
  return signatureAsset;
};

const buildContractorGeneratedDocumentBlob = async (
  account: ContractorPaymentRequest,
  kind: ContractorGeneratedDocumentKind,
  fallbackProjectName?: string
) => {
  const safeToken = getSafeFileToken(`${account.customId || account.id}-${account.contractorName}`);
  const isChargeAccount = kind === 'chargeAccount';
  const activityItems: ContractorAccountActivityItem[] = (account.activityItems || []).length > 0
    ? account.activityItems || []
    : (account.taskTitles || []).map((taskTitle, index) => ({
      key: `legacy-${index}`,
      type: 'task' as const,
      taskId: '',
      taskTitle,
      status: 'completed',
    }));
  const signatureAsset = await getContractorReportSignatureAsset(account.requesterSignature);
  const approvalReports = await Promise.all((account.approvals || []).map(async (approval) => ({
    stage: CONTRACTOR_ACCOUNT_APPROVAL_LABELS[approval.stage] || CONTRACTOR_ACCOUNT_STATUS_META[approval.stage]?.label || approval.stage,
    actorName: approval.actorName,
    actorEmail: approval.actorEmail || approval.signature?.email,
    at: approval.at,
    comment: approval.comment,
    signature: approval.signature ? {
      name: approval.signature.name || approval.actorName || 'Aprobador',
      email: approval.signature.email || approval.actorEmail || undefined,
      jobTitle: approval.signature.jobTitle || 'Aprobador',
      signedAt: approval.signature.signedAt || approval.at,
      ...(await getContractorReportSignatureAsset(approval.signature)),
    } : undefined,
  })));
  const report: ContractorAccountPdfReport = {
    documentKind: kind,
    title: isChargeAccount ? 'Cuenta de cobro' : 'Informe contractual de actividades',
    accountId: account.customId || account.id,
    projectName: account.projectName || fallbackProjectName || 'Proyecto Pixel',
    status: CONTRACTOR_ACCOUNT_STATUS_META[account.status]?.label || account.status,
    generatedAt: new Date().toISOString(),
    contractor: {
      name: account.contractorName,
      email: account.contractorEmail,
      jobTitle: account.requesterSignature?.jobTitle,
      identificationType: account.contractorIdentificationType,
      identificationNumber: account.contractorIdentificationNumber,
      phone: account.contractorPhone,
      address: account.contractorAddress,
      city: account.contractorCity,
    },
    issueDate: account.issueDate,
    issueCity: account.issueCity,
    concept: account.concept,
    payer: account.payer ? {
      name: account.payer.name,
      taxId: account.payer.taxId,
      address: account.payer.address,
      city: account.payer.city,
    } : undefined,
    bankAccount: account.bankAccount ? {
      bankName: account.bankAccount.bankName,
      accountType: account.bankAccount.accountType,
      accountNumber: account.bankAccount.accountNumber,
      holderName: account.bankAccount.holderName,
      holderDocument: account.bankAccount.holderDocument,
    } : undefined,
    periodStart: account.periodStart,
    periodEnd: account.periodEnd,
    honorariumAmount: account.honorariumAmount,
    socialSecurityBase: account.socialSecurityBase,
    minimumWage: account.parafiscalsValidation?.minimumWage || COLOMBIA_LEGAL_MINIMUM_WAGE,
    estimatedMinimumWages: account.estimatedMinimumWages || 1,
    activitySummary: account.activitySummary || account.activitySnapshot?.qualitySummary,
    activities: activityItems.map((activity) => ({
      title: activity.taskTitle,
      type: activity.type === 'workflow_step' ? 'Paso de workflow' : activity.type === 'subtask' ? 'Subtarea' : 'Tarea',
      stepLabel: activity.stepLabel,
      groupName: activity.groupName,
      status: getTaskStatusMeta({ status: activity.status }).label,
      completedAt: activity.completedAt || activity.date,
      dueDate: activity.dueDate,
      timing: activity.timing,
      daysLate: activity.daysLate,
      description: activity.description,
      executionDetail: activity.executionDetail,
    })),
    performance: account.performanceSnapshot,
    quality: normalizeContractorQualitySnapshot(account.qualitySnapshot),
    rates: account.rateSnapshot,
    productivity: account.productivityComparison,
    supportDocuments: [
      ...(account.documents || []).map((document) => ({
        label: document.label,
        fileName: document.fileName,
        uploadedAt: document.uploadedAt,
      })),
      ...(account.paymentSupport ? [{
        label: 'Soporte de pago',
        fileName: account.paymentSupport.fileName,
        uploadedAt: account.paymentSupport.uploadedAt,
      }] : []),
    ],
    approvals: approvalReports,
    signature: {
      name: account.requesterSignature?.name || account.contractorName,
      email: account.requesterSignature?.email || account.contractorEmail,
      jobTitle: account.requesterSignature?.jobTitle || 'Contratista',
      signedAt: account.requesterSignature?.signedAt,
      ...signatureAsset,
    },
  };
  const { bytes } = await generateContractorAccountPdf(report);
  return {
    blob: bytesToPdfBlob(bytes),
    fileName: `${isChargeAccount ? 'cuenta-de-cobro' : 'informe-contractual'}-${safeToken}.pdf`,
  };
};

const downloadContractorGeneratedDocument = async (
  account: ContractorPaymentRequest,
  kind: ContractorGeneratedDocumentKind,
  fallbackProjectName?: string
) => {
  const toastId = toast.loading(
    kind === 'chargeAccount'
      ? 'Generando la cuenta de cobro en PDF...'
      : 'Construyendo el informe contractual detallado...'
  );
  try {
    const result = await buildContractorGeneratedDocumentBlob(account, kind, fallbackProjectName);
    downloadBlob(result.fileName, result.blob);
    toast.success(
      kind === 'chargeAccount'
        ? 'Cuenta de cobro PDF generada.'
        : 'Informe contractual PDF generado con actividades, calidad, rates y comparativos.',
      { id: toastId }
    );
  } catch (error: any) {
    console.error('Error generating contractor account PDF:', error);
    toast.error(error?.message || 'No se pudo generar el informe PDF de la cuenta de cobro.', { id: toastId });
  }
};

const appendPdfBlobToDocument = async (targetPdf: PDFDocument, blob: Blob, label: string, fileName?: string) => {
  const bytes = await blob.arrayBuffer();
  const isPdf = blob.type.includes('pdf') || String(fileName || '').toLowerCase().endsWith('.pdf');
  if (isPdf) {
    const sourcePdf = await PDFDocument.load(bytes);
    const pages = await targetPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
    pages.forEach((page) => targetPdf.addPage(page));
    return;
  }

  const page = targetPdf.addPage([612, 792]);
  const font = await targetPdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText(label, { x: 38, y: 742, size: 15, font, color: rgb(0.04, 0.06, 0.15) });
  page.drawText(fileName || 'Documento soporte', { x: 38, y: 720, size: 9, font, color: rgb(0.25, 0.3, 0.4) });

  const lowerName = String(fileName || '').toLowerCase();
  const image = lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg') || blob.type.includes('jpeg')
    ? await targetPdf.embedJpg(bytes)
    : await targetPdf.embedPng(bytes);
  const maxWidth = 536;
  const maxHeight = 640;
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  const width = image.width * scale;
  const height = image.height * scale;
  page.drawImage(image, {
    x: 38 + (maxWidth - width) / 2,
    y: 60 + (maxHeight - height) / 2,
    width,
    height,
  });
};

const getContractorDocumentBlob = async (document: ContractorAccountDocument) => {
  if (document.storagePath) {
    return getAuthorizedDownloadBlob(ref(storage, document.storagePath));
  }
  const response = await fetch(document.fileUrl);
  if (!response.ok) throw new Error(`No se pudo descargar ${document.fileName}`);
  return response.blob();
};

const downloadContractorCompleteDossier = async (
  account: ContractorPaymentRequest,
  fallbackProjectName?: string
) => {
  const toastId = toast.loading('Construyendo expediente completo de cuenta de cobro...');
  try {
    const [chargeAccount, activityReport] = await Promise.all([
      buildContractorGeneratedDocumentBlob(account, 'chargeAccount', fallbackProjectName),
      buildContractorGeneratedDocumentBlob(account, 'activityReport', fallbackProjectName),
    ]);
    const mergedPdf = await PDFDocument.create();
    await appendPdfBlobToDocument(mergedPdf, chargeAccount.blob, 'Cuenta de cobro', chargeAccount.fileName);
    await appendPdfBlobToDocument(mergedPdf, activityReport.blob, 'Informe contractual detallado', activityReport.fileName);

    const parafiscalDocuments = (account.documents || []).filter((document) => document.kind === 'parafiscals');
    for (const document of parafiscalDocuments) {
      try {
        const supportBlob = await getContractorDocumentBlob(document);
        await appendPdfBlobToDocument(mergedPdf, supportBlob, document.label || 'Soporte de parafiscales', document.fileName);
      } catch (error) {
        console.warn('No se pudo anexar un soporte de parafiscales al expediente:', error);
      }
    }

    const bytes = await mergedPdf.save();
    const safeToken = getSafeFileToken(`${account.customId || account.id}-${account.contractorName}`);
    downloadBlob(`expediente-cuenta-cobro-${safeToken}.pdf`, bytesToPdfBlob(bytes));
    toast.success('Expediente completo generado con cuenta, informe y parafiscales.', { id: toastId });
  } catch (error: any) {
    console.error('Error generating contractor account dossier:', error);
    toast.error(error?.message || 'No se pudo generar el expediente completo.', { id: toastId });
  }
};

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

const sortAdvanceReceiptsByInvoiceDate = (receipts: AdvanceReceipt[]) =>
  [...receipts].sort((left, right) => {
    const leftDate = getDateValue(left.date)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const rightDate = getDateValue(right.date)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (leftDate !== rightDate) return leftDate - rightDate;

    const invoiceComparison = String(left.invoiceNumber || '').localeCompare(
      String(right.invoiceNumber || ''),
      'es',
      { numeric: true, sensitivity: 'base' }
    );
    if (invoiceComparison !== 0) return invoiceComparison;
    return left.id.localeCompare(right.id);
  });

const formatDate = (value: any) => {
  const date = getDateValue(value);
  if (!date) return 'Sin fecha';
  return date.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
};

const formatDateTime = (value: any) => {
  const date = getDateValue(value);
  if (!date) return 'Sin fecha';
  return date.toLocaleString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const todayInputValue = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const inclusiveDays = (start: string, end: string) => {
  if (!start || !end) return 1;
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return 1;
  return Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1);
};

const getMemberLabel = (member: any) =>
  member?.displayName || member?.name || member?.email || member?.id || 'Profesional';

const getMemberRoleLabel = (member: any) =>
  String(
    member?.roleName ||
    member?.position ||
    member?.jobTitle ||
    member?.profileRole ||
    member?.systemRole ||
    'Sin cargo configurado'
  ).trim();

const getCurrentUserName = (user: any) =>
  user?.displayName || user?.name || user?.email?.split('@')[0] || 'Usuario';

const getTaskTitle = (task: any) =>
  task?.title || task?.name || task?.displayName || task?.externalWorkflowId || task?.id || 'Tarea sin nombre';

const toDateInputValue = (value: any) => {
  const date = getDateValue(value);
  if (!date) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const isDateWithinRange = (value: any, start: string, end: string) => {
  const dateKey = toDateInputValue(value);
  if (!dateKey || !start || !end) return false;
  return dateKey >= start && dateKey <= end;
};

const collectTaskActorTokens = (task: any) => {
  const tokens = new Set<string>();
  const add = (value: any) => {
    if (value === undefined || value === null || value === '') return;
    if (typeof value === 'object') {
      ['id', 'uid', 'userId', 'memberId', 'authUserId', 'email'].forEach((key) => add(value[key]));
      return;
    }
    tokens.add(String(value).trim().toLowerCase());
  };

  [
    task?.assignedTo,
    task?.assigneeId,
    task?.assignee,
    task?.responsibleId,
    task?.responsible,
    task?.ownerId,
    task?.owner,
    task?.createdBy,
    task?.createdByEmail,
    task?.assignedToEmail,
    task?.assigneeEmail,
    task?.responsibleEmail,
    task?.assignedToName,
    task?.assigneeName,
    task?.responsibleName,
    task?.ownerName,
  ].forEach(add);

  ['assignees', 'assignedUsers', 'assignedMembers', 'responsibles', 'team', 'participants'].forEach((key) => {
    const value = task?.[key];
    if (Array.isArray(value)) value.forEach(add);
  });

  return tokens;
};

const collectStepActorTokens = (task: any, step: any) => {
  const tokens = new Set<string>();
  const add = (value: any) => {
    if (value === undefined || value === null || value === '') return;
    if (typeof value === 'object') {
      ['id', 'uid', 'userId', 'memberId', 'authUserId', 'email', 'name', 'displayName'].forEach((key) => add(value[key]));
      return;
    }
    tokens.add(String(value).trim().toLowerCase());
  };

  [
    step?.assignedTo,
    step?.assigneeId,
    step?.assignee,
    step?.responsibleId,
    step?.responsible,
    step?.completedBy,
    step?.completedByMemberId,
    step?.assignedToEmail,
    step?.assigneeEmail,
    step?.responsibleEmail,
    step?.assignedToName,
    step?.assigneeName,
    step?.responsibleName,
  ].forEach(add);

  ['assignees', 'assignedUsers', 'assignedMembers', 'responsibles', 'completedByIds', 'userIds'].forEach((key) => {
    const value = step?.[key];
    if (Array.isArray(value)) value.forEach(add);
  });

  return tokens.size > 0 ? tokens : collectTaskActorTokens(task);
};

const getTaskBillingDate = (task: any) =>
  task?.completedAt ||
  task?.closedAt ||
  task?.finishedAt ||
  task?.updatedAt ||
  task?.createdAt ||
  task?.startDate ||
  task?.dueDate ||
  task?.date;

const getStepBillingDate = (task: any, step: any) =>
  step?.completedAt ||
  step?.finishedAt ||
  step?.updatedAt ||
  step?.startedAt ||
  step?.plannedEndAt ||
  step?.plannedEndDate ||
  step?.endDate ||
  getTaskBillingDate(task);

const getTaskCompletedDate = (task: any) =>
  task?.completedAt ||
  task?.closedAt ||
  task?.finishedAt ||
  task?.completionDate ||
  null;

const getTaskDueDate = (task: any) =>
  task?.dueDate ||
  task?.endDate ||
  task?.plannedEndAt ||
  task?.plannedEndDate ||
  task?.expectedEndDate ||
  task?.deadline ||
  null;

const getStepCompletedDate = (task: any, step: any) =>
  step?.completedAt ||
  step?.finishedAt ||
  step?.completionDate ||
  getTaskCompletedDate(task);

const getStepDueDate = (task: any, step: any) =>
  step?.dueDate ||
  step?.plannedEndAt ||
  step?.plannedEndDate ||
  step?.endDate ||
  step?.expectedEndDate ||
  step?.deadline ||
  getTaskDueDate(task);

const getCalendarDaysLate = (completedValue: any, dueValue: any) => {
  const completed = getDateValue(completedValue);
  const due = getDateValue(dueValue);
  if (!completed || !due) return 0;
  const completedDay = new Date(completed.getFullYear(), completed.getMonth(), completed.getDate()).getTime();
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  return Math.max(0, Math.ceil((completedDay - dueDay) / 86400000));
};

const getReadableFormValue = (value: any): string => {
  if (value === undefined || value === null || value === '') return '';
  if (Array.isArray(value)) {
    return value.map(getReadableFormValue).filter(Boolean).join(', ');
  }
  if (typeof value === 'object') {
    const fileName = value.fileName || value.name || value.documentName;
    if (fileName) return `Documento: ${fileName}`;
    return Object.entries(value)
      .map(([key, nested]) => `${key}: ${getReadableFormValue(nested)}`)
      .filter((entry) => !entry.endsWith(': '))
      .join('; ');
  }
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  return String(value);
};

const buildActivityExecutionDetail = (task: any, step?: any) => {
  const source = step || task;
  const fields = Array.isArray(step?.form?.fields)
    ? step.form.fields
    : Array.isArray(task?.completionForm?.fields)
      ? task.completionForm.fields
      : [];
  const formData = step?.formData || task?.completionFormData || {};
  const fieldById = new Map(fields.map((field: any) => [String(field.id), field]));
  const formDetails = Object.entries(formData)
    .map(([fieldId, value]) => {
      const readable = getReadableFormValue(value);
      if (!readable) return '';
      const field = fieldById.get(String(fieldId)) as any;
      return `${field?.label || fieldId}: ${readable}`;
    })
    .filter(Boolean);
  const narrative = [
    source?.completionComment,
    source?.result,
    source?.outcome,
    source?.comment,
    source?.observations,
    source?.observation,
    source?.notes,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const details = Array.from(new Set([...narrative, ...formDetails]));
  return details.length > 0
    ? details.join(' | ').slice(0, 2400)
    : 'Actividad finalizada en Pixel sin detalle adicional diligenciado.';
};

const getWorkflowStepLabel = (step: any, index: number) =>
  step?.label || step?.title || step?.name || step?.description || `Paso ${index + 1}`;

const getActivityStatus = (activity: ContractorAccountActivityItem) =>
  String(activity.status || '').toLowerCase();

const contractorTokensMatch = (tokens: Set<string>, value: any): boolean => {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.some((item) => contractorTokensMatch(tokens, item));
  if (typeof value === 'object') {
    return ['id', 'uid', 'userId', 'memberId', 'authUserId', 'email', 'name', 'displayName'].some((key) => contractorTokensMatch(tokens, value[key]));
  }
  return tokens.has(String(value).trim().toLowerCase());
};

const buildMemberIdentityTokens = (member: any) => {
  const tokens = new Set<string>();
  [
    member?.id,
    member?.uid,
    member?.userId,
    member?.memberId,
    member?.authUserId,
    member?.email,
    member?.displayName,
    member?.name,
  ].forEach((value) => {
    if (value !== undefined && value !== null && value !== '') {
      tokens.add(String(value).trim().toLowerCase());
    }
  });
  return tokens;
};

const summarizeContractorActivities = (activities: ContractorAccountActivityItem[], rateSummary: { income: number; cost: number; movements: number }) => {
  const completedTasks = activities.filter((activity) => isCompletedTaskStatus(getActivityStatus(activity))).length;
  const overdueTasks = activities.filter((activity) => activity.timing === 'late').length;
  const activeTasks = Math.max(0, activities.length - completedTasks);
  const onTimeTasks = Math.max(0, activities.length - overdueTasks);
  const rateMargin = roundCurrency(rateSummary.income - rateSummary.cost);

  return {
    totalTasks: activities.length,
    completedTasks,
    activeTasks,
    overdueTasks,
    onTimeTasks,
    qualitySummary: `${completedTasks} finalizadas, ${activeTasks} abiertas, ${overdueTasks} con alerta de vencimiento en el periodo.`,
    rateIncome: roundCurrency(rateSummary.income),
    rateCost: roundCurrency(rateSummary.cost),
    rateMargin,
    rateMovements: rateSummary.movements,
  };
};

const isContractorQualityObservation = (event: any) =>
  Boolean(event?.approvedWithObservations || event?.qualityStatus === 'accepted_with_observations');

const getContractorQualityEventPriority = (event: any) => {
  if (event?.result === 'rejected') return 0;
  if (isContractorQualityObservation(event)) return 1;
  return 2;
};

const prioritizeContractorQualityEvents = (events: any[]) =>
  [...events].sort((left, right) => {
    const priorityDifference = getContractorQualityEventPriority(left) - getContractorQualityEventPriority(right);
    if (priorityDifference !== 0) return priorityDifference;
    return (getDateValue(right?.createdAt || right?.dateKey || right?.date)?.getTime() || 0)
      - (getDateValue(left?.createdAt || left?.dateKey || left?.date)?.getTime() || 0);
  });

const normalizeContractorQualitySnapshot = (
  snapshot?: ContractorQualitySnapshot | null
): ContractorQualitySnapshot | undefined => {
  if (!snapshot) return undefined;
  const accepted = Math.max(0, Number(snapshot.accepted) || 0);
  const rejected = Math.max(0, Number(snapshot.rejected) || 0);
  const reviewed = Math.max(0, Number(snapshot.reviewed) || accepted + rejected);
  const acceptedWithObservations = Math.min(
    accepted,
    Math.max(0, Number(snapshot.acceptedWithObservations) || 0)
  );
  const cleanAccepted = Math.max(0, accepted - acceptedWithObservations);
  return {
    ...snapshot,
    reviewed,
    accepted,
    rejected,
    acceptedWithObservations,
    cleanAccepted,
    approvalRate: reviewed > 0 ? Math.round((accepted / reviewed) * 100) : null,
    observationRate: reviewed > 0 ? Math.round((acceptedWithObservations / reviewed) * 100) : null,
    score: reviewed > 0 ? Math.round((cleanAccepted / reviewed) * 100) : null,
    events: prioritizeContractorQualityEvents(snapshot.events || []),
  };
};

const summarizeContractorQuality = (events: any[]): ContractorQualitySnapshot => {
  const accepted = events.filter((event) => event.result === 'accepted').length;
  const rejected = events.filter((event) => event.result === 'rejected').length;
  const acceptedWithObservations = Math.min(accepted, events.filter(isContractorQualityObservation).length);
  const cleanAccepted = Math.max(0, accepted - acceptedWithObservations);
  const reviewed = accepted + rejected;
  const prioritizedEvents = prioritizeContractorQualityEvents(events);
  return {
    reviewed,
    accepted,
    rejected,
    acceptedWithObservations,
    cleanAccepted,
    approvalRate: reviewed > 0 ? Math.round((accepted / reviewed) * 100) : null,
    observationRate: reviewed > 0 ? Math.round((acceptedWithObservations / reviewed) * 100) : null,
    score: reviewed > 0 ? Math.round((cleanAccepted / reviewed) * 100) : null,
    events: prioritizedEvents.slice(0, 50).map((event) => ({
      ...(() => {
        const causeLabels = Array.isArray(event.causeLabels) && event.causeLabels.length > 0
          ? event.causeLabels.filter(Boolean).map(String)
          : event.causeLabel
            ? [String(event.causeLabel)]
            : [];
        return {
          causeLabels,
          causeLabel: causeLabels.join(', ') || null,
        };
      })(),
      id: String(event.id || `${event.taskId || 'quality'}-${event.createdAt || ''}`),
      taskTitle: event.taskTitle || 'Tarea sin título',
      stepLabel: event.sourceStepLabel || event.stepLabel || null,
      result: event.result,
      qualityStatus: event.qualityStatus,
      approvedWithObservations: Boolean(event.approvedWithObservations || event.qualityStatus === 'accepted_with_observations'),
      comment: event.comment || '',
      date: toDateInputValue(event.createdAt || event.dateKey),
    })),
  };
};

const getRateCardName = (rateCard: any, rateCardId: string) =>
  rateCard?.name || rateCard?.title || rateCard?.indicator || rateCardId || 'Rate card';

const statusConfig: Record<TravelAdvance['status'], { label: string; className: string }> = {
  submitted: { label: 'Por validar', className: 'bg-amber-50 text-amber-700 ring-amber-100' },
  pending_payment: { label: 'Aprobado por pagar', className: 'bg-violet-50 text-violet-700 ring-violet-100' },
  partially_paid: { label: 'Abonado · saldo pendiente', className: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-100' },
  paid: { label: 'Pagado · por legalizar', className: 'bg-sky-50 text-sky-700 ring-sky-100' },
  approved: { label: 'En legalización (legado)', className: 'bg-sky-50 text-sky-700 ring-sky-100' },
  completed: { label: 'En conciliación', className: 'bg-cyan-50 text-cyan-700 ring-cyan-100' },
  returned: { label: 'Devuelto', className: 'bg-orange-50 text-orange-700 ring-orange-100' },
  rejected: { label: 'Rechazado', className: 'bg-rose-50 text-rose-700 ring-rose-100' },
  closed: { label: 'Conciliado', className: 'bg-teal-50 text-teal-700 ring-teal-100' },
};

const receiptStatusConfig: Record<AdvanceReceipt['status'], { label: string; className: string }> = {
  submitted: { label: 'Por revisar', className: 'bg-amber-50 text-amber-700 ring-amber-100' },
  approved: { label: 'Aceptado', className: 'bg-emerald-50 text-emerald-700 ring-emerald-100' },
  approved_modified: { label: 'Aprobado con modificación', className: 'bg-indigo-50 text-indigo-700 ring-indigo-100' },
  audit_pending: { label: 'Por auditoría DIAN', className: 'bg-cyan-50 text-cyan-700 ring-cyan-100' },
  audit_passed: { label: 'Auditada DIAN', className: 'bg-emerald-50 text-emerald-700 ring-emerald-100' },
  audit_alert: { label: 'Alerta auditoría', className: 'bg-red-50 text-red-700 ring-red-100' },
  returned: { label: 'Devuelto', className: 'bg-rose-50 text-rose-700 ring-rose-100' },
  rejected: { label: 'Rechazado', className: 'bg-rose-50 text-rose-700 ring-rose-100' },
};

const receiptDocumentTypeConfig: Record<
  ReceiptDocumentType,
  { label: string; shortLabel: string; numberLabel: string; className: string; hint: string }
> = {
  invoice: {
    label: 'Factura',
    shortLabel: 'Factura',
    numberLabel: 'No. factura',
    className: 'bg-blue-50 text-blue-700 ring-blue-100',
    hint: 'Usa esta opción para cualquier factura, sea electrónica o no electrónica.',
  },
  cash_receipt: {
    label: 'Recibo de caja',
    shortLabel: 'Recibo de caja',
    numberLabel: 'No. recibo de caja',
    className: 'bg-amber-50 text-amber-700 ring-amber-100',
    hint: 'Usa esta opción para recibos de caja o comprobantes que no sean factura.',
  },
};

const getReceiptStatusMeta = (status: any) =>
  receiptStatusConfig[status as AdvanceReceipt['status']] || receiptStatusConfig.submitted;

const getReceiptDocumentType = (value: any): ReceiptDocumentType =>
  value === 'cash_receipt' ? 'cash_receipt' : 'invoice';

const getReceiptDocumentTypeMeta = (value: any) =>
  receiptDocumentTypeConfig[getReceiptDocumentType(value)];

const APPROVED_RECEIPT_STATUSES: ReceiptStatus[] = ['approved', 'approved_modified', 'audit_passed'];
const RECEIPT_STATUSES_READY_FOR_DIAN_AUDIT: ReceiptStatus[] = ['approved', 'approved_modified', 'audit_pending', 'audit_alert'];

const isApprovedReceipt = (receipt: Pick<AdvanceReceipt, 'status'>) =>
  APPROVED_RECEIPT_STATUSES.includes(receipt.status);

const isInvoiceReceipt = (receipt: Pick<AdvanceReceipt, 'documentType'>) =>
  getReceiptDocumentType(receipt.documentType) === 'invoice';

const isAccountingAcceptedReceipt = (
  receipt: Pick<AdvanceReceipt, 'documentType' | 'status' | 'accountingAuditStatus'>
) => {
  if (!isApprovedReceipt(receipt)) return false;
  if (receipt.status === 'audit_passed' || receipt.accountingAuditStatus === 'matched') return true;
  return !isInvoiceReceipt(receipt);
};

const getAccountingClosureOriginalReceiptIds = (closure: AdvanceAccountingClosure) =>
  Array.from(
    new Set([
      ...(closure.receiptIds || []),
      ...(closure.receiptSnapshots || []).map((receipt) => receipt.id),
    ])
  );

const getEditableAccountingClosureReceipts = (
  closure: AdvanceAccountingClosure,
  liveReceipts: AdvanceReceipt[],
  otherClosedIds: Set<string>
) => {
  const liveById = new Map(liveReceipts.map((receipt) => [receipt.id, receipt]));
  const snapshotsById = new Map(
    (closure.receiptSnapshots || []).map((receipt) => [receipt.id, receipt])
  );
  const originalReceiptIds = getAccountingClosureOriginalReceiptIds(closure);
  const originalIds = new Set(originalReceiptIds);

  // El cierre es un histórico congelado: su copia prevalece incluso si la
  // legalización viva cambió de estado o fue eliminada posteriormente.
  const originalReceipts = originalReceiptIds
    .map((receiptId) => snapshotsById.get(receiptId) || liveById.get(receiptId))
    .filter((receipt): receipt is AdvanceReceipt => Boolean(receipt));
  const availableLiveReceipts = liveReceipts.filter(
    (receipt) =>
      !originalIds.has(receipt.id) &&
      !otherClosedIds.has(receipt.id) &&
      isAccountingAcceptedReceipt(receipt)
  );

  return sortAdvanceReceiptsByInvoiceDate([...originalReceipts, ...availableLiveReceipts]);
};

const canEditReceiptInPartialAccountingClosure = (
  advance: Partial<TravelAdvance>,
  receipt: Pick<AdvanceReceipt, 'accountingClosureId' | 'accountingClosureKind'>
) => {
  if (!receipt.accountingClosureId) return true;
  if (hasFinalAccountingClosure(advance)) return false;
  const closure = getAdvanceAccountingClosures(advance).find(
    (item) => item.id === receipt.accountingClosureId
  );
  return closure?.kind === 'partial' || (!closure && receipt.accountingClosureKind === 'partial');
};

type PartialAccountingClosureSyncResult = {
  accountingClosures: AdvanceAccountingClosure[];
  changed: boolean;
  closureId?: string;
  includedInClosure: boolean;
};

const syncReceiptWithPartialAccountingClosure = (
  advance: Partial<TravelAdvance>,
  receipt: AdvanceReceipt,
  options: {
    now: string;
    actorId?: string | null;
    actorName?: string;
    note: string;
  }
): PartialAccountingClosureSyncResult => {
  const closures = getAdvanceAccountingClosures(advance);
  if (!receipt.accountingClosureId || hasFinalAccountingClosure(advance)) {
    return { accountingClosures: closures, changed: false, includedInClosure: false };
  }

  const targetClosure = closures.find((closure) => closure.id === receipt.accountingClosureId);
  if (!targetClosure || targetClosure.kind !== 'partial') {
    return { accountingClosures: closures, changed: false, includedInClosure: false };
  }

  const shouldIncludeReceipt = isAccountingAcceptedReceipt(receipt);
  const currentSnapshots = Array.isArray(targetClosure.receiptSnapshots)
    ? targetClosure.receiptSnapshots
    : getAccountingClosureReceipts(targetClosure, advance);
  const receiptSnapshot: AdvanceReceipt = {
    ...receipt,
    accountingClosureId: targetClosure.id,
    accountingClosureKind: 'partial',
    accountingClosureSequence: targetClosure.sequence,
    accountingClosedAt: targetClosure.createdAt,
  };
  const nextSnapshots = sortAdvanceReceiptsByInvoiceDate([
    ...currentSnapshots.filter((item) => item.id !== receipt.id),
    ...(shouldIncludeReceipt ? [receiptSnapshot] : []),
  ]);
  const nextReceiptIds = nextSnapshots.map((item) => item.id);
  const nextAmount = roundCurrency(
    nextSnapshots.reduce((sum, item) => sum + asNumber(item.amount), 0)
  );
  const nextLiveReceipts = (advance.receipts || []).map((item) =>
    item.id === receipt.id ? receipt : item
  );

  let nextClosures = closures.map((closure) =>
    closure.id === targetClosure.id
      ? {
          ...closure,
          receiptIds: nextReceiptIds,
          receiptSnapshots: nextSnapshots,
          amount: nextAmount,
          supportCount: nextSnapshots.length,
          auditBatchIds: Array.from(
            new Set(nextSnapshots.map((item) => item.accountingAuditBatchId).filter(Boolean) as string[])
          ),
          auditBatchNames: Array.from(
            new Set(nextSnapshots.map((item) => item.accountingAuditBatchName).filter(Boolean) as string[])
          ),
          updatedAt: options.now,
          updatedBy: options.actorId || null,
          updatedByName: options.actorName || '',
          revisionCount: asNumber(closure.revisionCount) + 1,
          editNote: options.note,
        }
      : closure
  );

  const closedReceiptIds = new Set<string>();
  nextClosures.forEach((closure) => {
    (closure.receiptIds || []).forEach((receiptId) => closedReceiptIds.add(receiptId));
  });
  const pendingAcceptedAmount = roundCurrency(
    nextLiveReceipts
      .filter((item) => isAccountingAcceptedReceipt(item) && !closedReceiptIds.has(item.id))
      .reduce((sum, item) => sum + asNumber(item.amount), 0)
  );

  let cumulativeClosedAmount = 0;
  nextClosures = nextClosures.map((closure) => {
    const previousClosedAmount = cumulativeClosedAmount;
    cumulativeClosedAmount = roundCurrency(cumulativeClosedAmount + asNumber(closure.amount));
    return {
      ...closure,
      previousClosedAmount,
      cumulativeClosedAmount,
      ...(closure.id === targetClosure.id ? { pendingAcceptedAmount } : {}),
    };
  });

  return {
    accountingClosures: nextClosures,
    changed: true,
    closureId: targetClosure.id,
    includedInClosure: shouldIncludeReceipt,
  };
};

const canReceiptBePromotedForPartialCloseAudit = (
  receipt: Pick<AdvanceReceipt, 'documentType' | 'status'>
) =>
  isInvoiceReceipt(receipt) &&
  RECEIPT_STATUSES_READY_FOR_DIAN_AUDIT.includes(receipt.status);

const needsDianAccountingAudit = (receipt: Pick<AdvanceReceipt, 'documentType' | 'status'>) =>
  isInvoiceReceipt(receipt) && RECEIPT_STATUSES_READY_FOR_DIAN_AUDIT.includes(receipt.status);

const hasDianAccountingAuditAlert = (receipt: Pick<AdvanceReceipt, 'documentType' | 'status'>) =>
  isInvoiceReceipt(receipt) && receipt.status === 'audit_alert';

const hasPendingDianAccountingAudit = (receipt: Pick<AdvanceReceipt, 'documentType' | 'status'>) =>
  isInvoiceReceipt(receipt) && (receipt.status === 'audit_pending' || receipt.status === 'audit_alert');

const isReceiptAdministrativelyReviewed = (receipt: Pick<AdvanceReceipt, 'status'>) =>
  ['approved', 'approved_modified', 'audit_pending', 'audit_passed', 'audit_alert'].includes(receipt.status);

const canDeleteUnlegalizedReceipt = (receipt: Pick<AdvanceReceipt, 'status'>) => !isApprovedReceipt(receipt);

const isAdvanceReadyForLegalization = (advance: Pick<TravelAdvance, 'status'>) =>
  advance.status === 'partially_paid' || advance.status === 'paid' || advance.status === 'approved';

const normalizeCufe = (value: string) => value.replace(/\s+/g, '').trim();

type ReceiptIdentityInput = Pick<
  AdvanceReceipt,
  'documentType' | 'cufe' | 'invoiceNumber' | 'taxId' | 'businessName' | 'amount' | 'date'
>;

type ReceiptDuplicateUsage = {
  advanceId: string;
  advanceCustomId?: string | null;
  advanceTitle: string;
  requesterName: string;
  receiptId: string;
  documentType: ReceiptDocumentType;
  invoiceNumber?: string;
  cufe?: string;
  taxId?: string;
  businessName: string;
  amount: number;
  date: string;
};

const normalizeReceiptToken = (value?: string | number | null) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const getReceiptIdentity = (receipt: Partial<ReceiptIdentityInput>) => {
  const documentType = getReceiptDocumentType(receipt.documentType);
  const cufe = normalizeCufe(String(receipt.cufe || '')).toLowerCase();
  if (documentType === 'invoice' && cufe) return `invoice:cufe:${cufe}`;

  const invoiceNumber = normalizeReceiptToken(receipt.invoiceNumber);
  const taxId = normalizeReceiptToken(receipt.taxId);
  if (invoiceNumber && taxId) return `${documentType}:number-tax:${invoiceNumber}:${taxId}`;

  const businessName = normalizeReceiptToken(receipt.businessName);
  const date = normalizeReceiptToken(receipt.date);
  const amount = asNumber(receipt.amount).toFixed(2);
  if (invoiceNumber && businessName && amount !== '0.00') {
    return `${documentType}:number-business:${invoiceNumber}:${businessName}:${amount}`;
  }
  if (businessName && date && amount !== '0.00') {
    return `${documentType}:fallback:${businessName}:${date}:${amount}`;
  }

  return null;
};

const getReceiptCufeIdentity = (receipt: Partial<ReceiptIdentityInput>) => {
  const documentType = getReceiptDocumentType(receipt.documentType);
  const cufe = normalizeCufe(String(receipt.cufe || '')).toLowerCase();
  return documentType === 'invoice' && cufe ? `invoice:cufe:${cufe}` : null;
};

const formatDuplicateReceiptUsageMessage = (usage: ReceiptDuplicateUsage, currentAdvanceId: string) => {
  const advanceReference = usage.advanceCustomId || usage.advanceTitle || usage.advanceId;
  const receiptReference = usage.invoiceNumber || usage.businessName || usage.receiptId;
  const location =
    usage.advanceId === currentAdvanceId
      ? `en este mismo anticipo (${advanceReference})`
      : `en el anticipo ${advanceReference}`;

  return `Ya existe una factura con este CUFE ${location}, soporte ${receiptReference}.`;
};

type DianAuditRow = {
  rowNumber: number;
  documentType: string;
  documentTypeKind: DianProviderHistoryItem['documentTypeKind'];
  cufe: string;
  invoiceNumber: string;
  taxId: string;
  businessName: string;
  amount: number;
  date: string;
  raw: Record<string, string>;
};

type DianAuditBatch = {
  id: string;
  fileName: string;
  fileSize?: number;
  rowCount: number;
  matchedCount?: number;
  alertCount?: number;
  creditNoteCount?: number;
  uploadedAt?: any;
  uploadedBy?: string | null;
  uploadedByName?: string;
  completedAt?: any;
  status?: 'ready' | 'processing' | 'completed' | 'failed';
  rows?: DianAuditRow[];
};

const normalizeDianAuditHeader = (value: any) =>
  normalizeReceiptToken(value).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const normalizeDianAuditComparable = (value: any) =>
  normalizeReceiptToken(value).replace(/[^a-z0-9]/g, '');

const getDianDocumentTypeKind = (value: any): DianProviderHistoryItem['documentTypeKind'] => {
  const normalized = normalizeDianAuditHeader(value);
  if (!normalized) return 'other';
  if (
    normalized.includes('nota_credito') ||
    normalized.includes('credit_note') ||
    normalized === 'nc' ||
    normalized.includes('ncredito') ||
    normalized.includes('credito')
  ) {
    return 'credit_note';
  }
  if (
    normalized.includes('nota_debito') ||
    normalized.includes('debit_note') ||
    normalized === 'nd' ||
    normalized.includes('ndebito') ||
    normalized.includes('debito')
  ) {
    return 'debit_note';
  }
  if (normalized.includes('factura') || normalized.includes('invoice') || normalized.includes('venta')) return 'invoice';
  return 'other';
};

const parseDianAuditAmount = (value: any) => {
  const raw = String(value ?? '').replace(/\s+/g, '').replace(/COP|\$/gi, '');
  if (!raw) return 0;
  const normalized =
    raw.includes(',') && raw.includes('.')
      ? raw.lastIndexOf(',') > raw.lastIndexOf('.')
        ? raw.replace(/\./g, '').replace(',', '.')
        : raw.replace(/,/g, '')
      : raw.includes(',')
        ? raw.replace(',', '.')
        : raw;
  return asNumber(normalized);
};

const parseDianAuditDelimitedRows = (text: string) => {
  const cleanText = text.replace(/^\uFEFF/, '');
  const firstLine = cleanText.split(/\r?\n/, 1)[0] || '';
  const delimiter = firstLine.includes('\t') ? '\t' : firstLine.includes(';') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < cleanText.length; index += 1) {
    const character = cleanText[index];
    const nextCharacter = cleanText[index + 1];

    if (character === '"') {
      if (quoted && nextCharacter === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (!quoted && character === delimiter) {
      row.push(cell.trim());
      cell = '';
      continue;
    }

    if (!quoted && (character === '\n' || character === '\r')) {
      if (character === '\r' && nextCharacter === '\n') index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += character;
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
};

const pickDianAuditCell = (row: Record<string, string>, candidates: string[]) => {
  const keys = Object.keys(row);
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeDianAuditHeader(candidate);
    const exact = keys.find((key) => key === normalizedCandidate);
    if (exact && row[exact]) return row[exact];
    const partial = keys.find((key) => key.includes(normalizedCandidate) || normalizedCandidate.includes(key));
    if (partial && row[partial]) return row[partial];
  }
  return '';
};

const buildDianAuditRowsFromMatrix = (rows: any[][]): DianAuditRow[] => {
  const [headers = [], ...body] = rows;
  const normalizedHeaders = headers.map(normalizeDianAuditHeader);
  return body
    .map((cells, rowIndex) => {
      const raw = normalizedHeaders.reduce<Record<string, string>>((acc, header, index) => {
        if (header) acc[header] = String(cells[index] ?? '');
        return acc;
      }, {});
      const documentType = pickDianAuditCell(raw, ['tipo documento', 'tipo de documento', 'tipo', 'documento tipo', 'clase documento', 'document type']);
      const cufe = normalizeCufe(pickDianAuditCell(raw, ['cufe', 'cude', 'codigo unico', 'codigo unico de factura', 'documentkey', 'documento electronico']));
      const invoiceNumber = pickDianAuditCell(raw, ['numero factura', 'no factura', 'factura', 'numero', 'prefijo numero', 'folio']);
      const invoicePrefix = pickDianAuditCell(raw, ['prefijo', 'prefix']);
      const invoiceFolio = pickDianAuditCell(raw, ['folio']);
      const taxId = pickDianAuditCell(raw, ['nit emisor', 'nit proveedor', 'nit', 'documento proveedor', 'identificacion proveedor']);
      const businessName = pickDianAuditCell(raw, ['razon social', 'nombre emisor', 'nombre proveedor', 'proveedor', 'emisor']);
      const amount = parseDianAuditAmount(pickDianAuditCell(raw, ['valor total', 'total', 'valor factura', 'monto', 'importe']));
      const date = pickDianAuditCell(raw, ['fecha emision', 'fecha', 'fecha factura']);
      const resolvedInvoiceNumber = invoiceNumber.trim() || (invoicePrefix && invoiceFolio ? `${invoicePrefix}${invoiceFolio}` : invoiceFolio);

      return {
        rowNumber: rowIndex + 2,
        documentType: documentType.trim(),
        documentTypeKind: getDianDocumentTypeKind(documentType),
        cufe,
        invoiceNumber: resolvedInvoiceNumber.trim(),
        taxId: taxId.trim(),
        businessName: businessName.trim(),
        amount,
        date: date.trim(),
        raw,
      };
    })
    .filter((row) => row.cufe || row.invoiceNumber || row.taxId || row.businessName || row.amount > 0);
};

const buildDianAuditRowsFromText = (text: string): DianAuditRow[] =>
  buildDianAuditRowsFromMatrix(parseDianAuditDelimitedRows(text));

const buildDianAuditRowsFromExcelFile = async (file: File): Promise<DianAuditRow[]> => {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }) as any[][];
  return buildDianAuditRowsFromMatrix(rows);
};

const getDianAuditReceiptKeyCandidates = (receipt: AdvanceReceipt) => {
  const cufe = normalizeCufe(receipt.cufe || '').toLowerCase();
  const invoiceNumber = normalizeDianAuditComparable(receipt.invoiceNumber);
  const taxId = normalizeDianAuditComparable(receipt.taxId);
  const businessName = normalizeDianAuditComparable(receipt.businessName);
  const amount = asNumber(receipt.amount).toFixed(2);
  return [
    cufe ? `cufe:${cufe}` : '',
    invoiceNumber && taxId ? `invoice-tax:${invoiceNumber}:${taxId}` : '',
    invoiceNumber && businessName ? `invoice-business:${invoiceNumber}:${businessName}` : '',
    businessName && amount !== '0.00' ? `business-amount:${businessName}:${amount}` : '',
  ].filter(Boolean);
};

const getDianAuditRowInvoiceCandidates = (row: DianAuditRow) => {
  const invoiceNumber = normalizeDianAuditComparable(row.invoiceNumber);
  const prefix = normalizeDianAuditComparable(row.raw.prefijo || row.raw.prefix);
  const folio = normalizeDianAuditComparable(row.raw.folio);
  return Array.from(new Set([
    invoiceNumber,
    prefix && folio ? `${prefix}${folio}` : '',
    folio,
  ].filter(Boolean)));
};

const buildDianAuditIndex = (rows: DianAuditRow[]) => {
  const index = new Map<string, DianAuditRow>();
  rows.forEach((row) => {
    const cufe = normalizeCufe(row.cufe || '').toLowerCase();
    const invoiceNumbers = getDianAuditRowInvoiceCandidates(row);
    const taxId = normalizeDianAuditComparable(row.taxId);
    const businessName = normalizeDianAuditComparable(row.businessName);
    const amount = asNumber(row.amount).toFixed(2);
    [
      cufe ? `cufe:${cufe}` : '',
      ...invoiceNumbers.flatMap((invoiceNumber) => [
        taxId ? `invoice-tax:${invoiceNumber}:${taxId}` : '',
        businessName ? `invoice-business:${invoiceNumber}:${businessName}` : '',
      ]),
      businessName && amount !== '0.00' ? `business-amount:${businessName}:${amount}` : '',
    ].filter(Boolean).forEach((key) => {
      if (!index.has(key)) index.set(key, row);
    });
  });
  return index;
};

const findDianAuditMatch = (receipt: AdvanceReceipt, rows: DianAuditRow[]) => {
  const index = buildDianAuditIndex(rows);
  return getDianAuditReceiptKeyCandidates(receipt).map((key) => index.get(key)).find(Boolean) || null;
};

const toDianProviderHistoryItem = (row: DianAuditRow): DianProviderHistoryItem => ({
  rowNumber: row.rowNumber,
  documentType: row.documentType || 'Sin tipo',
  documentTypeKind: row.documentTypeKind,
  invoiceNumber: row.invoiceNumber,
  taxId: row.taxId,
  businessName: row.businessName,
  amount: row.amount,
  date: row.date,
});

const getDianProviderHistory = (receipt: AdvanceReceipt, rows: DianAuditRow[]) => {
  const receiptTaxId = normalizeDianAuditComparable(receipt.taxId);
  const receiptBusiness = normalizeDianAuditComparable(receipt.businessName);
  if (!receiptTaxId && !receiptBusiness) return [];

  return rows
    .filter((row) => {
      const rowTaxId = normalizeDianAuditComparable(row.taxId);
      const rowBusiness = normalizeDianAuditComparable(row.businessName);
      if (receiptTaxId && rowTaxId && receiptTaxId === rowTaxId) return true;
      return Boolean(receiptBusiness && rowBusiness && receiptBusiness === rowBusiness);
    })
    .map(toDianProviderHistoryItem)
    .sort((left, right) => {
      const leftTime = getDateValue(left.date)?.getTime() || 0;
      const rightTime = getDateValue(right.date)?.getTime() || 0;
      return rightTime - leftTime;
    })
    .slice(0, 12);
};

const findDianAuditInsight = (receipt: AdvanceReceipt, rows: DianAuditRow[]) => {
  const match = findDianAuditMatch(receipt, rows);
  const providerHistory = getDianProviderHistory(receipt, rows);
  const creditNotes = providerHistory.filter((item) => item.documentTypeKind === 'credit_note');
  const hasCreditNoteRisk = creditNotes.length > 0;

  if (match && hasCreditNoteRisk) {
    return {
      match,
      providerHistory,
      creditNotes,
      status: 'alert' as const,
      severity: 'warning' as const,
      message: `La factura cruza en fila ${match.rowNumber}, pero el proveedor registra ${creditNotes.length} nota${creditNotes.length === 1 ? '' : 's'} crédito en la base DIAN.`,
      recommendation: 'Revisar el historial del proveedor antes de cerrar la auditoría. Si la nota crédito afecta este soporte, devuélvelo o edita la legalización; si no aplica, acepta la auditoría.',
    };
  }

  if (match) {
    return {
      match,
      providerHistory,
      creditNotes,
      status: 'matched' as const,
      severity: 'info' as const,
      message: `Cruce encontrado en fila ${match.rowNumber} de la base DIAN.`,
      recommendation: 'Factura cruzada sin alertas relevantes del proveedor.',
    };
  }

  return {
    match: null,
    providerHistory,
    creditNotes,
    status: 'alert' as const,
    severity: 'critical' as const,
    message: hasCreditNoteRisk
      ? `No se encontró coincidencia exacta y el proveedor registra ${creditNotes.length} nota${creditNotes.length === 1 ? '' : 's'} crédito en la base DIAN.`
      : 'No se encontró coincidencia contable en la base DIAN cargada.',
    recommendation: hasCreditNoteRisk
      ? 'Validar si la nota crédito corrige o anula el soporte. Puedes devolverlo a legalización o editar la legalización antes de volver a auditar.'
      : 'Revisar número, NIT, valor, fecha y CUFE. Si el soporte está errado, devuélvelo a legalización.',
  };
};

const promoteReceiptFromCurrentDianBase = (
  receipt: AdvanceReceipt,
  rows: DianAuditRow[],
  context: {
    batchId?: string;
    batchName?: string;
    now: string;
    actorId?: string | null;
    actorName?: string;
    includeRevision?: boolean;
  }
) => {
  if (isAccountingAcceptedReceipt(receipt) || !canReceiptBePromotedForPartialCloseAudit(receipt)) {
    return receipt;
  }

  const auditInsight = findDianAuditInsight(receipt, rows);
  if (auditInsight.status !== 'matched' || !auditInsight.match) return receipt;

  return {
    ...receipt,
    status: 'audit_passed' as const,
    dianVerificationStatus: 'confirmed' as const,
    dianVerificationSource: 'audit_base' as const,
    dianVerifiedAt: context.now,
    dianVerifiedBy: context.actorId || null,
    dianVerifiedByName: context.actorName || '',
    accountingAuditStatus: 'matched' as const,
    accountingAuditBatchId: context.batchId || receipt.accountingAuditBatchId || '',
    accountingAuditBatchName: context.batchName || receipt.accountingAuditBatchName || '',
    accountingAuditedAt: context.now,
    accountingAuditedBy: context.actorId || null,
    accountingAuditedByName: context.actorName || '',
    accountingAuditMessage: auditInsight.message,
    accountingAuditSeverity: auditInsight.severity,
    accountingAuditRecommendation: auditInsight.recommendation,
    accountingAuditProviderHistory: auditInsight.providerHistory,
    accountingAuditCreditNotes: auditInsight.creditNotes,
    accountingAuditMatch: {
      cufe: auditInsight.match.cufe,
      invoiceNumber: auditInsight.match.invoiceNumber,
      taxId: auditInsight.match.taxId,
      businessName: auditInsight.match.businessName,
      amount: auditInsight.match.amount,
      date: auditInsight.match.date,
      documentType: auditInsight.match.documentType,
      rowNumber: auditInsight.match.rowNumber,
    },
    revisions:
      context.includeRevision === false
        ? receipt.revisions
        : [
            ...(receipt.revisions || []),
            {
              type: 'audit_passed' as const,
              actorId: context.actorId || null,
              actorName: context.actorName || '',
              at: context.now,
              comment: `Cruce DIAN aprobado automáticamente antes del cierre contable con ${context.batchName || 'la base vigente'}, fila ${auditInsight.match.rowNumber}.`,
            },
          ],
  } satisfies AdvanceReceipt;
};

const getPartialClosureExclusionReason = (receipt: AdvanceReceipt, rows: DianAuditRow[]) => {
  if (receipt.status === 'returned') return 'Devuelta para subsanación.';
  if (receipt.status === 'rejected') return 'Rechazada administrativamente.';
  if (receipt.status === 'submitted') return 'Pendiente de revisión administrativa.';
  if (!isInvoiceReceipt(receipt)) {
    return isAccountingAcceptedReceipt(receipt) ? '' : 'Soporte manual pendiente de aprobación administrativa.';
  }
  if (!canReceiptBePromotedForPartialCloseAudit(receipt)) {
    return 'La factura aún no está habilitada para Auditoría DIAN.';
  }
  if (rows.length === 0) return 'No hay una base DIAN vigente para ejecutar el cruce.';

  const insight = findDianAuditInsight(receipt, rows);
  if (insight.status === 'matched') return '';
  return insight.message || 'Requiere validación adicional en Auditoría DIAN.';
};

const buildDianDocumentUrl = (cufe: string) =>
  `https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=${encodeURIComponent(normalizeCufe(cufe))}`;

const RECEIPT_EDITABLE_FIELDS: Array<{ key: keyof ReceiptEditorForm; label: string }> = [
  { key: 'documentType', label: 'Tipo de documento' },
  { key: 'categoryId', label: 'Tipo de gasto' },
  { key: 'costCenterId', label: 'Centro de costos' },
  { key: 'amount', label: 'Valor' },
  { key: 'date', label: 'Fecha' },
  { key: 'businessName', label: 'Razón social' },
  { key: 'taxId', label: 'NIT o documento' },
  { key: 'invoiceNumber', label: 'Número del soporte' },
  { key: 'cufe', label: 'CUFE' },
  { key: 'description', label: 'Descripción' },
];

const buildReceiptEditorForm = (
  receipt: AdvanceReceipt,
  advance?: TravelAdvance
): ReceiptEditorForm => {
  const documentType = getReceiptDocumentType(receipt.documentType);
  const cufe = receipt.cufe || '';
  const costCenter = getReceiptCostCenter(receipt, advance || {});
  return {
    documentType,
    categoryId: receipt.categoryId || '',
    costCenterId: costCenter.id,
    amount: String(asNumber(receipt.amount) || ''),
    date: receipt.date || todayInputValue(),
    businessName: receipt.businessName || '',
    taxId: receipt.taxId || '',
    invoiceNumber: receipt.invoiceNumber || '',
    cufe,
    description: receipt.description || '',
    correctionNote: '',
    dianVerificationStatus:
      documentType === 'cash_receipt'
        ? 'not_applicable'
        : receipt.dianVerificationStatus || (cufe ? 'pending' : 'not_applicable'),
    dianLookupOpenedAt: receipt.dianLookupOpenedAt || '',
    dianVerifiedAt: receipt.dianVerifiedAt || '',
    dianDocumentUrl: receipt.dianDocumentUrl || (cufe ? buildDianDocumentUrl(cufe) : ''),
    dianVerificationSource: receipt.dianVerificationSource || (receipt.dianVerificationStatus === 'confirmed' ? 'official_portal' : undefined),
  };
};

const buildEmptyAdvanceForm = (currentUser: any, teamMembers: any[]) => {
  const currentMember = teamMembers.find((member) => {
    const emailMatches =
      currentUser?.email &&
      member?.email &&
      String(member.email).toLowerCase() === String(currentUser.email).toLowerCase();
    return member?.id === currentUser?.uid || member?.authUserId === currentUser?.uid || emailMatches;
  });

  return {
    customId: '',
    requesterId: currentMember?.id || currentUser?.uid || '',
    destination: '',
    department: '',
    municipality: '',
    purpose: '',
    travelStart: todayInputValue(),
    travelEnd: todayInputValue(),
    taskIds: [] as string[],
    costCenterId: '',
    items: [] as AdvanceItem[],
  };
};

export function ProjectAdministration({
  projectId,
  project,
  presentation = 'standalone',
  tasks = [],
  contractorActivityTasks,
  teamMembers = [],
  approvalTeamMembers = [],
  currentUser,
  userRole,
  canView,
  canManage,
  canValidate,
  canEditAccountingClosures,
  canEditAccountingClosureDate,
  canDeleteAccountingClosures,
  canDeleteAdministrativeReceipts,
  canConfigure,
}: ProjectAdministrationProps) {
  const contractorApprovalPeople = useMemo(() => {
    const peopleByIdentity = new Map<string, any>();
    [...approvalTeamMembers, ...teamMembers].forEach((person) => {
      const identity = String(person?.id || person?.authUserId || person?.uid || person?.email || '').trim().toLowerCase();
      if (identity && !peopleByIdentity.has(identity)) peopleByIdentity.set(identity, person);
    });
    return Array.from(peopleByIdentity.values());
  }, [approvalTeamMembers, teamMembers]);
  const [advances, setAdvances] = useState<TravelAdvance[]>([]);
  const [adminWorkspace, setAdminWorkspace] = useState<'advances' | 'contractorAccounts'>('advances');
  const [contractorAccounts, setContractorAccounts] = useState<ContractorPaymentRequest[]>([]);
  const [contractorRateCards, setContractorRateCards] = useState<any[]>([]);
  const [contractorRateEntries, setContractorRateEntries] = useState<any[]>([]);
  const [contractorQualityEvents, setContractorQualityEvents] = useState<any[]>([]);
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [costCenterDomains, setCostCenterDomains] = useState<CostCenterDomain[]>([]);
  const [contractorAccountPayers, setContractorAccountPayers] = useState<ContractorAccountPayerDomain[]>([]);
  const [payments, setPayments] = useState<BillingPayment[]>([]);
  const [locationOptions, setLocationOptions] = useState<ColombiaDepartment[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [locationsLoaded, setLocationsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'requests' | 'approvals' | 'payables' | 'receipts' | 'audit' | 'conciliation' | 'payments' | 'settings'>('requests');
  const [contractorAccountView, setContractorAccountView] = useState<ContractorAccountView>('all');
  const [contractorAccountSearch, setContractorAccountSearch] = useState('');
  const [contractorAccountStageFilter, setContractorAccountStageFilter] = useState<ContractorAccountStageFilter>('all');
  const [contractorAccountSort, setContractorAccountSort] = useState<ContractorAccountSort>('recent');
  const [showPaidContractorAccounts, setShowPaidContractorAccounts] = useState(false);
  const [isContractorAccountModalOpen, setIsContractorAccountModalOpen] = useState(false);
  const [editingContractorAccount, setEditingContractorAccount] = useState<ContractorPaymentRequest | null>(null);
  const [contractorAccountStep, setContractorAccountStep] = useState<1 | 2 | 3>(1);
  const [contractorAccountForm, setContractorAccountForm] = useState(() => buildEmptyContractorAccountForm());
  const [selectedContractorMemberId, setSelectedContractorMemberId] = useState('');
  const [contractorDocumentFiles, setContractorDocumentFiles] = useState<Partial<Record<ContractorAccountDocumentKind, File | null>>>({});
  const [isContractorParafiscalsDragging, setIsContractorParafiscalsDragging] = useState(false);
  const [contractorPaymentFile, setContractorPaymentFile] = useState<File | null>(null);
  const [currentUserProfile, setCurrentUserProfile] = useState<any | null>(null);
  const [selectedContractorProfile, setSelectedContractorProfile] = useState<any | null>(null);
  const [contractorAccountAction, setContractorAccountAction] = useState<{
    type: 'approve' | 'return' | 'reject' | 'account' | 'pay' | 'delete' | 'reassign';
    account: ContractorPaymentRequest;
  } | null>(null);
  const [contractorAccountActionComment, setContractorAccountActionComment] = useState('');
  const [contractorAccountReassignMemberId, setContractorAccountReassignMemberId] = useState('');
  const [advanceSearch, setAdvanceSearch] = useState('');
  const [advanceSort, setAdvanceSort] = useState<'id_desc' | 'id_asc' | 'review_desc' | 'amount_desc'>('id_desc');
  const [receiptReviewFilter, setReceiptReviewFilter] = useState<'all' | 'pending' | 'clear'>('all');
  const [showPaidAdvances, setShowPaidAdvances] = useState(false);
  const [showReconciledAdvances, setShowReconciledAdvances] = useState(false);
  const [savingDianAuditBase, setSavingDianAuditBase] = useState(false);
  const [dianAuditBatches, setDianAuditBatches] = useState<DianAuditBatch[]>([]);
  const [dianAuditSearch, setDianAuditSearch] = useState('');
  const [dianAuditStatusFilter, setDianAuditStatusFilter] = useState<DianAuditStatusFilter>('all');
  const [collapsedDianAuditGroups, setCollapsedDianAuditGroups] = useState<Record<string, boolean>>({});
  const [editingAccountingClosure, setEditingAccountingClosure] = useState<{
    advance: TravelAdvance;
    closure: AdvanceAccountingClosure;
  } | null>(null);
  const [deletingAccountingClosure, setDeletingAccountingClosure] = useState<{
    advance: TravelAdvance;
    closure: AdvanceAccountingClosure;
  } | null>(null);
  const [accountingClosureReceiptIds, setAccountingClosureReceiptIds] = useState<string[]>([]);
  const [accountingClosureEditDate, setAccountingClosureEditDate] = useState('');
  const [accountingClosureEditNote, setAccountingClosureEditNote] = useState('');
  const [isAdvanceModalOpen, setIsAdvanceModalOpen] = useState(false);
  const [advanceForm, setAdvanceForm] = useState(() => buildEmptyAdvanceForm(currentUser, teamMembers));
  const [advanceTaskSearch, setAdvanceTaskSearch] = useState('');
  const [advanceTaskStatusFilter, setAdvanceTaskStatusFilter] = useState<AdvanceTaskStatusFilter>('active');
  const [advanceTaskGroupFilter, setAdvanceTaskGroupFilter] = useState('all');
  const [advanceDraftItem, setAdvanceDraftItem] = useState<AdvanceItem | null>(null);
  const [selectedAdvance, setSelectedAdvance] = useState<TravelAdvance | null>(null);
  const [viewingAdvance, setViewingAdvance] = useState<TravelAdvance | null>(null);
  const [paymentAdvance, setPaymentAdvance] = useState<TravelAdvance | null>(null);
  const [paymentFile, setPaymentFile] = useState<File | null>(null);
  const [paymentForm, setPaymentForm] = useState({
    customId: '',
    amount: '',
    date: todayInputValue(),
    reference: '',
    note: '',
  });
  const [reconciliationAdvance, setReconciliationAdvance] = useState<TravelAdvance | null>(null);
  const [reconciliationFile, setReconciliationFile] = useState<File | null>(null);
  const [reconciliationForm, setReconciliationForm] = useState({
    date: todayInputValue(),
    reference: '',
    note: '',
  });
  const [editingAdvance, setEditingAdvance] = useState<TravelAdvance | null>(null);
  const [advanceEditForm, setAdvanceEditForm] = useState<AdvanceEditForm>({
    customId: '',
    department: '',
    municipality: '',
    purpose: '',
    travelStart: todayInputValue(),
    travelEnd: todayInputValue(),
    amountReturned: '',
    returnComment: '',
    costCenters: [],
    items: [],
  });
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [supportPreviewFile, setSupportPreviewFile] = useState<File | null>(null);
  const [receiptMode, setReceiptMode] = useState<'manual' | 'ai'>('manual');
  const [aiReceiptDrafts, setAiReceiptDrafts] = useState<AiReceiptDraft[]>([]);
  const [aiAnalyzingReceipts, setAiAnalyzingReceipts] = useState(false);
  const [receiptForm, setReceiptForm] = useState({
    documentType: 'invoice' as ReceiptDocumentType,
    categoryId: '',
    costCenterId: '',
    amount: '',
    date: todayInputValue(),
    businessName: '',
    taxId: '',
    invoiceNumber: '',
    cufe: '',
    description: '',
  });
  const [categoryForm, setCategoryForm] = useState({
    id: '',
    name: '',
    defaultDailyAmount: '',
    unitLabel: 'dia',
    color: '#4f46e5',
    requiresCufe: false,
    description: '',
  });
  const [costCenterForm, setCostCenterForm] = useState({
    id: '',
    name: '',
    code: '',
    description: '',
  });
  const [contractorAccountPayerForm, setContractorAccountPayerForm] = useState({
    id: '',
    name: '',
    taxId: '',
    address: '',
    city: '',
  });
  const [reviewAction, setReviewAction] = useState<ReviewAction>(null);
  const [reviewComment, setReviewComment] = useState('');
  const [receiptEditor, setReceiptEditor] = useState<ReceiptEditorState | null>(null);
  const [receiptEditorForm, setReceiptEditorForm] = useState<ReceiptEditorForm | null>(null);
  const [receiptCorrectionFile, setReceiptCorrectionFile] = useState<File | null>(null);
  const [receiptReplacementFile, setReceiptReplacementFile] = useState<File | null>(null);
  const [receiptSupportAction, setReceiptSupportAction] = useState<'replace' | 'reanalyze' | null>(null);
  const [pdfPasswordDialog, setPdfPasswordDialog] = useState<(
    PdfPasswordRequest & { resolve: (password: string | null) => void }
  ) | null>(null);
  const [pdfPasswordInput, setPdfPasswordInput] = useState('');
  const [expandedReceiptGroups, setExpandedReceiptGroups] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);

  const administrationQuery = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search)
    : null;
  const requestedWorkspace = administrationQuery?.get('workspace') || null;
  const requestedContractorAccountId = administrationQuery?.get('contractorAccountId') || administrationQuery?.get('accountId') || null;
  const requestedAdvanceId = administrationQuery?.get('advanceId') || null;

  useEffect(() => {
    const requestedAccountId = requestedContractorAccountId;
    if (requestedWorkspace !== 'contractorAccounts' && !requestedAccountId) return;

    const synchronizationId = window.setTimeout(() => {
      setAdminWorkspace('contractorAccounts');
      setContractorAccountView('all');
      setContractorAccountStageFilter('all');
      if (requestedAccountId) setContractorAccountSearch(requestedAccountId);
    }, 0);
    return () => window.clearTimeout(synchronizationId);
  }, [requestedContractorAccountId, requestedWorkspace]);

  useEffect(() => {
    if (requestedWorkspace !== 'advances' && !requestedAdvanceId) return;

    const synchronizationId = window.setTimeout(() => {
      setAdminWorkspace('advances');
      setView('requests');
      if (requestedAdvanceId) setAdvanceSearch(requestedAdvanceId);
    }, 0);
    return () => window.clearTimeout(synchronizationId);
  }, [requestedAdvanceId, requestedWorkspace]);

  useEffect(() => {
    if (!currentUser?.uid) {
      setCurrentUserProfile(null);
      return;
    }

    const unsubscribe = onSnapshot(
      doc(db, 'users', currentUser.uid),
      (profileSnapshot) => {
        setCurrentUserProfile(profileSnapshot.exists() ? { id: profileSnapshot.id, ...profileSnapshot.data() } : null);
      },
      (error) => {
        console.warn('No se pudo cargar el perfil global para validar la firma administrativa:', error);
        setCurrentUserProfile(null);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [currentUser?.uid]);

  const openReviewAction = (action: NonNullable<ReviewAction>) => {
    setReviewComment('');
    setReviewAction(action);
  };

  useEffect(() => {
    if (!canView) return;
    setLoading(true);
    const unsubscribes = [
      onSnapshot(
        query(collection(db, 'organizations')),
        (snapshot) => {
          setOrganizations(snapshot.docs.map((snap) => ({ id: snap.id, ...snap.data() })));
        },
        (error) => {
          console.error('Error loading organizations for contractor accounts:', error);
        }
      ),
      onSnapshot(
        query(collection(db, 'projects', projectId, 'advanceRequests'), orderBy('createdAt', 'desc')),
        (snapshot) => {
          setAdvances(snapshot.docs.map((snap) => {
            const advance = { id: snap.id, ...snap.data() } as TravelAdvance;
            const provisionalCostCenter = getAdvancePrimaryCostCenter(advance);
            return {
              ...advance,
              receipts: (advance.receipts || []).map((receipt) =>
                receipt.costCenterId || receipt.costCenterName
                  ? receipt
                  : {
                      ...receipt,
                      costCenterId: provisionalCostCenter.id,
                      costCenterName: provisionalCostCenter.name,
                      costCenterSource: 'advance_provisional' as const,
                    }
              ),
            };
          }));
          setLoading(false);
        },
        (error) => {
          console.error('Error loading advance requests:', error);
          toast.error('No se pudieron cargar los anticipos del proyecto.');
          setLoading(false);
        }
      ),
      onSnapshot(
        query(collection(db, 'projects', projectId, 'contractorPaymentRequests'), orderBy('createdAt', 'desc')),
        (snapshot) => {
          setContractorAccounts(snapshot.docs.map((snap) => {
            const account = { id: snap.id, ...snap.data() } as ContractorPaymentRequest;
            return {
              ...account,
              qualitySnapshot: normalizeContractorQualitySnapshot(account.qualitySnapshot),
            };
          }));
        },
        (error) => {
          console.error('Error loading contractor payment requests:', error);
          toast.error('No se pudieron cargar las cuentas de cobro.');
        }
      ),
      onSnapshot(
        query(collection(db, 'projects', projectId, 'rateCards')),
        (snapshot) => {
          setContractorRateCards(snapshot.docs.map((snap) => ({ id: snap.id, ...snap.data() })));
        },
        (error) => {
          console.error('Error loading rate cards for contractor accounts:', error);
        }
      ),
      onSnapshot(
        query(collection(db, 'projects', projectId, 'rateCardEntries')),
        (snapshot) => {
          setContractorRateEntries(snapshot.docs.map((snap) => ({ id: snap.id, ...snap.data() })));
        },
        (error) => {
          console.error('Error loading rate card entries for contractor accounts:', error);
        }
      ),
      onSnapshot(
        query(collection(db, 'projects', projectId, 'qualityEvents')),
        (snapshot) => {
          setContractorQualityEvents(snapshot.docs.map((snap) => ({ id: snap.id, ...snap.data() })));
        },
        (error) => {
          console.error('Error loading quality events for contractor accounts:', error);
        }
      ),
      onSnapshot(
        query(collection(db, 'projects', projectId, 'expenseCategories'), orderBy('name', 'asc')),
        (snapshot) => {
          setCategories(snapshot.docs.map((snap) => ({ id: snap.id, ...snap.data() } as ExpenseCategory)));
        },
        (error) => {
          console.error('Error loading expense categories:', error);
        }
      ),
      onSnapshot(
        query(collection(db, 'projects', projectId, 'costCenters'), orderBy('name', 'asc')),
        (snapshot) => {
          setCostCenterDomains(snapshot.docs.map((snap) => ({ id: snap.id, ...snap.data() } as CostCenterDomain)));
        },
        (error) => {
          console.error('Error loading cost center domains:', error);
        }
      ),
      onSnapshot(
        query(collection(db, 'projects', projectId, 'contractorAccountPayers'), orderBy('name', 'asc')),
        (snapshot) => {
          setContractorAccountPayers(snapshot.docs.map((snap) => ({ id: snap.id, ...snap.data() } as ContractorAccountPayerDomain)));
        },
        (error) => {
          console.error('Error loading contractor account payer domains:', error);
        }
      ),
      onSnapshot(
        query(collection(db, 'projects', projectId, 'billingPayments'), orderBy('date', 'desc')),
        (snapshot) => {
          setPayments(snapshot.docs.map((snap) => ({ id: snap.id, ...snap.data() } as BillingPayment)));
        },
        (error) => {
          console.error('Error loading billing payments for admin module:', error);
        }
      ),
      onSnapshot(
        query(collection(db, 'projects', projectId, 'dianAuditBatches'), orderBy('uploadedAt', 'desc')),
        (snapshot) => {
          setDianAuditBatches(snapshot.docs.map((snap) => ({ id: snap.id, ...snap.data() } as DianAuditBatch)));
        },
        (error) => {
          console.error('Error loading DIAN audit batches:', error);
        }
      ),
    ];

    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [canView, projectId]);

  const categoryOptions = useMemo(() => {
    const liveCategories = categories.filter((category) => category.active !== false);
    if (liveCategories.length > 0) return liveCategories;
    return DEFAULT_CATEGORIES.map((category, index) => ({ id: `default-${index}`, ...category }));
  }, [categories]);

  const costCenterOptions = useMemo(() => {
    const liveCostCenters = costCenterDomains.filter((center) => center.active !== false);
    if (liveCostCenters.length > 0) return liveCostCenters;
    return DEFAULT_COST_CENTERS.map((center, index) => ({ id: `default-cost-center-${index}`, ...center }));
  }, [costCenterDomains]);

  const contractorAccountPayerOptions = useMemo(() => {
    const livePayers = contractorAccountPayers.filter((payer) => payer.active !== false);
    if (livePayers.length > 0) return livePayers;
    return DEFAULT_CONTRACTOR_ACCOUNT_PAYERS.map((payer, index) => ({
      id: `default-contractor-payer-${index}`,
      ...payer,
    }));
  }, [contractorAccountPayers]);

  const selectedReceiptCategory = categoryOptions.find((category) => category.id === receiptForm.categoryId);
  const selectedReceiptDocumentType = getReceiptDocumentType(receiptForm.documentType);
  const selectedReceiptDocumentMeta = getReceiptDocumentTypeMeta(receiptForm.documentType);
  const municipalityOptions = useMemo(
    () => locationOptions.find((item) => item.department === advanceForm.department)?.municipalities || [],
    [advanceForm.department, locationOptions]
  );
  const editMunicipalityOptions = useMemo(
    () => locationOptions.find((item) => item.department === advanceEditForm.department)?.municipalities || [],
    [advanceEditForm.department, locationOptions]
  );
  const selectedAdvanceTasks = useMemo(
    () => tasks.filter((task) => advanceForm.taskIds.includes(task.id)),
    [advanceForm.taskIds, tasks]
  );
  const contractorTaskPool = useMemo(
    () => (Array.isArray(contractorActivityTasks) && contractorActivityTasks.length > 0 ? contractorActivityTasks : tasks),
    [contractorActivityTasks, tasks]
  );
  const selectedContractorAccountTasks = useMemo(
    () => contractorTaskPool.filter((task) => contractorAccountForm.taskIds.includes(task.id)),
    [contractorAccountForm.taskIds, contractorTaskPool]
  );
  const taskById = useMemo(
    () => new Map(tasks.filter((task) => task?.id).map((task) => [task.id as string, task])),
    [tasks]
  );
  const contractorTaskById = useMemo(
    () => new Map(contractorTaskPool.filter((task) => task?.id).map((task) => [task.id as string, task])),
    [contractorTaskPool]
  );
  const getAdvanceTaskGroupId = useCallback((task: any) => {
    const visited = new Set<string>();
    let current = task;

    while (current && !visited.has(String(current.id || ''))) {
      if (current.groupId) return String(current.groupId);
      if (!current.id || !current.parentTaskId) break;
      visited.add(String(current.id));
      current = taskById.get(current.parentTaskId);
    }

    return UNGROUPED_TASK_GROUP_ID;
  }, [taskById]);
  const advanceTaskGroups = useMemo(() => {
    const groups = new Map<string, { id: string; name: string; color?: string; order: number }>();
    (Array.isArray(project?.taskGroups) ? project.taskGroups : []).forEach((group: any, index: number) => {
      if (!group?.id) return;
      groups.set(group.id, {
        id: group.id,
        name: group.name || 'Grupo sin nombre',
        color: group.color,
        order: Number(group.order ?? index),
      });
    });
    tasks.forEach((task) => {
      const groupId = getAdvanceTaskGroupId(task);
      if (groupId === UNGROUPED_TASK_GROUP_ID || groups.has(groupId)) return;
      groups.set(groupId, {
        id: groupId,
        name: task.groupName || 'Grupo sin nombre',
        color: task.groupColor,
        order: groups.size,
      });
    });

    return [
      ...[...groups.values()].sort((left, right) => left.order - right.order || left.name.localeCompare(right.name)),
      { id: UNGROUPED_TASK_GROUP_ID, name: 'Sin grupo', color: '#94a3b8', order: Number.MAX_SAFE_INTEGER },
    ];
  }, [getAdvanceTaskGroupId, project?.taskGroups, tasks]);
  const advanceTaskGroupById = useMemo(
    () => new Map(advanceTaskGroups.map((group) => [group.id, group])),
    [advanceTaskGroups]
  );
  const taskIdsWithChildren = useMemo(
    () => new Set(tasks.map((task) => task?.parentTaskId).filter(Boolean).map(String)),
    [tasks]
  );
  const contractorTaskIdsWithChildren = useMemo(
    () => new Set(contractorTaskPool.map((task) => task?.parentTaskId).filter(Boolean).map(String)),
    [contractorTaskPool]
  );
  const contractorBillableActivities = useMemo(() => {
    return contractorTaskPool.flatMap((task) => {
      if (!task?.id) return [];
      const groupId = getAdvanceTaskGroupId(task);
      const group = advanceTaskGroupById.get(groupId);
      const parentTask = task.parentTaskId ? contractorTaskById.get(task.parentTaskId) : null;
      const base = {
        projectId: task.projectId || projectId,
        projectName: task.projectName || project?.name || '',
        taskId: String(task.id),
        parentTaskId: task.parentTaskId || null,
        rootTaskId: parentTask?.id ? String(parentTask.id) : String(task.id),
        rootTaskTitle: parentTask ? getTaskTitle(parentTask) : getTaskTitle(task),
        groupId,
        groupName: group?.name || 'Sin grupo',
      };

      const steps = Array.isArray(task.workflowSteps) ? task.workflowSteps : [];
      if (steps.length > 0) {
        return steps.map((step: any, index: number) => {
          const stepLabel = getWorkflowStepLabel(step, index);
          const completedAt = toDateInputValue(getStepCompletedDate(task, step));
          const dueDate = toDateInputValue(getStepDueDate(task, step));
          const daysLate = getCalendarDaysLate(getStepCompletedDate(task, step), getStepDueDate(task, step));
          return {
            ...base,
            key: `workflow-step:${task.id}:${index}`,
            type: 'workflow_step' as const,
            taskTitle: `${getTaskTitle(task)} · ${stepLabel}`,
            stepIndex: index,
            stepLabel,
            status: step?.status || task.status,
            date: toDateInputValue(getStepBillingDate(task, step)),
            completedAt,
            dueDate,
            timing: !dueDate ? 'without_schedule' as const : daysLate > 0 ? 'late' as const : 'on_time' as const,
            daysLate,
            description: String(step?.description || step?.instructions || task?.description || '').trim(),
            executionDetail: buildActivityExecutionDetail(task, step),
            actorTokens: collectStepActorTokens(task, step),
          };
        });
      }

      if (contractorTaskIdsWithChildren.has(String(task.id))) return [];

      const completedAt = toDateInputValue(getTaskCompletedDate(task));
      const dueDate = toDateInputValue(getTaskDueDate(task));
      const daysLate = getCalendarDaysLate(getTaskCompletedDate(task), getTaskDueDate(task));
      return [{
        ...base,
        key: `task:${task.id}`,
        type: task.parentTaskId ? 'subtask' as const : 'task' as const,
        taskTitle: getTaskTitle(task),
        stepIndex: null,
        stepLabel: null,
        status: task.status,
        date: toDateInputValue(getTaskBillingDate(task)),
        completedAt,
        dueDate,
        timing: !dueDate ? 'without_schedule' as const : daysLate > 0 ? 'late' as const : 'on_time' as const,
        daysLate,
        description: String(task?.description || task?.instructions || '').trim(),
        executionDetail: buildActivityExecutionDetail(task),
        actorTokens: collectTaskActorTokens(task),
      }];
    });
  }, [advanceTaskGroupById, contractorTaskById, contractorTaskIdsWithChildren, contractorTaskPool, getAdvanceTaskGroupId, project?.name, projectId]);
  const filteredAdvanceTasks = useMemo(() => {
    const search = normalizeTaskSearchText(advanceTaskSearch);

    return [...tasks]
      .filter((task) => {
        const statusMeta = getTaskStatusMeta(task);
        const isActive = !['completed', 'cancelled'].includes(statusMeta.key);
        if (advanceTaskStatusFilter === 'active' && !isActive) return false;
        if (advanceTaskStatusFilter !== 'active' && advanceTaskStatusFilter !== 'all' && statusMeta.key !== advanceTaskStatusFilter) {
          return false;
        }

        const groupId = getAdvanceTaskGroupId(task);
        if (advanceTaskGroupFilter !== 'all' && groupId !== advanceTaskGroupFilter) return false;
        if (!search) return true;

        const parentTask = task.parentTaskId ? taskById.get(task.parentTaskId) : null;
        const groupName = advanceTaskGroupById.get(groupId)?.name || 'Sin grupo';
        return normalizeTaskSearchText([
          getTaskTitle(task),
          task.externalWorkflowId,
          task.description,
          task.id,
          groupName,
          parentTask ? getTaskTitle(parentTask) : '',
        ].filter(Boolean).join(' ')).includes(search);
      })
      .sort((left, right) => {
        const leftGroup = advanceTaskGroupById.get(getAdvanceTaskGroupId(left));
        const rightGroup = advanceTaskGroupById.get(getAdvanceTaskGroupId(right));
        const groupOrder = Number(leftGroup?.order ?? Number.MAX_SAFE_INTEGER) - Number(rightGroup?.order ?? Number.MAX_SAFE_INTEGER);
        if (groupOrder !== 0) return groupOrder;
        return getTaskTitle(left).localeCompare(getTaskTitle(right), 'es', { sensitivity: 'base' });
      });
  }, [advanceTaskGroupById, advanceTaskGroupFilter, advanceTaskSearch, advanceTaskStatusFilter, getAdvanceTaskGroupId, taskById, tasks]);

  useEffect(() => {
    if (categoryOptions.length === 0) return;
    if (
      advanceDraftItem &&
      categoryOptions.some((category) => category.id === advanceDraftItem.categoryId)
    ) return;

    const category = categoryOptions[0];
    const days = advanceDraftItem?.days ?? 1;
    const unitAmount = asNumber(category.defaultDailyAmount);
    setAdvanceDraftItem({
      id: advanceDraftItem?.id || safeId(),
      categoryId: category.id,
      categoryName: category.name,
      days,
      unitAmount,
      amount: roundCurrency(days * unitAmount),
      note: advanceDraftItem?.note || '',
    });
  }, [advanceDraftItem, categoryOptions]);

  useEffect(() => {
    if (!receiptForm.categoryId && categoryOptions.length > 0) {
      setReceiptForm((current) => ({ ...current, categoryId: categoryOptions[0].id }));
    }
  }, [categoryOptions, receiptForm.categoryId]);

  useEffect(() => {
    if (!selectedAdvance || receiptForm.costCenterId) return;
    const provisional = getAdvancePrimaryCostCenter(selectedAdvance);
    const preferredId =
      costCenterOptions.find((center) => center.id === provisional.id)?.id ||
      costCenterOptions.find(
        (center) => center.name.trim().toLowerCase() === provisional.name.trim().toLowerCase()
      )?.id ||
      costCenterOptions[0]?.id ||
      '';
    if (preferredId) {
      setReceiptForm((current) => ({ ...current, costCenterId: preferredId }));
    }
  }, [selectedAdvance, receiptForm.costCenterId, costCenterOptions]);

  useEffect(() => {
    if (!advanceForm.costCenterId && costCenterOptions.length > 0) {
      setAdvanceForm((current) => ({ ...current, costCenterId: costCenterOptions[0].id }));
    }
  }, [advanceForm.costCenterId, costCenterOptions]);

  const advanceActorIds = useMemo(() => {
    const ids = new Set<string>();
    const push = (value: unknown) => {
      const normalized = String(value || '').trim();
      if (normalized) ids.add(normalized);
    };
    push(currentUser?.uid);
    teamMembers.forEach((member) => {
      const emailMatches =
        currentUser?.email &&
        member?.email &&
        String(member.email).toLowerCase() === String(currentUser.email).toLowerCase();
      if (member?.id === currentUser?.uid || member?.authUserId === currentUser?.uid || emailMatches) {
        push(member?.id);
        push(member?.authUserId);
        push(member?.uid);
      }
    });
    return ids;
  }, [currentUser?.email, currentUser?.uid, teamMembers]);
  const canSeeAllAdvances = Boolean(canManage || canValidate || userRole === 'admin' || userRole === 'org_admin');
  const canCreateAdvance = Boolean(currentUser?.uid);
  const scopedAdvances = useMemo(() => {
    if (canSeeAllAdvances) return advances;
    const currentEmail = String(currentUser?.email || '').trim().toLowerCase();
    return advances.filter((advance) => {
      const requesterId = String(advance.requesterId || '').trim();
      const requesterEmail = String(advance.requesterEmail || '').trim().toLowerCase();
      return Boolean(requesterId && advanceActorIds.has(requesterId)) || Boolean(currentEmail && requesterEmail === currentEmail);
    });
  }, [advanceActorIds, advances, canSeeAllAdvances, currentUser?.email]);

  const metrics = useMemo(() => {
    const activeAdvances = scopedAdvances.filter((advance) => advance.status !== 'rejected');
    const requested = activeAdvances.reduce((sum, advance) => sum + asNumber(advance.amountRequested), 0);
    const anticipated = activeAdvances.reduce(
      (sum, advance) => sum + asNumber(advance.amountApproved || advance.amountRequested),
      0
    );
    const justified = activeAdvances.reduce((sum, advance) => sum + getAdvanceJustifiedAmount(advance), 0);
    const legalized = activeAdvances.reduce((sum, advance) => sum + asNumber(advance.amountLegalized), 0);
    const returnedCash = activeAdvances.reduce((sum, advance) => sum + asNumber(advance.amountReturned), 0);
    const paidDisbursements = activeAdvances.reduce((sum, advance) => sum + getAdvancePaymentSummary(advance).paid, 0);
    const paymentBase = activeAdvances.reduce(
      (sum, advance) => sum + asNumber(advance.amountApproved || advance.amountRequested),
      0
    );
    const pendingValidation = scopedAdvances.filter((advance) => advance.status === 'submitted').length;
    const pendingPayment = scopedAdvances.filter(canAdvanceReceivePayment).length;
    const partiallyPaid = scopedAdvances.filter((advance) => getAdvancePaymentSummary(advance).isPartiallyPaid || advance.status === 'partially_paid').length;
    const returned = scopedAdvances.filter(
      (advance) =>
        advance.status === 'returned' || (advance.receipts || []).some((receipt) => receipt.status === 'returned')
    ).length;
    const realAdminPayments = canSeeAllAdvances
      ? payments
          .filter((payment) => payment.source === 'advance_receipt' && payment.status !== 'cancelled')
          .reduce((sum, payment) => sum + asNumber(payment.amount), 0)
      : 0;

    return {
      requested,
      anticipated,
      justified,
      legalized,
      paidDisbursements,
      paymentProgress: paymentBase > 0 ? Math.min(100, Math.round((paidDisbursements / paymentBase) * 100)) : 0,
      returnedCash,
      balance: Math.max(0, anticipated - legalized - returnedCash),
      pendingValidation,
      pendingPayment,
      partiallyPaid,
      returned,
      realAdminPayments,
    };
  }, [canSeeAllAdvances, payments, scopedAdvances]);

  const filteredAdvances = useMemo(() => {
    const search = advanceSearch.trim().toLowerCase();
    const filtered = scopedAdvances.filter((advance) => {
      if (!search) return true;
      const linkedTaskTitles =
        Array.isArray(advance.taskTitles) && advance.taskTitles.length > 0
          ? advance.taskTitles
          : advance.taskTitle
            ? [advance.taskTitle]
            : [];
      const haystack = [
        advance.customId,
        advance.id,
        advance.requesterName,
        advance.requesterEmail,
        advance.destination,
        advance.department,
        advance.municipality,
        advance.purpose,
        advance.status,
        ...linkedTaskTitles,
        ...(advance.items || []).map((item) => item.categoryName),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(search);
    });

    const compareIds = (left: TravelAdvance, right: TravelAdvance) => {
      const leftHasAdministrativeId = Boolean(String(left.customId || '').trim());
      const rightHasAdministrativeId = Boolean(String(right.customId || '').trim());
      if (leftHasAdministrativeId !== rightHasAdministrativeId) return leftHasAdministrativeId ? -1 : 1;
      return String(left.customId || left.id).localeCompare(String(right.customId || right.id), 'es', {
        numeric: true,
        sensitivity: 'base',
      });
    };

    const compareIdsDescending = (left: TravelAdvance, right: TravelAdvance) => {
      const leftHasAdministrativeId = Boolean(String(left.customId || '').trim());
      const rightHasAdministrativeId = Boolean(String(right.customId || '').trim());
      if (leftHasAdministrativeId !== rightHasAdministrativeId) return leftHasAdministrativeId ? -1 : 1;
      return compareIds(right, left);
    };

    return [...filtered].sort((left, right) => {
      if (advanceSort === 'id_asc') return compareIds(left, right);
      if (advanceSort === 'review_desc') {
        const attentionStatuses: ReceiptStatus[] = ['submitted', 'returned'];
        const leftPending = (left.receipts || []).filter((receipt) => attentionStatuses.includes(receipt.status)).length;
        const rightPending = (right.receipts || []).filter((receipt) => attentionStatuses.includes(receipt.status)).length;
        return rightPending - leftPending || compareIdsDescending(left, right);
      }
      if (advanceSort === 'amount_desc') {
        return asNumber(right.amountApproved || right.amountRequested) - asNumber(left.amountApproved || left.amountRequested) || compareIdsDescending(left, right);
      }
      return compareIdsDescending(left, right);
    });
  }, [advanceSearch, advanceSort, scopedAdvances]);

  const projectOrganizationIds = useMemo(() => getOrganizationIds(project), [project]);
  const projectOrganization = useMemo(() => {
    const organizationId = projectOrganizationIds[0];
    return organizations.find((organization) => organization.id === organizationId) || null;
  }, [organizations, projectOrganizationIds]);
  const projectContractorApprovalConfig = useMemo(
    () => project?.contractorAccountApprovalConfig || {},
    [project?.contractorAccountApprovalConfig]
  );
  const contractorApprovalConfig = useMemo(
    () => resolveContractorAccountApprovalConfig(
      projectContractorApprovalConfig,
      projectOrganization?.contractorAccountApprovalConfig
    ),
    [projectContractorApprovalConfig, projectOrganization?.contractorAccountApprovalConfig]
  );
  const currentContractorActorKeys = useMemo(() => {
    const keys = new Set<string>();
    const push = (value: unknown) => {
      const normalized = String(value || '').trim().toLowerCase();
      if (normalized) keys.add(normalized);
    };
    push(currentUser?.uid);
    push(currentUser?.email);
    contractorApprovalPeople.forEach((member) => {
      const memberEmail = String(member?.email || '').trim().toLowerCase();
      if (
        String(member?.id || '') === String(currentUser?.uid || '') ||
        String(member?.authUserId || '') === String(currentUser?.uid || '') ||
        Boolean(currentUser?.email && memberEmail === String(currentUser.email).trim().toLowerCase())
      ) {
        push(member?.id);
        push(member?.authUserId);
        push(member?.uid);
        push(member?.email);
      }
    });
    return keys;
  }, [contractorApprovalPeople, currentUser]);
  const matchesCurrentContractorActor = useCallback((...values: unknown[]) => {
    return values.some((value) => currentContractorActorKeys.has(String(value || '').trim().toLowerCase()));
  }, [currentContractorActorKeys]);
  const getContractorAccountConfiguredApproverId = useCallback((status: ContractorAccountStatus | null | undefined) => {
    return getConfiguredContractorAccountApproverId(contractorApprovalConfig, status);
  }, [contractorApprovalConfig]);
  const getContractorAccountOwnerId = useCallback((account: ContractorPaymentRequest) => {
    return (
      account.currentApproverId ||
      account.currentApproverMemberId ||
      account.currentApproverAuthUserId ||
      account.currentApproverEmail ||
      getContractorAccountConfiguredApproverId(account.status)
    );
  }, [getContractorAccountConfiguredApproverId]);
  const getContractorAccountRequesterId = useCallback((account: ContractorPaymentRequest) => {
    return String(
      account.requesterSignature?.signerUserId ||
      account.contractorAuthUserId ||
      account.contractorId ||
      account.requesterSignature?.signerMemberId ||
      account.contractorEmail ||
      account.requesterSignature?.email ||
      ''
    ).trim() || null;
  }, []);
  const isContractorAccountOwner = useCallback((account: ContractorPaymentRequest) => {
    const persistedOwners = [
      account.currentApproverId,
      account.currentApproverMemberId,
      account.currentApproverAuthUserId,
      account.currentApproverEmail,
    ].filter((value) => String(value || '').trim());
    if (persistedOwners.length > 0) return matchesCurrentContractorActor(...persistedOwners);
    const configuredOwner = getContractorAccountConfiguredApproverId(account.status);
    return configuredOwner ? matchesCurrentContractorActor(configuredOwner) : false;
  }, [getContractorAccountConfiguredApproverId, matchesCurrentContractorActor]);
  const isOwnContractorAccount = useCallback((account: ContractorPaymentRequest) => {
    if (account.status === 'returned') {
      const correctionOwners = [
        account.correctionAssigneeId,
        account.correctionAssigneeMemberId,
        account.correctionAssigneeAuthUserId,
        account.correctionAssigneeEmail,
        account.currentApproverId,
        account.currentApproverMemberId,
        account.currentApproverAuthUserId,
        account.currentApproverEmail,
      ].filter((value) => String(value || '').trim());
      if (correctionOwners.length > 0) return matchesCurrentContractorActor(...correctionOwners);
    }
    return matchesCurrentContractorActor(account.contractorId, account.contractorEmail, account.requesterSignature?.signerUserId, account.requesterSignature?.signerMemberId);
  }, [matchesCurrentContractorActor]);
  const hasParticipatedInContractorAccount = useCallback((account: ContractorPaymentRequest) => {
    return (account.approvals || []).some((approval) =>
      matchesCurrentContractorActor(approval.actorId, approval.actorEmail)
    );
  }, [matchesCurrentContractorActor]);
  const hasConfiguredContractorApprovalFlow = Boolean(
    contractorApprovalConfig.immediateBossId ||
      contractorApprovalConfig.operationsManagerId ||
      contractorApprovalConfig.qualityComplianceId ||
      contractorApprovalConfig.humanTalentId ||
      contractorApprovalConfig.accountingId ||
      contractorApprovalConfig.administrationId
  );
  const canGlobalAdminManageContractorAccounts = userRole === 'admin';
  const canSeeAllContractorAccounts = Boolean(canManage || userRole === 'admin' || userRole === 'org_admin');
  const canCreateContractorAccount = Boolean(canManage || currentUser?.uid);
  const canActOnContractorAccount = useCallback((account: ContractorPaymentRequest) => {
    if (hasConfiguredContractorApprovalFlow) return isContractorAccountOwner(account);
    return Boolean(canValidate);
  }, [canValidate, hasConfiguredContractorApprovalFlow, isContractorAccountOwner]);
  const scopedContractorAccounts = useMemo(() => {
    if (canSeeAllContractorAccounts) return contractorAccounts;
    return contractorAccounts.filter((account) =>
      isOwnContractorAccount(account) ||
      isContractorAccountOwner(account) ||
      hasParticipatedInContractorAccount(account)
    );
  }, [canSeeAllContractorAccounts, contractorAccounts, hasParticipatedInContractorAccount, isContractorAccountOwner, isOwnContractorAccount]);

  const filteredContractorAccounts = useMemo(() => {
    const search = contractorAccountSearch.trim().toLowerCase();
    return scopedContractorAccounts
      .filter((account) => showPaidContractorAccounts || account.status !== 'paid')
      .filter((account) => {
        if (contractorAccountStageFilter === 'all') return true;
        if (contractorAccountStageFilter === 'mine') return isContractorAccountOwner(account);
        return account.status === contractorAccountStageFilter;
      })
      .filter((account) => {
        if (contractorAccountView === 'approvals') {
          return ['submitted', 'boss_approved', 'operations_approved'].includes(account.status) && (canSeeAllContractorAccounts || isContractorAccountOwner(account));
        }
        if (contractorAccountView === 'humanTalent') return account.status === 'quality_approved';
        if (contractorAccountView === 'accounting') return account.status === 'hr_approved';
        if (contractorAccountView === 'administration') return account.status === 'accounted';
        if (contractorAccountView === 'paid') return account.status === 'paid';
        if (contractorAccountView === 'returned') return account.status === 'returned';
        if (contractorAccountView === 'rejected') return account.status === 'rejected';
        return account.status !== 'rejected';
      })
      .filter((account) => {
        if (!search) return true;
        return [
          account.customId,
          account.id,
          account.contractorName,
          account.contractorEmail,
          account.activitySummary,
          account.status,
          ...(account.taskTitles || []),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(search);
      })
      .sort((left, right) => {
        if (contractorAccountSort === 'amount_desc') {
          return asNumber(right.honorariumAmount) - asNumber(left.honorariumAmount);
        }
        const leftTime = getDateValue(left.updatedAt || left.createdAt || left.submittedAt)?.getTime() || 0;
        const rightTime = getDateValue(right.updatedAt || right.createdAt || right.submittedAt)?.getTime() || 0;
        return contractorAccountSort === 'oldest' ? leftTime - rightTime : rightTime - leftTime;
      });
  }, [canSeeAllContractorAccounts, contractorAccountSearch, contractorAccountSort, contractorAccountStageFilter, contractorAccountView, isContractorAccountOwner, scopedContractorAccounts, showPaidContractorAccounts]);

  const contractorAccountMetrics = useMemo(() => {
    const activeAccounts = scopedContractorAccounts.filter((account) => account.status !== 'rejected');
    return {
      submitted: activeAccounts.length,
      pendingApprovals: activeAccounts.filter((account) => ['submitted', 'boss_approved', 'operations_approved', 'quality_approved'].includes(account.status)).length,
      pendingAccounting: activeAccounts.filter((account) => account.status === 'hr_approved').length,
      pendingPayment: activeAccounts.filter((account) => account.status === 'accounted').length,
      paid: activeAccounts.filter((account) => account.status === 'paid').length,
      rejected: scopedContractorAccounts.filter((account) => account.status === 'rejected').length,
      totalHonorarium: activeAccounts.reduce((sum, account) => sum + asNumber(account.honorariumAmount), 0),
      socialSecurityBase: activeAccounts.reduce((sum, account) => sum + asNumber(account.socialSecurityBase), 0),
    };
  }, [scopedContractorAccounts]);

  const hiddenPaidAdvancesCount = useMemo(
    () => filteredAdvances.filter(isAdvanceFullyPaidForQueue).length,
    [filteredAdvances]
  );

  const hiddenReconciledAdvancesCount = useMemo(
    () => filteredAdvances.filter(isAdvanceReconciled).length,
    [filteredAdvances]
  );

  const requestAdvances = useMemo(
    () =>
      filteredAdvances.filter(
        (advance) => showReconciledAdvances || !isAdvanceReconciled(advance)
      ),
    [filteredAdvances, showReconciledAdvances]
  );

  const approvalAdvances = useMemo(
    () => filteredAdvances.filter((advance) => ['submitted', 'returned'].includes(advance.status)),
    [filteredAdvances]
  );

  const payableAdvances = useMemo(
    () =>
      filteredAdvances.filter((advance) =>
        canAdvanceReceivePayment(advance) ||
        (showPaidAdvances && isAdvanceFullyPaidForQueue(advance))
      ),
    [filteredAdvances, showPaidAdvances]
  );

  const administrativeQueueAdvances = view === 'approvals' ? approvalAdvances : payableAdvances;

  const receipts = useMemo(
    () =>
      scopedAdvances.flatMap((advance) =>
        (advance.receipts || []).map((receipt) => ({
          ...receipt,
          advanceId: advance.id,
          advanceTitle: advance.purpose || advance.destination,
          requesterName: advance.requesterName,
          advance,
        }))
      ),
    [scopedAdvances]
  );

  const receiptUsageIndex = useMemo(() => {
    const index = new Map<string, ReceiptDuplicateUsage[]>();

    advances.forEach((advance) => {
      (advance.receipts || []).forEach((receipt) => {
        const identity = getReceiptIdentity(receipt);
        if (!identity || receipt.status === 'rejected') return;

        const usage: ReceiptDuplicateUsage = {
          advanceId: advance.id,
          advanceCustomId: advance.customId,
          advanceTitle: advance.purpose || advance.destination || 'Anticipo sin nombre',
          requesterName: advance.requesterName || 'Solicitante',
          receiptId: receipt.id,
          documentType: getReceiptDocumentType(receipt.documentType),
          invoiceNumber: receipt.invoiceNumber,
          cufe: receipt.cufe,
          taxId: receipt.taxId,
          businessName: receipt.businessName || 'Sin razón social',
          amount: asNumber(receipt.amount),
          date: receipt.date,
        };

        index.set(identity, [...(index.get(identity) || []), usage]);
      });
    });

    return index;
  }, [advances]);

  const findDuplicateReceiptUsage = useCallback(
    (receiptLike: Partial<ReceiptIdentityInput>, currentAdvanceId: string) => {
      const identity = getReceiptIdentity(receiptLike);
      if (!identity) return null;
      return (receiptUsageIndex.get(identity) || []).find((usage) => usage.advanceId !== currentAdvanceId) || null;
    },
    [receiptUsageIndex]
  );

  const findDuplicateCufeUsage = useCallback(
    (receiptLike: Partial<ReceiptIdentityInput>, currentAdvanceId: string, currentReceiptId?: string) => {
      const identity = getReceiptCufeIdentity(receiptLike);
      if (!identity) return null;

      return (
        (receiptUsageIndex.get(identity) || []).find(
          (usage) => !(usage.advanceId === currentAdvanceId && usage.receiptId === currentReceiptId)
        ) || null
      );
    },
    [receiptUsageIndex]
  );

  const receiptGroups = useMemo(
    () =>
      filteredAdvances
        .filter((advance) => (advance.receipts || []).length > 0)
        .map((advance) => {
          const advanceReceipts = advance.receipts || [];
          const legalized = advanceReceipts
            .filter(isApprovedReceipt)
            .reduce((sum, receipt) => sum + asNumber(receipt.amount), 0);
          const pending = advanceReceipts
            .filter((receipt) => receipt.status === 'submitted')
            .reduce((sum, receipt) => sum + asNumber(receipt.amount), 0);
          const returned = advanceReceipts
            .filter((receipt) => receipt.status === 'returned')
            .reduce((sum, receipt) => sum + asNumber(receipt.amount), 0);
          const pendingCount = advanceReceipts.filter((receipt) => receipt.status === 'submitted').length;
          const returnedCount = advanceReceipts.filter((receipt) => receipt.status === 'returned').length;
          const duplicateCount = advanceReceipts.filter(
            (receipt) =>
              findDuplicateCufeUsage(receipt, advance.id, receipt.id) ||
              findDuplicateReceiptUsage(receipt, advance.id)
          ).length;
          const approved = asNumber(advance.amountApproved || advance.amountRequested);
          const justified = getAdvanceJustifiedAmount(advance);
          const coverage = getAdvanceFinancialCoverage({ ...advance, amountApproved: approved, amountLegalized: legalized });
          const difference = coverage.balance;

          return {
            advance,
            receipts: advanceReceipts,
            approved,
            justified,
            legalized,
            returnedCash: coverage.returnedCash,
            pending,
            returned,
            pendingCount,
            returnedCount,
            duplicateCount,
            difference,
            coverage,
            progress: approved > 0 ? Math.min(100, Math.round((justified / approved) * 100)) : 0,
          };
        }),
    [filteredAdvances, findDuplicateCufeUsage, findDuplicateReceiptUsage]
  );

  const visibleReceiptGroups = useMemo(
    () =>
      receiptGroups.filter((group) => {
        const needsReview = group.pendingCount > 0 || group.returnedCount > 0 || group.duplicateCount > 0;
        if (receiptReviewFilter === 'pending') return needsReview;
        if (receiptReviewFilter === 'clear') return !needsReview;
        return true;
      }),
    [receiptGroups, receiptReviewFilter]
  );

	  const auditAdvanceGroups = useMemo(
	    () => {
        const currentBatch = dianAuditBatches.find((batch) => Array.isArray(batch.rows) && batch.rows.length > 0) || null;
        const previewedAt = new Date().toISOString();
        return filteredAdvances
	        .filter((advance) => {
	          const hasAccountingClosures = getAdvanceAccountingClosures(advance).length > 0;
	          return hasAccountingClosures || (advance.status !== 'closed' && advance.reconciliationStatus !== 'reconciled');
	        })
	        .map((advance) => {
	          const auditReceipts = (advance.receipts || []).filter(needsDianAccountingAudit);
	          const pending = auditReceipts.filter((receipt) => receipt.status === 'audit_pending' || receipt.status === 'approved' || receipt.status === 'approved_modified');
	          const alerts = auditReceipts.filter(hasDianAccountingAuditAlert);
	          const passed = (advance.receipts || []).filter((receipt) => receipt.status === 'audit_passed');
	          const closures = getAdvanceAccountingClosures(advance);
	          const receiptsEligibleWithCurrentBase = (advance.receipts || []).map((receipt) =>
              promoteReceiptFromCurrentDianBase(receipt, currentBatch?.rows || [], {
                batchId: currentBatch?.id,
                batchName: currentBatch?.fileName,
                now: previewedAt,
                includeRevision: false,
              })
            );
	          const unclosedAcceptedReceipts = getUnclosedAccountingAcceptedReceipts({
              ...advance,
              receipts: receiptsEligibleWithCurrentBase,
            });
	          return {
	            advance,
	            receipts: auditReceipts,
	            pending,
	            alerts,
	            passed,
	            closures,
	            unclosedAcceptedReceipts,
	          };
	        })
	        .filter((group) => group.receipts.length > 0 || group.passed.length > 0 || group.closures.length > 0);
      },
	    [dianAuditBatches, filteredAdvances]
	  );

  const auditPendingCount = useMemo(
    () => auditAdvanceGroups.reduce((sum, group) => sum + group.pending.length, 0),
    [auditAdvanceGroups]
  );

  const auditAlertCount = useMemo(
    () => auditAdvanceGroups.reduce((sum, group) => sum + group.alerts.length, 0),
    [auditAdvanceGroups]
  );

  const auditPassedCount = useMemo(
    () => auditAdvanceGroups.reduce((sum, group) => sum + group.passed.length, 0),
    [auditAdvanceGroups]
  );

  const visibleDianAuditGroups = useMemo(() => {
    const normalizeSearch = (value: any) =>
      String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
    const search = normalizeSearch(dianAuditSearch).trim();
    const matchesStatus = (receipt: AdvanceReceipt) => {
      if (dianAuditStatusFilter === 'all') return true;
      if (dianAuditStatusFilter === 'pending') {
        return receipt.status === 'audit_pending' || receipt.status === 'approved' || receipt.status === 'approved_modified';
      }
      if (dianAuditStatusFilter === 'alerts') return receipt.status === 'audit_alert';
      return receipt.status === 'audit_passed';
    };

    return auditAdvanceGroups
      .map((group) => {
        const advanceSearchText = normalizeSearch([
          group.advance.customId,
          group.advance.id,
          group.advance.requesterName,
          group.advance.requesterEmail,
          group.advance.destination,
          group.advance.department,
          group.advance.municipality,
          group.advance.purpose,
          ...(group.advance.taskTitles || []),
        ].join(' '));
	        const advanceMatches = Boolean(search && advanceSearchText.includes(search));
	        const closureSearchText = normalizeSearch(
	          group.closures.map((closure) => [
	            closure.title,
	            closure.kind,
	            closure.sequence,
	            closure.amount,
	            closure.createdByName,
	            closure.createdAt,
	            ...(closure.auditBatchNames || []),
	          ].join(' ')).join(' ')
	        );
	        const closuresMatch = Boolean(search && closureSearchText.includes(search));
	        const visibleReceipts = [...group.receipts, ...group.passed].filter((receipt) => {
	          if (!matchesStatus(receipt)) return false;
	          if (!search || advanceMatches) return true;

          const receiptSearchText = normalizeSearch([
            receipt.categoryName,
            receipt.businessName,
            receipt.taxId,
            receipt.invoiceNumber,
            receipt.cufe,
            receipt.amount,
            receipt.date,
            receipt.costCenterName,
            receipt.accountingAuditMessage,
            receipt.accountingAuditRecommendation,
            receipt.accountingAuditBatchName,
            receipt.fileName,
          ].join(' '));
          return receiptSearchText.includes(search);
        });

	        return {
	          ...group,
	          visibleReceipts,
	          advanceMatches,
	          closuresMatch,
	        };
	      })
	      .filter(
	        (group) =>
	          group.visibleReceipts.length > 0 ||
	          (group.closures.length > 0 && (!search || group.advanceMatches || group.closuresMatch))
	      );
	  }, [auditAdvanceGroups, dianAuditSearch, dianAuditStatusFilter]);

  const latestDianAuditBatch = useMemo(
    () => dianAuditBatches.find((batch) => Array.isArray(batch.rows) && batch.rows.length > 0) || dianAuditBatches[0] || null,
    [dianAuditBatches]
  );

  const activeDianAuditRows = useMemo(
    () => latestDianAuditBatch?.rows || [],
    [latestDianAuditBatch]
  );

  const activeDianAuditFileName = latestDianAuditBatch?.fileName || '';
  const activeDianAuditRowCount = latestDianAuditBatch?.rowCount || activeDianAuditRows.length;
  const activeDianAuditCreditNoteCount = latestDianAuditBatch?.creditNoteCount ?? activeDianAuditRows.filter((row) => row.documentTypeKind === 'credit_note').length;

  const reconciliationAdvances = useMemo(
    () =>
      filteredAdvances
        .filter((advance) => advance.status === 'completed' || advance.status === 'closed' || Boolean(advance.reconciliationStatus))
        .map((advance) => ({ advance, ...getAdvanceReconciliation(advance) }))
        .sort((left, right) => {
          const leftDate = getDateValue(left.advance.completedAt || left.advance.updatedAt)?.getTime() || 0;
          const rightDate = getDateValue(right.advance.completedAt || right.advance.updatedAt)?.getTime() || 0;
          return rightDate - leftDate;
        }),
    [filteredAdvances]
  );

  const visibleReconciliationAdvances = useMemo(
    () =>
      reconciliationAdvances.filter(
        (item) => showReconciledAdvances || !isAdvanceReconciled(item.advance)
      ),
    [reconciliationAdvances, showReconciledAdvances]
  );

  const realCostAdvanceGroups = useMemo(
    () =>
      filteredAdvances
        .filter((advance) => advance.status === 'closed' && advance.reconciliationStatus === 'reconciled')
        .map((advance) => {
          const approvedReceipts = (advance.receipts || []).filter(isApprovedReceipt);
          const legalizationsTotal = approvedReceipts.reduce((sum, receipt) => sum + asNumber(receipt.amount), 0);
          const advancePayments = payments.filter(
            (payment) =>
              payment.source === 'advance_receipt' &&
              payment.status !== 'cancelled' &&
              payment.advanceId === advance.id
          );
          const paymentTotal = advancePayments.reduce((sum, payment) => sum + asNumber(payment.amount), 0);
          const realCost = paymentTotal > 0 ? paymentTotal : legalizationsTotal;
          const coverage = getAdvanceFinancialCoverage({ ...advance, amountLegalized: legalizationsTotal });

          return {
            advance,
            receipts: approvedReceipts,
            payments: advancePayments,
            legalizationsTotal,
            paymentTotal,
            realCost,
            coverage,
            costCenters: normalizeCostCenters(advance.costCenters, coverage.approved),
          };
        })
        .sort((left, right) => {
          const leftDate = getDateValue(left.advance.closedAt || left.advance.updatedAt || left.advance.createdAt)?.getTime() || 0;
          const rightDate = getDateValue(right.advance.closedAt || right.advance.updatedAt || right.advance.createdAt)?.getTime() || 0;
          return rightDate - leftDate;
        }),
    [filteredAdvances, payments]
  );

  const downloadAdvanceDossier = useCallback(
    async ({
      advance,
      reportReceipts,
      title,
      filePrefix,
      scope,
      realCost,
      accountingClosure,
    }: {
      advance: TravelAdvance;
      reportReceipts: AdvanceReceipt[];
      title: string;
      filePrefix: string;
      scope: AdvanceReportScope;
      realCost?: number;
      accountingClosure?: AdvanceAccountingClosure;
    }) => {
      const toastId = toast.loading('Preparando el expediente y anexando los soportes...');
      try {
        const includePayment = ['payment', 'justifications', 'partialClose', 'reconciliation', 'full'].includes(scope);
        const includeLegalizations = ['justifications', 'partialClose', 'reconciliation', 'full'].includes(scope);
        const includeReconciliation = scope === 'reconciliation' || scope === 'full';
        const reportGeneratedAt = accountingClosure?.createdAt || new Date();
        const closureKindLabel = accountingClosure?.kind === 'final' ? 'Cierre total' : 'Cierre parcial';
        const receiptSource = accountingClosure
          ? accountingClosure.receiptSnapshots || []
          : reportReceipts;
        const safeReportReceipts = sortAdvanceReceiptsByInvoiceDate(
          includeLegalizations
            ? accountingClosure
              ? receiptSource
              : receiptSource.filter((receipt) =>
                  scope === 'partialClose'
                  ? isAccountingAcceptedReceipt(receipt)
                  : isApprovedReceipt(receipt)
                )
            : []
        );
        const paymentSummary = getAdvancePaymentSummary(advance);
        const paymentSupports = paymentSummary.supports;
        const unavailableAttachments: string[] = [];
        const resolveProtectedSignature = async (
          path: string | undefined,
          fallback: string | undefined,
          label: string
        ) => {
          const recoverablePath = path || getStoragePathFromDownloadUrl(fallback);
          if (!recoverablePath && !fallback) return {};

          try {
            if (recoverablePath) {
              return {
                imageBlob: await getAuthorizedDownloadBlob(ref(storage, recoverablePath)),
                imageFileName: recoverablePath.split('/').pop() || `${label}.png`,
              };
            }
            return { imageUrl: fallback || '' };
          } catch (error) {
            unavailableAttachments.push(`la imagen de ${label}`);
            console.warn(`Se omitirá la imagen de ${label} del expediente:`, error);
            return fallback ? { imageUrl: fallback } : {};
          }
        };
        const resolveProtectedAttachment = async (
          path: string | undefined,
          fallback: string | undefined,
          label: string
        ) => {
          const recoverablePath = path || getStoragePathFromDownloadUrl(fallback);
          if (!recoverablePath && !fallback) return null;

          let primaryError: unknown = null;
          try {
            if (recoverablePath) {
              const blob = await getAuthorizedDownloadBlob(ref(storage, recoverablePath));
              if (blob.size === 0) throw new Error('El archivo descargado está vacío.');
              return {
                blob,
              };
            }
            return { url: fallback || '' };
          } catch (error: any) {
            primaryError = error;
          }

          // La descarga proxy es la ruta principal. Si el servidor no logra
          // transmitir un objeto de S3, intentamos una URL firmada antes de
          // concluir que el soporte no está disponible.
          if (recoverablePath) {
            try {
              const signedUrl = await getAuthorizedDownloadURL(ref(storage, recoverablePath));
              const response = await fetch(signedUrl);
              if (!response.ok) {
                throw new Error(`No se pudo descargar el soporte (${response.status}).`);
              }
              const blob = await response.blob();
              if (blob.size === 0) throw new Error('El archivo descargado está vacío.');
              return { blob };
            } catch (fallbackError) {
              console.warn(`Falló también la descarga alterna de ${label}:`, fallbackError);
            }
          }

          unavailableAttachments.push(label);
          console.warn(
            `Se omitirá ${label} del expediente porque no pudo descargarse:`,
            primaryError
          );
          return null;
        };
        const [
          requesterSignatureAsset,
          approvalSignatureAsset,
          paymentSupportAssets,
          returnSupportAsset,
          compensationSupportAsset,
          receiptSupportAssets,
        ] = await Promise.all([
          resolveProtectedSignature(
            advance.requesterSignature?.signatureStoragePath,
            advance.requesterSignature?.signatureUrl,
            'firma solicitante'
          ),
          resolveProtectedSignature(
            advance.approvalSignature?.signatureStoragePath,
            advance.approvalSignature?.signatureUrl,
            'firma aprobador'
          ),
          includePayment
            ? Promise.all(
                paymentSupports.map((support, index) =>
                  resolveProtectedAttachment(
                    support.storagePath,
                    support.fileUrl,
                    `el soporte del pago ${index + 1} del anticipo`
                  )
                )
              )
            : Promise.resolve(null),
          includeReconciliation
            ? resolveProtectedAttachment(
                advance.returnSupport?.storagePath,
                advance.returnSupport?.fileUrl,
                'el soporte de devolución'
              )
            : Promise.resolve(null),
          includeReconciliation
            ? resolveProtectedAttachment(
                advance.compensationSupport?.storagePath,
                advance.compensationSupport?.fileUrl,
                'el soporte de compensación'
              )
            : Promise.resolve(null),
          includeLegalizations
            ? Promise.all(
                safeReportReceipts.map((receipt) =>
                  resolveProtectedAttachment(
                    receipt.storagePath,
                    receipt.fileUrl,
                    `el soporte de la legalización ${receipt.categoryName}`
                  )
                )
              )
            : Promise.resolve([]),
        ]);

        const coverage = getAdvanceFinancialCoverage(advance);
        const reconciliation = getAdvanceReconciliation(advance);
        const costCenters = normalizeCostCenters(
          advance.costCenters,
          asNumber(advance.amountApproved || advance.amountRequested)
        );
        const reportLegalizationsTotal = safeReportReceipts.reduce(
          (sum, receipt) => sum + asNumber(receipt.amount),
          0
        );
        const legalizationsRows = includeLegalizations
          ? [
              ...safeReportReceipts.map((receipt, index) => {
                const documentMeta = getReceiptDocumentTypeMeta(receipt.documentType);
                const documentNumber = receipt.invoiceNumber || receipt.cufe || 'Sin número';
                const receiptCostCenter = getReceiptCostCenter(receipt, advance);
                return [
                  String(index + 1),
                  `${receipt.categoryName}\n${documentMeta.label}`,
                  receipt.businessName || 'Sin razón social',
                  formatDate(receipt.date),
                  documentNumber,
                  `${receiptCostCenter.name}${receiptCostCenter.provisional ? '\nProvisional' : ''}`,
                  receipt.fileName || `${documentMeta.shortLabel} ${documentNumber}`,
                  formatMoney(receipt.amount),
                ];
              }),
              ...(safeReportReceipts.length > 0
                ? [[
                    '',
                    'TOTAL LEGALIZACIONES ACEPTADAS',
                    '',
                    '',
                    '',
                    '',
                    `${safeReportReceipts.length} soporte${safeReportReceipts.length === 1 ? '' : 's'}`,
                    formatMoney(reportLegalizationsTotal),
                  ]]
                : []),
            ]
          : [];
        const report: AdvanceDossierReport = {
          title,
          advanceId: advance.customId || 'Sin ID contable',
          projectName: project?.name || project?.title || projectId,
	          status: (statusConfig[advance.status] || statusConfig.submitted).label,
	          generatedAt: formatDate(reportGeneratedAt),
          sections: {
            payment: includePayment,
            legalizations: includeLegalizations,
            reconciliation: includeReconciliation,
          },
          metrics:
            scope === 'advance'
              ? [
                  { label: 'Solicitado', value: formatMoney(advance.amountRequested) },
                  { label: 'Aprobado', value: formatMoney(coverage.approved) },
                  { label: 'Ítems', value: String(advance.items?.length || 0) },
                ]
              : scope === 'payment'
              ? [
                  { label: 'Solicitado', value: formatMoney(advance.amountRequested) },
                  { label: 'Aprobado', value: formatMoney(coverage.approved) },
                  { label: 'Pagado', value: formatMoney(paymentSummary.paid) },
                  { label: 'Avance pago', value: `${paymentSummary.progress}%` },
                ]
              : scope === 'justifications'
                ? [
                    { label: 'Anticipado', value: formatMoney(coverage.approved) },
                    { label: 'Justificado', value: formatMoney(getAdvanceJustifiedAmount(advance)) },
                    { label: 'Aceptado', value: formatMoney(reportLegalizationsTotal) },
                    { label: 'Saldo', value: formatMoney(Math.max(0, coverage.balance)) },
                  ]
                : scope === 'partialClose'
                  ? accountingClosure
                    ? [
                        { label: 'Anticipado', value: formatMoney(coverage.approved) },
                        { label: closureKindLabel, value: formatMoney(reportLegalizationsTotal) },
                        { label: 'Cierres previos', value: formatMoney(accountingClosure.previousClosedAmount) },
                        { label: 'Acumulado cerrado', value: formatMoney(accountingClosure.cumulativeClosedAmount) },
                        { label: 'Soportes del corte', value: String(safeReportReceipts.length) },
                      ]
                    : [
	                      { label: 'Anticipado', value: formatMoney(coverage.approved) },
	                      { label: 'Cierre parcial', value: formatMoney(reportLegalizationsTotal) },
	                      { label: 'Legalizaciones aceptadas', value: String(safeReportReceipts.length) },
	                      { label: 'Generado hasta', value: formatDate(reportGeneratedAt) },
	                    ]
                : [
                    { label: 'Anticipado', value: formatMoney(coverage.approved) },
                    { label: 'Justificado', value: formatMoney(getAdvanceJustifiedAmount(advance)) },
                    { label: 'Aceptado', value: formatMoney(reportLegalizationsTotal) },
                    { label: 'Devuelto', value: formatMoney(coverage.returnedCash) },
                    { label: 'Compensado', value: formatMoney(advance.amountCompensated) },
                    ...(realCost === undefined
                      ? [{ label: 'Saldo', value: formatMoney(Math.max(0, coverage.balance)) }]
                      : [{ label: 'Costo real', value: formatMoney(realCost) }]),
                  ],
          advanceDetails: [
            { label: 'Solicitante', value: advance.requesterName },
            { label: 'Correo', value: advance.requesterEmail || 'Sin correo' },
            { label: 'Destino', value: advance.destination },
            {
              label: 'Periodo',
              value: `${formatDate(advance.travelStart)} - ${formatDate(advance.travelEnd)}`,
            },
            { label: 'Justificación', value: advance.purpose || 'Sin justificación' },
            {
              label: 'Tareas',
              value:
                (advance.taskTitles || []).join(', ') ||
                advance.taskTitle ||
                'Sin tareas vinculadas',
            },
            {
              label: 'Observación administrativa',
              value: advance.adminComment || 'Sin observaciones',
            },
            {
              label: 'Observación de devolución',
              value: advance.returnComment || 'No aplica',
            },
          ],
          items: (advance.items || []).map((item, index) => [
            String(index + 1),
            item.categoryName,
            String(item.days),
            formatMoney(item.unitAmount),
            item.note || '-',
            formatMoney(item.amount),
          ]),
          costCenters: costCenters.map((center) => [
            center.name,
            `${center.percentage}%`,
            formatMoney(center.amount),
            center.note || '-',
          ]),
          signatures: [
            {
              role: 'Firma solicitante',
              name: advance.requesterSignature?.name || 'Pendiente',
              jobTitle: advance.requesterSignature?.jobTitle,
              email: advance.requesterSignature?.email,
              signedAt: advance.requesterSignature?.signedAt,
              ...requesterSignatureAsset,
            },
            {
              role: 'Firma aprobador',
              name: advance.approvalSignature?.name || 'Pendiente',
              jobTitle: advance.approvalSignature?.jobTitle,
              email: advance.approvalSignature?.email,
              signedAt: advance.approvalSignature?.signedAt,
              ...approvalSignatureAsset,
            },
          ],
          paymentDetails: includePayment && paymentSupports.length > 0
            ? [
                { label: 'Total pagado / abonado', value: formatMoney(paymentSummary.paid) },
                { label: 'Saldo pendiente de pago', value: formatMoney(paymentSummary.balance) },
                { label: 'Avance del pago', value: `${paymentSummary.progress}%` },
                ...paymentSupports.flatMap((support, index) => [
                  {
                    label: `${support.kind === 'partial' ? 'Abono' : support.kind === 'final' ? 'Pago final' : 'Pago'} ${index + 1}`,
                    value: `${formatMoney(support.amount)} · ${formatDate(support.date)}${support.reference ? ` · Ref. ${support.reference}` : ''}`,
                  },
                  {
                    label: `Registrado por ${index + 1}`,
                    value: support.paidByName || 'Sin responsable',
                  },
                ]),
              ]
            : [],
          legalizationPresenterDetails: includeLegalizations ? [
            { label: 'Presentado por', value: advance.requesterName || 'Sin solicitante' },
            { label: 'Correo', value: advance.requesterEmail || 'Sin correo' },
            {
              label: 'Cargo',
              value: advance.requesterSignature?.jobTitle || 'Sin cargo registrado',
            },
            { label: 'Destino', value: advance.destination || 'Sin destino' },
            {
              label: 'Periodo',
              value: `${formatDate(advance.travelStart)} - ${formatDate(advance.travelEnd)}`,
            },
	            { label: 'Proyecto', value: project?.name || project?.title || projectId },
	            ...(accountingClosure
	              ? [
	                  {
	                    label: 'Cierre contable',
	                    value: `${closureKindLabel} No. ${accountingClosure.sequence}`,
	                  },
	                  {
	                    label: 'Fecha del cierre',
	                    value: formatDate(accountingClosure.createdAt),
	                  },
	                  {
	                    label: 'Cierres anteriores',
	                    value: formatMoney(accountingClosure.previousClosedAmount),
	                  },
	                  {
	                    label: 'Acumulado con este cierre',
	                    value: formatMoney(accountingClosure.cumulativeClosedAmount),
	                  },
	                ]
	              : []),
	          ] : [],
	          legalizationSummary: includeLegalizations ? [
	            {
	              label: accountingClosure
	                ? `Total ${closureKindLabel.toLowerCase()}`
	                : scope === 'partialClose'
	                  ? 'Total cierre parcial'
	                  : 'Total legalizaciones aceptadas',
	              value: formatMoney(reportLegalizationsTotal),
	            },
	            { label: 'Soportes incluidos', value: String(safeReportReceipts.length) },
	            { label: 'Corte', value: formatDate(reportGeneratedAt) },
	            ...(accountingClosure
	              ? [
	                  { label: 'Cierres previos', value: formatMoney(accountingClosure.previousClosedAmount) },
	                  { label: 'Acumulado cerrado', value: formatMoney(accountingClosure.cumulativeClosedAmount) },
	                  { label: 'Pendiente aceptado sin cerrar', value: formatMoney(accountingClosure.pendingAcceptedAmount) },
	                ]
	              : []),
	          ] : [],
          legalizations: legalizationsRows,
          reconciliationDetails: includeReconciliation ? [
            {
              label: 'Estado',
              value: advance.reconciliationStatus === 'reconciled' ? 'Conciliado' : 'Pendiente',
            },
            {
              label: 'Fecha de cierre',
              value: formatDate(advance.reconciledAt || advance.closedAt),
            },
            { label: 'Anticipado', value: formatMoney(reconciliation.anticipated) },
            { label: 'Legalizado', value: formatMoney(reconciliation.legalized) },
            {
              label: 'Por devolver / consignar',
              value: formatMoney(reconciliation.returnRequired),
            },
            {
              label: 'Por compensar',
              value: formatMoney(reconciliation.compensationRequired),
            },
            {
              label: 'Conciliado por',
              value: advance.reconciledByName || 'Pendiente',
            },
          ] : [],
          paymentAttachments:
            includePayment && Array.isArray(paymentSupportAssets)
              ? paymentSupports.flatMap((support, index) => {
                  const asset = paymentSupportAssets[index];
                  return asset
                    ? [{
                        label: `${support.kind === 'partial' ? 'Soporte de abono' : support.kind === 'final' ? 'Soporte de pago final' : 'Soporte del pago'} ${index + 1}`,
                        description: `${formatMoney(support.amount)} - ${formatDate(support.date)}${support.reference ? ` - Referencia ${support.reference}` : ''}`,
                        fileName: support.fileName || `soporte-pago-${index + 1}`,
                        ...asset,
                      }]
                    : [];
                })
              : [],
          legalizationAttachments: includeLegalizations
            ? safeReportReceipts.flatMap((receipt, index) => {
                const asset = receiptSupportAssets[index];
                return asset
                  ? [{
                      label: `Soporte de legalización ${index + 1}`,
                      description: `${receipt.categoryName} - ${receipt.businessName || 'Sin razón social'} - ${receipt.invoiceNumber || receipt.cufe || 'Sin número'} - ${formatMoney(receipt.amount)}`,
                      fileName: receipt.fileName || `soporte-legalizacion-${index + 1}`,
                      ...asset,
                    }]
                  : [];
              })
            : [],
          reconciliationAttachments: includeReconciliation ? [
            ...(advance.returnSupport && returnSupportAsset
              ? [
                  {
                    label: 'Soporte de conciliación - devolución / consignación bancaria',
                    description: `Consignación por ${formatMoney(advance.returnSupport.amount)} - ${formatDate(advance.returnSupport.date)}${advance.returnSupport.reference ? ` - Referencia ${advance.returnSupport.reference}` : ''}`,
                    fileName: advance.returnSupport.fileName || 'soporte-devolucion',
                    ...returnSupportAsset,
                  },
                ]
              : []),
            ...(advance.compensationSupport && compensationSupportAsset
              ? [
                  {
                    label: 'Soporte de conciliación - compensación',
                    description: `Compensación por ${formatMoney(advance.compensationSupport.amount)} - ${formatDate(advance.compensationSupport.date)}${advance.compensationSupport.reference ? ` - Referencia ${advance.compensationSupport.reference}` : ''}`,
                    fileName: advance.compensationSupport.fileName || 'soporte-compensacion',
                    ...compensationSupportAsset,
                  },
                ]
              : []),
          ] : [],
        };

        const {
          bytes: pdfBytes,
          omittedAttachments: invalidAttachments,
        } = await generateAdvanceDossierPdf(report);
        const omittedAttachments = Array.from(
          new Set([...unavailableAttachments, ...invalidAttachments])
        );
        const pdfArrayBuffer = pdfBytes.buffer.slice(
          pdfBytes.byteOffset,
          pdfBytes.byteOffset + pdfBytes.byteLength
        ) as ArrayBuffer;
        downloadBlob(
          `${filePrefix}-${getSafeFileToken(advance.customId || advance.id)}.pdf`,
          new Blob([pdfArrayBuffer], { type: 'application/pdf' })
        );
        toast.success(
          omittedAttachments.length > 0
            ? `Reporte PDF generado. Se omitieron ${omittedAttachments.length} archivo${omittedAttachments.length === 1 ? '' : 's'} no disponible${omittedAttachments.length === 1 ? '' : 's'} o dañado${omittedAttachments.length === 1 ? '' : 's'}.`
            : 'Reporte PDF generado con los documentos seleccionados.',
          { id: toastId }
        );
      } catch (error: any) {
        console.error('Error generating advance dossier PDF:', error);
        toast.error(error?.message || 'No se pudo generar el expediente PDF.', { id: toastId });
      }
    },
    [project, projectId]
  );

  const downloadAdvanceReportOption = useCallback(
    async (
      advance: TravelAdvance,
      scope: AdvanceReportScope,
      realCost?: number
    ) => {
      if (!getAdvanceReportAvailability(advance)[scope]) {
        toast.error('Este informe se habilitará cuando el anticipo complete la etapa correspondiente.');
        return;
      }

      const accountingClosures = getAdvanceAccountingClosures(advance);
      const latestAccountingClosure = accountingClosures[accountingClosures.length - 1];
      const reportGeneratedAt = new Date().toISOString();
      const receiptsForReport =
        scope === 'partialClose'
          ? (advance.receipts || []).map((receipt) =>
              promoteReceiptFromCurrentDianBase(receipt, activeDianAuditRows, {
                batchId: latestDianAuditBatch?.id,
                batchName: activeDianAuditFileName,
                now: reportGeneratedAt,
                includeRevision: false,
              })
            )
          : advance.receipts || [];
      const advanceForReport = { ...advance, receipts: receiptsForReport };
      const closureForReport =
        scope === 'partialClose' && getUnclosedAccountingAcceptedReceipts(advanceForReport).length === 0
          ? latestAccountingClosure
          : undefined;
      const reportReceipts =
        scope === 'advance' || scope === 'payment'
          ? []
          : closureForReport
            ? closureForReport.receiptSnapshots || []
          : receiptsForReport.filter((receipt) =>
              scope === 'partialClose'
                ? isAccountingAcceptedReceipt(receipt) && !getClosedAccountingReceiptIds(advanceForReport).has(receipt.id)
                : isApprovedReceipt(receipt)
            );
      if (scope === 'partialClose' && reportReceipts.length === 0 && !closureForReport) {
        toast.info('No hay facturas nuevas para cierre parcial. Consulta los cierres históricos del anticipo.');
        return;
      }
      const reportMeta = {
        advance: {
          title: 'Informe del anticipo',
          filePrefix: 'anticipo',
        },
        payment: {
          title: 'Anticipo y soporte de pago',
          filePrefix: 'anticipo-con-pago',
        },
        justifications: {
          title: 'Anticipo, pago y legalizaciones',
          filePrefix: 'anticipo-con-legalizaciones',
        },
        partialClose: {
          title: closureForReport?.title || 'Cierre parcial del anticipo',
          filePrefix: closureForReport?.kind === 'final' ? 'cierre-total-anticipo' : 'cierre-parcial-anticipo',
        },
        reconciliation: {
          title: 'Anticipo y conciliación',
          filePrefix: 'anticipo-con-conciliacion',
        },
        full: {
          title: 'Informe final del anticipo',
          filePrefix: 'informe-final-anticipo',
        },
      }[scope];

      await downloadAdvanceDossier({
        advance,
        reportReceipts,
        title: reportMeta.title,
        filePrefix: reportMeta.filePrefix,
        scope,
        realCost,
        accountingClosure: closureForReport,
      });
    },
    [activeDianAuditFileName, activeDianAuditRows, downloadAdvanceDossier, latestDianAuditBatch]
  );

  const currentActorIds = useMemo(() => {
    const ids = new Set<string>();
    if (currentUser?.uid) ids.add(String(currentUser.uid));
    const currentEmail = String(currentUser?.email || '').toLowerCase();
    teamMembers.forEach((member) => {
      const memberEmail = String(member?.email || '').toLowerCase();
      if (
        member?.id === currentUser?.uid ||
        member?.authUserId === currentUser?.uid ||
        (currentEmail && memberEmail === currentEmail)
      ) {
        if (member?.id) ids.add(String(member.id));
        if (member?.authUserId) ids.add(String(member.authUserId));
      }
    });
    return ids;
  }, [currentUser?.email, currentUser?.uid, teamMembers]);

  const currentSignerMember = useMemo(() => {
    const currentEmail = String(currentUser?.email || '').trim().toLowerCase();
    return contractorApprovalPeople.find((member) => {
      const memberEmail = String(member?.email || '').trim().toLowerCase();
      return (
        member?.id === currentUser?.uid ||
        member?.authUserId === currentUser?.uid ||
        Boolean(currentEmail && memberEmail === currentEmail)
      );
    }) || null;
  }, [contractorApprovalPeople, currentUser?.email, currentUser?.uid]);
  const currentSignerProfile = useMemo(() => {
    const currentEmail = String(currentUser?.email || '').trim().toLowerCase();
    const profileEmail = String(currentUserProfile?.email || '').trim().toLowerCase();
    const profileMatchesCurrentUser = Boolean(
      currentUserProfile &&
      (
        currentUserProfile.id === currentUser?.uid ||
        currentUserProfile.uid === currentUser?.uid ||
        currentUserProfile.authUserId === currentUser?.uid ||
        (currentEmail && profileEmail === currentEmail)
      )
    );

    if (!currentSignerMember) {
      if (!profileMatchesCurrentUser) return null;
      return {
        ...currentUserProfile,
        id: currentUserProfile?.id || currentUser?.uid,
        authUserId: currentUserProfile?.authUserId || currentUserProfile?.uid || currentUser?.uid,
        email: currentUserProfile?.email || currentUser?.email || '',
      };
    }

    if (!profileMatchesCurrentUser) return currentSignerMember;

    return {
      ...currentUserProfile,
      ...currentSignerMember,
      authUserId: currentSignerMember.authUserId || currentUserProfile?.authUserId || currentUserProfile?.uid || currentUser?.uid,
      signatureUrl: currentSignerMember.signatureUrl || currentUserProfile?.signatureUrl || null,
      signatureStoragePath: currentSignerMember.signatureStoragePath || currentUserProfile?.signatureStoragePath || null,
      roleName: currentSignerMember.roleName || currentUserProfile?.roleName || currentUserProfile?.position || currentUserProfile?.jobTitle || null,
      position: currentSignerMember.position || currentUserProfile?.position || currentUserProfile?.jobTitle || null,
      jobTitle: currentSignerMember.jobTitle || currentUserProfile?.jobTitle || currentUserProfile?.position || null,
      displayName: currentSignerMember.displayName || currentUserProfile?.displayName || currentUserProfile?.name || null,
      name: currentSignerMember.name || currentUserProfile?.name || currentUserProfile?.displayName || null,
      email: currentSignerMember.email || currentUserProfile?.email || currentUser?.email || '',
    };
  }, [currentSignerMember, currentUser?.email, currentUser?.uid, currentUserProfile]);

  const canGlobalAdminReassignContractorAccounts = canGlobalAdminManageContractorAccounts;
  const contractorMemberOptions = useMemo(() => {
    const seen = new Set<string>();
    return teamMembers
      .filter((member) => {
        const key = String(member?.id || member?.authUserId || member?.email || '').trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((left, right) => getMemberLabel(left).localeCompare(getMemberLabel(right), 'es', { sensitivity: 'base' }));
  }, [teamMembers]);
  const getContractorMemberOptionId = useCallback((member: any) =>
    String(member?.id || member?.authUserId || member?.email || '').trim(),
    []
  );
  const findContractorMemberById = useCallback((memberId: string) => {
    const normalized = String(memberId || '').trim().toLowerCase();
    if (!normalized) return null;
    return contractorApprovalPeople.find((member) => {
      return [
        member?.id,
        member?.authUserId,
        member?.uid,
        member?.userId,
        member?.memberId,
        member?.email,
      ].some((value) => String(value || '').trim().toLowerCase() === normalized);
    }) || null;
  }, [contractorApprovalPeople]);
  const getContractorApproverLabel = useCallback((account: ContractorPaymentRequest) => {
    if (account.status === 'paid' || account.status === 'rejected') return 'Flujo finalizado';
    const approverId = account.status === 'returned'
      ? getContractorAccountConfiguredApproverId('submitted')
      : getContractorAccountOwnerId(account);
    const member = approverId ? findContractorMemberById(approverId) : null;
    return member
      ? getMemberLabel(member)
      : approverId
        ? 'Responsable configurado'
        : account.status === 'returned'
          ? 'Sin jefe inmediato configurado'
          : 'Sin responsable configurado';
  }, [findContractorMemberById, getContractorAccountConfiguredApproverId, getContractorAccountOwnerId]);
  const selectedContractorMember = useMemo(() => {
    if (!canGlobalAdminReassignContractorAccounts) return currentSignerProfile;
    return findContractorMemberById(selectedContractorMemberId) || currentSignerProfile;
  }, [canGlobalAdminReassignContractorAccounts, currentSignerProfile, findContractorMemberById, selectedContractorMemberId]);

  const nextContractorAccountConsecutive = useMemo(() => {
    const year = new Date().getFullYear();
    const highest = contractorAccounts.reduce((current, account) => {
      const match = String(account.customId || '').match(/(\d+)$/);
      return match ? Math.max(current, Number(match[1]) || 0) : current;
    }, 0);
    return `CC-${year}-${String(highest + 1).padStart(4, '0')}`;
  }, [contractorAccounts]);

  const selectedContractorBankAccounts = useMemo(() => {
    const accounts = selectedContractorProfile?.bankAccounts || selectedContractorMember?.bankAccounts || [];
    return Array.isArray(accounts)
      ? accounts.filter((account: any) => account?.id && account?.bankName && account?.accountNumber) as ContractorBankAccount[]
      : [];
  }, [selectedContractorMember, selectedContractorProfile]);

  useEffect(() => {
    if (!isContractorAccountModalOpen) return;
    if (canGlobalAdminReassignContractorAccounts) {
      if (!selectedContractorMemberId && currentSignerProfile) {
        setSelectedContractorMemberId(getContractorMemberOptionId(currentSignerProfile));
      }
      return;
    }
    setSelectedContractorMemberId(currentSignerProfile ? getContractorMemberOptionId(currentSignerProfile) : '');
  }, [
    canGlobalAdminReassignContractorAccounts,
    currentSignerProfile,
    getContractorMemberOptionId,
    isContractorAccountModalOpen,
    selectedContractorMemberId,
  ]);

  useEffect(() => {
    if (!isContractorAccountModalOpen || !selectedContractorMember) return;

    let active = true;
    const loadSelectedProfile = async () => {
      const profileId = String(
        selectedContractorMember.authUserId ||
        selectedContractorMember.uid ||
        selectedContractorMember.userId ||
        selectedContractorMember.id ||
        ''
      ).trim();
      let profile: any = null;
      try {
        if (profileId) {
          const snapshot = await getDoc(doc(db, 'users', profileId));
          if (snapshot.exists()) profile = { ...snapshot.data(), id: snapshot.id };
        }
        if (!profile && selectedContractorMember.email) {
          const emailSnapshot = await getDocs(
            query(collection(db, 'users'), where('email', '==', selectedContractorMember.email))
          );
          const first = emailSnapshot.docs[0];
          if (first) profile = { ...first.data(), id: first.id };
        }
      } catch (error) {
        console.warn('No se pudo cargar el perfil contractual del usuario seleccionado:', error);
      }
      if (!active) return;
      const mergedProfile = { ...selectedContractorMember, ...(profile || {}) };
      setSelectedContractorProfile(profile ? mergedProfile : selectedContractorMember);
      const bankAccounts = Array.isArray(mergedProfile.bankAccounts) ? mergedProfile.bankAccounts : [];
      const preferredBank = bankAccounts.find((account: ContractorBankAccount) => account.isDefault) || bankAccounts[0];
      setContractorAccountForm((current) => ({
        ...current,
        issueCity: current.issueCity || mergedProfile.city || '',
        contractorIdentificationType: current.contractorIdentificationType || mergedProfile.identificationType || 'CC',
        contractorIdentificationNumber: current.contractorIdentificationNumber || mergedProfile.identificationNumber || mergedProfile.documentNumber || '',
        contractorPhone: current.contractorPhone || mergedProfile.phone || mergedProfile.mobile || '',
        contractorAddress: current.contractorAddress || mergedProfile.address || '',
        contractorCity: current.contractorCity || mergedProfile.city || '',
        bankAccountId: current.bankAccountId || preferredBank?.id || '',
        bankName: current.bankName || preferredBank?.bankName || '',
        bankAccountType: current.bankAccountType || preferredBank?.accountType || 'Ahorros',
        bankAccountNumber: current.bankAccountNumber || preferredBank?.accountNumber || '',
        concept: current.concept || `Servicios profesionales prestados como ${getMemberRoleLabel(selectedContractorMember)} en el proyecto ${project?.name || 'Pixel'}, durante el periodo indicado.`,
      }));
    };
    void loadSelectedProfile();
    return () => {
      active = false;
    };
  }, [isContractorAccountModalOpen, project?.name, selectedContractorMember]);

  const buildMemberSignatureSnapshot = useCallback((member: any): AdvanceSignatureSnapshot | null => {
    if (!member?.signatureUrl) return null;
    return {
      signatureUrl: member.signatureUrl,
      signatureStoragePath: member.signatureStoragePath || undefined,
      signerUserId: String(member.authUserId || member.uid || member.id || currentUser?.uid || ''),
      signerMemberId: member.id ? String(member.id) : undefined,
      name: getMemberLabel(member) || getCurrentUserName(currentUser),
      email: String(member.email || currentUser?.email || ''),
      jobTitle: getMemberRoleLabel(member),
      signedAt: new Date().toISOString(),
    };
  }, [currentUser]);

  const buildCurrentSignatureSnapshot = useCallback((): AdvanceSignatureSnapshot | null => {
    if (!currentUser?.uid || !currentSignerProfile?.signatureUrl) return null;
    return {
      signatureUrl: currentSignerProfile.signatureUrl,
      signatureStoragePath: currentSignerProfile.signatureStoragePath || undefined,
      signerUserId: String(currentUser.uid),
      signerMemberId: currentSignerProfile.id ? String(currentSignerProfile.id) : undefined,
      name: getMemberLabel(currentSignerProfile) || getCurrentUserName(currentUser),
      email: String(currentSignerProfile.email || currentUser.email || ''),
      jobTitle: String(
        currentSignerProfile.roleName ||
        currentSignerProfile.position ||
        currentSignerProfile.jobTitle ||
        currentSignerProfile.profileRole ||
        currentSignerProfile.systemRole ||
        'Sin cargo configurado'
      ),
      signedAt: new Date().toISOString(),
    };
  }, [currentSignerProfile, currentUser]);

  const getApprovalSignatureForAdvance = useCallback((advance: TravelAdvance): AdvanceSignatureSnapshot | null => {
    if (advance.status === 'returned' && advance.approvalSignature) {
      return advance.approvalSignature;
    }
    return buildCurrentSignatureSnapshot();
  }, [buildCurrentSignatureSnapshot]);

  const currentContractorTokens = useMemo(() => {
    const tokens = new Set<string>();
    const add = (value: any) => {
      if (value === undefined || value === null || value === '') return;
      tokens.add(String(value).trim().toLowerCase());
    };
    if (selectedContractorMember) {
      add(selectedContractorMember.id);
      add(selectedContractorMember.authUserId);
      add(selectedContractorMember.uid);
      add(selectedContractorMember.userId);
      add(selectedContractorMember.memberId);
      add(selectedContractorMember.email);
      add(selectedContractorMember.displayName);
      add(selectedContractorMember.name);
    } else {
      add(currentUser?.uid);
      add(currentUser?.email);
      add(getCurrentUserName(currentUser));
    }
    return tokens;
  }, [currentUser, selectedContractorMember]);

  const contractorUsedActivityKeys = useMemo(() => {
    const used = new Set<string>();
    contractorAccounts
      .filter((account) => account.id !== editingContractorAccount?.id && !['rejected'].includes(account.status))
      .forEach((account) => {
        if (Array.isArray(account.activityKeys) && account.activityKeys.length > 0) {
          account.activityKeys.forEach((key) => used.add(String(key)));
          return;
        }
        if (Array.isArray(account.activityItems) && account.activityItems.length > 0) {
          account.activityItems.forEach((activity) => activity?.key && used.add(String(activity.key)));
          return;
        }
        (account.taskIds || []).forEach((taskId) => used.add(`task:${taskId}`));
      });
    return used;
  }, [contractorAccounts, editingContractorAccount?.id]);

  const contractorPeriodActivities = useMemo(() => {
    const start = contractorAccountForm.periodStart;
    const end = contractorAccountForm.periodEnd;
    if (!start || !end) return [];

    return contractorBillableActivities
      .filter((activity) => {
        if (!activity?.key || contractorUsedActivityKeys.has(String(activity.key))) return false;
        const activityTokens = (activity as any).actorTokens as Set<string> | undefined;
        const matchesContractor =
          !activityTokens || activityTokens.size === 0
            ? false
            : Array.from(currentContractorTokens).some((token) => activityTokens.has(token));
        if (!matchesContractor) return false;
        if (!isCompletedTaskStatus(getActivityStatus(activity))) return false;
        return isDateWithinRange(activity.date, start, end);
      })
      .sort((left, right) => {
        const leftDate = getDateValue(left.date)?.getTime() || 0;
        const rightDate = getDateValue(right.date)?.getTime() || 0;
        return rightDate - leftDate || left.taskTitle.localeCompare(right.taskTitle, 'es', { sensitivity: 'base' });
      });
  }, [contractorAccountForm.periodEnd, contractorAccountForm.periodStart, contractorBillableActivities, contractorUsedActivityKeys, currentContractorTokens]);

  const filteredContractorPeriodActivities = useMemo(() => {
    const search = normalizeTaskSearchText(advanceTaskSearch);
    return contractorPeriodActivities.filter((activity) => {
      const statusMeta = getTaskStatusMeta({ status: activity.status });
      const isActive = !['completed', 'cancelled'].includes(statusMeta.key);
      if (advanceTaskStatusFilter === 'active' && !isActive) return false;
      if (advanceTaskStatusFilter !== 'active' && advanceTaskStatusFilter !== 'all' && statusMeta.key !== advanceTaskStatusFilter) {
        return false;
      }
      if (advanceTaskGroupFilter !== 'all' && activity.groupId !== advanceTaskGroupFilter) return false;
      if (!search) return true;
      return normalizeTaskSearchText([
        activity.taskTitle,
        activity.rootTaskTitle,
        activity.stepLabel,
        activity.taskId,
        activity.parentTaskId,
        activity.groupName,
      ].filter(Boolean).join(' ')).includes(search);
    });
  }, [advanceTaskGroupFilter, advanceTaskSearch, advanceTaskStatusFilter, contractorPeriodActivities]);

  const selectedContractorActivities = useMemo(
    () => contractorBillableActivities.filter((activity) => contractorAccountForm.activityKeys.includes(activity.key)),
    [contractorAccountForm.activityKeys, contractorBillableActivities]
  );

  const contractorRateCardById = useMemo(
    () => new Map(contractorRateCards.map((card) => [String(card.id), card])),
    [contractorRateCards]
  );

  const contractorPeriodRateSummary = useMemo(() => {
    const rowsByRate = new Map<string, ContractorRateSnapshot['rows'][number]>();
    const summary = contractorRateEntries.reduce((currentSummary, entry) => {
      const assignedTo = String(entry?.assignedTo || entry?.userId || entry?.memberId || '').trim().toLowerCase();
      if (!assignedTo || !currentContractorTokens.has(assignedTo)) return currentSummary;
      if (!isDateWithinRange(entry?.date || entry?.dateKey || entry?.createdAt, contractorAccountForm.periodStart, contractorAccountForm.periodEnd)) return currentSummary;
      const rateCard = contractorRateCardById.get(String(entry?.rateCardId || ''));
      if (!rateCard) return currentSummary;
      const units = Math.abs(normalizeDecimalInput(entry?.units ?? entry?.amount ?? entry?.quantity, 0));
      const income = getRateCardIncomeValue(units, rateCard);
      const cost = getRateCardCostValue(units, rateCard);
      const rateCardId = String(entry.rateCardId || 'sin-rate');
      const row = rowsByRate.get(rateCardId) || {
        rateCardId,
        name: getRateCardName(rateCard, rateCardId),
        units: 0,
        income: 0,
        cost: 0,
        margin: 0,
        movements: 0,
        unitLabel: rateCard?.indicator || rateCard?.unitLabel || rateCard?.inputUnit || 'unidad',
      };
      row.units += units;
      row.income += income;
      row.cost += cost;
      row.margin = row.income - row.cost;
      row.movements += 1;
      rowsByRate.set(rateCardId, row);
      currentSummary.income += income;
      currentSummary.cost += cost;
      currentSummary.movements += 1;
      return currentSummary;
    }, { income: 0, cost: 0, movements: 0 });
    return {
      income: roundCurrency(summary.income),
      cost: roundCurrency(summary.cost),
      margin: roundCurrency(summary.income - summary.cost),
      movements: summary.movements,
      rows: [...rowsByRate.values()]
        .map((row) => ({ ...row, income: roundCurrency(row.income), cost: roundCurrency(row.cost), margin: roundCurrency(row.margin), units: roundCurrency(row.units) }))
        .sort((left, right) => Math.abs(right.income) - Math.abs(left.income) || right.movements - left.movements),
    };
  }, [contractorAccountForm.periodEnd, contractorAccountForm.periodStart, contractorRateCardById, contractorRateEntries, currentContractorTokens]);

  const contractorPerformanceSnapshot = useMemo((): ContractorPerformanceSnapshot => {
    const completedOnTime = selectedContractorActivities.filter((activity) => activity.timing === 'on_time').length;
    const completedLate = selectedContractorActivities.filter((activity) => activity.timing === 'late').length;
    const completedWithoutSchedule = selectedContractorActivities.filter((activity) => activity.timing === 'without_schedule').length;
    const endBoundary = contractorAccountForm.periodEnd;
    const today = todayInputValue();
    const openOverdueActivities = contractorBillableActivities.filter((activity) => {
      const activityTokens = (activity as any).actorTokens as Set<string> | undefined;
      if (!activityTokens || !Array.from(currentContractorTokens).some((token) => activityTokens.has(token))) return false;
      if (isCompletedTaskStatus(getActivityStatus(activity))) return false;
      if (!activity.dueDate || activity.dueDate > endBoundary || activity.dueDate >= today) return false;
      return activity.dueDate >= contractorAccountForm.periodStart;
    });
    const lateAlerts = selectedContractorActivities
      .filter((activity) => activity.timing === 'late')
      .map((activity) => ({
        key: activity.key,
        taskTitle: activity.taskTitle,
        stepLabel: activity.stepLabel,
        kind: 'completed_late' as const,
        dueDate: activity.dueDate,
        completedAt: activity.completedAt || activity.date,
        daysLate: activity.daysLate || 0,
      }));
    const overdueAlerts = openOverdueActivities.map((activity) => ({
      key: activity.key,
      taskTitle: activity.taskTitle,
      stepLabel: activity.stepLabel,
      kind: 'open_overdue' as const,
      dueDate: activity.dueDate,
      completedAt: activity.completedAt,
      daysLate: getCalendarDaysLate(new Date(), activity.dueDate),
    }));
    return {
      selectedCompleted: selectedContractorActivities.length,
      completedOnTime,
      completedLate,
      completedWithoutSchedule,
      openOverdue: openOverdueActivities.length,
      alerts: [...overdueAlerts, ...lateAlerts]
        .sort((left, right) => right.daysLate - left.daysLate)
        .slice(0, 30),
    };
  }, [
    contractorAccountForm.periodEnd,
    contractorAccountForm.periodStart,
    contractorBillableActivities,
    currentContractorTokens,
    selectedContractorActivities,
  ]);

  const contractorProductivityComparison = useMemo((): ContractorProductivityComparison => {
    const roleLabel = getMemberRoleLabel(selectedContractorMember);
    const normalizedRole = normalizeTaskSearchText(roleLabel);
    const comparableMembers = teamMembers.filter(
      (member) => normalizeTaskSearchText(getMemberRoleLabel(member)) === normalizedRole
    );
    const members = comparableMembers.length > 0
      ? comparableMembers
      : selectedContractorMember
        ? [selectedContractorMember]
        : [];
    const memberRows = members.map((member) => ({
      member,
      memberId: String(member?.id || member?.authUserId || member?.email || getMemberLabel(member)),
      name: getMemberLabel(member),
      tokens: buildMemberIdentityTokens(member),
      isContractor: contractorTokensMatch(currentContractorTokens, member),
    }));
    const rows = contractorPeriodRateSummary.rows.map((contractorRate) => {
      const professionals = memberRows.map((memberRow) => {
        const units = contractorRateEntries.reduce((sum, entry) => {
          if (String(entry?.rateCardId || '') !== contractorRate.rateCardId) return sum;
          if (entry?.isRework) return sum;
          if (!isDateWithinRange(entry?.date || entry?.dateKey || entry?.createdAt, contractorAccountForm.periodStart, contractorAccountForm.periodEnd)) return sum;
          if (!contractorTokensMatch(memberRow.tokens, entry?.assignedTo || entry?.userId || entry?.memberId)) return sum;
          return sum + Math.abs(normalizeDecimalInput(entry?.units ?? entry?.amount ?? entry?.quantity, 0));
        }, 0);
        return {
          memberId: memberRow.memberId,
          name: memberRow.name,
          units: roundCurrency(units),
          isContractor: memberRow.isContractor,
        };
      }).sort((left, right) => right.units - left.units || left.name.localeCompare(right.name, 'es', { sensitivity: 'base' }));
      const contractorIndex = professionals.findIndex((professional) => professional.isContractor);
      const contractorUnits = contractorIndex >= 0 ? professionals[contractorIndex].units : contractorRate.units;
      const peerValues = professionals.filter((professional) => !professional.isContractor).map((professional) => professional.units);
      const peerAverageUnits = peerValues.length > 0
        ? roundCurrency(peerValues.reduce((sum, units) => sum + units, 0) / peerValues.length)
        : 0;
      return {
        rateCardId: contractorRate.rateCardId,
        name: contractorRate.name,
        unitLabel: contractorRate.unitLabel || 'unidad',
        contractorUnits,
        peerAverageUnits,
        peerTopUnits: peerValues.length > 0 ? Math.max(...peerValues) : 0,
        contractorRank: contractorIndex >= 0 ? contractorIndex + 1 : 1,
        professionalCount: professionals.length || 1,
        deltaVsAveragePct: peerAverageUnits > 0
          ? Math.round(((contractorUnits - peerAverageUnits) / peerAverageUnits) * 100)
          : null,
        professionals: professionals.length > 0
          ? professionals
          : [{
              memberId: String(selectedContractorMember?.id || currentUser?.uid || 'contratista'),
              name: getMemberLabel(selectedContractorMember) || getCurrentUserName(currentUser),
              units: contractorUnits,
              isContractor: true,
            }],
      };
    });
    return {
      roleLabel,
      peerCount: Math.max(0, memberRows.length - 1),
      rows,
    };
  }, [
    contractorAccountForm.periodEnd,
    contractorAccountForm.periodStart,
    contractorPeriodRateSummary.rows,
    contractorRateEntries,
    currentContractorTokens,
    currentUser,
    selectedContractorMember,
    teamMembers,
  ]);

  const contractorPeriodQualityEvents = useMemo(() => {
    return contractorQualityEvents
      .filter((event) => {
        if (!isDateWithinRange(event.createdAt || event.dateKey, contractorAccountForm.periodStart, contractorAccountForm.periodEnd)) return false;
        return contractorTokensMatch(currentContractorTokens, event.professionalId || event.sourceStepAssignee || event.assigneeId || event.memberId || event.userId);
      })
      .sort((left, right) => (getDateValue(right.createdAt || right.dateKey)?.getTime() || 0) - (getDateValue(left.createdAt || left.dateKey)?.getTime() || 0));
  }, [contractorAccountForm.periodEnd, contractorAccountForm.periodStart, contractorQualityEvents, currentContractorTokens]);

  const contractorQualitySnapshot = useMemo(
    () => summarizeContractorQuality(contractorPeriodQualityEvents),
    [contractorPeriodQualityEvents]
  );

  const contractorActivitySnapshot = useMemo(
    () => summarizeContractorActivities(selectedContractorActivities, contractorPeriodRateSummary),
    [contractorPeriodRateSummary, selectedContractorActivities]
  );

  const downloadContractorAccountReport = useCallback(async (
    account: ContractorPaymentRequest,
    kind: ContractorDownloadKind
  ) => {
    const accountMember = teamMembers.find((member) => {
      const accountEmail = String(account.contractorEmail || '').trim().toLowerCase();
      const memberEmail = String(member?.email || '').trim().toLowerCase();
      return (
        String(member?.id || '') === String(account.contractorId || '') ||
        String(member?.authUserId || '') === String(account.contractorId || '') ||
        Boolean(accountEmail && accountEmail === memberEmail)
      );
    }) || null;
    const accountTokens = buildMemberIdentityTokens(accountMember);
    [account.contractorId, account.contractorEmail, account.contractorName].forEach((value) => {
      if (value) accountTokens.add(String(value).trim().toLowerCase());
    });
    const liveActivityByKey = new Map(contractorBillableActivities.map((activity) => [activity.key, activity]));
    const storedActivities: ContractorAccountActivityItem[] = (account.activityItems || []).length > 0
      ? account.activityItems || []
      : (account.taskTitles || []).map((taskTitle, index) => ({
          key: `legacy-${index}`,
          type: 'task' as const,
          taskId: account.taskIds?.[index] || '',
          taskTitle,
          status: 'completed',
        }));
    const enrichedActivities = storedActivities.map((stored) => {
      const live = liveActivityByKey.get(stored.key);
      return {
        ...(live || {}),
        ...stored,
        completedAt: stored.completedAt || live?.completedAt,
        dueDate: stored.dueDate || live?.dueDate,
        timing: stored.timing || live?.timing,
        daysLate: stored.daysLate ?? live?.daysLate,
        description: stored.description || live?.description,
        executionDetail: stored.executionDetail || live?.executionDetail,
      } as ContractorAccountActivityItem;
    });

    const fallbackRateSnapshot = (() => {
      const rowsByRate = new Map<string, ContractorRateSnapshot['rows'][number]>();
      const totals = { income: 0, cost: 0, movements: 0 };
      contractorRateEntries.forEach((entry) => {
        if (!contractorTokensMatch(accountTokens, entry?.assignedTo || entry?.userId || entry?.memberId)) return;
        if (!isDateWithinRange(entry?.date || entry?.dateKey || entry?.createdAt, account.periodStart, account.periodEnd)) return;
        const rateCardId = String(entry?.rateCardId || '');
        const rateCard = contractorRateCardById.get(rateCardId);
        if (!rateCard) return;
        const units = Math.abs(normalizeDecimalInput(entry?.units ?? entry?.amount ?? entry?.quantity, 0));
        const income = getRateCardIncomeValue(units, rateCard);
        const cost = getRateCardCostValue(units, rateCard);
        const row = rowsByRate.get(rateCardId) || {
          rateCardId,
          name: getRateCardName(rateCard, rateCardId),
          units: 0,
          income: 0,
          cost: 0,
          margin: 0,
          movements: 0,
          unitLabel: rateCard?.indicator || rateCard?.unitLabel || rateCard?.inputUnit || 'unidad',
        };
        row.units += units;
        row.income += income;
        row.cost += cost;
        row.margin = row.income - row.cost;
        row.movements += 1;
        rowsByRate.set(rateCardId, row);
        totals.income += income;
        totals.cost += cost;
        totals.movements += 1;
      });
      return {
        income: roundCurrency(totals.income),
        cost: roundCurrency(totals.cost),
        margin: roundCurrency(totals.income - totals.cost),
        movements: totals.movements,
        rows: [...rowsByRate.values()]
          .map((row) => ({
            ...row,
            units: roundCurrency(row.units),
            income: roundCurrency(row.income),
            cost: roundCurrency(row.cost),
            margin: roundCurrency(row.margin),
          }))
          .sort((left, right) => Math.abs(right.income) - Math.abs(left.income)),
      };
    })();
    const rateSnapshot = account.rateSnapshot || fallbackRateSnapshot;

    const matchingQualityEvents = contractorQualityEvents.filter((event) => {
      if (!isDateWithinRange(event.createdAt || event.dateKey, account.periodStart, account.periodEnd)) return false;
      return contractorTokensMatch(accountTokens, [
        event.professionalId,
        event.sourceStepAssignee,
        event.assigneeId,
        event.memberId,
        event.userId,
      ]);
    });
    const qualitySnapshot = matchingQualityEvents.length > 0
      ? summarizeContractorQuality(matchingQualityEvents)
      : normalizeContractorQualitySnapshot(account.qualitySnapshot);

    const performanceSnapshot = account.performanceSnapshot || (() => {
      const completedOnTime = enrichedActivities.filter((activity) => activity.timing === 'on_time').length;
      const completedLate = enrichedActivities.filter((activity) => activity.timing === 'late').length;
      const completedWithoutSchedule = enrichedActivities.filter((activity) => !activity.timing || activity.timing === 'without_schedule').length;
      const today = todayInputValue();
      const openOverdueActivities = contractorBillableActivities.filter((activity) => {
        const actorTokens = (activity as any).actorTokens as Set<string> | undefined;
        if (!actorTokens || !Array.from(accountTokens).some((token) => actorTokens.has(token))) return false;
        if (isCompletedTaskStatus(getActivityStatus(activity))) return false;
        return Boolean(
          activity.dueDate &&
          activity.dueDate >= account.periodStart &&
          activity.dueDate <= account.periodEnd &&
          activity.dueDate < today
        );
      });
      return {
        selectedCompleted: enrichedActivities.length,
        completedOnTime,
        completedLate,
        completedWithoutSchedule,
        openOverdue: openOverdueActivities.length,
        alerts: [
          ...openOverdueActivities.map((activity) => ({
            key: activity.key,
            taskTitle: activity.taskTitle,
            stepLabel: activity.stepLabel,
            kind: 'open_overdue' as const,
            dueDate: activity.dueDate,
            completedAt: activity.completedAt,
            daysLate: getCalendarDaysLate(new Date(), activity.dueDate),
          })),
          ...enrichedActivities.filter((activity) => activity.timing === 'late').map((activity) => ({
            key: activity.key,
            taskTitle: activity.taskTitle,
            stepLabel: activity.stepLabel,
            kind: 'completed_late' as const,
            dueDate: activity.dueDate,
            completedAt: activity.completedAt || activity.date,
            daysLate: activity.daysLate || 0,
          })),
        ].sort((left, right) => right.daysLate - left.daysLate).slice(0, 30),
      };
    })();

    const productivityComparison = account.productivityComparison || (() => {
      const roleLabel = getMemberRoleLabel(accountMember) || account.requesterSignature?.jobTitle || 'Sin cargo configurado';
      const normalizedRole = normalizeTaskSearchText(roleLabel);
      const comparableMembers = teamMembers.filter(
        (member) => normalizeTaskSearchText(getMemberRoleLabel(member)) === normalizedRole
      );
      const memberRows = (comparableMembers.length > 0 ? comparableMembers : accountMember ? [accountMember] : []).map((member) => ({
        memberId: String(member?.id || member?.authUserId || member?.email || getMemberLabel(member)),
        name: getMemberLabel(member),
        tokens: buildMemberIdentityTokens(member),
        isContractor: contractorTokensMatch(accountTokens, member),
      }));
      return {
        roleLabel,
        peerCount: Math.max(0, memberRows.length - 1),
        rows: rateSnapshot.rows.map((contractorRate) => {
          const professionals = memberRows.map((memberRow) => {
            const units = contractorRateEntries.reduce((sum, entry) => {
              if (String(entry?.rateCardId || '') !== contractorRate.rateCardId || entry?.isRework) return sum;
              if (!isDateWithinRange(entry?.date || entry?.dateKey || entry?.createdAt, account.periodStart, account.periodEnd)) return sum;
              if (!contractorTokensMatch(memberRow.tokens, entry?.assignedTo || entry?.userId || entry?.memberId)) return sum;
              return sum + Math.abs(normalizeDecimalInput(entry?.units ?? entry?.amount ?? entry?.quantity, 0));
            }, 0);
            return {
              memberId: memberRow.memberId,
              name: memberRow.name,
              units: roundCurrency(units),
              isContractor: memberRow.isContractor,
            };
          }).sort((left, right) => right.units - left.units || left.name.localeCompare(right.name, 'es', { sensitivity: 'base' }));
          const contractorIndex = professionals.findIndex((professional) => professional.isContractor);
          const contractorUnits = contractorIndex >= 0 ? professionals[contractorIndex].units : contractorRate.units;
          const peerValues = professionals.filter((professional) => !professional.isContractor).map((professional) => professional.units);
          const peerAverageUnits = peerValues.length > 0
            ? roundCurrency(peerValues.reduce((sum, units) => sum + units, 0) / peerValues.length)
            : 0;
          return {
            rateCardId: contractorRate.rateCardId,
            name: contractorRate.name,
            unitLabel: contractorRate.unitLabel || 'unidad',
            contractorUnits,
            peerAverageUnits,
            peerTopUnits: peerValues.length > 0 ? Math.max(...peerValues) : 0,
            contractorRank: contractorIndex >= 0 ? contractorIndex + 1 : 1,
            professionalCount: professionals.length || 1,
            deltaVsAveragePct: peerAverageUnits > 0
              ? Math.round(((contractorUnits - peerAverageUnits) / peerAverageUnits) * 100)
              : null,
            professionals: professionals.length > 0
              ? professionals
              : [{
                  memberId: account.contractorId,
                  name: account.contractorName,
                  units: contractorUnits,
                  isContractor: true,
                }],
          };
        }),
      };
    })();

    const enrichedAccount = {
      ...account,
      projectName: account.projectName || project?.name || 'Proyecto Pixel',
      activityItems: enrichedActivities,
      rateSnapshot,
      qualitySnapshot,
      performanceSnapshot,
      productivityComparison,
    };
    if (kind === 'completeDossier') {
      await downloadContractorCompleteDossier(enrichedAccount, project?.name || 'Proyecto Pixel');
    } else {
      await downloadContractorGeneratedDocument(enrichedAccount, kind, project?.name || 'Proyecto Pixel');
    }
  }, [
    contractorBillableActivities,
    contractorQualityEvents,
    contractorRateCardById,
    contractorRateEntries,
    project?.name,
    teamMembers,
  ]);

  useEffect(() => {
    if (!isContractorAccountModalOpen) return;
    setContractorAccountForm((current) => {
      const eligibleKeys = contractorPeriodActivities.map((activity) => activity.key).filter(Boolean);
      const currentKeys = current.activityKeys.filter((key) => eligibleKeys.includes(key));
      const nextKeys = Array.from(new Set([...currentKeys, ...eligibleKeys]));
      const nextTaskIds = Array.from(
        new Set(
          contractorPeriodActivities
            .filter((activity) => nextKeys.includes(activity.key))
            .map((activity) => activity.taskId)
        )
      );
      const keysUnchanged = nextKeys.length === current.activityKeys.length && nextKeys.every((key, index) => key === current.activityKeys[index]);
      const tasksUnchanged = nextTaskIds.length === current.taskIds.length && nextTaskIds.every((taskId, index) => taskId === current.taskIds[index]);
      if (keysUnchanged && tasksUnchanged) return current;
      return {
        ...current,
        activityKeys: nextKeys,
        taskIds: nextTaskIds,
        activitySummary: current.activitySummary || summarizeContractorActivities(contractorPeriodActivities, contractorPeriodRateSummary).qualitySummary,
      };
    });
  }, [contractorPeriodActivities, contractorPeriodRateSummary, isContractorAccountModalOpen]);

  const requesterMatchesCurrentActor = useCallback(
    (requesterId: string, requesterEmail?: string) => {
      const emailMatches =
        requesterEmail &&
        currentUser?.email &&
        String(requesterEmail).trim().toLowerCase() === String(currentUser.email).trim().toLowerCase();
      return currentActorIds.has(String(requesterId)) || Boolean(emailMatches);
    },
    [currentActorIds, currentUser?.email]
  );

  const openNewContractorAccount = () => {
    setEditingContractorAccount(null);
    setContractorAccountForm({
      ...buildEmptyContractorAccountForm(),
      customId: nextContractorAccountConsecutive,
      payerDomainId: contractorAccountPayerOptions[0]?.id || '',
    });
    setSelectedContractorMemberId(currentSignerMember ? getContractorMemberOptionId(currentSignerMember) : '');
    setContractorDocumentFiles({});
    setIsContractorParafiscalsDragging(false);
    setContractorAccountStep(1);
    setAdvanceTaskSearch('');
    setAdvanceTaskStatusFilter('all');
    setAdvanceTaskGroupFilter('all');
    setIsContractorAccountModalOpen(true);
  };

  const openEditContractorAccount = (account: ContractorPaymentRequest) => {
    const canCorrectReturnedAccount = account.status === 'returned' && isOwnContractorAccount(account);
    if (!canGlobalAdminManageContractorAccounts && !canCorrectReturnedAccount) {
      toast.warning('Solo puedes editar cuentas devueltas cuando están nuevamente en tu poder.');
      return;
    }
    setEditingContractorAccount(account);
    setContractorAccountForm({
      ...buildEmptyContractorAccountForm(),
      customId: account.customId || '',
      issueDate: account.issueDate || todayInputValue(),
      issueCity: account.issueCity || account.contractorCity || '',
      payerDomainId: account.payer?.id || contractorAccountPayerOptions[0]?.id || '',
      contractorIdentificationType: account.contractorIdentificationType || 'CC',
      contractorIdentificationNumber: account.contractorIdentificationNumber || '',
      contractorPhone: account.contractorPhone || '',
      contractorAddress: account.contractorAddress || '',
      contractorCity: account.contractorCity || '',
      concept: account.concept || '',
      bankAccountId: account.bankAccount?.id || '',
      bankName: account.bankAccount?.bankName || '',
      bankAccountType: account.bankAccount?.accountType || 'Ahorros',
      bankAccountNumber: account.bankAccount?.accountNumber || '',
      periodStart: account.periodStart || todayInputValue(),
      periodEnd: account.periodEnd || todayInputValue(),
      honorariumAmount: String(account.honorariumAmount || ''),
      taskIds: account.taskIds || [],
      activityKeys: account.activityKeys || [],
      activitySummary: account.activitySummary || '',
    });
    setSelectedContractorMemberId(String(account.contractorId || ''));
    setContractorDocumentFiles({});
    setIsContractorParafiscalsDragging(false);
    setContractorAccountStep(1);
    setAdvanceTaskSearch('');
    setAdvanceTaskStatusFilter('all');
    setAdvanceTaskGroupFilter('all');
    setIsContractorAccountModalOpen(true);
  };

  const selectContractorParafiscalsFile = (file?: File | null) => {
    if (!file) return;
    const extension = file.name.toLowerCase().split('.').pop() || '';
    if (!['pdf', 'png', 'jpg', 'jpeg'].includes(extension)) {
      toast.warning('El soporte debe ser PDF, PNG, JPG o JPEG.');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      toast.warning('El soporte de parafiscales no puede superar 15 MB.');
      return;
    }
    setContractorDocumentFiles((current) => ({ ...current, parafiscals: file }));
  };

  const toggleContractorAccountTask = (activityKey: string) => {
    setContractorAccountForm((current) => {
      const nextKeys = current.activityKeys.includes(activityKey)
        ? current.activityKeys.filter((key) => key !== activityKey)
        : [...current.activityKeys, activityKey];
      const nextTaskIds = Array.from(
        new Set(
          contractorBillableActivities
            .filter((activity) => nextKeys.includes(activity.key))
            .map((activity) => activity.taskId)
        )
      );
      return {
        ...current,
        activityKeys: nextKeys,
        taskIds: nextTaskIds,
      };
    });
  };

  const uploadContractorAccountDocument = async ({
    accountId,
    accountLabel,
    file,
    kind,
    label,
  }: {
    accountId: string;
    accountLabel: string;
    file: File;
    kind: ContractorAccountDocumentKind;
    label: string;
  }): Promise<ContractorAccountDocument> => {
    const uploadDate = new Date();
    const managedPrefix = `managed-contractor-account-${accountId}`;
    const folderName = kind === 'paymentSupport' ? 'Pago' : 'Documentos';
    const { folders: indexedFolders, leafFolderId } = await ensureManagedDocumentFolderPath({
      projectId,
      userId: currentUser?.uid || null,
      segments: [
        { id: 'managed-administrativo', name: 'Administrativo', accessMode: 'all', metadata: { documentContext: 'administration' } },
        { id: 'managed-administrativo-cuentas-cobro', name: 'Cuentas de cobro', accessMode: 'inherit', metadata: { documentContext: 'contractorAccounts' } },
        { id: managedPrefix, name: accountLabel, accessMode: 'inherit', metadata: { contractorAccountId: accountId, documentContext: 'contractorAccount' } },
        { id: `${managedPrefix}-${kind === 'paymentSupport' ? 'pago' : 'documentos'}`, name: folderName, accessMode: 'inherit', metadata: { contractorAccountId: accountId, documentContext: kind } },
      ],
    });
    const projectFolderSegments = getDocumentFolderStorageSegments(leafFolderId, indexedFolders);
    let storagePath = buildDocumentStoragePath({
      projectId,
      projectName: project?.name,
      fileName: file.name,
      documentName: `${label}-${accountId}`,
      date: uploadDate,
      folderName: 'administrativo',
      folderSegments: ['cuentas-de-cobro', accountId, folderName],
    });
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, file);
    storagePath = storageRef.fullPath;
    const fileUrl = await getDownloadURL(storageRef);
    const documentRef = await addDoc(collection(db, 'projects', projectId, 'documents'), {
      projectId,
      name: file.name,
      documentName: `${label} · ${accountLabel}`,
      type: label,
      itemKind: 'file',
      scope: 'project',
      parentFolderId: leafFolderId,
      projectFolderSegments,
      administrativeRequestType: 'contractorAccount',
      contractorAccountId: accountId,
      documentContext: kind === 'paymentSupport' ? 'contractorAccountPayment' : 'contractorAccountDocument',
      contractorAccountDocumentKind: kind,
      url: fileUrl,
      downloadURL: fileUrl,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type || 'application/octet-stream',
      storagePath,
      storageFolder: storagePath.split('/').slice(0, -1).join('/'),
      uploadedAt: serverTimestamp(),
      uploadedBy: currentUser?.uid || null,
      uploadedByName: getCurrentUserName(currentUser),
      createdAt: serverTimestamp(),
      accessMode: 'inherit',
      allowedMemberIds: [],
      accessPolicyVersion: 'folder-inheritance-v1',
      providerPathVersion: 'structured-v2',
    });

    return {
      kind,
      label,
      documentId: documentRef.id,
      fileName: file.name,
      fileSize: file.size,
      fileUrl,
      storagePath,
      uploadedAt: uploadDate.toISOString(),
      uploadedBy: currentUser?.uid || null,
      uploadedByName: getCurrentUserName(currentUser),
    };
  };

  const notifyContractorAccountAssignment = async ({
    accountId,
    assigneeId,
    status,
    source,
    eventId,
  }: {
    accountId: string;
    assigneeId?: string | null;
    status: ContractorAccountStatus;
    source: string;
    eventId: string;
  }) => {
    if (!assigneeId) {
      toast.warning('La cuenta avanzó, pero el siguiente responsable no está configurado en la ruta de aprobación.');
      return;
    }

    const result = await notifyTaskAssignment({
      projectId,
      taskId: accountId,
      assigneeId,
      eventType: 'contractor_account_assigned',
      assignmentStage: status,
      notificationEventId: eventId,
      source,
    });

    if (!result.ok && !result.skipped) {
      toast.warning('La cuenta quedó en la Bandeja de entrada, pero no se pudo enviar el correo al responsable.');
      return;
    }

    if (result.email?.skipped && result.email?.reason === 'missing_resend_api_key') {
      toast.warning('La alerta quedó en Pixel, pero falta configurar RESEND_API_KEY para enviar el correo.');
    }
  };

  const handleCreateContractorAccount = async () => {
    if (!canCreateContractorAccount || !currentUser?.uid) return;
    const isGlobalAdminInPlaceEdit = Boolean(
      editingContractorAccount && canGlobalAdminManageContractorAccounts
    );
    const honorariumAmount = asNumber(contractorAccountForm.honorariumAmount);
    const normalizedConsecutive = contractorAccountForm.customId.trim().toLowerCase();
    if (!normalizedConsecutive) {
      toast.warning('La cuenta debe tener un número consecutivo único.');
      return;
    }
    if (contractorAccounts.some((account) => account.id !== editingContractorAccount?.id && String(account.customId || '').trim().toLowerCase() === normalizedConsecutive)) {
      toast.warning('Ese consecutivo ya está siendo utilizado por otra cuenta de cobro.');
      return;
    }
    const selectedPayer = contractorAccountPayerOptions.find((payer) => payer.id === contractorAccountForm.payerDomainId);
    if (!selectedPayer) {
      toast.warning('Selecciona la empresa que debe pagar la cuenta de cobro.');
      return;
    }
    if (!contractorAccountForm.issueDate || !contractorAccountForm.issueCity.trim()) {
      toast.warning('Completa la fecha de emisión y la ciudad de expedición.');
      return;
    }
    if (!contractorAccountForm.contractorIdentificationNumber.trim()) {
      toast.warning('Ingresa la cédula o NIT del profesional.');
      return;
    }
    if (!contractorAccountForm.contractorAddress.trim() || !contractorAccountForm.contractorPhone.trim() || !contractorAccountForm.contractorCity.trim()) {
      toast.warning('Completa la dirección, teléfono y ciudad del profesional.');
      return;
    }
    if (!contractorAccountForm.concept.trim()) {
      toast.warning('Describe el concepto detallado de los servicios cobrados.');
      return;
    }
    if (!contractorAccountForm.bankName.trim() || !contractorAccountForm.bankAccountNumber.trim() || !contractorAccountForm.bankAccountType.trim()) {
      toast.warning('Selecciona o registra la cuenta bancaria donde debe realizarse el pago.');
      return;
    }
    if (honorariumAmount <= 0) {
      toast.warning('Ingresa el monto de honorarios de la cuenta de cobro.');
      return;
    }
    if (contractorAccountForm.activityKeys.length === 0) {
      toast.warning('Relaciona al menos una actividad, subtarea o paso de Pixel al informe de actividades.');
      return;
    }
    const requesterSignature = isGlobalAdminInPlaceEdit
      ? editingContractorAccount?.requesterSignature || buildMemberSignatureSnapshot(selectedContractorMember)
      : buildMemberSignatureSnapshot(selectedContractorMember);
    if (!requesterSignature) {
      toast.warning(
        canGlobalAdminReassignContractorAccounts
          ? 'La persona seleccionada debe tener firma cargada en su perfil antes de radicar la cuenta de cobro.'
          : 'Carga tu firma en el perfil antes de enviar la cuenta de cobro.'
      );
      return;
    }
    const nextApproverId = getContractorAccountConfiguredApproverId('submitted');
    if (!isGlobalAdminInPlaceEdit && !nextApproverId) {
      toast.warning('No se puede radicar la cuenta porque el jefe inmediato no está configurado en la ruta de aprobación del proyecto u organización.');
      return;
    }
    const missingDocument = CONTRACTOR_ACCOUNT_UPLOAD_DOCUMENTS.find((document) =>
      !contractorDocumentFiles[document.kind] &&
      !editingContractorAccount?.documents?.some((existing) => existing.kind === document.kind)
    );
    if (missingDocument) {
      toast.warning(`Adjunta el documento obligatorio: ${missingDocument.label}.`);
      return;
    }

    setSubmitting(true);
    try {
      const currentMember = selectedContractorMember;
      const contractorName = isGlobalAdminInPlaceEdit
        ? editingContractorAccount?.contractorName || (currentMember ? getMemberLabel(currentMember) : getCurrentUserName(currentUser))
        : currentMember ? getMemberLabel(currentMember) : getCurrentUserName(currentUser);
      const contractorEmail = String(
        isGlobalAdminInPlaceEdit
          ? editingContractorAccount?.contractorEmail || currentMember?.email || ''
          : currentMember?.email || currentUser.email || ''
      );
      const bankAccountId = contractorAccountForm.bankAccountId || safeId();
      const bankAccount: ContractorBankAccount = {
        id: bankAccountId,
        bankName: contractorAccountForm.bankName.trim(),
        accountType: contractorAccountForm.bankAccountType.trim(),
        accountNumber: contractorAccountForm.bankAccountNumber.trim(),
        holderName: contractorName,
        holderDocument: contractorAccountForm.contractorIdentificationNumber.trim(),
        isDefault: selectedContractorBankAccounts.length === 0,
      };
      const socialSecurityBase = roundCurrency(honorariumAmount * 0.4);
      const estimatedMinimumWages = Math.max(1, Math.ceil(socialSecurityBase / COLOMBIA_LEGAL_MINIMUM_WAGE));
      const liveActivityByKey = new Map(selectedContractorActivities.map((activity) => [activity.key, activity]));
      const storedActivityByKey = new Map((editingContractorAccount?.activityItems || []).map((activity) => [activity.key, activity]));
      const activityItems = contractorAccountForm.activityKeys
        .map((activityKey) => liveActivityByKey.get(activityKey) || storedActivityByKey.get(activityKey))
        .filter(Boolean)
        .map(({ actorTokens, ...activity }: any) => activity as ContractorAccountActivityItem);
      const taskIds = Array.from(new Set(activityItems.map((activity) => activity.taskId)));
      const taskTitles = activityItems.map((activity) => activity.taskTitle);
      const accountRef = editingContractorAccount
        ? doc(db, 'projects', projectId, 'contractorPaymentRequests', editingContractorAccount.id)
        : doc(collection(db, 'projects', projectId, 'contractorPaymentRequests'));
      const accountLabel = `${contractorName} · ${contractorAccountForm.periodStart} - ${contractorAccountForm.periodEnd}`;
      const existingDocuments = editingContractorAccount?.documents || [];
      const uploadedDocuments = await Promise.all(
        CONTRACTOR_ACCOUNT_UPLOAD_DOCUMENTS
          .filter((document) => contractorDocumentFiles[document.kind])
          .map((document) =>
            uploadContractorAccountDocument({
              accountId: accountRef.id,
              accountLabel,
              file: contractorDocumentFiles[document.kind] as File,
              kind: document.kind,
              label: document.label,
            })
          )
      );
      const documents = CONTRACTOR_ACCOUNT_UPLOAD_DOCUMENTS.map((document) =>
        uploadedDocuments.find((uploaded) => uploaded.kind === document.kind) ||
        existingDocuments.find((existing) => existing.kind === document.kind)
      ).filter(Boolean) as ContractorAccountDocument[];
      const nextApprover = findContractorMemberById(nextApproverId || '');
      const nextApproverMemberId = String(nextApprover?.id || nextApproverId || '').trim() || null;
      const nextApproverAuthUserId = String(
        nextApprover?.authUserId || nextApprover?.uid || nextApprover?.userId || ''
      ).trim() || null;

      if (contractorAccountForm.saveBankAccountToProfile) {
        const profileId = String(
          selectedContractorProfile?.id ||
          currentMember?.authUserId ||
          currentMember?.uid ||
          currentMember?.userId ||
          (requesterSignature.signerUserId || '')
        ).trim();
        if (profileId) {
          try {
            const existingBankAccounts = selectedContractorBankAccounts.filter((account) => account.id !== bankAccount.id);
            await setDoc(doc(db, 'users', profileId), {
              identificationType: contractorAccountForm.contractorIdentificationType,
              identificationNumber: contractorAccountForm.contractorIdentificationNumber.trim(),
              phone: contractorAccountForm.contractorPhone.trim(),
              address: contractorAccountForm.contractorAddress.trim(),
              city: contractorAccountForm.contractorCity.trim(),
              bankAccounts: [...existingBankAccounts, bankAccount],
              contractorProfileUpdatedAt: serverTimestamp(),
            }, { merge: true });
          } catch (profileError) {
            console.warn('La cuenta se radicará, pero los datos bancarios no pudieron sincronizarse con el perfil:', profileError);
            toast.warning('La cuenta se guardará, pero Pixel no pudo actualizar el perfil bancario del profesional.');
          }
        }
      }

      const payer = {
        id: selectedPayer.id,
        name: selectedPayer.name,
        taxId: selectedPayer.taxId,
        address: selectedPayer.address || '',
        city: selectedPayer.city || '',
      };
      const administrativeChangedFields = isGlobalAdminInPlaceEdit && editingContractorAccount
        ? getContractorAccountAdministrativeChangedFields(editingContractorAccount, {
            customId: contractorAccountForm.customId.trim(),
            issueDate: contractorAccountForm.issueDate,
            issueCity: contractorAccountForm.issueCity.trim(),
            payer,
            contractorIdentificationType: contractorAccountForm.contractorIdentificationType,
            contractorIdentificationNumber: contractorAccountForm.contractorIdentificationNumber.trim(),
            contractorPhone: contractorAccountForm.contractorPhone.trim(),
            contractorAddress: contractorAccountForm.contractorAddress.trim(),
            contractorCity: contractorAccountForm.contractorCity.trim(),
            concept: contractorAccountForm.concept.trim(),
            bankAccount,
            periodStart: contractorAccountForm.periodStart,
            periodEnd: contractorAccountForm.periodEnd,
            honorariumAmount,
            activityKeys: activityItems.map((activity) => activity.key),
            activitySummary: contractorAccountForm.activitySummary.trim() || contractorActivitySnapshot.qualitySummary,
            documents,
          })
        : [];
      const submissionAssignmentEventId = `${editingContractorAccount ? 'resubmitted' : 'submitted'}-${Date.now()}`;
      const workflowPayload = isGlobalAdminInPlaceEdit && editingContractorAccount
        ? {
            status: editingContractorAccount.status,
            currentApproverId: editingContractorAccount.currentApproverId || null,
            currentApproverMemberId: editingContractorAccount.currentApproverMemberId || null,
            currentApproverAuthUserId: editingContractorAccount.currentApproverAuthUserId || null,
            currentApproverEmail: editingContractorAccount.currentApproverEmail || null,
            currentApproverLabel: editingContractorAccount.currentApproverLabel || null,
            currentApprovalStage: editingContractorAccount.currentApprovalStage || editingContractorAccount.status,
            approvals: editingContractorAccount.approvals || [],
            administrativelyEditedAt: serverTimestamp(),
            administrativelyEditedBy: currentUser.uid,
            administrativelyEditedByName: getCurrentUserName(currentUser),
            administrativeEditHistory: arrayUnion({
              actorId: currentUser.uid,
              actorName: getCurrentUserName(currentUser),
              actorEmail: currentUser.email || null,
              at: new Date().toISOString(),
              preservedStatus: editingContractorAccount.status,
              changedFields: administrativeChangedFields,
            }),
          }
        : {
            currentAssignmentEventId: submissionAssignmentEventId,
            status: 'submitted' as const,
            currentApproverId: nextApproverId,
            currentApproverMemberId: nextApproverMemberId,
            currentApproverAuthUserId: nextApproverAuthUserId,
            currentApproverEmail: nextApprover?.email || null,
            currentApproverLabel: CONTRACTOR_ACCOUNT_STATUS_META.submitted.label,
            currentApprovalStage: 'submitted' as const,
            correctionAssigneeId: null,
            correctionAssigneeMemberId: null,
            correctionAssigneeAuthUserId: null,
            correctionAssigneeEmail: null,
            approvals: editingContractorAccount?.approvals || [],
            submittedAt: serverTimestamp(),
            resubmittedAt: editingContractorAccount ? serverTimestamp() : null,
            resubmittedBy: editingContractorAccount ? currentUser.uid : null,
            ...(editingContractorAccount ? {
              resubmissionHistory: arrayUnion({
                actorId: currentUser.uid,
                actorName: getCurrentUserName(currentUser),
                targetStage: 'submitted',
                targetApproverId: nextApproverId,
                at: new Date().toISOString(),
              }),
            } : {}),
          };

      await setDoc(accountRef, {
        projectId,
        contractorId: isGlobalAdminInPlaceEdit
          ? editingContractorAccount?.contractorId || currentMember?.id || currentMember?.authUserId || currentUser.uid
          : currentMember?.id || currentMember?.authUserId || currentUser.uid,
        contractorAuthUserId: isGlobalAdminInPlaceEdit
          ? editingContractorAccount?.contractorAuthUserId || requesterSignature.signerUserId || currentMember?.authUserId || null
          : requesterSignature.signerUserId || currentMember?.authUserId || currentUser.uid,
        contractorName,
        contractorEmail,
        contractorIdentificationType: contractorAccountForm.contractorIdentificationType,
        contractorIdentificationNumber: contractorAccountForm.contractorIdentificationNumber.trim(),
        contractorPhone: contractorAccountForm.contractorPhone.trim(),
        contractorAddress: contractorAccountForm.contractorAddress.trim(),
        contractorCity: contractorAccountForm.contractorCity.trim(),
        customId: contractorAccountForm.customId.trim(),
        issueDate: contractorAccountForm.issueDate,
        issueCity: contractorAccountForm.issueCity.trim(),
        concept: contractorAccountForm.concept.trim(),
        payer,
        bankAccount,
        periodStart: contractorAccountForm.periodStart,
        periodEnd: contractorAccountForm.periodEnd,
        honorariumAmount,
        socialSecurityBase,
        estimatedMinimumWages,
        taskIds,
        taskTitles,
        activityKeys: activityItems.map((activity) => activity.key),
        activityItems,
        activitySummary: contractorAccountForm.activitySummary.trim() || contractorActivitySnapshot.qualitySummary,
        activitySnapshot: contractorActivitySnapshot,
        qualitySnapshot: contractorQualitySnapshot,
        rateSnapshot: contractorPeriodRateSummary,
        performanceSnapshot: contractorPerformanceSnapshot,
        productivityComparison: contractorProductivityComparison,
        projectName: project?.name || 'Proyecto Pixel',
        requesterSignature,
        generatedDocuments: isGlobalAdminInPlaceEdit && editingContractorAccount?.generatedDocuments?.length
          ? editingContractorAccount.generatedDocuments
          : CONTRACTOR_ACCOUNT_GENERATED_DOCUMENTS.map((document) => ({
              ...document,
              generatedAt: new Date().toISOString(),
            })),
        parafiscalsValidation: {
          baseAmount: socialSecurityBase,
          minimumWage: COLOMBIA_LEGAL_MINIMUM_WAGE,
          estimatedMinimumWages,
          status: 'pending_manual_review',
          note: 'Pixel calcula la base sobre el 40% de los honorarios. El soporte queda pendiente de revisión administrativa contra el periodo cobrado.',
        },
        documents,
        ...workflowPayload,
        ...(editingContractorAccount ? {} : {
          createdAt: serverTimestamp(),
          createdBy: currentUser.uid,
          createdByName: getCurrentUserName(currentUser),
        }),
        updatedAt: serverTimestamp(),
      }, { merge: true });

      if (!isGlobalAdminInPlaceEdit) {
        await notifyContractorAccountAssignment({
          accountId: accountRef.id,
          assigneeId: nextApproverId,
          status: 'submitted',
          source: editingContractorAccount ? 'contractor_account_resubmitted' : 'contractor_account_submitted',
          eventId: submissionAssignmentEventId,
        });
      }

      toast.success(
        isGlobalAdminInPlaceEdit
          ? 'Cuenta de cobro actualizada por el Administrador Global sin alterar su estado ni su responsable actual.'
          : editingContractorAccount
            ? 'Cuenta de cobro corregida y reenviada al jefe inmediato.'
            : 'Cuenta de cobro enviada para aprobación del jefe inmediato.'
      );
      setIsContractorAccountModalOpen(false);
      setEditingContractorAccount(null);
      setContractorDocumentFiles({});
      setContractorAccountStep(1);
      setContractorAccountForm(buildEmptyContractorAccountForm());
      setAdminWorkspace('contractorAccounts');
      setContractorAccountView('approvals');
    } catch (error) {
      console.error('Error creating contractor payment request:', error);
      toast.error('No se pudo crear la cuenta de cobro.');
    } finally {
      setSubmitting(false);
    }
  };

  const openContractorAccountAction = (
    type: 'approve' | 'return' | 'reject' | 'account' | 'pay' | 'delete' | 'reassign',
    account: ContractorPaymentRequest
  ) => {
    setContractorPaymentFile(null);
    setContractorAccountActionComment('');
    if (type === 'reassign') {
      const accountEmail = String(account.contractorEmail || '').trim().toLowerCase();
      const matchedMember = contractorMemberOptions.find((member) => {
        const memberEmail = String(member?.email || '').trim().toLowerCase();
        return (
          String(member?.id || '') === String(account.contractorId || '') ||
          String(member?.authUserId || '') === String(account.contractorId || '') ||
          Boolean(accountEmail && memberEmail === accountEmail)
        );
      }) || null;
      setContractorAccountReassignMemberId(matchedMember ? getContractorMemberOptionId(matchedMember) : String(account.contractorId || ''));
    } else {
      setContractorAccountReassignMemberId('');
    }
    setContractorAccountForm((current) => ({
      ...current,
      accountingReference: account.accountingReference || '',
      accountingNote: account.accountingNote || '',
    }));
    setContractorAccountAction({ type, account });
  };

  const applyContractorAccountAction = async () => {
    if (!contractorAccountAction) return;
    const { type, account } = contractorAccountAction;
    if (type === 'delete' && !canManage) {
      toast.error('Solo administradores o coordinadores pueden eliminar cuentas de cobro.');
      return;
    }
    if (type === 'reassign' && !canGlobalAdminReassignContractorAccounts) {
      toast.error('Solo el administrador global puede cambiar la persona asociada a una cuenta de cobro.');
      return;
    }
    const isGlobalAdminApproval = ['approve', 'account', 'pay'].includes(type) && canGlobalAdminManageContractorAccounts;
    const isGlobalAdminReactivation = type === 'approve' && account.status === 'returned' && canGlobalAdminManageContractorAccounts;
    if (type !== 'delete' && type !== 'reassign' && !isGlobalAdminApproval && !canActOnContractorAccount(account)) {
      toast.error('Esta cuenta está en poder de otro responsable. Puedes consultarla, pero solo la persona del paso actual puede gestionarla.');
      return;
    }
    const nextStatus = type === 'approve'
      ? getContractorAccountApprovalTarget(account, isGlobalAdminApproval)
      : null;
    if (type === 'approve' && !nextStatus) {
      toast.warning('Esta cuenta de cobro no tiene una siguiente aprobación disponible.');
      return;
    }
    const nextOwnerStatus = type === 'approve'
      ? nextStatus
      : type === 'account'
        ? 'accounted'
        : null;
    if (
      nextOwnerStatus &&
      nextOwnerStatus !== 'paid' &&
      !getContractorAccountConfiguredApproverId(nextOwnerStatus)
    ) {
      toast.warning(`Configura el responsable de ${CONTRACTOR_ACCOUNT_STATUS_META[nextOwnerStatus]?.label || nextOwnerStatus} antes de avanzar la cuenta.`);
      return;
    }
    if ((type === 'return' || type === 'reject') && !contractorAccountActionComment.trim()) {
      toast.warning('Escribe una observación para devolver o rechazar la cuenta de cobro.');
      return;
    }
    if (type === 'return' && !getContractorAccountRequesterId(account)) {
      toast.warning('No se pudo identificar al contratista que debe subsanar la cuenta. Revisa la persona asociada antes de devolverla.');
      return;
    }
    if (type === 'pay' && !contractorPaymentFile) {
      toast.warning('Adjunta el soporte de pago de la cuenta de cobro.');
      return;
    }
    if (type === 'account' && !contractorAccountForm.accountingReference.trim()) {
      toast.warning('Ingresa la referencia contable antes de contabilizar la cuenta de cobro.');
      return;
    }
    const actionSignature = buildCurrentSignatureSnapshot();
    if ((type === 'approve' || type === 'account' || type === 'pay') && !isGlobalAdminReactivation && !actionSignature) {
      toast.warning('Carga tu firma en el perfil antes de completar esta etapa. La firma debe quedar adjunta al informe.');
      return;
    }

    setSubmitting(true);
    try {
      const refDoc = doc(db, 'projects', projectId, 'contractorPaymentRequests', account.id);
      if (type === 'delete') {
        await removeContractorAccountDocumentArtifacts(account);
        await deleteDoc(refDoc);
        toast.success('Cuenta de cobro eliminada junto con sus documentos asociados.');
        setContractorAccountAction(null);
        setContractorPaymentFile(null);
        return;
      }

      if (type === 'reassign') {
        const nextMember = findContractorMemberById(contractorAccountReassignMemberId);
        if (!nextMember) {
          toast.warning('Selecciona la nueva persona asociada a la cuenta de cobro.');
          return;
        }
        const nextSignature = buildMemberSignatureSnapshot(nextMember);
        if (!nextSignature) {
          toast.warning('La nueva persona debe tener firma cargada en su perfil antes de asociarla a la cuenta de cobro.');
          return;
        }
        const nextContractorId = String(nextMember.id || nextMember.authUserId || nextMember.email || '');
        const nextContractorName = getMemberLabel(nextMember);
        const nextContractorEmail = String(nextMember.email || '');
        const actorName = getCurrentUserName(currentUser);
        const actionStamp = new Date().toISOString();
        await updateDoc(refDoc, {
          contractorId: nextContractorId,
          contractorAuthUserId: nextSignature.signerUserId || nextMember.authUserId || null,
          contractorName: nextContractorName,
          contractorEmail: nextContractorEmail,
          requesterSignature: nextSignature,
          ...(account.status === 'returned' ? {
            currentApproverId: nextSignature.signerUserId || nextContractorId,
            currentApproverMemberId: nextMember.id || nextContractorId,
            currentApproverAuthUserId: nextSignature.signerUserId || nextMember.authUserId || null,
            currentApproverEmail: nextContractorEmail || null,
            currentAssignmentEventId: `reassign-${actionStamp}`,
            correctionAssigneeId: nextContractorId,
            correctionAssigneeMemberId: nextMember.id || nextContractorId,
            correctionAssigneeAuthUserId: nextSignature.signerUserId || nextMember.authUserId || null,
            correctionAssigneeEmail: nextContractorEmail || null,
          } : {}),
          reassignedAt: serverTimestamp(),
          reassignedBy: currentUser?.uid || null,
          reassignedByName: actorName,
          reassignmentComment: contractorAccountActionComment.trim(),
          reassignmentHistory: arrayUnion({
            fromContractorId: account.contractorId || '',
            fromContractorName: account.contractorName || '',
            fromContractorEmail: account.contractorEmail || '',
            toContractorId: nextContractorId,
            toContractorName: nextContractorName,
            toContractorEmail: nextContractorEmail,
            actorId: currentUser?.uid || null,
            actorName,
            at: actionStamp,
            comment: contractorAccountActionComment.trim(),
          }),
          updatedAt: serverTimestamp(),
        });
        if (account.status === 'returned') {
          await notifyContractorAccountAssignment({
            accountId: account.id,
            assigneeId: nextContractorId,
            status: 'returned',
            source: 'contractor_account_person_reassigned',
            eventId: `reassign-${actionStamp}`,
          });
        }
        toast.success('Persona asociada a la cuenta de cobro actualizada.');
        setContractorAccountAction(null);
        setContractorAccountReassignMemberId('');
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error('Tu sesión venció. Inicia sesión nuevamente antes de actualizar la cuenta.');

      const paymentSupport = type === 'pay'
        ? await uploadContractorAccountDocument({
            accountId: account.id,
            accountLabel: `${account.contractorName} · ${account.periodStart} - ${account.periodEnd}`,
            file: contractorPaymentFile as File,
            kind: 'paymentSupport',
            label: 'Soporte de pago de cuenta de cobro',
          })
        : null;
      const serverAction = isGlobalAdminReactivation ? 'reactivate' : type;
      const response = await fetch('/api/administration/contractor-accounts/action', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectId,
          accountId: account.id,
          action: serverAction,
          operationId: crypto.randomUUID(),
          expectedStatus: account.status,
          expectedStage: account.currentApprovalStage || account.status,
          expectedAssignmentEventId: account.currentAssignmentEventId || null,
          comment: contractorAccountActionComment.trim(),
          accountingReference: type === 'account' ? contractorAccountForm.accountingReference.trim() : null,
          accountingNote: type === 'account'
            ? contractorAccountForm.accountingNote.trim() || contractorAccountActionComment.trim()
            : null,
          paymentSupport,
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error || 'No se pudo confirmar la acción sobre la cuenta de cobro.');
      }
      toast.success(
        isGlobalAdminReactivation
          ? `Cuenta reactivada en ${CONTRACTOR_ACCOUNT_STATUS_META[nextStatus!]?.label || nextStatus}.`
          : type === 'pay'
          ? 'Cuenta de cobro pagada y soporte archivado.'
          : type === 'account'
            ? 'Cuenta de cobro contabilizada.'
            : type === 'return'
              ? 'Cuenta de cobro devuelta para corrección.'
              : type === 'reject'
                ? 'Cuenta de cobro rechazada.'
                : 'Cuenta de cobro aprobada y enviada a la siguiente etapa.'
      );
      if (result?.notificationError) {
        toast.warning('La cuenta cambió de responsable, pero no se pudo enviar su alerta. La asignación sí quedó guardada en Pixel.');
      }
      setContractorAccountAction(null);
      setContractorPaymentFile(null);
    } catch (error) {
      console.error('Error applying contractor account action:', error);
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar la cuenta de cobro.');
    } finally {
      setSubmitting(false);
    }
  };

  const canCorrectAdvanceReceipt = useCallback(
    (advance: TravelAdvance) => {
      const emailMatches =
        advance.requesterEmail &&
        currentUser?.email &&
        String(advance.requesterEmail).toLowerCase() === String(currentUser.email).toLowerCase();
      return canValidate || currentActorIds.has(String(advance.requesterId)) || Boolean(emailMatches);
    },
    [canValidate, currentActorIds, currentUser?.email]
  );

  const canAdministrativelyDeleteReceipt = canDeleteAdministrativeReceipts;
  const canAdministrativelyEditReceipt = canManage || canValidate;

  const canDeleteReceiptForUser = useCallback(
    (receipt: Pick<AdvanceReceipt, 'status'>, advance: TravelAdvance) =>
      canAdministrativelyDeleteReceipt || (canDeleteUnlegalizedReceipt(receipt) && canCorrectAdvanceReceipt(advance)),
    [canAdministrativelyDeleteReceipt, canCorrectAdvanceReceipt]
  );

  const removeReceiptDocumentArtifacts = async (receipt: AdvanceReceipt) => {
    const cleanupTasks: Promise<unknown>[] = [];
    if (receipt.documentId) {
      cleanupTasks.push(deleteDoc(doc(db, 'projects', projectId, 'documents', receipt.documentId)));
    }
    if (receipt.storagePath) {
      cleanupTasks.push(deleteObject(ref(storage, receipt.storagePath)));
    }

    if (cleanupTasks.length === 0) return;

    const results = await Promise.allSettled(cleanupTasks);
    results.forEach((result) => {
      if (result.status === 'rejected') {
        console.warn('No se pudo limpiar un artefacto del soporte eliminado:', result.reason);
      }
    });
  };

  const removeContractorAccountDocumentArtifacts = async (account: ContractorPaymentRequest) => {
    const documents = [
      ...(account.documents || []),
      ...(account.paymentSupport ? [account.paymentSupport] : []),
    ].filter(Boolean);
    const seenDocumentIds = new Set<string>();
    const seenStoragePaths = new Set<string>();
    const cleanupTasks: Promise<unknown>[] = [];

    documents.forEach((document) => {
      if (document.documentId && !seenDocumentIds.has(document.documentId)) {
        seenDocumentIds.add(document.documentId);
        cleanupTasks.push(deleteDoc(doc(db, 'projects', projectId, 'documents', document.documentId)));
      }
      if (document.storagePath && !seenStoragePaths.has(document.storagePath)) {
        seenStoragePaths.add(document.storagePath);
        cleanupTasks.push(deleteObject(ref(storage, document.storagePath)));
      }
    });

    if (cleanupTasks.length === 0) return;

    const results = await Promise.allSettled(cleanupTasks);
    results.forEach((result) => {
      if (result.status === 'rejected') {
        console.warn('No se pudo limpiar un artefacto de la cuenta de cobro eliminada:', result.reason);
      }
    });
  };

  const loadLocationOptions = useCallback(async () => {
    if (locationsLoaded || locationsLoading) return;

    setLocationsLoading(true);
    try {
      const response = await fetch('/data/colombia-municipalities.json', { cache: 'force-cache' });
      if (!response.ok) {
        throw new Error('No se pudo cargar el catálogo de municipios.');
      }
      const data = (await response.json()) as ColombiaDepartment[];
      setLocationOptions(data);
      setLocationsLoaded(true);
    } catch (error) {
      console.error('Error loading Colombia municipalities:', error);
      toast.error('No se pudo cargar la lista de departamentos y municipios.');
    } finally {
      setLocationsLoading(false);
    }
  }, [locationsLoaded, locationsLoading]);

  const openNewAdvance = () => {
    setAdvanceForm(buildEmptyAdvanceForm(currentUser, teamMembers));
    setAdvanceTaskSearch('');
    setAdvanceTaskStatusFilter('active');
    setAdvanceTaskGroupFilter('all');
    void loadLocationOptions();
    setIsAdvanceModalOpen(true);
  };

  const toggleAdvanceTask = (taskId: string) => {
    setAdvanceForm((current) => ({
      ...current,
      taskIds: current.taskIds.includes(taskId)
        ? current.taskIds.filter((id) => id !== taskId)
        : [...current.taskIds, taskId],
    }));
  };

  const selectVisibleAdvanceTasks = () => {
    const visibleIds = filteredAdvanceTasks.map((task) => task.id).filter(Boolean);
    setAdvanceForm((current) => ({
      ...current,
      taskIds: Array.from(new Set([...current.taskIds, ...visibleIds])),
    }));
  };

  const openAdvanceEditor = (advance: TravelAdvance) => {
    const coverage = getAdvanceFinancialCoverage(advance);
    setEditingAdvance(advance);
    setAdvanceEditForm({
      customId: advance.customId || '',
      department: advance.department || '',
      municipality: advance.municipality || '',
      purpose: advance.purpose || '',
      travelStart: advance.travelStart || todayInputValue(),
      travelEnd: advance.travelEnd || todayInputValue(),
      amountReturned: advance.amountReturned ? String(advance.amountReturned) : '',
      returnComment: advance.returnComment || '',
      costCenters: normalizeCostCenters(advance.costCenters, coverage.approved || asNumber(advance.amountRequested)),
      items: (advance.items || []).map((item) => ({ ...item })),
    });
    void loadLocationOptions();
  };

  const editingAdvanceApprovedAmount = useMemo(
    () => editingAdvance
      ? editingAdvance.status === 'returned'
        ? advanceEditForm.items.reduce((sum, item) => sum + asNumber(item.amount), 0)
        : getAdvanceFinancialCoverage(editingAdvance).approved
      : 0,
    [advanceEditForm.items, editingAdvance]
  );

  const editingAdvanceCoverage = useMemo(
    () =>
      editingAdvance
        ? getAdvanceFinancialCoverage({
            ...editingAdvance,
            amountReturned: asNumber(advanceEditForm.amountReturned),
          })
        : null,
    [advanceEditForm.amountReturned, editingAdvance]
  );

  const editingCostCenterTotal = useMemo(
    () => getCostCenterPercentTotal(advanceEditForm.costCenters),
    [advanceEditForm.costCenters]
  );

  const updateAdvanceCostCenter = (id: string, updates: Partial<CostCenterAllocation>) => {
    setAdvanceEditForm((current) => ({
      ...current,
      costCenters: normalizeCostCenters(
        current.costCenters.map((center) => (center.id === id ? { ...center, ...updates } : center)),
        editingAdvanceApprovedAmount
      ),
    }));
  };

  const addAdvanceCostCenter = () => {
    const availableDomain = costCenterOptions.find(
      (domain) => !advanceEditForm.costCenters.some((center) => center.domainId === domain.id)
    );
    if (!availableDomain) {
      toast.error('No hay más centros de costos activos disponibles. Configura otro dominio para agregarlo.');
      return;
    }
    setAdvanceEditForm((current) => ({
      ...current,
      costCenters: normalizeCostCenters(
        [
          ...current.costCenters,
          {
            id: safeId(),
            domainId: availableDomain.id.startsWith('default-cost-center-') ? undefined : availableDomain.id,
            name: availableDomain.name,
            percentage: 0,
            amount: 0,
            note: '',
          },
        ],
        editingAdvanceApprovedAmount
      ),
    }));
  };

  const removeAdvanceCostCenter = (id: string) => {
    if (advanceEditForm.costCenters.length <= 1) {
      toast.error('El anticipo debe conservar al menos un centro de costos.');
      return;
    }
    setAdvanceEditForm((current) => ({
      ...current,
      costCenters: normalizeCostCenters(
        current.costCenters.filter((center) => center.id !== id),
        editingAdvanceApprovedAmount
      ),
    }));
  };

  const updateAdvanceEditItem = (id: string, updates: Partial<AdvanceItem>) => {
    setAdvanceEditForm((current) => {
      const items = current.items.map((item) => {
        if (item.id !== id) return item;
        const next = { ...item, ...updates };
        return { ...next, amount: roundCurrency(asNumber(next.days) * asNumber(next.unitAmount)) };
      });
      const requestedAmount = items.reduce((sum, item) => sum + asNumber(item.amount), 0);
      return { ...current, items, costCenters: normalizeCostCenters(current.costCenters, requestedAmount) };
    });
  };

  const updateDraftItem = (updates: Partial<AdvanceItem>) => {
    setAdvanceDraftItem((current) => {
      if (!current) return current;
      const next = { ...current, ...updates };
      const category = categoryOptions.find((item) => item.id === next.categoryId);
      if (category && updates.categoryId) {
        next.categoryName = category.name;
        next.unitAmount = asNumber(category.defaultDailyAmount);
      }
      next.amount = asNumber(next.days) * asNumber(next.unitAmount);
      return next;
    });
  };

  const addDraftItem = () => {
    if (!advanceDraftItem) return;
    const selectedCategory = categoryOptions.find(
      (category) => category.id === advanceDraftItem.categoryId
    );
    if (!selectedCategory) {
      toast.error('Selecciona un dominio de gasto.');
      return;
    }
    const nextItem = {
      ...advanceDraftItem,
      id: safeId(),
      categoryName: selectedCategory.name,
    };
    setAdvanceForm((current) => ({
      ...current,
      items: [...current.items, nextItem],
    }));
  };

  const removeAdvanceItem = (itemId: string) => {
    setAdvanceForm((current) => ({
      ...current,
      items: current.items.filter((item) => item.id !== itemId),
    }));
  };

  const logAdministrativeEvent = async (advanceId: string, type: string, payload: Record<string, any> = {}) => {
    await addDoc(collection(db, 'projects', projectId, 'administrativeEvents'), {
      projectId,
      advanceId,
      type,
      actorId: currentUser?.uid || null,
      actorName: getCurrentUserName(currentUser),
      createdAt: serverTimestamp(),
      ...payload,
    });
  };

  const openReceiptEditor = (mode: ReceiptEditorMode, advance: TravelAdvance, receipt: AdvanceReceipt) => {
    setReceiptEditor({ mode, advance, receipt });
    setReceiptEditorForm(buildReceiptEditorForm(receipt, advance));
    setReviewComment('');
    setReceiptCorrectionFile(null);
    setReceiptReplacementFile(null);
    setReceiptSupportAction(null);
  };

  const updateReceiptEditorForm = (patch: Partial<ReceiptEditorForm>) => {
    setReceiptEditorForm((current) => current ? { ...current, ...patch } : current);
  };

  const closeReceiptEditor = () => {
    setReceiptEditor(null);
    setReceiptEditorForm(null);
    setReceiptCorrectionFile(null);
    setReceiptReplacementFile(null);
    setReceiptSupportAction(null);
  };

  const getReceiptEditorChanges = (
    receipt: AdvanceReceipt,
    form: ReceiptEditorForm
  ): ReceiptFieldChange[] => {
    const original = buildReceiptEditorForm(receipt, receiptEditor?.advance);
    const changes: ReceiptFieldChange[] = [];

    RECEIPT_EDITABLE_FIELDS.forEach(({ key, label }) => {
      const normalizeValue = (value: any) => {
        if (key === 'amount') return asNumber(value);
        if (key === 'cufe') return normalizeCufe(String(value || ''));
        return String(value || '').trim();
      };
      const previousValue = normalizeValue(original[key]);
      const nextValue = normalizeValue(form[key]);
      if (previousValue === nextValue) return;

      if (key === 'categoryId') {
        changes.push({
          field: key,
          label,
          previousValue: categoryOptions.find((category) => category.id === previousValue)?.name || previousValue,
          nextValue: categoryOptions.find((category) => category.id === nextValue)?.name || nextValue,
        });
        return;
      }

      if (key === 'costCenterId') {
        changes.push({
          field: key,
          label,
          previousValue: costCenterOptions.find((center) => center.id === previousValue)?.name || previousValue,
          nextValue: costCenterOptions.find((center) => center.id === nextValue)?.name || nextValue,
        });
        return;
      }

      changes.push({ field: key, label, previousValue, nextValue });
    });

    return changes;
  };

  const verifyReceiptAgainstDianAuditBase = () => {
    if (!receiptEditorForm) return;
    if (activeDianAuditRows.length === 0) {
      toast.error('Primero carga o conserva una base vigente en Auditoría DIAN.');
      return;
    }
    const receiptForAudit: AdvanceReceipt = {
      id: receiptEditor?.receipt.id || 'receipt-editor',
      documentType: getReceiptDocumentType(receiptEditorForm.documentType),
      categoryId: receiptEditorForm.categoryId,
      categoryName: categoryOptions.find((category) => category.id === receiptEditorForm.categoryId)?.name || '',
      amount: asNumber(receiptEditorForm.amount),
      date: receiptEditorForm.date,
      businessName: receiptEditorForm.businessName,
      taxId: receiptEditorForm.taxId,
      invoiceNumber: receiptEditorForm.invoiceNumber,
      cufe: normalizeCufe(receiptEditorForm.cufe),
      status: receiptEditor?.receipt.status || 'submitted',
      createdAt: receiptEditor?.receipt.createdAt || new Date().toISOString(),
    };
    const hasIdentity = getDianAuditReceiptKeyCandidates(receiptForAudit).length > 0;
    if (!hasIdentity) {
      toast.error('Ingresa CUFE, número de factura con NIT, o proveedor y valor para cruzar contra la base DIAN.');
      return;
    }

    const insight = findDianAuditInsight(receiptForAudit, activeDianAuditRows);
    if (!insight.match) {
      setReceiptEditorForm((current) => current ? {
        ...current,
        dianVerificationStatus: 'failed',
        dianLookupOpenedAt: new Date().toISOString(),
      } : current);
      toast.error(insight.message);
      return;
    }

    const matchedCufe = normalizeCufe(insight.match.cufe || receiptForAudit.cufe || '');
    setReceiptEditorForm((current) => current ? {
      ...current,
      cufe: current.cufe || matchedCufe,
      dianVerificationStatus: 'confirmed',
      dianVerifiedAt: new Date().toISOString(),
      dianLookupOpenedAt: new Date().toISOString(),
      dianDocumentUrl: matchedCufe ? buildDianDocumentUrl(matchedCufe) : current.dianDocumentUrl,
      dianVerificationSource: 'audit_base',
    } : current);
    if (insight.creditNotes.length > 0) {
      toast.warning(`${insight.message} La factura quedará marcada para revisión en Auditoría DIAN.`);
    } else {
      toast.success(`Factura cruzada contra la base DIAN vigente: ${activeDianAuditFileName || 'base cargada'}.`);
    }
  };

  const handleCreateAdvance = async () => {
    if (!canCreateAdvance) {
      toast.error('No tienes permisos para crear anticipos.');
      return;
    }
    const destination = [advanceForm.municipality, advanceForm.department].filter(Boolean).join(', ');
    if (!advanceForm.requesterId || !destination || !advanceForm.purpose.trim()) {
      toast.error('Completa solicitante, departamento, municipio y justificación.');
      return;
    }
    if (advanceForm.items.length === 0) {
      toast.error('Agrega al menos un ítem del anticipo.');
      return;
    }

    const customId = advanceForm.customId.trim();
    if (
      customId &&
      advances.some((advance) => String(advance.customId || '').trim().toLowerCase() === customId.toLowerCase())
    ) {
      toast.error('Ya existe un anticipo con ese ID en este proyecto.');
      return;
    }

    const requester = teamMembers.find((member) => member.id === advanceForm.requesterId);
    // The request is signed by the current Auth user, so persist the canonical
    // session email that the database binds to the authenticated JWT.
    const requesterEmail = currentUser?.email || requester?.email || '';
    if (!requesterMatchesCurrentActor(advanceForm.requesterId, requesterEmail)) {
      toast.error('El solicitante debe coincidir con la persona que inició sesión y firma el anticipo.');
      return;
    }
    const requesterSignature = buildCurrentSignatureSnapshot();
    if (!requesterSignature) {
      toast.error('Antes de solicitar el anticipo debes cargar tu firma en Mi perfil.');
      return;
    }
    const selectedCostCenter = costCenterOptions.find((center) => center.id === advanceForm.costCenterId);
    if (!selectedCostCenter) {
      toast.error('Selecciona un centro de costos para el anticipo.');
      return;
    }
    const selectedTaskIds = Array.from(new Set(advanceForm.taskIds.filter(Boolean)));
    const selectedTasks = tasks.filter((task) => selectedTaskIds.includes(task.id));
    const amountRequested = advanceForm.items.reduce((sum, item) => sum + asNumber(item.amount), 0);
    const selectedCostCenterId = selectedCostCenter.id.startsWith('default-cost-center-')
      ? null
      : selectedCostCenter.id;
    const selectedCostCenterAllocation: CostCenterAllocation = {
      ...buildDefaultCostCenter(amountRequested, {
        id: selectedCostCenter.id,
        name: selectedCostCenter.name,
      }),
      domainId: selectedCostCenterId || undefined,
    };

    setSubmitting(true);
    try {
      const docRef = await addDoc(collection(db, 'projects', projectId, 'advanceRequests'), {
        projectId,
        customId: customId || null,
        customIdNormalized: customId ? customId.toLowerCase() : null,
        requesterId: advanceForm.requesterId,
        requesterName: requester ? getMemberLabel(requester) : getCurrentUserName(currentUser),
        requesterEmail,
        requesterSignature,
        destination,
        department: advanceForm.department || null,
        municipality: advanceForm.municipality || null,
        purpose: advanceForm.purpose.trim(),
        travelStart: advanceForm.travelStart,
        travelEnd: advanceForm.travelEnd,
        taskIds: selectedTaskIds,
        taskTitles: selectedTasks.map((task) => getTaskTitle(task)),
        taskId: selectedTasks[0]?.id || null,
        taskTitle: selectedTasks[0] ? getTaskTitle(selectedTasks[0]) : null,
        status: 'submitted',
        items: advanceForm.items,
        receipts: [],
        amountRequested,
        amountApproved: 0,
        amountLegalized: 0,
        amountReturned: 0,
        returnComment: '',
        costCenterId: selectedCostCenterId,
        costCenterName: selectedCostCenter.name,
        costCenters: normalizeCostCenters([selectedCostCenterAllocation], amountRequested),
        balance: amountRequested,
        pendingRole: 'administrative_validation',
        nextAction: 'validate_advance',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        submittedAt: serverTimestamp(),
        createdBy: currentUser?.uid || null,
        createdByName: getCurrentUserName(currentUser),
      });

      try {
        await logAdministrativeEvent(docRef.id, 'advance_submitted', { amount: amountRequested });
      } catch (eventError) {
        console.warn('El anticipo se creó, pero no fue posible registrar el evento local de radicación:', eventError);
      }

      const notificationResult = await notifyAdvanceRequestSubmitted({
        projectId,
        advanceId: docRef.id,
      });
      if (notificationResult.ok && Number(notificationResult.notified || 0) > 0) {
        const hasPartialDelivery = Number(notificationResult.partial || 0) > 0
          || Number(notificationResult.failed || 0) > 0;
        const successMessage = `Anticipo firmado y enviado. ${notificationResult.notified} persona${notificationResult.notified === 1 ? '' : 's'} adicional${notificationResult.notified === 1 ? '' : 'es'} notificada${notificationResult.notified === 1 ? '' : 's'}.`;
        if (hasPartialDelivery) {
          toast.warning(`${successMessage} Algún canal adicional no pudo completarse.`);
        } else {
          toast.success(successMessage);
        }
      } else if (notificationResult.error) {
        toast.warning('El anticipo quedó creado, pero el aviso adicional no pudo completarse. La solicitud no se perdió.');
      } else if (Number(notificationResult.failed || 0) > 0) {
        toast.warning('El anticipo quedó creado, pero no fue posible entregar los avisos adicionales. La solicitud no se perdió.');
      } else {
        toast.success('Anticipo firmado y enviado al área administrativa.');
      }
      setIsAdvanceModalOpen(false);
    } catch (error: any) {
      console.error('Error creating advance:', error);
      toast.error(error?.message || 'No se pudo crear el anticipo.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateAdvanceFromLegalizations = async () => {
    if (!editingAdvance) return;
    const isReturnedCorrection = editingAdvance.status === 'returned';
    if (!canManage && !canValidate && !isReturnedCorrection) {
      toast.error('No tienes permisos para editar anticipos.');
      return;
    }
    let correctedRequesterSignature: AdvanceSignatureSnapshot | null = null;
    if (isReturnedCorrection) {
      if (!requesterMatchesCurrentActor(editingAdvance.requesterId, editingAdvance.requesterEmail)) {
        toast.error('Solo el solicitante original puede corregir, firmar y reenviar este anticipo.');
        return;
      }
      correctedRequesterSignature = buildCurrentSignatureSnapshot();
      if (!correctedRequesterSignature) {
        toast.error('Carga tu firma en Mi perfil antes de reenviar la corrección.');
        return;
      }
      if (advanceEditForm.items.length === 0 || advanceEditForm.items.some((item) => asNumber(item.days) <= 0 || asNumber(item.unitAmount) < 0)) {
        toast.error('Revisa los días, unidades y valores de los ítems del anticipo.');
        return;
      }
    }

    const customId = advanceEditForm.customId.trim();
    if (
      customId &&
      advances.some(
        (advance) =>
          advance.id !== editingAdvance.id &&
          String(advance.customId || '').trim().toLowerCase() === customId.toLowerCase()
      )
    ) {
      toast.error('Ya existe otro anticipo con ese ID contable en este proyecto.');
      return;
    }
    if (!advanceEditForm.department || !advanceEditForm.municipality || !advanceEditForm.purpose.trim()) {
      toast.error('Completa departamento, municipio y justificación.');
      return;
    }
    if (
      advanceEditForm.travelStart &&
      advanceEditForm.travelEnd &&
      new Date(`${advanceEditForm.travelEnd}T00:00:00`) < new Date(`${advanceEditForm.travelStart}T00:00:00`)
    ) {
      toast.error('La fecha final no puede ser anterior a la fecha inicial.');
      return;
    }

    const amountReturned = roundCurrency(advanceEditForm.amountReturned);
    const correctedRequestedAmount = roundCurrency(
      advanceEditForm.items.reduce((sum, item) => sum + asNumber(item.amount), 0)
    );
    const approvedAmount = isReturnedCorrection
      ? correctedRequestedAmount
      : asNumber(editingAdvance.amountApproved || editingAdvance.amountRequested);
    const legalizedAmount = asNumber(editingAdvance.amountLegalized);
    const maxReturnable = Math.max(0, approvedAmount - legalizedAmount);
    if (amountReturned < 0) {
      toast.error('El valor devuelto no puede ser negativo.');
      return;
    }
    if (amountReturned > maxReturnable + 0.01) {
      toast.error(`La devolución no puede superar el saldo pendiente: ${formatMoney(maxReturnable)}.`);
      return;
    }
    const costCenters = normalizeCostCenters(advanceEditForm.costCenters, approvedAmount || asNumber(editingAdvance.amountRequested));
    if (!costCentersAreBalanced(costCenters)) {
      toast.error(`Los centros de costo deben sumar 100%. Ahora suman ${editingCostCenterTotal}%.`);
      return;
    }
    const coverage = getAdvanceFinancialCoverage({
      ...editingAdvance,
      amountApproved: approvedAmount,
      amountLegalized: legalizedAmount,
      amountReturned,
    });
    const destination = [advanceEditForm.municipality, advanceEditForm.department].filter(Boolean).join(', ');
    setSubmitting(true);
    try {
      const updatePayload: any = {
        customId: customId || null,
        customIdNormalized: customId ? customId.toLowerCase() : null,
        destination,
        department: advanceEditForm.department || null,
        municipality: advanceEditForm.municipality || null,
        purpose: advanceEditForm.purpose.trim(),
        travelStart: advanceEditForm.travelStart,
        travelEnd: advanceEditForm.travelEnd,
        amountReturned,
        returnComment: advanceEditForm.returnComment.trim(),
        costCenterId: costCenters[0]?.domainId || null,
        costCenterName: costCenters[0]?.name || null,
        costCenters,
        balance: Math.max(0, coverage.balance),
        updatedAt: serverTimestamp(),
        administrativeEditedAt: serverTimestamp(),
        administrativeEditedBy: currentUser?.uid || null,
        administrativeEditedByName: getCurrentUserName(currentUser),
      };

      if (amountReturned !== asNumber(editingAdvance.amountReturned)) {
        updatePayload.returnedAt = amountReturned > 0 ? serverTimestamp() : null;
        updatePayload.returnedBy = amountReturned > 0 ? currentUser?.uid || null : null;
        updatePayload.returnedByName = amountReturned > 0 ? getCurrentUserName(currentUser) : '';
      }
      if (isReturnedCorrection) {
        updatePayload.status = 'submitted';
        updatePayload.items = advanceEditForm.items;
        updatePayload.amountRequested = correctedRequestedAmount;
        updatePayload.amountApproved = 0;
        updatePayload.amountLegalized = 0;
        updatePayload.amountReturned = 0;
        updatePayload.balance = correctedRequestedAmount;
        updatePayload.requesterSignature = correctedRequesterSignature;
        updatePayload.approvalSignature = null;
        updatePayload.paymentApprovedAt = null;
        updatePayload.paymentApprovedBy = null;
        updatePayload.paymentApprovedByName = '';
        updatePayload.nextAction = 'validate_advance';
        updatePayload.pendingRole = 'administrative_validation';
        updatePayload.inboxTargetUserId = null;
        updatePayload.submittedAt = serverTimestamp();
      }

      await updateDoc(doc(db, 'projects', projectId, 'advanceRequests', editingAdvance.id), updatePayload);

      await logAdministrativeEvent(editingAdvance.id, 'advance_administrative_updated', {
        customId: customId || null,
        destination,
        travelStart: advanceEditForm.travelStart,
        travelEnd: advanceEditForm.travelEnd,
        amountReturned,
        returnComment: advanceEditForm.returnComment.trim(),
        costCenters,
        balance: Math.max(0, coverage.balance),
        closed: false,
        resubmitted: isReturnedCorrection,
      });
      if (isReturnedCorrection) {
        await logAdministrativeEvent(editingAdvance.id, 'advance_resubmitted', {
          comment: advanceEditForm.returnComment.trim(),
        });
      }
      toast.success(
        isReturnedCorrection
          ? 'Anticipo corregido y reenviado para aprobación.'
          : 'Anticipo actualizado desde legalizaciones.'
      );
      setEditingAdvance(null);
    } catch (error: any) {
      console.error('Error updating advance from legalizations:', error);
      toast.error(error?.message || 'No se pudo actualizar el anticipo.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApproveReceipt = async () => {
    if (!receiptEditor || !receiptEditorForm || receiptEditor.mode === 'correction') return;
    const isAdministrativeResubmission = receiptEditor.mode === 'administrative';
    const hasEditorPermission = isAdministrativeResubmission ? canAdministrativelyEditReceipt : canValidate;
    if (!hasEditorPermission) {
      toast.error(
        isAdministrativeResubmission
          ? 'Solo el área administrativa puede editar una legalización aprobada.'
          : 'No tienes permisos para aprobar legalizaciones.'
      );
      return;
    }

    const latestAdvance = advances.find((advance) => advance.id === receiptEditor.advance.id) || receiptEditor.advance;
    const latestReceipt = (latestAdvance.receipts || []).find((receipt) => receipt.id === receiptEditor.receipt.id) || receiptEditor.receipt;
    if (
      isAdministrativeResubmission &&
      latestReceipt.accountingClosureId &&
      !canEditReceiptInPartialAccountingClosure(latestAdvance, latestReceipt)
    ) {
      toast.error('Esta legalización pertenece a un cierre total y ya no puede modificarse.');
      return;
    }
    if (isAdministrativeResubmission && !isApprovedReceipt(latestReceipt)) {
      toast.error('La legalización cambió de estado. Actualiza la vista antes de editarla.');
      return;
    }
    if (isAdministrativeResubmission && !reviewComment.trim()) {
      toast.error('Describe el motivo de la edición administrativa antes de reenviar.');
      return;
    }
    const category = categoryOptions.find((item) => item.id === receiptEditorForm.categoryId);
    const costCenter = costCenterOptions.find((item) => item.id === receiptEditorForm.costCenterId);
    const amount = asNumber(receiptEditorForm.amount);
    const documentType = getReceiptDocumentType(receiptEditorForm.documentType);
    const cufe = normalizeCufe(receiptEditorForm.cufe);

    if (!category || !costCenter || amount <= 0 || !receiptEditorForm.businessName.trim() || !receiptEditorForm.date) {
      toast.error('Completa tipo de gasto, centro de costos, valor, fecha y razón social.');
      return;
    }
    if (documentType === 'invoice' && category.requiresCufe && !cufe) {
      toast.error('Este tipo de gasto requiere CUFE para aprobar la factura.');
      return;
    }
    if (
      documentType === 'invoice' &&
      !isAdministrativeResubmission &&
      activeDianAuditRows.length > 0 &&
      receiptEditorForm.dianVerificationStatus !== 'confirmed'
    ) {
      toast.error('Cruza esta factura contra la base DIAN vigente antes de aprobarla.');
      return;
    }
    const receiptIdentityCandidate = {
      documentType,
      cufe,
      invoiceNumber: receiptEditorForm.invoiceNumber,
      taxId: receiptEditorForm.taxId,
      businessName: receiptEditorForm.businessName,
      amount,
      date: receiptEditorForm.date,
    };
    const duplicateCufeUsage = findDuplicateCufeUsage(receiptIdentityCandidate, latestAdvance.id, latestReceipt.id);
    if (duplicateCufeUsage) {
      toast.error(formatDuplicateReceiptUsageMessage(duplicateCufeUsage, latestAdvance.id));
      return;
    }
    const duplicateUsage = findDuplicateReceiptUsage(receiptIdentityCandidate, latestAdvance.id);
    if (duplicateUsage) {
      toast.error(`Este soporte ya fue usado en "${duplicateUsage.advanceTitle}" por ${duplicateUsage.requesterName}.`);
      return;
    }

    setSubmitting(true);
    try {
      const changes = getReceiptEditorChanges(latestReceipt, receiptEditorForm);
      const receiptForAudit: AdvanceReceipt = {
        ...latestReceipt,
        documentType,
        categoryId: category.id,
        categoryName: category.name,
        amount,
        date: receiptEditorForm.date,
        businessName: receiptEditorForm.businessName.trim(),
        taxId: receiptEditorForm.taxId.trim(),
        invoiceNumber: receiptEditorForm.invoiceNumber.trim(),
        cufe,
      };
      const auditBaseInsight =
        !isAdministrativeResubmission &&
        documentType === 'invoice' &&
        receiptEditorForm.dianVerificationSource === 'audit_base' &&
        activeDianAuditRows.length > 0
          ? findDianAuditInsight(receiptForAudit, activeDianAuditRows)
          : null;
      const status: ReceiptStatus =
        documentType === 'invoice'
          ? isAdministrativeResubmission
            ? 'audit_pending'
            : auditBaseInsight?.status === 'matched'
              ? 'audit_passed'
              : auditBaseInsight?.status === 'alert'
                ? 'audit_alert'
                : 'audit_pending'
          : isAdministrativeResubmission || changes.length > 0
            ? 'approved_modified'
            : 'approved';
      const shouldQueueDianAudit = documentType === 'invoice' && status === 'audit_pending';
      const shouldHoldDianAuditAlert = documentType === 'invoice' && status === 'audit_alert';
      const shouldClearPreviousDianAudit =
        documentType !== 'invoice' || shouldQueueDianAudit || shouldHoldDianAuditAlert;
      const shouldCreateBillingPayment = documentType !== 'invoice' || status === 'audit_passed';
      const now = new Date().toISOString();
      let billingPaymentId = latestReceipt.billingPaymentId || '';

      const approvedReceipt: AdvanceReceipt = {
        ...latestReceipt,
        documentType,
        categoryId: category.id,
        categoryName: category.name,
        costCenterId: costCenter.id,
        costCenterName: costCenter.name,
        costCenterSource:
          receiptEditor.mode === 'audit' || isAdministrativeResubmission
            ? 'administrative_edit'
            : 'manual',
        amount,
        date: receiptEditorForm.date,
        businessName: receiptEditorForm.businessName.trim(),
        taxId: receiptEditorForm.taxId.trim(),
        invoiceNumber: receiptEditorForm.invoiceNumber.trim(),
        cufe,
        description: receiptEditorForm.description.trim(),
        status,
        reviewedAt: now,
        reviewedBy: currentUser?.uid || null,
        reviewedByName: getCurrentUserName(currentUser),
        reviewComment: reviewComment.trim(),
        approvalChanges: changes,
        dianVerificationStatus:
          documentType === 'cash_receipt'
            ? 'not_applicable'
            : isAdministrativeResubmission
              ? 'pending'
              : receiptEditorForm.dianVerificationStatus,
        dianLookupOpenedAt: isAdministrativeResubmission ? '' : receiptEditorForm.dianLookupOpenedAt || '',
        dianVerifiedAt: isAdministrativeResubmission ? '' : receiptEditorForm.dianVerifiedAt || '',
        dianVerifiedBy:
          !isAdministrativeResubmission && receiptEditorForm.dianVerifiedAt
            ? currentUser?.uid || null
            : null,
        dianVerifiedByName:
          !isAdministrativeResubmission && receiptEditorForm.dianVerifiedAt
            ? getCurrentUserName(currentUser)
            : '',
        dianDocumentUrl: documentType === 'invoice' && cufe ? buildDianDocumentUrl(cufe) : '',
        dianVerificationSource:
          documentType === 'invoice' && !isAdministrativeResubmission
            ? receiptEditorForm.dianVerificationSource
            : undefined,
        accountingAuditStatus:
          documentType !== 'invoice'
            ? 'not_applicable'
            : status === 'audit_passed'
              ? 'matched'
              : status === 'audit_alert'
                ? 'alert'
                : 'pending',
        accountingAuditBatchId: auditBaseInsight ? latestDianAuditBatch?.id || '' : shouldClearPreviousDianAudit ? '' : latestReceipt.accountingAuditBatchId || '',
        accountingAuditBatchName: auditBaseInsight ? activeDianAuditFileName : shouldClearPreviousDianAudit ? '' : latestReceipt.accountingAuditBatchName || '',
        accountingAuditedAt: auditBaseInsight ? now : shouldClearPreviousDianAudit ? '' : latestReceipt.accountingAuditedAt || '',
        accountingAuditedBy: auditBaseInsight ? currentUser?.uid || null : shouldClearPreviousDianAudit ? null : latestReceipt.accountingAuditedBy || null,
        accountingAuditedByName: auditBaseInsight ? getCurrentUserName(currentUser) : shouldClearPreviousDianAudit ? '' : latestReceipt.accountingAuditedByName || '',
        accountingAuditMessage:
          auditBaseInsight?.message ||
          (shouldQueueDianAudit ? 'Factura aprobada administrativamente y pendiente de cruce con base DIAN.' : ''),
        accountingAuditSeverity: auditBaseInsight?.severity,
        accountingAuditRecommendation: auditBaseInsight?.recommendation,
        accountingAuditProviderHistory: auditBaseInsight?.providerHistory,
        accountingAuditCreditNotes: auditBaseInsight?.creditNotes,
        accountingAuditMatch: auditBaseInsight?.match
          ? {
              cufe: auditBaseInsight.match.cufe,
              invoiceNumber: auditBaseInsight.match.invoiceNumber,
              taxId: auditBaseInsight.match.taxId,
              businessName: auditBaseInsight.match.businessName,
              amount: auditBaseInsight.match.amount,
              date: auditBaseInsight.match.date,
              documentType: auditBaseInsight.match.documentType,
              rowNumber: auditBaseInsight.match.rowNumber,
            }
          : shouldClearPreviousDianAudit
            ? undefined
            : latestReceipt.accountingAuditMatch,
        billingPaymentId,
        revisions: [
          ...(latestReceipt.revisions || []),
          {
            type: status,
            actorId: currentUser?.uid || null,
            actorName: getCurrentUserName(currentUser),
            at: now,
            comment: reviewComment.trim(),
            changes,
          },
        ],
      };

      if ((shouldQueueDianAudit || shouldHoldDianAuditAlert) && billingPaymentId) {
        await updateDoc(doc(db, 'projects', projectId, 'billingPayments', billingPaymentId), {
          status: 'cancelled',
          notes: 'Costo suspendido mientras la legalización se encuentra en Auditoría DIAN.',
          updatedAt: serverTimestamp(),
        });
      }

      if (shouldCreateBillingPayment) {
        billingPaymentId = await createAdvanceReceiptBillingPayment(latestAdvance, approvedReceipt, changes);
        approvedReceipt.billingPaymentId = billingPaymentId;
      }

      const nextReceipts = (latestAdvance.receipts || []).map((item) =>
        item.id === latestReceipt.id ? approvedReceipt : item
      );
      const partialClosureSync = syncReceiptWithPartialAccountingClosure(
        { ...latestAdvance, receipts: nextReceipts },
        approvedReceipt,
        {
          now,
          actorId: currentUser?.uid || null,
          actorName: getCurrentUserName(currentUser),
          note: reviewComment.trim() || 'Legalización modificada desde el módulo administrativo.',
        }
      );
      const amountLegalized = nextReceipts
        .filter(isApprovedReceipt)
        .reduce((sum, item) => sum + asNumber(item.amount), 0);
      const amountApproved = asNumber(latestAdvance.amountApproved || latestAdvance.amountRequested);
      const coverage = getAdvanceFinancialCoverage({
        ...latestAdvance,
        amountApproved,
        amountLegalized,
      });
      const difference = coverage.balance;
      const shouldStayCompleted = latestAdvance.status === 'completed';
      const nextAdvanceStatus: TravelAdvance['status'] = shouldStayCompleted ? 'completed' : 'approved';
      const allReceiptsReadyForReconciliation = nextReceipts.every(isApprovedReceipt);
      const hasPendingAudit = nextReceipts.some(hasPendingDianAccountingAudit);
      const reconciliation = getAdvanceReconciliation({
        ...latestAdvance,
        receipts: nextReceipts,
        amountApproved,
        amountLegalized,
      });
      const reconciliationStatus: AdvanceReconciliationStatus | null = shouldStayCompleted
        ? allReceiptsReadyForReconciliation
          ? reconciliation.returnRequired > 0
            ? latestAdvance.returnSupport
              ? 'ready'
              : 'pending_return'
            : reconciliation.compensationRequired > 0
              ? latestAdvance.compensationSupport
                ? 'ready'
                : 'pending_compensation'
              : 'ready'
          : 'pending_validation'
        : latestAdvance.reconciliationStatus || null;

      await updateDoc(doc(db, 'projects', projectId, 'advanceRequests', latestAdvance.id), {
        receipts: nextReceipts,
        amountLegalized,
        balance: difference,
        status: nextAdvanceStatus,
        reconciliationStatus,
        nextAction: shouldStayCompleted
          ? hasPendingAudit
            ? 'audit_dian_receipts'
            : allReceiptsReadyForReconciliation
            ? 'reconcile_advance'
            : 'validate_receipt'
          : shouldQueueDianAudit
            ? 'audit_dian_receipts'
            : 'justify_advance',
        pendingRole: shouldStayCompleted || shouldQueueDianAudit ? 'administrative_validation' : null,
        inboxTargetUserId: shouldStayCompleted || shouldQueueDianAudit ? null : latestAdvance.requesterId,
        closedAt: null,
        ...(partialClosureSync.changed
          ? { accountingClosures: partialClosureSync.accountingClosures }
          : {}),
        updatedAt: serverTimestamp(),
      });
      await logAdministrativeEvent(
        latestAdvance.id,
        isAdministrativeResubmission
          ? shouldQueueDianAudit
            ? 'receipt_edited_and_resubmitted_to_dian_audit'
            : 'receipt_administratively_edited'
          : shouldQueueDianAudit
            ? 'receipt_pending_dian_audit'
            : status === 'approved_modified'
              ? 'receipt_approved_modified'
              : 'receipt_approved',
        {
          receiptId: latestReceipt.id,
          documentType,
          amount,
          costCenterId: costCenter.id,
          costCenterName: costCenter.name,
          billingPaymentId,
          comment: reviewComment.trim(),
          changes,
          cufeVerified: !isAdministrativeResubmission && receiptEditorForm.dianVerificationStatus === 'confirmed',
          dianDocumentUrl: documentType === 'invoice' && cufe ? buildDianDocumentUrl(cufe) : null,
          accountingClosureId: partialClosureSync.closureId || null,
          accountingClosureUpdated: partialClosureSync.changed,
          includedInAccountingClosure: partialClosureSync.includedInClosure,
        }
      );

      toast.success(
        isAdministrativeResubmission && documentType === 'invoice'
          ? 'Legalización actualizada y enviada a Auditoría DIAN.'
          : isAdministrativeResubmission
            ? 'Legalización actualizada y reenviada correctamente.'
            : receiptEditor.mode === 'audit'
              ? 'Legalización actualizada y enviada nuevamente al cruce DIAN.'
              : shouldQueueDianAudit
                ? 'Factura aprobada y enviada a Auditoría DIAN.'
                : status === 'approved_modified'
                  ? 'Soporte aprobado con modificación y costo real registrado.'
                  : 'Soporte aprobado y costo real registrado.'
      );
      setReviewComment('');
      closeReceiptEditor();
    } catch (error: any) {
      console.error('Error approving receipt:', error);
      toast.error(error?.message || 'No se pudo aprobar el soporte.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResubmitReceipt = async () => {
    if (!receiptEditor || !receiptEditorForm || receiptEditor.mode !== 'correction') return;
    const latestAdvance = advances.find((advance) => advance.id === receiptEditor.advance.id) || receiptEditor.advance;
    const latestReceipt = (latestAdvance.receipts || []).find((receipt) => receipt.id === receiptEditor.receipt.id) || receiptEditor.receipt;
    if (!canCorrectAdvanceReceipt(latestAdvance)) {
      toast.error('Solo el solicitante o el área administrativa pueden subsanar este soporte.');
      return;
    }
    if (!receiptEditorForm.correctionNote.trim()) {
      toast.error('Describe qué corregiste antes de reenviar.');
      return;
    }

    const category = categoryOptions.find((item) => item.id === receiptEditorForm.categoryId);
    const costCenter = costCenterOptions.find((item) => item.id === receiptEditorForm.costCenterId);
    const amount = asNumber(receiptEditorForm.amount);
    const documentType = getReceiptDocumentType(receiptEditorForm.documentType);
    const cufe = normalizeCufe(receiptEditorForm.cufe);
    if (!category || !costCenter || amount <= 0 || !receiptEditorForm.businessName.trim() || !receiptEditorForm.date) {
      toast.error('Completa tipo de gasto, centro de costos, valor, fecha y razón social.');
      return;
    }
    if (documentType === 'invoice' && category.requiresCufe && !cufe) {
      toast.error('Este tipo de gasto requiere CUFE para reenviar la factura.');
      return;
    }
    const receiptIdentityCandidate = {
      documentType,
      cufe,
      invoiceNumber: receiptEditorForm.invoiceNumber,
      taxId: receiptEditorForm.taxId,
      businessName: receiptEditorForm.businessName,
      amount,
      date: receiptEditorForm.date,
    };
    const duplicateCufeUsage = findDuplicateCufeUsage(receiptIdentityCandidate, latestAdvance.id, latestReceipt.id);
    if (duplicateCufeUsage) {
      toast.error(formatDuplicateReceiptUsageMessage(duplicateCufeUsage, latestAdvance.id));
      return;
    }
    const duplicateUsage = findDuplicateReceiptUsage(receiptIdentityCandidate, latestAdvance.id);
    if (duplicateUsage) {
      toast.error(`Este soporte ya fue usado en "${duplicateUsage.advanceTitle}" por ${duplicateUsage.requesterName}.`);
      return;
    }

    setSubmitting(true);
    try {
      const changes = getReceiptEditorChanges(latestReceipt, receiptEditorForm);
      let replacementFile = {
        fileName: latestReceipt.fileName,
        fileSize: latestReceipt.fileSize,
        fileUrl: latestReceipt.fileUrl,
        storagePath: latestReceipt.storagePath,
        documentId: latestReceipt.documentId,
        pdfNormalization: latestReceipt.pdfNormalization,
      };
      let replacementWasNormalized = false;
      if (receiptCorrectionFile) {
        const uploaded = await uploadReceiptDocument(
          latestAdvance,
          category,
          receiptCorrectionFile,
          receiptEditorForm.businessName || category.name,
          documentType
        );
        replacementFile = {
          fileName: uploaded.fileName,
          fileSize: uploaded.fileSize,
          fileUrl: uploaded.fileUrl,
          storagePath: uploaded.storagePath,
          documentId: uploaded.documentId,
          pdfNormalization: uploaded.pdfNormalization,
        };
        replacementWasNormalized = Boolean(uploaded.pdfNormalization);
        changes.push({
          field: 'file',
          label: 'Archivo de soporte',
          previousValue: latestReceipt.fileName || null,
          nextValue: uploaded.fileName,
        });
      }

      const now = new Date().toISOString();
      const nextReceipt: AdvanceReceipt = {
        ...latestReceipt,
        ...replacementFile,
        documentType,
        categoryId: category.id,
        categoryName: category.name,
        costCenterId: costCenter.id,
        costCenterName: costCenter.name,
        costCenterSource: 'manual',
        amount,
        date: receiptEditorForm.date,
        businessName: receiptEditorForm.businessName.trim(),
        taxId: receiptEditorForm.taxId.trim(),
        invoiceNumber: receiptEditorForm.invoiceNumber.trim(),
        cufe,
        description: receiptEditorForm.description.trim(),
        status: 'submitted',
        correctionNote: receiptEditorForm.correctionNote.trim(),
        resubmittedAt: now,
        resubmittedBy: currentUser?.uid || null,
        resubmittedByName: getCurrentUserName(currentUser),
        revisionCount: asNumber(latestReceipt.revisionCount) + 1,
        dianVerificationStatus: documentType === 'cash_receipt' ? 'not_applicable' : cufe ? 'pending' : 'not_applicable',
        dianLookupOpenedAt: '',
        dianVerifiedAt: '',
        dianVerifiedBy: null,
        dianVerifiedByName: '',
        dianDocumentUrl: documentType === 'invoice' && cufe ? buildDianDocumentUrl(cufe) : '',
        accountingAuditStatus: documentType === 'invoice' ? 'pending' : 'not_applicable',
        accountingAuditBatchId: '',
        accountingAuditBatchName: '',
        accountingAuditedAt: '',
        accountingAuditedBy: null,
        accountingAuditedByName: '',
        accountingAuditMessage: '',
        accountingAuditMatch: undefined,
        billingPaymentId: documentType === 'invoice' ? '' : latestReceipt.billingPaymentId || '',
        revisions: [
          ...(latestReceipt.revisions || []),
          {
            type: 'resubmitted',
            actorId: currentUser?.uid || null,
            actorName: getCurrentUserName(currentUser),
            at: now,
            comment: receiptEditorForm.correctionNote.trim(),
            changes,
          },
          ...(replacementWasNormalized
            ? [{
                type: 'pdf_normalized' as const,
                actorId: currentUser?.uid || null,
                actorName: getCurrentUserName(currentUser),
                at: now,
                comment: 'PDF protegido desbloqueado. Se preservó el original cifrado y se activó una copia normalizada.',
              }]
            : []),
        ],
      };
      const nextReceipts = (latestAdvance.receipts || []).map((item) =>
        item.id === latestReceipt.id ? nextReceipt : item
      );
      const amountLegalized = nextReceipts
        .filter(isApprovedReceipt)
        .reduce((sum, item) => sum + asNumber(item.amount), 0);
      const amountApproved = asNumber(latestAdvance.amountApproved || latestAdvance.amountRequested);
      const coverage = getAdvanceFinancialCoverage({
        ...latestAdvance,
        amountApproved,
        amountLegalized,
      });

      await updateDoc(doc(db, 'projects', projectId, 'advanceRequests', latestAdvance.id), {
        receipts: nextReceipts,
        amountLegalized,
        balance: Math.max(0, coverage.balance),
        status: latestAdvance.status === 'approved' ? 'approved' : 'paid',
        nextAction: 'validate_receipt',
        pendingRole: 'administrative_validation',
        inboxTargetUserId: null,
        completedAt: null,
        completedBy: null,
        completedByName: '',
        reconciliationStatus: null,
        updatedAt: serverTimestamp(),
      });
      await logAdministrativeEvent(latestAdvance.id, 'receipt_resubmitted', {
        receiptId: latestReceipt.id,
        amount,
        comment: receiptEditorForm.correctionNote.trim(),
        changes,
        pdfNormalized: replacementWasNormalized,
        protectedOriginalDocumentId: replacementFile.pdfNormalization?.originalDocumentId || null,
      });
      toast.success('Soporte subsanado y reenviado al área administrativa.');
      closeReceiptEditor();
    } catch (error: any) {
      console.error('Error resubmitting receipt:', error);
      toast.error(error?.message || 'No se pudo reenviar el soporte.');
    } finally {
      setSubmitting(false);
    }
  };

  const applyReviewAction = async () => {
    if (!reviewAction) return;
    const isDeleteAdvanceAction = reviewAction.type === 'deleteAdvance';
    const isDeleteReceiptAction = reviewAction.type === 'deleteReceipt';
    const isAdvanceDecisionAction = ['approveAdvance', 'returnAdvance', 'rejectAdvance'].includes(reviewAction.type);
    if (isDeleteAdvanceAction && !canManage) {
      toast.error('Solo administradores o coordinadores pueden eliminar anticipos.');
      return;
    }
    if (isDeleteReceiptAction && !canDeleteReceiptForUser(reviewAction.receipt, reviewAction.advance)) {
      toast.error('Solo el solicitante puede eliminar soportes sin legalizar; el área administrativa puede eliminar cualquier legalización.');
      return;
    }
    if (isDeleteReceiptAction && isApprovedReceipt(reviewAction.receipt) && !reviewComment.trim()) {
      toast.error('Indica el motivo de eliminación de la legalización aprobada.');
      return;
    }
    if (!isDeleteAdvanceAction && !isDeleteReceiptAction && !(canValidate || (isAdvanceDecisionAction && canManage))) {
      toast.error('No tienes permisos para validar este proceso.');
      return;
    }
    if ((reviewAction.type === 'returnReceipt' || reviewAction.type === 'returnAdvance') && !reviewComment.trim()) {
      toast.error('Explica qué debe corregirse antes de devolver el soporte.');
      return;
    }
    const approvalSignature = reviewAction.type === 'approveAdvance'
      ? getApprovalSignatureForAdvance(reviewAction.advance)
      : null;
    if (reviewAction.type === 'approveAdvance' && !reviewAction.advance.requesterSignature) {
      toast.error('El anticipo no tiene la firma verificable del solicitante. Devuélvelo para corrección.');
      return;
    }
    if (reviewAction.type === 'approveAdvance' && !approvalSignature) {
      toast.error('Antes de aprobar debes cargar tu firma en Mi perfil o conservar una firma aprobadora previa del anticipo.');
      return;
    }

    setSubmitting(true);
    try {
      if (reviewAction.type === 'deleteAdvance') {
        const advance = reviewAction.advance;
        const [eventSnapshot, paymentSnapshot] = await Promise.all([
          getDocs(query(collection(db, 'projects', projectId, 'administrativeEvents'), where('advanceId', '==', advance.id))),
          getDocs(query(collection(db, 'projects', projectId, 'billingPayments'), where('advanceId', '==', advance.id))),
        ]);

        await Promise.all([
          ...eventSnapshot.docs.map((snapshot) =>
            deleteDoc(doc(db, 'projects', projectId, 'administrativeEvents', snapshot.id))
          ),
          ...paymentSnapshot.docs.map((snapshot) =>
            deleteDoc(doc(db, 'projects', projectId, 'billingPayments', snapshot.id))
          ),
        ]);
        await deleteDoc(doc(db, 'projects', projectId, 'advanceRequests', advance.id));
        if (selectedAdvance?.id === advance.id) {
          setSelectedAdvance(null);
        }
        toast.success('Anticipo eliminado junto con sus pagos y trazabilidad asociada.');
      }

      if (reviewAction.type === 'approveAdvance') {
        const isReapproval = reviewAction.advance.status === 'returned';
        const reusedApprovalSignature = Boolean(isReapproval && reviewAction.advance.approvalSignature);
        const approvedAmount = asNumber(reviewAction.advance.amountRequested);
        const coverage = getAdvanceFinancialCoverage({
          ...reviewAction.advance,
          amountApproved: approvedAmount,
        });
        await updateDoc(doc(db, 'projects', projectId, 'advanceRequests', reviewAction.advance.id), {
          status: 'pending_payment',
          amountApproved: approvedAmount,
          amountReturned: coverage.returnedCash,
          balance: Math.max(0, coverage.balance),
          costCenters: normalizeCostCenters(reviewAction.advance.costCenters, approvedAmount),
          adminComment: reviewComment.trim() || null,
          approvalSignature,
          paymentApprovedAt: serverTimestamp(),
          paymentApprovedBy: currentUser?.uid || null,
          paymentApprovedByName: getCurrentUserName(currentUser),
          nextAction: 'pay_advance',
          pendingRole: 'administrative_payment',
          inboxTargetUserId: null,
          approvedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await logAdministrativeEvent(reviewAction.advance.id, isReapproval ? 'advance_reapproved' : 'advance_approved', {
          amount: approvedAmount,
          comment: reviewComment.trim(),
          reusedApprovalSignature,
        });
        toast.success(isReapproval ? 'Anticipo re-aprobado. Queda pendiente de registrar el pago.' : 'Anticipo firmado y aprobado. Queda pendiente de registrar el pago.');
      }

      if (reviewAction.type === 'returnAdvance' || reviewAction.type === 'rejectAdvance') {
        const nextStatus = reviewAction.type === 'returnAdvance' ? 'returned' : 'rejected';
        await updateDoc(doc(db, 'projects', projectId, 'advanceRequests', reviewAction.advance.id), {
          status: nextStatus,
          adminComment: reviewComment.trim(),
          amountApproved: nextStatus === 'returned' ? 0 : reviewAction.advance.amountApproved,
          approvalSignature: reviewAction.advance.approvalSignature || null,
          paymentApprovedAt: nextStatus === 'returned' ? null : reviewAction.advance.paymentApprovedAt || null,
          paymentApprovedBy: nextStatus === 'returned' ? null : reviewAction.advance.paymentApprovedBy || null,
          paymentApprovedByName: nextStatus === 'returned' ? '' : reviewAction.advance.paymentApprovedByName || '',
          nextAction: nextStatus === 'returned' ? 'correct_advance' : 'closed',
          pendingRole: null,
          inboxTargetUserId: reviewAction.advance.requesterId,
          updatedAt: serverTimestamp(),
        });
        await logAdministrativeEvent(reviewAction.advance.id, `advance_${nextStatus}`, {
          comment: reviewComment.trim(),
        });
        toast.success(nextStatus === 'returned' ? 'Anticipo devuelto para corrección.' : 'Anticipo rechazado.');
      }

      if (reviewAction.type === 'returnReceipt') {
        const advance = reviewAction.advance;
        const receipt = reviewAction.receipt;
        const now = new Date().toISOString();
        const nextReceipts = (advance.receipts || []).map((item) =>
          item.id === receipt.id
            ? {
                ...item,
                status: 'returned' as const,
                reviewedAt: now,
                reviewedBy: currentUser?.uid || null,
                reviewedByName: getCurrentUserName(currentUser),
                reviewComment: reviewComment.trim(),
                accountingAuditStatus: hasDianAccountingAuditAlert(item) ? 'alert' : item.accountingAuditStatus,
                accountingAuditMessage: hasDianAccountingAuditAlert(item)
                  ? `Devuelta desde auditoría DIAN: ${reviewComment.trim()}`
                  : item.accountingAuditMessage,
                revisions: [
                  ...(item.revisions || []),
                  {
                    type: 'returned' as const,
                    actorId: currentUser?.uid || null,
                    actorName: getCurrentUserName(currentUser),
                    at: now,
                    comment: hasDianAccountingAuditAlert(item)
                      ? `Devolución de auditoría DIAN: ${reviewComment.trim()}`
                      : reviewComment.trim(),
                  },
                ],
              }
            : item
        );
        const amountLegalized = nextReceipts
          .filter(isApprovedReceipt)
          .reduce((sum, item) => sum + asNumber(item.amount), 0);
        const amountApproved = asNumber(advance.amountApproved || advance.amountRequested);
        const coverage = getAdvanceFinancialCoverage({
          ...advance,
          amountApproved,
          amountLegalized,
        });
        await updateDoc(doc(db, 'projects', projectId, 'advanceRequests', advance.id), {
          receipts: nextReceipts,
          amountLegalized,
          balance: Math.max(0, coverage.balance),
          status: advance.status === 'approved' ? 'approved' : 'paid',
          nextAction: 'correct_receipt',
          pendingRole: null,
          inboxTargetUserId: advance.requesterId,
          completedAt: null,
          completedBy: null,
          completedByName: '',
          reconciliationStatus: null,
          updatedAt: serverTimestamp(),
        });
        await logAdministrativeEvent(advance.id, 'receipt_returned', {
          receiptId: receipt.id,
          comment: reviewComment.trim(),
        });
        toast.success('Soporte devuelto para corrección.');
      }

      if (reviewAction.type === 'deleteReceipt') {
        const latestAdvance = advances.find((advance) => advance.id === reviewAction.advance.id) || reviewAction.advance;
        const latestReceipt = (latestAdvance.receipts || []).find((receipt) => receipt.id === reviewAction.receipt.id) || reviewAction.receipt;
        if (!canDeleteReceiptForUser(latestReceipt, latestAdvance)) {
          toast.error('No tienes permisos para eliminar este soporte.');
          return;
        }
        if (isApprovedReceipt(latestReceipt) && !reviewComment.trim()) {
          toast.error('Indica el motivo de eliminación de la legalización aprobada.');
          return;
        }

        const nextReceipts = (latestAdvance.receipts || []).filter((receipt) => receipt.id !== latestReceipt.id);
        const amountLegalized = nextReceipts
          .filter(isApprovedReceipt)
          .reduce((sum, item) => sum + asNumber(item.amount), 0);
        const amountApproved = asNumber(latestAdvance.amountApproved || latestAdvance.amountRequested);
        const coverage = getAdvanceFinancialCoverage({
          ...latestAdvance,
          receipts: nextReceipts,
          amountApproved,
          amountLegalized,
        });
        const hasPendingReceipts = nextReceipts.some((receipt) => !isApprovedReceipt(receipt));
        const hasReceipts = nextReceipts.length > 0;
        const shouldStayCompleted = latestAdvance.status === 'completed';
        const deletedAt = new Date().toISOString();
        const deletedByName = getCurrentUserName(currentUser);
        const preserveDocumentArtifacts = isApprovedReceipt(latestReceipt) || Boolean(latestReceipt.accountingClosureId);

        await updateDoc(doc(db, 'projects', projectId, 'advanceRequests', latestAdvance.id), {
          receipts: nextReceipts,
          amountLegalized,
          balance: Math.max(0, coverage.balance),
          status: latestAdvance.status === 'approved' ? 'approved' : latestAdvance.status,
          nextAction: hasPendingReceipts
            ? 'validate_receipt'
            : shouldStayCompleted && hasReceipts
              ? 'reconcile_advance'
              : 'justify_advance',
          pendingRole: hasPendingReceipts ? 'administrative_validation' : null,
          inboxTargetUserId: hasPendingReceipts ? null : latestAdvance.requesterId,
          completedAt: shouldStayCompleted && !hasReceipts ? null : latestAdvance.completedAt || null,
          completedBy: shouldStayCompleted && !hasReceipts ? null : latestAdvance.completedBy || null,
          completedByName: shouldStayCompleted && !hasReceipts ? '' : latestAdvance.completedByName || '',
          reconciliationStatus: shouldStayCompleted && hasReceipts ? latestAdvance.reconciliationStatus || null : null,
          updatedAt: serverTimestamp(),
        });
        await logAdministrativeEvent(latestAdvance.id, 'receipt_deleted', {
          receiptId: latestReceipt.id,
          documentId: latestReceipt.documentId || null,
          fileName: latestReceipt.fileName || null,
          amount: asNumber(latestReceipt.amount),
          documentType: getReceiptDocumentType(latestReceipt.documentType),
          categoryId: latestReceipt.categoryId || null,
          categoryName: latestReceipt.categoryName || null,
          costCenterId: latestReceipt.costCenterId || null,
          costCenterName: latestReceipt.costCenterName || null,
          provider: latestReceipt.businessName || null,
          taxId: latestReceipt.taxId || null,
          invoiceNumber: latestReceipt.invoiceNumber || null,
          cufe: latestReceipt.cufe || null,
          statusAtDeletion: latestReceipt.status,
          receiptCreatedAt: latestReceipt.createdAt || null,
          receiptCreatedBy: latestReceipt.createdBy || null,
          receiptCreatedByName: latestReceipt.createdByName || null,
          reviewedAt: latestReceipt.reviewedAt || null,
          reviewedBy: latestReceipt.reviewedBy || null,
          reviewedByName: latestReceipt.reviewedByName || null,
          storagePath: latestReceipt.storagePath || null,
          fileUrl: latestReceipt.fileUrl || null,
          billingPaymentId: latestReceipt.billingPaymentId || null,
          accountingClosureId: latestReceipt.accountingClosureId || null,
          accountingClosureSequence: latestReceipt.accountingClosureSequence || null,
          deletedAt,
          deletedBy: currentUser?.uid || null,
          deletedByName,
          deletionReason: reviewComment.trim(),
          comment: reviewComment.trim(),
          receiptSnapshot: latestReceipt,
          preservedForAccountingClosure: Boolean(latestReceipt.accountingClosureId),
          preservedDocumentArtifacts: preserveDocumentArtifacts,
        });
        if (!preserveDocumentArtifacts) {
          await removeReceiptDocumentArtifacts(latestReceipt);
        }
        toast.success(isApprovedReceipt(latestReceipt) ? 'Legalización aprobada eliminada por el área administrativa.' : 'Soporte sin legalizar eliminado.');
      }

      setReviewAction(null);
      setReviewComment('');
    } catch (error: any) {
      console.error('Error reviewing advance action:', error);
      toast.error(error?.message || 'No se pudo completar la validación.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompleteAdvance = async (advance: TravelAdvance) => {
    if (!requesterMatchesCurrentActor(advance.requesterId, advance.requesterEmail)) {
      toast.error('Solo el solicitante original puede cerrar el anticipo y enviarlo a conciliación.');
      return;
    }

    const latestAdvance = advances.find((item) => item.id === advance.id) || advance;
    if (!isAdvanceReadyForLegalization(latestAdvance)) {
      toast.error('El anticipo debe tener su pago registrado antes de legalizarse.');
      return;
    }
    const nextReceipts = latestAdvance.receipts || [];
    if (nextReceipts.length === 0) {
      toast.error('Carga al menos un soporte antes de completar el anticipo.');
      return;
    }
    if (nextReceipts.some((receipt) => receipt.status === 'returned')) {
      toast.error('Subsanar los soportes devueltos antes de completar.');
      return;
    }
    if (!nextReceipts.every(isApprovedReceipt)) {
      const auditCount = nextReceipts.filter(hasPendingDianAccountingAudit).length;
      if (auditCount > 0) {
        toast.error(`Aún ${auditCount === 1 ? 'hay 1 factura pendiente' : `hay ${auditCount} facturas pendientes`} de auditoría DIAN.`);
        return;
      }
      const pendingCount = nextReceipts.filter((receipt) => !isApprovedReceipt(receipt)).length;
      toast.error(`Aún ${pendingCount === 1 ? 'hay 1 legalización pendiente' : `hay ${pendingCount} legalizaciones pendientes`} de aprobación administrativa.`);
      return;
    }

    const amountLegalized = nextReceipts.filter(isApprovedReceipt).reduce((sum, item) => sum + asNumber(item.amount), 0);
    const amountApproved = asNumber(latestAdvance.amountApproved || latestAdvance.amountRequested);
    const coverage = getAdvanceFinancialCoverage({
      ...latestAdvance,
      amountApproved,
      amountLegalized,
    });
    const balance = coverage.balance;
    const reconciliation = getAdvanceReconciliation({
      ...latestAdvance,
      receipts: nextReceipts,
      amountApproved,
      amountLegalized,
    });
    const reconciliationStatus: AdvanceReconciliationStatus = reconciliation.returnRequired > 0
      ? latestAdvance.returnSupport
        ? 'ready'
        : 'pending_return'
      : reconciliation.compensationRequired > 0
        ? latestAdvance.compensationSupport
          ? 'ready'
          : 'pending_compensation'
        : 'ready';

    setSubmitting(true);
    try {
      await updateDoc(doc(db, 'projects', projectId, 'advanceRequests', latestAdvance.id), {
        amountLegalized,
        balance,
        status: 'completed',
        reconciliationStatus,
        nextAction: 'reconcile_advance',
        pendingRole: 'administrative_validation',
        inboxTargetUserId: null,
        completedAt: serverTimestamp(),
        completedBy: currentUser?.uid || null,
        completedByName: getCurrentUserName(currentUser),
        closedAt: null,
        updatedAt: serverTimestamp(),
      });
      await logAdministrativeEvent(latestAdvance.id, 'advance_completed_by_requester', {
        amountApproved,
        amountLegalized,
        amountReturned: coverage.returnedCash,
        balance,
      });
      if (reconciliation.returnRequired > 0) {
        setReconciliationAdvance({
          ...latestAdvance,
          receipts: nextReceipts,
          amountLegalized,
          status: 'completed',
          reconciliationStatus,
        });
        setReconciliationFile(null);
        setReconciliationForm({ date: todayInputValue(), reference: '', note: '' });
        toast.success('Justificación cerrada. Adjunta ahora el soporte de devolución para enviarla a conciliación.');
      } else if (reconciliation.compensationRequired > 0) {
        toast.success('Justificación cerrada. La compensación quedó pendiente del área administrativa en Conciliación.');
      } else {
        toast.success('Justificación cerrada y enviada a conciliación.');
      }
    } catch (error: any) {
      console.error('Error completing advance:', error);
      toast.error(error?.message || 'No se pudo completar el anticipo.');
    } finally {
      setSubmitting(false);
    }
  };

  const openAdvancePayment = (advance: TravelAdvance) => {
    const paymentSummary = getAdvancePaymentSummary(advance);
    setPaymentAdvance(advance);
    setPaymentFile(null);
    setPaymentForm({
      customId: advance.customId || '',
      amount: String(paymentSummary.balance || paymentSummary.approved || ''),
      date: todayInputValue(),
      reference: '',
      note: '',
    });
  };

  const uploadAdvancePaymentSupport = async (advance: TravelAdvance, file: File) => {
    const uploadDate = new Date();
    const advanceFolderName = advance.customId
      ? `${advance.customId} - ${advance.destination || advance.purpose || 'Anticipo'}`
      : `${advance.destination || advance.purpose || 'Anticipo'} - ${advance.id.slice(0, 8)}`;
    const managedPrefix = `managed-advance-${advance.id}`;
    const { folders: indexedFolders, leafFolderId } = await ensureManagedDocumentFolderPath({
      projectId,
      userId: currentUser?.uid || null,
      segments: [
        { id: 'managed-administrativo', name: 'Administrativo', accessMode: 'all', metadata: { documentContext: 'administration' } },
        { id: 'managed-administrativo-anticipos', name: 'Anticipos', accessMode: 'inherit', metadata: { documentContext: 'advanceRepository' } },
        { id: managedPrefix, name: advanceFolderName, accessMode: 'inherit', metadata: { administrativeRequestId: advance.id, documentContext: 'advanceRepository' } },
        { id: `${managedPrefix}-pago`, name: 'Pago', accessMode: 'inherit', metadata: { administrativeRequestId: advance.id, documentContext: 'advancePayment' } },
      ],
    });
    const projectFolderSegments = getDocumentFolderStorageSegments(leafFolderId, indexedFolders);
    let storagePath = buildDocumentStoragePath({
      projectId,
      projectName: project?.name,
      fileName: file.name,
      documentName: `soporte-pago-${advance.customId || advance.id}`,
      date: uploadDate,
      folderName: 'administrativo',
      folderSegments: ['anticipos', advance.id, 'pago'],
    });
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, file);
    storagePath = storageRef.fullPath;
    const fileUrl = await getDownloadURL(storageRef);
    const documentRef = await addDoc(collection(db, 'projects', projectId, 'documents'), {
      projectId,
      name: file.name,
      documentName: `Soporte de pago ${advance.customId || advance.id}`,
      type: 'Soporte de pago de anticipo',
      itemKind: 'file',
      scope: 'project',
      parentFolderId: leafFolderId,
      projectFolderSegments,
      administrativeRequestId: advance.id,
      documentContext: 'advancePayment',
      url: fileUrl,
      downloadURL: fileUrl,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type || 'application/octet-stream',
      storagePath,
      storageFolder: storagePath.split('/').slice(0, -1).join('/'),
      uploadedAt: serverTimestamp(),
      uploadedBy: currentUser?.uid || null,
      uploadedByName: getCurrentUserName(currentUser),
      createdAt: serverTimestamp(),
      accessMode: 'inherit',
      allowedMemberIds: [],
      accessPolicyVersion: 'folder-inheritance-v1',
      providerPathVersion: 'structured-v2',
    });
    return { fileUrl, storagePath, documentId: documentRef.id };
  };

  const handleRegisterAdvancePayment = async () => {
    if (!paymentAdvance || !canValidate) {
      toast.error('No tienes permisos para registrar pagos de anticipos.');
      return;
    }
    const latestAdvance = advances.find((advance) => advance.id === paymentAdvance.id) || paymentAdvance;
    if (!canAdvanceReceivePayment(latestAdvance)) {
      toast.error('Este anticipo no tiene saldo pendiente de pago.');
      return;
    }
    if (!paymentFile) {
      toast.error('Carga el soporte del pago realizado.');
      return;
    }
    const amount = roundCurrency(paymentForm.amount);
    const currentPaymentSummary = getAdvancePaymentSummary(latestAdvance);
    const approvedAmount = currentPaymentSummary.approved;
    const previousPaidAmount = currentPaymentSummary.paid;
    const pendingAmount = currentPaymentSummary.balance || approvedAmount;
    const customId = paymentForm.customId.trim();
    if (!customId) {
      toast.error('Asigna el ID administrativo del anticipo antes de registrar el pago.');
      return;
    }
    if (
      advances.some(
        (advance) => advance.id !== latestAdvance.id && String(advance.customId || '').trim().toLowerCase() === customId.toLowerCase()
      )
    ) {
      toast.error('Ya existe otro anticipo con ese ID administrativo.');
      return;
    }
    if (amount <= 0) {
      toast.error('El valor del pago o abono debe ser mayor a cero.');
      return;
    }
    if (amount - pendingAmount > 0.01) {
      toast.error(`El pago no puede superar el saldo pendiente: ${formatMoney(pendingAmount)}.`);
      return;
    }
    if (!paymentForm.date) {
      toast.error('Selecciona la fecha del pago.');
      return;
    }

    setSubmitting(true);
    try {
      const identifiedAdvance = { ...latestAdvance, customId };
      const uploaded = await uploadAdvancePaymentSupport(identifiedAdvance, paymentFile);
      const paymentRef = await addDoc(collection(db, 'projects', projectId, 'billingPayments'), {
        projectId,
        description: `Pago de anticipo ${customId}`,
        vendor: latestAdvance.requesterName,
        recipientId: latestAdvance.requesterId,
        recipientEmail: latestAdvance.requesterEmail || '',
        amount,
        date: new Date(`${paymentForm.date}T00:00:00`),
        status: 'paid',
        source: 'advance_disbursement',
        advanceId: latestAdvance.id,
        reference: paymentForm.reference.trim() || null,
        notes: paymentForm.note.trim() || null,
        supportDocumentId: uploaded.documentId,
        supportStoragePath: uploaded.storagePath,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: currentUser?.uid || null,
      });
      const paymentSupport: AdvancePaymentSupport = {
        documentId: uploaded.documentId,
        fileName: paymentFile.name,
        fileSize: paymentFile.size,
        fileUrl: uploaded.fileUrl,
        storagePath: uploaded.storagePath,
        amount,
        date: paymentForm.date,
        reference: paymentForm.reference.trim() || undefined,
        note: paymentForm.note.trim() || undefined,
        billingPaymentId: paymentRef.id,
        paidAt: new Date().toISOString(),
        paidBy: currentUser?.uid || null,
        paidByName: getCurrentUserName(currentUser),
        sequence: currentPaymentSummary.supports.length + 1,
        kind: amount + 0.01 >= pendingAmount ? (previousPaidAmount > 0 ? 'final' : 'full') : 'partial',
      };
      const totalPaid = roundCurrency(previousPaidAmount + amount);
      const paymentBalance = Math.max(0, roundCurrency(approvedAmount - totalPaid));
      const paymentProgress = approvedAmount > 0 ? Math.min(100, Math.round((totalPaid / approvedAmount) * 100)) : 0;
      const fullyPaid = paymentBalance <= 0.01;
      await updateDoc(doc(db, 'projects', projectId, 'advanceRequests', latestAdvance.id), {
        customId,
        customIdNormalized: customId.toLowerCase(),
        status: fullyPaid ? 'paid' : 'partially_paid',
        paymentSupport,
        paymentSupports: arrayUnion(paymentSupport),
        amountPaid: totalPaid,
        paymentBalance,
        paymentProgress,
        paidAt: fullyPaid ? serverTimestamp() : latestAdvance.paidAt || null,
        nextAction: 'justify_advance',
        pendingRole: null,
        inboxTargetUserId: latestAdvance.requesterId,
        updatedAt: serverTimestamp(),
      });
      await logAdministrativeEvent(latestAdvance.id, 'advance_paid', {
        amount,
        totalPaid,
        paymentBalance,
        paymentProgress,
        customId,
        date: paymentForm.date,
        reference: paymentForm.reference.trim(),
        documentId: uploaded.documentId,
      });
      toast.success(
        fullyPaid
          ? 'Pago registrado. El anticipo quedó pagado al 100% y disponible para legalización.'
          : `Abono registrado (${paymentProgress}%). El anticipo ya permite legalizaciones y queda pendiente por ${formatMoney(paymentBalance)}.`
      );
      setPaymentAdvance(null);
      setPaymentFile(null);
    } catch (error: any) {
      console.error('Error registering advance payment:', error);
      toast.error(error?.message || 'No se pudo registrar el pago del anticipo.');
    } finally {
      setSubmitting(false);
    }
  };

  const openReconciliationSupport = (advance: TravelAdvance) => {
    setReconciliationAdvance(advance);
    setReconciliationFile(null);
    setReconciliationForm({ date: todayInputValue(), reference: '', note: '' });
  };

  const uploadAdvanceReconciliationSupport = async (
    advance: TravelAdvance,
    file: File,
    kind: 'return' | 'compensation',
    amount: number
  ) => {
    const uploadDate = new Date();
    const advanceFolderName = advance.customId
      ? `${advance.customId} - ${advance.destination || advance.purpose || 'Anticipo'}`
      : `${advance.destination || advance.purpose || 'Anticipo'} - ${advance.id.slice(0, 8)}`;
    const managedPrefix = `managed-advance-${advance.id}`;
    const folderName = kind === 'return' ? 'Devolución' : 'Compensación';
    const documentContext = kind === 'return' ? 'advanceReturn' : 'advanceCompensation';
    const { folders: indexedFolders, leafFolderId } = await ensureManagedDocumentFolderPath({
      projectId,
      userId: currentUser?.uid || null,
      segments: [
        { id: 'managed-administrativo', name: 'Administrativo', accessMode: 'all', metadata: { documentContext: 'administration' } },
        { id: 'managed-administrativo-anticipos', name: 'Anticipos', accessMode: 'inherit', metadata: { documentContext: 'advanceRepository' } },
        { id: managedPrefix, name: advanceFolderName, accessMode: 'inherit', metadata: { administrativeRequestId: advance.id, documentContext: 'advanceRepository' } },
        { id: `${managedPrefix}-conciliacion`, name: 'Conciliación', accessMode: 'inherit', metadata: { administrativeRequestId: advance.id, documentContext: 'advanceReconciliation' } },
        { id: `${managedPrefix}-conciliacion-${kind}`, name: folderName, accessMode: 'inherit', metadata: { administrativeRequestId: advance.id, documentContext } },
      ],
    });
    const projectFolderSegments = getDocumentFolderStorageSegments(leafFolderId, indexedFolders);
    let storagePath = buildDocumentStoragePath({
      projectId,
      projectName: project?.name,
      fileName: file.name,
      documentName: `soporte-${kind}-${advance.customId || advance.id}`,
      date: uploadDate,
      folderName: 'administrativo',
      folderSegments: ['anticipos', advance.id, 'conciliacion', kind],
    });
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, file);
    storagePath = storageRef.fullPath;
    const fileUrl = await getDownloadURL(storageRef);
    const documentRef = await addDoc(collection(db, 'projects', projectId, 'documents'), {
      projectId,
      name: file.name,
      documentName: `Soporte de ${folderName.toLowerCase()} ${advance.customId || advance.id}`,
      type: `Soporte de ${folderName.toLowerCase()} de anticipo`,
      itemKind: 'file',
      scope: 'project',
      parentFolderId: leafFolderId,
      projectFolderSegments,
      administrativeRequestId: advance.id,
      documentContext,
      reconciliationKind: kind,
      reconciliationAmount: amount,
      url: fileUrl,
      downloadURL: fileUrl,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type || 'application/octet-stream',
      storagePath,
      storageFolder: storagePath.split('/').slice(0, -1).join('/'),
      uploadedAt: serverTimestamp(),
      uploadedBy: currentUser?.uid || null,
      uploadedByName: getCurrentUserName(currentUser),
      createdAt: serverTimestamp(),
      accessMode: 'inherit',
      allowedMemberIds: [],
      accessPolicyVersion: 'folder-inheritance-v1',
      providerPathVersion: 'structured-v2',
    });
    return { documentId: documentRef.id, fileUrl, storagePath };
  };

  const handleSaveReconciliationSupport = async () => {
    if (!reconciliationAdvance || !reconciliationFile) return;
    const latestAdvance = advances.find((advance) => advance.id === reconciliationAdvance.id) || reconciliationAdvance;
    if (!['completed', 'closed'].includes(latestAdvance.status) || (!latestAdvance.completedAt && latestAdvance.status !== 'closed')) {
      toast.error('El solicitante debe cerrar primero el anticipo antes de registrar la conciliación.');
      return;
    }
    const reconciliation = getAdvanceReconciliation(latestAdvance);
    const kind = reconciliation.returnRequired > 0 ? 'return' : 'compensation';
    const amount = kind === 'return' ? reconciliation.returnRequired : reconciliation.compensationRequired;
    if (kind === 'compensation' && !canValidate) {
      toast.error('La compensación solo puede ser cargada por el área administrativa.');
      return;
    }
    if (kind === 'return' && !canCorrectAdvanceReceipt(latestAdvance) && !canManage && !canValidate) {
      toast.error('No tienes permisos para registrar esta devolución.');
      return;
    }
    if (amount <= 0) {
      toast.error('Este anticipo no requiere soporte de devolución ni compensación.');
      return;
    }
    if (!reconciliationForm.date) {
      toast.error('Selecciona la fecha del movimiento.');
      return;
    }

    setSubmitting(true);
    try {
      const uploaded = await uploadAdvanceReconciliationSupport(latestAdvance, reconciliationFile, kind, amount);
      let compensationPaymentId = latestAdvance.compensationSupport?.billingPaymentId || '';
      if (kind === 'compensation') {
        const compensationPayment = {
          projectId,
          description: `Compensación anticipo ${latestAdvance.customId || latestAdvance.id}`,
          vendor: latestAdvance.requesterName,
          recipientId: latestAdvance.requesterId,
          recipientEmail: latestAdvance.requesterEmail || '',
          amount,
          date: new Date(`${reconciliationForm.date}T00:00:00`),
          status: 'paid',
          source: 'advance_compensation',
          advanceId: latestAdvance.id,
          reference: reconciliationForm.reference.trim() || null,
          notes: reconciliationForm.note.trim() || null,
          supportDocumentId: uploaded.documentId,
          supportStoragePath: uploaded.storagePath,
          updatedAt: serverTimestamp(),
        };
        if (compensationPaymentId) {
          await updateDoc(doc(db, 'projects', projectId, 'billingPayments', compensationPaymentId), compensationPayment);
        } else {
          const paymentRef = await addDoc(collection(db, 'projects', projectId, 'billingPayments'), {
            ...compensationPayment,
            createdAt: serverTimestamp(),
            createdBy: currentUser?.uid || null,
          });
          compensationPaymentId = paymentRef.id;
        }
      }
      const support: AdvanceReconciliationSupport = {
        ...uploaded,
        fileName: reconciliationFile.name,
        fileSize: reconciliationFile.size,
        amount,
        date: reconciliationForm.date,
        reference: reconciliationForm.reference.trim() || undefined,
        note: reconciliationForm.note.trim() || undefined,
        billingPaymentId: compensationPaymentId || undefined,
        uploadedAt: new Date().toISOString(),
        uploadedBy: currentUser?.uid || null,
        uploadedByName: getCurrentUserName(currentUser),
      };
      await updateDoc(doc(db, 'projects', projectId, 'advanceRequests', latestAdvance.id), {
        ...(kind === 'return'
          ? { returnSupport: support, amountReturned: amount, returnedAt: serverTimestamp(), returnedBy: currentUser?.uid || null, returnedByName: getCurrentUserName(currentUser) }
          : { compensationSupport: support, amountCompensated: amount }),
        reconciliationStatus: 'ready',
        nextAction: 'reconcile_advance',
        pendingRole: 'administrative_validation',
        updatedAt: serverTimestamp(),
      });
      await logAdministrativeEvent(latestAdvance.id, kind === 'return' ? 'advance_return_support_uploaded' : 'advance_compensation_uploaded', {
        amount,
        documentId: uploaded.documentId,
        date: reconciliationForm.date,
        reference: reconciliationForm.reference.trim(),
      });
      toast.success(kind === 'return' ? 'Soporte de devolución cargado e indexado.' : 'Compensación cargada e indexada.');
      setReconciliationAdvance(null);
      setReconciliationFile(null);
    } catch (error: any) {
      console.error('Error saving reconciliation support:', error);
      toast.error(error?.message || 'No se pudo guardar el soporte de conciliación.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFinalizeReconciliation = async (advance: TravelAdvance) => {
    if (!canValidate) {
      toast.error('Solo el área administrativa puede conciliar y cerrar el anticipo.');
      return;
    }
    const latestAdvance = advances.find((item) => item.id === advance.id) || advance;
    if (!['completed', 'closed'].includes(latestAdvance.status) || (!latestAdvance.completedAt && latestAdvance.status !== 'closed')) {
      toast.error('Este anticipo todavía no ha sido cerrado por el solicitante.');
      return;
    }
    const openReceipts = (latestAdvance.receipts || []).some((receipt) => !isApprovedReceipt(receipt));
    if (openReceipts) {
      toast.error('Primero revisa todos los soportes de la justificación.');
      return;
    }
    const reconciliation = getAdvanceReconciliation(latestAdvance);
    if (reconciliation.returnRequired > 0 && !latestAdvance.returnSupport) {
      toast.error('Carga el soporte de devolución antes de cerrar.');
      return;
    }
    if (
      reconciliation.returnRequired > 0 &&
      Math.abs(asNumber(latestAdvance.returnSupport?.amount) - reconciliation.returnRequired) > 0.01
    ) {
      toast.error('El soporte de devolución no coincide con el saldo actual. Cárgalo nuevamente.');
      return;
    }
    if (reconciliation.compensationRequired > 0 && !latestAdvance.compensationSupport) {
      toast.error('Carga la compensación antes de cerrar.');
      return;
    }
    if (
      reconciliation.compensationRequired > 0 &&
      Math.abs(asNumber(latestAdvance.compensationSupport?.amount) - reconciliation.compensationRequired) > 0.01
    ) {
      toast.error('El soporte de compensación no coincide con el excedente actual. Cárgalo nuevamente.');
      return;
    }

    setSubmitting(true);
    try {
      await updateDoc(doc(db, 'projects', projectId, 'advanceRequests', latestAdvance.id), {
        amountReturned: reconciliation.returnRequired,
        amountCompensated: reconciliation.compensationRequired,
        balance: 0,
        status: 'closed',
        reconciliationStatus: 'reconciled',
        reconciledAt: serverTimestamp(),
        reconciledBy: currentUser?.uid || null,
        reconciledByName: getCurrentUserName(currentUser),
        nextAction: 'closed',
        pendingRole: null,
        inboxTargetUserId: null,
        closedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await logAdministrativeEvent(latestAdvance.id, 'advance_reconciled', {
        anticipated: reconciliation.anticipated,
        justified: reconciliation.justified,
        legalized: reconciliation.legalized,
        amountReturned: reconciliation.returnRequired,
        amountCompensated: reconciliation.compensationRequired,
      });
      toast.success('Anticipo conciliado. Costos reales y expediente final habilitados.');
    } catch (error: any) {
      console.error('Error finalizing reconciliation:', error);
      toast.error(error?.message || 'No se pudo cerrar la conciliación.');
    } finally {
      setSubmitting(false);
    }
  };

  const resetReceiptForm = () => {
    setReceiptForm({
      documentType: 'invoice',
      categoryId: categoryOptions[0]?.id || '',
      costCenterId: '',
      amount: '',
      date: todayInputValue(),
      businessName: '',
      taxId: '',
      invoiceNumber: '',
      cufe: '',
      description: '',
    });
    setReceiptFile(null);
  };

  const resetAiReceiptState = () => {
    setAiReceiptDrafts([]);
    setAiAnalyzingReceipts(false);
  };

  const closeReceiptModal = () => {
    resetReceiptForm();
    resetAiReceiptState();
    setReceiptMode('manual');
    setSupportPreviewFile(null);
    setSelectedAdvance(null);
  };

  const requestPdfPassword = useCallback((request: PdfPasswordRequest) =>
    new Promise<string | null>((resolve) => {
      setPdfPasswordInput('');
      setPdfPasswordDialog({ ...request, resolve });
    }), []);

  const cancelPdfPassword = () => {
    const pending = pdfPasswordDialog;
    setPdfPasswordDialog(null);
    setPdfPasswordInput('');
    pending?.resolve(null);
  };

  const submitPdfPassword = () => {
    const password = pdfPasswordInput;
    if (!password || !pdfPasswordDialog) return;
    const pending = pdfPasswordDialog;
    setPdfPasswordDialog(null);
    setPdfPasswordInput('');
    pending.resolve(password);
  };

  const uploadReceiptDocument = async (
    advance: TravelAdvance,
    category: ExpenseCategory,
    file?: File | null,
    documentLabel?: string,
    documentType: ReceiptDocumentType = 'invoice',
    preparedPdf?: PreparedPdfUpload
  ) => {
    if (!file) {
      return {
        fileUrl: '',
        storagePath: '',
        documentId: '',
        fileName: '',
        fileSize: 0,
        uploadFile: null as File | null,
        pdfNormalization: undefined as PdfNormalizationTrace | undefined,
      };
    }

    const prepared = preparedPdf || await preparePdfForUpload(file, requestPdfPassword);
    const uploadFile = prepared.uploadFile;

    const uploadDate = new Date();
    const documentTypeMeta = getReceiptDocumentTypeMeta(documentType);
    const advanceFolderName = advance.customId
      ? `${advance.customId} - ${advance.destination || advance.purpose || 'Anticipo'}`
      : `${advance.destination || advance.purpose || 'Anticipo'} - ${advance.id.slice(0, 8)}`;
    const managedPrefix = `managed-advance-${advance.id}`;
    const { folders: indexedFolders, leafFolderId } = await ensureManagedDocumentFolderPath({
      projectId,
      userId: currentUser?.uid || null,
      segments: [
        { id: 'managed-administrativo', name: 'Administrativo', accessMode: 'all', metadata: { documentContext: 'administration' } },
        { id: 'managed-administrativo-anticipos', name: 'Anticipos', accessMode: 'inherit', metadata: { documentContext: 'advanceRepository' } },
        { id: managedPrefix, name: advanceFolderName, accessMode: 'inherit', metadata: { administrativeRequestId: advance.id, documentContext: 'advanceRepository' } },
        { id: `${managedPrefix}-${documentType}`, name: documentTypeMeta.label, accessMode: 'inherit', metadata: { administrativeRequestId: advance.id, documentType } },
        { id: `${managedPrefix}-${documentType}-${category.id}`, name: category.name, accessMode: 'inherit', metadata: { administrativeRequestId: advance.id, documentType, categoryId: category.id } },
      ],
    });
    const projectFolderSegments = getDocumentFolderStorageSegments(leafFolderId, indexedFolders);
    let originalDocumentRef: Awaited<ReturnType<typeof addDoc>> | null = null;
    let originalStoragePath = '';
    if (prepared.wasPasswordProtected && prepared.originalFile) {
      const { folders: originalFolders, leafFolderId: originalLeafFolderId } = await ensureManagedDocumentFolderPath({
        projectId,
        userId: currentUser?.uid || null,
        segments: [
          { id: 'managed-administrativo', name: 'Administrativo', accessMode: 'all', metadata: { documentContext: 'administration' } },
          { id: 'managed-administrativo-anticipos', name: 'Anticipos', accessMode: 'inherit', metadata: { documentContext: 'advanceRepository' } },
          { id: managedPrefix, name: advanceFolderName, accessMode: 'inherit', metadata: { administrativeRequestId: advance.id, documentContext: 'advanceRepository' } },
          { id: `${managedPrefix}-${documentType}`, name: documentTypeMeta.label, accessMode: 'inherit', metadata: { administrativeRequestId: advance.id, documentType } },
          { id: `${managedPrefix}-${documentType}-${category.id}`, name: category.name, accessMode: 'inherit', metadata: { administrativeRequestId: advance.id, documentType, categoryId: category.id } },
          {
            id: `${managedPrefix}-${documentType}-${category.id}-protected-originals`,
            name: 'Originales protegidos',
            accessMode: 'inherit',
            metadata: {
              administrativeRequestId: advance.id,
              documentContext: 'protectedEvidenceArchive',
              immutableEvidence: true,
            },
          },
        ],
      });
      const originalProjectFolderSegments = getDocumentFolderStorageSegments(originalLeafFolderId, originalFolders);
      originalStoragePath = buildDocumentStoragePath({
        projectId,
        projectName: project?.name,
        fileName: prepared.originalFile.name,
        documentName: `original-protegido-${advance.destination}-${documentTypeMeta.shortLabel}-${documentLabel || category.name}`,
        date: uploadDate,
        folderName: 'administrativo',
        folderSegments: ['anticipos', advance.id, documentTypeMeta.shortLabel, category.name, 'originales-protegidos'],
      });
      const originalStorageRef = ref(storage, originalStoragePath);
      await uploadBytes(originalStorageRef, prepared.originalFile);
      originalStoragePath = originalStorageRef.fullPath;
      const originalFileUrl = await getDownloadURL(originalStorageRef);
      const originalStorageFolder = originalStoragePath.split('/').slice(0, -1).join('/');
      originalDocumentRef = await addDoc(collection(db, 'projects', projectId, 'documents'), {
        projectId,
        name: prepared.originalFile.name,
        documentName: `Original protegido - ${documentTypeMeta.label} ${category.name}`,
        type: 'PDF original protegido',
        itemKind: 'file',
        scope: 'project',
        parentFolderId: originalLeafFolderId,
        projectFolderSegments: originalProjectFolderSegments,
        administrativeRequestId: advance.id,
        documentContext: 'advanceReceiptProtectedOriginal',
        documentType,
        documentTypeLabel: documentTypeMeta.label,
        category: category.name,
        url: originalFileUrl,
        downloadURL: originalFileUrl,
        fileName: prepared.originalFile.name,
        fileSize: prepared.originalFile.size,
        fileType: prepared.originalFile.type || 'application/pdf',
        storagePath: originalStoragePath,
        storageFolder: originalStorageFolder,
        sha256: prepared.originalSha256,
        immutableEvidence: true,
        hiddenFromDefaultView: true,
        normalizationStatus: 'source_protected',
        uploadedAt: serverTimestamp(),
        uploadedBy: currentUser?.uid || null,
        uploadedByName: getCurrentUserName(currentUser),
        createdAt: serverTimestamp(),
        accessMode: 'inherit',
        allowedMemberIds: [],
        accessPolicyVersion: 'folder-inheritance-v1',
        providerPathVersion: 'structured-v2',
      });
    }

    let storagePath = buildDocumentStoragePath({
      projectId,
      projectName: project?.name,
      fileName: uploadFile.name,
      documentName: `legalizacion-${advance.destination}-${documentTypeMeta.shortLabel}-${documentLabel || category.name}`,
      date: uploadDate,
      folderName: 'administrativo',
      folderSegments: ['anticipos', advance.id, documentTypeMeta.shortLabel, category.name],
    });
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, uploadFile);
    storagePath = storageRef.fullPath;
    const fileUrl = await getDownloadURL(storageRef);
    const storageFolder = storagePath.split('/').slice(0, -1).join('/');

    const documentRef = await addDoc(collection(db, 'projects', projectId, 'documents'), {
      projectId,
      name: uploadFile.name,
      documentName: `${documentTypeMeta.label} ${category.name}`,
      type: documentTypeMeta.label,
      itemKind: 'file',
      scope: 'project',
      parentFolderId: leafFolderId,
      projectFolderSegments,
      administrativeRequestId: advance.id,
      documentContext: 'advanceReceipt',
      documentType,
      documentTypeLabel: documentTypeMeta.label,
      category: category.name,
      url: fileUrl,
      downloadURL: fileUrl,
      fileName: uploadFile.name,
      fileSize: uploadFile.size,
      fileType: uploadFile.type || 'application/octet-stream',
      storagePath,
      storageFolder,
      sha256: prepared.wasPasswordProtected ? prepared.normalizedSha256 : prepared.originalSha256,
      normalizationStatus: prepared.wasPasswordProtected ? 'normalized' : 'not_required',
      normalizationMethod: prepared.method || null,
      normalizedAt: prepared.normalizedAt || null,
      normalizedBy: prepared.wasPasswordProtected ? currentUser?.uid || null : null,
      normalizedByName: prepared.wasPasswordProtected ? getCurrentUserName(currentUser) : '',
      sourceEvidenceDocumentId: originalDocumentRef?.id || null,
      sourceEvidenceStoragePath: originalStoragePath || null,
      sourceEvidenceSha256: prepared.wasPasswordProtected ? prepared.originalSha256 : null,
      pageCount: prepared.pageCount || null,
      uploadedAt: serverTimestamp(),
      uploadedBy: currentUser?.uid || null,
      uploadedByName: getCurrentUserName(currentUser),
      createdAt: serverTimestamp(),
      accessMode: 'inherit',
      allowedMemberIds: [],
      accessPolicyVersion: 'folder-inheritance-v1',
      providerPathVersion: 'structured-v2',
    });

    const pdfNormalization = prepared.wasPasswordProtected && originalDocumentRef && prepared.normalizedSha256 && prepared.normalizedAt
      ? {
          status: 'normalized' as const,
          method: prepared.method || 'pdfjs-rasterized-v1' as const,
          originalDocumentId: originalDocumentRef.id,
          originalStoragePath,
          originalFileName: prepared.originalFile?.name || file.name,
          originalFileSize: prepared.originalFile?.size || file.size,
          originalSha256: prepared.originalSha256,
          normalizedSha256: prepared.normalizedSha256,
          normalizedAt: prepared.normalizedAt,
          normalizedBy: currentUser?.uid || null,
          normalizedByName: getCurrentUserName(currentUser),
          pageCount: prepared.pageCount || 0,
        }
      : undefined;

    if (originalDocumentRef && pdfNormalization) {
      await updateDoc(originalDocumentRef, {
        normalizedDocumentId: documentRef.id,
        normalizedStoragePath: storagePath,
        normalizedSha256: pdfNormalization.normalizedSha256,
        normalizedAt: pdfNormalization.normalizedAt,
        updatedAt: serverTimestamp(),
      });
    }

    return {
      fileUrl,
      storagePath,
      documentId: documentRef.id,
      fileName: uploadFile.name,
      fileSize: uploadFile.size,
      uploadFile,
      pdfNormalization,
    };
  };

  const handleCreateReceipt = async () => {
    if (!selectedAdvance || (!canManage && !canCorrectAdvanceReceipt(selectedAdvance))) return;
    const category = categoryOptions.find((item) => item.id === receiptForm.categoryId);
    const costCenter = costCenterOptions.find((item) => item.id === receiptForm.costCenterId);
    const amount = asNumber(receiptForm.amount);
    if (!category || !costCenter || amount <= 0 || !receiptForm.businessName.trim()) {
      toast.error('Completa categoría, centro de costos, valor y razón social del soporte.');
      return;
    }
    if (!receiptFile) {
      toast.error('Adjunta el documento soporte antes de crear la legalización.');
      return;
    }
    const documentType = getReceiptDocumentType(receiptForm.documentType);
    const documentTypeMeta = getReceiptDocumentTypeMeta(documentType);
    if (documentType === 'invoice' && category.requiresCufe && !receiptForm.cufe.trim()) {
      toast.error('Este dominio requiere CUFE para registrar la factura.');
      return;
    }
    const latestAdvance = advances.find((advance) => advance.id === selectedAdvance.id) || selectedAdvance;
    if (!isAdvanceReadyForLegalization(latestAdvance)) {
      toast.error('El anticipo debe tener su pago registrado antes de cargar legalizaciones.');
      return;
    }
    const cufe = normalizeCufe(receiptForm.cufe);
    const receiptIdentityCandidate = {
      documentType,
      cufe,
      invoiceNumber: receiptForm.invoiceNumber,
      taxId: receiptForm.taxId,
      businessName: receiptForm.businessName,
      amount,
      date: receiptForm.date,
    };
    const duplicateCufeUsage = findDuplicateCufeUsage(receiptIdentityCandidate, latestAdvance.id);
    if (duplicateCufeUsage) {
      toast.error(formatDuplicateReceiptUsageMessage(duplicateCufeUsage, latestAdvance.id));
      return;
    }
    const duplicateUsage = findDuplicateReceiptUsage(receiptIdentityCandidate, latestAdvance.id);
    if (duplicateUsage) {
      toast.error(`Este soporte ya fue usado en "${duplicateUsage.advanceTitle}" por ${duplicateUsage.requesterName}.`);
      return;
    }

    setSubmitting(true);
    try {
      const uploaded = await uploadReceiptDocument(
        latestAdvance,
        category,
        receiptFile,
        receiptForm.businessName || category.name,
        documentType
      );

      const receipt: AdvanceReceipt = {
        id: safeId(),
        documentType,
        categoryId: category.id,
        categoryName: category.name,
        costCenterId: costCenter.id,
        costCenterName: costCenter.name,
        costCenterSource: 'manual',
        amount,
        date: receiptForm.date,
        businessName: receiptForm.businessName.trim(),
        taxId: receiptForm.taxId.trim(),
        invoiceNumber: receiptForm.invoiceNumber.trim(),
        cufe,
        description: receiptForm.description.trim(),
        fileName: uploaded.fileName,
        fileSize: uploaded.fileSize,
        fileUrl: uploaded.fileUrl,
        storagePath: uploaded.storagePath,
        documentId: uploaded.documentId,
        pdfNormalization: uploaded.pdfNormalization,
        status: 'submitted',
        createdAt: new Date().toISOString(),
        createdBy: currentUser?.uid || null,
        createdByName: getCurrentUserName(currentUser),
      };

      await updateDoc(doc(db, 'projects', projectId, 'advanceRequests', selectedAdvance.id), {
        receipts: [...(latestAdvance.receipts || []), receipt],
        status: latestAdvance.status === 'approved' ? 'approved' : 'paid',
        nextAction: 'validate_receipt',
        pendingRole: 'administrative_validation',
        inboxTargetUserId: null,
        completedAt: null,
        completedBy: null,
        completedByName: '',
        updatedAt: serverTimestamp(),
      });
      await logAdministrativeEvent(selectedAdvance.id, 'receipt_submitted', {
        receiptId: receipt.id,
        documentType,
        documentTypeLabel: documentTypeMeta.label,
        amount,
        categoryName: category.name,
        costCenterId: costCenter.id,
        costCenterName: costCenter.name,
        pdfNormalized: Boolean(uploaded.pdfNormalization),
        protectedOriginalDocumentId: uploaded.pdfNormalization?.originalDocumentId || null,
      });
      toast.success(
        uploaded.pdfNormalization
          ? 'PDF protegido desbloqueado, normalizado y cargado para validación. El original quedó preservado.'
          : 'Soporte cargado para validación.'
      );
      closeReceiptModal();
    } catch (error: any) {
      if (error instanceof PdfPasswordCancelledError) {
        toast.info(error.message);
        return;
      }
      console.error('Error creating receipt:', error);
      toast.error(error?.message || 'No se pudo guardar el soporte.');
    } finally {
      setSubmitting(false);
    }
  };

  const createAdvanceReceiptBillingPayment = async (
    advance: TravelAdvance,
    receipt: AdvanceReceipt,
    changes: ReceiptFieldChange[] = []
  ) => {
    const documentType = getReceiptDocumentType(receipt.documentType);
    const documentMeta = getReceiptDocumentTypeMeta(documentType);
    const receiptCostCenter = getReceiptCostCenter(receipt, advance);
    const paymentData = {
      projectId,
      description: `Legalización anticipo: ${receipt.categoryName}`,
      vendor: receipt.businessName?.trim() || 'Proveedor sin nombre',
      amount: asNumber(receipt.amount),
      date: new Date(`${receipt.date || todayInputValue()}T00:00:00`),
      status: 'paid',
      budgetLineId: null,
      budgetPieceId: null,
      notes: [
        documentMeta.label,
        receipt.invoiceNumber?.trim() ? `${documentMeta.numberLabel}: ${receipt.invoiceNumber.trim()}` : null,
        receipt.description?.trim(),
        receipt.cufe ? `CUFE: ${receipt.cufe}` : null,
        receipt.status === 'audit_passed' ? 'Auditoría DIAN aprobada' : null,
        changes.length > 0 ? 'Aprobado con modificación administrativa' : null,
      ].filter(Boolean).join(' · '),
      source: 'advance_receipt',
      advanceId: advance.id,
      receiptId: receipt.id,
      documentType,
      documentTypeLabel: documentMeta.label,
      expenseCategoryId: receipt.categoryId,
      costCenterId: receiptCostCenter.id || null,
      costCenterName: receiptCostCenter.name,
      costCenterSource: receiptCostCenter.provisional ? 'advance_provisional' : receipt.costCenterSource || 'manual',
      updatedAt: serverTimestamp(),
    };

    if (receipt.billingPaymentId) {
      await updateDoc(doc(db, 'projects', projectId, 'billingPayments', receipt.billingPaymentId), paymentData);
      return receipt.billingPaymentId;
    }

    const paymentRef = await addDoc(collection(db, 'projects', projectId, 'billingPayments'), {
      ...paymentData,
      createdAt: serverTimestamp(),
      createdBy: currentUser?.uid || null,
    });
    return paymentRef.id;
  };

  const handleDianAuditFileSelected = async (file: File | null) => {
    if (!file) return;

    if (!canValidate) {
      toast.error('Solo el área administrativa puede reemplazar la base DIAN.');
      return;
    }

    setSavingDianAuditBase(true);
    try {
      const rows = /\.(xlsx|xls)$/i.test(file.name)
        ? await buildDianAuditRowsFromExcelFile(file)
        : buildDianAuditRowsFromText(await file.text());
      if (rows.length === 0) {
        toast.error('No se encontraron filas válidas en la base DIAN.');
        return;
      }
      const now = new Date().toISOString();
      const creditNoteCount = rows.filter((row) => row.documentTypeKind === 'credit_note').length;
      const batchRef = await addDoc(collection(db, 'projects', projectId, 'dianAuditBatches'), {
        projectId,
        fileName: file.name,
        fileSize: file.size,
        rowCount: rows.length,
        matchedCount: 0,
        alertCount: 0,
        creditNoteCount,
        uploadedAt: serverTimestamp(),
        uploadedBy: currentUser?.uid || null,
        uploadedByName: getCurrentUserName(currentUser),
        rows: rows.slice(0, 2500),
        status: 'ready',
      });
      const savedBatch: DianAuditBatch = {
        id: batchRef.id,
        fileName: file.name,
        fileSize: file.size,
        rowCount: rows.length,
        matchedCount: 0,
        alertCount: 0,
        creditNoteCount,
        uploadedAt: now,
        uploadedBy: currentUser?.uid || null,
        uploadedByName: getCurrentUserName(currentUser),
        rows: rows.slice(0, 2500),
        status: 'ready',
      };
      setDianAuditBatches((current) => [savedBatch, ...current.filter((batch) => batch.id !== savedBatch.id)]);
      toast.success(`Base DIAN guardada y vigente: ${rows.length} fila${rows.length === 1 ? '' : 's'} y ${creditNoteCount} nota${creditNoteCount === 1 ? '' : 's'} crédito. Puedes ejecutar la auditoría cuando lo necesites.`);
    } catch (error: any) {
      console.error('Error reading DIAN audit file:', error);
      toast.error(error?.message || 'No se pudo guardar la base DIAN.');
    } finally {
      setSavingDianAuditBase(false);
    }
  };

  const handleExecuteDianAudit = async () => {
    if (!canValidate) {
      toast.error('Solo el área administrativa puede ejecutar la auditoría DIAN.');
      return;
    }
    const rowsForAudit = activeDianAuditRows;
    const auditFileName = activeDianAuditFileName;
    if (rowsForAudit.length === 0 || !auditFileName || !latestDianAuditBatch?.id) {
      toast.error('Carga primero la base DIAN en Excel, CSV o TXT.');
      return;
    }

    const candidates = auditAdvanceGroups.flatMap((group) =>
      group.receipts.map((receipt) => ({ advance: group.advance, receipt }))
    );
    if (candidates.length === 0) {
      toast.info('No hay facturas pendientes de auditoría.');
      return;
    }

    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      let matchedCount = 0;
      let alertCount = 0;
      const auditBatchRef = doc(db, 'projects', projectId, 'dianAuditBatches', latestDianAuditBatch.id);
      await updateDoc(auditBatchRef, {
        status: 'processing',
        auditStartedAt: serverTimestamp(),
      });
      const batchSummary = {
        id: auditBatchRef.id,
        fileName: auditFileName,
        rowCount: rowsForAudit.length,
        matchedCount: 0,
        alertCount: 0,
        uploadedAt: getDateValue(latestDianAuditBatch.uploadedAt)?.toISOString() || now,
        uploadedBy: latestDianAuditBatch.uploadedBy || null,
        uploadedByName: latestDianAuditBatch.uploadedByName || '',
      };

      for (const group of auditAdvanceGroups) {
        const latestAdvance = advances.find((advance) => advance.id === group.advance.id) || group.advance;
        let changed = false;
        let groupMatchedCount = 0;
        let groupAlertCount = 0;
        const changedReceiptIds = new Set<string>();
        const nextReceipts = await Promise.all((latestAdvance.receipts || []).map(async (receipt) => {
          if (!needsDianAccountingAudit(receipt)) return receipt;
          const resolvedCostCenter = getReceiptCostCenter(receipt, latestAdvance);
          const costCenterPatch = receipt.costCenterId
            ? {}
            : {
                costCenterId: resolvedCostCenter.id,
                costCenterName: resolvedCostCenter.name,
                costCenterSource: 'advance_provisional' as const,
              };
          const auditInsight = findDianAuditInsight(receipt, rowsForAudit);
          if (auditInsight.status === 'matched' && auditInsight.match) {
            matchedCount += 1;
            groupMatchedCount += 1;
            changed = true;
            changedReceiptIds.add(receipt.id);
            const auditedReceipt: AdvanceReceipt = {
              ...receipt,
              ...costCenterPatch,
              status: 'audit_passed',
              accountingAuditStatus: 'matched',
              accountingAuditBatchId: auditBatchRef.id,
              accountingAuditBatchName: auditFileName,
              accountingAuditedAt: now,
              accountingAuditedBy: currentUser?.uid || null,
              accountingAuditedByName: getCurrentUserName(currentUser),
              accountingAuditMessage: auditInsight.message,
              accountingAuditSeverity: auditInsight.severity,
              accountingAuditRecommendation: auditInsight.recommendation,
              accountingAuditProviderHistory: auditInsight.providerHistory,
              accountingAuditCreditNotes: auditInsight.creditNotes,
              accountingAuditMatch: {
                cufe: auditInsight.match.cufe,
                invoiceNumber: auditInsight.match.invoiceNumber,
                taxId: auditInsight.match.taxId,
                businessName: auditInsight.match.businessName,
                amount: auditInsight.match.amount,
                date: auditInsight.match.date,
                documentType: auditInsight.match.documentType,
                rowNumber: auditInsight.match.rowNumber,
              },
              revisions: [
                ...(receipt.revisions || []),
                {
                  type: 'audit_passed',
                  actorId: currentUser?.uid || null,
                  actorName: getCurrentUserName(currentUser),
                  at: now,
                  comment: `Cruce DIAN aprobado con ${auditFileName}, fila ${auditInsight.match.rowNumber}.`,
                },
              ],
            };
            const billingPaymentId = await createAdvanceReceiptBillingPayment(latestAdvance, auditedReceipt, auditedReceipt.approvalChanges || []);
            return { ...auditedReceipt, billingPaymentId };
          }

          alertCount += 1;
          groupAlertCount += 1;
          changed = true;
          changedReceiptIds.add(receipt.id);
          return {
            ...receipt,
            ...costCenterPatch,
            status: 'audit_alert' as const,
            accountingAuditStatus: 'alert' as const,
            accountingAuditBatchId: auditBatchRef.id,
            accountingAuditBatchName: auditFileName,
            accountingAuditedAt: now,
            accountingAuditedBy: currentUser?.uid || null,
            accountingAuditedByName: getCurrentUserName(currentUser),
            accountingAuditMessage: auditInsight.message,
            accountingAuditSeverity: auditInsight.severity,
            accountingAuditRecommendation: auditInsight.recommendation,
            accountingAuditProviderHistory: auditInsight.providerHistory,
            accountingAuditCreditNotes: auditInsight.creditNotes,
            accountingAuditMatch: auditInsight.match
              ? {
                  cufe: auditInsight.match.cufe,
                  invoiceNumber: auditInsight.match.invoiceNumber,
                  taxId: auditInsight.match.taxId,
                  businessName: auditInsight.match.businessName,
                  amount: auditInsight.match.amount,
                  date: auditInsight.match.date,
                  documentType: auditInsight.match.documentType,
                  rowNumber: auditInsight.match.rowNumber,
                }
              : undefined,
            revisions: [
              ...(receipt.revisions || []),
              {
                type: 'audit_alert' as const,
                actorId: currentUser?.uid || null,
                actorName: getCurrentUserName(currentUser),
                at: now,
                comment: `${auditInsight.message} Base: ${auditFileName}.`,
              },
            ],
          };
        }));

        if (changed) {
          let closureSyncAdvance: TravelAdvance = { ...latestAdvance, receipts: nextReceipts };
          let accountingClosureChanged = false;
          changedReceiptIds.forEach((receiptId) => {
            const changedReceipt = nextReceipts.find((receipt) => receipt.id === receiptId);
            if (!changedReceipt?.accountingClosureId) return;
            const closureSync = syncReceiptWithPartialAccountingClosure(
              closureSyncAdvance,
              changedReceipt,
              {
                now,
                actorId: currentUser?.uid || null,
                actorName: getCurrentUserName(currentUser),
                note: 'Cierre parcial actualizado después de ejecutar Auditoría DIAN.',
              }
            );
            if (closureSync.changed) {
              accountingClosureChanged = true;
              closureSyncAdvance = {
                ...closureSyncAdvance,
                accountingClosures: closureSync.accountingClosures,
              };
            }
          });
          const amountLegalized = nextReceipts.filter(isApprovedReceipt).reduce((sum, receipt) => sum + asNumber(receipt.amount), 0);
          const amountApproved = asNumber(latestAdvance.amountApproved || latestAdvance.amountRequested);
          const coverage = getAdvanceFinancialCoverage({ ...latestAdvance, receipts: nextReceipts, amountApproved, amountLegalized });
          const hasPendingAudit = nextReceipts.some(hasPendingDianAccountingAudit);
          const hasSubmittedReceipts = nextReceipts.some((receipt) => receipt.status === 'submitted');
          await updateDoc(doc(db, 'projects', projectId, 'advanceRequests', latestAdvance.id), {
            receipts: nextReceipts,
            dianAuditBatches: [
              ...(latestAdvance.dianAuditBatches || []).filter((batch) => batch.id !== batchSummary.id),
              { ...batchSummary, matchedCount: groupMatchedCount, alertCount: groupAlertCount },
            ],
            amountLegalized,
            balance: Math.max(0, coverage.balance),
            nextAction: hasSubmittedReceipts ? 'validate_receipt' : hasPendingAudit ? 'audit_dian_receipts' : 'justify_advance',
            pendingRole: hasSubmittedReceipts || hasPendingAudit ? 'administrative_validation' : null,
            inboxTargetUserId: hasSubmittedReceipts || hasPendingAudit ? null : latestAdvance.requesterId,
            reconciliationStatus: null,
            ...(accountingClosureChanged
              ? { accountingClosures: closureSyncAdvance.accountingClosures || [] }
              : {}),
            updatedAt: serverTimestamp(),
          });
        }
      }

      await updateDoc(doc(db, 'projects', projectId, 'dianAuditBatches', auditBatchRef.id), {
        matchedCount,
        alertCount,
        status: 'completed',
        completedAt: serverTimestamp(),
      });
      toast.success(`Auditoría DIAN ejecutada: ${matchedCount} factura${matchedCount === 1 ? '' : 's'} cruzada${matchedCount === 1 ? '' : 's'} y ${alertCount} en alerta.`);
    } catch (error: any) {
      console.error('Error executing DIAN audit:', error);
      toast.error(error?.message || 'No se pudo ejecutar la auditoría DIAN.');
      if (latestDianAuditBatch?.id) {
        void updateDoc(doc(db, 'projects', projectId, 'dianAuditBatches', latestDianAuditBatch.id), {
          status: 'ready',
        }).catch((restoreError) => console.warn('No se pudo restaurar el estado de la base DIAN:', restoreError));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleAcceptDianAuditAlert = async (advance: TravelAdvance, receipt: AdvanceReceipt) => {
    if (!canValidate) {
      toast.error('Solo el área administrativa puede aceptar una alerta DIAN.');
      return;
    }
    if (!receipt.accountingAuditMatch) {
      toast.error('Esta alerta no tiene coincidencia exacta en la base DIAN. Debe editarse o devolverse.');
      return;
    }

    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const latestAdvance = advances.find((item) => item.id === advance.id) || advance;
      let updatedReceiptForPayment: AdvanceReceipt | null = null;
      const nextReceipts = await Promise.all((latestAdvance.receipts || []).map(async (item) => {
        if (item.id !== receipt.id) return item;
        const acceptedReceipt: AdvanceReceipt = {
          ...item,
          status: 'audit_passed',
          accountingAuditStatus: 'matched',
          accountingAuditedAt: now,
          accountingAuditedBy: currentUser?.uid || null,
          accountingAuditedByName: getCurrentUserName(currentUser),
          accountingAuditSeverity: 'warning',
          accountingAuditMessage: `${item.accountingAuditMessage || 'Factura cruzada con alerta DIAN.'} Aceptada manualmente tras revisión administrativa.`,
          accountingAuditRecommendation: 'Alerta revisada y aceptada por administración.',
          revisions: [
            ...(item.revisions || []),
            {
              type: 'audit_passed',
              actorId: currentUser?.uid || null,
              actorName: getCurrentUserName(currentUser),
              at: now,
              comment: 'Alerta DIAN aceptada manualmente tras revisar el historial del proveedor.',
            },
          ],
        };
        const billingPaymentId = await createAdvanceReceiptBillingPayment(latestAdvance, acceptedReceipt, acceptedReceipt.approvalChanges || []);
        updatedReceiptForPayment = { ...acceptedReceipt, billingPaymentId };
        return updatedReceiptForPayment;
      }));

      if (!updatedReceiptForPayment) {
        toast.error('No se encontró la factura para aceptar la auditoría.');
        return;
      }

      const amountLegalized = nextReceipts.filter(isApprovedReceipt).reduce((sum, item) => sum + asNumber(item.amount), 0);
      const amountApproved = asNumber(latestAdvance.amountApproved || latestAdvance.amountRequested);
      const coverage = getAdvanceFinancialCoverage({ ...latestAdvance, receipts: nextReceipts, amountApproved, amountLegalized });
      const hasPendingAudit = nextReceipts.some(hasPendingDianAccountingAudit);
      const hasSubmittedReceipts = nextReceipts.some((item) => item.status === 'submitted');
      const acceptedReceipt = updatedReceiptForPayment as AdvanceReceipt;
      const partialClosureSync = syncReceiptWithPartialAccountingClosure(
        { ...latestAdvance, receipts: nextReceipts },
        acceptedReceipt,
        {
          now,
          actorId: currentUser?.uid || null,
          actorName: getCurrentUserName(currentUser),
          note: 'Cierre parcial actualizado al aceptar la revisión de Auditoría DIAN.',
        }
      );

      await updateDoc(doc(db, 'projects', projectId, 'advanceRequests', latestAdvance.id), {
        receipts: nextReceipts,
        amountLegalized,
        balance: Math.max(0, coverage.balance),
        nextAction: hasSubmittedReceipts ? 'validate_receipt' : hasPendingAudit ? 'audit_dian_receipts' : 'justify_advance',
        pendingRole: hasSubmittedReceipts || hasPendingAudit ? 'administrative_validation' : null,
        inboxTargetUserId: hasSubmittedReceipts || hasPendingAudit ? null : latestAdvance.requesterId,
        ...(partialClosureSync.changed
          ? { accountingClosures: partialClosureSync.accountingClosures }
          : {}),
        updatedAt: serverTimestamp(),
      });
      await logAdministrativeEvent(latestAdvance.id, 'receipt_dian_alert_accepted', {
        receiptId: receipt.id,
        invoiceNumber: receipt.invoiceNumber || null,
        provider: receipt.businessName || null,
      });
      toast.success('Alerta DIAN aceptada y factura habilitada para conciliación.');
    } catch (error: any) {
      console.error('Error accepting DIAN audit alert:', error);
      toast.error(error?.message || 'No se pudo aceptar la alerta DIAN.');
    } finally {
      setSubmitting(false);
    }
  };

  const openAccountingClosureEditor = (
    advance: TravelAdvance,
    closure: AdvanceAccountingClosure
  ) => {
    if (!canEditAccountingClosures) {
      toast.error('Solo el área administrativa puede editar cierres contables.');
      return;
    }

    const latestAdvance = advances.find((item) => item.id === advance.id) || advance;
    const closures = getAdvanceAccountingClosures(latestAdvance);
    const latestClosure = closures[closures.length - 1];
    if (closure.kind !== 'partial') {
      toast.info('Los cierres totales son históricos definitivos y no se pueden editar.');
      return;
    }
    if (!latestClosure || latestClosure.id !== closure.id || hasFinalAccountingClosure(latestAdvance)) {
      toast.info('Solo se puede corregir el último cierre parcial, antes de crear otro corte o el cierre total.');
      return;
    }

    setEditingAccountingClosure({ advance: latestAdvance, closure: latestClosure });
    setAccountingClosureReceiptIds(getAccountingClosureOriginalReceiptIds(latestClosure));
    setAccountingClosureEditDate(toDateInputValue(latestClosure.createdAt) || todayInputValue());
    setAccountingClosureEditNote(latestClosure.editNote || '');
  };

  const openAccountingClosureDelete = (
    advance: TravelAdvance,
    closure: AdvanceAccountingClosure
  ) => {
    if (!canDeleteAccountingClosures) {
      toast.error('No tienes permiso para eliminar cierres parciales.');
      return;
    }

    const latestAdvance = advances.find((item) => item.id === advance.id) || advance;
    const closures = getAdvanceAccountingClosures(latestAdvance);
    const latestClosure = closures[closures.length - 1];
    if (closure.kind !== 'partial') {
      toast.info('Los cierres totales son históricos definitivos y no se pueden eliminar.');
      return;
    }
    if (!latestClosure || latestClosure.id !== closure.id || hasFinalAccountingClosure(latestAdvance)) {
      toast.info('Solo se puede eliminar el último cierre parcial, antes de crear otro corte o el cierre total.');
      return;
    }

    setDeletingAccountingClosure({ advance: latestAdvance, closure: latestClosure });
  };

  const handleDeleteAccountingClosure = async () => {
    if (!deletingAccountingClosure || !canDeleteAccountingClosures) return;

    const latestAdvance = advances.find((item) => item.id === deletingAccountingClosure.advance.id) || deletingAccountingClosure.advance;
    const closures = getAdvanceAccountingClosures(latestAdvance);
    const liveClosure = closures.find((closure) => closure.id === deletingAccountingClosure.closure.id);
    const latestClosure = closures[closures.length - 1];
    if (!liveClosure || liveClosure.kind !== 'partial' || latestClosure?.id !== liveClosure.id || hasFinalAccountingClosure(latestAdvance)) {
      toast.error('Este cierre ya no se puede eliminar porque existe un corte posterior o un cierre total.');
      setDeletingAccountingClosure(null);
      return;
    }

    const releasedReceiptIds = new Set(getAccountingClosureOriginalReceiptIds(liveClosure));
    const nextClosures = closures.filter((closure) => closure.id !== liveClosure.id);
    const previousClosure = nextClosures[nextClosures.length - 1];
    const nextReceipts = (latestAdvance.receipts || []).map((receipt) => {
      const belongsToDeletedClosure =
        receipt.accountingClosureId === liveClosure.id ||
        (!receipt.accountingClosureId && releasedReceiptIds.has(receipt.id));
      if (!belongsToDeletedClosure) return receipt;

      const unclosedReceipt: AdvanceReceipt = { ...receipt };
      delete unclosedReceipt.accountingClosureId;
      delete unclosedReceipt.accountingClosureKind;
      delete unclosedReceipt.accountingClosureSequence;
      delete unclosedReceipt.accountingClosedAt;
      return unclosedReceipt;
    });

    setSubmitting(true);
    try {
      await updateDoc(doc(db, 'projects', projectId, 'advanceRequests', latestAdvance.id), {
        receipts: nextReceipts,
        accountingClosures: nextClosures,
        lastAccountingClosureAt: previousClosure?.createdAt || null,
        finalAccountingClosureId: null,
        updatedAt: serverTimestamp(),
      });
      await logAdministrativeEvent(latestAdvance.id, 'accounting_partial_close_deleted', {
        closureId: liveClosure.id,
        sequence: liveClosure.sequence,
        closureDate: liveClosure.createdAt,
        amount: liveClosure.amount,
        receiptIds: Array.from(releasedReceiptIds),
        deletedBy: currentUser?.uid || null,
        deletedByName: getCurrentUserName(currentUser),
      });
      if (editingAccountingClosure?.closure.id === liveClosure.id) {
        setEditingAccountingClosure(null);
        setAccountingClosureReceiptIds([]);
        setAccountingClosureEditDate('');
        setAccountingClosureEditNote('');
      }
      setDeletingAccountingClosure(null);
      toast.success(
        `Cierre parcial ${liveClosure.sequence} eliminado. ${releasedReceiptIds.size} factura${releasedReceiptIds.size === 1 ? '' : 's'} quedó${releasedReceiptIds.size === 1 ? '' : 'aron'} disponible${releasedReceiptIds.size === 1 ? '' : 's'} para un nuevo cierre.`
      );
    } catch (error: any) {
      console.error('Error deleting accounting closure:', error);
      toast.error(error?.message || 'No se pudo eliminar el cierre parcial.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateAccountingClosure = async () => {
    if (!editingAccountingClosure || !canEditAccountingClosures) return;

    const latestAdvance = advances.find((item) => item.id === editingAccountingClosure.advance.id) || editingAccountingClosure.advance;
    const closures = getAdvanceAccountingClosures(latestAdvance);
    const liveClosure = closures.find((closure) => closure.id === editingAccountingClosure.closure.id);
    const latestClosure = closures[closures.length - 1];
    if (!liveClosure || liveClosure.kind !== 'partial' || latestClosure?.id !== liveClosure.id || hasFinalAccountingClosure(latestAdvance)) {
      toast.error('Este cierre ya no es editable porque existe un corte posterior o un cierre total.');
      setEditingAccountingClosure(null);
      return;
    }

    const selectedClosureDate = canEditAccountingClosureDate
      ? accountingClosureEditDate.trim()
      : toDateInputValue(liveClosure.createdAt);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedClosureDate)) {
      toast.error('Selecciona una fecha válida para el cierre parcial.');
      return;
    }
    if (selectedClosureDate > todayInputValue()) {
      toast.error('La fecha del cierre parcial no puede estar en el futuro.');
      return;
    }
    const previousClosure = closures.length > 1 ? closures[closures.length - 2] : null;
    const previousClosureDate = previousClosure ? toDateInputValue(previousClosure.createdAt) : '';
    if (previousClosureDate && selectedClosureDate < previousClosureDate) {
      toast.error(`La fecha no puede ser anterior al cierre ${previousClosure?.sequence || 'previo'} (${formatDate(previousClosure?.createdAt)}).`);
      return;
    }
    const updatedClosureDate = canEditAccountingClosureDate
      ? `${selectedClosureDate}T12:00:00.000Z`
      : liveClosure.createdAt;

    const otherClosedIds = new Set<string>();
    closures
      .filter((closure) => closure.id !== liveClosure.id)
      .forEach((closure) => (closure.receiptIds || []).forEach((receiptId) => otherClosedIds.add(receiptId)));
    const now = new Date().toISOString();
    const actorName = getCurrentUserName(currentUser);
    const promotedReceipts = (latestAdvance.receipts || []).map((receipt) =>
      promoteReceiptFromCurrentDianBase(receipt, activeDianAuditRows, {
        batchId: latestDianAuditBatch?.id,
        batchName: activeDianAuditFileName,
        now,
        actorId: currentUser?.uid || null,
        actorName,
      })
    );
    const automaticallyAuditedReceiptIds = new Set(
      promotedReceipts
        .filter((receipt, index) => receipt !== (latestAdvance.receipts || [])[index])
        .map((receipt) => receipt.id)
    );
    const excludedReceipts = sortAdvanceReceiptsByInvoiceDate(
      promotedReceipts.filter((receipt) => {
        if (otherClosedIds.has(receipt.id) || isAccountingAcceptedReceipt(receipt)) return false;
        return isInvoiceReceipt(receipt) || ['submitted', 'returned', 'rejected'].includes(receipt.status);
      })
    ).map((receipt) => ({
      receipt,
      reason: getPartialClosureExclusionReason(receipt, activeDianAuditRows),
    }));
    const editableReceipts = getEditableAccountingClosureReceipts(
      liveClosure,
      promotedReceipts,
      otherClosedIds
    );
    const selectedIds = new Set(accountingClosureReceiptIds);
    let selectedReceipts = editableReceipts.filter((receipt) => selectedIds.has(receipt.id));
    if (selectedReceipts.length === 0) {
      toast.error('El cierre parcial debe conservar al menos una factura.');
      return;
    }

    setSubmitting(true);
    try {
      const billingPaymentIds = new Map<string, string>();
      for (const receipt of promotedReceipts) {
        if (!automaticallyAuditedReceiptIds.has(receipt.id)) continue;
        const billingPaymentId = await createAdvanceReceiptBillingPayment(latestAdvance, receipt, receipt.approvalChanges || []);
        billingPaymentIds.set(receipt.id, billingPaymentId);
      }
      const receiptsWithBillingPayments = promotedReceipts.map((receipt) =>
        billingPaymentIds.has(receipt.id)
          ? { ...receipt, billingPaymentId: billingPaymentIds.get(receipt.id) }
          : receipt
      );
      const editableReceiptsWithBillingPayments = getEditableAccountingClosureReceipts(
        liveClosure,
        receiptsWithBillingPayments,
        otherClosedIds
      );
      selectedReceipts = editableReceiptsWithBillingPayments.filter((receipt) => selectedIds.has(receipt.id));
      const previousClosures = closures.filter((closure) => closure.id !== liveClosure.id);
      const previousClosedAmount = roundCurrency(
        previousClosures.reduce((sum, closure) => sum + asNumber(closure.amount), 0)
      );
      const amount = roundCurrency(selectedReceipts.reduce((sum, receipt) => sum + asNumber(receipt.amount), 0));
      const selectedReceiptIds = new Set(selectedReceipts.map((receipt) => receipt.id));
      const pendingAcceptedAmount = roundCurrency(
        receiptsWithBillingPayments
          .filter(
            (receipt) =>
              isAccountingAcceptedReceipt(receipt) &&
              !otherClosedIds.has(receipt.id) &&
              !selectedReceiptIds.has(receipt.id)
          )
          .reduce((sum, receipt) => sum + asNumber(receipt.amount), 0)
      );
      const updatedClosure: AdvanceAccountingClosure = {
        ...liveClosure,
        createdAt: updatedClosureDate,
        receiptIds: selectedReceipts.map((receipt) => receipt.id),
        receiptSnapshots: selectedReceipts.map((receipt) => ({
          ...receipt,
          accountingClosureId: liveClosure.id,
          accountingClosureKind: 'partial',
          accountingClosureSequence: liveClosure.sequence,
          accountingClosedAt: updatedClosureDate,
        })),
        amount,
        supportCount: selectedReceipts.length,
        previousClosedAmount,
        cumulativeClosedAmount: roundCurrency(previousClosedAmount + amount),
        pendingAcceptedAmount,
        auditBatchIds: Array.from(new Set(selectedReceipts.map((receipt) => receipt.accountingAuditBatchId).filter(Boolean) as string[])),
        auditBatchNames: Array.from(new Set(selectedReceipts.map((receipt) => receipt.accountingAuditBatchName).filter(Boolean) as string[])),
        automaticallyAuditedReceiptIds: Array.from(automaticallyAuditedReceiptIds),
        excludedReceiptSummary: excludedReceipts.map(({ receipt, reason }) => ({
          receiptId: receipt.id,
          invoiceNumber: receipt.invoiceNumber || '',
          provider: receipt.businessName || '',
          amount: asNumber(receipt.amount),
          reason,
        })),
        updatedAt: now,
        updatedBy: currentUser?.uid || null,
        updatedByName: actorName,
        revisionCount: asNumber(liveClosure.revisionCount) + 1,
        editNote: accountingClosureEditNote.trim(),
      };
      const nextClosures = closures.map((closure) => closure.id === liveClosure.id ? updatedClosure : closure);
      const nextReceipts = receiptsWithBillingPayments.map((receipt) => {
        if (selectedReceiptIds.has(receipt.id)) {
          return {
            ...receipt,
            accountingClosureId: liveClosure.id,
            accountingClosureKind: 'partial' as const,
            accountingClosureSequence: liveClosure.sequence,
            accountingClosedAt: updatedClosureDate,
          };
        }
        if (receipt.accountingClosureId === liveClosure.id) {
          const unclosedReceipt: AdvanceReceipt = { ...receipt };
          delete unclosedReceipt.accountingClosureId;
          delete unclosedReceipt.accountingClosureKind;
          delete unclosedReceipt.accountingClosureSequence;
          delete unclosedReceipt.accountingClosedAt;
          return unclosedReceipt;
        }
        return receipt;
      });

      await updateDoc(doc(db, 'projects', projectId, 'advanceRequests', latestAdvance.id), {
        receipts: nextReceipts,
        accountingClosures: nextClosures,
        lastAccountingClosureAt: updatedClosureDate,
        updatedAt: serverTimestamp(),
      });
      await logAdministrativeEvent(latestAdvance.id, 'accounting_partial_close_updated', {
        closureId: liveClosure.id,
        sequence: liveClosure.sequence,
        previousReceiptIds: liveClosure.receiptIds || [],
        receiptIds: updatedClosure.receiptIds,
        previousAmount: liveClosure.amount,
        amount,
        previousClosureDate: liveClosure.createdAt,
        closureDate: updatedClosureDate,
        comment: accountingClosureEditNote.trim(),
        automaticallyAuditedReceiptIds: Array.from(automaticallyAuditedReceiptIds),
        excludedReceiptSummary: updatedClosure.excludedReceiptSummary,
      });
      setEditingAccountingClosure(null);
      setAccountingClosureReceiptIds([]);
      setAccountingClosureEditDate('');
      setAccountingClosureEditNote('');
      toast.success(
        `Cierre parcial corregido. El histórico y su informe quedaron actualizados.${automaticallyAuditedReceiptIds.size > 0 ? ` ${automaticallyAuditedReceiptIds.size} factura${automaticallyAuditedReceiptIds.size === 1 ? '' : 's'} se cruzaron con la base DIAN vigente.` : ''}${excludedReceipts.length > 0 ? ` ${excludedReceipts.length} soporte${excludedReceipts.length === 1 ? '' : 's'} continúa${excludedReceipts.length === 1 ? '' : 'n'} fuera por validaciones pendientes.` : ''}`,
        { duration: excludedReceipts.length > 0 ? 9000 : 5000 }
      );
    } catch (error: any) {
      console.error('Error updating accounting closure:', error);
      toast.error(error?.message || 'No se pudo corregir el cierre parcial.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateAccountingClosure = async (advance: TravelAdvance, kind: 'partial' | 'final') => {
    if (!canValidate) {
      toast.error('Solo el área administrativa puede crear cierres contables.');
      return;
    }

    const latestAdvance = advances.find((item) => item.id === advance.id) || advance;
    const existingClosures = getAdvanceAccountingClosures(latestAdvance);
    if (hasFinalAccountingClosure(latestAdvance)) {
      toast.info('Este anticipo ya tiene cierre contable total.');
      return;
    }
    if (kind === 'partial' && isAdvanceReadyForTotalAccountingClosure(latestAdvance)) {
      toast.info('El anticipo ya fue cerrado por el funcionario. Usa cierre total para congelar el último corte.');
      return;
    }
    if (kind === 'final' && !isAdvanceReadyForTotalAccountingClosure(latestAdvance)) {
      toast.error('El cierre total se habilita cuando el funcionario cierre el anticipo.');
      return;
    }
    const now = new Date().toISOString();
    const actorName = getCurrentUserName(currentUser);
    const receiptsPromotedAgainstCurrentBase = (latestAdvance.receipts || []).map((receipt) =>
      promoteReceiptFromCurrentDianBase(receipt, activeDianAuditRows, {
        batchId: latestDianAuditBatch?.id,
        batchName: activeDianAuditFileName,
        now,
        actorId: currentUser?.uid || null,
        actorName,
      })
    );
    const automaticallyAuditedReceiptIds = new Set(
      receiptsPromotedAgainstCurrentBase
        .filter((receipt, index) => receipt !== (latestAdvance.receipts || [])[index])
        .map((receipt) => receipt.id)
    );
    const advanceForClosure: TravelAdvance = {
      ...latestAdvance,
      receipts: receiptsPromotedAgainstCurrentBase,
    };

    if (kind === 'final' && hasBlockingAccountingClosureReceipts(advanceForClosure)) {
      toast.error('Antes del cierre total no deben quedar legalizaciones pendientes, devueltas o por auditoría DIAN.');
      return;
    }

    const closedIds = getClosedAccountingReceiptIds(advanceForClosure);
    const acceptedReceipts = receiptsPromotedAgainstCurrentBase.filter(isAccountingAcceptedReceipt);
    const receiptsToClose = sortAdvanceReceiptsByInvoiceDate(
      acceptedReceipts.filter((receipt) => !closedIds.has(receipt.id))
    );
    const excludedReceipts = sortAdvanceReceiptsByInvoiceDate(
      receiptsPromotedAgainstCurrentBase.filter((receipt) => {
        if (closedIds.has(receipt.id) || isAccountingAcceptedReceipt(receipt)) return false;
        return isInvoiceReceipt(receipt) || ['submitted', 'returned', 'rejected'].includes(receipt.status);
      })
    ).map((receipt) => ({
      receipt,
      reason: getPartialClosureExclusionReason(receipt, activeDianAuditRows),
    }));
    if (kind === 'partial' && receiptsToClose.length === 0) {
      const pendingReason = excludedReceipts[0]?.reason;
      toast.info(
        pendingReason
          ? `No hay facturas nuevas habilitadas para cierre parcial. ${excludedReceipts.length} soporte${excludedReceipts.length === 1 ? '' : 's'} queda${excludedReceipts.length === 1 ? '' : 'n'} por fuera: ${pendingReason}`
          : 'No hay facturas nuevas auditadas para cierre parcial.'
      );
      return;
    }
    if (kind === 'final' && receiptsToClose.length === 0 && existingClosures.length === 0) {
      toast.info('No hay legalizaciones auditadas para crear un cierre total.');
      return;
    }

    const sequence = existingClosures.length + 1;
    const closingReceiptIds = new Set(receiptsToClose.map((receipt) => receipt.id));
    let receiptsWithBillingPayments = receiptsPromotedAgainstCurrentBase;

    setSubmitting(true);
    try {
      const billingPaymentIds = new Map<string, string>();
      for (const receipt of receiptsToClose) {
        if (!automaticallyAuditedReceiptIds.has(receipt.id)) continue;
        const billingPaymentId = await createAdvanceReceiptBillingPayment(advanceForClosure, receipt, receipt.approvalChanges || []);
        billingPaymentIds.set(receipt.id, billingPaymentId);
      }
      if (billingPaymentIds.size > 0) {
        receiptsWithBillingPayments = receiptsPromotedAgainstCurrentBase.map((receipt) =>
          billingPaymentIds.has(receipt.id)
            ? { ...receipt, billingPaymentId: billingPaymentIds.get(receipt.id) }
            : receipt
        );
      }

      const receiptsToPersistInClosure = sortAdvanceReceiptsByInvoiceDate(
        receiptsWithBillingPayments.filter((receipt) => closingReceiptIds.has(receipt.id))
      );
      const currentAmount = roundCurrency(receiptsToPersistInClosure.reduce((sum, receipt) => sum + asNumber(receipt.amount), 0));
      const previousClosedAmount = roundCurrency(existingClosures.reduce((sum, closure) => sum + asNumber(closure.amount), 0));
      const cumulativeClosedAmount = roundCurrency(previousClosedAmount + currentAmount);
      const pendingAcceptedAmount = roundCurrency(
        acceptedReceipts
          .filter((receipt) => !closedIds.has(receipt.id) && !closingReceiptIds.has(receipt.id))
          .reduce((sum, receipt) => sum + asNumber(receipt.amount), 0)
      );
      const closure: AdvanceAccountingClosure = {
        id: safeId(),
        kind,
        sequence,
        title: kind === 'final' ? 'Cierre total del anticipo' : `Cierre parcial ${sequence} del anticipo`,
        createdAt: now,
        createdBy: currentUser?.uid || null,
        createdByName: actorName,
        receiptIds: receiptsToPersistInClosure.map((receipt) => receipt.id),
        receiptSnapshots: receiptsToPersistInClosure.map((receipt) => ({
          ...receipt,
          accountingClosureKind: kind,
          accountingClosureSequence: sequence,
          accountingClosedAt: now,
        })),
        amount: currentAmount,
        supportCount: receiptsToPersistInClosure.length,
        previousClosedAmount,
        cumulativeClosedAmount,
        pendingAcceptedAmount,
        reportScope: 'partialClose',
        auditBatchIds: Array.from(new Set(receiptsToPersistInClosure.map((receipt) => receipt.accountingAuditBatchId).filter(Boolean) as string[])),
        auditBatchNames: Array.from(new Set(receiptsToPersistInClosure.map((receipt) => receipt.accountingAuditBatchName).filter(Boolean) as string[])),
        automaticallyAuditedReceiptIds: Array.from(automaticallyAuditedReceiptIds),
        excludedReceiptSummary: excludedReceipts.map(({ receipt, reason }) => ({
          receiptId: receipt.id,
          invoiceNumber: receipt.invoiceNumber || '',
          provider: receipt.businessName || '',
          amount: asNumber(receipt.amount),
          reason,
        })),
      };
      const nextClosures = [...existingClosures, closure];
      const nextReceipts = receiptsWithBillingPayments.map((receipt) =>
        closingReceiptIds.has(receipt.id)
          ? {
              ...receipt,
              accountingClosureId: closure.id,
              accountingClosureKind: kind,
              accountingClosureSequence: sequence,
              accountingClosedAt: now,
            }
          : receipt
      );
      const updatedAdvance = {
        ...latestAdvance,
        receipts: nextReceipts,
        accountingClosures: nextClosures,
        lastAccountingClosureAt: now,
        finalAccountingClosureId: kind === 'final' ? closure.id : latestAdvance.finalAccountingClosureId || null,
      };

      await updateDoc(doc(db, 'projects', projectId, 'advanceRequests', latestAdvance.id), {
        receipts: nextReceipts,
        accountingClosures: nextClosures,
        lastAccountingClosureAt: now,
        finalAccountingClosureId: kind === 'final' ? closure.id : latestAdvance.finalAccountingClosureId || null,
        updatedAt: serverTimestamp(),
      });
      await logAdministrativeEvent(latestAdvance.id, kind === 'final' ? 'accounting_final_close_created' : 'accounting_partial_close_created', {
        closureId: closure.id,
        sequence,
        amount: currentAmount,
        receiptIds: closure.receiptIds,
        previousClosedAmount,
        cumulativeClosedAmount,
        automaticallyAuditedReceiptIds: Array.from(automaticallyAuditedReceiptIds),
        excludedReceiptSummary: closure.excludedReceiptSummary,
      });
      await downloadAdvanceDossier({
        advance: updatedAdvance,
        reportReceipts: closure.receiptSnapshots,
        title: closure.title,
        filePrefix: kind === 'final' ? 'cierre-total-anticipo' : 'cierre-parcial-anticipo',
        scope: 'partialClose',
        accountingClosure: closure,
      });
      const excludedMessage = excludedReceipts.length > 0
        ? ` ${excludedReceipts.length} soporte${excludedReceipts.length === 1 ? '' : 's'} queda${excludedReceipts.length === 1 ? '' : 'n'} por fuera por validaciones pendientes; revisa Auditoría DIAN para ver el motivo.`
        : ' No quedaron soportes pendientes por fuera del corte.';
      toast.success(
        `${kind === 'final' ? 'Cierre total' : 'Cierre parcial'} guardado como histórico con ${receiptsToPersistInClosure.length} soporte${receiptsToPersistInClosure.length === 1 ? '' : 's'} por ${formatMoney(currentAmount)}.${automaticallyAuditedReceiptIds.size > 0 ? ` ${automaticallyAuditedReceiptIds.size} factura${automaticallyAuditedReceiptIds.size === 1 ? '' : 's'} se cruzaron automáticamente con la base DIAN vigente.` : ''}${excludedMessage}`,
        { duration: excludedReceipts.length > 0 ? 9000 : 5000 }
      );
    } catch (error: any) {
      console.error('Error creating accounting closure:', error);
      toast.error(error?.message || 'No se pudo crear el cierre contable.');
    } finally {
      setSubmitting(false);
    }
  };

  const analyzeReceiptFilesForAdvance = async (
    advance: TravelAdvance,
    files: File[],
    preparedPdfs: PreparedPdfUpload[] = []
  ): Promise<AiReceiptDraft[]> => {
    const body = new FormData();
    files.forEach((file) => body.append('files', file));
    body.append(
      'categories',
      JSON.stringify(
        categoryOptions.map((category) => ({
          id: category.id,
          name: category.name,
          requiresCufe: category.requiresCufe,
          defaultDailyAmount: category.defaultDailyAmount,
          description: category.description,
        }))
      )
    );
    body.append(
      'costCenters',
      JSON.stringify(
        costCenterOptions.map((center) => ({
          id: center.id,
          name: center.name,
          code: center.code,
          description: center.description,
        }))
      )
    );
    const advancePrimaryCostCenter = getAdvancePrimaryCostCenter(advance);
    body.append(
      'advanceContext',
      JSON.stringify({
        id: advance.id,
        destination: advance.destination,
        purpose: advance.purpose,
        items: advance.items,
        travelStart: advance.travelStart,
        travelEnd: advance.travelEnd,
        primaryCostCenter: advancePrimaryCostCenter,
        costCenterAllocations: advance.costCenters || [],
      })
    );

    const response = await fetch('/api/administration/receipts/analyze', {
      method: 'POST',
      body,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(data?.error || 'No se pudo analizar el soporte.');
    }

    return ((data?.receipts || []) as any[])
      .map((item, fallbackIndex) => {
        const fileIndex = Number.isInteger(item?.index) ? item.index : fallbackIndex;
        const file = files[fileIndex];
        if (!file) return null;
        const categoryById = categoryOptions.find((category) => category.id === item?.categoryId);
        const categoryByName = categoryOptions.find(
          (category) => category.name.toLowerCase() === String(item?.categoryName || '').toLowerCase()
        );
        const category = categoryById || categoryByName || categoryOptions[0];
        const provisionalCostCenter = getAdvancePrimaryCostCenter(advance);
        const costCenterById = costCenterOptions.find((center) => center.id === item?.costCenterId);
        const costCenterByName = costCenterOptions.find(
          (center) => center.name.toLowerCase() === String(item?.costCenterName || '').toLowerCase()
        );
        const costCenter =
          costCenterById ||
          costCenterByName ||
          costCenterOptions.find((center) => center.id === provisionalCostCenter.id) ||
          costCenterOptions.find(
            (center) => center.name.toLowerCase() === provisionalCostCenter.name.toLowerCase()
          ) ||
          costCenterOptions[0];

        return {
          id: safeId(),
          file,
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type || 'application/octet-stream',
          documentType: getReceiptDocumentType(item?.documentType),
          categoryId: category?.id || item?.categoryId || '',
          categoryName: item?.categoryName || category?.name || '',
          costCenterId: costCenter?.id || item?.costCenterId || '',
          costCenterName: costCenter?.name || item?.costCenterName || provisionalCostCenter.name,
          amount: item?.amount ? String(item.amount) : '',
          date: item?.date || todayInputValue(),
          businessName: item?.businessName || '',
          taxId: item?.taxId || '',
          invoiceNumber: item?.invoiceNumber || '',
          cufe: normalizeCufe(item?.cufe || ''),
          description: item?.description || '',
          confidence: typeof item?.confidence === 'number' ? item.confidence : undefined,
          warnings: Array.isArray(item?.warnings) ? item.warnings : [],
          status: item?.status === 'error' ? 'error' : 'ready',
          error: item?.error || '',
          preparedPdf: preparedPdfs[fileIndex],
        } as AiReceiptDraft;
      })
      .filter(Boolean) as AiReceiptDraft[];
  };

  const handleAnalyzeReceiptFiles = async (fileList: FileList | null) => {
    if (!selectedAdvance) return;
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    setReceiptMode('ai');
    setAiAnalyzingReceipts(true);
    try {
      const preparedPdfs: PreparedPdfUpload[] = [];
      for (const file of files) {
        preparedPdfs.push(await preparePdfForUpload(file, requestPdfPassword));
      }
      const drafts = await analyzeReceiptFilesForAdvance(
        selectedAdvance,
        preparedPdfs.map((prepared) => prepared.uploadFile),
        preparedPdfs
      );
      setAiReceiptDrafts((current) => [...current, ...drafts]);
      const errors = drafts.filter((draft) => draft.status === 'error').length;
      toast.success(
        errors > 0
          ? `${drafts.length - errors} soportes listos y ${errors} con alertas.`
          : `${drafts.length} soportes analizados.`
      );
    } catch (error: any) {
      console.error('Error analyzing receipts:', error);
      toast.error(error?.message || 'No se pudo analizar el lote.');
    } finally {
      setAiAnalyzingReceipts(false);
    }
  };

  const applyAiDraftToReceiptEditor = (draft: AiReceiptDraft) => {
    setReceiptEditorForm((current) => {
      if (!current) return current;

      const documentType = getReceiptDocumentType(draft.documentType);
      const cufe = normalizeCufe(draft.cufe);

      return {
        ...current,
        documentType,
        categoryId: draft.categoryId || current.categoryId,
        costCenterId: draft.costCenterId || current.costCenterId,
        amount: draft.amount || current.amount,
        date: draft.date || current.date,
        businessName: draft.businessName || current.businessName,
        taxId: draft.taxId || current.taxId,
        invoiceNumber: draft.invoiceNumber || current.invoiceNumber,
        cufe,
        description: draft.description || current.description,
        dianVerificationStatus: documentType === 'cash_receipt' ? 'not_applicable' : cufe ? 'pending' : 'not_applicable',
        dianLookupOpenedAt: '',
        dianVerifiedAt: '',
        dianDocumentUrl: documentType === 'invoice' && cufe ? buildDianDocumentUrl(cufe) : '',
      };
    });
  };

  const handleReplaceReceiptSupport = async (reanalyze = false) => {
    if (!receiptEditor || !receiptEditorForm || receiptEditor.mode === 'correction') return;
    const canReplaceFromCurrentEditor =
      receiptEditor.mode === 'administrative' ? canAdministrativelyEditReceipt : canValidate;
    if (!canReplaceFromCurrentEditor) {
      toast.error('No tienes permisos para cambiar el soporte desde revisión.');
      return;
    }
    if (!receiptReplacementFile) {
      toast.error('Selecciona el nuevo soporte antes de guardar.');
      return;
    }

    const latestAdvance = advances.find((advance) => advance.id === receiptEditor.advance.id) || receiptEditor.advance;
    const latestReceipt = (latestAdvance.receipts || []).find((receipt) => receipt.id === receiptEditor.receipt.id) || receiptEditor.receipt;
    if (
      latestReceipt.accountingClosureId &&
      !canEditReceiptInPartialAccountingClosure(latestAdvance, latestReceipt)
    ) {
      toast.error('El soporte pertenece a un cierre total y ya no puede reemplazarse.');
      return;
    }
    const currentCategory = categoryOptions.find((item) => item.id === receiptEditorForm.categoryId);
    const fallbackCategory = categoryOptions.find((item) => item.id === latestReceipt.categoryId);
    const category = currentCategory || fallbackCategory;
    if (!category) {
      toast.error('Selecciona un tipo de gasto antes de reemplazar el soporte.');
      return;
    }

    const documentType = getReceiptDocumentType(receiptEditorForm.documentType);
    setReceiptSupportAction(reanalyze ? 'reanalyze' : 'replace');
    try {
      const uploaded = await uploadReceiptDocument(
        latestAdvance,
        category,
        receiptReplacementFile,
        receiptEditorForm.businessName || latestReceipt.businessName || category.name,
        documentType
      );

      let analyzedDraft: AiReceiptDraft | null = null;
      let aiWarning = '';
      if (reanalyze) {
        try {
          const drafts = await analyzeReceiptFilesForAdvance(
            latestAdvance,
            uploaded.uploadFile ? [uploaded.uploadFile] : [receiptReplacementFile]
          );
          analyzedDraft = drafts[0] || null;
          if (!analyzedDraft) {
            aiWarning = 'La IA no devolvió datos para este soporte.';
          } else if (analyzedDraft.status === 'error') {
            aiWarning = analyzedDraft.error || 'La IA no pudo leer el soporte reemplazado.';
          }
        } catch (error: any) {
          aiWarning = error?.message || 'La IA no pudo leer el soporte reemplazado.';
        }
      }

      const now = new Date().toISOString();
      const fileChange: ReceiptFieldChange = {
        field: 'file',
        label: 'Archivo de soporte',
        previousValue: latestReceipt.fileName || null,
        nextValue: uploaded.fileName,
      };
      const nextReceipt: AdvanceReceipt = {
        ...latestReceipt,
        fileName: uploaded.fileName,
        fileSize: uploaded.fileSize,
        fileUrl: uploaded.fileUrl,
        storagePath: uploaded.storagePath,
        documentId: uploaded.documentId,
        pdfNormalization: uploaded.pdfNormalization,
        aiExtracted: reanalyze ? Boolean(analyzedDraft && analyzedDraft.status !== 'error') : latestReceipt.aiExtracted,
        aiConfidence: analyzedDraft?.confidence ?? latestReceipt.aiConfidence,
        aiWarnings: analyzedDraft?.warnings || latestReceipt.aiWarnings,
        revisionCount: asNumber(latestReceipt.revisionCount) + 1,
        revisions: [
          ...(latestReceipt.revisions || []),
          {
            type: 'support_replaced',
            actorId: currentUser?.uid || null,
            actorName: getCurrentUserName(currentUser),
            at: now,
            comment: reanalyze
              ? aiWarning
                ? `Soporte reemplazado. ${aiWarning}`
                : 'Soporte reemplazado y leído nuevamente con IA.'
              : 'Soporte original reemplazado.',
            changes: [fileChange],
          },
          ...(uploaded.pdfNormalization
            ? [{
                type: 'pdf_normalized' as const,
                actorId: currentUser?.uid || null,
                actorName: getCurrentUserName(currentUser),
                at: now,
                comment: 'PDF protegido desbloqueado. El original cifrado quedó preservado como evidencia.',
              }]
            : []),
        ],
      };
      const nextReceipts = (latestAdvance.receipts || []).map((item) =>
        item.id === latestReceipt.id ? nextReceipt : item
      );
      const partialClosureSync = syncReceiptWithPartialAccountingClosure(
        { ...latestAdvance, receipts: nextReceipts },
        nextReceipt,
        {
          now,
          actorId: currentUser?.uid || null,
          actorName: getCurrentUserName(currentUser),
          note: reanalyze
            ? 'Soporte del cierre parcial reemplazado y releído con IA.'
            : 'Soporte del cierre parcial reemplazado.',
        }
      );
      const nextAdvance = {
        ...latestAdvance,
        receipts: nextReceipts,
        ...(partialClosureSync.changed
          ? { accountingClosures: partialClosureSync.accountingClosures }
          : {}),
      };

      await updateDoc(doc(db, 'projects', projectId, 'advanceRequests', latestAdvance.id), {
        receipts: nextReceipts,
        ...(partialClosureSync.changed
          ? { accountingClosures: partialClosureSync.accountingClosures }
          : {}),
        updatedAt: serverTimestamp(),
      });
      await logAdministrativeEvent(latestAdvance.id, reanalyze ? 'receipt_support_reanalyzed' : 'receipt_support_replaced', {
        receiptId: latestReceipt.id,
        fileName: uploaded.fileName,
        storagePath: uploaded.storagePath,
        aiWarnings: aiWarning ? [aiWarning] : analyzedDraft?.warnings || [],
        pdfNormalized: Boolean(uploaded.pdfNormalization),
        protectedOriginalDocumentId: uploaded.pdfNormalization?.originalDocumentId || null,
        accountingClosureId: partialClosureSync.closureId || null,
        accountingClosureUpdated: partialClosureSync.changed,
      });

      setAdvances((current) => current.map((advance) => (advance.id === nextAdvance.id ? nextAdvance : advance)));
      setReceiptEditor((current) => (current ? { ...current, advance: nextAdvance, receipt: nextReceipt } : current));
      if (analyzedDraft && analyzedDraft.status !== 'error') {
        applyAiDraftToReceiptEditor(analyzedDraft);
      }
      setReceiptReplacementFile(null);
      toast.success(
        aiWarning
          ? 'Soporte reemplazado. La IA no pudo completar la lectura; ajusta los campos manualmente.'
          : reanalyze
            ? 'Soporte reemplazado y campos actualizados con IA.'
            : uploaded.pdfNormalization
              ? 'PDF protegido normalizado. El original cifrado quedó preservado y el soporte ya puede usarse en informes.'
              : 'Soporte reemplazado correctamente.'
      );
    } catch (error: any) {
      console.error('Error replacing receipt support:', error);
      toast.error(error?.message || 'No se pudo reemplazar el soporte.');
    } finally {
      setReceiptSupportAction(null);
    }
  };

  const updateAiReceiptDraft = (id: string, updates: Partial<AiReceiptDraft>) => {
    setAiReceiptDrafts((current) => current.map((draft) => (draft.id === id ? { ...draft, ...updates } : draft)));
  };

  const removeAiReceiptDraft = (id: string) => {
    setAiReceiptDrafts((current) => current.filter((draft) => draft.id !== id));
  };

  const handleCreateAiReceipts = async () => {
    if (!selectedAdvance || (!canManage && !canCorrectAdvanceReceipt(selectedAdvance))) return;
    const readyDrafts = aiReceiptDrafts.filter((draft) => draft.status !== 'error');
    if (readyDrafts.length === 0) {
      toast.error('No hay soportes listos para guardar.');
      return;
    }

    const latestAdvance = advances.find((advance) => advance.id === selectedAdvance.id) || selectedAdvance;
    if (!isAdvanceReadyForLegalization(latestAdvance)) {
      toast.error('El anticipo debe tener su pago registrado antes de cargar legalizaciones.');
      return;
    }
    const batchIdentities = new Map<string, string>();
    for (const draft of readyDrafts) {
      const category = categoryOptions.find((item) => item.id === draft.categoryId);
      const costCenter = costCenterOptions.find((item) => item.id === draft.costCenterId);
      const amount = asNumber(draft.amount);
      const documentType = getReceiptDocumentType(draft.documentType);
      const cufe = normalizeCufe(draft.cufe);
      if (!category || !costCenter || amount <= 0 || !draft.businessName.trim()) {
        toast.error(`Revisa categoría, centro de costos, valor y proveedor en ${draft.fileName}.`);
        return;
      }
      if (documentType === 'invoice' && category.requiresCufe && !cufe) {
        toast.error(`${draft.fileName} requiere CUFE para el dominio ${category.name}.`);
        return;
      }

      const receiptIdentityCandidate = {
        documentType,
        cufe,
        invoiceNumber: draft.invoiceNumber,
        taxId: draft.taxId,
        businessName: draft.businessName,
        amount,
        date: draft.date || todayInputValue(),
      };
      const identity = getReceiptIdentity(receiptIdentityCandidate);
      if (identity && batchIdentities.has(identity)) {
        toast.error(`${draft.fileName} repite el mismo soporte de ${batchIdentities.get(identity)} dentro del lote.`);
        return;
      }
      if (identity) batchIdentities.set(identity, draft.fileName);

      const duplicateCufeUsage = findDuplicateCufeUsage(receiptIdentityCandidate, latestAdvance.id);
      if (duplicateCufeUsage) {
        toast.error(`${draft.fileName}: ${formatDuplicateReceiptUsageMessage(duplicateCufeUsage, latestAdvance.id)}`);
        return;
      }
      const duplicateUsage = findDuplicateReceiptUsage(receiptIdentityCandidate, latestAdvance.id);
      if (duplicateUsage) {
        toast.error(`${draft.fileName} ya fue usado en "${duplicateUsage.advanceTitle}" por ${duplicateUsage.requesterName}.`);
        return;
      }
    }

    setSubmitting(true);
    try {
      const createdReceipts: AdvanceReceipt[] = [];

      for (const draft of readyDrafts) {
        const category = categoryOptions.find((item) => item.id === draft.categoryId)!;
        const costCenter = costCenterOptions.find((item) => item.id === draft.costCenterId)!;
        const documentType = getReceiptDocumentType(draft.documentType);
        const uploaded = await uploadReceiptDocument(
          latestAdvance,
          category,
          draft.preparedPdf?.originalFile || draft.file,
          draft.businessName || category.name,
          documentType,
          draft.preparedPdf
        );

        createdReceipts.push({
          id: safeId(),
          documentType,
          categoryId: category.id,
          categoryName: category.name,
          costCenterId: costCenter.id,
          costCenterName: costCenter.name,
          costCenterSource: 'ai',
          amount: asNumber(draft.amount),
          date: draft.date || todayInputValue(),
          businessName: draft.businessName.trim(),
          taxId: draft.taxId.trim(),
          invoiceNumber: draft.invoiceNumber.trim(),
          cufe: normalizeCufe(draft.cufe),
          description: draft.description.trim(),
          fileName: uploaded.fileName,
          fileSize: uploaded.fileSize,
          fileUrl: uploaded.fileUrl,
          storagePath: uploaded.storagePath,
          documentId: uploaded.documentId,
          pdfNormalization: uploaded.pdfNormalization,
          status: 'submitted',
          createdAt: new Date().toISOString(),
          createdBy: currentUser?.uid || null,
          createdByName: getCurrentUserName(currentUser),
          aiExtracted: true,
          aiConfidence: draft.confidence,
          aiWarnings: draft.warnings || [],
        });
      }

      await updateDoc(doc(db, 'projects', projectId, 'advanceRequests', selectedAdvance.id), {
        receipts: [...(latestAdvance.receipts || []), ...createdReceipts],
        status: latestAdvance.status === 'approved' ? 'approved' : 'paid',
        nextAction: 'validate_receipt',
        pendingRole: 'administrative_validation',
        inboxTargetUserId: null,
        completedAt: null,
        completedBy: null,
        completedByName: '',
        updatedAt: serverTimestamp(),
      });
      await logAdministrativeEvent(selectedAdvance.id, 'receipts_ai_bulk_submitted', {
        receiptCount: createdReceipts.length,
        documentTypes: Array.from(new Set(createdReceipts.map((receipt) => receipt.documentType))),
        costCenters: Array.from(new Set(createdReceipts.map((receipt) => receipt.costCenterName).filter(Boolean))),
        amount: createdReceipts.reduce((sum, receipt) => sum + asNumber(receipt.amount), 0),
        normalizedProtectedPdfCount: createdReceipts.filter((receipt) => receipt.pdfNormalization).length,
        protectedOriginalDocumentIds: createdReceipts
          .map((receipt) => receipt.pdfNormalization?.originalDocumentId)
          .filter(Boolean),
      });
      toast.success(`${createdReceipts.length} soportes creados para validación.`);
      closeReceiptModal();
    } catch (error: any) {
      console.error('Error creating AI receipts:', error);
      toast.error(error?.message || 'No se pudieron crear las legalizaciones.');
    } finally {
      setSubmitting(false);
    }
  };

  const seedDefaultCategories = async () => {
    if (!canConfigure) return;
    setSubmitting(true);
    try {
      const existingNames = new Set(categories.map((category) => category.name.trim().toLowerCase()));
      const missing = DEFAULT_CATEGORIES.filter((category) => !existingNames.has(category.name.trim().toLowerCase()));
      const existingCostCenterNames = new Set(
        costCenterDomains.map((center) => center.name.trim().toLowerCase())
      );
      const missingCostCenters = DEFAULT_COST_CENTERS.filter(
        (center) => !existingCostCenterNames.has(center.name.trim().toLowerCase())
      );
      const existingPayerTaxIds = new Set(
        contractorAccountPayers.map((payer) => payer.taxId.replace(/\D/g, ''))
      );
      const missingPayers = DEFAULT_CONTRACTOR_ACCOUNT_PAYERS.filter(
        (payer) => !existingPayerTaxIds.has(payer.taxId.replace(/\D/g, ''))
      );
      await Promise.all(
        [
          ...missing.map((category) =>
            addDoc(collection(db, 'projects', projectId, 'expenseCategories'), {
              ...category,
              projectId,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              createdBy: currentUser?.uid || null,
            })
          ),
          ...missingCostCenters.map((center) =>
            addDoc(collection(db, 'projects', projectId, 'costCenters'), {
              ...center,
              projectId,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              createdBy: currentUser?.uid || null,
            })
          ),
          ...missingPayers.map((payer) =>
            addDoc(collection(db, 'projects', projectId, 'contractorAccountPayers'), {
              ...payer,
              projectId,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              createdBy: currentUser?.uid || null,
            })
          ),
        ]
      );
      toast.success(
        missing.length + missingCostCenters.length + missingPayers.length > 0
          ? 'Dominios base creados.'
          : 'Los dominios base ya existían.'
      );
    } catch (error: any) {
      console.error('Error seeding categories:', error);
      toast.error(error?.message || 'No se pudieron crear los dominios.');
    } finally {
      setSubmitting(false);
    }
  };

  const saveCategory = async () => {
    if (!canConfigure) return;
    if (!categoryForm.name.trim()) {
      toast.error('Escribe el nombre del dominio.');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        projectId,
        name: categoryForm.name.trim(),
        defaultDailyAmount: asNumber(categoryForm.defaultDailyAmount),
        unitLabel: categoryForm.unitLabel.trim() || 'dia',
        color: categoryForm.color || '#4f46e5',
        requiresCufe: categoryForm.requiresCufe,
        description: categoryForm.description.trim(),
        active: true,
        updatedAt: serverTimestamp(),
      };
      if (categoryForm.id) {
        await updateDoc(doc(db, 'projects', projectId, 'expenseCategories', categoryForm.id), payload);
        toast.success('Dominio actualizado.');
      } else {
        await addDoc(collection(db, 'projects', projectId, 'expenseCategories'), {
          ...payload,
          createdAt: serverTimestamp(),
          createdBy: currentUser?.uid || null,
        });
        toast.success('Dominio creado.');
      }
      setCategoryForm({
        id: '',
        name: '',
        defaultDailyAmount: '',
        unitLabel: 'dia',
        color: '#4f46e5',
        requiresCufe: false,
        description: '',
      });
    } catch (error: any) {
      console.error('Error saving category:', error);
      toast.error(error?.message || 'No se pudo guardar el dominio.');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleCategory = async (category: ExpenseCategory) => {
    if (!canConfigure || category.id.startsWith('default-')) return;
    await updateDoc(doc(db, 'projects', projectId, 'expenseCategories', category.id), {
      active: category.active === false,
      updatedAt: serverTimestamp(),
    });
  };

  const saveCostCenter = async () => {
    if (!canConfigure) return;
    const name = costCenterForm.name.trim();
    if (!name) {
      toast.error('Escribe el nombre del centro de costos.');
      return;
    }
    const duplicate = costCenterDomains.some(
      (center) => center.id !== costCenterForm.id && center.name.trim().toLowerCase() === name.toLowerCase()
    );
    if (duplicate) {
      toast.error('Ya existe un centro de costos con ese nombre.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        projectId,
        name,
        code: costCenterForm.code.trim().toUpperCase(),
        description: costCenterForm.description.trim(),
        active: true,
        updatedAt: serverTimestamp(),
      };
      if (costCenterForm.id) {
        await updateDoc(doc(db, 'projects', projectId, 'costCenters', costCenterForm.id), payload);
        toast.success('Centro de costos actualizado.');
      } else {
        await addDoc(collection(db, 'projects', projectId, 'costCenters'), {
          ...payload,
          createdAt: serverTimestamp(),
          createdBy: currentUser?.uid || null,
        });
        toast.success('Centro de costos creado.');
      }
      setCostCenterForm({ id: '', name: '', code: '', description: '' });
    } catch (error: any) {
      console.error('Error saving cost center domain:', error);
      toast.error(error?.message || 'No se pudo guardar el centro de costos.');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleCostCenter = async (center: CostCenterDomain) => {
    if (!canConfigure || center.id.startsWith('default-cost-center-')) return;
    await updateDoc(doc(db, 'projects', projectId, 'costCenters', center.id), {
      active: center.active === false,
      updatedAt: serverTimestamp(),
    });
  };

  const saveContractorAccountPayer = async () => {
    if (!canConfigure) return;
    const name = contractorAccountPayerForm.name.trim();
    const taxId = contractorAccountPayerForm.taxId.trim();
    if (!name || !taxId) {
      toast.error('Escribe la razón social y el NIT de la empresa pagadora.');
      return;
    }
    const normalizedTaxId = taxId.replace(/\D/g, '');
    const duplicate = contractorAccountPayers.some(
      (payer) => payer.id !== contractorAccountPayerForm.id && payer.taxId.replace(/\D/g, '') === normalizedTaxId
    );
    if (duplicate) {
      toast.error('Ya existe una empresa pagadora con ese NIT.');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        projectId,
        name,
        taxId,
        address: contractorAccountPayerForm.address.trim(),
        city: contractorAccountPayerForm.city.trim(),
        active: true,
        updatedAt: serverTimestamp(),
      };
      if (contractorAccountPayerForm.id) {
        await updateDoc(doc(db, 'projects', projectId, 'contractorAccountPayers', contractorAccountPayerForm.id), payload);
        toast.success('Empresa pagadora actualizada.');
      } else {
        await addDoc(collection(db, 'projects', projectId, 'contractorAccountPayers'), {
          ...payload,
          createdAt: serverTimestamp(),
          createdBy: currentUser?.uid || null,
        });
        toast.success('Empresa pagadora creada.');
      }
      setContractorAccountPayerForm({ id: '', name: '', taxId: '', address: '', city: '' });
    } catch (error: any) {
      console.error('Error saving contractor account payer domain:', error);
      toast.error(error?.message || 'No se pudo guardar la empresa pagadora.');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleContractorAccountPayer = async (payer: ContractorAccountPayerDomain) => {
    if (!canConfigure || payer.id.startsWith('default-contractor-payer-')) return;
    await updateDoc(doc(db, 'projects', projectId, 'contractorAccountPayers', payer.id), {
      active: payer.active === false,
      updatedAt: serverTimestamp(),
    });
  };

  if (!canView) {
    return (
      <section className="rounded-xl border border-amber-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-amber-50 text-amber-700 ring-1 ring-amber-100">
          <ShieldCheck size={28} />
        </div>
        <h2 className="mt-4 text-2xl font-black tracking-tight text-slate-950">Administración protegida</h2>
        <p className="mx-auto mt-2 max-w-2xl text-sm font-medium leading-6 text-slate-500">
          Este módulo controla anticipos, legalizaciones y costos reales del proyecto. Tu rol no tiene acceso habilitado.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className={presentation === 'standalone'
          ? 'flex flex-col gap-3 bg-slate-950 px-5 py-4 text-white lg:flex-row lg:items-center lg:justify-between'
          : 'flex flex-col gap-3 bg-white p-3 sm:flex-row sm:items-center sm:justify-between'}>
          {presentation === 'standalone' && (
            <div>
              <div className="inline-flex items-center gap-2 rounded-md bg-emerald-400/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.28em] text-emerald-200 ring-1 ring-emerald-300/20">
                <FolderKanban size={14} />
                Control administrativo
              </div>
              <h2 className="mt-2 text-2xl font-black tracking-tight">
                {adminWorkspace === 'advances'
                  ? 'Anticipos, legalizaciones y costos reales'
                  : 'Cuentas de cobro de contratistas'}
              </h2>
              <p className="mt-1 max-w-3xl text-xs font-semibold leading-5 text-slate-300">
                {adminWorkspace === 'advances'
                  ? 'Gestiona solicitudes de viaje, soportes de campo y validaciones administrativas sin perder trazabilidad. Los soportes aprobados alimentan los pagos reales del proyecto.'
                  : 'Gestiona cuentas de cobro, informes de actividades, parafiscales, aprobaciones internas, contabilización y pago sin mezclarlas con anticipos.'}
              </p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <div className={presentation === 'standalone'
              ? 'flex rounded-xl border border-white/10 bg-white/5 p-1'
              : 'flex rounded-xl border border-slate-200 bg-slate-50 p-1'}>
              {[
                ['advances', 'Anticipos'],
                ['contractorAccounts', 'Cuentas de cobro'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setAdminWorkspace(id as typeof adminWorkspace)}
                  className={`rounded-lg px-3 py-2 text-xs font-black transition ${
                    adminWorkspace === id
                      ? presentation === 'standalone'
                        ? 'bg-white text-slate-950'
                        : 'bg-indigo-600 text-white shadow-sm'
                      : presentation === 'standalone'
                        ? 'text-slate-300 hover:bg-white/10 hover:text-white'
                        : 'text-slate-600 hover:bg-white hover:text-indigo-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {adminWorkspace === 'advances' && canConfigure && (
              <Button
                type="button"
                variant="outline"
                onClick={seedDefaultCategories}
                className={presentation === 'standalone'
                  ? 'border-white/20 bg-white/10 text-white hover:bg-white/20'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}
              >
                <RefreshCw size={16} className="mr-2" />
                Dominios base
              </Button>
            )}
            {adminWorkspace === 'advances' && canCreateAdvance && (
              <Button type="button" onClick={openNewAdvance} className="bg-emerald-500 font-bold text-white hover:bg-emerald-600">
                <Plus size={17} className="mr-2" />
                Nuevo anticipo
              </Button>
            )}
            {adminWorkspace === 'contractorAccounts' && canCreateContractorAccount && (
              <Button type="button" onClick={openNewContractorAccount} className="bg-cyan-500 font-bold text-slate-950 hover:bg-cyan-400">
                <Plus size={17} className="mr-2" />
                Nueva cuenta de cobro
              </Button>
            )}
          </div>
        </div>

        {presentation === 'standalone' && (
          <div className="grid gap-2 border-t border-slate-800 bg-slate-950/95 p-3 sm:grid-cols-2 xl:grid-cols-6">
            {adminWorkspace === 'advances' ? (
              <>
                <Metric label="Solicitado" value={formatMoney(metrics.requested)} icon={<Send size={18} />} tone="blue" />
                <Metric label={`Pagado / abonado · ${metrics.paymentProgress}%`} value={formatMoney(metrics.paidDisbursements)} icon={<CreditCard size={18} />} tone="violet" />
                <Metric label="Justificado" value={formatMoney(metrics.justified)} icon={<ClipboardCheck size={18} />} tone="indigo" />
                <Metric label="Legalizado" value={formatMoney(metrics.legalized)} icon={<ReceiptText size={18} />} tone="emerald" />
                <Metric label="Saldo por legalizar" value={formatMoney(metrics.balance)} icon={<AlertCircle size={18} />} tone="amber" />
                <Metric label="Costo real registrado" value={formatMoney(metrics.realAdminPayments)} icon={<Banknote size={18} />} tone="rose" />
              </>
            ) : (
              <>
                <Metric label="Cuentas radicadas" value={String(contractorAccountMetrics.submitted)} icon={<FileText size={18} />} tone="blue" />
                <Metric label="Honorarios" value={formatMoney(contractorAccountMetrics.totalHonorarium)} icon={<WalletCards size={18} />} tone="violet" />
                <Metric label="Base seguridad social 40%" value={formatMoney(contractorAccountMetrics.socialSecurityBase)} icon={<ShieldCheck size={18} />} tone="indigo" />
                <Metric label="En aprobación" value={String(contractorAccountMetrics.pendingApprovals)} icon={<ClipboardCheck size={18} />} tone="amber" />
                <Metric label="Por contabilizar" value={String(contractorAccountMetrics.pendingAccounting)} icon={<ReceiptText size={18} />} tone="emerald" />
                <Metric label="Por pagar" value={String(contractorAccountMetrics.pendingPayment)} icon={<CreditCard size={18} />} tone="rose" />
              </>
            )}
          </div>
        )}
      </section>

      {adminWorkspace === 'advances' ? (
      <>
      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex w-full flex-wrap gap-2">
	          {(canManage || canValidate
	            ? [
	                ['requests', 'Anticipos', scopedAdvances.filter((advance) => showReconciledAdvances || !isAdvanceReconciled(advance)).length],
	                ['approvals', 'Anticipos por aprobar', approvalAdvances.length],
	                ['payables', 'Anticipos por pagar', payableAdvances.length],
	                ['receipts', 'Legalizaciones', receipts.length],
	                ['audit', 'Auditoría DIAN', auditPendingCount + auditAlertCount],
	                ['conciliation', 'Conciliación', reconciliationAdvances.filter((item) => item.advance.reconciliationStatus !== 'reconciled').length],
	                ['payments', 'Costos reales', realCostAdvanceGroups.length],
	                ['settings', 'Dominios', categoryOptions.length + costCenterOptions.length],
	              ]
	            : [
	                ['requests', 'Mis anticipos', requestAdvances.length],
	                ['receipts', 'Mis legalizaciones', receipts.length],
	              ]
	          ).map(([id, label, count]) => (
            <button
              key={String(id)}
              type="button"
              onClick={() => setView(id as typeof view)}
              className={`inline-flex min-w-[145px] flex-1 items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-black transition ${
                view === id
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20'
                  : 'bg-slate-50 text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100'
              }`}
            >
              {label}
              <span className={`rounded-md px-1.5 py-0.5 text-[11px] ${view === id ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'}`}>{count}</span>
            </button>
          ))}
	        </div>
      </div>

      {loading ? (
        <div className="flex min-h-72 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Cargando administración...
        </div>
      ) : (
        <>
          {view === 'requests' && (
            <div className="grid gap-4">
              <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm md:flex-row md:items-center md:justify-between">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    className={`${inputClass} pl-10`}
                    value={advanceSearch}
                    onChange={(event) => setAdvanceSearch(event.target.value)}
                    placeholder="Buscar por ID, solicitante, municipio, tarea o justificación..."
                  />
                </div>
                <button
                  type="button"
                  aria-pressed={showReconciledAdvances}
                  onClick={() => setShowReconciledAdvances((current) => !current)}
                  className={`inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg px-3 text-xs font-black ring-1 transition ${
                    showReconciledAdvances
                      ? 'bg-teal-600 text-white ring-teal-600'
                      : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {showReconciledAdvances ? <EyeOff size={15} /> : <Eye size={15} />}
                  {showReconciledAdvances
                    ? 'Ocultar conciliados'
                    : `Mostrar conciliados${hiddenReconciledAdvancesCount ? ` (${hiddenReconciledAdvancesCount})` : ''}`}
                </button>
	                <span className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-black uppercase tracking-[0.16em] text-slate-500 ring-1 ring-slate-200">
	                  {requestAdvances.length} de {scopedAdvances.length}
	                </span>
	              </div>
	              {scopedAdvances.length === 0 ? (
	                <EmptyState title="No hay anticipos registrados" body="Crea el primer anticipo de viaje para iniciar el control administrativo del proyecto." />
              ) : requestAdvances.length === 0 ? (
                <EmptyState
                  title="Sin anticipos encontrados"
                  body={
                    hiddenReconciledAdvancesCount > 0 && !showReconciledAdvances
                      ? `Hay ${hiddenReconciledAdvancesCount} anticipo${hiddenReconciledAdvancesCount === 1 ? '' : 's'} conciliado${hiddenReconciledAdvancesCount === 1 ? '' : 's'} oculto${hiddenReconciledAdvancesCount === 1 ? '' : 's'}. Activa “Mostrar conciliados” para consultarlo${hiddenReconciledAdvancesCount === 1 ? '' : 's'}.`
                      : 'Ajusta la búsqueda o revisa el ID ingresado para consultar la solicitud.'
                  }
                />
              ) : (
                requestAdvances.map((advance) => (
                  <AdvanceCard
                    key={advance.id}
                    advance={advance}
                    canValidate={false}
                    canManage={canManage}
                    canCorrect={requesterMatchesCurrentActor(advance.requesterId, advance.requesterEmail)}
                    onOpenReceipt={() => setSelectedAdvance(advance)}
                    onComplete={() => handleCompleteAdvance(advance)}
                    onApprove={() => openReviewAction({ type: 'approveAdvance', advance })}
                    onReturn={() => openReviewAction({ type: 'returnAdvance', advance })}
                    onReject={() => openReviewAction({ type: 'rejectAdvance', advance })}
                    onDelete={() => openReviewAction({ type: 'deleteAdvance', advance })}
                    onView={() => setViewingAdvance(advance)}
                    onGenerateReport={(scope) => void downloadAdvanceReportOption(advance, scope)}
                  />
                ))
              )}
            </div>
          )}

          {(view === 'approvals' || view === 'payables') && (
            <div className="space-y-4">
              <div className={`rounded-xl border bg-gradient-to-r to-white p-4 shadow-sm ${view === 'approvals' ? 'border-amber-200 from-amber-50' : 'border-violet-200 from-violet-50'}`}>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className={`flex items-center gap-2 ${view === 'approvals' ? 'text-amber-700' : 'text-violet-700'}`}>
                      {view === 'approvals' ? <ClipboardCheck size={20} /> : <WalletCards size={20} />}
                      <h3 className="text-lg font-black">{view === 'approvals' ? 'Anticipos por aprobar' : 'Anticipos por pagar'}</h3>
                    </div>
                    <p className="mt-1 text-sm font-medium text-slate-600">
                      {view === 'approvals'
                        ? 'Revisa la ficha, los ítems y la firma del solicitante para aprobar, devolver o rechazar la solicitud.'
                        : 'Gestiona únicamente anticipos aprobados: registra el soporte de pago o devuelve la solicitud para corrección.'}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    {view === 'payables' && (
                      <button
                        type="button"
                        aria-pressed={showPaidAdvances}
                        onClick={() => setShowPaidAdvances((current) => !current)}
                        className={`inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg px-3 text-xs font-black ring-1 transition ${showPaidAdvances ? 'bg-sky-600 text-white ring-sky-600' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'}`}
                      >
                        {showPaidAdvances ? <EyeOff size={15} /> : <Eye size={15} />}
                        {showPaidAdvances ? 'Ocultar pagados' : `Mostrar pagados${hiddenPaidAdvancesCount ? ` (${hiddenPaidAdvancesCount})` : ''}`}
                      </button>
                    )}
                    <div className="relative min-w-0 lg:w-80">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input className={`${inputClass} pl-10`} value={advanceSearch} onChange={(event) => setAdvanceSearch(event.target.value)} placeholder={view === 'approvals' ? 'Buscar solicitud por ID, persona o destino...' : 'Buscar por ID, persona o destino...'} />
                    </div>
                  </div>
                </div>
              </div>
              {administrativeQueueAdvances.length === 0 ? (
                view === 'approvals' ? (
                  <EmptyState title="No hay anticipos por aprobar" body="Las solicitudes nuevas o devueltas para corrección aparecerán en esta bandeja." />
                ) : (
                  <EmptyState title="No hay anticipos pendientes de pago" body={hiddenPaidAdvancesCount > 0 && !showPaidAdvances ? `Hay ${hiddenPaidAdvancesCount} anticipo${hiddenPaidAdvancesCount === 1 ? '' : 's'} pagado${hiddenPaidAdvancesCount === 1 ? '' : 's'} oculto${hiddenPaidAdvancesCount === 1 ? '' : 's'}. Activa “Mostrar pagados” para consultarlos.` : 'Los anticipos aparecerán aquí después de ser aprobados y firmados.'} />
                )
	              ) : administrativeQueueAdvances.map((advance) => {
	                const status = statusConfig[advance.status] || statusConfig.submitted;
	                const canCorrect = requesterMatchesCurrentActor(advance.requesterId, advance.requesterEmail);
	                const canReviewAdvance = canValidate || canManage;
	                const paymentSummary = getAdvancePaymentSummary(advance);
	                return (
                  <section key={advance.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex flex-col gap-4 border-b border-slate-200 bg-slate-50 p-4 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ring-1 ${status.className}`}>{status.label}</span>
                          <span className="rounded-md bg-slate-900 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-white">{advance.customId || advance.id.slice(0, 8)}</span>
                        </div>
                        <h4 className="mt-2 text-lg font-black text-slate-950">{advance.purpose || advance.destination}</h4>
                        <p className="mt-1 text-sm font-semibold text-slate-500">{advance.requesterName} · {advance.requesterEmail || 'Sin correo'} · {advance.destination}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => setViewingAdvance(advance)}><FileText size={14} className="mr-2" />Ver anticipo</Button>
                        <AdvanceReportMenu
                          advance={advance}
                          onSelect={(scope) => void downloadAdvanceReportOption(advance, scope)}
                        />
                        {(canManage || canValidate) && ['submitted', 'pending_payment', 'paid'].includes(advance.status) && (
                          <Button type="button" size="sm" variant="outline" onClick={() => openAdvanceEditor(advance)} className="border-indigo-200 text-indigo-700 hover:bg-indigo-50"><PencilLine size={14} className="mr-2" />Editar</Button>
                        )}
	                        {['submitted', 'returned'].includes(advance.status) && canReviewAdvance && <>
	                          <Button type="button" size="sm" onClick={() => openReviewAction({ type: 'approveAdvance', advance })} className="bg-emerald-600 text-white hover:bg-emerald-700"><CheckCircle2 size={14} className="mr-2" />{advance.status === 'returned' ? 'Reaprobar' : 'Aprobar y firmar'}</Button>
	                          {advance.status === 'submitted' && <Button type="button" size="sm" variant="outline" onClick={() => openReviewAction({ type: 'returnAdvance', advance })} className="border-orange-200 text-orange-700"><RotateCcw size={14} className="mr-2" />Devolver</Button>}
	                          <Button type="button" size="sm" variant="outline" onClick={() => openReviewAction({ type: 'rejectAdvance', advance })} className="border-rose-200 text-rose-700">Rechazar</Button>
	                        </>}
                        {canAdvanceReceivePayment(advance) && canValidate && <>
                          <Button type="button" size="sm" onClick={() => openAdvancePayment(advance)} className="bg-violet-600 text-white hover:bg-violet-700"><CreditCard size={14} className="mr-2" />{paymentSummary.hasPayment ? 'Registrar saldo' : 'Registrar pago'}</Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => openReviewAction({ type: 'returnAdvance', advance })} className="border-orange-200 text-orange-700"><RotateCcw size={14} className="mr-2" />Devolver</Button>
                        </>}
                        {advance.status === 'returned' && canCorrect && <Button type="button" size="sm" onClick={() => openAdvanceEditor(advance)} className="bg-orange-600 text-white hover:bg-orange-700"><PencilLine size={14} className="mr-2" />Corregir y reenviar</Button>}
                        {isAdvanceFullyPaidForQueue(advance) && (canManage || canCorrectAdvanceReceipt(advance)) && <Button type="button" size="sm" onClick={() => setSelectedAdvance(advance)} className="bg-sky-600 text-white hover:bg-sky-700"><ReceiptText size={14} className="mr-2" />Legalizar</Button>}
                      </div>
                    </div>
                    <AdvanceLifecycle advance={advance} compact />
                    <div className="grid gap-2 border-t border-slate-100 p-3 sm:grid-cols-2 xl:grid-cols-5">
                      <ReceiptGroupMetric label="Solicitado" value={formatMoney(advance.amountRequested)} tone="slate" />
                      <ReceiptGroupMetric label="Ítems" value={`${advance.items?.length || 0}`} tone="slate" />
                      <ReceiptGroupMetric label="Firma solicitante" value={advance.requesterSignature ? 'Verificada' : 'Pendiente'} tone={advance.requesterSignature ? 'emerald' : 'amber'} />
                      <ReceiptGroupMetric label="Firma aprobador" value={advance.approvalSignature ? 'Verificada' : 'Pendiente'} tone={advance.approvalSignature ? 'emerald' : 'amber'} />
                      <div className={`rounded-lg border px-3 py-2 ${paymentSummary.hasPayment ? paymentSummary.isFullyPaid ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800' : 'border-violet-200 bg-violet-50 text-violet-800'}`}>
                        <p className="text-[9px] font-black uppercase tracking-[0.16em] opacity-70">{paymentSummary.isFullyPaid ? 'Pago completo' : paymentSummary.hasPayment ? 'Abono registrado' : 'Soporte de pago'}</p>
                        {paymentSummary.hasPayment ? (
                          <>
                            <p className="mt-1 text-sm font-black">{formatMoney(paymentSummary.paid)} · {paymentSummary.progress}%</p>
                            <p className="mt-0.5 text-[10px] font-bold opacity-80">Saldo: {formatMoney(paymentSummary.balance)}</p>
                          </>
                        ) : <p className="mt-1 text-sm font-black">Pendiente</p>}
                      </div>
                    </div>
                    {(advance.adminComment || advance.paymentSupport?.reference || paymentSummary.supports.length > 0) && (
                      <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-slate-100 bg-slate-50 px-4 py-2 text-xs font-bold text-slate-600">
                        {advance.adminComment && <span><strong className="text-orange-700">Observación:</strong> {advance.adminComment}</span>}
                        {advance.paymentSupport?.reference && <span><strong className="text-emerald-700">Última referencia:</strong> {advance.paymentSupport.reference}</span>}
                        {paymentSummary.supports.length > 0 && <span><strong className="text-fuchsia-700">Soportes de pago:</strong> {paymentSummary.supports.length}</span>}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}

          {view === 'receipts' && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50 via-white to-sky-50 p-4 shadow-sm">
                <div>
                  <h3 className="text-lg font-black text-slate-950">Legalizaciones agrupadas por anticipo</h3>
                  <p className="mt-1 text-sm font-medium text-slate-600">Encuentra, prioriza y organiza los anticipos que requieren gestión administrativa.</p>
                </div>
                <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(320px,1fr)_250px_auto] xl:items-end">
                  <label className="block min-w-0">
                    <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.16em] text-indigo-700">Buscar legalización</span>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-indigo-500" />
                      <input
                        className={`${inputClass} h-12 border-indigo-200 pl-11 shadow-sm focus:border-indigo-500`}
                        value={advanceSearch}
                        onChange={(event) => setAdvanceSearch(event.target.value)}
                        placeholder="Buscar por ID, persona, destino, tarea o rubro..."
                      />
                    </div>
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.16em] text-indigo-700">Organizar resultados</span>
                    <div className="relative">
                      <ArrowUpDown className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-indigo-500" />
                      <select
                        className={`${inputClass} h-12 appearance-none border-indigo-200 pl-10 pr-9 shadow-sm`}
                        value={advanceSort}
                        onChange={(event) => setAdvanceSort(event.target.value as typeof advanceSort)}
                      >
                        <option value="id_desc">ID: mayor a menor</option>
                        <option value="id_asc">ID: menor a mayor</option>
                        <option value="review_desc">Más pendientes primero</option>
                        <option value="amount_desc">Mayor valor anticipado</option>
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    </div>
                  </label>
                  <div>
                    <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.16em] text-indigo-700">Estado de revisión</span>
                    <div className="inline-flex h-12 rounded-xl border border-indigo-200 bg-white p-1 shadow-sm">
                      {([
                        ['all', 'Todos'],
                        ['pending', 'Por revisar'],
                        ['clear', 'Al día'],
                      ] as const).map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setReceiptReviewFilter(id)}
                          className={`rounded-lg px-3 text-xs font-black transition ${
                            receiptReviewFilter === id
                              ? id === 'pending'
                                ? 'bg-red-600 text-white shadow-sm'
                                : id === 'clear'
                                  ? 'bg-emerald-600 text-white shadow-sm'
                                  : 'bg-indigo-600 text-white shadow-sm'
                              : 'text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <p className="mt-3 text-xs font-bold text-slate-500">
                  {visibleReceiptGroups.length} de {receiptGroups.length} anticipo{receiptGroups.length === 1 ? '' : 's'} visible{visibleReceiptGroups.length === 1 ? '' : 's'}
                </p>
              </div>
              {visibleReceiptGroups.length === 0 ? (
                <EmptyState
                  title={advanceSearch.trim() || receiptReviewFilter !== 'all' ? 'No hay resultados con estos filtros' : 'Sin soportes cargados'}
                  body={advanceSearch.trim() || receiptReviewFilter !== 'all' ? 'Ajusta la búsqueda o cambia el estado de revisión para ver más anticipos.' : 'Los comprobantes de campo aparecerán aquí cuando se legalice un anticipo.'}
                />
              ) : (
                visibleReceiptGroups.map((group) => {
                  const isExpanded = expandedReceiptGroups[group.advance.id] ?? false;
                  const advanceStatus = statusConfig[group.advance.status] || statusConfig.submitted;
                  const hasReturned = group.returnedCount > 0;
                  const hasDuplicates = group.duplicateCount > 0;
                  const needsReview = group.pendingCount > 0 || group.returnedCount > 0 || group.duplicateCount > 0;

                  return (
                    <section
                      key={group.advance.id}
                      className={`overflow-hidden rounded-xl border border-l-4 bg-white shadow-sm transition ${
                        needsReview
                          ? 'border-red-300 border-l-red-500 ring-2 ring-red-50'
                          : 'border-emerald-200 border-l-emerald-500 ring-2 ring-emerald-50'
                      }`}
                    >
                      <div className={`border-b p-4 transition ${needsReview ? 'border-red-200 bg-red-50/40' : 'border-emerald-200 bg-emerald-50/30'}`}>
                        <div className="block w-full text-left">
                          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_repeat(5,minmax(120px,auto))] xl:items-center">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  aria-expanded={isExpanded}
                                  aria-label={isExpanded ? 'Ocultar legalizaciones' : 'Mostrar legalizaciones'}
                                  onClick={() =>
                                    setExpandedReceiptGroups((current) => ({
                                      ...current,
                                      [group.advance.id]: !isExpanded,
                                    }))
                                  }
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white text-slate-600 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-100"
                                >
                                  {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                </button>
                                <span className="rounded-md bg-indigo-600 px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-white">Anticipo</span>
                                <span className={`rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ring-1 ${advanceStatus.className}`}>
                                  {advanceStatus.label}
                                </span>
                                {group.advance.customId ? (
                                  <span className="rounded-md bg-violet-50 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-violet-700 ring-1 ring-violet-100">
                                    ID {group.advance.customId}
                                  </span>
                                ) : (
                                  <span className="text-xs font-black text-slate-400">{group.advance.id}</span>
                                )}
                                <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ring-1 ${
                                  needsReview
                                    ? 'bg-red-600 text-white ring-red-600'
                                    : 'bg-emerald-600 text-white ring-emerald-600'
                                }`}>
                                  {needsReview ? <AlertCircle size={12} /> : <CheckCircle2 size={12} />}
                                  {needsReview ? (group.pendingCount > 0 ? `${group.pendingCount} por revisar` : 'Requiere atención') : 'Al día'}
                                </span>
                                {hasReturned && (
                                  <span className="rounded-md bg-rose-100 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-rose-700 ring-1 ring-rose-200">
                                    {group.returnedCount} devuelto{group.returnedCount === 1 ? '' : 's'}
                                  </span>
                                )}
                                {hasDuplicates && (
                                  <span className="rounded-md bg-red-100 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-red-700 ring-1 ring-red-200">
                                    {group.duplicateCount} duplicado{group.duplicateCount === 1 ? '' : 's'}
                                  </span>
                                )}
                                {(canManage || canValidate) && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    onClick={() => openAdvanceEditor(group.advance)}
                                    className="ml-auto bg-indigo-600 font-black text-white shadow-md shadow-indigo-500/20 hover:bg-indigo-700"
                                  >
                                    <PencilLine size={14} className="mr-2" />
                                    Editar anticipo
                                  </Button>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedReceiptGroups((current) => ({
                                    ...current,
                                    [group.advance.id]: !isExpanded,
                                  }))
                                }
                                className="mt-2 block max-w-full text-left"
                              >
                                <h4 className="truncate text-base font-black text-slate-950">{group.advance.purpose || group.advance.destination}</h4>
                                <p className="mt-1 text-xs font-bold text-slate-500">
                                  {group.advance.requesterName} · {group.advance.destination} · {group.receipts.length} soportes
                                </p>
                              </button>
                            </div>
                            <ReceiptGroupMetric label="Anticipado" value={formatMoney(group.approved)} tone="slate" />
                            <ReceiptGroupMetric label="Justificado" value={formatMoney(group.justified)} tone="indigo" />
                            <ReceiptGroupMetric label="Legalizado" value={formatMoney(group.legalized)} tone="emerald" />
                            <ReceiptGroupMetric label="En revisión" value={formatMoney(group.pending)} tone="amber" />
                            <ReceiptGroupMetric
                              label={group.difference < 0 ? 'Por compensar' : group.difference > 0 ? 'Por devolver o justificar' : 'Saldo'}
                              value={formatMoney(Math.abs(group.difference))}
                              tone={group.difference < 0 ? 'rose' : group.difference > 0 ? 'amber' : 'emerald'}
                            />
                          </div>
                          <div className="mt-3 flex items-center gap-3">
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
                              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${group.progress}%` }} />
                            </div>
                            <span className="text-xs font-black text-slate-500">{group.progress}% justificado</span>
                            {group.returned > 0 && (
                              <span className="rounded-md bg-rose-100 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-rose-700 ring-1 ring-rose-200">
                                {formatMoney(group.returned)} devuelto
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <AdvanceLifecycle advance={group.advance} compact />

                      {isExpanded && (
                        <div className="divide-y divide-slate-100">
                          {group.receipts.map((receipt) => {
                            const documentMeta = getReceiptDocumentTypeMeta(receipt.documentType);
                            const statusMeta = getReceiptStatusMeta(receipt.status);
                            const receiptCostCenter = getReceiptCostCenter(receipt, group.advance);
                            const isReturned = receipt.status === 'returned';
                            const duplicateUsage =
                              findDuplicateCufeUsage(receipt, group.advance.id, receipt.id) ||
                              findDuplicateReceiptUsage(receipt, group.advance.id);
                            const canDeleteReceipt = canDeleteReceiptForUser(receipt, group.advance);
                            return (
                              <div
                                key={receipt.id}
                                className={`grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center ${
                                  isReturned ? 'border-l-4 border-rose-500 bg-rose-50/80' : duplicateUsage ? 'border-l-4 border-red-500 bg-red-50/70' : ''
                                }`}
                              >
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-black text-slate-950">{receipt.categoryName}</span>
                                    <span className={`rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ring-1 ${documentMeta.className}`}>
                                      {documentMeta.shortLabel}
                                    </span>
                                    <span className={`rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ring-1 ${statusMeta.className}`}>
                                      {statusMeta.label}
                                    </span>
                                    <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-black text-slate-700">{formatMoney(receipt.amount)}</span>
                                    <span className={`rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-[0.1em] ring-1 ${receiptCostCenter.provisional ? 'bg-amber-50 text-amber-700 ring-amber-100' : 'bg-emerald-50 text-emerald-700 ring-emerald-100'}`}>
                                      {receiptCostCenter.name}{receiptCostCenter.provisional ? ' · provisional' : ''}
                                    </span>
                                    {duplicateUsage && (
                                      <span className="rounded-md bg-red-100 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-red-700 ring-1 ring-red-200">
                                        Factura repetida
                                      </span>
                                    )}
                                    {receipt.dianVerificationStatus === 'confirmed' && (
                                      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-700 ring-1 ring-emerald-200">
                                        <ShieldCheck size={12} /> {receipt.dianVerificationSource === 'audit_base' ? 'Cruzada DIAN' : 'Validada DIAN'}
                                      </span>
                                    )}
                                  </div>
                                  <p className="mt-1 text-sm font-semibold text-slate-600">{receipt.businessName || 'Sin razón social'} · {formatDate(receipt.date)}</p>
                                  <p className="mt-1 break-words text-xs font-semibold text-slate-400">
                                    {receipt.invoiceNumber ? `${documentMeta.numberLabel} ${receipt.invoiceNumber}` : documentMeta.label}
                                    {receipt.cufe ? ` · CUFE ${receipt.cufe}` : ''}
                                    {receipt.revisionCount ? ` · ${receipt.revisionCount} subsanación${receipt.revisionCount === 1 ? '' : 'es'}` : ''}
                                  </p>
                                  {duplicateUsage && (
                                    <div className="mt-3 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700">
                                      Este soporte coincide con &quot;{duplicateUsage.advanceTitle}&quot; de {duplicateUsage.requesterName}.
                                    </div>
                                  )}
                                  {isReturned && receipt.reviewComment && (
                                    <div className="mt-3 rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-700">
                                      <span className="font-black">Corrección solicitada:</span> {receipt.reviewComment}
                                    </div>
                                  )}
                                  {receipt.status === 'approved_modified' && (receipt.approvalChanges || []).length > 0 && (
                                    <p className="mt-2 text-xs font-bold text-indigo-600">Aprobado con {(receipt.approvalChanges || []).length} ajuste(s) administrativo(s) registrados.</p>
                                  )}
                                  <div className="mt-3 flex flex-wrap gap-3">
                                    {(receipt.fileUrl || receipt.storagePath) && (
                                      <SecureDocumentLink storagePath={receipt.storagePath} fallbackUrl={receipt.fileUrl} className="inline-flex items-center gap-1 text-xs font-black text-indigo-600 hover:text-indigo-800">
                                        <FileImage size={14} /> Ver soporte
                                      </SecureDocumentLink>
                                    )}
                                    {receipt.dianDocumentUrl && (
                                      <a href={receipt.dianDocumentUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-black text-sky-700 hover:text-sky-900">
                                        <ExternalLink size={14} /> Consultar en DIAN
                                      </a>
                                    )}
                                  </div>
                                </div>

                                <div className="flex flex-wrap justify-end gap-2">
                                  {canValidate && receipt.status === 'submitted' && (
                                    <>
                                      <Button type="button" size="sm" onClick={() => openReceiptEditor('review', group.advance, receipt)} className="bg-emerald-600 text-white hover:bg-emerald-700">
                                        <PencilLine size={14} className="mr-1" /> Revisar y aprobar
                                      </Button>
                                      <Button type="button" size="sm" variant="outline" onClick={() => openReviewAction({ type: 'returnReceipt', advance: group.advance, receipt })} className="border-rose-200 text-rose-700 hover:bg-rose-50">
                                        Devolver
                                      </Button>
                                    </>
                                  )}
                                  {canAdministrativelyEditReceipt && isApprovedReceipt(receipt) && canEditReceiptInPartialAccountingClosure(group.advance, receipt) && (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() => openReceiptEditor('administrative', group.advance, receipt)}
                                      className="border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                                    >
                                      <PencilLine size={14} className="mr-1" />
                                      {receipt.accountingClosureId ? 'Editar y actualizar cierre' : 'Editar y reenviar'}
                                    </Button>
                                  )}
                                  {isReturned && canCorrectAdvanceReceipt(group.advance) && (
                                    <Button type="button" size="sm" onClick={() => openReceiptEditor('correction', group.advance, receipt)} className="bg-rose-600 text-white hover:bg-rose-700">
                                      <RotateCcw size={14} className="mr-1" /> Subsanar y reenviar
                                    </Button>
                                  )}
                                  {canDeleteReceipt && (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() => openReviewAction({ type: 'deleteReceipt', advance: group.advance, receipt })}
                                      className="border-rose-200 text-rose-700 hover:bg-rose-50"
                                    >
                                      <Trash2 size={14} className="mr-1" />
                                      Eliminar
                                    </Button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  );
                })
              )}
            </div>
          )}

          {view === 'audit' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-cyan-200 bg-gradient-to-r from-cyan-50 to-white p-4 shadow-sm">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-cyan-800">
                      <ShieldCheck size={20} />
                      <h3 className="text-lg font-black">Auditoría DIAN de facturas</h3>
                    </div>
                    <p className="mt-1 max-w-3xl text-sm font-medium text-slate-600">
                      Cruza únicamente facturas aprobadas en legalización contra la base DIAN antes de permitir la conciliación.
                      Las que no crucen quedan en alerta y pueden devolverse para subsanación.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      id="dian-audit-file"
                      type="file"
                      accept=".xlsx,.xls,.csv,.txt,.tsv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,text/plain"
                      className="hidden"
                      disabled={submitting || savingDianAuditBase}
                      onChange={(event) => {
                        const input = event.currentTarget;
                        const file = input.files?.[0] || null;
                        void handleDianAuditFileSelected(file).finally(() => {
                          input.value = '';
                        });
                      }}
                    />
                    <label
                      htmlFor="dian-audit-file"
                      aria-disabled={submitting || savingDianAuditBase}
                      className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-cyan-200 bg-white px-3 text-xs font-black text-cyan-700 transition ${submitting || savingDianAuditBase ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-cyan-50'}`}
                    >
                      {savingDianAuditBase ? <Loader2 size={15} className="animate-spin" /> : <UploadCloud size={15} />}
                      {savingDianAuditBase ? 'Guardando base...' : 'Cargar base DIAN'}
                    </label>
                    <Button
                      type="button"
                      onClick={() => void handleExecuteDianAudit()}
                      disabled={submitting || savingDianAuditBase || activeDianAuditRows.length === 0}
                      className="bg-cyan-700 text-white hover:bg-cyan-800"
                    >
                      {submitting ? <Loader2 size={15} className="mr-2 animate-spin" /> : <ShieldCheck size={15} className="mr-2" />}
                      Ejecutar auditoría
                    </Button>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-4">
                  <ReceiptGroupMetric label="Base vigente" value={activeDianAuditFileName || 'Sin archivo'} tone="slate" />
                  <ReceiptGroupMetric label="Cargada" value={latestDianAuditBatch?.uploadedAt ? formatDate(latestDianAuditBatch.uploadedAt) : 'Sin fecha'} tone="indigo" />
                  <ReceiptGroupMetric label="Filas leídas" value={`${activeDianAuditRowCount}`} tone="indigo" />
                  <ReceiptGroupMetric label="Notas crédito" value={`${activeDianAuditCreditNoteCount}`} tone={activeDianAuditCreditNoteCount ? 'amber' : 'emerald'} />
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <ReceiptGroupMetric label="Por auditar" value={`${auditPendingCount}`} tone="amber" />
                  <ReceiptGroupMetric label="Alertas" value={`${auditAlertCount}`} tone={auditAlertCount ? 'rose' : 'emerald'} />
                </div>
                <p className="mt-3 text-xs font-bold text-slate-500">
                  Columnas reconocidas: CUFE/CUDE, No. factura, NIT, proveedor, valor total, fecha y tipo documento. Al terminar el cargue, la nueva base queda vigente de inmediato. Ejecutar auditoría es una acción independiente y puede hacerse después.
                </p>
                <div className="mt-4 rounded-xl border border-cyan-100 bg-white p-3">
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div className="flex flex-wrap gap-2">
                      {[
                        { id: 'all' as const, label: 'Todas', count: auditPendingCount + auditAlertCount + auditPassedCount },
                        { id: 'pending' as const, label: 'Por auditar', count: auditPendingCount },
                        { id: 'alerts' as const, label: 'Alertas', count: auditAlertCount },
                        { id: 'passed' as const, label: 'Auditadas', count: auditPassedCount },
                      ].map((option) => {
                        const isActive = dianAuditStatusFilter === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => setDianAuditStatusFilter(option.id)}
                            className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-[11px] font-black uppercase tracking-[0.12em] ring-1 transition ${
                              isActive
                                ? 'bg-cyan-700 text-white ring-cyan-700'
                                : 'bg-slate-50 text-slate-600 ring-slate-200 hover:bg-cyan-50 hover:text-cyan-700'
                            }`}
                          >
                            {option.label}
                            <span className={`rounded-md px-1.5 py-0.5 text-[10px] ${isActive ? 'bg-white/20 text-white' : 'bg-white text-slate-500 ring-1 ring-slate-200'}`}>
                              {option.count}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <button
                        type="button"
                        onClick={() =>
                          setCollapsedDianAuditGroups(
                            Object.fromEntries(visibleDianAuditGroups.map((group) => [group.advance.id, false]))
                          )
                        }
                        className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 hover:bg-slate-50"
                      >
                        Expandir todo
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setCollapsedDianAuditGroups(
                            Object.fromEntries(visibleDianAuditGroups.map((group) => [group.advance.id, true]))
                          )
                        }
                        className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 hover:bg-slate-50"
                      >
                        Colapsar todo
                      </button>
                      <div className="relative min-w-0 sm:w-80">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <input
                          className={`${inputClass} h-9 pl-10 text-sm`}
                          value={dianAuditSearch}
                          onChange={(event) => setDianAuditSearch(event.target.value)}
                          placeholder="Buscar factura, proveedor, NIT, CUFE o centro..."
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {visibleDianAuditGroups.length === 0 ? (
                <EmptyState
                  title={dianAuditSearch.trim() || dianAuditStatusFilter !== 'all' ? 'No hay facturas con ese filtro' : 'Sin facturas pendientes de auditoría'}
                  body={dianAuditSearch.trim() || dianAuditStatusFilter !== 'all' ? 'Prueba con otro proveedor, NIT, CUFE, factura o cambia el filtro de estado.' : 'Las facturas aparecerán aquí cuando sean aprobadas desde Legalizaciones. Los recibos de caja no requieren cruce DIAN.'}
                />
              ) : (
	                visibleDianAuditGroups.map((group) => {
	                  const hasActiveDianFilter = Boolean(dianAuditSearch.trim()) || dianAuditStatusFilter !== 'all';
	                  const isCollapsed = collapsedDianAuditGroups[group.advance.id] ?? (!hasActiveDianFilter && group.alerts.length === 0);
	                  const accountingClosures = group.closures;
	                  const finalAccountingClosure = accountingClosures.find((closure) => closure.kind === 'final');
	                  const latestAccountingClosure = accountingClosures[accountingClosures.length - 1];
	                  const unclosedAcceptedReceipts = group.unclosedAcceptedReceipts;
	                  const requesterClosedForTotal = isAdvanceReadyForTotalAccountingClosure(group.advance);
	                  const closureBlockedReceipts = hasBlockingAccountingClosureReceipts(group.advance);
	                  const canCreatePartialClosure =
	                    canValidate &&
	                    !requesterClosedForTotal &&
	                    !finalAccountingClosure &&
	                    unclosedAcceptedReceipts.length > 0;
	                  const canCreateFinalClosure =
	                    canValidate &&
	                    requesterClosedForTotal &&
	                    !finalAccountingClosure &&
	                    !closureBlockedReceipts &&
	                    (unclosedAcceptedReceipts.length > 0 || accountingClosures.length > 0);
	                  const closedAccountingAmount = accountingClosures.reduce((sum, closure) => sum + asNumber(closure.amount), 0);
	                  return (
	                    <section key={group.advance.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                      <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50 p-4 lg:flex-row lg:items-center lg:justify-between">
                        <button
                          type="button"
                          onClick={() => setCollapsedDianAuditGroups((current) => ({ ...current, [group.advance.id]: !isCollapsed }))}
                          className="flex min-w-0 flex-1 items-start gap-3 text-left"
                        >
                          <span className={`mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ${isCollapsed ? 'bg-white text-slate-500 ring-slate-200' : 'bg-cyan-600 text-white ring-cyan-600'}`}>
                            {isCollapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
                          </span>
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="rounded-md bg-cyan-50 px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-cyan-700 ring-1 ring-cyan-100">Auditoría DIAN</span>
                              {group.advance.customId && <span className="rounded-md bg-slate-900 px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-white">ID {group.advance.customId}</span>}
                              {group.pending.length > 0 && <span className="rounded-md bg-amber-50 px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-amber-700 ring-1 ring-amber-100">{group.pending.length} por auditar</span>}
	                              {group.alerts.length > 0 && <span className="rounded-md bg-red-50 px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-red-700 ring-1 ring-red-100">{group.alerts.length} alerta{group.alerts.length === 1 ? '' : 's'}</span>}
	                              {group.passed.length > 0 && <span className="rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-emerald-700 ring-1 ring-emerald-100">{group.passed.length} auditada{group.passed.length === 1 ? '' : 's'}</span>}
	                              {unclosedAcceptedReceipts.length > 0 && <span className="rounded-md bg-violet-50 px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-violet-700 ring-1 ring-violet-100">{unclosedAcceptedReceipts.length} nueva{unclosedAcceptedReceipts.length === 1 ? '' : 's'} para cierre</span>}
	                              {accountingClosures.length > 0 && <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-slate-700 ring-1 ring-slate-200">{accountingClosures.length} cierre{accountingClosures.length === 1 ? '' : 's'} histórico{accountingClosures.length === 1 ? '' : 's'}</span>}
	                              {hasActiveDianFilter && <span className="rounded-md bg-indigo-50 px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-indigo-700 ring-1 ring-indigo-100">{group.visibleReceipts.length} visibles</span>}
                            </span>
                            <span className="mt-2 block truncate text-base font-black text-slate-950">{group.advance.purpose || group.advance.destination}</span>
                            <span className="mt-1 block text-xs font-bold text-slate-500">{group.advance.requesterName} · {group.advance.destination}</span>
                          </span>
                        </button>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setCollapsedDianAuditGroups((current) => ({ ...current, [group.advance.id]: !isCollapsed }))}
                            className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 hover:bg-slate-50"
                          >
                            {isCollapsed ? `Ver ${group.visibleReceipts.length} factura${group.visibleReceipts.length === 1 ? '' : 's'}` : 'Ocultar facturas'}
                          </button>
	                          <Button type="button" size="sm" variant="outline" onClick={() => setViewingAdvance(group.advance)}>
	                            <FileText size={14} className="mr-2" />
	                            Ver anticipo
	                          </Button>
	                          {canCreatePartialClosure && (
	                            <Button
	                              type="button"
	                              size="sm"
	                              onClick={() => void handleCreateAccountingClosure(group.advance, 'partial')}
	                              disabled={submitting}
	                              className="bg-violet-600 text-white hover:bg-violet-700"
	                            >
	                              {submitting ? <Loader2 size={14} className="mr-2 animate-spin" /> : <CheckCircle2 size={14} className="mr-2" />}
	                              Cerrar parcial
	                            </Button>
	                          )}
	                          {canCreateFinalClosure && (
	                            <Button
	                              type="button"
	                              size="sm"
	                              onClick={() => void handleCreateAccountingClosure(group.advance, 'final')}
	                              disabled={submitting}
	                              className="bg-emerald-600 text-white hover:bg-emerald-700"
	                            >
	                              {submitting ? <Loader2 size={14} className="mr-2 animate-spin" /> : <CheckCircle2 size={14} className="mr-2" />}
	                              Cierre total
	                            </Button>
	                          )}
	                        </div>
	                      </div>
	                      {isCollapsed ? (
	                        <div className="grid gap-2 p-4 md:grid-cols-4">
	                          <ReceiptGroupMetric label="Facturas visibles" value={`${group.visibleReceipts.length}`} tone="slate" />
	                          <ReceiptGroupMetric label="Por auditar" value={`${group.pending.length}`} tone="amber" />
	                          <ReceiptGroupMetric label="Alertas" value={`${group.alerts.length}`} tone={group.alerts.length ? 'rose' : 'emerald'} />
	                          <ReceiptGroupMetric label="Cerrado histórico" value={formatMoney(closedAccountingAmount)} tone="emerald" />
	                        </div>
	                      ) : (
	                        <>
	                          <AdvanceLifecycle advance={group.advance} compact />
	                          {(accountingClosures.length > 0 || unclosedAcceptedReceipts.length > 0) && (
	                            <div className="border-b border-slate-100 bg-white px-4 py-3">
	                              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
	                                <div className="min-w-0">
	                                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Histórico de cierres contables</p>
	                                  <div className="mt-2 flex flex-wrap gap-2">
	                                    {accountingClosures.length === 0 ? (
	                                      <span className="rounded-lg border border-dashed border-violet-200 bg-violet-50 px-3 py-2 text-xs font-black text-violet-700">
	                                        Sin cierres previos · {unclosedAcceptedReceipts.length} factura{unclosedAcceptedReceipts.length === 1 ? '' : 's'} lista{unclosedAcceptedReceipts.length === 1 ? '' : 's'} para el primer corte
	                                      </span>
	                                    ) : accountingClosures.map((closure) => {
	                                      const canEditClosure =
	                                        canEditAccountingClosures &&
	                                        closure.kind === 'partial' &&
	                                        latestAccountingClosure?.id === closure.id &&
	                                        !finalAccountingClosure;
	                                      const canDeleteClosure =
	                                        canDeleteAccountingClosures &&
	                                        closure.kind === 'partial' &&
	                                        latestAccountingClosure?.id === closure.id &&
	                                        !finalAccountingClosure;
	                                      return (
	                                        <span key={closure.id} className="inline-flex items-stretch overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
	                                          <button
	                                            type="button"
	                                            onClick={() =>
	                                              void downloadAdvanceDossier({
	                                                advance: group.advance,
	                                                reportReceipts: getAccountingClosureReceipts(closure, group.advance),
	                                                title: closure.title,
	                                                filePrefix: closure.kind === 'final' ? 'cierre-total-anticipo' : 'cierre-parcial-anticipo',
	                                                scope: 'partialClose',
	                                                accountingClosure: {
	                                                  ...closure,
	                                                  receiptSnapshots: getAccountingClosureReceipts(closure, group.advance),
	                                                },
	                                              })
	                                            }
	                                            className="inline-flex items-center gap-2 px-3 py-2 text-xs font-black text-slate-700 hover:bg-indigo-50 hover:text-indigo-700"
	                                          >
	                                            <Download size={13} />
	                                            {closure.kind === 'final' ? 'Total' : `Parcial ${closure.sequence}`} · {formatMoney(closure.amount)} · {formatDate(closure.createdAt)}
	                                          </button>
	                                          {canEditClosure && (
	                                            <button
	                                              type="button"
	                                              onClick={() => openAccountingClosureEditor(group.advance, closure)}
	                                              className="inline-flex items-center justify-center border-l border-slate-200 bg-white px-2.5 text-violet-700 hover:bg-violet-50"
	                                              title="Editar último cierre parcial"
	                                              aria-label={`Editar cierre parcial ${closure.sequence}`}
	                                            >
	                                              <PencilLine size={13} />
	                                            </button>
	                                          )}
	                                          {canDeleteClosure && (
	                                            <button
	                                              type="button"
	                                              onClick={() => openAccountingClosureDelete(group.advance, closure)}
	                                              className="inline-flex items-center justify-center border-l border-slate-200 bg-white px-2.5 text-rose-600 hover:bg-rose-50"
	                                              title="Eliminar último cierre parcial"
	                                              aria-label={`Eliminar cierre parcial ${closure.sequence}`}
	                                            >
	                                              <Trash2 size={13} />
	                                            </button>
	                                          )}
	                                        </span>
	                                      );
	                                    })}
	                                  </div>
	                                </div>
	                              <div className="grid gap-2 sm:grid-cols-2 lg:w-[25rem]">
	                                  <ReceiptGroupMetric label="Cerrado acumulado" value={formatMoney(closedAccountingAmount)} tone="emerald" />
	                                  <ReceiptGroupMetric label="Nuevo para cierre" value={formatMoney(unclosedAcceptedReceipts.reduce((sum, receipt) => sum + asNumber(receipt.amount), 0))} tone={unclosedAcceptedReceipts.length ? 'indigo' : 'slate'} />
	                                </div>
	                              </div>
	                              {latestAccountingClosure && (latestAccountingClosure.excludedReceiptSummary || []).length > 0 && (
	                                <details className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
	                                  <summary className="cursor-pointer text-xs font-black text-amber-800">
	                                    {(latestAccountingClosure.excludedReceiptSummary || []).length} soporte{(latestAccountingClosure.excludedReceiptSummary || []).length === 1 ? '' : 's'} fuera del último cierre por validaciones pendientes
	                                  </summary>
	                                  <div className="mt-3 space-y-2">
	                                    {(latestAccountingClosure.excludedReceiptSummary || []).map((excluded) => (
	                                      <div key={excluded.receiptId} className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs">
	                                        <p className="font-black text-slate-900">
	                                          {excluded.invoiceNumber || 'Soporte sin número'} · {excluded.provider || 'Proveedor sin nombre'} · {formatMoney(excluded.amount)}
	                                        </p>
	                                        <p className="mt-1 font-semibold text-amber-800">{excluded.reason}</p>
	                                      </div>
	                                    ))}
	                                  </div>
	                                </details>
	                              )}
	                            </div>
	                          )}
	                          <div className="divide-y divide-slate-100">
                            {group.visibleReceipts.length === 0 ? (
                              <div className="p-4 text-sm font-bold text-emerald-700">Este anticipo no tiene facturas disponibles para el filtro seleccionado.</div>
                            ) : (
                              group.visibleReceipts.map((receipt) => {
                          const statusMeta = getReceiptStatusMeta(receipt.status);
                          const documentMeta = getReceiptDocumentTypeMeta(receipt.documentType);
                          const receiptCostCenter = getReceiptCostCenter(receipt, group.advance);
                          return (
                            <div key={receipt.id} className={`grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center ${receipt.status === 'audit_alert' ? 'border-l-4 border-red-500 bg-red-50/70' : ''}`}>
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-black text-slate-950">{receipt.categoryName}</span>
                                  <span className={`rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ring-1 ${documentMeta.className}`}>
                                    {documentMeta.shortLabel}
                                  </span>
                                  <span className={`rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ring-1 ${statusMeta.className}`}>
                                    {statusMeta.label}
                                  </span>
                                  <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-black text-slate-700">{formatMoney(receipt.amount)}</span>
                                  <span className={`rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-[0.1em] ring-1 ${receiptCostCenter.provisional ? 'bg-amber-50 text-amber-700 ring-amber-100' : 'bg-emerald-50 text-emerald-700 ring-emerald-100'}`}>
                                    {receiptCostCenter.name}{receiptCostCenter.provisional ? ' · provisional' : ''}
                                  </span>
                                  {receipt.pdfNormalization && (
                                    <span
                                      className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-indigo-700 ring-1 ring-indigo-100"
                                      title={`PDF normalizado el ${formatDate(receipt.pdfNormalization.normalizedAt)} · ${receipt.pdfNormalization.pageCount} páginas`}
                                    >
                                      <ShieldCheck size={11} /> PDF normalizado
                                    </span>
                                  )}
                                </div>
                                <p className="mt-1 text-sm font-semibold text-slate-600">{receipt.businessName || 'Sin razón social'} · {formatDate(receipt.date)}</p>
                                <p className="mt-1 break-words text-xs font-semibold text-slate-400">
                                  {receipt.invoiceNumber ? `${documentMeta.numberLabel} ${receipt.invoiceNumber}` : documentMeta.label}
                                  {receipt.taxId ? ` · NIT ${receipt.taxId}` : ''}
                                  {receipt.cufe ? ` · CUFE ${receipt.cufe}` : ''}
                                </p>
                                {receipt.accountingAuditMessage && (
                                  <div className={`mt-3 rounded-lg border px-3 py-2 text-xs font-bold ${receipt.status === 'audit_alert' ? 'border-red-200 bg-white text-red-700' : 'border-cyan-200 bg-cyan-50 text-cyan-700'}`}>
                                    <p>{receipt.accountingAuditMessage}</p>
                                    {receipt.accountingAuditRecommendation && (
                                      <p className="mt-1 font-semibold text-slate-600">{receipt.accountingAuditRecommendation}</p>
                                    )}
                                  </div>
                                )}
                                {receipt.status === 'audit_alert' && (receipt.accountingAuditCreditNotes || []).length > 0 && (
                                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-700">Notas crédito del proveedor</p>
                                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                                      {(receipt.accountingAuditCreditNotes || []).slice(0, 4).map((item) => (
                                        <div key={`${receipt.id}-credit-${item.rowNumber}`} className="rounded-md bg-white px-3 py-2 text-xs font-bold text-slate-700 ring-1 ring-amber-100">
                                          <p className="text-amber-700">{item.documentType || 'Nota crédito'} · fila {item.rowNumber}</p>
                                          <p>{item.invoiceNumber || 'Sin número'} · {formatMoney(item.amount)}</p>
                                          <p className="text-slate-500">{formatDate(item.date)}</p>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {receipt.status === 'audit_alert' && (receipt.accountingAuditProviderHistory || []).length > 0 && (
                                  <details className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                                    <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.14em] text-slate-600">
                                      Historial DIAN del proveedor ({receipt.accountingAuditProviderHistory?.length || 0})
                                    </summary>
                                    <div className="mt-3 overflow-x-auto">
                                      <table className="min-w-full text-left text-xs">
                                        <thead className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                                          <tr>
                                            <th className="py-2 pr-3">Tipo</th>
                                            <th className="py-2 pr-3">Documento</th>
                                            <th className="py-2 pr-3">Fecha</th>
                                            <th className="py-2 pr-3 text-right">Valor</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 font-semibold text-slate-600">
                                          {(receipt.accountingAuditProviderHistory || []).map((item) => (
                                            <tr key={`${receipt.id}-history-${item.rowNumber}`}>
                                              <td className="py-2 pr-3">{item.documentType || 'Sin tipo'}</td>
                                              <td className="py-2 pr-3">{item.invoiceNumber || `Fila ${item.rowNumber}`}</td>
                                              <td className="py-2 pr-3">{formatDate(item.date)}</td>
                                              <td className="py-2 pr-3 text-right font-black">{formatMoney(item.amount)}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </details>
                                )}
                                <div className="mt-3 flex flex-wrap gap-3">
                                  {(receipt.fileUrl || receipt.storagePath) && (
                                    <SecureDocumentLink storagePath={receipt.storagePath} fallbackUrl={receipt.fileUrl} className="inline-flex items-center gap-1 text-xs font-black text-indigo-600 hover:text-indigo-800">
                                      <FileImage size={14} /> Ver soporte
                                    </SecureDocumentLink>
                                  )}
                                  {receipt.pdfNormalization && (canManage || canValidate) && (
                                    <SecureDocumentLink
                                      storagePath={receipt.pdfNormalization.originalStoragePath}
                                      className="inline-flex items-center gap-1 text-xs font-black text-slate-500 hover:text-slate-800"
                                      title="Abrir el PDF cifrado preservado como evidencia"
                                    >
                                      <ShieldCheck size={14} /> Original protegido
                                    </SecureDocumentLink>
                                  )}
                                  {receipt.dianDocumentUrl && (
                                    <a href={receipt.dianDocumentUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-black text-sky-700 hover:text-sky-900">
                                      <ExternalLink size={14} /> Consultar en DIAN
                                    </a>
                                  )}
                                </div>
                              </div>
                              <div className="flex flex-wrap justify-end gap-2">
                                {canValidate && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => openReceiptEditor('audit', group.advance, receipt)}
                                    disabled={!canEditReceiptInPartialAccountingClosure(group.advance, receipt)}
                                    className="border-cyan-200 text-cyan-700 hover:bg-cyan-50"
                                  >
                                    <PencilLine size={14} className="mr-1" />
                                    {canEditReceiptInPartialAccountingClosure(group.advance, receipt)
                                      ? receipt.accountingClosureId
                                        ? 'Editar y actualizar cierre'
                                        : 'Editar legalización'
                                      : 'Cierre total bloqueado'}
                                  </Button>
                                )}
                                {canValidate && receipt.status === 'audit_alert' && (
                                  <>
                                    {receipt.accountingAuditMatch && (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={() => void handleAcceptDianAuditAlert(group.advance, receipt)}
                                        disabled={submitting}
                                        className="border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                                      >
                                        <ShieldCheck size={14} className="mr-1" />
                                        Aceptar revisión
                                      </Button>
                                    )}
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => openReviewAction({ type: 'returnReceipt', advance: group.advance, receipt })}
                                    className="border-rose-200 text-rose-700 hover:bg-rose-50"
                                  >
                                    <RotateCcw size={14} className="mr-1" />
                                    Devolver a legalización
                                  </Button>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                              })
                            )}
                          </div>
                        </>
                      )}
                    </section>
                  );
                })
              )}
            </div>
          )}

          {view === 'conciliation' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-cyan-200 bg-gradient-to-r from-cyan-50 to-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-cyan-800"><RefreshCw size={20} /><h3 className="text-lg font-black">Conciliación de anticipos</h3></div>
                    <p className="mt-1 text-sm font-medium text-slate-600">Compara lo anticipado, justificado y legalizado. El expediente solo se cierra con devolución o compensación soportada cuando exista diferencia.</p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <button
                      type="button"
                      aria-pressed={showReconciledAdvances}
                      onClick={() => setShowReconciledAdvances((current) => !current)}
                      className={`inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg px-3 text-xs font-black ring-1 transition ${
                        showReconciledAdvances
                          ? 'bg-teal-600 text-white ring-teal-600'
                          : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {showReconciledAdvances ? <EyeOff size={15} /> : <Eye size={15} />}
                      {showReconciledAdvances
                        ? 'Ocultar conciliados'
                        : `Mostrar conciliados${hiddenReconciledAdvancesCount ? ` (${hiddenReconciledAdvancesCount})` : ''}`}
                    </button>
                    <div className="relative min-w-0 lg:w-80">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input className={`${inputClass} pl-10`} value={advanceSearch} onChange={(event) => setAdvanceSearch(event.target.value)} placeholder="Buscar conciliación por ID, persona o destino..." />
                    </div>
                  </div>
                </div>
              </div>
              {visibleReconciliationAdvances.length === 0 ? (
                <EmptyState
                  title={advanceSearch.trim() ? 'No se encontró esa conciliación' : 'Sin anticipos pendientes de conciliación'}
                  body={
                    hiddenReconciledAdvancesCount > 0 && !showReconciledAdvances
                      ? 'Los anticipos ya conciliados están ocultos. Puedes consultarlos en Costos reales o activar “Mostrar conciliados”.'
                      : 'Aparecerán aquí cuando el profesional cierre su justificación y todos los soportes entren a revisión.'
                  }
                />
              ) : visibleReconciliationAdvances.map((item) => {
                const { advance } = item;
                const hasOpenReceipts = (advance.receipts || []).some((receipt) => !isApprovedReceipt(receipt));
                const requiredKind = item.returnRequired > 0 ? 'return' : item.compensationRequired > 0 ? 'compensation' : 'exact';
                const requiredSupport = requiredKind === 'return' ? advance.returnSupport : requiredKind === 'compensation' ? advance.compensationSupport : null;
                const requiredAmount = requiredKind === 'return' ? item.returnRequired : requiredKind === 'compensation' ? item.compensationRequired : 0;
                const supportMatches = requiredKind === 'exact' || Boolean(requiredSupport && Math.abs(asNumber(requiredSupport.amount) - requiredAmount) < 0.01);
                const isReconciled = advance.reconciliationStatus === 'reconciled';
                return (
                  <section key={advance.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50 p-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] ring-1 ${isReconciled ? 'bg-emerald-50 text-emerald-700 ring-emerald-100' : hasOpenReceipts ? 'bg-amber-50 text-amber-700 ring-amber-100' : 'bg-cyan-50 text-cyan-700 ring-cyan-100'}`}>
                            {isReconciled ? 'Conciliado' : hasOpenReceipts ? 'Pendiente de validación' : requiredKind === 'return' ? 'Requiere devolución' : requiredKind === 'compensation' ? 'Requiere compensación' : 'Listo para cerrar'}
                          </span>
                          {advance.customId && <span className="rounded-md bg-slate-900 px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-white">ID {advance.customId}</span>}
                        </div>
                        <h4 className="mt-2 truncate text-base font-black text-slate-950">{advance.purpose || advance.destination}</h4>
                        <p className="mt-1 text-xs font-bold text-slate-500">{advance.requesterName} · {advance.destination}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => setViewingAdvance(advance)}><FileText size={14} className="mr-2" />Ver anticipo</Button>
                        <AdvanceReportMenu
                          advance={advance}
                          onSelect={(scope) => void downloadAdvanceReportOption(advance, scope)}
                        />
                        {!isReconciled && !hasOpenReceipts && requiredKind === 'return' && !supportMatches && (canCorrectAdvanceReceipt(advance) || canManage || canValidate) && (
                          <Button type="button" size="sm" onClick={() => openReconciliationSupport(advance)} className="bg-amber-600 text-white hover:bg-amber-700"><Upload size={14} className="mr-2" />{requiredSupport ? 'Actualizar devolución' : 'Cargar devolución'}</Button>
                        )}
                        {!isReconciled && !hasOpenReceipts && requiredKind === 'compensation' && !supportMatches && canValidate && (
                          <Button type="button" size="sm" onClick={() => openReconciliationSupport(advance)} className="bg-violet-600 text-white hover:bg-violet-700"><Upload size={14} className="mr-2" />{requiredSupport ? 'Actualizar compensación' : 'Cargar compensación'}</Button>
                        )}
                        {!isReconciled && !hasOpenReceipts && supportMatches && canValidate && (
                          <Button type="button" size="sm" onClick={() => void handleFinalizeReconciliation(advance)} disabled={submitting} className="bg-emerald-600 text-white hover:bg-emerald-700"><CheckCircle2 size={14} className="mr-2" />Conciliar y cerrar</Button>
                        )}
                      </div>
                    </div>
                    <AdvanceLifecycle advance={advance} compact />
                    <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5">
                      <ReceiptGroupMetric label="Anticipado" value={formatMoney(item.anticipated)} tone="slate" />
                      <ReceiptGroupMetric label="Justificado" value={formatMoney(item.justified)} tone="indigo" />
                      <ReceiptGroupMetric label="Legalizado" value={formatMoney(item.legalized)} tone="emerald" />
                      <ReceiptGroupMetric label={requiredKind === 'compensation' ? 'Por compensar' : 'Por devolver'} value={formatMoney(requiredKind === 'compensation' ? item.compensationRequired : item.returnRequired)} tone="amber" />
                      <ReceiptGroupMetric label="Soportes" value={`${(advance.receipts || []).length}`} tone="slate" />
                    </div>
                    {requiredSupport && (
                      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-600">
                        <span>{requiredKind === 'return' ? 'Devolución' : 'Compensación'}: {formatMoney(requiredSupport.amount)} · {formatDate(requiredSupport.date)}{requiredSupport.reference ? ` · Ref. ${requiredSupport.reference}` : ''}</span>
                        <SecureDocumentLink storagePath={requiredSupport.storagePath} fallbackUrl={requiredSupport.fileUrl} className="inline-flex items-center gap-2 font-black text-indigo-700"><FileText size={14} />Ver soporte</SecureDocumentLink>
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}

          {view === 'payments' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div><h3 className="text-lg font-black text-slate-950">Costos reales por anticipo conciliado</h3><p className="text-sm font-medium text-slate-500">Cada expediente cerrado agrupa soportes validados, devolución o compensación, centros de costo y el informe final.</p></div>
                  <div className="relative min-w-0 lg:w-96">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input className={`${inputClass} pl-10`} value={advanceSearch} onChange={(event) => setAdvanceSearch(event.target.value)} placeholder="Buscar costo real por ID del anticipo..." />
                  </div>
                </div>
              </div>
              {realCostAdvanceGroups.length === 0 ? (
                <EmptyState
                  title={advanceSearch.trim() ? 'No se encontró ese ID de anticipo' : 'Sin anticipos finalizados'}
                  body={advanceSearch.trim() ? 'Verifica el ID administrativo o el identificador interno e intenta nuevamente.' : 'Los costos reales aparecerán únicamente después de cerrar la conciliación administrativa.'}
                />
              ) : (
                realCostAdvanceGroups.map((group) => {
                  const statusMeta = statusConfig[group.advance.status] || statusConfig.closed;
                  const attachedSupportCount = group.receipts.filter(
                    (receipt) => Boolean(receipt.storagePath || receipt.fileUrl)
                  ).length;
                  return (
                    <section key={group.advance.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                      <div className="grid gap-4 border-b border-slate-100 bg-slate-50 p-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-md bg-slate-900 px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-white">
                              Costo real
                            </span>
                            <span className={`rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ring-1 ${statusMeta.className}`}>
                              {statusMeta.label}
                            </span>
                            {group.advance.customId && (
                              <span className="rounded-md bg-violet-50 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-violet-700 ring-1 ring-violet-100">
                                ID {group.advance.customId}
                              </span>
                            )}
                            <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-slate-600 ring-1 ring-slate-200">
                              {group.receipts.length} legalización{group.receipts.length === 1 ? '' : 'es'} aprobada{group.receipts.length === 1 ? '' : 's'}
                            </span>
                            <span className="rounded-md bg-indigo-50 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-indigo-700 ring-1 ring-indigo-100">
                              {attachedSupportCount} soporte{attachedSupportCount === 1 ? '' : 's'} adjunto{attachedSupportCount === 1 ? '' : 's'}
                            </span>
                          </div>
                          <h4 className="mt-2 truncate text-base font-black text-slate-950">{group.advance.purpose || group.advance.destination}</h4>
                          <p className="mt-1 text-xs font-bold text-slate-500">
                            {group.advance.requesterName} · {group.advance.destination} · cerrado {formatDate(group.advance.closedAt || group.advance.updatedAt)}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" variant="outline" onClick={() => setViewingAdvance(group.advance)}>
                            <FileText size={16} className="mr-2" />
                            Ver anticipo
                          </Button>
                          <AdvanceReportMenu
                            advance={group.advance}
                            onSelect={(scope) => void downloadAdvanceReportOption(group.advance, scope, group.realCost)}
                            dark
                          />
                        </div>
                      </div>

                      <AdvanceLifecycle advance={group.advance} compact />

                      <div className="grid gap-3 p-4 md:grid-cols-3 xl:grid-cols-7">
                        <ReceiptGroupMetric label="Anticipado" value={formatMoney(group.coverage.approved)} tone="slate" />
                        <ReceiptGroupMetric label="Justificado" value={formatMoney(getAdvanceJustifiedAmount(group.advance))} tone="indigo" />
                        <ReceiptGroupMetric label="Legalizado" value={formatMoney(group.coverage.legalized)} tone="emerald" />
                        <ReceiptGroupMetric label="Devuelto" value={formatMoney(group.coverage.returnedCash)} tone="amber" />
                        <ReceiptGroupMetric label="Compensado" value={formatMoney(group.advance.amountCompensated)} tone="indigo" />
                        <ReceiptGroupMetric label="Costo real" value={formatMoney(group.realCost)} tone="slate" />
                        <ReceiptGroupMetric label="Soportes adjuntos" value={`${attachedSupportCount}`} tone="slate" />
                      </div>

                      <div className="grid gap-4 border-t border-slate-100 p-4 lg:grid-cols-[0.9fr_1.4fr]">
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Centros de costo</p>
                          <div className="mt-3 space-y-2">
                            {group.costCenters.map((center) => (
                              <div key={center.id} className="rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate text-sm font-black text-slate-900">{center.name}</span>
                                  <span className="text-xs font-black text-indigo-600">{center.percentage}%</span>
                                </div>
                                <p className="mt-1 text-xs font-bold text-slate-500">
                                  {formatMoney(center.amount)}
                                  {center.note ? ` · ${center.note}` : ''}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="rounded-xl border border-slate-200 bg-white">
                          <div className="border-b border-slate-100 px-3 py-2">
                            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Ficha técnica de legalizaciones</p>
                          </div>
                          <div className="divide-y divide-slate-100">
                            {group.receipts.length === 0 ? (
                              <div className="p-3 text-sm font-bold text-slate-500">Sin soportes aprobados.</div>
                            ) : (
                              group.receipts.map((receipt) => {
                                const documentMeta = getReceiptDocumentTypeMeta(receipt.documentType);
                                const receiptCostCenter = getReceiptCostCenter(receipt, group.advance);
                                return (
                                  <div key={receipt.id} className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-sm font-black text-slate-950">{receipt.categoryName}</span>
                                        <span className={`rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ring-1 ${documentMeta.className}`}>
                                          {documentMeta.shortLabel}
                                        </span>
                                        <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-black text-slate-700">
                                          {formatMoney(receipt.amount)}
                                        </span>
                                        <span className={`rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-[0.1em] ring-1 ${receiptCostCenter.provisional ? 'bg-amber-50 text-amber-700 ring-amber-100' : 'bg-emerald-50 text-emerald-700 ring-emerald-100'}`}>
                                          {receiptCostCenter.name}{receiptCostCenter.provisional ? ' · provisional' : ''}
                                        </span>
                                      </div>
                                      <p className="mt-1 truncate text-xs font-bold text-slate-500">
                                        {receipt.businessName || 'Sin razón social'} · {formatDate(receipt.date)}
                                      </p>
                                      <p className="mt-1 break-words text-[11px] font-semibold text-slate-400">
                                        {receipt.invoiceNumber ? `${documentMeta.numberLabel} ${receipt.invoiceNumber}` : documentMeta.label}
                                        {receipt.cufe ? ` · CUFE ${receipt.cufe}` : ''}
                                      </p>
                                    </div>
                                    {(receipt.fileUrl || receipt.storagePath) && (
                                      <SecureDocumentLink
                                        storagePath={receipt.storagePath}
                                        fallbackUrl={receipt.fileUrl}
                                        className="inline-flex items-center justify-center gap-1 rounded-lg border border-indigo-100 px-3 py-2 text-xs font-black text-indigo-600 hover:bg-indigo-50"
                                      >
                                        <FileImage size={14} />
                                        Soporte
                                      </SecureDocumentLink>
                                    )}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      </div>
                    </section>
                  );
                })
              )}
            </div>
          )}

          {view === 'settings' && (
            <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 p-4">
                  <h3 className="flex items-center gap-2 text-lg font-black text-slate-950">
                    <Settings2 size={18} className="text-indigo-600" />
                    Dominios de gasto
                  </h3>
                  <p className="text-sm font-medium text-slate-500">Transporte, alimentación, hospedaje y cualquier otro rubro configurable.</p>
                </div>
                <div className="divide-y divide-slate-100">
                  {categoryOptions.map((category) => (
                    <div key={category.id} className="grid gap-3 p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center">
                      <span className="h-4 w-4 rounded-full" style={{ backgroundColor: category.color || '#64748b' }} />
                      <div>
                        <p className="font-black text-slate-950">{category.name}</p>
                        <p className="text-xs font-semibold text-slate-500">
                          {formatMoney(category.defaultDailyAmount)} por {category.unitLabel || 'dia'}
                          {category.requiresCufe ? ' · requiere CUFE' : ''}
                        </p>
                        {category.description && <p className="mt-1 text-xs font-medium text-slate-400">{category.description}</p>}
                      </div>
                      {canConfigure && !category.id.startsWith('default-') && (
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setCategoryForm({
                                id: category.id,
                                name: category.name,
                                defaultDailyAmount: String(category.defaultDailyAmount || ''),
                                unitLabel: category.unitLabel || 'dia',
                                color: category.color || '#4f46e5',
                                requiresCufe: Boolean(category.requiresCufe),
                                description: category.description || '',
                              })
                            }
                          >
                            Editar
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => toggleCategory(category)}
                            className={category.active === false ? 'border-emerald-200 text-emerald-700' : 'border-rose-200 text-rose-700'}
                          >
                            {category.active === false ? 'Activar' : 'Desactivar'}
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="text-base font-black text-slate-950">{categoryForm.id ? 'Editar dominio' : 'Nuevo dominio'}</h3>
                <div className="mt-4 space-y-3">
                  <Field label="Nombre">
                    <input className={inputClass} value={categoryForm.name} onChange={(event) => setCategoryForm((current) => ({ ...current, name: event.target.value }))} placeholder="Ej: Transporte rural" />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Valor por unidad">
                      <input className={inputClass} type="number" value={categoryForm.defaultDailyAmount} onChange={(event) => setCategoryForm((current) => ({ ...current, defaultDailyAmount: event.target.value }))} />
                    </Field>
                    <Field label="Unidad">
                      <input className={inputClass} value={categoryForm.unitLabel} onChange={(event) => setCategoryForm((current) => ({ ...current, unitLabel: event.target.value }))} />
                    </Field>
                  </div>
                  <Field label="Color">
                    <input className={`${inputClass} p-1`} type="color" value={categoryForm.color} onChange={(event) => setCategoryForm((current) => ({ ...current, color: event.target.value }))} />
                  </Field>
                  <label className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-sm font-bold text-slate-700">
                    <input type="checkbox" checked={categoryForm.requiresCufe} onChange={(event) => setCategoryForm((current) => ({ ...current, requiresCufe: event.target.checked }))} />
                    Requiere CUFE para validar factura
                  </label>
                  <Field label="Descripción">
                    <textarea className={textareaClass} value={categoryForm.description} onChange={(event) => setCategoryForm((current) => ({ ...current, description: event.target.value }))} />
                  </Field>
                  <Button type="button" onClick={saveCategory} disabled={submitting || !canConfigure} className="w-full bg-indigo-600 font-bold text-white hover:bg-indigo-700">
                    {submitting && <Loader2 size={16} className="mr-2 animate-spin" />}
                    Guardar dominio
                  </Button>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 p-4">
                  <h3 className="flex items-center gap-2 text-lg font-black text-slate-950">
                    <FolderKanban size={18} className="text-emerald-600" />
                    Centros de costos
                  </h3>
                  <p className="text-sm font-medium text-slate-500">
                    Catálogo configurable para clasificar y distribuir los anticipos del proyecto.
                  </p>
                </div>
                <div className="divide-y divide-slate-100">
                  {(costCenterDomains.length > 0 ? costCenterDomains : costCenterOptions).map((center) => (
                    <div key={center.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-black text-slate-950">{center.name}</p>
                          {center.code && (
                            <span className="rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-emerald-700 ring-1 ring-emerald-100">
                              {center.code}
                            </span>
                          )}
                          {center.active === false && (
                            <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
                              Inactivo
                            </span>
                          )}
                        </div>
                        {center.description && (
                          <p className="mt-1 text-xs font-medium text-slate-400">{center.description}</p>
                        )}
                      </div>
                      {canConfigure && !center.id.startsWith('default-cost-center-') && (
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setCostCenterForm({
                                id: center.id,
                                name: center.name,
                                code: center.code || '',
                                description: center.description || '',
                              })
                            }
                          >
                            Editar
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => toggleCostCenter(center)}
                            className={center.active === false ? 'border-emerald-200 text-emerald-700' : 'border-rose-200 text-rose-700'}
                          >
                            {center.active === false ? 'Activar' : 'Desactivar'}
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="text-base font-black text-slate-950">
                  {costCenterForm.id ? 'Editar centro de costos' : 'Nuevo centro de costos'}
                </h3>
                <div className="mt-4 space-y-3">
                  <Field label="Nombre">
                    <input
                      className={inputClass}
                      value={costCenterForm.name}
                      onChange={(event) => setCostCenterForm((current) => ({ ...current, name: event.target.value }))}
                      placeholder="Ej: Operación de campo"
                    />
                  </Field>
                  <Field label="Código (opcional)">
                    <input
                      className={inputClass}
                      value={costCenterForm.code}
                      maxLength={30}
                      onChange={(event) => setCostCenterForm((current) => ({ ...current, code: event.target.value }))}
                      placeholder="Ej: CC-001"
                    />
                  </Field>
                  <Field label="Descripción">
                    <textarea
                      className={textareaClass}
                      value={costCenterForm.description}
                      onChange={(event) => setCostCenterForm((current) => ({ ...current, description: event.target.value }))}
                      placeholder="Uso previsto de este centro de costos."
                    />
                  </Field>
                  <Button
                    type="button"
                    onClick={saveCostCenter}
                    disabled={submitting || !canConfigure}
                    className="w-full bg-emerald-600 font-bold text-white hover:bg-emerald-700"
                  >
                    {submitting && <Loader2 size={16} className="mr-2 animate-spin" />}
                    Guardar centro de costos
                  </Button>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 p-4">
                  <h3 className="flex items-center gap-2 text-lg font-black text-slate-950">
                    <Banknote size={18} className="text-cyan-600" />
                    Empresas pagadoras
                  </h3>
                  <p className="text-sm font-medium text-slate-500">
                    Razones sociales que pueden figurar como cliente o deudor en las cuentas de cobro.
                  </p>
                </div>
                <div className="divide-y divide-slate-100">
                  {(contractorAccountPayers.length > 0 ? contractorAccountPayers : contractorAccountPayerOptions).map((payer) => (
                    <div key={payer.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-black text-slate-950">{payer.name}</p>
                          <span className="rounded-md bg-cyan-50 px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-cyan-700 ring-1 ring-cyan-100">
                            NIT {payer.taxId}
                          </span>
                          {payer.active === false && (
                            <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Inactiva</span>
                          )}
                        </div>
                        {(payer.address || payer.city) && (
                          <p className="mt-1 text-xs font-medium text-slate-400">{[payer.address, payer.city].filter(Boolean).join(' · ')}</p>
                        )}
                      </div>
                      {canConfigure && !payer.id.startsWith('default-contractor-payer-') && (
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setContractorAccountPayerForm({
                              id: payer.id,
                              name: payer.name,
                              taxId: payer.taxId,
                              address: payer.address || '',
                              city: payer.city || '',
                            })}
                          >
                            Editar
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => toggleContractorAccountPayer(payer)}
                            className={payer.active === false ? 'border-emerald-200 text-emerald-700' : 'border-rose-200 text-rose-700'}
                          >
                            {payer.active === false ? 'Activar' : 'Desactivar'}
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="text-base font-black text-slate-950">
                  {contractorAccountPayerForm.id ? 'Editar empresa pagadora' : 'Nueva empresa pagadora'}
                </h3>
                <div className="mt-4 space-y-3">
                  <Field label="Razón social">
                    <input className={inputClass} value={contractorAccountPayerForm.name} onChange={(event) => setContractorAccountPayerForm((current) => ({ ...current, name: event.target.value }))} placeholder="Ej: REALTIX S.A.S" />
                  </Field>
                  <Field label="NIT">
                    <input className={inputClass} value={contractorAccountPayerForm.taxId} onChange={(event) => setContractorAccountPayerForm((current) => ({ ...current, taxId: event.target.value }))} placeholder="Ej: 900.317.973-8" />
                  </Field>
                  <Field label="Dirección (opcional)">
                    <input className={inputClass} value={contractorAccountPayerForm.address} onChange={(event) => setContractorAccountPayerForm((current) => ({ ...current, address: event.target.value }))} />
                  </Field>
                  <Field label="Ciudad">
                    <input className={inputClass} value={contractorAccountPayerForm.city} onChange={(event) => setContractorAccountPayerForm((current) => ({ ...current, city: event.target.value }))} placeholder="Ej: Bogotá D.C." />
                  </Field>
                  <Button type="button" onClick={saveContractorAccountPayer} disabled={submitting || !canConfigure} className="w-full bg-cyan-600 font-bold text-white hover:bg-cyan-700">
                    {submitting && <Loader2 size={16} className="mr-2 animate-spin" />}
                    Guardar empresa pagadora
                  </Button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
      </>
      ) : (
        <ContractorAccountsWorkspace
          accounts={filteredContractorAccounts}
          allAccounts={scopedContractorAccounts}
          view={contractorAccountView}
          onViewChange={setContractorAccountView}
          search={contractorAccountSearch}
          onSearchChange={setContractorAccountSearch}
          stageFilter={contractorAccountStageFilter}
          onStageFilterChange={setContractorAccountStageFilter}
          sort={contractorAccountSort}
          onSortChange={setContractorAccountSort}
          showPaid={showPaidContractorAccounts}
          onTogglePaid={() => setShowPaidContractorAccounts((current) => !current)}
          hiddenPaidCount={scopedContractorAccounts.filter((account) => account.status === 'paid').length}
          canValidate={canValidate}
          canManage={canManage}
          canCreate={canCreateContractorAccount}
          canReassignContractor={canGlobalAdminReassignContractorAccounts}
          canGlobalAdminManage={canGlobalAdminManageContractorAccounts}
          canActOnAccount={canActOnContractorAccount}
          getApproverLabel={getContractorApproverLabel}
          canEditReturnedAccount={(account) => account.status === 'returned' && isOwnContractorAccount(account)}
          onNew={openNewContractorAccount}
          onEdit={openEditContractorAccount}
          onAction={openContractorAccountAction}
          onDownloadGenerated={downloadContractorAccountReport}
        />
      )}

      {isContractorAccountModalOpen && (
        <ModalShell
          title={editingContractorAccount
            ? canGlobalAdminManageContractorAccounts
              ? 'Editar o complementar cuenta de cobro'
              : 'Corregir cuenta de cobro'
            : 'Nueva cuenta de cobro'}
          subtitle={editingContractorAccount
            ? canGlobalAdminManageContractorAccounts
              ? 'Acceso exclusivo del Administrador Global. Los cambios conservan el estado, el responsable y las aprobaciones existentes.'
              : 'Actualiza la cuenta devuelta y reenvíala al jefe inmediato.'
            : 'Pixel genera la cuenta y el informe; el contratista firma y adjunta parafiscales.'}
          onClose={() => {
            setIsContractorAccountModalOpen(false);
            setEditingContractorAccount(null);
          }}
          wide
        >
          {editingContractorAccount && canGlobalAdminManageContractorAccounts && (
            <div className="mb-4 flex items-start gap-3 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-cyan-900">
              <ShieldCheck size={19} className="mt-0.5 shrink-0 text-cyan-700" />
              <div>
                <p className="text-sm font-black">Edición extraordinaria del Administrador Global</p>
                <p className="mt-0.5 text-xs font-semibold leading-5 text-cyan-800">
                  Puedes completar datos, actividades o soportes en cualquier etapa. Pixel registrará quién hizo el cambio y no reiniciará el flujo.
                </p>
              </div>
            </div>
          )}
          <div className="mb-4 grid gap-2 md:grid-cols-3">
            {[
              [1, 'Cuenta y firma', 'Monto, periodo y firma del contratista'],
              [2, 'Actividades del mes', 'Tareas precargadas por periodo'],
              [3, 'Parafiscales', 'Soporte contra base del 40%'],
            ].map(([step, title, detail]) => (
              <button
                key={String(step)}
                type="button"
                onClick={() => setContractorAccountStep(step as 1 | 2 | 3)}
                className={`rounded-xl border p-3 text-left transition ${
                  contractorAccountStep === step
                    ? 'border-cyan-300 bg-cyan-50 text-cyan-900 shadow-sm'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span className="text-[10px] font-black uppercase tracking-[0.22em]">Paso {step}</span>
                <span className="mt-1 block text-sm font-black">{title}</span>
                <span className="mt-1 block text-xs font-semibold">{detail}</span>
              </button>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-4">
              {contractorAccountStep === 1 && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-cyan-200 bg-gradient-to-r from-cyan-50 to-white p-4">
                    <p className="text-[11px] font-black uppercase tracking-[0.28em] text-cyan-700">Cuenta de cobro generada</p>
                    <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
                      No adjuntes la cuenta de cobro como archivo. Pixel la arma con tu nombre, correo, cargo, firma, periodo y valor de honorarios.
                    </p>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label="Número consecutivo">
                      <input
                        className={inputClass}
                        value={contractorAccountForm.customId}
                        onChange={(event) => setContractorAccountForm((current) => ({ ...current, customId: event.target.value }))}
                        placeholder="Ej: CC-2026-0001"
                      />
                    </Field>
                    <Field label="Contratista">
                      {canGlobalAdminReassignContractorAccounts ? (
                        <select
                          className={inputClass}
                          value={selectedContractorMemberId}
                          onChange={(event) => setSelectedContractorMemberId(event.target.value)}
                        >
                          <option value="">Selecciona contratista</option>
                          {contractorMemberOptions.map((member) => {
                            const optionId = getContractorMemberOptionId(member);
                            return (
                              <option key={optionId} value={optionId}>
                                {getMemberLabel(member)} · {getMemberRoleLabel(member)}
                              </option>
                            );
                          })}
                        </select>
                      ) : (
                        <input className={`${inputClass} bg-slate-50`} value={currentSignerMember ? getMemberLabel(currentSignerMember) : getCurrentUserName(currentUser)} disabled />
                      )}
                    </Field>
                    <Field label="Fecha de emisión">
                      <input type="date" className={inputClass} value={contractorAccountForm.issueDate} onChange={(event) => setContractorAccountForm((current) => ({ ...current, issueDate: event.target.value }))} />
                    </Field>
                    <Field label="Ciudad de emisión">
                      <input className={inputClass} value={contractorAccountForm.issueCity} onChange={(event) => setContractorAccountForm((current) => ({ ...current, issueCity: event.target.value }))} placeholder="Ej: Bogotá D.C." />
                    </Field>
                    <div className="md:col-span-2">
                      <Field label="Empresa que debe pagar">
                        <select className={inputClass} value={contractorAccountForm.payerDomainId} onChange={(event) => setContractorAccountForm((current) => ({ ...current, payerDomainId: event.target.value }))}>
                          <option value="">Selecciona empresa pagadora</option>
                          {contractorAccountPayerOptions.map((payer) => (
                            <option key={payer.id} value={payer.id}>{payer.name} · NIT {payer.taxId}</option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    <Field label="Tipo de identificación">
                      <select className={inputClass} value={contractorAccountForm.contractorIdentificationType} onChange={(event) => setContractorAccountForm((current) => ({ ...current, contractorIdentificationType: event.target.value }))}>
                        <option value="CC">Cédula de ciudadanía (CC)</option>
                        <option value="CE">Cédula de extranjería (CE)</option>
                        <option value="NIT">NIT</option>
                        <option value="PAS">Pasaporte</option>
                      </select>
                    </Field>
                    <Field label="Número de identificación">
                      <input className={inputClass} value={contractorAccountForm.contractorIdentificationNumber} onChange={(event) => setContractorAccountForm((current) => ({ ...current, contractorIdentificationNumber: event.target.value }))} placeholder="Cédula o NIT" />
                    </Field>
                    <Field label="Teléfono / celular">
                      <input className={inputClass} value={contractorAccountForm.contractorPhone} onChange={(event) => setContractorAccountForm((current) => ({ ...current, contractorPhone: event.target.value }))} placeholder="Número de contacto" />
                    </Field>
                    <Field label="Ciudad del profesional">
                      <input className={inputClass} value={contractorAccountForm.contractorCity} onChange={(event) => setContractorAccountForm((current) => ({ ...current, contractorCity: event.target.value }))} placeholder="Ej: Bogotá D.C." />
                    </Field>
                    <div className="md:col-span-2">
                      <Field label="Dirección del profesional">
                        <input className={inputClass} value={contractorAccountForm.contractorAddress} onChange={(event) => setContractorAccountForm((current) => ({ ...current, contractorAddress: event.target.value }))} placeholder="Dirección completa" />
                      </Field>
                    </div>
                    <Field label="Periodo inicio">
                      <input
                        type="date"
                        className={inputClass}
                        value={contractorAccountForm.periodStart}
                        onChange={(event) => setContractorAccountForm((current) => ({ ...current, periodStart: event.target.value }))}
                      />
                    </Field>
                    <Field label="Periodo fin">
                      <input
                        type="date"
                        className={inputClass}
                        value={contractorAccountForm.periodEnd}
                        onChange={(event) => setContractorAccountForm((current) => ({ ...current, periodEnd: event.target.value }))}
                      />
                    </Field>
                    <div className="md:col-span-2">
                      <Field label="Honorarios devengados">
                        <input
                          type="number"
                          min="0"
                          className={inputClass}
                          value={contractorAccountForm.honorariumAmount}
                          onChange={(event) => setContractorAccountForm((current) => ({ ...current, honorariumAmount: event.target.value }))}
                          placeholder="Ingresa solo el monto de honorarios"
                        />
                      </Field>
                    </div>
                    <div className="md:col-span-2">
                      <Field label="Concepto detallado del cobro">
                        <textarea className={textareaClass} value={contractorAccountForm.concept} onChange={(event) => setContractorAccountForm((current) => ({ ...current, concept: event.target.value }))} placeholder="Describe el servicio, cargo, proyecto y periodo que se cobra." />
                      </Field>
                    </div>
                  </div>

                  <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-indigo-700">Cuenta bancaria para el pago</p>
                        <p className="mt-1 text-xs font-semibold text-slate-600">Elige una cuenta guardada o registra otra. Quedará disponible en tu perfil para próximas cuentas.</p>
                      </div>
                      <span className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-indigo-700 ring-1 ring-indigo-100">{selectedContractorBankAccounts.length} guardada{selectedContractorBankAccounts.length === 1 ? '' : 's'}</span>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <div className="md:col-span-3">
                        <Field label="Cuenta guardada">
                          <select
                            className={inputClass}
                            value={contractorAccountForm.bankAccountId}
                            onChange={(event) => {
                              const bankAccount = selectedContractorBankAccounts.find((account) => account.id === event.target.value);
                              setContractorAccountForm((current) => ({
                                ...current,
                                bankAccountId: event.target.value,
                                bankName: bankAccount?.bankName || '',
                                bankAccountType: bankAccount?.accountType || 'Ahorros',
                                bankAccountNumber: bankAccount?.accountNumber || '',
                              }));
                            }}
                          >
                            <option value="">Registrar una cuenta nueva</option>
                            {selectedContractorBankAccounts.map((account) => (
                              <option key={account.id} value={account.id}>{account.bankName} · {account.accountType} · ****{account.accountNumber.slice(-4)}</option>
                            ))}
                          </select>
                        </Field>
                      </div>
                      <Field label="Banco">
                        <input className={inputClass} value={contractorAccountForm.bankName} onChange={(event) => setContractorAccountForm((current) => ({ ...current, bankName: event.target.value }))} placeholder="Ej: Bancolombia" />
                      </Field>
                      <Field label="Tipo de cuenta">
                        <select className={inputClass} value={contractorAccountForm.bankAccountType} onChange={(event) => setContractorAccountForm((current) => ({ ...current, bankAccountType: event.target.value }))}>
                          <option value="Ahorros">Ahorros</option>
                          <option value="Corriente">Corriente</option>
                          <option value="Nequi">Nequi</option>
                          <option value="Daviplata">Daviplata</option>
                          <option value="Otro">Otro</option>
                        </select>
                      </Field>
                      <Field label="Número de cuenta">
                        <input className={inputClass} value={contractorAccountForm.bankAccountNumber} onChange={(event) => setContractorAccountForm((current) => ({ ...current, bankAccountNumber: event.target.value }))} placeholder="Número sin espacios" />
                      </Field>
                    </div>
                    <label className="mt-3 flex items-center gap-2 text-xs font-bold text-slate-700">
                      <input type="checkbox" checked={contractorAccountForm.saveBankAccountToProfile} onChange={(event) => setContractorAccountForm((current) => ({ ...current, saveBankAccountToProfile: event.target.checked }))} />
                      Guardar o actualizar esta cuenta bancaria en el perfil del profesional.
                    </label>
                  </div>

                  <SignatureSummary title="Firma del contratista para radicar" signature={buildMemberSignatureSnapshot(selectedContractorMember) || undefined} />
                </div>
              )}

              {contractorAccountStep === 2 && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="font-black text-slate-950">Actividades precargadas del periodo</h3>
                        <p className="text-xs font-semibold text-slate-500">
                          Pixel filtra únicamente tareas, subtareas y pasos finalizados por el contratista entre {formatDate(contractorAccountForm.periodStart)} y {formatDate(contractorAccountForm.periodEnd)}. Solo bloquea el paso ya cobrado, no la tarea raíz completa.
                        </p>
                      </div>
                      <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-black text-indigo-700 ring-1 ring-indigo-100">
                        {selectedContractorActivities.length} seleccionada{selectedContractorActivities.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="grid gap-2 border-b border-slate-200 pb-3 lg:grid-cols-[minmax(0,1fr)_180px_210px]">
                      <div className="flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3">
                        <Search size={16} className="shrink-0 text-slate-400" />
                        <input
                          type="search"
                          value={advanceTaskSearch}
                          onChange={(event) => setAdvanceTaskSearch(event.target.value)}
                          placeholder="Buscar actividad, subtarea o paso..."
                          className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none"
                        />
                      </div>
                      <select value={advanceTaskStatusFilter} onChange={(event) => setAdvanceTaskStatusFilter(event.target.value as AdvanceTaskStatusFilter)} className={inputClass}>
                        <option value="all">Finalizadas cobrables</option>
                        <option value="completed">Solo finalizadas</option>
                      </select>
                      <select value={advanceTaskGroupFilter} onChange={(event) => setAdvanceTaskGroupFilter(event.target.value)} className={inputClass}>
                        <option value="all">Todos los grupos</option>
                        {advanceTaskGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                      </select>
                    </div>
                    <div className="mt-3 max-h-72 overflow-y-auto rounded-lg bg-white p-2 ring-1 ring-slate-200">
                      {contractorPeriodActivities.length === 0 ? (
                        <p className="p-4 text-center text-sm font-bold text-slate-400">No hay tareas, subtareas o pasos finalizados disponibles de este contratista en el periodo, o ya fueron usados en otra cuenta de cobro.</p>
                      ) : (
                        <div className="space-y-1">
                          {filteredContractorPeriodActivities.map((activity) => {
                              const selected = contractorAccountForm.activityKeys.includes(activity.key);
                              const status = getTaskStatusMeta({ status: activity.status });
                              return (
                                <label key={activity.key} className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 ${selected ? 'border-cyan-200 bg-cyan-50' : 'border-transparent hover:bg-slate-50'}`}>
                                  <input type="checkbox" checked={selected} onChange={() => toggleContractorAccountTask(activity.key)} className="mt-1 h-4 w-4 rounded border-slate-300 text-cyan-600" />
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-black text-slate-800">{activity.taskTitle}</span>
                                    <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-400">
                                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: advanceTaskGroupById.get(activity.groupId || '')?.color || '#94a3b8' }} />
                                      {activity.groupName || 'Sin grupo'}
	                                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 ring-1 ring-slate-200">
	                                        {activity.type === 'workflow_step' ? 'Paso workflow' : activity.type === 'subtask' ? 'Subtarea' : 'Tarea'}
	                                      </span>
	                                      {activity.projectName && (
	                                        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-700 ring-1 ring-indigo-100">
	                                          {activity.projectName}
	                                        </span>
	                                      )}
	                                      {activity.rootTaskTitle && activity.rootTaskTitle !== activity.taskTitle && <span className="truncate">Raíz: {activity.rootTaskTitle}</span>}
                                      <span className={`rounded-full px-2 py-0.5 ring-1 ${status.className}`}>{status.label}</span>
                                      <span>{formatDate(activity.date)}</span>
                                    </span>
                                  </span>
                                </label>
                              );
                            })}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <ReceiptGroupMetric label="Actividades" value={`${contractorActivitySnapshot.totalTasks}`} tone="slate" />
                    <ReceiptGroupMetric label="Finalizadas" value={`${contractorActivitySnapshot.completedTasks}`} tone="emerald" />
                    <ReceiptGroupMetric label="Alertas" value={`${contractorActivitySnapshot.overdueTasks}`} tone="amber" />
                    <ReceiptGroupMetric label="Mov. rate cards" value={`${contractorActivitySnapshot.rateMovements}`} tone="indigo" />
                  </div>

                  <div className="grid gap-3 xl:grid-cols-2">
                    <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-emerald-700">Informe de calidad del mes</p>
                          <p className="mt-1 text-xs font-semibold text-slate-600">Eventos de gestión de calidad asociados al contratista en el periodo.</p>
                        </div>
                        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-emerald-700 ring-1 ring-emerald-100">
                          {contractorQualitySnapshot.score === null ? 'Sin dato' : `${contractorQualitySnapshot.score}%`}
                        </span>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-4">
                        <ReceiptGroupMetric label="Revisadas" value={`${contractorQualitySnapshot.reviewed}`} tone="slate" />
                        <ReceiptGroupMetric label="Sin obs." value={`${contractorQualitySnapshot.cleanAccepted ?? Math.max(0, contractorQualitySnapshot.accepted - (contractorQualitySnapshot.acceptedWithObservations || 0))}`} tone="emerald" />
                        <ReceiptGroupMetric label="Con obs." value={`${contractorQualitySnapshot.acceptedWithObservations || 0}`} tone={(contractorQualitySnapshot.acceptedWithObservations || 0) > 0 ? 'amber' : 'slate'} />
                        <ReceiptGroupMetric label="Rechazadas" value={`${contractorQualitySnapshot.rejected}`} tone={contractorQualitySnapshot.rejected > 0 ? 'rose' : 'slate'} />
                      </div>
                      <div className="mt-3 space-y-2">
                        {contractorQualitySnapshot.events.length === 0 ? (
                          <p className="rounded-lg bg-white/80 p-3 text-xs font-semibold text-slate-500 ring-1 ring-emerald-100">Sin revisiones de calidad para este contratista en el periodo.</p>
                        ) : (
                          contractorQualitySnapshot.events.slice(0, 4).map((event) => (
                            <div key={event.id} className="rounded-lg bg-white/90 p-3 text-xs ring-1 ring-emerald-100">
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate font-black text-slate-800">{event.taskTitle}</p>
                                <span className={`shrink-0 rounded-full px-2 py-0.5 font-black ${event.approvedWithObservations ? 'bg-amber-50 text-amber-700' : event.result === 'accepted' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                                  {event.approvedWithObservations ? 'Con observaciones' : event.result === 'accepted' ? 'Aceptada' : event.result === 'rejected' ? 'Rechazada' : 'Revisada'}
                                </span>
                              </div>
                              <p className="mt-1 font-semibold text-slate-500">{event.stepLabel || 'Sin paso'} · {formatDate(event.date)}</p>
                              {event.causeLabel && <p className="mt-1 font-semibold text-amber-700">Errores: {event.causeLabel}</p>}
                              {event.comment && <p className="mt-1 line-clamp-2 font-semibold text-slate-500">{event.comment}</p>}
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-indigo-700">Informe de rates del periodo</p>
                          <p className="mt-1 text-xs font-semibold text-slate-600">Producción, ingresos, costos y margen registrados a nombre del contratista.</p>
                        </div>
                        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-indigo-700 ring-1 ring-indigo-100">
                          {contractorPeriodRateSummary.movements} mov.
                        </span>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        <ReceiptGroupMetric label="Ingreso" value={formatMoney(contractorPeriodRateSummary.income)} tone="emerald" />
                        <ReceiptGroupMetric label="Costo" value={formatMoney(contractorPeriodRateSummary.cost)} tone="rose" />
                        <ReceiptGroupMetric label="Margen" value={formatMoney(contractorPeriodRateSummary.margin)} tone="indigo" />
                      </div>
                      <div className="mt-3 space-y-2">
                        {contractorPeriodRateSummary.rows.length === 0 ? (
                          <p className="rounded-lg bg-white/80 p-3 text-xs font-semibold text-slate-500 ring-1 ring-indigo-100">Sin movimientos de rate cards para este contratista en el periodo.</p>
                        ) : (
                          contractorPeriodRateSummary.rows.slice(0, 5).map((row) => (
                            <div key={row.rateCardId} className="rounded-lg bg-white/90 p-3 text-xs ring-1 ring-indigo-100">
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate font-black text-slate-800">{row.name}</p>
                                <span className="shrink-0 font-black text-indigo-700">{formatMoney(row.income)}</span>
                              </div>
                              <p className="mt-1 font-semibold text-slate-500">
                                {row.units} {row.unitLabel || 'unidad'} · {row.movements} movimientos · margen {formatMoney(row.margin)}
                              </p>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 xl:grid-cols-2">
                    <div className={`rounded-xl border p-4 ${
                      contractorPerformanceSnapshot.alerts.length > 0
                        ? 'border-amber-200 bg-amber-50/70'
                        : 'border-teal-100 bg-teal-50/60'
                    }`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className={`text-[10px] font-black uppercase tracking-[0.24em] ${
                            contractorPerformanceSnapshot.alerts.length > 0 ? 'text-amber-700' : 'text-teal-700'
                          }`}>Cumplimiento del cronograma</p>
                          <p className="mt-1 text-xs font-semibold text-slate-600">Pixel contrasta fecha programada, fecha real y pendientes vencidos.</p>
                        </div>
                        <span className={`rounded-full bg-white px-2.5 py-1 text-xs font-black ring-1 ${
                          contractorPerformanceSnapshot.alerts.length > 0
                            ? 'text-amber-700 ring-amber-200'
                            : 'text-teal-700 ring-teal-100'
                        }`}>
                          {contractorPerformanceSnapshot.alerts.length} alerta{contractorPerformanceSnapshot.alerts.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <ReceiptGroupMetric label="A tiempo" value={`${contractorPerformanceSnapshot.completedOnTime}`} tone="emerald" />
                        <ReceiptGroupMetric label="Fuera de tiempo" value={`${contractorPerformanceSnapshot.completedLate}`} tone={contractorPerformanceSnapshot.completedLate ? 'amber' : 'slate'} />
                        <ReceiptGroupMetric label="Sin cronograma" value={`${contractorPerformanceSnapshot.completedWithoutSchedule}`} tone="slate" />
                        <ReceiptGroupMetric label="Vencidas abiertas" value={`${contractorPerformanceSnapshot.openOverdue}`} tone={contractorPerformanceSnapshot.openOverdue ? 'rose' : 'slate'} />
                      </div>
                    </div>

                    <div className="rounded-xl border border-violet-100 bg-violet-50/60 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-violet-700">Comparativo de productividad</p>
                          <p className="mt-1 text-xs font-semibold text-slate-600">Comparación contra profesionales con el mismo cargo dentro del proyecto.</p>
                        </div>
                        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-violet-700 ring-1 ring-violet-100">
                          {contractorProductivityComparison.peerCount} comparable{contractorProductivityComparison.peerCount === 1 ? '' : 's'}
                        </span>
                      </div>
                      <p className="mt-3 text-xs font-black text-slate-800">{contractorProductivityComparison.roleLabel}</p>
                      <div className="mt-2 space-y-2">
                        {contractorProductivityComparison.rows.length === 0 ? (
                          <p className="rounded-lg bg-white/80 p-3 text-xs font-semibold text-slate-500 ring-1 ring-violet-100">Sin rates del contratista para construir el comparativo.</p>
                        ) : (
                          contractorProductivityComparison.rows.slice(0, 4).map((row) => (
                            <div key={row.rateCardId} className="rounded-lg bg-white/90 p-3 text-xs ring-1 ring-violet-100">
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate font-black text-slate-800">{row.name}</p>
                                <span className="shrink-0 font-black text-violet-700">#{row.contractorRank} de {row.professionalCount}</span>
                              </div>
                              <p className="mt-1 font-semibold text-slate-500">
                                Profesional {row.contractorUnits} · promedio comparable {row.peerAverageUnits} {row.unitLabel}
                              </p>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  <Field label="Resumen automático del informe de actividades">
                    <textarea
                      className={textareaClass}
                      value={contractorAccountForm.activitySummary}
                      onChange={(event) => setContractorAccountForm((current) => ({ ...current, activitySummary: event.target.value }))}
                      placeholder={contractorActivitySnapshot.qualitySummary}
                    />
                  </Field>
                </div>
              )}

              {contractorAccountStep === 3 && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
                    <p className="text-[11px] font-black uppercase tracking-[0.24em] text-amber-700">Validación de parafiscales</p>
                    <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">
                      Pixel calcula la base sobre el 40% de los honorarios. La revisión documental confirma que el soporte corresponda al periodo cobrado y a la base calculada.
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <SummaryLine label="Base 40%" value={formatMoney(asNumber(contractorAccountForm.honorariumAmount) * 0.4)} />
                      <SummaryLine label="Salario mínimo" value={formatMoney(COLOMBIA_LEGAL_MINIMUM_WAGE)} />
                      <SummaryLine label="Mínimos estimados" value={`${Math.max(1, Math.ceil((asNumber(contractorAccountForm.honorariumAmount) * 0.4) / COLOMBIA_LEGAL_MINIMUM_WAGE))}`} />
                    </div>
                  </div>

                  {CONTRACTOR_ACCOUNT_UPLOAD_DOCUMENTS.map((document) => (
                    <div key={document.kind}>
                      <p className="mb-2 text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">{document.label}</p>
                      <input
                        id={`contractor-document-${document.kind}`}
                        type="file"
                        className="sr-only"
                        accept=".pdf,.png,.jpg,.jpeg"
                        onChange={(event) => {
                          selectContractorParafiscalsFile(event.target.files?.[0] || null);
                          event.target.value = '';
                        }}
                      />
                      {contractorDocumentFiles[document.kind] ? (
                        <div className="flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 sm:flex-row sm:items-center">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-600 shadow-sm ring-1 ring-emerald-100">
                            <FileText size={24} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-black text-slate-900">{contractorDocumentFiles[document.kind]?.name}</p>
                            <p className="mt-1 text-xs font-semibold text-emerald-700">
                              Archivo listo · {formatSupportFileSize(contractorDocumentFiles[document.kind]?.size || 0)}
                            </p>
                          </div>
                          <div className="flex shrink-0 gap-2">
                            <label
                              htmlFor={`contractor-document-${document.kind}`}
                              className="inline-flex h-9 cursor-pointer items-center justify-center rounded-lg bg-white px-3 text-xs font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                            >
                              Reemplazar
                            </label>
                            <button
                              type="button"
                              onClick={() => setContractorDocumentFiles((current) => ({ ...current, [document.kind]: null }))}
                              className="inline-flex h-9 items-center justify-center rounded-lg bg-white px-3 text-xs font-black text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50"
                            >
                              <Trash2 size={14} className="mr-1.5" />
                              Quitar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <label
                          htmlFor={`contractor-document-${document.kind}`}
                          onDragEnter={(event) => {
                            event.preventDefault();
                            setIsContractorParafiscalsDragging(true);
                          }}
                          onDragOver={(event) => {
                            event.preventDefault();
                            setIsContractorParafiscalsDragging(true);
                          }}
                          onDragLeave={(event) => {
                            event.preventDefault();
                            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                              setIsContractorParafiscalsDragging(false);
                            }
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            setIsContractorParafiscalsDragging(false);
                            selectContractorParafiscalsFile(event.dataTransfer.files?.[0] || null);
                          }}
                          className={`group flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-8 text-center transition ${
                            isContractorParafiscalsDragging
                              ? 'border-cyan-500 bg-cyan-50 shadow-lg shadow-cyan-500/10'
                              : 'border-slate-300 bg-slate-50/70 hover:border-cyan-400 hover:bg-cyan-50/60'
                          }`}
                        >
                          <span className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 transition ${
                            isContractorParafiscalsDragging
                              ? 'scale-105 text-cyan-600 ring-cyan-200'
                              : 'text-slate-500 ring-slate-200 group-hover:text-cyan-600 group-hover:ring-cyan-200'
                          }`}>
                            <UploadCloud size={28} />
                          </span>
                          <span className="mt-4 text-base font-black text-slate-900">
                            {isContractorParafiscalsDragging ? 'Suelta el soporte aquí' : 'Arrastra aquí el soporte de parafiscales'}
                          </span>
                          <span className="mt-1 text-sm font-semibold text-slate-500">
                            o haz clic para seleccionarlo desde tu computador
                          </span>
                          <span className="mt-3 rounded-full bg-white px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-slate-500 ring-1 ring-slate-200">
                            PDF, PNG o JPG · máximo 15 MB
                          </span>
                        </label>
                      )}
                      <p className="mt-2 flex items-center gap-2 text-xs font-semibold text-slate-500">
                        <ShieldCheck size={14} className="text-emerald-600" />
                        Documento obligatorio; quedará protegido dentro del expediente de la cuenta.
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-cyan-100 bg-cyan-50/70 p-4">
              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-cyan-700">Resumen de cuenta</p>
              <div className="mt-4 space-y-3">
                <SummaryLine label="Consecutivo" value={contractorAccountForm.customId || 'Pendiente'} strong />
                <SummaryLine label="Emisión" value={`${formatDate(contractorAccountForm.issueDate)} · ${contractorAccountForm.issueCity || 'Sin ciudad'}`} />
                <SummaryLine label="Empresa pagadora" value={contractorAccountPayerOptions.find((payer) => payer.id === contractorAccountForm.payerDomainId)?.name || 'Sin seleccionar'} />
                <SummaryLine label="Honorarios" value={formatMoney(contractorAccountForm.honorariumAmount)} strong />
                <SummaryLine label="Cuenta de pago" value={contractorAccountForm.bankName && contractorAccountForm.bankAccountNumber ? `${contractorAccountForm.bankName} · ${contractorAccountForm.bankAccountType} · ****${contractorAccountForm.bankAccountNumber.slice(-4)}` : 'Sin registrar'} />
                <SummaryLine label="Base parafiscales 40%" value={formatMoney(asNumber(contractorAccountForm.honorariumAmount) * 0.4)} />
                <SummaryLine label="Salario mínimo" value={formatMoney(COLOMBIA_LEGAL_MINIMUM_WAGE)} />
                <SummaryLine label="Mínimos estimados" value={`${Math.max(1, Math.ceil((asNumber(contractorAccountForm.honorariumAmount) * 0.4) / COLOMBIA_LEGAL_MINIMUM_WAGE))}`} />
                <SummaryLine label="Periodo" value={`${formatDate(contractorAccountForm.periodStart)} - ${formatDate(contractorAccountForm.periodEnd)}`} />
                <SummaryLine label="Actividades disponibles" value={`${contractorPeriodActivities.length}`} />
                <SummaryLine label="Actividades seleccionadas" value={`${contractorAccountForm.activityKeys.length}`} />
                <SummaryLine label="Calidad del mes" value={contractorQualitySnapshot.score === null ? 'Sin dato' : `${contractorQualitySnapshot.score}%`} />
                <SummaryLine label="Revisiones calidad" value={`${contractorQualitySnapshot.reviewed}`} />
                <SummaryLine label="Alertas de cronograma" value={`${contractorPerformanceSnapshot.alerts.length}`} />
                <SummaryLine label="Ingreso rate cards" value={formatMoney(contractorActivitySnapshot.rateIncome)} />
                <SummaryLine label="Costo rate cards" value={formatMoney(contractorActivitySnapshot.rateCost)} />
                <SummaryLine label="Rates distintos" value={`${contractorPeriodRateSummary.rows.length}`} />
                <SummaryLine label="Profesionales comparables" value={`${contractorProductivityComparison.peerCount}`} />
                <SummaryLine label="Documentos cargados" value={`${Object.values(contractorDocumentFiles).filter(Boolean).length} de 1`} />
              </div>
              <div className="mt-4 rounded-lg bg-white p-3 text-xs font-semibold leading-5 text-slate-600 ring-1 ring-cyan-100">
                <p className="font-black text-slate-800">Documentos del expediente</p>
                <ul className="mt-2 space-y-1">
                  <li>• Cuenta de cobro: generada y firmada en Pixel.</li>
                  <li>• Informe de actividades: generado con tareas del periodo.</li>
                  <li>• Parafiscales: soporte externo obligatorio.</li>
                </ul>
              </div>
            </div>
          </div>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => {
              setIsContractorAccountModalOpen(false);
              setEditingContractorAccount(null);
            }}>Cancelar</Button>
            {contractorAccountStep > 1 && (
              <Button type="button" variant="outline" onClick={() => setContractorAccountStep((current) => Math.max(1, current - 1) as 1 | 2 | 3)}>Atrás</Button>
            )}
            {contractorAccountStep < 3 ? (
              <Button type="button" onClick={() => setContractorAccountStep((current) => Math.min(3, current + 1) as 1 | 2 | 3)} className="bg-cyan-600 font-bold text-white hover:bg-cyan-700">
                Siguiente
                <ArrowRight size={16} className="ml-2" />
              </Button>
            ) : (
              <Button type="button" disabled={submitting} onClick={handleCreateContractorAccount} className="bg-cyan-600 font-bold text-white hover:bg-cyan-700">
                {submitting && <Loader2 size={16} className="mr-2 animate-spin" />}
                {editingContractorAccount
                  ? canGlobalAdminManageContractorAccounts
                    ? 'Guardar cambios administrativos'
                    : 'Reenviar cuenta corregida'
                  : 'Enviar cuenta de cobro'}
              </Button>
            )}
          </ModalFooter>
        </ModalShell>
      )}

      {contractorAccountAction && (
        <ModalShell
          title={
            contractorAccountAction.type === 'pay'
              ? 'Registrar pago de cuenta de cobro'
              : contractorAccountAction.type === 'account'
                ? 'Contabilizar cuenta de cobro'
                : contractorAccountAction.type === 'delete'
                  ? 'Eliminar cuenta de cobro'
                  : contractorAccountAction.type === 'reassign'
                    ? 'Cambiar persona asociada'
                    : contractorAccountAction.type === 'return'
                      ? 'Devolver cuenta de cobro'
                      : contractorAccountAction.type === 'reject'
                        ? 'Rechazar cuenta de cobro'
                        : contractorAccountAction.account.status === 'returned' && canGlobalAdminManageContractorAccounts
                          ? 'Reactivar cuenta de cobro'
                          : 'Aprobar cuenta de cobro'
          }
          subtitle={`${contractorAccountAction.account.contractorName} · ${formatMoney(contractorAccountAction.account.honorariumAmount)}`}
          onClose={() => setContractorAccountAction(null)}
        >
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <SummaryLine label="Estado actual" value={CONTRACTOR_ACCOUNT_STATUS_META[contractorAccountAction.account.status]?.label || contractorAccountAction.account.status} />
              <SummaryLine label="Periodo" value={`${formatDate(contractorAccountAction.account.periodStart)} - ${formatDate(contractorAccountAction.account.periodEnd)}`} />
              <SummaryLine label="Tareas" value={(contractorAccountAction.account.taskTitles || []).join(', ') || 'Sin tareas'} />
            </div>
            {contractorAccountAction.type === 'approve' && canGlobalAdminManageContractorAccounts && (
              <div className="flex items-start gap-3 rounded-xl border border-cyan-200 bg-cyan-50 p-3 text-cyan-900">
                <ShieldCheck size={18} className="mt-0.5 shrink-0 text-cyan-700" />
                <div>
                  <p className="text-sm font-black">
                    {contractorAccountAction.account.status === 'returned'
                      ? 'Reactivación controlada del Administrador Global'
                      : 'Aprobación extraordinaria del Administrador Global'}
                  </p>
                  <p className="mt-0.5 text-xs font-semibold leading-5 text-cyan-800">
                    {contractorAccountAction.account.status === 'returned'
                      ? 'Pixel devolverá la cuenta al mismo paso pendiente y a su responsable vigente. La contabilización y el pago conservarán sus acciones y soportes obligatorios.'
                      : 'Puedes aprobar aunque la cuenta esté asignada a otro responsable. Pixel conservará al aprobador esperado y registrará esta intervención en la trazabilidad.'}
                  </p>
                </div>
              </div>
            )}
            {contractorAccountAction.type === 'account' && (
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Referencia contable">
                  <input className={inputClass} value={contractorAccountForm.accountingReference} onChange={(event) => setContractorAccountForm((current) => ({ ...current, accountingReference: event.target.value }))} placeholder="Ej: comprobante, causación o consecutivo" />
                </Field>
                <Field label="Nota contable">
                  <input className={inputClass} value={contractorAccountForm.accountingNote} onChange={(event) => setContractorAccountForm((current) => ({ ...current, accountingNote: event.target.value }))} placeholder="Opcional" />
                </Field>
              </div>
            )}
            {contractorAccountAction.type === 'pay' && (
              <Field label="Soporte de pago">
                <input type="file" className={inputClass} accept=".pdf,.png,.jpg,.jpeg" onChange={(event) => setContractorPaymentFile(event.target.files?.[0] || null)} />
              </Field>
            )}
            {contractorAccountAction.type === 'reassign' && (
              <div className="space-y-3">
                <Field label="Nueva persona asociada">
                  <select
                    className={inputClass}
                    value={contractorAccountReassignMemberId}
                    onChange={(event) => setContractorAccountReassignMemberId(event.target.value)}
                  >
                    <option value="">Selecciona persona</option>
                    {contractorMemberOptions.map((member) => {
                      const optionId = getContractorMemberOptionId(member);
                      return (
                        <option key={optionId} value={optionId}>
                          {getMemberLabel(member)} · {getMemberRoleLabel(member)}
                        </option>
                      );
                    })}
                  </select>
                </Field>
                <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-3 text-sm font-semibold leading-6 text-cyan-900">
                  Pixel actualizará el contratista, correo y firma visible en la cuenta. Las actividades ya cobradas se conservan para no alterar el soporte histórico.
                </div>
              </div>
            )}
            {contractorAccountAction.type === 'delete' && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold leading-6 text-rose-800">
                Se eliminará la cuenta de cobro y se intentarán borrar sus soportes del repositorio documental. Esta acción no se puede deshacer.
              </div>
            )}
            {contractorAccountAction.type !== 'delete' && (
              <Field label={contractorAccountAction.type === 'return' || contractorAccountAction.type === 'reject' ? 'Observación obligatoria' : 'Comentario'}>
                <textarea className={textareaClass} value={contractorAccountActionComment} onChange={(event) => setContractorAccountActionComment(event.target.value)} placeholder="Deja una nota para la trazabilidad del flujo." />
              </Field>
            )}
            {(['approve', 'account', 'pay'] as const).includes(contractorAccountAction.type as 'approve' | 'account' | 'pay') &&
              !(contractorAccountAction.type === 'approve' && contractorAccountAction.account.status === 'returned' && canGlobalAdminManageContractorAccounts) && (
              <SignatureSummary title="Tu firma de aprobación" signature={buildCurrentSignatureSnapshot() || undefined} />
            )}
          </div>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setContractorAccountAction(null)}>Cancelar</Button>
            <Button
              type="button"
              onClick={applyContractorAccountAction}
              disabled={submitting}
              className={`font-bold text-white ${
                contractorAccountAction.type === 'delete'
                  ? 'bg-rose-600 hover:bg-rose-700'
                  : contractorAccountAction.type === 'reassign'
                    ? 'bg-cyan-600 hover:bg-cyan-700'
                  : 'bg-indigo-600 hover:bg-indigo-700'
              }`}
            >
              {submitting && <Loader2 size={16} className="mr-2 animate-spin" />}
              {contractorAccountAction.type === 'delete'
                ? 'Sí, eliminar cuenta'
                : contractorAccountAction.type === 'reassign'
                  ? 'Guardar cambio'
                  : 'Confirmar'}
            </Button>
          </ModalFooter>
        </ModalShell>
      )}

      {isAdvanceModalOpen && (
        <ModalShell title="Nuevo anticipo de viaje" subtitle="Solicitud administrativa para operación en campo." onClose={() => setIsAdvanceModalOpen(false)} wide>
          <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="ID del anticipo (opcional)">
                  <input
                    className={inputClass}
                    value={advanceForm.customId}
                    maxLength={80}
                    onChange={(event) => setAdvanceForm((current) => ({ ...current, customId: event.target.value }))}
                    placeholder="Ej: ANT-VIAJE-001"
                  />
                </Field>
                <Field label="Solicitante">
                  <select className={`${inputClass} bg-slate-50`} value={advanceForm.requesterId} disabled>
                    {currentSignerMember ? <option value={currentSignerMember.id}>{getMemberLabel(currentSignerMember)}</option> : currentUser ? <option value={currentUser.uid}>{getCurrentUserName(currentUser)}</option> : <option value="">Sin usuario</option>}
                  </select>
                </Field>
                <div className="md:col-span-2">
                  <Field label="Centro de costos">
                    <select
                      className={inputClass}
                      value={advanceForm.costCenterId}
                      onChange={(event) => setAdvanceForm((current) => ({ ...current, costCenterId: event.target.value }))}
                    >
                      <option value="">Selecciona centro de costos</option>
                      {costCenterOptions.map((center) => (
                        <option key={center.id} value={center.id}>
                          {center.code ? `${center.code} · ` : ''}{center.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div className="md:col-span-2">
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Tareas relacionadas</span>
                    <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-black text-indigo-700 ring-1 ring-indigo-100">
                      {selectedAdvanceTasks.length} seleccionada{selectedAdvanceTasks.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50/70 shadow-sm">
                    <div className="grid gap-2 border-b border-slate-200 bg-white p-3 lg:grid-cols-[minmax(0,1fr)_180px_210px]">
                      <div className="flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 transition focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-500/10">
                        <Search size={16} className="shrink-0 text-slate-400" />
                        <input
                          type="search"
                          value={advanceTaskSearch}
                          onChange={(event) => setAdvanceTaskSearch(event.target.value)}
                          placeholder="Buscar por tarea, código o descripción..."
                          className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400"
                        />
                        {advanceTaskSearch && (
                          <button
                            type="button"
                            onClick={() => setAdvanceTaskSearch('')}
                            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                            aria-label="Limpiar búsqueda de tareas"
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                      <select
                        value={advanceTaskStatusFilter}
                        onChange={(event) => setAdvanceTaskStatusFilter(event.target.value as AdvanceTaskStatusFilter)}
                        className={inputClass}
                        aria-label="Filtrar tareas por estado"
                      >
                        <option value="active">Tareas activas</option>
                        <option value="pending">Pendientes</option>
                        <option value="in_progress">En curso</option>
                        <option value="blocked">Pausadas o bloqueadas</option>
                        <option value="completed">Finalizadas</option>
                        <option value="all">Todos los estados</option>
                      </select>
                      <select
                        value={advanceTaskGroupFilter}
                        onChange={(event) => setAdvanceTaskGroupFilter(event.target.value)}
                        className={inputClass}
                        aria-label="Filtrar tareas por grupo"
                      >
                        <option value="all">Todos los grupos</option>
                        {advanceTaskGroups.map((group) => (
                          <option key={group.id} value={group.id}>{group.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
                      <p className="text-[11px] font-bold text-slate-500">
                        {filteredAdvanceTasks.length} resultado{filteredAdvanceTasks.length === 1 ? '' : 's'}
                      </p>
                      <div className="flex items-center gap-2">
                        {filteredAdvanceTasks.length > 0 && (
                          <button
                            type="button"
                            onClick={selectVisibleAdvanceTasks}
                            className="text-[11px] font-black text-indigo-600 hover:text-indigo-800"
                          >
                            Seleccionar resultados
                          </button>
                        )}
                        {selectedAdvanceTasks.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setAdvanceForm((current) => ({ ...current, taskIds: [] }))}
                            className="text-[11px] font-black text-rose-600 hover:text-rose-800"
                          >
                            Quitar todas
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="max-h-64 overflow-y-auto bg-white p-2">
                      {filteredAdvanceTasks.length === 0 ? (
                        <div className="px-4 py-8 text-center">
                          <Search className="mx-auto h-7 w-7 text-slate-300" />
                          <p className="mt-2 text-sm font-black text-slate-600">No encontramos tareas</p>
                          <p className="mt-1 text-xs font-medium text-slate-400">Prueba otro término, estado o grupo.</p>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {filteredAdvanceTasks.map((task) => {
                            const selected = advanceForm.taskIds.includes(task.id);
                            const group = advanceTaskGroupById.get(getAdvanceTaskGroupId(task));
                            const status = getTaskStatusMeta(task);
                            const parentTask = task.parentTaskId ? taskById.get(task.parentTaskId) : null;

                            return (
                              <label
                                key={task.id}
                                className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition ${
                                  selected
                                    ? 'border-indigo-200 bg-indigo-50/70 ring-1 ring-indigo-100'
                                    : 'border-transparent bg-white hover:border-slate-200 hover:bg-slate-50'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  onChange={() => toggleAdvanceTask(task.id)}
                                  className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-black text-slate-800">{getTaskTitle(task)}</span>
                                  <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold text-slate-400">
                                    <span className="inline-flex min-w-0 items-center gap-1.5">
                                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: group?.color || '#94a3b8' }} />
                                      <span className="truncate">{group?.name || 'Sin grupo'}</span>
                                    </span>
                                    {parentTask && <span className="truncate">Subtarea de {getTaskTitle(parentTask)}</span>}
                                    {task.externalWorkflowId && <span className="truncate">{task.externalWorkflowId}</span>}
                                  </span>
                                </span>
                                <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black ring-1 ${status.className}`}>
                                  {status.label}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="border-t border-slate-200 bg-slate-50 p-3">
                      {selectedAdvanceTasks.length === 0 ? (
                        <p className="text-xs font-bold text-slate-400">No hay tareas asociadas. Este campo es opcional.</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {selectedAdvanceTasks.map((task) => (
                            <span key={task.id} className="inline-flex max-w-full items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-black text-indigo-700 ring-1 ring-indigo-100">
                              <span className="max-w-64 truncate">{getTaskTitle(task)}</span>
                              <button
                                type="button"
                                onClick={() => toggleAdvanceTask(task.id)}
                                className="rounded-md p-0.5 text-indigo-400 hover:bg-indigo-100 hover:text-indigo-700"
                                aria-label={`Quitar ${getTaskTitle(task)}`}
                              >
                                <X size={13} />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <Field label="Departamento">
                  <select
                    className={inputClass}
                    value={advanceForm.department}
                    disabled={locationsLoading || locationOptions.length === 0}
                    onChange={(event) =>
                      setAdvanceForm((current) => ({
                        ...current,
                        department: event.target.value,
                        municipality: '',
                      }))
                    }
                  >
                    <option value="">
                      {locationsLoading
                        ? 'Cargando departamentos...'
                        : locationOptions.length > 0
                          ? 'Selecciona departamento'
                          : 'Departamentos no disponibles'}
                    </option>
                    {locationOptions.map((department) => (
                      <option key={department.department} value={department.department}>
                        {department.department}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Municipio">
                  <select
                    className={inputClass}
                    value={advanceForm.municipality}
                    disabled={locationsLoading || !advanceForm.department}
                    onChange={(event) => setAdvanceForm((current) => ({ ...current, municipality: event.target.value }))}
                  >
                    <option value="">
                      {locationsLoading
                        ? 'Cargando municipios...'
                        : advanceForm.department
                          ? 'Selecciona municipio'
                          : 'Primero elige departamento'}
                    </option>
                    {municipalityOptions.map((municipality) => (
                      <option key={municipality} value={municipality}>
                        {municipality}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Inicio">
                    <input className={inputClass} type="date" value={advanceForm.travelStart} onChange={(event) => setAdvanceForm((current) => ({ ...current, travelStart: event.target.value }))} />
                  </Field>
                  <Field label="Fin">
                    <input className={inputClass} type="date" value={advanceForm.travelEnd} onChange={(event) => setAdvanceForm((current) => ({ ...current, travelEnd: event.target.value }))} />
                  </Field>
                </div>
              </div>
              <Field label="Justificación del anticipo">
                <textarea className={textareaClass} value={advanceForm.purpose} onChange={(event) => setAdvanceForm((current) => ({ ...current, purpose: event.target.value }))} placeholder="Describe para qué se requiere el anticipo, actividad y alcance." />
              </Field>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-col gap-2 border-b border-slate-200 pb-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="font-black text-slate-950">Ítems del anticipo</h3>
                    <p className="text-xs font-semibold text-slate-500">Los valores pueden partir de dominios configurados o ajustarse manualmente.</p>
                  </div>
                  <span className="rounded-md bg-white px-3 py-1 text-sm font-black text-slate-900 ring-1 ring-slate-200">
                    {formatMoney(advanceForm.items.reduce((sum, item) => sum + item.amount, 0))}
                  </span>
                </div>

                {advanceDraftItem && (
                  <div className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-3 lg:grid-cols-[1.2fr_0.6fr_0.8fr_1fr_auto] lg:items-end">
                    <Field label="Dominio">
                      <select className={inputClass} value={advanceDraftItem.categoryId} onChange={(event) => updateDraftItem({ categoryId: event.target.value })}>
                        {categoryOptions.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Días/unidades">
                      <input className={inputClass} type="number" min="0" step="0.5" value={advanceDraftItem.days} onChange={(event) => updateDraftItem({ days: asNumber(event.target.value) })} />
                    </Field>
                    <Field label="Valor unitario">
                      <input className={inputClass} type="number" min="0" value={advanceDraftItem.unitAmount} onChange={(event) => updateDraftItem({ unitAmount: asNumber(event.target.value), customAmount: true })} />
                    </Field>
                    <Field label="Nota">
                      <input className={inputClass} value={advanceDraftItem.note || ''} onChange={(event) => updateDraftItem({ note: event.target.value })} placeholder="Opcional" />
                    </Field>
                    <Button type="button" onClick={addDraftItem} className="h-11 bg-slate-950 font-bold text-white hover:bg-slate-800">
                      Agregar
                    </Button>
                  </div>
                )}

                <div className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                  {advanceForm.items.length === 0 ? (
                    <div className="p-5 text-center text-sm font-semibold text-slate-400">Sin ítems agregados.</div>
                  ) : (
                    advanceForm.items.map((item) => (
                      <div key={item.id} className="grid gap-2 p-3 sm:grid-cols-[1fr_auto_auto] sm:items-center">
                        <div>
                          <p className="font-black text-slate-900">{item.categoryName}</p>
                          <p className="text-xs font-semibold text-slate-500">
                            {item.days} x {formatMoney(item.unitAmount)}
                            {item.note ? ` · ${item.note}` : ''}
                          </p>
                        </div>
                        <span className="font-black text-slate-950">{formatMoney(item.amount)}</span>
                        <button type="button" onClick={() => removeAdvanceItem(item.id)} className="rounded-md p-2 text-rose-500 hover:bg-rose-50">
                          <X size={16} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-4">
              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-indigo-600">Resumen</p>
              <div className="mt-4 space-y-3">
                <SummaryLine label="ID del anticipo" value={advanceForm.customId.trim() || 'Sin ID personalizado'} />
                <SummaryLine
                  label="Centro de costos"
                  value={costCenterOptions.find((center) => center.id === advanceForm.costCenterId)?.name || 'Sin seleccionar'}
                />
                <SummaryLine label="Destino" value={[advanceForm.municipality, advanceForm.department].filter(Boolean).join(', ') || 'Sin destino'} />
                <SummaryLine label="Tareas asociadas" value={`${selectedAdvanceTasks.length}`} />
                <SummaryLine label="Periodo" value={`${formatDate(advanceForm.travelStart)} - ${formatDate(advanceForm.travelEnd)}`} />
                <SummaryLine label="Días calendario" value={`${inclusiveDays(advanceForm.travelStart, advanceForm.travelEnd)} días`} />
                <SummaryLine label="Ítems" value={`${advanceForm.items.length}`} />
                <SummaryLine label="Total solicitado" value={formatMoney(advanceForm.items.reduce((sum, item) => sum + item.amount, 0))} strong />
              </div>
              <div className="mt-4">
                <SignatureSummary title="Firma del solicitante" signature={buildCurrentSignatureSnapshot() || undefined} />
              </div>
              <div className="mt-5 rounded-xl border border-indigo-200 bg-white p-3 text-xs font-semibold leading-5 text-slate-600">
                Al enviar confirmas esta solicitud con la firma registrada en tu perfil. Quedará <strong>por validar</strong> y, una vez aprobada, pasará a <strong>Anticipos por pagar</strong>.
              </div>
            </div>
          </div>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setIsAdvanceModalOpen(false)}>Cancelar</Button>
            <Button type="button" onClick={handleCreateAdvance} disabled={submitting} className="bg-indigo-600 font-bold text-white hover:bg-indigo-700">
              {submitting && <Loader2 size={16} className="mr-2 animate-spin" />}
              Enviar anticipo
            </Button>
          </ModalFooter>
        </ModalShell>
      )}

      {viewingAdvance && (() => {
        const advance = advances.find((item) => item.id === viewingAdvance.id) || viewingAdvance;
        const status = statusConfig[advance.status] || statusConfig.submitted;
        const paymentSummary = getAdvancePaymentSummary(advance);
        const costCenters = normalizeCostCenters(
          advance.costCenters,
          asNumber(advance.amountApproved || advance.amountRequested)
        );
        return (
          <ModalShell
            title={`Vista del anticipo ${advance.customId || advance.id.slice(0, 8)}`}
            subtitle="Consulta completa de la solicitud, sus ítems, asignación administrativa, firmas y pago."
            onClose={() => setViewingAdvance(null)}
            wide
          >
            <div className="space-y-5">
              <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3">
                <SummaryLine label="ID administrativo" value={advance.customId || 'Pendiente de asignar'} strong />
                <SummaryLine label="Estado" value={status.label} />
                <SummaryLine label="Total aprobado" value={formatMoney(advance.amountApproved || advance.amountRequested)} strong />
              </div>

              <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,.7fr)]">
                <div className="space-y-5">
                  <section className="rounded-xl border border-slate-200 bg-white p-4">
                    <h3 className="text-sm font-black uppercase tracking-[0.16em] text-slate-500">Información general</h3>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <SummaryLine label="Solicitante" value={advance.requesterName} />
                      <SummaryLine label="Correo" value={advance.requesterEmail || 'Sin correo'} />
                      <SummaryLine label="Destino" value={advance.destination} />
                      <SummaryLine label="Periodo" value={`${formatDate(advance.travelStart)} - ${formatDate(advance.travelEnd)}`} />
                    </div>
                    <div className="mt-3 rounded-lg bg-slate-50 p-3"><p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">Justificación</p><p className="mt-1 text-sm font-semibold leading-6 text-slate-700">{advance.purpose}</p></div>
                    {advance.adminComment && <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm font-semibold text-orange-800"><span className="font-black">Observación administrativa:</span> {advance.adminComment}</div>}
                  </section>

                  <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <div className="border-b border-slate-200 px-4 py-3"><h3 className="text-sm font-black uppercase tracking-[0.16em] text-slate-500">Ítems del anticipo</h3></div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[680px] text-left text-xs">
                        <thead className="bg-slate-100 text-[10px] font-black uppercase tracking-[0.12em] text-slate-500"><tr><th className="px-3 py-2">Concepto</th><th className="px-3 py-2">Días / unidades</th><th className="px-3 py-2">Unitario</th><th className="px-3 py-2">Nota</th><th className="px-3 py-2 text-right">Total</th></tr></thead>
                        <tbody className="divide-y divide-slate-100">{(advance.items || []).map((item) => <tr key={item.id}><td className="px-3 py-3 font-black text-slate-900">{item.categoryName}</td><td className="px-3 py-3 text-slate-600">{item.days}</td><td className="px-3 py-3 text-slate-600">{formatMoney(item.unitAmount)}</td><td className="px-3 py-3 text-slate-500">{item.note || '—'}</td><td className="px-3 py-3 text-right font-black">{formatMoney(item.amount)}</td></tr>)}</tbody>
                        <tfoot className="border-t-2 border-slate-200 bg-slate-50"><tr><td colSpan={4} className="px-3 py-3 text-right font-black uppercase text-slate-500">Total solicitado</td><td className="px-3 py-3 text-right text-sm font-black text-indigo-700">{formatMoney(advance.amountRequested)}</td></tr></tfoot>
                      </table>
                    </div>
                  </section>

                  <section className="rounded-xl border border-slate-200 bg-white p-4">
                    <h3 className="text-sm font-black uppercase tracking-[0.16em] text-slate-500">Asignación y trazabilidad</h3>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <SummaryLine label="Tareas vinculadas" value={(advance.taskTitles || []).join(', ') || advance.taskTitle || 'Sin tareas'} />
                      <SummaryLine label="Centro principal" value={advance.costCenterName || costCenters[0]?.name || 'Sin asignar'} />
                    </div>
                    {costCenters.length > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2">{costCenters.map((center) => <div key={center.id} className="rounded-lg bg-emerald-50 px-3 py-2 ring-1 ring-emerald-100"><p className="text-xs font-black text-emerald-900">{center.name}</p><p className="mt-1 text-xs font-semibold text-emerald-700">{center.percentage}% · {formatMoney(center.amount)}</p></div>)}</div>}
                  </section>
                </div>

                <aside className="space-y-3">
                  <SignatureSummary title="Firma solicitante" signature={advance.requesterSignature} />
                  <SignatureSummary title="Firma aprobador" signature={advance.approvalSignature} />
                  <div className={`rounded-xl border p-4 ${paymentSummary.hasPayment ? paymentSummary.isFullyPaid ? 'border-emerald-200 bg-emerald-50' : 'border-fuchsia-200 bg-fuchsia-50' : 'border-violet-200 bg-violet-50'}`}>
                    <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">Pago</p>
                    {paymentSummary.hasPayment ? (
                      <>
                        <p className={`mt-2 text-lg font-black ${paymentSummary.isFullyPaid ? 'text-emerald-900' : 'text-fuchsia-900'}`}>{formatMoney(paymentSummary.paid)}</p>
                        <p className={`mt-1 text-xs font-semibold ${paymentSummary.isFullyPaid ? 'text-emerald-700' : 'text-fuchsia-700'}`}>
                          {paymentSummary.progress}% pagado · saldo {formatMoney(paymentSummary.balance)}
                        </p>
                        <div className="mt-3 space-y-2">
                          {paymentSummary.supports.map((support, index) => (
                            <SecureDocumentLink key={`${support.documentId}-${index}`} storagePath={support.storagePath} fallbackUrl={support.fileUrl} className={`flex items-center justify-between gap-2 rounded-lg bg-white/70 px-3 py-2 text-xs font-black ring-1 ${paymentSummary.isFullyPaid ? 'text-emerald-800 ring-emerald-100' : 'text-fuchsia-800 ring-fuchsia-100'}`}>
                              <span className="inline-flex min-w-0 items-center gap-2">
                                <FileText size={14} />
                                <span className="truncate">{support.kind === 'partial' ? 'Abono' : support.kind === 'final' ? 'Pago final' : 'Pago'} {index + 1}</span>
                              </span>
                              <span>{formatMoney(support.amount)}</span>
                            </SecureDocumentLink>
                          ))}
                        </div>
                      </>
                    ) : <p className="mt-2 text-sm font-bold text-violet-800">Pendiente de registrar el desembolso.</p>}
                  </div>
                </aside>
              </div>
            </div>
            <ModalFooter>
              <AdvanceReportMenu
                advance={advance}
                onSelect={(scope) => void downloadAdvanceReportOption(advance, scope)}
              />
              {(canManage || canValidate) && ['submitted', 'pending_payment', 'partially_paid', 'paid'].includes(advance.status) && <Button type="button" variant="outline" onClick={() => { setViewingAdvance(null); openAdvanceEditor(advance); }} className="border-indigo-200 text-indigo-700"><PencilLine size={15} className="mr-2" />Editar anticipo</Button>}
              {canValidate && canAdvanceReceivePayment(advance) && <Button type="button" onClick={() => { setViewingAdvance(null); openAdvancePayment(advance); }} className="bg-violet-600 font-bold text-white hover:bg-violet-700"><CreditCard size={15} className="mr-2" />{paymentSummary.hasPayment ? 'Registrar saldo' : 'Registrar pago'}</Button>}
              <Button type="button" variant="outline" onClick={() => setViewingAdvance(null)}>Cerrar</Button>
            </ModalFooter>
          </ModalShell>
        );
      })()}

      {paymentAdvance && (() => {
        const paymentSummary = getAdvancePaymentSummary(paymentAdvance);
        const enteredPaymentAmount = roundCurrency(paymentForm.amount);
        const projectedPaid = roundCurrency(paymentSummary.paid + enteredPaymentAmount);
        const projectedProgress = paymentSummary.approved > 0 ? Math.min(100, Math.round((projectedPaid / paymentSummary.approved) * 100)) : 0;
        const willClosePayment = enteredPaymentAmount > 0 && enteredPaymentAmount + 0.01 >= paymentSummary.balance;
        return (
        <ModalShell
          title={paymentSummary.hasPayment ? 'Registrar saldo o nuevo abono' : 'Registrar pago o abono del anticipo'}
          subtitle="El primer abono habilita las legalizaciones; el anticipo solo sale de por pagar cuando el desembolso llega al 100%."
          onClose={() => setPaymentAdvance(null)}
          wide
        >
          <div className="grid gap-4 lg:grid-cols-[1fr_330px]">
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="md:col-span-2 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
                  <Field label="ID administrativo del anticipo · obligatorio">
                    <input className={`${inputClass} bg-white font-black uppercase tracking-wide`} value={paymentForm.customId} maxLength={80} onChange={(event) => setPaymentForm((current) => ({ ...current, customId: event.target.value }))} placeholder="Ej: ANT-2026-001 o ID contable" />
                  </Field>
                  <p className="mt-2 text-xs font-semibold text-indigo-700">La administrativa asigna o confirma este ID antes del desembolso. Se usará en búsquedas, ficha e indexación documental.</p>
                </div>
                <Field label={paymentSummary.hasPayment ? 'Valor del nuevo abono / saldo' : 'Valor pagado o abonado'}>
                  <input className={inputClass} type="number" min="0" step="0.01" value={paymentForm.amount} onChange={(event) => setPaymentForm((current) => ({ ...current, amount: event.target.value }))} />
                </Field>
                <Field label="Fecha del pago">
                  <input className={inputClass} type="date" value={paymentForm.date} onChange={(event) => setPaymentForm((current) => ({ ...current, date: event.target.value }))} />
                </Field>
                <Field label="Referencia bancaria (opcional)">
                  <input className={inputClass} value={paymentForm.reference} onChange={(event) => setPaymentForm((current) => ({ ...current, reference: event.target.value }))} placeholder="Ej: TRANS-928374" />
                </Field>
                <Field label="Nota (opcional)">
                  <input className={inputClass} value={paymentForm.note} onChange={(event) => setPaymentForm((current) => ({ ...current, note: event.target.value }))} placeholder="Cuenta, banco u observación" />
                </Field>
              </div>
              <div>
                <p className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-slate-500">Soporte obligatorio</p>
                <label className="flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-violet-300 bg-violet-50/60 p-5 text-center transition hover:bg-violet-50">
                  <Upload size={24} className="text-violet-600" />
                  <span className="mt-2 text-sm font-black text-violet-800">{paymentFile?.name || 'Seleccionar comprobante de pago'}</span>
                  <span className="mt-1 text-xs font-semibold text-slate-500">PDF, imagen o comprobante exportado por el banco</span>
                  <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(event) => setPaymentFile(event.target.files?.[0] || null)} />
                </label>
              </div>
            </div>
            <aside className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <SummaryLine label="ID administrativo" value={paymentForm.customId.trim() || 'Pendiente de asignar'} />
              <SummaryLine label="Beneficiario" value={paymentAdvance.requesterName} />
              <SummaryLine label="Valor aprobado" value={formatMoney(paymentAdvance.amountApproved || paymentAdvance.amountRequested)} strong />
              <SummaryLine label="Pagado / abonado" value={`${formatMoney(paymentSummary.paid)} · ${paymentSummary.progress}%`} />
              <SummaryLine label="Saldo pendiente" value={formatMoney(paymentSummary.balance)} strong />
              {enteredPaymentAmount > 0 && (
                <div className={`rounded-xl border p-3 text-sm font-bold ${willClosePayment ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800'}`}>
                  Este registro dejará el anticipo en {projectedProgress}% pagado
                  {willClosePayment ? ' y cerrará la etapa administrativa de pago.' : `, con saldo pendiente de ${formatMoney(Math.max(0, paymentSummary.approved - projectedPaid))}.`}
                </div>
              )}
              <SignatureSummary title="Firma solicitante" signature={paymentAdvance.requesterSignature} />
              <SignatureSummary title="Firma aprobador" signature={paymentAdvance.approvalSignature} />
              <Button type="button" variant="outline" onClick={() => { const advance = paymentAdvance; setPaymentAdvance(null); openAdvanceEditor(advance); }} className="w-full border-indigo-200 text-indigo-700 hover:bg-indigo-50"><PencilLine size={15} className="mr-2" />Editar anticipo completo</Button>
            </aside>
          </div>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setPaymentAdvance(null)}>Cancelar</Button>
            <Button type="button" onClick={handleRegisterAdvancePayment} disabled={submitting || !paymentFile || !paymentForm.customId.trim()} className="bg-violet-600 font-bold text-white hover:bg-violet-700">
              {submitting ? <Loader2 size={16} className="mr-2 animate-spin" /> : <CreditCard size={16} className="mr-2" />}
              {willClosePayment ? 'Confirmar pago final' : 'Confirmar abono y habilitar legalización'}
            </Button>
          </ModalFooter>
        </ModalShell>
        );
      })()}

      {reconciliationAdvance && (() => {
        const reconciliation = getAdvanceReconciliation(reconciliationAdvance);
        const isReturn = reconciliation.returnRequired > 0;
        const amount = isReturn ? reconciliation.returnRequired : reconciliation.compensationRequired;
        return (
          <ModalShell
            title={isReturn ? 'Registrar devolución del anticipo' : 'Registrar compensación del anticipo'}
            subtitle={isReturn ? 'El profesional devuelve el saldo no soportado y adjunta el comprobante.' : 'La profesional administrativa registra el pago adicional reconocido al solicitante.'}
            onClose={() => setReconciliationAdvance(null)}
            wide
          >
            <div className="grid gap-4 lg:grid-cols-[1fr_330px]">
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Valor conciliado">
                    <input className={`${inputClass} bg-slate-50 font-black`} value={formatMoney(amount)} disabled />
                  </Field>
                  <Field label="Fecha del movimiento">
                    <input className={inputClass} type="date" value={reconciliationForm.date} onChange={(event) => setReconciliationForm((current) => ({ ...current, date: event.target.value }))} />
                  </Field>
                  <Field label="Referencia (opcional)">
                    <input className={inputClass} value={reconciliationForm.reference} onChange={(event) => setReconciliationForm((current) => ({ ...current, reference: event.target.value }))} placeholder="Transferencia, consignación o comprobante" />
                  </Field>
                  <Field label="Nota (opcional)">
                    <input className={inputClass} value={reconciliationForm.note} onChange={(event) => setReconciliationForm((current) => ({ ...current, note: event.target.value }))} placeholder="Observación de conciliación" />
                  </Field>
                </div>
                <label className="flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-cyan-300 bg-cyan-50/60 p-5 text-center transition hover:bg-cyan-50">
                  <Upload size={26} className="text-cyan-700" />
                  <span className="mt-2 text-sm font-black text-cyan-900">{reconciliationFile?.name || `Seleccionar soporte de ${isReturn ? 'devolución' : 'compensación'}`}</span>
                  <span className="mt-1 text-xs font-semibold text-slate-500">PDF o imagen. Quedará indexado dentro del expediente del anticipo.</span>
                  <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(event) => setReconciliationFile(event.target.files?.[0] || null)} />
                </label>
                {reconciliationFile && <Button type="button" variant="outline" onClick={() => setSupportPreviewFile(reconciliationFile)} className="border-indigo-200 text-indigo-700"><FileText size={14} className="mr-2" />Previsualizar soporte</Button>}
              </div>
              <aside className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <SummaryLine label="Anticipado" value={formatMoney(reconciliation.anticipated)} />
                <SummaryLine label="Justificado" value={formatMoney(reconciliation.justified)} />
                <SummaryLine label="Legalizado" value={formatMoney(reconciliation.legalized)} />
                <SummaryLine label={isReturn ? 'Por devolver' : 'Por compensar'} value={formatMoney(amount)} strong />
                <p className="rounded-lg bg-white p-3 text-xs font-semibold leading-5 text-slate-600 ring-1 ring-slate-200">Después de cargar el soporte, el área administrativa deberá usar “Conciliar y cerrar”. Solo entonces se habilitarán costos reales y expediente final.</p>
              </aside>
            </div>
            <ModalFooter>
              <Button type="button" variant="outline" onClick={() => setReconciliationAdvance(null)}>Cancelar</Button>
              <Button type="button" onClick={handleSaveReconciliationSupport} disabled={submitting || !reconciliationFile} className="bg-cyan-700 font-bold text-white hover:bg-cyan-800">
                {submitting ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Upload size={16} className="mr-2" />}
                Guardar soporte
              </Button>
            </ModalFooter>
          </ModalShell>
        );
      })()}

      {editingAdvance && (
        <ModalShell
          title={editingAdvance.status === 'returned' ? 'Corregir anticipo devuelto' : 'Editar anticipo administrativo'}
          subtitle={editingAdvance.status === 'returned' ? 'Ajusta la solicitud, vuelve a firmarla y reenvíala para aprobación.' : 'Corrige datos del anticipo desde legalizaciones sin alterar soportes ni aprobaciones.'}
          onClose={() => setEditingAdvance(null)}
          wide
        >
          <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
            <div className="space-y-4">
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
                <p className="text-[11px] font-black uppercase tracking-[0.28em] text-indigo-600">
                  Ajuste administrativo
                </p>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
                  Usa esta edición para corregir el ID contable, destino, fechas o descripción del anticipo cuando ya fue aprobado
                  y la legalización necesita quedar alineada con el sistema administrativo.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="ID contable / sistema">
                  <input
                    className={inputClass}
                    value={advanceEditForm.customId}
                    maxLength={80}
                    onChange={(event) => setAdvanceEditForm((current) => ({ ...current, customId: event.target.value }))}
                    placeholder="Ej: 676, ANT-2026-001"
                  />
                </Field>
                <Field label="Estado actual">
                  <input
                    className={`${inputClass} bg-slate-50 text-slate-500`}
                    value={(statusConfig[editingAdvance.status] || statusConfig.submitted).label}
                    readOnly
                  />
                </Field>
                <Field label="Departamento">
                  <select
                    className={inputClass}
                    value={advanceEditForm.department}
                    disabled={locationsLoading || locationOptions.length === 0}
                    onChange={(event) =>
                      setAdvanceEditForm((current) => ({
                        ...current,
                        department: event.target.value,
                        municipality: '',
                      }))
                    }
                  >
                    <option value="">
                      {locationsLoading
                        ? 'Cargando departamentos...'
                        : locationOptions.length > 0
                          ? 'Selecciona departamento'
                          : 'Departamentos no disponibles'}
                    </option>
                    {locationOptions.map((department) => (
                      <option key={department.department} value={department.department}>
                        {department.department}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Municipio">
                  <select
                    className={inputClass}
                    value={advanceEditForm.municipality}
                    disabled={locationsLoading || !advanceEditForm.department}
                    onChange={(event) => setAdvanceEditForm((current) => ({ ...current, municipality: event.target.value }))}
                  >
                    <option value="">
                      {locationsLoading
                        ? 'Cargando municipios...'
                        : advanceEditForm.department
                          ? 'Selecciona municipio'
                          : 'Primero elige departamento'}
                    </option>
                    {editMunicipalityOptions.map((municipality) => (
                      <option key={municipality} value={municipality}>
                        {municipality}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Inicio">
                  <input
                    className={inputClass}
                    type="date"
                    value={advanceEditForm.travelStart}
                    onChange={(event) => setAdvanceEditForm((current) => ({ ...current, travelStart: event.target.value }))}
                  />
                </Field>
                <Field label="Fin">
                  <input
                    className={inputClass}
                    type="date"
                    value={advanceEditForm.travelEnd}
                    onChange={(event) => setAdvanceEditForm((current) => ({ ...current, travelEnd: event.target.value }))}
                  />
                </Field>
              </div>
              <Field label="Justificación / descripción">
                <textarea
                  className={textareaClass}
                  value={advanceEditForm.purpose}
                  onChange={(event) => setAdvanceEditForm((current) => ({ ...current, purpose: event.target.value }))}
                  placeholder="Describe o corrige el alcance administrativo del anticipo."
                />
              </Field>
              {editingAdvance.status === 'returned' && (
                <div className="rounded-2xl border border-orange-200 bg-orange-50/50 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div><p className="text-[11px] font-black uppercase tracking-[0.24em] text-orange-700">Corregir ítems solicitados</p><p className="mt-1 text-xs font-semibold text-slate-500">Ajusta cantidades, valores o notas antes de volver a firmar y reenviar.</p></div>
                    <span className="rounded-md bg-white px-3 py-1.5 text-sm font-black text-orange-800 ring-1 ring-orange-200">{formatMoney(editingAdvanceApprovedAmount)}</span>
                  </div>
                  <div className="space-y-2">
                    {advanceEditForm.items.map((item) => (
                      <div key={item.id} className="grid gap-2 rounded-xl border border-white bg-white p-3 shadow-sm md:grid-cols-[minmax(150px,1fr)_100px_150px_minmax(160px,1fr)_120px] md:items-end">
                        <Field label="Concepto"><input className={`${inputClass} bg-slate-50`} value={item.categoryName} readOnly /></Field>
                        <Field label="Días / und."><input className={inputClass} type="number" min="0.01" step="0.01" value={item.days} onChange={(event) => updateAdvanceEditItem(item.id, { days: asNumber(event.target.value) })} /></Field>
                        <Field label="Valor unitario"><input className={inputClass} type="number" min="0" step="0.01" value={item.unitAmount} onChange={(event) => updateAdvanceEditItem(item.id, { unitAmount: asNumber(event.target.value) })} /></Field>
                        <Field label="Nota"><input className={inputClass} value={item.note || ''} onChange={(event) => updateAdvanceEditItem(item.id, { note: event.target.value })} /></Field>
                        <div className="rounded-lg bg-orange-50 px-3 py-2 text-right"><p className="text-[9px] font-black uppercase text-orange-500">Total</p><p className="font-black text-orange-800">{formatMoney(item.amount)}</p></div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {editingAdvance.status !== 'returned' && <div className="grid gap-3 md:grid-cols-[220px_1fr]">
                <Field label="Dinero devuelto">
                  <input
                    className={inputClass}
                    type="number"
                    min="0"
                    step="0.01"
                    value={advanceEditForm.amountReturned}
                    onChange={(event) => setAdvanceEditForm((current) => ({ ...current, amountReturned: event.target.value }))}
                    placeholder="0"
                  />
                </Field>
                <Field label="Comentario de devolución">
                  <input
                    className={inputClass}
                    value={advanceEditForm.returnComment}
                    onChange={(event) => setAdvanceEditForm((current) => ({ ...current, returnComment: event.target.value }))}
                    placeholder="Ej: reintegro caja menor, transferencia o saldo no usado."
                  />
                </Field>
              </div>}
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.28em] text-emerald-700">Centros de costo</p>
                    <p className="mt-1 text-xs font-bold text-slate-500">Distribuye el dinero aprobado. La suma de porcentajes debe ser 100%.</p>
                  </div>
                  <span
                    className={`rounded-md px-2 py-1 text-xs font-black ${
                      costCentersAreBalanced(advanceEditForm.costCenters)
                        ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200'
                        : 'bg-amber-100 text-amber-700 ring-1 ring-amber-200'
                    }`}
                  >
                    {editingCostCenterTotal}% asignado
                  </span>
                </div>
                <div className="mt-3 space-y-3">
                  {advanceEditForm.costCenters.map((center) => (
                    <div key={center.id} className="rounded-xl border border-white/70 bg-white p-3 shadow-sm">
                      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_120px_auto] lg:items-end">
                        <Field label="Centro">
                          <select
                            className={inputClass}
                            value={center.domainId || ''}
                            onChange={(event) => {
                              const domain = costCenterOptions.find((option) => option.id === event.target.value);
                              if (!domain) return;
                              updateAdvanceCostCenter(center.id, {
                                domainId: domain.id.startsWith('default-cost-center-') ? undefined : domain.id,
                                name: domain.name,
                              });
                            }}
                          >
                            <option value={center.domainId || ''}>
                              {center.name}{center.domainId ? '' : ' · registro anterior'}
                            </option>
                            {costCenterOptions
                              .filter((domain) => domain.id !== center.domainId)
                              .map((domain) => (
                                <option key={domain.id} value={domain.id}>
                                  {domain.code ? `${domain.code} · ` : ''}{domain.name}
                                </option>
                              ))}
                          </select>
                        </Field>
                        <Field label="%">
                          <input
                            className={inputClass}
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            value={center.percentage}
                            onChange={(event) => updateAdvanceCostCenter(center.id, { percentage: asNumber(event.target.value) })}
                          />
                        </Field>
                        <button
                          type="button"
                          onClick={() => removeAdvanceCostCenter(center.id)}
                          disabled={advanceEditForm.costCenters.length <= 1}
                          className="inline-flex h-11 items-center justify-center rounded-lg border border-rose-100 px-3 text-rose-500 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label={`Eliminar ${center.name}`}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                      <div className="mt-3 grid gap-3 md:grid-cols-[180px_1fr]">
                        <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Monto calculado</p>
                          <p className="mt-1 text-sm font-black text-slate-950">{formatMoney(center.amount)}</p>
                        </div>
                        <Field label="Nota">
                          <input
                            className={inputClass}
                            value={center.note || ''}
                            onChange={(event) => updateAdvanceCostCenter(center.id, { note: event.target.value })}
                            placeholder="Opcional"
                          />
                        </Field>
                      </div>
                    </div>
                  ))}
                </div>
                <Button type="button" variant="outline" onClick={addAdvanceCostCenter} className="mt-3 border-emerald-200 text-emerald-700 hover:bg-emerald-50">
                  <Plus size={14} className="mr-2" />
                  Agregar centro de costo
                </Button>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-slate-500">Resumen del anticipo</p>
              <div className="mt-4 space-y-3">
                <SummaryLine label="Solicitante" value={editingAdvance.requesterName || 'Sin solicitante'} />
                <SummaryLine label="ID actual" value={editingAdvance.customId || editingAdvance.id} />
                <SummaryLine label="Nuevo ID" value={advanceEditForm.customId.trim() || 'Sin ID personalizado'} />
                <SummaryLine label="Destino" value={[advanceEditForm.municipality, advanceEditForm.department].filter(Boolean).join(', ') || 'Sin destino'} />
                <SummaryLine label="Periodo" value={`${formatDate(advanceEditForm.travelStart)} - ${formatDate(advanceEditForm.travelEnd)}`} />
                <SummaryLine label="Días calendario" value={`${inclusiveDays(advanceEditForm.travelStart, advanceEditForm.travelEnd)} días`} />
                <SummaryLine label="Tareas vinculadas" value={`${(editingAdvance.taskIds || []).length || (editingAdvance.taskId ? 1 : 0)}`} />
                <SummaryLine label="Anticipado" value={formatMoney(editingAdvanceCoverage?.approved || editingAdvance.amountApproved || editingAdvance.amountRequested)} />
                <SummaryLine label="Legalizado" value={formatMoney(editingAdvanceCoverage?.legalized || editingAdvance.amountLegalized)} />
                <SummaryLine label="Devuelto" value={formatMoney(editingAdvanceCoverage?.returnedCash || 0)} />
                <SummaryLine label="Cubierto" value={`${formatMoney(editingAdvanceCoverage?.covered || 0)} · ${editingAdvanceCoverage?.progress || 0}%`} />
                <SummaryLine
                  label={(editingAdvanceCoverage?.balance || 0) < 0 ? 'Sobra' : 'Saldo'}
                  value={formatMoney(Math.abs(editingAdvanceCoverage?.balance || 0))}
                  strong
                />
              </div>
              {editingAdvance.status === 'returned' && <div className="mt-4"><SignatureSummary title="Firma para el reenvío" signature={buildCurrentSignatureSnapshot() || undefined} /></div>}
              {editingAdvance.administrativeEditedAt && (
                <p className="mt-4 rounded-xl border border-slate-200 bg-white p-3 text-xs font-bold leading-5 text-slate-500">
                  Último ajuste administrativo: {formatDate(editingAdvance.administrativeEditedAt)} por{' '}
                  {editingAdvance.administrativeEditedByName || 'Usuario administrativo'}.
                </p>
              )}
            </div>
          </div>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setEditingAdvance(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleUpdateAdvanceFromLegalizations}
              disabled={submitting}
              className="bg-indigo-600 font-bold text-white hover:bg-indigo-700"
            >
              {submitting && <Loader2 size={16} className="mr-2 animate-spin" />}
              {editingAdvance.status === 'returned' ? 'Firmar y reenviar' : 'Guardar cambios'}
            </Button>
          </ModalFooter>
        </ModalShell>
      )}

      {selectedAdvance && (
        <ModalShell title="Legalizar anticipo" subtitle={selectedAdvance.purpose || selectedAdvance.destination} onClose={closeReceiptModal} wide>
          <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
            <div className="space-y-4">
              <div className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2 md:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setReceiptMode('manual')}
                  className={`rounded-xl px-4 py-3 text-left transition ${
                    receiptMode === 'manual' ? 'bg-white text-indigo-700 shadow-sm ring-1 ring-indigo-100' : 'text-slate-500 hover:bg-white/70'
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm font-black">
                    <ReceiptText size={16} />
                    Manual
                  </span>
                  <span className="mt-1 block text-xs font-semibold">Carga un soporte y diligencia los datos.</span>
                </button>
                <button
                  type="button"
                  onClick={() => setReceiptMode('ai')}
                  className={`rounded-xl px-4 py-3 text-left transition ${
                    receiptMode === 'ai' ? 'bg-white text-indigo-700 shadow-sm ring-1 ring-indigo-100' : 'text-slate-500 hover:bg-white/70'
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm font-black">
                    <Sparkles size={16} />
                    IA por lote
                  </span>
                  <span className="mt-1 block text-xs font-semibold">Sube varios recibos y Pixel crea los registros.</span>
                </button>
              </div>

              {receiptMode === 'manual' ? (
                <>
                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label="Tipo de documento">
                      <select
                        className={inputClass}
                        value={receiptForm.documentType}
                        onChange={(event) =>
                          setReceiptForm((current) => ({
                            ...current,
                            documentType: getReceiptDocumentType(event.target.value),
                          }))
                        }
                      >
                        <option value="invoice">Factura</option>
                        <option value="cash_receipt">Recibo de caja</option>
                      </select>
                      <span className="mt-1 block text-xs font-semibold text-slate-400">{selectedReceiptDocumentMeta.hint}</span>
                    </Field>
                    <Field label="Tipo de gasto">
                      <select className={inputClass} value={receiptForm.categoryId} onChange={(event) => setReceiptForm((current) => ({ ...current, categoryId: event.target.value }))}>
                        {categoryOptions.map((category) => (
                          <option key={category.id} value={category.id}>{category.name}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Centro de costos obligatorio">
                      <select className={inputClass} value={receiptForm.costCenterId} onChange={(event) => setReceiptForm((current) => ({ ...current, costCenterId: event.target.value }))}>
                        <option value="">Selecciona centro de costos</option>
                        {costCenterOptions.map((center) => (
                          <option key={center.id} value={center.id}>{center.name}</option>
                        ))}
                      </select>
                      <span className="mt-1 block text-xs font-semibold text-slate-400">
                        Define dónde se contabilizará esta factura o recibo.
                      </span>
                    </Field>
                    <Field label="Valor del soporte">
                      <input className={inputClass} type="number" min="0" step="0.01" value={receiptForm.amount} onChange={(event) => setReceiptForm((current) => ({ ...current, amount: event.target.value }))} />
                    </Field>
                    <Field label="Fecha del gasto">
                      <input className={inputClass} type="date" value={receiptForm.date} onChange={(event) => setReceiptForm((current) => ({ ...current, date: event.target.value }))} />
                    </Field>
                    <Field label="Razón social / proveedor">
                      <input className={inputClass} value={receiptForm.businessName} onChange={(event) => setReceiptForm((current) => ({ ...current, businessName: event.target.value }))} />
                    </Field>
                    <Field label="NIT o documento">
                      <input className={inputClass} value={receiptForm.taxId} onChange={(event) => setReceiptForm((current) => ({ ...current, taxId: event.target.value }))} />
                    </Field>
                    <Field label={selectedReceiptDocumentMeta.numberLabel}>
                      <input className={inputClass} value={receiptForm.invoiceNumber} onChange={(event) => setReceiptForm((current) => ({ ...current, invoiceNumber: event.target.value }))} />
                    </Field>
                  </div>
                  <Field label={selectedReceiptDocumentType === 'invoice' && selectedReceiptCategory?.requiresCufe ? 'CUFE requerido' : 'CUFE (opcional)'}>
                    <input
                      className={inputClass}
                      value={receiptForm.cufe}
                      onChange={(event) => setReceiptForm((current) => ({ ...current, cufe: event.target.value }))}
                      placeholder={selectedReceiptDocumentType === 'cash_receipt' ? 'No aplica para recibo de caja' : 'Código CUFE, si la factura es electrónica'}
                    />
                    {selectedReceiptDocumentType === 'cash_receipt' && (
                      <span className="mt-1 block text-xs font-semibold text-amber-600">
                        Para recibo de caja el CUFE no es obligatorio.
                      </span>
                    )}
                  </Field>
                  <Field label="Descripción / justificación">
                    <textarea className={textareaClass} value={receiptForm.description} onChange={(event) => setReceiptForm((current) => ({ ...current, description: event.target.value }))} placeholder="Qué gasto se realizó y por qué corresponde al anticipo." />
                  </Field>
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
                    <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg bg-white p-6 text-center ring-1 ring-slate-200 transition hover:bg-slate-50">
                      <Upload size={24} className="text-indigo-600" />
                      <span className="mt-2 text-sm font-black text-slate-900">{receiptFile ? receiptFile.name : 'Adjuntar foto o PDF del soporte'}</span>
                      <span className="mt-1 text-xs font-semibold text-slate-400">Se guardará dentro del gestor documental del proyecto.</span>
                      <input type="file" className="hidden" accept="image/*,application/pdf" onChange={(event) => setReceiptFile(event.target.files?.[0] || null)} />
                    </label>
                    {receiptFile && (
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-indigo-100 bg-indigo-50/70 px-3 py-2">
                        <div className="min-w-0"><p className="truncate text-xs font-black text-slate-800">{receiptFile.name}</p><p className="text-[11px] font-semibold text-slate-500">{formatSupportFileSize(receiptFile.size)} · listo para revisar</p></div>
                        <Button type="button" size="sm" variant="outline" onClick={() => setSupportPreviewFile(receiptFile)} className="border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50"><FileText size={14} className="mr-2" />Previsualizar soporte</Button>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex gap-3">
                        <span className="rounded-xl bg-indigo-600 p-2 text-white">
                          <Sparkles size={20} />
                        </span>
                        <div>
                          <h3 className="text-lg font-black text-slate-950">Legalización inteligente por lote</h3>
                          <p className="mt-1 max-w-2xl text-sm font-semibold leading-6 text-slate-600">
                            Sube fotos o PDF de recibos. Pixel leerá tipo de documento, proveedor, fecha, valor, CUFE, dominio y centro de costos sugerido para crear una legalización por cada soporte.
                          </p>
                        </div>
                      </div>
                      {aiAnalyzingReceipts && (
                        <span className="inline-flex items-center rounded-full bg-white px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-indigo-600 ring-1 ring-indigo-100">
                          <Loader2 size={14} className="mr-2 animate-spin" />
                          Analizando
                        </span>
                      )}
                    </div>
                    <label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-indigo-200 bg-white/80 p-6 text-center transition hover:bg-white">
                      <Upload size={24} className="text-indigo-600" />
                      <span className="mt-2 text-sm font-black text-slate-900">Subir recibos para leer con IA</span>
                      <span className="mt-1 text-xs font-semibold text-slate-500">Máximo 12 archivos por lote. Puedes corregir cada registro antes de guardarlo.</span>
                      <input
                        type="file"
                        multiple
                        className="hidden"
                        accept="image/*,application/pdf"
                        onChange={(event) => {
                          void handleAnalyzeReceiptFiles(event.target.files);
                          event.currentTarget.value = '';
                        }}
                      />
                    </label>
                  </div>

                  {aiReceiptDrafts.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
                      <FileImage className="mx-auto h-8 w-8 text-slate-300" />
                      <p className="mt-3 text-sm font-black text-slate-800">Sin soportes analizados.</p>
                      <p className="mt-1 text-xs font-semibold text-slate-400">Cuando subas recibos, aparecerán aquí como registros editables.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {aiReceiptDrafts.map((draft) => {
                        const draftCategory = categoryOptions.find((category) => category.id === draft.categoryId);
                        const draftDocumentMeta = getReceiptDocumentTypeMeta(draft.documentType);
                        const confidence = Math.round(asNumber(draft.confidence) * 100);
                        return (
                          <div key={draft.id} className={`rounded-2xl border p-4 ${draft.status === 'error' ? 'border-rose-200 bg-rose-50/60' : 'border-slate-200 bg-white'}`}>
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-black text-slate-950">{draft.fileName}</p>
                                <p className="mt-1 text-xs font-semibold text-slate-500">
                                  {draft.status === 'error'
                                    ? draft.error || 'No se pudo leer este soporte.'
                                    : `Confianza IA ${confidence || 0}% · ${formatMoney(draft.amount)}`}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button type="button" size="sm" variant="outline" onClick={() => setSupportPreviewFile(draft.file)} className="border-indigo-200 text-indigo-700 hover:bg-indigo-50"><FileText size={14} className="mr-2" />Previsualizar</Button>
                                <button type="button" onClick={() => removeAiReceiptDraft(draft.id)} className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600" aria-label={`Eliminar ${draft.fileName}`}>
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </div>

                            {draft.status !== 'error' && (
                              <>
                                <div className="mt-4 grid gap-3 md:grid-cols-2">
                                  <Field label="Tipo de documento">
                                    <select
                                      className={inputClass}
                                      value={draft.documentType}
                                      onChange={(event) => updateAiReceiptDraft(draft.id, { documentType: getReceiptDocumentType(event.target.value) })}
                                    >
                                      <option value="invoice">Factura</option>
                                      <option value="cash_receipt">Recibo de caja</option>
                                    </select>
                                  </Field>
                                  <Field label="Tipo de gasto">
                                    <select className={inputClass} value={draft.categoryId} onChange={(event) => updateAiReceiptDraft(draft.id, { categoryId: event.target.value })}>
                                      {categoryOptions.map((category) => (
                                        <option key={category.id} value={category.id}>{category.name}</option>
                                      ))}
                                    </select>
                                  </Field>
                                  <Field label="Centro de costos obligatorio">
                                    <select
                                      className={inputClass}
                                      value={draft.costCenterId}
                                      onChange={(event) => {
                                        const center = costCenterOptions.find((item) => item.id === event.target.value);
                                        updateAiReceiptDraft(draft.id, {
                                          costCenterId: event.target.value,
                                          costCenterName: center?.name || '',
                                        });
                                      }}
                                    >
                                      <option value="">Selecciona centro de costos</option>
                                      {costCenterOptions.map((center) => (
                                        <option key={center.id} value={center.id}>{center.name}</option>
                                      ))}
                                    </select>
                                  </Field>
                                  <Field label="Valor">
                                    <input className={inputClass} type="number" min="0" step="0.01" value={draft.amount} onChange={(event) => updateAiReceiptDraft(draft.id, { amount: event.target.value })} />
                                  </Field>
                                  <Field label="Fecha">
                                    <input className={inputClass} type="date" value={draft.date} onChange={(event) => updateAiReceiptDraft(draft.id, { date: event.target.value })} />
                                  </Field>
                                  <Field label="Razón social / proveedor">
                                    <input className={inputClass} value={draft.businessName} onChange={(event) => updateAiReceiptDraft(draft.id, { businessName: event.target.value })} />
                                  </Field>
                                  <Field label="NIT o documento">
                                    <input className={inputClass} value={draft.taxId} onChange={(event) => updateAiReceiptDraft(draft.id, { taxId: event.target.value })} />
                                  </Field>
                                  <Field label={draftDocumentMeta.numberLabel}>
                                    <input className={inputClass} value={draft.invoiceNumber} onChange={(event) => updateAiReceiptDraft(draft.id, { invoiceNumber: event.target.value })} />
                                  </Field>
                                </div>
                                <div className="mt-3 grid gap-3">
                                  <Field label={draft.documentType === 'invoice' && draftCategory?.requiresCufe ? 'CUFE requerido' : 'CUFE (opcional)'}>
                                    <input
                                      className={inputClass}
                                      value={draft.cufe}
                                      onChange={(event) => updateAiReceiptDraft(draft.id, { cufe: event.target.value })}
                                      placeholder={draft.documentType === 'cash_receipt' ? 'No aplica para recibo de caja' : 'Código CUFE, si la factura es electrónica'}
                                    />
                                    {draft.documentType === 'cash_receipt' && (
                                      <span className="mt-1 block text-xs font-semibold text-amber-600">
                                        Para recibo de caja el CUFE no es obligatorio.
                                      </span>
                                    )}
                                  </Field>
                                  <Field label="Descripción">
                                    <textarea className={textareaClass} value={draft.description} onChange={(event) => updateAiReceiptDraft(draft.id, { description: event.target.value })} />
                                  </Field>
                                </div>
                                {(draft.warnings || []).length > 0 && (
                                  <div className="mt-3 rounded-xl bg-amber-50 p-3 text-xs font-semibold leading-5 text-amber-700 ring-1 ring-amber-100">
                                    {(draft.warnings || []).join(' · ')}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-slate-400">Anticipo</p>
              <h3 className="mt-2 text-xl font-black text-slate-950">{selectedAdvance.destination}</h3>
              <p className="mt-1 text-sm font-semibold text-slate-500">{selectedAdvance.requesterName}</p>
              <div className="mt-4 space-y-3">
                <SummaryLine label="Anticipado" value={formatMoney(selectedAdvance.amountApproved || selectedAdvance.amountRequested)} />
                <SummaryLine label="Justificado" value={formatMoney(getAdvanceJustifiedAmount(selectedAdvance))} />
                <SummaryLine label="Legalizado" value={formatMoney(selectedAdvance.amountLegalized)} />
                <SummaryLine label="Saldo" value={formatMoney(selectedAdvance.balance)} strong />
                {receiptMode === 'ai' && <SummaryLine label="Borradores IA" value={`${aiReceiptDrafts.length}`} />}
              </div>
              <div className="mt-4 grid gap-2">
                <SignatureSummary title="Firma solicitante" signature={selectedAdvance.requesterSignature} />
                <SignatureSummary title="Firma aprobador" signature={selectedAdvance.approvalSignature} />
              </div>
              <div className="mt-5 rounded-xl bg-slate-50 p-3 text-xs font-semibold leading-5 text-slate-500">
                Las facturas con CUFE se cruzan contra la base vigente de Auditoría DIAN. Las facturas no electrónicas y los recibos
                de caja conservan su clasificación documental para la revisión administrativa.
              </div>
            </div>
          </div>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={closeReceiptModal}>Cancelar</Button>
            <Button
              type="button"
              onClick={receiptMode === 'ai' ? handleCreateAiReceipts : handleCreateReceipt}
              disabled={submitting || (receiptMode === 'ai' && (aiAnalyzingReceipts || aiReceiptDrafts.length === 0))}
              className="bg-emerald-600 font-bold text-white hover:bg-emerald-700"
            >
              {submitting && <Loader2 size={16} className="mr-2 animate-spin" />}
              {receiptMode === 'ai' ? 'Crear legalizaciones' : 'Enviar soporte'}
            </Button>
          </ModalFooter>
        </ModalShell>
      )}

      {supportPreviewFile && (
        <ModalShell
          title="Previsualización del soporte"
          subtitle={`${supportPreviewFile.name} · ${formatSupportFileSize(supportPreviewFile.size)}`}
          onClose={() => setSupportPreviewFile(null)}
          wide
          topLayer
        >
          <LocalFilePreview key={`${supportPreviewFile.name}-${supportPreviewFile.lastModified}`} file={supportPreviewFile} />
          <ModalFooter>
            <Button type="button" onClick={() => setSupportPreviewFile(null)} className="bg-indigo-600 font-bold text-white hover:bg-indigo-700">Cerrar previsualización</Button>
          </ModalFooter>
        </ModalShell>
      )}

      {receiptEditor && receiptEditorForm && (() => {
        const isAuditEdit = receiptEditor.mode === 'audit';
        const isAdministrativeEdit = receiptEditor.mode === 'administrative';
        const isReview = receiptEditor.mode !== 'correction';
        const documentMeta = getReceiptDocumentTypeMeta(receiptEditorForm.documentType);
        const selectedCategory = categoryOptions.find((category) => category.id === receiptEditorForm.categoryId);
        const changes = getReceiptEditorChanges(receiptEditor.receipt, receiptEditorForm);
        const requiresCufe = receiptEditorForm.documentType === 'invoice' && Boolean(selectedCategory?.requiresCufe);
        const hasLegacyOfficialDianVerification =
          receiptEditorForm.dianVerificationStatus === 'confirmed' &&
          receiptEditorForm.dianVerificationSource !== 'audit_base';
        return (
          <ModalShell
            title={
              isAuditEdit
                ? 'Editar legalización desde Auditoría DIAN'
                : isAdministrativeEdit
                  ? 'Editar legalización aprobada'
                  : isReview
                    ? 'Revisar y aprobar soporte'
                    : 'Subsanar legalización devuelta'
            }
            subtitle={`${receiptEditor.advance.purpose || receiptEditor.advance.destination} · ${receiptEditor.receipt.categoryName}`}
            onClose={closeReceiptEditor}
            wide
          >
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="space-y-5">
                {isAdministrativeEdit && (
                  <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm font-semibold text-indigo-900">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-indigo-700">Edición administrativa con trazabilidad</p>
                    <p className="mt-2 leading-6">
                      Al guardar, Pixel conservará los cambios como una nueva revisión. Las facturas sujetas a cruce volverán al
                      estado <strong>Por auditoría DIAN</strong> antes de contabilizarse nuevamente.
                    </p>
                    {receiptEditor.receipt.accountingClosureId && (
                      <p className="mt-2 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs leading-5 text-indigo-800">
                        Esta legalización pertenece a un cierre parcial. Pixel actualizará automáticamente ese corte; si es factura,
                        se retirará temporalmente del informe hasta que vuelva a aprobarse en Auditoría DIAN.
                      </p>
                    )}
                  </div>
                )}
                {receiptEditor.receipt.status === 'returned' && receiptEditor.receipt.reviewComment && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-rose-600">Motivo de devolución</p>
                    <p className="mt-2">{receiptEditor.receipt.reviewComment}</p>
                  </div>
                )}

                <div className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-2">
                  <Field label="Tipo de documento">
                    <select
                      className={inputClass}
                      value={receiptEditorForm.documentType}
                      onChange={(event) => {
                        const documentType = getReceiptDocumentType(event.target.value);
                        updateReceiptEditorForm({
                          documentType,
                          dianVerificationStatus: documentType === 'cash_receipt' ? 'not_applicable' : receiptEditorForm.cufe ? 'pending' : 'not_applicable',
                          dianLookupOpenedAt: '',
                          dianVerifiedAt: '',
                          dianVerificationSource: undefined,
                        });
                      }}
                    >
                      <option value="invoice">Factura</option>
                      <option value="cash_receipt">Recibo de caja</option>
                    </select>
                  </Field>
                  <Field label="Tipo de gasto">
                    <select className={inputClass} value={receiptEditorForm.categoryId} onChange={(event) => updateReceiptEditorForm({ categoryId: event.target.value })}>
                      {categoryOptions.map((category) => (
                        <option key={category.id} value={category.id}>{category.name}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Centro de costos obligatorio">
                    <select className={inputClass} value={receiptEditorForm.costCenterId} onChange={(event) => updateReceiptEditorForm({ costCenterId: event.target.value })}>
                      <option value="">Selecciona centro de costos</option>
                      {costCenterOptions.map((center) => (
                        <option key={center.id} value={center.id}>{center.name}</option>
                      ))}
                    </select>
                    {receiptEditor.receipt.costCenterSource === 'advance_provisional' && (
                      <span className="mt-1 block text-xs font-semibold text-amber-600">
                        Esta legalización anterior heredó provisionalmente el centro principal del anticipo. Confírmalo antes de guardar.
                      </span>
                    )}
                  </Field>
                  <Field label="Valor">
                    <input className={inputClass} type="number" min="0" step="0.01" value={receiptEditorForm.amount} onChange={(event) => updateReceiptEditorForm({ amount: event.target.value })} />
                  </Field>
                  <Field label="Fecha del soporte">
                    <input className={inputClass} type="date" value={receiptEditorForm.date} onChange={(event) => updateReceiptEditorForm({ date: event.target.value })} />
                  </Field>
                  <Field label="Razón social">
                    <input className={inputClass} value={receiptEditorForm.businessName} onChange={(event) => updateReceiptEditorForm({ businessName: event.target.value })} />
                  </Field>
                  <Field label="NIT o documento">
                    <input className={inputClass} value={receiptEditorForm.taxId} onChange={(event) => updateReceiptEditorForm({ taxId: event.target.value })} />
                  </Field>
                  <Field label={documentMeta.numberLabel}>
                    <input className={inputClass} value={receiptEditorForm.invoiceNumber} onChange={(event) => updateReceiptEditorForm({ invoiceNumber: event.target.value })} />
                  </Field>
                  {receiptEditorForm.documentType === 'invoice' && (
                    <Field label={requiresCufe ? 'CUFE obligatorio' : 'CUFE'}>
                      <input
                        className={inputClass}
                        value={receiptEditorForm.cufe}
                        onChange={(event) => {
                          const cufe = event.target.value;
                          updateReceiptEditorForm({
                            cufe,
                            dianVerificationStatus: cufe.trim() ? 'pending' : 'not_applicable',
                            dianLookupOpenedAt: '',
                            dianVerifiedAt: '',
                            dianDocumentUrl: cufe.trim() ? buildDianDocumentUrl(cufe) : '',
                            dianVerificationSource: undefined,
                          });
                        }}
                      />
                    </Field>
                  )}
                  <div className="md:col-span-2">
                    <Field label="Descripción">
                      <textarea className={textareaClass} value={receiptEditorForm.description} onChange={(event) => updateReceiptEditorForm({ description: event.target.value })} />
                    </Field>
                  </div>
                </div>

                {receiptEditorForm.documentType === 'invoice' ? (
                  <div className={`rounded-xl border p-4 ${receiptEditorForm.dianVerificationStatus === 'confirmed' ? 'border-emerald-200 bg-emerald-50' : receiptEditorForm.dianVerificationStatus === 'failed' ? 'border-rose-200 bg-rose-50' : 'border-cyan-200 bg-cyan-50'}`}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="flex items-center gap-2 text-sm font-black text-slate-950">
                          <ShieldCheck size={17} className={receiptEditorForm.dianVerificationStatus === 'confirmed' ? 'text-emerald-600' : receiptEditorForm.dianVerificationStatus === 'failed' ? 'text-rose-600' : 'text-cyan-600'} />
                          Cruce contra base DIAN vigente
                        </p>
                        <p className="mt-1 text-xs font-semibold text-slate-600">
                          {isAdministrativeEdit
                            ? 'La factura se enviará a Auditoría DIAN al guardar, incluso si tuvo una validación anterior.'
                            : receiptEditorForm.dianVerificationStatus === 'confirmed'
                            ? hasLegacyOfficialDianVerification
                              ? 'Validación DIAN previa conservada. No necesitas repetirla si no cambias los datos del soporte.'
                              : `Factura encontrada en ${activeDianAuditFileName || 'la base DIAN vigente'}.`
                            : receiptEditorForm.dianVerificationStatus === 'failed'
                              ? 'No se encontró coincidencia exacta en la base DIAN vigente.'
                              : activeDianAuditRows.length > 0
                                ? `Base disponible: ${activeDianAuditFileName || 'base DIAN vigente'} · ${activeDianAuditRowCount} filas.`
                                : 'No hay base DIAN vigente. Puedes aprobar administrativamente y quedará pendiente para Auditoría DIAN.'}
                        </p>
                      </div>
                      <span className={`rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${isAdministrativeEdit ? 'bg-white text-cyan-700 ring-1 ring-cyan-200' : receiptEditorForm.dianVerificationStatus === 'confirmed' ? 'bg-emerald-600 text-white' : receiptEditorForm.dianVerificationStatus === 'failed' ? 'bg-white text-rose-700 ring-1 ring-rose-200' : 'bg-white text-cyan-700 ring-1 ring-cyan-200'}`}>
                        {isAdministrativeEdit
                          ? 'Se reenviará'
                          : receiptEditorForm.dianVerificationStatus === 'confirmed'
                            ? hasLegacyOfficialDianVerification
                              ? 'Validada previa'
                              : 'Cruzada'
                            : receiptEditorForm.dianVerificationStatus === 'failed'
                              ? 'Sin cruce'
                              : 'Pendiente'}
                      </span>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {!isAdministrativeEdit && (
                        <Button type="button" size="sm" onClick={verifyReceiptAgainstDianAuditBase} disabled={activeDianAuditRows.length === 0} className="bg-cyan-700 text-white hover:bg-cyan-800 disabled:cursor-not-allowed disabled:bg-slate-300">
                          <CheckCircle2 size={14} className="mr-1" /> Cruzar con base DIAN
                        </Button>
                      )}
                      {receiptEditorForm.dianDocumentUrl && (
                        <a href={receiptEditorForm.dianDocumentUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md px-3 py-2 text-xs font-black text-slate-600 hover:bg-white">
                          Abrir referencia DIAN <ExternalLink size={13} />
                        </a>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
                    El recibo de caja no requiere verificación CUFE. Su archivo y datos quedan sujetos a revisión administrativa.
                  </div>
                )}

                {isReview ? (
                  <Field label="Comentario administrativo">
                    <textarea
                      className={textareaClass}
                      value={reviewComment}
                      onChange={(event) => setReviewComment(event.target.value)}
                      placeholder={
                        isAuditEdit
                          ? 'Explica el ajuste realizado antes de volver a ejecutar el cruce DIAN.'
                          : isAdministrativeEdit
                            ? 'Describe por qué se editó y reenvió esta legalización.'
                            : 'Observaciones de la revisión o explicación de los ajustes realizados.'
                      }
                    />
                  </Field>
                ) : (
                  <div className="space-y-4 rounded-xl border border-rose-200 bg-rose-50/60 p-4">
                    <Field label="Detalle de la subsanación">
                      <textarea className={textareaClass} value={receiptEditorForm.correctionNote} onChange={(event) => updateReceiptEditorForm({ correctionNote: event.target.value })} placeholder="Explica qué corregiste y cómo atiendes la devolución." />
                    </Field>
                    <Field label="Reemplazar archivo de soporte (opcional)">
                      <input className={inputClass} type="file" accept="image/*,application/pdf" onChange={(event) => setReceiptCorrectionFile(event.target.files?.[0] || null)} />
                    </Field>
                  </div>
                )}
              </div>

              <aside className="space-y-4">
                <div className="rounded-xl bg-slate-950 p-4 text-white">
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-indigo-300">Resumen del soporte</p>
                  <p className="mt-3 text-lg font-black">{selectedCategory?.name || receiptEditor.receipt.categoryName}</p>
                  <p className="mt-1 text-sm font-semibold text-slate-300">{receiptEditor.advance.requesterName}</p>
                  <div className="mt-4 space-y-2">
                    <SummaryLine label="Valor" value={formatMoney(asNumber(receiptEditorForm.amount))} strong />
                    <SummaryLine label="Documento" value={documentMeta.shortLabel} />
                    <SummaryLine label="Centro de costos" value={costCenterOptions.find((center) => center.id === receiptEditorForm.costCenterId)?.name || 'Pendiente'} />
                    <SummaryLine label="Cambios" value={`${changes.length}`} />
                    <SummaryLine label="Revisiones" value={`${asNumber(receiptEditor.receipt.revisionCount)}`} />
                  </div>
                </div>

                {changes.length > 0 && (
                  <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-indigo-700">Cambios que quedarán auditados</p>
                    <div className="mt-3 space-y-2">
                      {changes.map((change) => (
                        <div key={change.field} className="rounded-lg bg-white p-3 ring-1 ring-indigo-100">
                          <p className="text-xs font-black text-slate-900">{change.label}</p>
                          <p className="mt-1 break-words text-[11px] font-semibold text-slate-500">{String(change.previousValue || 'Vacío')} → {String(change.nextValue || 'Vacío')}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(receiptEditor.receipt.fileUrl || receiptEditor.receipt.storagePath) && (
                  <SecureDocumentLink storagePath={receiptEditor.receipt.storagePath} fallbackUrl={receiptEditor.receipt.fileUrl} className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-indigo-700 shadow-sm hover:bg-indigo-50">
                    <FileImage size={16} /> Ver soporte original
                  </SecureDocumentLink>
                )}

                {isReview && (
                  <div className="rounded-xl border border-indigo-100 bg-white p-4 shadow-sm">
                    <div className="flex items-start gap-3">
                      <span className="rounded-lg bg-indigo-50 p-2 text-indigo-600">
                        <Upload size={16} />
                      </span>
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.16em] text-indigo-700">Cambiar soporte</p>
                        <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                          Sube el archivo correcto y, si quieres, Pixel vuelve a leerlo con IA para llenar los campos.
                        </p>
                      </div>
                    </div>
                    <input
                      id={`receipt-support-replacement-${receiptEditor.receipt.id}`}
                      type="file"
                      accept="image/*,application/pdf"
                      className="hidden"
                      onChange={(event) => setReceiptReplacementFile(event.target.files?.[0] || null)}
                    />
                    <label
                      htmlFor={`receipt-support-replacement-${receiptEditor.receipt.id}`}
                      className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-indigo-200 bg-indigo-50/60 px-3 py-4 text-center text-xs font-black text-indigo-700 transition hover:bg-indigo-50"
                    >
                      <FileImage size={18} className="mb-2" />
                      {receiptReplacementFile ? receiptReplacementFile.name : 'Seleccionar nuevo soporte'}
                      {receiptReplacementFile && (
                        <span className="mt-1 text-[10px] font-bold text-slate-500">{formatSupportFileSize(receiptReplacementFile.size)}</span>
                      )}
                    </label>
                    <div className="mt-3 grid gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void handleReplaceReceiptSupport(false)}
                        disabled={!receiptReplacementFile || Boolean(receiptSupportAction) || submitting}
                        className="justify-center"
                      >
                        {receiptSupportAction === 'replace' ? <Loader2 size={15} className="mr-2 animate-spin" /> : <Upload size={15} className="mr-2" />}
                        Guardar nuevo soporte
                      </Button>
                      <Button
                        type="button"
                        onClick={() => void handleReplaceReceiptSupport(true)}
                        disabled={!receiptReplacementFile || Boolean(receiptSupportAction) || submitting}
                        className="justify-center bg-indigo-600 text-white hover:bg-indigo-700"
                      >
                        {receiptSupportAction === 'reanalyze' ? <Loader2 size={15} className="mr-2 animate-spin" /> : <Sparkles size={15} className="mr-2" />}
                        Releer con IA y llenar campos
                      </Button>
                    </div>
                  </div>
                )}
              </aside>
            </div>

            <ModalFooter>
              <Button type="button" variant="outline" onClick={closeReceiptEditor} disabled={submitting || Boolean(receiptSupportAction)}>Cancelar</Button>
              <Button
                type="button"
                onClick={isReview ? handleApproveReceipt : handleResubmitReceipt}
                disabled={submitting || Boolean(receiptSupportAction)}
                className={
                  isAdministrativeEdit
                    ? 'bg-indigo-600 font-bold text-white hover:bg-indigo-700'
                    : isReview
                      ? 'bg-emerald-600 font-bold text-white hover:bg-emerald-700'
                      : 'bg-rose-600 font-bold text-white hover:bg-rose-700'
                }
              >
                {(submitting || receiptSupportAction) && <Loader2 size={16} className="mr-2 animate-spin" />}
                {isAuditEdit
                  ? 'Guardar y volver a auditar'
                  : isAdministrativeEdit
                    ? receiptEditorForm.documentType === 'invoice'
                      ? 'Guardar y enviar a Auditoría DIAN'
                      : 'Guardar y reenviar'
                    : isReview
                      ? changes.length > 0
                        ? 'Aprobar con modificación'
                        : 'Aprobar soporte'
                      : 'Reenviar subsanación'}
              </Button>
            </ModalFooter>
          </ModalShell>
        );
      })()}

      {deletingAccountingClosure && (() => {
        const latestAdvance = advances.find((advance) => advance.id === deletingAccountingClosure.advance.id) || deletingAccountingClosure.advance;
        const liveClosure = getAdvanceAccountingClosures(latestAdvance).find(
          (closure) => closure.id === deletingAccountingClosure.closure.id
        ) || deletingAccountingClosure.closure;
        const receiptCount = getAccountingClosureOriginalReceiptIds(liveClosure).length;

        return (
          <ModalShell
            title={`Eliminar cierre parcial ${liveClosure.sequence}`}
            subtitle="Esta acción elimina el corte histórico y libera sus facturas para que puedan incluirse en un nuevo cierre."
            onClose={() => setDeletingAccountingClosure(null)}
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <ReceiptGroupMetric label="Fecha del cierre" value={formatDate(liveClosure.createdAt)} tone="slate" />
              <ReceiptGroupMetric label="Facturas que se liberan" value={`${receiptCount}`} tone="amber" />
              <ReceiptGroupMetric label="Total que se libera" value={formatMoney(liveClosure.amount)} tone="rose" />
            </div>
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold leading-6 text-rose-800">
              El informe histórico de este cierre dejará de estar disponible. Las legalizaciones no se eliminan ni pierden su aprobación: volverán a quedar disponibles para crear el cierre parcial correcto.
            </div>
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold leading-5 text-amber-800">
              Por seguridad, Pixel solo permite eliminar el cierre parcial más reciente. Los cierres anteriores permanecen congelados mientras exista un corte posterior.
            </div>
            <ModalFooter>
              <Button type="button" variant="outline" onClick={() => setDeletingAccountingClosure(null)} disabled={submitting}>
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={() => void handleDeleteAccountingClosure()}
                disabled={submitting}
                className="bg-rose-600 font-bold text-white hover:bg-rose-700"
              >
                {submitting ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Trash2 size={16} className="mr-2" />}
                Sí, eliminar cierre
              </Button>
            </ModalFooter>
          </ModalShell>
        );
      })()}

      {editingAccountingClosure && (() => {
        const latestAdvance = advances.find((advance) => advance.id === editingAccountingClosure.advance.id) || editingAccountingClosure.advance;
        const closures = getAdvanceAccountingClosures(latestAdvance);
        const currentClosure = closures.find((closure) => closure.id === editingAccountingClosure.closure.id) || editingAccountingClosure.closure;
        const otherClosedIds = new Set<string>();
        closures
          .filter((closure) => closure.id !== currentClosure.id)
          .forEach((closure) => (closure.receiptIds || []).forEach((receiptId) => otherClosedIds.add(receiptId)));
        const previewedAt = new Date().toISOString();
        const previewReceipts = (latestAdvance.receipts || []).map((receipt) =>
          promoteReceiptFromCurrentDianBase(receipt, activeDianAuditRows, {
            batchId: latestDianAuditBatch?.id,
            batchName: activeDianAuditFileName,
            now: previewedAt,
            includeRevision: false,
          })
        );
        const editableReceipts = getEditableAccountingClosureReceipts(
          currentClosure,
          previewReceipts,
          otherClosedIds
        );
        const originalReceiptIds = new Set(getAccountingClosureOriginalReceiptIds(currentClosure));
        const liveReceiptById = new Map(previewReceipts.map((receipt) => [receipt.id, receipt]));
        const selectedIds = new Set(accountingClosureReceiptIds);
        const selectedReceipts = editableReceipts.filter((receipt) => selectedIds.has(receipt.id));
        const selectedAmount = selectedReceipts.reduce((sum, receipt) => sum + asNumber(receipt.amount), 0);
        const missingLiveReceipts = getAccountingClosureOriginalReceiptIds(currentClosure)
          .filter((receiptId) => !liveReceiptById.has(receiptId));
        const originalReceiptsWithChangedStatus = getAccountingClosureOriginalReceiptIds(currentClosure)
          .filter((receiptId) => {
            const liveReceipt = liveReceiptById.get(receiptId);
            return Boolean(liveReceipt && !isAccountingAcceptedReceipt(liveReceipt));
          });
        const closeEditor = () => {
          setEditingAccountingClosure(null);
          setAccountingClosureReceiptIds([]);
          setAccountingClosureEditDate('');
          setAccountingClosureEditNote('');
        };

        return (
          <ModalShell
            title={`Editar cierre parcial ${currentClosure.sequence}`}
            subtitle="Corrige únicamente el último corte. Los cierres anteriores permanecen congelados."
            onClose={closeEditor}
            wide
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <ReceiptGroupMetric label="Facturas seleccionadas" value={`${selectedReceipts.length}`} tone="indigo" />
              <ReceiptGroupMetric label="Total corregido" value={formatMoney(selectedAmount)} tone="emerald" />
              {canEditAccountingClosureDate ? (
                <Field label="Fecha del corte">
                  <input
                    type="date"
                    className={`${inputClass} border-violet-200 bg-violet-50 font-black text-violet-900 focus:border-violet-500 focus:ring-violet-500/15`}
                    value={accountingClosureEditDate}
                    max={todayInputValue()}
                    onChange={(event) => setAccountingClosureEditDate(event.target.value)}
                    disabled={submitting}
                  />
                </Field>
              ) : (
                <ReceiptGroupMetric label="Fecha del corte" value={formatDate(currentClosure.createdAt)} tone="slate" />
              )}
            </div>
            <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs font-bold leading-5 text-violet-800">
              Puedes retirar una factura incluida por error o agregar una factura aceptada que aún no pertenezca a otro cierre. El informe histórico de este corte usará la selección corregida.
            </div>
            {missingLiveReceipts.length > 0 && (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">
                {missingLiveReceipts.length} factura{missingLiveReceipts.length === 1 ? '' : 's'} del cierre fue{missingLiveReceipts.length === 1 ? '' : 'ron'} eliminada{missingLiveReceipts.length === 1 ? '' : 's'} de las legalizaciones después del corte. Se conserva{missingLiveReceipts.length === 1 ? '' : 'n'} seleccionada{missingLiveReceipts.length === 1 ? '' : 's'} con su copia histórica para no alterar el total; puedes retirarla{missingLiveReceipts.length === 1 ? '' : 's'} manualmente si esa es la corrección requerida.
              </div>
            )}
            {originalReceiptsWithChangedStatus.length > 0 && (
              <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs font-bold text-sky-800">
                {originalReceiptsWithChangedStatus.length} factura{originalReceiptsWithChangedStatus.length === 1 ? '' : 's'} cambió{originalReceiptsWithChangedStatus.length === 1 ? '' : 'aron'} de estado después del corte. La copia histórica permanece seleccionada hasta que decidas retirarla manualmente.
              </div>
            )}
            <div className="mt-4 max-h-[46vh] space-y-2 overflow-y-auto pr-1">
              {editableReceipts.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-sm font-bold text-slate-500">
                  No hay facturas aceptadas disponibles para este corte.
                </p>
              ) : editableReceipts.map((receipt, index) => {
                const checked = selectedIds.has(receipt.id);
                const costCenter = getReceiptCostCenter(receipt, latestAdvance);
                const isOriginalReceipt = originalReceiptIds.has(receipt.id);
                const liveReceipt = liveReceiptById.get(receipt.id);
                const isHistoricalOnly = isOriginalReceipt && !liveReceipt;
                const hasChangedLiveStatus = Boolean(
                  isOriginalReceipt && liveReceipt && !isAccountingAcceptedReceipt(liveReceipt)
                );
                return (
                  <label
                    key={receipt.id}
                    className={`grid cursor-pointer gap-3 rounded-xl border p-3 transition sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center ${checked ? 'border-violet-300 bg-violet-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={submitting}
                      onChange={(event) => {
                        setAccountingClosureReceiptIds((current) =>
                          event.target.checked
                            ? Array.from(new Set([...current, receipt.id]))
                            : current.filter((receiptId) => receiptId !== receipt.id)
                        );
                      }}
                      className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-black text-slate-900">
                        {index + 1}. {receipt.categoryName} · {receipt.businessName || 'Sin proveedor'}
                      </span>
                      <span className="mt-1 block text-xs font-semibold text-slate-500">
                        {formatDate(receipt.date)} · {receipt.invoiceNumber || 'Sin número'} · {costCenter.name}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-1.5">
                        {isHistoricalOnly && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-amber-800">
                            Histórica · eliminada después del cierre
                          </span>
                        )}
                        {hasChangedLiveStatus && liveReceipt && (
                          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-sky-800">
                            Histórica · estado actual: {getReceiptStatusMeta(liveReceipt.status).label}
                          </span>
                        )}
                        {!isOriginalReceipt && (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-emerald-800">
                            Disponible para agregar
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="text-sm font-black text-slate-900">{formatMoney(receipt.amount)}</span>
                  </label>
                );
              })}
            </div>
            <div className="mt-4">
              <Field label="Motivo de la corrección (opcional)">
                <textarea
                  className={textareaClass}
                  value={accountingClosureEditNote}
                  onChange={(event) => setAccountingClosureEditNote(event.target.value)}
                  placeholder="Ej. Se retiró una factura incluida en el corte equivocado."
                />
              </Field>
            </div>
            <ModalFooter>
              <Button type="button" variant="outline" onClick={closeEditor} disabled={submitting}>Cancelar</Button>
              <Button
                type="button"
                onClick={() => void handleUpdateAccountingClosure()}
                disabled={submitting || selectedReceipts.length === 0 || (canEditAccountingClosureDate && !accountingClosureEditDate)}
                className="bg-violet-600 font-bold text-white hover:bg-violet-700"
              >
                {submitting && <Loader2 size={16} className="mr-2 animate-spin" />}
                Guardar cierre corregido
              </Button>
            </ModalFooter>
          </ModalShell>
        );
      })()}

      {reviewAction && (
        <ModalShell
          title={
            reviewAction.type === 'deleteAdvance'
              ? 'Eliminar anticipo'
              : reviewAction.type === 'deleteReceipt'
                ? isApprovedReceipt(reviewAction.receipt)
                  ? 'Eliminar legalización aprobada'
                  : 'Eliminar soporte'
	              : reviewAction.type.includes('Receipt')
	              ? 'Devolver soporte'
	              : reviewAction.type === 'approveAdvance'
	                ? reviewAction.advance.status === 'returned'
	                  ? 'Reaprobar anticipo'
	                  : 'Aprobar anticipo'
	                : reviewAction.type === 'rejectAdvance'
	                  ? 'Rechazar anticipo'
	                  : 'Devolver anticipo'
          }
          subtitle={
            reviewAction.type === 'deleteAdvance'
              ? 'Se eliminará el anticipo y los registros administrativos asociados.'
              : reviewAction.type === 'deleteReceipt'
                ? 'Se retirará este soporte de la legalización del anticipo y se recalcularán los saldos.'
              : 'La decisión quedará en la trazabilidad administrativa.'
          }
          onClose={() => setReviewAction(null)}
        >
          {reviewAction.type === 'deleteAdvance' && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold leading-6 text-rose-700">
              Esta acción borra el anticipo, sus pagos reales y la trazabilidad administrativa relacionada. No elimina otros documentos del proyecto.
            </div>
          )}
          {reviewAction.type === 'deleteReceipt' && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold leading-6 text-rose-700">
              Se eliminará &quot;{reviewAction.receipt.fileName || reviewAction.receipt.categoryName}&quot; de las legalizaciones del anticipo. Si ya estaba aprobada, esta acción solo está permitida para el perfil administrativo.
            </div>
          )}
	          {reviewAction.type === 'approveAdvance' && (
	            <div className="space-y-3">
	              {reviewAction.advance.status === 'returned' && reviewAction.advance.approvalSignature && (
	                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold leading-5 text-emerald-700">
	                  Este anticipo fue devuelto y conserva una firma aprobadora previa. Al reaprobarlo se reutilizará esa firma sin modificar la firma del solicitante.
	                </div>
	              )}
	              <div className="grid gap-3 sm:grid-cols-2">
	                <SignatureSummary title="Firma del solicitante" signature={reviewAction.advance.requesterSignature} />
	                <SignatureSummary
	                  title={reviewAction.advance.status === 'returned' && reviewAction.advance.approvalSignature ? 'Firma aprobadora registrada' : 'Tu firma de aprobación'}
	                  signature={getApprovalSignatureForAdvance(reviewAction.advance) || undefined}
	                />
	              </div>
	            </div>
	          )}
          <Field
            label={
              reviewAction.type === 'deleteReceipt' && isApprovedReceipt(reviewAction.receipt)
                ? 'Motivo de eliminación (obligatorio)'
                : reviewAction.type === 'deleteAdvance' || reviewAction.type === 'deleteReceipt'
                  ? 'Comentario administrativo (opcional)'
                  : 'Comentario administrativo'
            }
          >
            <textarea
              className={textareaClass}
              value={reviewComment}
              onChange={(event) => setReviewComment(event.target.value)}
              placeholder={
                reviewAction.type === 'deleteAdvance'
                  ? 'Opcional: deja una nota interna antes de eliminar este anticipo.'
                  : reviewAction.type === 'deleteReceipt'
                    ? isApprovedReceipt(reviewAction.receipt)
                      ? 'Explica por qué debe eliminarse esta legalización aprobada.'
                      : 'Opcional: deja una nota interna antes de eliminar este soporte.'
                    : 'Explica la decisión, observaciones o ajustes solicitados.'
              }
            />
          </Field>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setReviewAction(null)}>Cancelar</Button>
            <Button
              type="button"
              onClick={applyReviewAction}
              disabled={submitting}
              className={
                reviewAction.type === 'deleteAdvance' || reviewAction.type === 'deleteReceipt'
                  ? 'bg-rose-600 font-bold text-white hover:bg-rose-700'
                  : 'bg-indigo-600 font-bold text-white hover:bg-indigo-700'
              }
            >
              {submitting && <Loader2 size={16} className="mr-2 animate-spin" />}
	              {reviewAction.type === 'deleteAdvance'
	                ? 'Eliminar anticipo'
	                : reviewAction.type === 'deleteReceipt'
	                  ? 'Eliminar soporte'
	                  : reviewAction.type === 'approveAdvance'
	                    ? reviewAction.advance.status === 'returned'
	                      ? 'Reaprobar'
	                      : 'Firmar y aprobar'
	                    : 'Confirmar'}
            </Button>
          </ModalFooter>
        </ModalShell>
      )}

      {pdfPasswordDialog && (
        <ModalShell
          title="PDF protegido"
          subtitle="Pixel necesita desbloquear el documento para usarlo en informes, auditorías y cierres."
          onClose={cancelPdfPassword}
          topLayer
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitPdfPassword();
            }}
          >
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white">
                  <ShieldCheck size={20} />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-slate-950">{pdfPasswordDialog.fileName}</p>
                  <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">
                    El original cifrado se conservará como evidencia. Pixel creará una copia normalizada sin contraseña para la operación diaria.
                  </p>
                </div>
              </div>
            </div>

            {pdfPasswordDialog.incorrectPassword && (
              <div className="mt-4 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
                <AlertCircle size={18} />
                La contraseña no es correcta. Inténtala nuevamente.
              </div>
            )}

            <div className="mt-4">
              <Field label="Contraseña del documento">
                <input
                  autoFocus
                  autoComplete="off"
                  className={inputClass}
                  type="password"
                  value={pdfPasswordInput}
                  onChange={(event) => setPdfPasswordInput(event.target.value)}
                  placeholder="Escribe la contraseña del PDF"
                />
              </Field>
            </div>

            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-bold leading-5 text-emerald-700">
              La contraseña se usa únicamente en este navegador durante la normalización. No se guarda en Pixel, Supabase, S3 ni en la trazabilidad.
            </div>

            <ModalFooter>
              <Button type="button" variant="outline" onClick={cancelPdfPassword}>Cancelar carga</Button>
              <Button
                type="submit"
                disabled={!pdfPasswordInput}
                className="bg-indigo-600 font-bold text-white hover:bg-indigo-700"
              >
                <ShieldCheck size={16} className="mr-2" />
                Desbloquear y continuar
              </Button>
            </ModalFooter>
          </form>
        </ModalShell>
      )}
    </div>
  );
}

function ContractorAccountsWorkspace({
  accounts,
  allAccounts,
  view,
  onViewChange,
  search,
  onSearchChange,
  stageFilter,
  onStageFilterChange,
  sort,
  onSortChange,
  showPaid,
  onTogglePaid,
  hiddenPaidCount,
  canValidate,
  canManage,
  canCreate,
  canReassignContractor,
  canGlobalAdminManage,
  canActOnAccount,
  getApproverLabel,
  canEditReturnedAccount,
  onNew,
  onEdit,
  onAction,
  onDownloadGenerated,
}: {
  accounts: ContractorPaymentRequest[];
  allAccounts: ContractorPaymentRequest[];
  view: ContractorAccountView;
  onViewChange: (view: ContractorAccountView) => void;
  search: string;
  onSearchChange: (value: string) => void;
  stageFilter: ContractorAccountStageFilter;
  onStageFilterChange: (value: ContractorAccountStageFilter) => void;
  sort: ContractorAccountSort;
  onSortChange: (value: ContractorAccountSort) => void;
  showPaid: boolean;
  onTogglePaid: () => void;
  hiddenPaidCount: number;
  canValidate: boolean;
  canManage: boolean;
  canCreate: boolean;
  canReassignContractor: boolean;
  canGlobalAdminManage: boolean;
  canActOnAccount: (account: ContractorPaymentRequest) => boolean;
  getApproverLabel: (account: ContractorPaymentRequest) => string;
  canEditReturnedAccount: (account: ContractorPaymentRequest) => boolean;
  onNew: () => void;
  onEdit: (account: ContractorPaymentRequest) => void;
  onAction: (type: 'approve' | 'return' | 'reject' | 'account' | 'pay' | 'delete' | 'reassign', account: ContractorPaymentRequest) => void;
  onDownloadGenerated: (account: ContractorPaymentRequest, kind: ContractorDownloadKind) => Promise<void>;
}) {
  const counts = {
    all: allAccounts.filter((account) => account.status !== 'rejected').length,
    approvals: allAccounts.filter((account) => ['submitted', 'boss_approved', 'operations_approved'].includes(account.status)).length,
    humanTalent: allAccounts.filter((account) => account.status === 'quality_approved').length,
    accounting: allAccounts.filter((account) => account.status === 'hr_approved').length,
    administration: allAccounts.filter((account) => account.status === 'accounted').length,
    paid: allAccounts.filter((account) => account.status === 'paid').length,
    returned: allAccounts.filter((account) => account.status === 'returned').length,
    rejected: allAccounts.filter((account) => account.status === 'rejected').length,
  };
  const getLifecycleIndex = (status: ContractorAccountStatus) => {
    if (status === 'paid') return CONTRACTOR_ACCOUNT_STEPS.length;
    if (status === 'rejected') return -1;
    const index = CONTRACTOR_ACCOUNT_STEPS.findIndex((step) => step.status === status);
    return index >= 0 ? index : 0;
  };
  const navigationItems: Array<[typeof view, string, number]> = canManage || canValidate
    ? [
        ['all', 'Cuentas de cobro', counts.all],
        ['approvals', 'Aprobaciones', counts.approvals],
        ['humanTalent', 'Talento humano', counts.humanTalent],
        ['accounting', 'Contabilidad', counts.accounting],
        ['administration', 'Administración y pago', counts.administration],
        ['returned', 'Por subsanar', counts.returned],
        ['paid', 'Pagadas', counts.paid],
        ['rejected', 'Rechazadas', counts.rejected],
      ]
    : [
        ['all', 'Mis cuentas', counts.all],
        ...(counts.approvals > 0 ? [['approvals', 'Por aprobar', counts.approvals] as [typeof view, string, number]] : []),
        ['returned', 'Por corregir', counts.returned],
        ['paid', 'Pagadas', counts.paid],
        ['rejected', 'Rechazadas', counts.rejected],
      ];
  const mineCount = allAccounts.filter((account) =>
    !['paid', 'rejected'].includes(account.status) && canActOnAccount(account)
  ).length;
  const stageFilterOptions: Array<[ContractorAccountStageFilter, string]> = [
    ['all', 'Todos los pasos'],
    ['mine', `Asignadas a mí (${mineCount})`],
    ['submitted', 'Jefe inmediato'],
    ['boss_approved', 'Gerencia de operaciones'],
    ['operations_approved', 'Calidad y cumplimiento'],
    ['quality_approved', 'Talento humano'],
    ['hr_approved', 'Contabilidad'],
    ['accounted', 'Administración y pago'],
    ['returned', 'Devueltas al contratista'],
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {navigationItems.map(([id, label, count]) => (
            <button
              key={String(id)}
              type="button"
              onClick={() => onViewChange(id as typeof view)}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-black transition ${
                view === id
                  ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-500/20'
                  : 'bg-slate-50 text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100'
              }`}
            >
              {label}
              <span className={`rounded-md px-1.5 py-0.5 text-[11px] ${view === id ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'}`}>{count}</span>
            </button>
          ))}
        </div>
        {canCreate && (
          <Button type="button" onClick={onNew} className="bg-cyan-600 font-bold text-white hover:bg-cyan-700">
            <Plus size={16} className="mr-2" />
            Nueva cuenta
          </Button>
        )}
      </div>

      <div className="rounded-xl border border-cyan-200 bg-gradient-to-r from-cyan-50 via-white to-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-cyan-900">
            <FileText size={20} />
            <div>
              <h3 className="text-lg font-black">Buscar y organizar cuentas de cobro</h3>
              <p className="text-xs font-semibold text-slate-500">Las acciones pendientes llegan a la Bandeja de entrada general. Aquí consultas el expediente y filtras por responsable o etapa.</p>
            </div>
          </div>
          <a
            href="/workflows"
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-cyan-900 px-3 text-xs font-black text-white shadow-sm transition hover:bg-cyan-800"
          >
            <Inbox size={15} />
            Abrir Bandeja de entrada
          </a>
        </div>
        <div className="mt-4 grid gap-2 lg:grid-cols-[minmax(280px,1fr)_250px_210px_auto]">
          <div className="relative min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-600" />
            <input className={`${inputClass} border-cyan-200 bg-white pl-10`} value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Buscar por ID, contratista, correo, tarea o estado..." />
          </div>
          <select
            className={`${inputClass} border-cyan-100 bg-white`}
            value={stageFilter}
            onChange={(event) => onStageFilterChange(event.target.value as ContractorAccountStageFilter)}
            aria-label="Filtrar cuentas por paso"
          >
            {stageFilterOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select
            className={`${inputClass} border-cyan-100 bg-white`}
            value={sort}
            onChange={(event) => onSortChange(event.target.value as ContractorAccountSort)}
            aria-label="Ordenar cuentas"
          >
            <option value="recent">Más recientes primero</option>
            <option value="oldest">Más antiguas primero</option>
            <option value="amount_desc">Mayor valor primero</option>
          </select>
          <button
            type="button"
            aria-pressed={showPaid}
            onClick={onTogglePaid}
            className={`inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg px-3 text-xs font-black ring-1 transition ${
              showPaid ? 'bg-teal-600 text-white ring-teal-600' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {showPaid ? <EyeOff size={15} /> : <Eye size={15} />}
            {showPaid ? 'Ocultar pagadas' : `Mostrar pagadas${hiddenPaidCount ? ` (${hiddenPaidCount})` : ''}`}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onStageFilterChange(stageFilter === 'mine' ? 'all' : 'mine')}
            className={`rounded-lg px-3 py-2 text-xs font-black ring-1 transition ${
              stageFilter === 'mine'
                ? 'bg-cyan-600 text-white ring-cyan-600'
                : 'bg-white text-cyan-800 ring-cyan-200 hover:bg-cyan-50'
            }`}
          >
            Asignadas a mí · {mineCount}
          </button>
          {CONTRACTOR_ACCOUNT_STEPS.map((step) => (
            <button
              key={step.status}
              type="button"
              onClick={() => onStageFilterChange(stageFilter === step.status ? 'all' : step.status)}
              className={`rounded-lg px-3 py-2 text-xs font-black ring-1 transition ${
                stageFilter === step.status
                  ? 'bg-slate-900 text-white ring-slate-900'
                  : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {step.shortLabel} · {allAccounts.filter((account) => account.status === step.status).length}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onStageFilterChange(stageFilter === 'returned' ? 'all' : 'returned')}
            className={`rounded-lg px-3 py-2 text-xs font-black ring-1 transition ${
              stageFilter === 'returned'
                ? 'bg-orange-600 text-white ring-orange-600'
                : 'bg-orange-50 text-orange-700 ring-orange-200 hover:bg-orange-100'
            }`}
          >
            Por subsanar · {counts.returned}
          </button>
        </div>
      </div>

      {accounts.length === 0 ? (
        <EmptyState
          title={search.trim() ? 'No encontramos cuentas de cobro' : 'Sin cuentas de cobro registradas'}
          body={search.trim() ? 'Ajusta el término de búsqueda o cambia de pestaña.' : 'Cuando un contratista radique su cuenta de cobro aparecerá aquí con sus documentos y ciclo de aprobación.'}
        />
      ) : (
        <div className="space-y-3">
          {accounts.map((account) => {
            const statusMeta = CONTRACTOR_ACCOUNT_STATUS_META[account.status] || CONTRACTOR_ACCOUNT_STATUS_META.submitted;
            const nextStatus = getContractorAccountApprovalTarget(account, canGlobalAdminManage);
            const canAct = canActOnAccount(account);
            const canApprove = (canAct || canGlobalAdminManage) && Boolean(nextStatus) && !['hr_approved', 'accounted', 'paid', 'rejected'].includes(account.status);
            const canAccount = (canAct || canGlobalAdminManage) && account.status === 'hr_approved';
            const canPay = (canAct || canGlobalAdminManage) && account.status === 'accounted';
            const canEditReturned = canEditReturnedAccount(account);
            const canEditAccount = canGlobalAdminManage || canEditReturned;
            const lifecycleIndex = getLifecycleIndex(account.status);
            const currentStep = lifecycleIndex >= 0 && lifecycleIndex < CONTRACTOR_ACCOUNT_STEPS.length
              ? CONTRACTOR_ACCOUNT_STEPS[lifecycleIndex]
              : null;
            const approverLabel = getApproverLabel(account);
            const isReturned = account.status === 'returned';
            const activityCount = account.activityItems?.length || account.taskIds?.length || 0;
            const completedActivityCount = account.performanceSnapshot?.selectedCompleted || account.activitySnapshot?.completedTasks || 0;
            const openActivityCount = account.activitySnapshot?.activeTasks || 0;
            const alertCount = account.performanceSnapshot?.alerts?.length || account.activitySnapshot?.overdueTasks || 0;
            const documentCount = (account.documents?.length || 0) + (account.generatedDocuments?.length || 0) + (account.paymentSupport ? 1 : 0);
            const signatureCount = (account.requesterSignature ? 1 : 0) + (account.approvals || []).filter((approval) => Boolean(approval.signature)).length;
            const traceEvents = [
              ...(account.submittedAt || account.createdAt ? [{
                key: `${account.id}-submitted`,
                label: 'Cuenta radicada',
                actor: account.createdByName || account.contractorName,
                at: account.submittedAt || account.createdAt,
                comment: 'Enviada al ciclo de aprobación.',
                tone: 'cyan' as const,
              }] : []),
              ...(account.approvals || []).map((approval, approvalIndex) => ({
                key: `${account.id}-approval-${approval.stage}-${approval.at}-${approvalIndex}`,
                label: `${CONTRACTOR_ACCOUNT_APPROVAL_LABELS[approval.stage] || CONTRACTOR_ACCOUNT_STATUS_META[approval.stage]?.label || approval.stage}${approval.performedByGlobalAdmin ? ' · Administrador Global' : ''}`,
                actor: approval.actorName || approval.actorEmail || 'Responsable sin nombre',
                at: approval.at,
                comment: approval.comment || 'Aprobación registrada sin observaciones.',
                tone: 'emerald' as const,
              })),
              ...(account.administrativeEditHistory || []).map((entry, editIndex) => ({
                key: `${account.id}-global-admin-edit-${entry.at}-${editIndex}`,
                label: 'Cuenta editada por Administrador Global',
                actor: entry.actorName || entry.actorEmail || 'Administrador Global',
                at: entry.at,
                comment: entry.changedFields.length > 0
                  ? `Campos actualizados: ${entry.changedFields.join(', ')}. Estado conservado: ${CONTRACTOR_ACCOUNT_STATUS_META[entry.preservedStatus]?.label || entry.preservedStatus}.`
                  : `Revisión administrativa guardada sin cambios de contenido. Estado conservado: ${CONTRACTOR_ACCOUNT_STATUS_META[entry.preservedStatus]?.label || entry.preservedStatus}.`,
                tone: 'slate' as const,
              })),
              ...(account.returnHistory || []).map((entry, returnIndex) => ({
                key: `${account.id}-return-${entry.at}-${returnIndex}`,
                label: `Devuelta desde ${CONTRACTOR_ACCOUNT_STATUS_META[entry.fromStage]?.label || entry.fromStage}`,
                actor: entry.actorName || 'Responsable sin nombre',
                at: entry.at,
                comment: entry.comment || 'Devuelta para subsanar.',
                tone: 'orange' as const,
              })),
              ...(account.resubmissionHistory || []).map((entry, resubmissionIndex) => ({
                key: `${account.id}-resubmission-${entry.at}-${resubmissionIndex}`,
                label: entry.kind === 'global_reactivation'
                  ? 'Cuenta reactivada por Administrador Global'
                  : 'Cuenta corregida y reenviada',
                actor: entry.actorName || account.contractorName,
                at: entry.at,
                comment: entry.comment || (entry.kind === 'global_reactivation'
                  ? `Reactivada en ${CONTRACTOR_ACCOUNT_STATUS_META[entry.targetStage]?.label || entry.targetStage}; la etapa quedó pendiente para su responsable vigente.`
                  : 'Reenviada al jefe inmediato para una nueva revisión.'),
                tone: 'cyan' as const,
              })),
              ...(account.reassignmentHistory || []).map((entry, reassignmentIndex) => ({
                key: `${account.id}-reassignment-${entry.at}-${reassignmentIndex}`,
                label: 'Persona asociada actualizada',
                actor: entry.actorName || 'Administrador',
                at: entry.at,
                comment: `${entry.fromContractorName || 'Sin asignar'} → ${entry.toContractorName}${entry.comment ? ` · ${entry.comment}` : ''}`,
                tone: 'slate' as const,
              })),
              ...(account.approvalRouteReassignmentHistory || []).map((entry, reassignmentIndex) => ({
                key: `${account.id}-approval-route-reassignment-${entry.at}-${reassignmentIndex}`,
                label: `Responsable de ${CONTRACTOR_ACCOUNT_STEPS.find((step) => step.status === entry.stage)?.label || entry.stage} actualizado`,
                actor: entry.actorName || entry.actorEmail || 'Administrador',
                at: entry.at,
                comment: `${entry.fromApproverName || 'Sin responsable'} → ${entry.toApproverName || 'Sin responsable'} · ${
                  entry.scope === 'organization'
                    ? 'Ruta global'
                    : entry.scope === 'user_reassignment'
                      ? `Reasignación integral${entry.reason ? `: ${entry.reason}` : ''}`
                      : 'Ruta del proyecto'
                }`,
                tone: 'cyan' as const,
              })),
              ...(account.returnedAt && !(account.returnHistory || []).length ? [{
                key: `${account.id}-legacy-return`,
                label: 'Cuenta devuelta para subsanar',
                actor: account.returnedByName || 'Responsable sin nombre',
                at: account.returnedAt,
                comment: account.returnComment || 'Sin observación registrada.',
                tone: 'orange' as const,
              }] : []),
              ...(account.rejectedAt ? [{
                key: `${account.id}-rejected`,
                label: 'Cuenta rechazada',
                actor: account.rejectedByName || 'Responsable sin nombre',
                at: account.rejectedAt,
                comment: account.returnComment || 'Sin observación registrada.',
                tone: 'rose' as const,
              }] : []),
            ].sort((left, right) => (getDateValue(right.at)?.getTime() || 0) - (getDateValue(left.at)?.getTime() || 0));
            return (
              <section key={account.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md">
                <div className="border-b border-slate-100 bg-slate-50/80 p-3 sm:p-4">
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ring-1 ${statusMeta.className}`}>
                        {statusMeta.label}
                      </span>
                      {account.customId && <span className="rounded-md bg-slate-900 px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-white">ID {account.customId}</span>}
                      <span className="rounded-md bg-cyan-50 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-cyan-700 ring-1 ring-cyan-100">
                        {documentCount} documentos
                      </span>
                      </div>
                      <div className="mt-2 flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                        <h4 className="truncate text-lg font-black text-slate-950">{account.contractorName}</h4>
                        <p className="truncate text-xs font-bold text-slate-500">
                          {formatDate(account.periodStart)} - {formatDate(account.periodEnd)} · {account.contractorEmail || 'Sin correo'}
                        </p>
                      </div>
                      {account.returnComment && ['returned', 'rejected'].includes(account.status) && (
                        <p className={`mt-2 line-clamp-2 rounded-lg px-3 py-2 text-xs font-bold ${
                          account.status === 'rejected'
                            ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-100'
                            : 'bg-orange-50 text-orange-700 ring-1 ring-orange-100'
                        }`}>
                          {account.status === 'rejected' ? 'Motivo del rechazo: ' : 'Observación de devolución: '}
                          {account.returnComment}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col gap-2 xl:items-end">
                      <div className={`flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2 ${
                        isReturned
                          ? 'border-orange-200 bg-orange-50 text-orange-800'
                          : canAct
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                            : currentStep
                              ? 'border-cyan-200 bg-cyan-50 text-cyan-800'
                              : 'border-slate-200 bg-white text-slate-600'
                      }`}>
                        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-black ${
                          isReturned ? 'bg-orange-500 text-white' : canAct ? 'bg-emerald-600 text-white' : currentStep ? 'bg-cyan-600 text-white' : 'bg-slate-200 text-slate-600'
                        }`}>
                          {currentStep ? lifecycleIndex + 1 : <CheckCircle2 size={14} />}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-[10px] font-black uppercase tracking-[0.14em]">
                            {isReturned ? 'Debe subsanar' : canAct ? 'Acción pendiente contigo' : currentStep?.label || statusMeta.label}
                          </p>
                          <p className="max-w-[280px] truncate text-[11px] font-semibold" title={approverLabel}>
                            {isReturned ? `Próxima aprobación: ${approverLabel}` : `Responsable: ${approverLabel}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 xl:justify-end">
                        {canEditAccount && (
                          <Button type="button" size="sm" onClick={() => onEdit(account)} className={canGlobalAdminManage ? 'bg-cyan-700 text-white hover:bg-cyan-800' : 'bg-orange-600 text-white hover:bg-orange-700'}>
                            <PencilLine size={14} className="mr-2" />
                            {canGlobalAdminManage ? 'Editar / completar' : 'Corregir y reenviar al jefe'}
                          </Button>
                        )}
                        {canApprove && (
                          <Button type="button" size="sm" onClick={() => onAction('approve', account)} className="bg-emerald-600 text-white hover:bg-emerald-700">
                            <CheckCircle2 size={14} className="mr-2" />
                            {canGlobalAdminManage && account.status === 'returned'
                              ? `Reactivar en ${CONTRACTOR_ACCOUNT_STEPS.find((step) => step.status === nextStatus)?.shortLabel || 'paso pendiente'}`
                              : 'Aprobar'}
                          </Button>
                        )}
                        {canAccount && (
                          <Button type="button" size="sm" onClick={() => onAction('account', account)} className="bg-violet-600 text-white hover:bg-violet-700">
                            <ReceiptText size={14} className="mr-2" />
                            Contabilizar
                          </Button>
                        )}
                        {canPay && (
                          <Button type="button" size="sm" onClick={() => onAction('pay', account)} className="bg-cyan-600 text-white hover:bg-cyan-700">
                            <CreditCard size={14} className="mr-2" />
                            Pagar
                          </Button>
                        )}
                        {canAct && !['paid', 'rejected', 'returned'].includes(account.status) && (
                          <>
                            <Button type="button" size="sm" variant="outline" onClick={() => onAction('return', account)} className="border-orange-200 text-orange-700 hover:bg-orange-50">
                              <RotateCcw size={14} className="mr-2" />
                              Devolver
                            </Button>
                            <Button type="button" size="sm" variant="outline" onClick={() => onAction('reject', account)} className="border-rose-200 text-rose-700 hover:bg-rose-50">
                              Rechazar
                            </Button>
                          </>
                        )}
                        {canReassignContractor && (
                          <Button type="button" size="sm" variant="outline" onClick={() => onAction('reassign', account)} className="border-cyan-200 text-cyan-700 hover:bg-cyan-50">
                            <PencilLine size={14} className="mr-2" />
                            Cambiar persona
                          </Button>
                        )}
                        {canManage && (
                          <Button type="button" size="sm" variant="outline" onClick={() => onAction('delete', account)} className="border-rose-200 text-rose-700 hover:bg-rose-50">
                            <Trash2 size={14} className="mr-2" />
                            Eliminar
                          </Button>
                        )}
                        {!canAct && !canEditAccount && !['paid', 'rejected'].includes(account.status) && (
                          <span className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-500">
                            Solo consulta
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto border-b border-slate-100 bg-white px-3 py-2.5 sm:px-4">
                  <div className="flex min-w-max items-center">
                    {CONTRACTOR_ACCOUNT_STEPS.map((step, index) => {
                      const isDone = lifecycleIndex > index || account.status === 'paid';
                      const isActive = lifecycleIndex === index && !['paid', 'rejected'].includes(account.status);
                      const isBlocked = account.status === 'returned' || account.status === 'rejected';
                      return (
                        <React.Fragment key={step.status}>
                          <div className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${
                            isBlocked
                              ? 'bg-orange-50 text-orange-700'
                              : isDone
                                ? 'text-emerald-700'
                                : isActive
                                  ? 'bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200'
                                  : 'text-slate-400'
                          }`}>
                            <span className={`grid h-6 w-6 place-items-center rounded-full text-[10px] font-black ${
                              isDone ? 'bg-emerald-600 text-white' : isActive ? 'bg-cyan-600 text-white' : 'bg-slate-100 text-slate-400'
                            }`}>
                              {isDone ? <CheckCircle2 size={13} /> : index + 1}
                            </span>
                            <span className="text-[10px] font-black uppercase tracking-[0.12em]">{step.shortLabel}</span>
                          </div>
                          {index < CONTRACTOR_ACCOUNT_STEPS.length - 1 && <ChevronRight size={14} className="mx-1 shrink-0 text-slate-300" />}
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>

                <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-4">
                  <ReceiptGroupMetric label="Honorarios" value={formatMoney(account.honorariumAmount)} tone="slate" />
                  <ReceiptGroupMetric label="Actividades incluidas" value={`${activityCount}`} tone="emerald" />
                  <ReceiptGroupMetric label="Calidad limpia" value={account.qualitySnapshot?.score === null || account.qualitySnapshot?.score === undefined ? 'Sin dato' : `${account.qualitySnapshot.score}%`} tone={account.qualitySnapshot?.rejected ? 'rose' : account.qualitySnapshot?.acceptedWithObservations ? 'amber' : 'emerald'} />
                  <ReceiptGroupMetric label="Alertas del periodo" value={`${alertCount}`} tone={alertCount ? 'amber' : 'emerald'} />
                </div>

                <div className="space-y-2 border-t border-slate-100 p-3">
                  <details className="group rounded-xl border border-slate-200 bg-white">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                      <div className="min-w-0">
                        <p className="text-xs font-black text-slate-800">Resumen del periodo y documentos</p>
                        <p className="mt-0.5 truncate text-[11px] font-semibold text-slate-500">
                          {activityCount} registros incluidos · {completedActivityCount} finalizadas · {openActivityCount} abiertas · {documentCount} documentos
                        </p>
                      </div>
                      <ChevronDown size={16} className="shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="grid gap-4 border-t border-slate-100 p-3 xl:grid-cols-[minmax(0,1fr)_360px]">
                    <div>
                      <div className="grid gap-3 lg:grid-cols-2">
                        <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-3">
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700">Calidad del periodo</p>
                          <div className="mt-2 grid grid-cols-4 gap-2">
                            <ReceiptGroupMetric label="Revisadas" value={`${account.qualitySnapshot?.reviewed || 0}`} tone="slate" />
                            <ReceiptGroupMetric label="Sin obs." value={`${account.qualitySnapshot?.cleanAccepted ?? Math.max(0, (account.qualitySnapshot?.accepted || 0) - (account.qualitySnapshot?.acceptedWithObservations || 0))}`} tone="emerald" />
                            <ReceiptGroupMetric label="Obs." value={`${account.qualitySnapshot?.acceptedWithObservations || 0}`} tone={account.qualitySnapshot?.acceptedWithObservations ? 'amber' : 'slate'} />
                            <ReceiptGroupMetric label="Rechazos" value={`${account.qualitySnapshot?.rejected || 0}`} tone={account.qualitySnapshot?.rejected ? 'rose' : 'slate'} />
                          </div>
                          {(account.qualitySnapshot?.events || []).length > 0 && (
                            <div className="mt-2 space-y-1 text-xs font-semibold text-slate-500">
                              <p className="truncate">Última revisión: {account.qualitySnapshot?.events?.[0]?.taskTitle || 'Sin tarea'} · {formatDate(account.qualitySnapshot?.events?.[0]?.date)}</p>
                              {account.qualitySnapshot?.events?.[0]?.causeLabel && (
                                <p className="line-clamp-2 text-amber-700">Errores: {account.qualitySnapshot.events[0].causeLabel}</p>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 p-3">
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-indigo-700">Rates del periodo</p>
                          <div className="mt-2 grid grid-cols-3 gap-2">
                            <ReceiptGroupMetric label="Mov." value={`${account.rateSnapshot?.movements || account.activitySnapshot?.rateMovements || 0}`} tone="slate" />
                            <ReceiptGroupMetric label="Ingreso" value={formatMoney(account.rateSnapshot?.income || account.activitySnapshot?.rateIncome || 0)} tone="emerald" />
                            <ReceiptGroupMetric label="Costo" value={formatMoney(account.rateSnapshot?.cost || account.activitySnapshot?.rateCost || 0)} tone="rose" />
                          </div>
                          {(account.rateSnapshot?.rows || []).length > 0 && (
                            <p className="mt-2 truncate text-xs font-semibold text-slate-500">
                              Principal: {account.rateSnapshot?.rows?.[0]?.name} · {formatMoney(account.rateSnapshot?.rows?.[0]?.income || 0)}
                            </p>
                          )}
                        </div>
                        <div className={`rounded-lg border p-3 ${
                          account.performanceSnapshot?.alerts?.length
                            ? 'border-amber-200 bg-amber-50/70'
                            : 'border-teal-100 bg-teal-50/60'
                        }`}>
                          <p className={`text-[10px] font-black uppercase tracking-[0.18em] ${
                            account.performanceSnapshot?.alerts?.length ? 'text-amber-700' : 'text-teal-700'
                          }`}>Cumplimiento del cronograma</p>
                          <div className="mt-2 grid grid-cols-3 gap-2">
                            <ReceiptGroupMetric label="A tiempo" value={`${account.performanceSnapshot?.completedOnTime || 0}`} tone="emerald" />
                            <ReceiptGroupMetric label="Tardías" value={`${account.performanceSnapshot?.completedLate || 0}`} tone={account.performanceSnapshot?.completedLate ? 'amber' : 'slate'} />
                            <ReceiptGroupMetric label="Vencidas" value={`${account.performanceSnapshot?.openOverdue || 0}`} tone={account.performanceSnapshot?.openOverdue ? 'rose' : 'slate'} />
                          </div>
                        </div>
                        <div className="rounded-lg border border-violet-100 bg-violet-50/60 p-3">
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-700">Comparativo por cargo</p>
                          <p className="mt-2 truncate text-xs font-black text-slate-700">
                            {account.productivityComparison?.roleLabel || account.requesterSignature?.jobTitle || 'Sin cargo'}
                          </p>
                          {(account.productivityComparison?.rows || []).length > 0 ? (
                            <p className="mt-1 truncate text-xs font-semibold text-slate-500">
                              {account.productivityComparison?.rows?.[0]?.name}: puesto #{account.productivityComparison?.rows?.[0]?.contractorRank} de {account.productivityComparison?.rows?.[0]?.professionalCount}
                            </p>
                          ) : (
                            <p className="mt-1 text-xs font-semibold text-slate-500">Sin rates para comparar en el periodo.</p>
                          )}
                        </div>
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Documentos soporte</p>
                      <div className="mt-2 space-y-2">
                        <button
                          type="button"
                          onClick={() => onDownloadGenerated(account, 'completeDossier')}
                          className="flex w-full items-center justify-between gap-3 rounded-lg bg-slate-950 px-3 py-2.5 text-left text-xs font-black text-white ring-1 ring-slate-900 hover:bg-slate-800"
                        >
                          <span className="min-w-0 truncate">Expediente completo en PDF</span>
                          <span className="shrink-0 text-cyan-200">Cuenta + informe + parafiscales</span>
                        </button>
                        {(account.generatedDocuments || []).map((document) => (
                          <button
                            key={`${account.id}-${document.kind}`}
                            type="button"
                            onClick={() => onDownloadGenerated(account, document.kind)}
                            className="flex w-full items-center justify-between gap-3 rounded-lg bg-cyan-50 px-3 py-2 text-left text-xs font-black text-cyan-700 ring-1 ring-cyan-100 hover:bg-cyan-100"
                          >
                            <span className="min-w-0 truncate">{document.label}</span>
                            <span className="shrink-0 text-cyan-500">Descargar</span>
                          </button>
                        ))}
                        {(account.documents || []).map((document) => (
                          <SecureDocumentLink key={document.documentId} storagePath={document.storagePath} fallbackUrl={document.fileUrl} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-xs font-black text-indigo-700 ring-1 ring-slate-200 hover:bg-indigo-50">
                            <span className="min-w-0 truncate">{document.label}</span>
                            <span className="shrink-0 text-slate-400">{formatSupportFileSize(document.fileSize)}</span>
                          </SecureDocumentLink>
                        ))}
                        {account.paymentSupport && (
                          <SecureDocumentLink storagePath={account.paymentSupport.storagePath} fallbackUrl={account.paymentSupport.fileUrl} className="flex items-center justify-between gap-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 ring-1 ring-emerald-100 hover:bg-emerald-100">
                            <span>Soporte de pago</span>
                            <span className="text-emerald-500">{formatDate(account.paidAt)}</span>
                          </SecureDocumentLink>
                        )}
                      </div>
                    </div>
                    </div>
                  </details>

                  <details className="group rounded-xl border border-slate-200 bg-white">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                      <div className="min-w-0">
                        <p className="text-xs font-black text-slate-800">Trazabilidad y firmas</p>
                        <p className="mt-0.5 truncate text-[11px] font-semibold text-slate-500">
                          {traceEvents.length} eventos · {(account.approvals || []).length} aprobaciones · {signatureCount} firmas verificables
                        </p>
                      </div>
                      <ChevronDown size={16} className="shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="grid gap-4 border-t border-slate-100 p-3 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.85fr)]">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Historial de la cuenta</p>
                        {traceEvents.length > 0 ? (
                          <div className="mt-2 overflow-hidden rounded-lg border border-slate-200">
                            {traceEvents.map((event, eventIndex) => (
                              <div key={event.key} className={`flex gap-3 px-3 py-2.5 ${eventIndex > 0 ? 'border-t border-slate-100' : ''}`}>
                                <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                                  event.tone === 'emerald'
                                    ? 'bg-emerald-500'
                                    : event.tone === 'orange'
                                      ? 'bg-orange-500'
                                      : event.tone === 'rose'
                                        ? 'bg-rose-500'
                                        : event.tone === 'cyan'
                                          ? 'bg-cyan-500'
                                          : 'bg-slate-400'
                                }`} />
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                                    <p className="text-xs font-black text-slate-800">{event.label}</p>
                                    <time className="text-[10px] font-semibold text-slate-400">{formatDateTime(event.at)}</time>
                                  </div>
                                  <p className="mt-0.5 text-[11px] font-bold text-slate-500">{event.actor}</p>
                                  <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-600">{event.comment}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">Esta cuenta todavía no tiene eventos históricos disponibles.</p>
                        )}
                      </div>
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Firmas verificadas</p>
                        <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                          {account.requesterSignature && (
                            <SignatureSummary title="Firma del contratista" signature={account.requesterSignature} />
                          )}
                          {(account.approvals || []).map((approval, approvalIndex) => (
                            <SignatureSummary
                              key={`${account.id}-${approval.stage}-${approval.at}-${approvalIndex}`}
                              title={CONTRACTOR_ACCOUNT_APPROVAL_LABELS[approval.stage] || CONTRACTOR_ACCOUNT_STATUS_META[approval.stage]?.label || approval.stage}
                              signature={approval.signature}
                              fallbackName={approval.actorName}
                              fallbackEmail={approval.actorEmail || undefined}
                              signedAt={approval.at}
                            />
                          ))}
                          {!account.requesterSignature && !(account.approvals || []).length && (
                            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">Aún no hay firmas registradas.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </details>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-black uppercase tracking-[0.16em] text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function SignatureSummary({
  title,
  signature,
  fallbackName,
  fallbackEmail,
  signedAt,
}: {
  title: string;
  signature?: AdvanceSignatureSnapshot;
  fallbackName?: string;
  fallbackEmail?: string;
  signedAt?: string;
}) {
  const [authorizedImage, setAuthorizedImage] = useState({ path: '', url: '' });

  useEffect(() => {
    let active = true;
    if (!signature?.signatureStoragePath) {
      return () => { active = false; };
    }
    void getAuthorizedDownloadURL(ref(storage, signature.signatureStoragePath))
      .then((url) => { if (active) setAuthorizedImage({ path: signature.signatureStoragePath || '', url }); })
      .catch(() => { if (active) setAuthorizedImage({ path: signature.signatureStoragePath || '', url: signature.signatureUrl || '' }); });
    return () => { active = false; };
  }, [signature?.signatureStoragePath, signature?.signatureUrl]);
  const authorizedImageUrl = signature?.signatureStoragePath && authorizedImage.path === signature.signatureStoragePath
    ? authorizedImage.url
    : signature?.signatureUrl || '';

  return (
    <div className={`rounded-lg border p-3 ${signature ? 'border-indigo-200 bg-indigo-50/50' : 'border-slate-200 bg-slate-50'}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{title}</p>
      {signature ? (
        <>
          <div className="mt-2 flex h-16 items-center justify-center rounded-md bg-white p-1 ring-1 ring-indigo-100">
            {authorizedImageUrl ? <Image src={authorizedImageUrl} alt={title} width={220} height={64} className="max-h-14 w-auto object-contain" unoptimized /> : <PencilLine size={22} className="text-slate-300" />}
          </div>
          <p className="mt-2 truncate text-xs font-black text-slate-900">{signature.name}</p>
          <p className="truncate text-[11px] font-semibold text-slate-500">{signature.jobTitle}</p>
          <p className="truncate text-[11px] text-slate-500">{signature.email}</p>
        </>
      ) : (
        <div className="mt-3">
          {fallbackName && <p className="truncate text-xs font-black text-slate-700">{fallbackName}</p>}
          {fallbackEmail && <p className="truncate text-[11px] text-slate-500">{fallbackEmail}</p>}
          {signedAt && <p className="mt-1 text-[11px] font-semibold text-slate-500">Aprobó el {formatDate(signedAt)}</p>}
          <p className="mt-1 text-xs font-semibold text-amber-600">
            {fallbackName ? 'Aprobación histórica sin imagen de firma' : 'Pendiente de firma verificable'}
          </p>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, icon, tone }: { label: string; value: string; icon: React.ReactNode; tone: 'blue' | 'indigo' | 'violet' | 'emerald' | 'amber' | 'rose' }) {
  const tones = {
    blue: 'bg-sky-400/10 text-sky-200 ring-sky-300/20',
    indigo: 'bg-indigo-400/10 text-indigo-200 ring-indigo-300/20',
    violet: 'bg-violet-400/10 text-violet-200 ring-violet-300/20',
    emerald: 'bg-emerald-400/10 text-emerald-200 ring-emerald-300/20',
    amber: 'bg-amber-400/10 text-amber-200 ring-amber-300/20',
    rose: 'bg-rose-400/10 text-rose-200 ring-rose-300/20',
  };
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">{label}</p>
        <span className={`rounded-lg p-1.5 ring-1 ${tones[tone]}`}>{icon}</span>
      </div>
      <p className="mt-2 text-xl font-black tracking-tight text-white">{value}</p>
    </div>
  );
}

function ReceiptGroupMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'slate' | 'indigo' | 'emerald' | 'amber' | 'rose';
}) {
  const tones = {
    slate: 'border-slate-200 bg-white text-slate-950',
    indigo: 'border-indigo-200 bg-indigo-50 text-indigo-800',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    rose: 'border-rose-200 bg-rose-50 text-rose-800',
  };

  return (
    <div className={`min-w-0 rounded-lg border px-3 py-2 ${tones[tone]}`}>
      <p className="truncate text-[9px] font-black uppercase tracking-[0.16em] opacity-70">{label}</p>
      <p className="mt-1 truncate text-sm font-black" title={value}>{value}</p>
    </div>
  );
}

function AdvanceReportMenu({
  advance,
  onSelect,
  dark = false,
}: {
  advance: TravelAdvance;
  onSelect: (scope: AdvanceReportScope) => void;
  dark?: boolean;
}) {
  const reportAvailability = getAdvanceReportAvailability(advance);

  return (
    <label
      className={`relative inline-flex h-9 items-center overflow-hidden rounded-md border text-sm font-bold shadow-sm transition focus-within:ring-2 focus-within:ring-indigo-300 ${
        dark
          ? 'border-slate-950 bg-slate-950 text-white hover:bg-slate-800'
          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
      }`}
    >
      <Download size={15} className="pointer-events-none absolute left-3" />
      <select
        defaultValue=""
        aria-label="Generar reporte del anticipo"
        onChange={(event) => {
          const scope = event.target.value as AdvanceReportScope;
          if (scope) onSelect(scope);
          event.currentTarget.value = '';
        }}
        className="h-full cursor-pointer appearance-none bg-transparent py-0 pl-9 pr-8 text-sm font-bold outline-none"
      >
        <option value="" disabled>Generar reporte</option>
        <option value="advance">Informe del anticipo</option>
        {reportAvailability.payment && <option value="payment">Anticipo con pago</option>}
        {reportAvailability.justifications && <option value="justifications">Anticipo con legalizaciones</option>}
        {reportAvailability.partialClose && <option value="partialClose">Cierre parcial</option>}
        {reportAvailability.reconciliation && <option value="reconciliation">Anticipo con conciliación</option>}
        {reportAvailability.full && <option value="full">Informe final</option>}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2.5" />
    </label>
  );
}

function SummaryLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-white/70 px-3 py-2 ring-1 ring-slate-200">
      <span className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{label}</span>
      <span className={`text-sm ${strong ? 'font-black text-slate-950' : 'font-bold text-slate-600'}`}>{value}</span>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center">
      <ClipboardCheck className="mx-auto h-10 w-10 text-slate-300" />
      <h3 className="mt-3 text-lg font-black text-slate-900">{title}</h3>
      <p className="mx-auto mt-1 max-w-xl text-sm font-medium text-slate-500">{body}</p>
    </div>
  );
}

function ModalShell({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
  topLayer = false,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  topLayer?: boolean;
}) {
  return (
    <div className={`fixed inset-0 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm ${topLayer ? 'z-[70]' : 'z-50'}`}>
      <div className={`max-h-[92vh] w-full overflow-hidden rounded-2xl bg-white shadow-2xl ${wide ? 'max-w-6xl' : 'max-w-2xl'}`}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-2xl font-black tracking-tight text-slate-950">{title}</h2>
            {subtitle && <p className="mt-1 text-sm font-semibold text-slate-500">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
            <X size={20} />
          </button>
        </div>
        <div className="max-h-[calc(92vh-88px)] overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

function ModalFooter({ children }: { children: React.ReactNode }) {
  return <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">{children}</div>;
}

function LocalFilePreview({ file }: { file: File }) {
  const [objectUrl] = useState(() => URL.createObjectURL(file));
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const isImage = file.type.startsWith('image/');

  useEffect(() => () => URL.revokeObjectURL(objectUrl), [objectUrl]);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3">
        <div className="min-w-0"><p className="truncate text-sm font-black text-slate-900">{file.name}</p><p className="text-xs font-semibold text-slate-500">{isPdf ? 'Documento PDF' : isImage ? 'Imagen' : file.type || 'Archivo'} · {formatSupportFileSize(file.size)}</p></div>
        <a href={objectUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-black text-indigo-700 transition hover:bg-indigo-50"><ExternalLink size={14} />Abrir en otra pestaña</a>
      </div>
      {isPdf ? (
        <iframe src={`${objectUrl}#toolbar=1&navpanes=0`} title={`Previsualización de ${file.name}`} className="h-[68vh] min-h-[480px] w-full bg-white" />
      ) : isImage ? (
        <div className="h-[68vh] min-h-[420px] w-full bg-contain bg-center bg-no-repeat" style={{ backgroundImage: `url(${JSON.stringify(objectUrl)})` }} role="img" aria-label={`Previsualización de ${file.name}`} />
      ) : (
        <div className="flex min-h-80 flex-col items-center justify-center p-8 text-center"><FileText size={42} className="text-slate-300" /><p className="mt-3 text-sm font-black text-slate-700">Este formato no tiene previsualización integrada.</p><p className="mt-1 text-xs font-semibold text-slate-500">Puedes abrirlo en otra pestaña para revisarlo.</p></div>
      )}
    </div>
  );
}

function AdvanceLifecycle({ advance, compact = false }: { advance: TravelAdvance; compact?: boolean }) {
  const receipts = advance.receipts || [];
  const allLegalizationsReviewed = receipts.length > 0 && receipts.every(isReceiptAdministrativelyReviewed);
  const invoiceReceipts = receipts.filter(isInvoiceReceipt);
  const dianAuditComplete = invoiceReceipts.length === 0 || invoiceReceipts.every((receipt) => receipt.status === 'audit_passed' || isApprovedReceipt(receipt));
  const requesterClosed = Boolean(advance.completedAt) && ['completed', 'closed'].includes(advance.status);
  const reconciled = advance.reconciliationStatus === 'reconciled';
  const paymentSummary = getAdvancePaymentSummary(advance);
  const steps = [
    { label: 'Creación', complete: true },
    { label: 'Aprobación', complete: Boolean(advance.approvalSignature) || ['pending_payment', 'partially_paid', 'paid', 'approved', 'completed', 'closed'].includes(advance.status) },
    { label: paymentSummary.isPartiallyPaid ? `Por pagar ${paymentSummary.progress}%` : 'Por pagar', complete: paymentSummary.isFullyPaid || ['paid', 'approved', 'completed', 'closed'].includes(advance.status) },
    { label: 'Legalizaciones', complete: allLegalizationsReviewed },
    { label: 'Auditoría DIAN', complete: receipts.length > 0 && dianAuditComplete },
    { label: 'Cierre funcionario', complete: requesterClosed },
    { label: 'Conciliación', complete: reconciled },
    { label: 'Informe final', complete: reconciled && advance.status === 'closed' },
  ];
  const activeIndex = steps.findIndex((step) => !step.complete);

  return (
    <div className={`overflow-x-auto border-t border-slate-100 bg-white ${compact ? 'px-3 py-2.5' : 'px-4 py-3'}`} aria-label="Ciclo de vida del anticipo">
      <div className="grid min-w-[920px] grid-cols-8">
        {steps.map((step, index) => {
          const active = index === activeIndex;
          return (
            <div key={step.label} className="relative flex min-w-0 flex-col items-center text-center">
              {index > 0 && <span className={`absolute right-1/2 top-3 h-0.5 w-full ${step.complete ? 'bg-emerald-400' : 'bg-slate-200'}`} />}
              <span className={`relative z-10 flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-black ring-4 ring-white ${step.complete ? 'bg-emerald-500 text-white' : active ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200' : 'bg-slate-200 text-slate-500'}`}>
                {step.complete ? <CheckCircle2 size={14} /> : index + 1}
              </span>
              <span className={`mt-1.5 truncate px-1 text-[9px] font-black uppercase tracking-[0.1em] ${step.complete ? 'text-emerald-700' : active ? 'text-indigo-700' : 'text-slate-400'}`}>{step.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AdvanceCard({
  advance,
  canValidate,
  canManage,
  canCorrect,
  onView,
  onGenerateReport,
  onOpenReceipt,
  onComplete,
  onApprove,
  onReturn,
  onReject,
  onDelete,
}: {
  advance: TravelAdvance;
  canValidate: boolean;
  canManage: boolean;
  canCorrect: boolean;
  onView: () => void;
  onGenerateReport: (scope: AdvanceReportScope) => void;
  onOpenReceipt: () => void;
  onComplete: () => void;
  onApprove: () => void;
  onReturn: () => void;
  onReject: () => void;
  onDelete: () => void;
}) {
  const status = statusConfig[advance.status] || statusConfig.submitted;
  const linkedTaskTitles =
    Array.isArray(advance.taskTitles) && advance.taskTitles.length > 0
      ? advance.taskTitles
      : advance.taskTitle
        ? [advance.taskTitle]
        : [];
  const costCenterNames = Array.from(
    new Set(
      (advance.costCenters || [])
        .map((center) => center.name)
        .concat(advance.costCenterName || [])
        .filter(Boolean)
    )
  );
  const progress =
    asNumber(advance.amountApproved) > 0
      ? Math.min(100, Math.round((getAdvanceJustifiedAmount(advance) / asNumber(advance.amountApproved)) * 100))
      : 0;
  const advanceReceipts = advance.receipts || [];
  const pendingAuditCount = advanceReceipts.filter(hasPendingDianAccountingAudit).length;
  const pendingApprovalCount = advanceReceipts.filter((receipt) => !isReceiptAdministrativelyReviewed(receipt)).length;
  const allLegalizationsApproved = advanceReceipts.length > 0 && advanceReceipts.every(isApprovedReceipt);
  const canReviewAdvance = canValidate || canManage;

  return (
    <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_auto] lg:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-md px-2 py-1 text-[11px] font-black ring-1 ${status.className}`}>{status.label}</span>
            {advance.customId && (
              <span className="rounded-md bg-violet-50 px-2 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-violet-700 ring-1 ring-violet-100">
                ID {advance.customId}
              </span>
            )}
            <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-black text-slate-500">{advance.requesterName}</span>
            {linkedTaskTitles.slice(0, 2).map((taskTitle) => (
              <span key={taskTitle} className="max-w-[220px] truncate rounded-md bg-indigo-50 px-2 py-1 text-[11px] font-black text-indigo-700 ring-1 ring-indigo-100">
                {taskTitle}
              </span>
            ))}
            {linkedTaskTitles.length > 2 && (
              <span className="rounded-md bg-indigo-100 px-2 py-1 text-[11px] font-black text-indigo-700 ring-1 ring-indigo-100">
                +{linkedTaskTitles.length - 2} tareas
              </span>
            )}
          </div>
          <h3 className="mt-3 text-xl font-black tracking-tight text-slate-950">{advance.destination}</h3>
          <p className="mt-1 line-clamp-2 text-sm font-semibold leading-6 text-slate-600">{advance.purpose}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-slate-500">
            <span className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-2 py-1 ring-1 ring-slate-200">
              <CalendarDays size={13} />
              {formatDate(advance.travelStart)} - {formatDate(advance.travelEnd)}
            </span>
            <span className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-2 py-1 ring-1 ring-slate-200">
              <MapPin size={13} />
              {advance.items?.length || 0} ítems
            </span>
            {costCenterNames.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-emerald-700 ring-1 ring-emerald-100">
                <FolderKanban size={13} />
                {costCenterNames[0]}{costCenterNames.length > 1 ? ` +${costCenterNames.length - 1}` : ''}
              </span>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:min-w-[360px]">
          <SummaryLine label="Solicitado" value={formatMoney(advance.amountRequested)} />
          <SummaryLine label="Justificado" value={formatMoney(getAdvanceJustifiedAmount(advance))} />
          <SummaryLine label="Legalizado" value={formatMoney(advance.amountLegalized)} strong />
          <SummaryLine label="Avance justificación" value={`${progress}%`} />
          <div className="col-span-2 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-[0.1em]">
            <span className={`rounded-md px-2 py-1 ring-1 ${advance.requesterSignature ? 'bg-emerald-50 text-emerald-700 ring-emerald-100' : 'bg-amber-50 text-amber-700 ring-amber-100'}`}>Solicitante {advance.requesterSignature ? 'firmó' : 'pendiente'}</span>
            <span className={`rounded-md px-2 py-1 ring-1 ${advance.approvalSignature ? 'bg-emerald-50 text-emerald-700 ring-emerald-100' : 'bg-amber-50 text-amber-700 ring-amber-100'}`}>Aprobador {advance.approvalSignature ? 'firmó' : 'pendiente'}</span>
          </div>
        </div>
      </div>

      <AdvanceLifecycle advance={advance} />

      <div className="grid gap-3 border-t border-slate-100 bg-slate-50/70 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="flex min-w-0 flex-wrap gap-2">
          {(advance.items || []).slice(0, 5).map((item) => (
            <span key={item.id} className="rounded-md bg-white px-2 py-1 text-xs font-black text-slate-600 ring-1 ring-slate-200">
              {item.categoryName}: {formatMoney(item.amount)}
            </span>
          ))}
          {(advance.receipts || []).length > 0 && (
            <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-black text-emerald-700 ring-1 ring-emerald-100">
              {(advance.receipts || []).length} soportes
            </span>
          )}
          {advance.adminComment && (
            <span className="rounded-md bg-orange-50 px-2 py-1 text-xs font-black text-orange-700 ring-1 ring-orange-100">
              {advance.adminComment}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onView}>
            <FileText size={15} className="mr-2" />
            Ver anticipo
          </Button>
          <AdvanceReportMenu advance={advance} onSelect={onGenerateReport} />
          {(canManage || canCorrect) && isAdvanceReadyForLegalization(advance) && (
            <Button type="button" size="sm" onClick={onOpenReceipt} className="bg-emerald-600 text-white hover:bg-emerald-700">
              <ReceiptText size={15} className="mr-2" />
              Legalizar
            </Button>
          )}
          {canCorrect && isAdvanceReadyForLegalization(advance) && advanceReceipts.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onComplete}
              disabled={!allLegalizationsApproved}
              title={!allLegalizationsApproved ? 'Todas las legalizaciones y facturas deben estar aprobadas por auditoría antes del cierre.' : 'Cerrar como solicitante y enviar a conciliación.'}
              className="border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400"
            >
              <CheckCircle2 size={15} className="mr-2" />
              {allLegalizationsApproved ? 'Cerrar y enviar a conciliación' : pendingAuditCount > 0 ? `${pendingAuditCount} por auditoría DIAN` : `${pendingApprovalCount} por aprobar`}
            </Button>
          )}
          {canReviewAdvance && ['submitted', 'returned'].includes(advance.status) && (
            <>
              <Button type="button" size="sm" onClick={onApprove} className="bg-indigo-600 text-white hover:bg-indigo-700">
                {advance.status === 'returned' ? 'Reaprobar' : 'Aprobar'}
              </Button>
              {advance.status === 'submitted' && (
                <Button type="button" size="sm" variant="outline" onClick={onReturn} className="border-orange-200 text-orange-700 hover:bg-orange-50">
                  Devolver
                </Button>
              )}
              <Button type="button" size="sm" variant="outline" onClick={onReject} className="border-rose-200 text-rose-700 hover:bg-rose-50">
                Rechazar
              </Button>
            </>
          )}
          {canManage && (
            <Button type="button" size="sm" variant="outline" onClick={onDelete} className="border-rose-200 text-rose-700 hover:bg-rose-50">
              <Trash2 size={15} className="mr-2" />
              Eliminar
            </Button>
          )}
          <ArrowRight size={18} className="hidden text-slate-300 lg:block" />
        </div>
      </div>
    </article>
  );
}
