import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import {
  calculateAdministrativeAdvanceFinancials,
  getUniqueAdministrativeReceipts,
  roundAdministrativeMoney,
  type AdministrativeMetricPaymentSupport,
} from '@/lib/administrative-advance-metrics';

export type AdministrativeAdvanceReceiptSource = {
  id?: string;
  status?: string;
  amount?: number | string;
  documentType?: string;
  billingPaymentId?: string;
  createdAt?: unknown;
  reviewedAt?: unknown;
  resubmittedAt?: unknown;
  accountingAuditedAt?: unknown;
  accountingAuditStatus?: string;
};

export type AdministrativeAdvanceSource = {
  id: string;
  customId?: string | null;
  projectId: string;
  projectName: string;
  organizationName?: string;
  requesterId?: string;
  requesterKey?: string;
  requesterName?: string;
  requesterEmail?: string;
  destination?: string;
  status?: string;
  reconciliationStatus?: string;
  amountRequested?: number | string;
  amountApproved?: number | string | null;
  amountLegalized?: number | string;
  amountReturned?: number | string;
  amountPaid?: number | string;
  paymentSupport?: AdministrativeMetricPaymentSupport | null;
  paymentSupports?: AdministrativeMetricPaymentSupport[];
  realCost?: number | string;
  travelStart?: unknown;
  travelEnd?: unknown;
  createdAt?: unknown;
  approvedAt?: unknown;
  paidAt?: unknown;
  completedAt?: unknown;
  closedAt?: unknown;
  receipts?: AdministrativeAdvanceReceiptSource[];
};

export type AdministrativeAdvanceQueueRow = {
  key: 'approval' | 'payment' | 'receipt_review' | 'dian_audit' | 'reconciliation';
  label: string;
  owner: string;
  advanceCount: number;
  itemCount: number;
  amount: number;
  oldestDays: number | null;
};

export type AdministrativeAdvanceDebtorRow = {
  personKey: string;
  requesterName: string;
  requesterEmail: string;
  advanceCount: number;
  paid: number;
  justified: number;
  legalized: number;
  returned: number;
  pending: number;
  overdueCount: number;
  oldestOverdueDays: number;
};

export type AdministrativeAdvanceDetailRow = {
  id: string;
  recordId: string;
  operational: boolean;
  projectId: string;
  personKey: string;
  requesterId: string;
  projectName: string;
  organizationName: string;
  requesterName: string;
  requesterEmail: string;
  destination: string;
  status: string;
  stage: string;
  nextOwner: string;
  requested: number;
  approved: number;
  paid: number;
  paymentPending: number;
  justified: number;
  legalized: number;
  persistedLegalized: number;
  legalizedDrift: number;
  returnedCash: number;
  realCost: number;
  justificationPending: number;
  administrativePendingAmount: number;
  administrativePendingTasks: number;
  receiptCount: number;
  approvedReceiptCount: number;
  pendingReviewCount: number;
  pendingDianCount: number;
  dianAlertCount: number;
  returnedReceiptCount: number;
  administrativeReasons: string[];
  administrativeDelayReasons: string[];
  hasAdministrativeAlert: boolean;
  hasAdministrativeDelay: boolean;
  hasJustificationDelay: boolean;
  justificationDelayDays: number;
  alertLabel: string;
};

export type AdministrativeAdvancePersonRow = {
  personKey: string;
  requesterId: string;
  requesterName: string;
  requesterEmail: string;
  projectCount: number;
  advanceCount: number;
  withLegalizations: number;
  withoutLegalizations: number;
  requested: number;
  approved: number;
  paid: number;
  paymentPending: number;
  justified: number;
  legalized: number;
  returnedCash: number;
  realCost: number;
  justificationPending: number;
  administrativePendingAmount: number;
  administrativePendingTasks: number;
  administrativeAlertCount: number;
  administrativeDelayCount: number;
  justificationDelayCount: number;
};

export type AdministrativeAdvanceStatusReport = {
  title: string;
  generatedAt: string;
  scopeLabel: string;
  filtersLabel: string;
  administrativeDelayDays: number;
  totals: {
    advanceCount: number;
    withLegalizations: number;
    withoutLegalizations: number;
    requested: number;
    approved: number;
    paid: number;
    paymentPending: number;
    justified: number;
    legalized: number;
    returnedCash: number;
    realCost: number;
    justificationPending: number;
    administrativePendingAmount: number;
    administrativePendingTasks: number;
    administrativeAlertCount: number;
    administrativeDelayCount: number;
    justificationDelayCount: number;
  };
  queues: AdministrativeAdvanceQueueRow[];
  people: AdministrativeAdvancePersonRow[];
  debtors: AdministrativeAdvanceDebtorRow[];
  advances: AdministrativeAdvanceDetailRow[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

const asNumber = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const getDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof (value as { toDate?: unknown })?.toDate === 'function') {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'string') {
    const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnlyMatch) {
      const [, year, month, day] = dateOnlyMatch;
      const date = new Date(Number(year), Number(month) - 1, Number(day));
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }
  const date = new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? null : date;
};

const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate());

const daysSince = (value: unknown, referenceDate: Date) => {
  const date = getDate(value);
  if (!date) return null;
  return Math.max(0, Math.floor((startOfDay(referenceDate).getTime() - startOfDay(date).getTime()) / DAY_MS));
};

const earliestDate = (values: unknown[]) => {
  const dates = values.map(getDate).filter((value): value is Date => Boolean(value));
  if (dates.length === 0) return null;
  return dates.reduce((earliest, current) => (current.getTime() < earliest.getTime() ? current : earliest));
};

const statusLabel = (status?: string, reconciled?: boolean) => {
  if (reconciled || status === 'closed') return 'Conciliado';
  const labels: Record<string, string> = {
    submitted: 'Por aprobar',
    pending_payment: 'Por pagar',
    partially_paid: 'Abonado',
    paid: 'En legalización',
    approved: 'En legalización',
    completed: 'Por conciliar',
    returned: 'Devuelto',
    rejected: 'Rechazado',
  };
  return labels[String(status || '')] || 'En gestión';
};

const isPendingReceiptReview = (receipt: AdministrativeAdvanceReceiptSource) => receipt.status === 'submitted';
const isPendingDianAudit = (receipt: AdministrativeAdvanceReceiptSource) =>
  receipt.documentType === 'invoice' &&
  (receipt.status === 'audit_pending' || receipt.accountingAuditStatus === 'pending');
const isDianAlert = (receipt: AdministrativeAdvanceReceiptSource) =>
  receipt.documentType === 'invoice' &&
  (receipt.status === 'audit_alert' || receipt.accountingAuditStatus === 'alert');

const normalizeIdentity = (value: unknown) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

const resolvePersonKey = (advance: AdministrativeAdvanceSource) => {
  const explicitKey = String(advance.requesterKey || '').trim();
  if (explicitKey) return explicitKey;
  const email = String(advance.requesterEmail || '').trim().toLowerCase();
  if (email) return `email:${email}`;
  const requesterId = String(advance.requesterId || '').trim();
  if (requesterId) return `id:${requesterId}`;
  const name = normalizeIdentity(advance.requesterName);
  return name ? `name:${name}` : `advance:${advance.projectId}:${advance.id}`;
};

const buildStage = ({
  status,
  reconciled,
  paymentPending,
  justificationPending,
  pendingReviewCount,
  pendingDianCount,
  dianAlertCount,
  returnedReceiptCount,
}: {
  status?: string;
  reconciled: boolean;
  paymentPending: number;
  justificationPending: number;
  pendingReviewCount: number;
  pendingDianCount: number;
  dianAlertCount: number;
  returnedReceiptCount: number;
}) => {
  if (status === 'rejected') return { stage: 'Rechazado', nextOwner: 'Sin acción' };
  if (reconciled || status === 'closed') return { stage: 'Informe final', nextOwner: 'Sin acción' };
  if (status === 'returned') return { stage: 'Corrección del anticipo', nextOwner: 'Solicitante' };
  if (status === 'submitted') return { stage: 'Aprobación', nextOwner: 'Administración' };
  if (paymentPending > 0) {
    return { stage: 'Pago / abono', nextOwner: 'Administración' };
  }
  if (returnedReceiptCount > 0) return { stage: 'Subsanación', nextOwner: 'Solicitante' };
  if (pendingReviewCount > 0) return { stage: 'Validación de legalizaciones', nextOwner: 'Administración' };
  if (pendingDianCount > 0 || dianAlertCount > 0) return { stage: 'Auditoría DIAN', nextOwner: 'Administración' };
  if (status === 'completed') return { stage: 'Conciliación', nextOwner: 'Administración' };
  if (justificationPending > 0) return { stage: 'Legalizaciones', nextOwner: 'Solicitante' };
  return { stage: 'Cierre del funcionario', nextOwner: 'Solicitante' };
};

const sum = <T,>(rows: T[], selector: (row: T) => number) =>
  roundAdministrativeMoney(rows.reduce((total, row) => total + selector(row), 0));

export const buildAdministrativeAdvanceStatusReport = ({
  advances,
  generatedAt = new Date(),
  scopeLabel,
  filtersLabel,
  administrativeDelayDays = 3,
}: {
  advances: AdministrativeAdvanceSource[];
  generatedAt?: Date;
  scopeLabel: string;
  filtersLabel: string;
  administrativeDelayDays?: number;
}): AdministrativeAdvanceStatusReport => {
  const queueAccumulator: Record<AdministrativeAdvanceQueueRow['key'], AdministrativeAdvanceQueueRow & { dates: unknown[] }> = {
    approval: { key: 'approval', label: 'Aprobar anticipos', owner: 'Administración', advanceCount: 0, itemCount: 0, amount: 0, oldestDays: null, dates: [] },
    payment: { key: 'payment', label: 'Registrar o completar pagos', owner: 'Administración', advanceCount: 0, itemCount: 0, amount: 0, oldestDays: null, dates: [] },
    receipt_review: { key: 'receipt_review', label: 'Validar legalizaciones', owner: 'Administración', advanceCount: 0, itemCount: 0, amount: 0, oldestDays: null, dates: [] },
    dian_audit: { key: 'dian_audit', label: 'Auditar o resolver alertas DIAN', owner: 'Administración', advanceCount: 0, itemCount: 0, amount: 0, oldestDays: null, dates: [] },
    reconciliation: { key: 'reconciliation', label: 'Conciliar y cerrar expedientes', owner: 'Administración', advanceCount: 0, itemCount: 0, amount: 0, oldestDays: null, dates: [] },
  };

  const detailRows = advances.map((advance): AdministrativeAdvanceDetailRow => {
    const receipts = getUniqueAdministrativeReceipts(advance) as AdministrativeAdvanceReceiptSource[];
    const financials = calculateAdministrativeAdvanceFinancials(advance);
    const realCost = Math.max(0, roundAdministrativeMoney(advance.realCost));
    const inactive = !financials.operational || financials.reconciled;
    const pendingReviewReceipts = receipts.filter(isPendingReceiptReview);
    const pendingDianReceipts = receipts.filter(isPendingDianAudit);
    const dianAlertReceipts = receipts.filter(isDianAlert);
    const dianReceipts = receipts.filter((receipt) => isPendingDianAudit(receipt) || isDianAlert(receipt));
    const returnedReceipts = receipts.filter((receipt) => receipt.status === 'returned');
    const administrativeReasons: string[] = [];
    const administrativeDelayReasons: string[] = [];
    let administrativePendingTasks = 0;

    const addAdministrativeReason = (label: string, dateValue: unknown) => {
      administrativeReasons.push(label);
      const age = daysSince(dateValue, generatedAt);
      if (age !== null && age >= administrativeDelayDays) {
        administrativeDelayReasons.push(`${label} (${age} días)`);
      }
    };

    if (!inactive && advance.status === 'submitted') {
      addAdministrativeReason('Aprobación pendiente', advance.createdAt);
      administrativePendingTasks += 1;
      const queue = queueAccumulator.approval;
      queue.advanceCount += 1;
      queue.itemCount += 1;
      queue.amount += financials.requested;
      queue.dates.push(advance.createdAt);
    }
    if (financials.paymentPending > 0) {
      addAdministrativeReason('Pago pendiente', advance.approvedAt || advance.createdAt);
      administrativePendingTasks += 1;
      const queue = queueAccumulator.payment;
      queue.advanceCount += 1;
      queue.itemCount += 1;
      queue.amount += financials.paymentPending;
      queue.dates.push(advance.approvedAt || advance.createdAt);
    }
    if (!inactive && pendingReviewReceipts.length > 0) {
      const oldest = earliestDate(pendingReviewReceipts.map((receipt) => receipt.resubmittedAt || receipt.createdAt));
      addAdministrativeReason(`${pendingReviewReceipts.length} legalización${pendingReviewReceipts.length === 1 ? '' : 'es'} por validar`, oldest);
      administrativePendingTasks += pendingReviewReceipts.length;
      const queue = queueAccumulator.receipt_review;
      queue.advanceCount += 1;
      queue.itemCount += pendingReviewReceipts.length;
      queue.amount += sum(pendingReviewReceipts, (receipt) => asNumber(receipt.amount));
      queue.dates.push(oldest);
    }
    if (!inactive && (pendingDianReceipts.length > 0 || dianAlertReceipts.length > 0)) {
      const oldest = earliestDate(
        dianReceipts.map((receipt) => receipt.accountingAuditedAt || receipt.reviewedAt || receipt.resubmittedAt || receipt.createdAt)
      );
      const parts = [
        pendingDianReceipts.length > 0 ? `${pendingDianReceipts.length} por auditar` : '',
        dianAlertReceipts.length > 0 ? `${dianAlertReceipts.length} alerta${dianAlertReceipts.length === 1 ? '' : 's'} DIAN` : '',
      ].filter(Boolean);
      addAdministrativeReason(parts.join(' y '), oldest);
      administrativePendingTasks += dianReceipts.length;
      const queue = queueAccumulator.dian_audit;
      queue.advanceCount += 1;
      queue.itemCount += dianReceipts.length;
      queue.amount += sum(dianReceipts, (receipt) => asNumber(receipt.amount));
      queue.dates.push(oldest);
    }
    if (!inactive && advance.status === 'completed') {
      addAdministrativeReason('Conciliación pendiente', advance.completedAt || advance.paidAt || advance.approvedAt);
      administrativePendingTasks += 1;
      const queue = queueAccumulator.reconciliation;
      queue.advanceCount += 1;
      queue.itemCount += 1;
      queue.amount += financials.legalized;
      queue.dates.push(advance.completedAt || advance.paidAt || advance.approvedAt);
    }

    const travelEnd = getDate(advance.travelEnd);
    const justificationDelayDays =
      financials.justificationPending > 0 && travelEnd && startOfDay(generatedAt).getTime() > startOfDay(travelEnd).getTime()
        ? Math.max(1, Math.floor((startOfDay(generatedAt).getTime() - startOfDay(travelEnd).getTime()) / DAY_MS))
        : 0;
    const hasJustificationDelay = justificationDelayDays > 0;
    const stage = buildStage({
      status: advance.status,
      reconciled: financials.reconciled,
      paymentPending: financials.paymentPending,
      justificationPending: financials.justificationPending,
      pendingReviewCount: pendingReviewReceipts.length,
      pendingDianCount: pendingDianReceipts.length,
      dianAlertCount: dianAlertReceipts.length,
      returnedReceiptCount: returnedReceipts.length,
    });
    const alertParts = [
      administrativeDelayReasons.length > 0 ? 'Demora administrativa' : administrativeReasons.length > 0 ? 'Pendiente administrativo' : '',
      hasJustificationDelay ? `Justificación vencida ${justificationDelayDays} d` : '',
      returnedReceipts.length > 0 ? `${returnedReceipts.length} devuelta${returnedReceipts.length === 1 ? '' : 's'}` : '',
    ].filter(Boolean);

    return {
      id: String(advance.customId || advance.id),
      recordId: advance.id,
      operational: financials.operational,
      projectId: advance.projectId,
      personKey: resolvePersonKey(advance),
      requesterId: String(advance.requesterId || ''),
      projectName: advance.projectName || advance.projectId,
      organizationName: advance.organizationName || 'Sin organización',
      requesterName: advance.requesterName || 'Solicitante sin nombre',
      requesterEmail: advance.requesterEmail || '',
      destination: advance.destination || 'Sin destino',
      status: statusLabel(advance.status, financials.reconciled),
      stage: stage.stage,
      nextOwner: stage.nextOwner,
      requested: financials.requested,
      approved: financials.approved,
      paid: financials.paid,
      paymentPending: financials.paymentPending,
      justified: financials.justified,
      legalized: financials.legalized,
      persistedLegalized: financials.persistedLegalized,
      legalizedDrift: financials.legalizedDrift,
      returnedCash: financials.returnedCash,
      realCost,
      justificationPending: financials.justificationPending,
      administrativePendingAmount: financials.administrativePendingAmount,
      administrativePendingTasks,
      receiptCount: financials.receiptCount,
      approvedReceiptCount: financials.legalizedReceiptCount,
      pendingReviewCount: pendingReviewReceipts.length,
      pendingDianCount: pendingDianReceipts.length,
      dianAlertCount: dianAlertReceipts.length,
      returnedReceiptCount: returnedReceipts.length,
      administrativeReasons,
      administrativeDelayReasons,
      hasAdministrativeAlert: administrativeReasons.length > 0,
      hasAdministrativeDelay: administrativeDelayReasons.length > 0,
      hasJustificationDelay,
      justificationDelayDays,
      alertLabel: alertParts.join(' / ') || 'Sin alerta',
    };
  });

  const queues = Object.values(queueAccumulator).map(({ dates, ...queue }) => {
    const oldest = earliestDate(dates);
    return {
      ...queue,
      amount: roundAdministrativeMoney(queue.amount),
      oldestDays: oldest ? daysSince(oldest, generatedAt) : null,
    };
  });

  const operationalRows = detailRows.filter((row) => row.operational);
  type PersonAccumulator = AdministrativeAdvancePersonRow & { projectIds: Set<string> };
  const personMap = new Map<string, PersonAccumulator>();
  operationalRows.forEach((row) => {
    const current = personMap.get(row.personKey) || {
      personKey: row.personKey,
      requesterId: row.requesterId,
      requesterName: row.requesterName,
      requesterEmail: row.requesterEmail,
      projectIds: new Set<string>(),
      projectCount: 0,
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
    };

    current.projectIds.add(row.projectId);
    current.projectCount = current.projectIds.size;
    current.advanceCount += 1;
    current.withLegalizations += row.receiptCount > 0 ? 1 : 0;
    current.withoutLegalizations += row.receiptCount === 0 ? 1 : 0;
    current.requested = roundAdministrativeMoney(current.requested + row.requested);
    current.approved = roundAdministrativeMoney(current.approved + row.approved);
    current.paid = roundAdministrativeMoney(current.paid + row.paid);
    current.paymentPending = roundAdministrativeMoney(current.paymentPending + row.paymentPending);
    current.justified = roundAdministrativeMoney(current.justified + row.justified);
    current.legalized = roundAdministrativeMoney(current.legalized + row.legalized);
    current.returnedCash = roundAdministrativeMoney(current.returnedCash + row.returnedCash);
    current.realCost = roundAdministrativeMoney(current.realCost + row.realCost);
    current.justificationPending = roundAdministrativeMoney(current.justificationPending + row.justificationPending);
    current.administrativePendingAmount = roundAdministrativeMoney(
      current.administrativePendingAmount + row.administrativePendingAmount
    );
    current.administrativePendingTasks += row.administrativePendingTasks;
    current.administrativeAlertCount += row.hasAdministrativeAlert ? 1 : 0;
    current.administrativeDelayCount += row.hasAdministrativeDelay ? 1 : 0;
    current.justificationDelayCount += row.hasJustificationDelay ? 1 : 0;
    personMap.set(row.personKey, current);
  });

  const people = [...personMap.values()]
    .map(({ projectIds: _projectIds, ...person }) => person)
    .sort(
      (left, right) =>
        right.administrativeDelayCount - left.administrativeDelayCount ||
        right.justificationDelayCount - left.justificationDelayCount ||
        right.justificationPending - left.justificationPending ||
        left.requesterName.localeCompare(right.requesterName, 'es')
    );

  const debtorMap = new Map<string, AdministrativeAdvanceDebtorRow>();
  operationalRows
    .filter((row) => row.justificationPending > 0 || row.returnedReceiptCount > 0)
    .forEach((row) => {
      const key = row.personKey;
      const current = debtorMap.get(key) || {
        personKey: row.personKey,
        requesterName: row.requesterName,
        requesterEmail: row.requesterEmail,
        advanceCount: 0,
        paid: 0,
        justified: 0,
        legalized: 0,
        returned: 0,
        pending: 0,
        overdueCount: 0,
        oldestOverdueDays: 0,
      };
      current.advanceCount += 1;
      current.paid = roundAdministrativeMoney(current.paid + row.paid);
      current.justified = roundAdministrativeMoney(current.justified + row.justified);
      current.legalized = roundAdministrativeMoney(current.legalized + row.legalized);
      current.returned = roundAdministrativeMoney(current.returned + row.returnedCash);
      current.pending = roundAdministrativeMoney(current.pending + row.justificationPending);
      current.overdueCount += row.hasJustificationDelay ? 1 : 0;
      current.oldestOverdueDays = Math.max(current.oldestOverdueDays, row.justificationDelayDays);
      debtorMap.set(key, current);
    });

  const debtors = [...debtorMap.values()].sort(
    (left, right) => right.overdueCount - left.overdueCount || right.pending - left.pending || left.requesterName.localeCompare(right.requesterName, 'es')
  );

  const totals: AdministrativeAdvanceStatusReport['totals'] = {
    advanceCount: sum(people, (person) => person.advanceCount),
    withLegalizations: sum(people, (person) => person.withLegalizations),
    withoutLegalizations: sum(people, (person) => person.withoutLegalizations),
    requested: sum(people, (person) => person.requested),
    approved: sum(people, (person) => person.approved),
    paid: sum(people, (person) => person.paid),
    paymentPending: sum(people, (person) => person.paymentPending),
    justified: sum(people, (person) => person.justified),
    legalized: sum(people, (person) => person.legalized),
    returnedCash: sum(people, (person) => person.returnedCash),
    realCost: sum(people, (person) => person.realCost),
    justificationPending: sum(people, (person) => person.justificationPending),
    administrativePendingAmount: sum(people, (person) => person.administrativePendingAmount),
    administrativePendingTasks: sum(people, (person) => person.administrativePendingTasks),
    administrativeAlertCount: sum(people, (person) => person.administrativeAlertCount),
    administrativeDelayCount: sum(people, (person) => person.administrativeDelayCount),
    justificationDelayCount: sum(people, (person) => person.justificationDelayCount),
  };

  return {
    title: 'Informe de estado de anticipos',
    generatedAt: generatedAt.toISOString(),
    scopeLabel,
    filtersLabel,
    administrativeDelayDays,
    totals,
    queues,
    people,
    debtors,
    advances: [...operationalRows].sort(
      (left, right) =>
        Number(right.hasAdministrativeDelay || right.hasJustificationDelay) - Number(left.hasAdministrativeDelay || left.hasJustificationDelay) ||
        right.justificationPending - left.justificationPending ||
        right.id.localeCompare(left.id, 'es', { numeric: true })
    ),
  };
};

type PdfFonts = {
  regular: PDFFont;
  bold: PDFFont;
  oblique: PDFFont;
};

type PdfColumn = {
  label: string;
  width: number;
  align?: 'left' | 'right' | 'center';
};

const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;
const MARGIN_X = 30;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;
const CONTENT_BOTTOM = 36;
const SLATE_950 = rgb(0.06, 0.09, 0.16);
const SLATE_700 = rgb(0.2, 0.25, 0.34);
const SLATE_500 = rgb(0.39, 0.45, 0.55);
const SLATE_300 = rgb(0.8, 0.84, 0.89);
const SLATE_100 = rgb(0.95, 0.97, 0.98);
const INDIGO = rgb(0.31, 0.27, 0.9);
const INDIGO_50 = rgb(0.95, 0.95, 1);
const TEAL = rgb(0.03, 0.51, 0.43);
const TEAL_50 = rgb(0.93, 0.99, 0.97);
const AMBER = rgb(0.85, 0.45, 0.03);
const AMBER_50 = rgb(1, 0.98, 0.92);
const ROSE = rgb(0.86, 0.13, 0.28);
const ROSE_50 = rgb(1, 0.95, 0.96);
const WHITE = rgb(1, 1, 1);

const normalizePdfText = (value: unknown) =>
  String(value ?? '')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f]/g, '"')
    .replace(/\u00b7/g, ' - ')
    .replace(/\u2022/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00a0/g, ' ')
    .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, '');

const wrapText = (font: PDFFont, value: unknown, size: number, maxWidth: number) => {
  const text = normalizePdfText(value).trim();
  if (!text) return [''];
  const lines: string[] = [];
  text.split(/\r?\n/).forEach((paragraph) => {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let current = '';
    words.forEach((word) => {
      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        if (current) lines.push(current);
        current = '';
        let fragment = '';
        Array.from(word).forEach((character) => {
          const candidate = `${fragment}${character}`;
          if (fragment && font.widthOfTextAtSize(candidate, size) > maxWidth) {
            lines.push(fragment);
            fragment = character;
          } else {
            fragment = candidate;
          }
        });
        current = fragment;
        return;
      }
      const candidate = current ? `${current} ${word}` : word;
      if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    });
    if (current) lines.push(current);
  });
  return lines.length > 0 ? lines : [''];
};

const formatMoney = (value: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(asNumber(value));

const formatDateTime = (value: string) =>
  new Date(value).toLocaleString('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export const generateAdministrativeAdvanceStatusPdf = async (report: AdministrativeAdvanceStatusReport) => {
  const pdf = await PDFDocument.create();
  const fonts: PdfFonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    oblique: await pdf.embedFont(StandardFonts.HelveticaOblique),
  };
  pdf.setTitle(report.title);
  pdf.setSubject('Balance operativo y administrativo de anticipos');
  pdf.setAuthor('Pixel Project');
  pdf.setCreator('Pixel Project');

  let page!: PDFPage;
  let y = 0;
  const pages: PDFPage[] = [];

  const addPage = (continuationLabel?: string) => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(page);
    y = PAGE_HEIGHT - 30;
    if (continuationLabel) {
      page.drawText('PIXEL PROJECT', { x: MARGIN_X, y, size: 7.5, font: fonts.bold, color: INDIGO });
      page.drawText(normalizePdfText(continuationLabel), { x: MARGIN_X + 96, y, size: 8.5, font: fonts.bold, color: SLATE_700 });
      y -= 20;
    }
  };

  const ensureSpace = (height: number, continuationLabel?: string) => {
    if (y - height < CONTENT_BOTTOM) addPage(continuationLabel);
  };

  const drawLines = (lines: string[], x: number, topY: number, size: number, lineHeight: number, font: PDFFont, color = SLATE_700) => {
    lines.forEach((line, index) => {
      page.drawText(line, { x, y: topY - index * lineHeight, size, font, color });
    });
  };

  const drawSectionTitle = (label: string, title: string) => {
    ensureSpace(30, title);
    page.drawRectangle({ x: MARGIN_X, y: y - 18, width: 20, height: 20, borderColor: INDIGO, borderWidth: 1.2, color: WHITE });
    page.drawText(label, { x: MARGIN_X + 6, y: y - 11, size: 8, font: fonts.bold, color: INDIGO });
    page.drawText(normalizePdfText(title), { x: MARGIN_X + 30, y: y - 10, size: 13, font: fonts.bold, color: SLATE_950 });
    y -= 31;
  };

  const drawMetrics = (rows: Array<{ label: string; value: string; detail?: string; tone?: 'indigo' | 'teal' | 'amber' | 'rose' }>) => {
    const gap = 7;
    const width = (CONTENT_WIDTH - gap * 3) / 4;
    const height = 48;
    rows.forEach((metric, index) => {
      if (index > 0 && index % 4 === 0) y -= height + gap;
      const column = index % 4;
      const x = MARGIN_X + column * (width + gap);
      const tone = metric.tone === 'teal' ? TEAL : metric.tone === 'amber' ? AMBER : metric.tone === 'rose' ? ROSE : INDIGO;
      const fill = metric.tone === 'teal' ? TEAL_50 : metric.tone === 'amber' ? AMBER_50 : metric.tone === 'rose' ? ROSE_50 : INDIGO_50;
      page.drawRectangle({ x, y: y - height, width, height, borderColor: tone, borderWidth: 0.6, color: fill, opacity: 0.52 });
      page.drawText(normalizePdfText(metric.label).toUpperCase(), { x: x + 8, y: y - 13, size: 6.3, font: fonts.bold, color: SLATE_500 });
      page.drawText(normalizePdfText(metric.value), { x: x + 8, y: y - 30, size: 12.5, font: fonts.bold, color: SLATE_950 });
      if (metric.detail) page.drawText(normalizePdfText(metric.detail), { x: x + 8, y: y - 42, size: 6.2, font: fonts.regular, color: SLATE_500 });
    });
    y -= height + gap;
  };

  const drawTable = ({
    title,
    columns,
    rows,
    continuationLabel,
  }: {
    title: string;
    columns: PdfColumn[];
    rows: string[][];
    continuationLabel: string;
  }) => {
    const headerHeight = 21;
    const fontSize = 6.7;
    const lineHeight = 8.3;
    const paddingX = 4;
    const drawHeader = () => {
      ensureSpace(headerHeight + 14, continuationLabel);
      page.drawText(normalizePdfText(title), { x: MARGIN_X, y: y - 1, size: 8.5, font: fonts.bold, color: SLATE_700 });
      y -= 10;
      page.drawRectangle({ x: MARGIN_X, y: y - headerHeight, width: CONTENT_WIDTH, height: headerHeight, color: SLATE_100, borderColor: SLATE_300, borderWidth: 0.5 });
      let x = MARGIN_X;
      columns.forEach((column) => {
        page.drawText(normalizePdfText(column.label).toUpperCase(), { x: x + paddingX, y: y - 13, size: 6.1, font: fonts.bold, color: SLATE_500 });
        x += column.width;
      });
      y -= headerHeight;
    };

    drawHeader();
    if (rows.length === 0) {
      page.drawRectangle({ x: MARGIN_X, y: y - 28, width: CONTENT_WIDTH, height: 28, borderColor: SLATE_300, borderWidth: 0.5 });
      page.drawText('Sin registros para el alcance seleccionado.', { x: MARGIN_X + 7, y: y - 17, size: 7.5, font: fonts.oblique, color: SLATE_500 });
      y -= 34;
      return;
    }

    rows.forEach((row, rowIndex) => {
      const wrapped = row.map((cell, index) => wrapText(fonts.regular, cell, fontSize, columns[index].width - paddingX * 2));
      const rowHeight = Math.max(22, Math.max(...wrapped.map((lines) => lines.length)) * lineHeight + 8);
      if (y - rowHeight < CONTENT_BOTTOM) {
        addPage(continuationLabel);
        drawHeader();
      }
      page.drawRectangle({
        x: MARGIN_X,
        y: y - rowHeight,
        width: CONTENT_WIDTH,
        height: rowHeight,
        color: rowIndex % 2 === 0 ? WHITE : SLATE_100,
        opacity: rowIndex % 2 === 0 ? 1 : 0.45,
        borderColor: SLATE_300,
        borderWidth: 0.45,
      });
      let x = MARGIN_X;
      wrapped.forEach((lines, index) => {
        const column = columns[index];
        lines.forEach((line, lineIndex) => {
          const lineWidth = fonts.regular.widthOfTextAtSize(line, fontSize);
          const textX = column.align === 'right'
            ? x + column.width - paddingX - lineWidth
            : column.align === 'center'
              ? x + (column.width - lineWidth) / 2
              : x + paddingX;
          page.drawText(line, { x: textX, y: y - 13 - lineIndex * lineHeight, size: fontSize, font: fonts.regular, color: SLATE_700 });
        });
        x += column.width;
      });
      y -= rowHeight;
    });
    y -= 9;
  };

  addPage();
  page.drawText('PIXEL PROJECT / CONTROL ADMINISTRATIVO', { x: MARGIN_X, y, size: 8, font: fonts.bold, color: INDIGO });
  y -= 22;
  page.drawText(report.title, { x: MARGIN_X, y, size: 21, font: fonts.bold, color: SLATE_950 });
  page.drawText(normalizePdfText(`Corte: ${formatDateTime(report.generatedAt)}`), { x: PAGE_WIDTH - MARGIN_X - 205, y: y + 3, size: 7.5, font: fonts.bold, color: SLATE_500 });
  y -= 17;
  page.drawText(normalizePdfText(report.scopeLabel), { x: MARGIN_X, y, size: 9, font: fonts.bold, color: SLATE_700 });
  y -= 12;
  const filterLines = wrapText(fonts.regular, report.filtersLabel, 7.2, CONTENT_WIDTH);
  drawLines(filterLines, MARGIN_X, y, 7.2, 9, fonts.regular, SLATE_500);
  y -= filterLines.length * 9 + 9;
  page.drawLine({ start: { x: MARGIN_X, y }, end: { x: PAGE_WIDTH - MARGIN_X, y }, thickness: 1, color: SLATE_300 });
  y -= 17;

  const totals = report.totals;
  drawMetrics([
    { label: 'Anticipos', value: String(totals.advanceCount), detail: `${totals.withLegalizations} con legalizaciones` },
    { label: 'Aprobado', value: formatMoney(totals.approved) },
    { label: 'Girado / abonado', value: formatMoney(totals.paid), tone: 'teal' },
    { label: 'Falta por pagar', value: formatMoney(totals.paymentPending), tone: totals.paymentPending > 0 ? 'amber' : 'teal' },
    { label: 'Justificado', value: formatMoney(totals.justified) },
    { label: 'Legalizado', value: formatMoney(totals.legalized), tone: 'teal' },
    { label: 'Costo real', value: formatMoney(totals.realCost), tone: 'teal' },
    { label: 'Pendiente justificar', value: formatMoney(totals.justificationPending), tone: totals.justificationPending > 0 ? 'amber' : 'teal' },
  ]);

  const summaryText =
    `El alcance contiene ${totals.advanceCount} anticipos: ${totals.withLegalizations} tienen legalizaciones y ${totals.withoutLegalizations} aún no registran soportes. ` +
    `Se han girado ${formatMoney(totals.paid)}, justificado ${formatMoney(totals.justified)} y legalizado ${formatMoney(totals.legalized)}; el costo real canónico es ${formatMoney(totals.realCost)}. ` +
    `Pixel identifica ${totals.administrativeDelayCount} anticipos con demora administrativa y ${totals.justificationDelayCount} con demora atribuible a la justificación del solicitante.`;
  const summaryLines = wrapText(fonts.regular, summaryText, 8.2, CONTENT_WIDTH - 18);
  const summaryHeight = summaryLines.length * 10 + 18;
  ensureSpace(summaryHeight, 'Resumen ejecutivo');
  page.drawRectangle({ x: MARGIN_X, y: y - summaryHeight, width: CONTENT_WIDTH, height: summaryHeight, borderColor: INDIGO, borderWidth: 0.7, color: INDIGO_50, opacity: 0.45 });
  drawLines(summaryLines, MARGIN_X + 9, y - 14, 8.2, 10, fonts.regular, SLATE_700);
  y -= summaryHeight + 13;

  drawSectionTitle('1', 'Balance de trabajo administrativo');
  drawTable({
    title: 'Pendientes por etapa',
    continuationLabel: 'Balance de trabajo administrativo',
    columns: [
      { label: 'Actividad pendiente', width: 230 },
      { label: 'Responsable', width: 105 },
      { label: 'Anticipos', width: 70, align: 'center' },
      { label: 'Tareas / soportes', width: 85, align: 'center' },
      { label: 'Valor asociado', width: 130, align: 'right' },
      { label: 'Mayor antigüedad', width: CONTENT_WIDTH - 620, align: 'center' },
    ],
    rows: report.queues.map((queue) => [
      queue.label,
      queue.owner,
      String(queue.advanceCount),
      String(queue.itemCount),
      formatMoney(queue.amount),
      queue.oldestDays === null ? 'Sin fecha' : `${queue.oldestDays} días`,
    ]),
  });

  drawSectionTitle('2', 'Tablero por persona');
  drawTable({
    title: 'Desagregado administrativo y financiero por responsable',
    continuationLabel: 'Tablero por persona',
    columns: [
      { label: 'Persona', width: 150 },
      { label: 'Alcance', width: 50, align: 'center' },
      { label: 'Girado', width: 80, align: 'right' },
      { label: 'Justificado', width: 80, align: 'right' },
      { label: 'Legalizado', width: 80, align: 'right' },
      { label: 'Devuelto', width: 70, align: 'right' },
      { label: 'Costo real', width: 80, align: 'right' },
      { label: 'Pendientes', width: 95, align: 'right' },
      { label: 'Gestión', width: CONTENT_WIDTH - 685, align: 'center' },
    ],
    rows: report.people.map((person) => [
      `${person.requesterName}${person.requesterEmail ? `\n${person.requesterEmail}` : ''}`,
      `${person.projectCount} proy.\n${person.advanceCount} anticipos`,
      formatMoney(person.paid),
      formatMoney(person.justified),
      formatMoney(person.legalized),
      formatMoney(person.returnedCash),
      formatMoney(person.realCost),
      `Pago ${formatMoney(person.paymentPending)}\nJustif. ${formatMoney(person.justificationPending)}`,
      `${person.administrativePendingTasks} tareas\n${person.administrativeAlertCount} alertas`,
    ]),
  });

  drawSectionTitle('3', 'Responsables con legalizaciones pendientes');
  drawTable({
    title: 'Obligaciones de justificación por solicitante',
    continuationLabel: 'Responsables con legalizaciones pendientes',
    columns: [
      { label: 'Solicitante', width: 180 },
      { label: 'Anticipos', width: 55, align: 'center' },
      { label: 'Girado', width: 95, align: 'right' },
      { label: 'Justificado', width: 95, align: 'right' },
      { label: 'Legalizado', width: 95, align: 'right' },
      { label: 'Pendiente', width: 95, align: 'right' },
      { label: 'Vencidos', width: 60, align: 'center' },
      { label: 'Mayor demora', width: CONTENT_WIDTH - 675, align: 'center' },
    ],
    rows: report.debtors.map((debtor) => [
      `${debtor.requesterName}${debtor.requesterEmail ? `\n${debtor.requesterEmail}` : ''}`,
      String(debtor.advanceCount),
      formatMoney(debtor.paid),
      formatMoney(debtor.justified),
      formatMoney(debtor.legalized),
      formatMoney(debtor.pending),
      String(debtor.overdueCount),
      debtor.oldestOverdueDays > 0 ? `${debtor.oldestOverdueDays} días` : 'A tiempo',
    ]),
  });

  drawSectionTitle('4', 'Estado y alertas por anticipo');
  drawTable({
    title: 'Detalle operativo',
    continuationLabel: 'Estado y alertas por anticipo',
    columns: [
      { label: 'ID / proyecto', width: 95 },
      { label: 'Solicitante / destino', width: 115 },
      { label: 'Etapa / responsable', width: 105 },
      { label: 'Girado', width: 72, align: 'right' },
      { label: 'Justificado', width: 72, align: 'right' },
      { label: 'Legalizado', width: 72, align: 'right' },
      { label: 'Falta pagar', width: 72, align: 'right' },
      { label: 'Falta justificar', width: 78, align: 'right' },
      { label: 'Alerta', width: CONTENT_WIDTH - 681 },
    ],
    rows: report.advances.map((advance) => [
      `${advance.id}\n${advance.projectName}`,
      `${advance.requesterName}\n${advance.destination}`,
      `${advance.stage}\n${advance.nextOwner}`,
      formatMoney(advance.paid),
      formatMoney(advance.justified),
      formatMoney(advance.legalized),
      formatMoney(advance.paymentPending),
      formatMoney(advance.justificationPending),
      `${advance.alertLabel}\n${advance.receiptCount} soporte${advance.receiptCount === 1 ? '' : 's'} · ${advance.pendingReviewCount} por validar`,
    ]),
  });

  ensureSpace(54, 'Criterios del informe');
  page.drawRectangle({ x: MARGIN_X, y: y - 48, width: CONTENT_WIDTH, height: 48, color: SLATE_100, opacity: 0.65, borderColor: SLATE_300, borderWidth: 0.5 });
  const criteria =
    `Criterios: se marca demora administrativa cuando una aprobación, pago, validación, auditoría DIAN o conciliación lleva ${report.administrativeDelayDays} días calendario o más pendiente. ` +
    'La demora de justificación inicia al superar la fecha final del anticipo con valor girado aún no soportado. Legalizado corresponde únicamente a soportes vigentes aprobados o facturas aceptadas por Auditoría DIAN. Los anticipos rechazados se excluyen de personas, conteos y valores.';
  drawLines(wrapText(fonts.regular, criteria, 6.8, CONTENT_WIDTH - 16), MARGIN_X + 8, y - 12, 6.8, 8.2, fonts.regular, SLATE_500);

  pages.forEach((targetPage, index) => {
    targetPage.drawLine({ start: { x: MARGIN_X, y: 27 }, end: { x: PAGE_WIDTH - MARGIN_X, y: 27 }, thickness: 0.5, color: SLATE_300 });
    targetPage.drawText('Pixel Project · Informe de estado de anticipos', { x: MARGIN_X, y: 14, size: 6.5, font: fonts.regular, color: SLATE_500 });
    const pageLabel = `Página ${index + 1} de ${pages.length}`;
    targetPage.drawText(pageLabel, { x: PAGE_WIDTH - MARGIN_X - fonts.regular.widthOfTextAtSize(pageLabel, 6.5), y: 14, size: 6.5, font: fonts.regular, color: SLATE_500 });
  });

  return pdf.save();
};
