export type AdministrativeMetricReceipt = {
  id?: string;
  status?: string;
  amount?: number | string;
  documentType?: string;
  accountingAuditStatus?: string;
  billingPaymentId?: string;
};

export type AdministrativeMetricPaymentSupport = {
  id?: string;
  documentId?: string;
  billingPaymentId?: string;
  amount?: number | string;
  date?: unknown;
  paidAt?: unknown;
  fileName?: string;
};

export type AdministrativeMetricAdvance = {
  status?: string;
  reconciliationStatus?: string;
  amountRequested?: number | string;
  amountApproved?: number | string | null;
  amountPaid?: number | string;
  amountLegalized?: number | string;
  amountReturned?: number | string;
  receipts?: AdministrativeMetricReceipt[];
  paymentSupport?: AdministrativeMetricPaymentSupport | null;
  paymentSupports?: AdministrativeMetricPaymentSupport[];
};

export type AdministrativeAdvanceFinancials = {
  operational: boolean;
  reconciled: boolean;
  requested: number;
  approved: number;
  paid: number;
  paymentPending: number;
  justified: number;
  legalized: number;
  returnedCash: number;
  justificationPending: number;
  administrativePendingAmount: number;
  receiptCount: number;
  legalizedReceiptCount: number;
  returnedReceiptCount: number;
  persistedLegalized: number;
  legalizedDrift: number;
};

const POST_APPROVAL_STATUSES = new Set([
  'pending_payment',
  'partially_paid',
  'paid',
  'approved',
  'completed',
  'closed',
]);

export const asAdministrativeNumber = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

export const roundAdministrativeMoney = (value: unknown) =>
  Math.round((asAdministrativeNumber(value) + Number.EPSILON) * 100) / 100;

const hasNumericValue = (value: unknown) =>
  value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

const receiptIdentity = (receipt: AdministrativeMetricReceipt, index: number) => {
  const id = String(receipt.id || '').trim();
  return id ? `id:${id}` : `position:${index}`;
};

export const getUniqueAdministrativeReceipts = (advance: AdministrativeMetricAdvance) => {
  const byIdentity = new Map<string, AdministrativeMetricReceipt>();
  (Array.isArray(advance.receipts) ? advance.receipts : []).forEach((receipt, index) => {
    if (!receipt) return;
    byIdentity.set(receiptIdentity(receipt, index), receipt);
  });
  return [...byIdentity.values()];
};

export const isCurrentJustificationReceipt = (receipt: AdministrativeMetricReceipt) =>
  !['rejected', 'returned'].includes(String(receipt.status || ''));

export const isLegalizedAdministrativeReceipt = (receipt: AdministrativeMetricReceipt) => {
  const status = String(receipt.status || '');
  const accountingStatus = String(receipt.accountingAuditStatus || '');
  const documentType = String(receipt.documentType || 'invoice');

  if (status === 'returned' || status === 'rejected') return false;

  if (documentType === 'invoice') {
    return status === 'audit_passed' || accountingStatus === 'matched';
  }

  return ['approved', 'approved_modified', 'audit_passed'].includes(status);
};

const paymentSupportIdentity = (support: AdministrativeMetricPaymentSupport) => {
  const stableId = support.billingPaymentId || support.documentId || support.id;
  return stableId ? `id:${String(stableId)}` : '';
};

export const getAdministrativePaymentSupports = (advance: AdministrativeMetricAdvance) => {
  const seenSupportIds = new Set<string>();
  const supports = (Array.isArray(advance.paymentSupports) ? advance.paymentSupports.filter(Boolean) : [])
    .filter((support) => {
      const identity = paymentSupportIdentity(support);
      if (!identity) return true;
      if (seenSupportIds.has(identity)) return false;
      seenSupportIds.add(identity);
      return true;
    });
  const legacySupport = advance.paymentSupport || null;
  const legacyKey = legacySupport ? paymentSupportIdentity(legacySupport) : '';
  const legacyAlreadyIncluded = Boolean(
    legacySupport &&
      legacyKey &&
      supports.some((support) => paymentSupportIdentity(support) === legacyKey)
  );

  if (legacySupport && !legacyAlreadyIncluded) return [legacySupport, ...supports];
  if (supports.length > 0) return supports;
  return legacySupport ? [legacySupport] : [];
};

export const getAdministrativePaidAmount = (advance: AdministrativeMetricAdvance) => {
  const supports = getAdministrativePaymentSupports(advance);
  if (supports.length > 0) {
    return roundAdministrativeMoney(
      supports.reduce((total, support) => total + asAdministrativeNumber(support.amount), 0)
    );
  }
  return roundAdministrativeMoney(advance.amountPaid);
};

export const getAdministrativeApprovedAmount = (advance: AdministrativeMetricAdvance) => {
  if (hasNumericValue(advance.amountApproved)) {
    return Math.max(0, roundAdministrativeMoney(advance.amountApproved));
  }

  const status = String(advance.status || '');
  return POST_APPROVAL_STATUSES.has(status)
    ? Math.max(0, roundAdministrativeMoney(advance.amountRequested))
    : 0;
};

export const calculateAdministrativeAdvanceFinancials = (
  advance: AdministrativeMetricAdvance
): AdministrativeAdvanceFinancials => {
  const receipts = getUniqueAdministrativeReceipts(advance);
  const currentReceipts = receipts.filter(isCurrentJustificationReceipt);
  const legalizedReceipts = receipts.filter(isLegalizedAdministrativeReceipt);
  const requested = Math.max(0, roundAdministrativeMoney(advance.amountRequested));
  const approved = getAdministrativeApprovedAmount(advance);
  const paid = Math.max(0, getAdministrativePaidAmount(advance));
  const returnedCash = Math.max(0, roundAdministrativeMoney(advance.amountReturned));
  const justified = roundAdministrativeMoney(
    currentReceipts.reduce((total, receipt) => total + asAdministrativeNumber(receipt.amount), 0)
  );
  const legalized = roundAdministrativeMoney(
    legalizedReceipts.reduce((total, receipt) => total + asAdministrativeNumber(receipt.amount), 0)
  );
  const persistedLegalized = roundAdministrativeMoney(advance.amountLegalized);
  const reconciled = advance.status === 'closed' || advance.reconciliationStatus === 'reconciled';
  const operational = advance.status !== 'rejected';
  const inactive = !operational || reconciled;
  const canReceivePayment = !inactive && !['submitted', 'returned'].includes(String(advance.status || ''));
  const paymentPending = canReceivePayment ? Math.max(0, roundAdministrativeMoney(approved - paid)) : 0;
  const justificationPending = inactive
    ? 0
    : Math.max(0, roundAdministrativeMoney(paid - returnedCash - justified));

  return {
    operational,
    reconciled,
    requested,
    approved,
    paid,
    paymentPending,
    justified,
    legalized,
    returnedCash,
    justificationPending,
    administrativePendingAmount: Math.max(0, roundAdministrativeMoney(justified - legalized)),
    receiptCount: currentReceipts.length,
    legalizedReceiptCount: legalizedReceipts.length,
    returnedReceiptCount: receipts.filter((receipt) => receipt.status === 'returned').length,
    persistedLegalized,
    legalizedDrift: roundAdministrativeMoney(legalized - persistedLegalized),
  };
};
