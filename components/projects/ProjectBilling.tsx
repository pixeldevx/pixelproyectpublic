import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CreditCard,
  Edit,
  FileText,
  Landmark,
  Link2,
  PieChart,
  Plus,
  Receipt,
  Trash2,
  WalletCards,
  X,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { collection, query, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, orderBy, getDoc } from '@/lib/supabase/document-store';
import { db, auth } from '@/lib/backend';
import { handleDataError, OperationType } from '@/lib/backend-utils';
import {
  getRateCardCostValue,
  getRateCardIncomeValue,
  normalizeDecimalInput,
} from '@/lib/rate-card-config';
import { toast } from 'sonner';

type InvoiceStatus = 'pending' | 'partial' | 'paid' | 'cancelled';
type PaymentStatus = 'scheduled' | 'paid' | 'cancelled';
type BillingView = 'overview' | 'invoices' | 'payments' | 'budget';

interface Invoice {
  id: string;
  projectId: string;
  invoiceNumber: string;
  description: string;
  amount: number;
  collectedAmount?: number;
  date: any;
  dueDate?: any;
  status: InvoiceStatus;
  budgetLineId?: string | null;
  budgetPieceId?: string | null;
  notes?: string;
  createdAt: any;
  createdBy: string;
}

interface BillingPayment {
  id: string;
  projectId: string;
  description: string;
  vendor?: string;
  amount: number;
  date: any;
  status: PaymentStatus;
  budgetLineId?: string | null;
  budgetPieceId?: string | null;
  notes?: string;
  createdAt: any;
  createdBy: string;
}

interface BudgetPieceRef {
  id: string;
  name: string;
  category?: string;
  total: number;
}

interface BudgetLineSummary {
  id: string;
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
}

interface ProjectBillingProps {
  projectId: string;
  rateCards: any[];
  tasks: any[];
}

const todayInput = () => new Date().toISOString().split('T')[0];

const emptyInvoiceForm = () => ({
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
  description: '',
  vendor: '',
  amount: '',
  date: todayInput(),
  status: 'paid' as PaymentStatus,
  budgetLineId: '',
  budgetPieceId: '',
  notes: '',
});

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

const formatMoney = (value: any) => moneyFormatter.format(normalizeDecimalInput(value, 0));

const formatCompactMoney = (value: any) => `$${compactMoneyFormatter.format(normalizeDecimalInput(value, 0))}`;

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

const canManageBilling = (role: string) => {
  const normalized = String(role || '').toLowerCase();
  return [
    'admin',
    'manager',
    'administrativo',
    'administrador global',
    'administrador de organización',
    'administrador de organizacion',
    'gerente de proyecto',
    'coordinador',
  ].includes(normalized);
};

export default function ProjectBilling({ projectId, rateCards, tasks }: ProjectBillingProps) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<BillingPayment[]>([]);
  const [budgetLines, setBudgetLines] = useState<any[]>([]);
  const [rateCardEntries, setRateCardEntries] = useState<any[]>([]);
  const [userRole, setUserRole] = useState<string>('user');
  const [activeView, setActiveView] = useState<BillingView>('overview');
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [editingPayment, setEditingPayment] = useState<BillingPayment | null>(null);
  const [invoiceForm, setInvoiceForm] = useState(emptyInvoiceForm);
  const [paymentForm, setPaymentForm] = useState(emptyPaymentForm);
  const [modalType, setModalType] = useState<'invoice' | 'payment' | null>(null);

  const canEdit = canManageBilling(userRole);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (!user) {
        setUserRole('user');
        return;
      }

      try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        setUserRole(userDoc.exists() ? userDoc.data().role || 'user' : 'user');
      } catch (error) {
        console.error('Error fetching user role:', error);
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!projectId) return;

    const qInvoices = query(collection(db, `projects/${projectId}/invoices`), orderBy('date', 'desc'));
    const unsubscribeInvoices = onSnapshot(qInvoices, (snapshot) => {
      setInvoices(snapshot.docs.map((invoiceDoc) => ({
        id: invoiceDoc.id,
        ...invoiceDoc.data(),
      })) as Invoice[]);
    }, (error) => {
      handleDataError(error, OperationType.GET, `projects/${projectId}/invoices`);
    });

    const qPayments = query(collection(db, `projects/${projectId}/billingPayments`), orderBy('date', 'desc'));
    const unsubscribePayments = onSnapshot(qPayments, (snapshot) => {
      setPayments(snapshot.docs.map((paymentDoc) => ({
        id: paymentDoc.id,
        ...paymentDoc.data(),
      })) as BillingPayment[]);
    }, (error) => {
      handleDataError(error, OperationType.GET, `projects/${projectId}/billingPayments`);
    });

    const qBudget = query(collection(db, `projects/${projectId}/budgetLines`));
    const unsubscribeBudget = onSnapshot(qBudget, (snapshot) => {
      setBudgetLines(snapshot.docs.map((budgetDoc) => ({
        id: budgetDoc.id,
        ...budgetDoc.data(),
      })));
    }, (error) => {
      handleDataError(error, OperationType.GET, `projects/${projectId}/budgetLines`);
    });

    const qRateEntries = query(collection(db, `projects/${projectId}/rateCardEntries`));
    const unsubscribeRateEntries = onSnapshot(qRateEntries, (snapshot) => {
      setRateCardEntries(snapshot.docs.map((entryDoc) => ({
        id: entryDoc.id,
        ...entryDoc.data(),
      })));
    }, (error) => {
      handleDataError(error, OperationType.GET, `projects/${projectId}/rateCardEntries`);
    });

    return () => {
      unsubscribeInvoices();
      unsubscribePayments();
      unsubscribeBudget();
      unsubscribeRateEntries();
    };
  }, [projectId]);

  const rateCardActuals = useMemo(() => {
    return rateCards.map((card) => {
      const entries = rateCardEntries.filter((entry) => entry.rateCardId === card.id);
      const unitsFromEntries = entries.reduce((sum, entry) => sum + normalizeDecimalInput(entry.units, 0), 0);
      const userStatsTotal = card.userStats
        ? Object.values(card.userStats).reduce((sum: number, value: any) => sum + normalizeDecimalInput(value, 0), 0)
        : 0;
      const taskIndicatorTotal = tasks.reduce((sum, task) => {
        const indicator = Array.isArray(task?.indicators)
          ? task.indicators.find((item: any) => item.rateCardId === card.id)
          : null;
        return sum + normalizeDecimalInput(indicator?.value, 0);
      }, 0);

      const units = Math.max(
        normalizeDecimalInput(card.currentValue, 0),
        unitsFromEntries,
        userStatsTotal,
        taskIndicatorTotal
      );
      const reworkUnits = normalizeDecimalInput(card.reworkValue, 0);
      const estimatedIncome = getRateCardIncomeValue(units, card);
      const estimatedCost = getRateCardCostValue(units + reworkUnits, card);

      return {
        ...card,
        units,
        reworkUnits,
        entryCount: entries.length,
        estimatedIncome,
        estimatedCost,
        estimatedMargin: estimatedIncome - estimatedCost,
      };
    });
  }, [rateCards, rateCardEntries, tasks]);

  const budgetSummaries = useMemo<BudgetLineSummary[]>(() => {
    return budgetLines.map((line) => {
      const pieces = getBudgetPieces(line);
      const planned = getLinePlannedAmount(line);
      const relatedRates = rateCardActuals.filter((card) => card.budgetLineId === line.id);
      const lineInvoices = invoices.filter((invoice) => invoice.status !== 'cancelled' && invoice.budgetLineId === line.id);
      const linePayments = payments.filter((payment) => payment.status !== 'cancelled' && payment.budgetLineId === line.id);
      const realIncome = lineInvoices.reduce((sum, invoice) => sum + normalizeDecimalInput(invoice.amount, 0), 0);
      const collected = lineInvoices.reduce((sum, invoice) => sum + getInvoiceCollectedAmount(invoice), 0);
      const realCost = linePayments
        .filter((payment) => payment.status === 'paid')
        .reduce((sum, payment) => sum + normalizeDecimalInput(payment.amount, 0), 0);
      const estimatedIncome = relatedRates.reduce((sum, card) => sum + normalizeDecimalInput(card.estimatedIncome, 0), 0);
      const estimatedCost = relatedRates.reduce((sum, card) => sum + normalizeDecimalInput(card.estimatedCost, 0), 0);

      return {
        id: line.id,
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
  }, [budgetLines, invoices, payments, rateCardActuals]);

  const unassignedEstimates = useMemo(() => {
    const cards = rateCardActuals.filter((card) => !card.budgetLineId);
    return {
      income: cards.reduce((sum, card) => sum + normalizeDecimalInput(card.estimatedIncome, 0), 0),
      cost: cards.reduce((sum, card) => sum + normalizeDecimalInput(card.estimatedCost, 0), 0),
    };
  }, [rateCardActuals]);

  const totals = useMemo(() => {
    const totalPlanned = budgetSummaries.reduce((sum, line) => sum + line.planned, 0);
    const estimatedIncome = budgetSummaries.reduce((sum, line) => sum + line.estimatedIncome, 0) + unassignedEstimates.income;
    const estimatedCost = budgetSummaries.reduce((sum, line) => sum + line.estimatedCost, 0) + unassignedEstimates.cost;
    const totalInvoiced = invoices
      .filter((invoice) => invoice.status !== 'cancelled')
      .reduce((sum, invoice) => sum + normalizeDecimalInput(invoice.amount, 0), 0);
    const totalCollected = invoices.reduce((sum, invoice) => sum + getInvoiceCollectedAmount(invoice), 0);
    const totalPaidCosts = payments
      .filter((payment) => payment.status === 'paid')
      .reduce((sum, payment) => sum + normalizeDecimalInput(payment.amount, 0), 0);
    const scheduledCosts = payments
      .filter((payment) => payment.status === 'scheduled')
      .reduce((sum, payment) => sum + normalizeDecimalInput(payment.amount, 0), 0);

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
    };
  }, [budgetSummaries, invoices, payments, unassignedEstimates]);

  const chartData = useMemo(() => [
    {
      name: 'Plan',
      Planificado: totals.totalPlanned,
      Ingresos: 0,
      Costos: 0,
    },
    {
      name: 'Rate Cards',
      Planificado: 0,
      Ingresos: totals.estimatedIncome,
      Costos: totals.estimatedCost,
    },
    {
      name: 'Real',
      Planificado: 0,
      Ingresos: totals.totalCollected,
      Costos: totals.totalPaidCosts,
    },
  ], [totals]);

  const openInvoiceModal = (invoice?: Invoice) => {
    setEditingPayment(null);
    setEditingInvoice(invoice || null);
    setInvoiceForm(invoice ? {
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
    } : emptyInvoiceForm());
    setModalType('invoice');
  };

  const openPaymentModal = (payment?: BillingPayment) => {
    setEditingInvoice(null);
    setEditingPayment(payment || null);
    setPaymentForm(payment ? {
      description: payment.description || '',
      vendor: payment.vendor || '',
      amount: String(payment.amount || ''),
      date: toDateInput(payment.date) || todayInput(),
      status: payment.status || 'paid',
      budgetLineId: payment.budgetLineId || '',
      budgetPieceId: payment.budgetPieceId || '',
      notes: payment.notes || '',
    } : emptyPaymentForm());
    setModalType('payment');
  };

  const closeModal = () => {
    setModalType(null);
    setEditingInvoice(null);
    setEditingPayment(null);
  };

  const handleInvoiceSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!auth.currentUser) return;

    const amount = normalizeDecimalInput(invoiceForm.amount, 0);
    const collectedAmount = invoiceForm.status === 'paid'
      ? normalizeDecimalInput(invoiceForm.collectedAmount || amount, amount)
      : invoiceForm.status === 'cancelled'
        ? 0
        : normalizeDecimalInput(invoiceForm.collectedAmount, 0);

    const invoiceData = {
      projectId,
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
    };

    try {
      if (editingInvoice) {
        await updateDoc(doc(db, `projects/${projectId}/invoices`, editingInvoice.id), invoiceData);
        toast.success('Factura actualizada');
      } else {
        await addDoc(collection(db, `projects/${projectId}/invoices`), {
          ...invoiceData,
          createdAt: serverTimestamp(),
          createdBy: auth.currentUser.uid,
        });
        toast.success('Factura creada');
      }

      closeModal();
    } catch (error) {
      handleDataError(error, editingInvoice ? OperationType.UPDATE : OperationType.CREATE, `projects/${projectId}/invoices`);
      toast.error('No se pudo guardar la factura');
    }
  };

  const handlePaymentSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!auth.currentUser) return;

    const paymentData = {
      projectId,
      description: paymentForm.description.trim(),
      vendor: paymentForm.vendor.trim(),
      amount: normalizeDecimalInput(paymentForm.amount, 0),
      date: new Date(paymentForm.date),
      status: paymentForm.status,
      budgetLineId: paymentForm.budgetLineId || null,
      budgetPieceId: paymentForm.budgetPieceId || null,
      notes: paymentForm.notes.trim(),
    };

    try {
      if (editingPayment) {
        await updateDoc(doc(db, `projects/${projectId}/billingPayments`, editingPayment.id), paymentData);
        toast.success('Pago actualizado');
      } else {
        await addDoc(collection(db, `projects/${projectId}/billingPayments`), {
          ...paymentData,
          createdAt: serverTimestamp(),
          createdBy: auth.currentUser.uid,
        });
        toast.success('Pago registrado');
      }

      closeModal();
    } catch (error) {
      handleDataError(error, editingPayment ? OperationType.UPDATE : OperationType.CREATE, `projects/${projectId}/billingPayments`);
      toast.error('No se pudo guardar el pago');
    }
  };

  const handleDeleteInvoice = async (invoiceId: string) => {
    if (!confirm('¿Eliminar esta factura?')) return;
    try {
      await deleteDoc(doc(db, `projects/${projectId}/invoices`, invoiceId));
      toast.success('Factura eliminada');
    } catch (error) {
      handleDataError(error, OperationType.DELETE, `projects/${projectId}/invoices/${invoiceId}`);
      toast.error('No se pudo eliminar la factura');
    }
  };

  const handleDeletePayment = async (paymentId: string) => {
    if (!confirm('¿Eliminar este pago real?')) return;
    try {
      await deleteDoc(doc(db, `projects/${projectId}/billingPayments`, paymentId));
      toast.success('Pago eliminado');
    } catch (error) {
      handleDataError(error, OperationType.DELETE, `projects/${projectId}/billingPayments/${paymentId}`);
      toast.error('No se pudo eliminar el pago');
    }
  };

  const getBudgetLineName = (lineId?: string | null) =>
    budgetSummaries.find((line) => line.id === lineId)?.name || 'Sin línea';

  const getBudgetPieceName = (lineId?: string | null, pieceId?: string | null) => {
    const line = budgetSummaries.find((candidate) => candidate.id === lineId);
    return line?.pieces.find((piece) => piece.id === pieceId)?.name || 'Sin pieza';
  };

  const selectedInvoiceLine = budgetSummaries.find((line) => line.id === invoiceForm.budgetLineId);
  const selectedPaymentLine = budgetSummaries.find((line) => line.id === paymentForm.budgetLineId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-black uppercase tracking-[0.24em] text-blue-700">
            <Receipt size={14} />
            Finanzas reales del proyecto
          </div>
          <h2 className="mt-3 flex items-center gap-2 text-2xl font-black text-slate-950">
            <FileText size={24} className="text-blue-600" />
            Facturación y Cobros
          </h2>
          <p className="mt-1 max-w-3xl text-sm font-semibold text-slate-500">
            Compara el avance operativo estimado por Rate Cards, lo planificado en presupuesto y la realidad de facturas, cobros y pagos.
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => openPaymentModal()} variant="outline" className="h-11 border-slate-200 bg-white font-black text-slate-700">
              <CreditCard size={16} className="mr-2" />
              Nuevo pago
            </Button>
            <Button onClick={() => openInvoiceModal()} className="h-11 bg-blue-600 font-black text-white hover:bg-blue-700">
              <Plus size={16} className="mr-2" />
              Nueva factura
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="Ingresos reales"
          value={formatMoney(totals.totalCollected)}
          helper={`${formatMoney(totals.totalInvoiced)} facturado`}
          icon={<ArrowUpRight size={20} />}
          tone="emerald"
        />
        <MetricCard
          label="Costos reales"
          value={formatMoney(totals.totalPaidCosts)}
          helper={`${formatMoney(totals.scheduledCosts)} programado`}
          icon={<ArrowDownRight size={20} />}
          tone="rose"
        />
        <MetricCard
          label="Margen real"
          value={formatMoney(totals.realMargin)}
          helper={`${totals.realMarginPercent.toFixed(1)}% sobre cobrado`}
          icon={<TrendingIcon positive={totals.realMargin >= 0} />}
          tone={totals.realMargin >= 0 ? 'blue' : 'rose'}
        />
        <MetricCard
          label="Estimado operativo"
          value={formatMoney(totals.estimatedIncome - totals.estimatedCost)}
          helper={`${formatMoney(totals.estimatedIncome)} ing. / ${formatMoney(totals.estimatedCost)} costo`}
          icon={<WalletCards size={20} />}
          tone="violet"
        />
        <MetricCard
          label="Presupuesto"
          value={formatMoney(totals.totalPlanned)}
          helper={`${budgetSummaries.length} líneas planificadas`}
          icon={<Landmark size={20} />}
          tone="slate"
        />
      </div>

      <div className="rounded-[18px] border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {[
              ['overview', 'Resumen'],
              ['invoices', 'Facturas'],
              ['payments', 'Pagos reales'],
              ['budget', 'Presupuesto vs real'],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveView(key as BillingView)}
                className={`rounded-xl px-4 py-2 text-sm font-black transition ${
                  activeView === key
                    ? 'bg-slate-950 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-black uppercase tracking-[0.14em] text-slate-500">
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">{invoices.length} facturas</span>
            <span className="rounded-full bg-rose-50 px-3 py-1 text-rose-700">{payments.length} pagos</span>
            <span className="rounded-full bg-indigo-50 px-3 py-1 text-indigo-700">{rateCardActuals.length} rates</span>
          </div>
        </div>

        {activeView === 'overview' && (
          <div className="grid gap-5 p-5 xl:grid-cols-[1.25fr_0.75fr]">
            <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="flex items-center gap-2 text-lg font-black text-slate-950">
                    <BarChart3 size={20} className="text-indigo-600" />
                    Pulso financiero
                  </h3>
                  <p className="text-sm font-semibold text-slate-500">Planificado vs operativo estimado vs realidad financiera.</p>
                </div>
              </div>
              <div className="mt-5 h-[290px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 12, right: 24, left: 12, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b', fontWeight: 800 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={formatCompactMoney} />
                    <RechartsTooltip
                      formatter={(value: any, name: any) => [formatMoney(value), String(name || '')]}
                      cursor={{ fill: '#eef2ff' }}
                      contentStyle={{ borderRadius: 14, border: '1px solid #e2e8f0', boxShadow: '0 18px 40px rgb(15 23 42 / 0.14)' }}
                    />
                    <Bar dataKey="Planificado" fill="#64748b" radius={[8, 8, 0, 0]} maxBarSize={52} />
                    <Bar dataKey="Ingresos" fill="#10b981" radius={[8, 8, 0, 0]} maxBarSize={52} />
                    <Bar dataKey="Costos" fill="#ef4444" radius={[8, 8, 0, 0]} maxBarSize={52} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="space-y-4">
              <InsightCard
                title="Caja por cobrar"
                value={formatMoney(totals.pendingCollection)}
                body="Diferencia entre facturado y cobrado. Este es el dinero real pendiente de entrar."
                tone="blue"
              />
              <InsightCard
                title="No confundir"
                value="Rate Cards = estimado"
                body="Los Rate Cards explican avance operativo y expectativa económica. La realidad se confirma con facturas y pagos."
                tone="violet"
              />
              <InsightCard
                title="Costos sin línea"
                value={formatMoney(payments.filter((payment) => payment.status === 'paid' && !payment.budgetLineId).reduce((sum, payment) => sum + normalizeDecimalInput(payment.amount, 0), 0))}
                body="Pagos reales que todavía no están asociados a una línea o pieza de presupuesto."
                tone="rose"
              />
            </div>
          </div>
        )}

        {activeView === 'invoices' && (
          <InvoiceTable
            invoices={invoices}
            canEdit={canEdit}
            getBudgetLineName={getBudgetLineName}
            getBudgetPieceName={getBudgetPieceName}
            onEdit={openInvoiceModal}
            onDelete={handleDeleteInvoice}
          />
        )}

        {activeView === 'payments' && (
          <PaymentTable
            payments={payments}
            canEdit={canEdit}
            getBudgetLineName={getBudgetLineName}
            getBudgetPieceName={getBudgetPieceName}
            onEdit={openPaymentModal}
            onDelete={handleDeletePayment}
          />
        )}

        {activeView === 'budget' && (
          <BudgetRealityTable lines={budgetSummaries} unassignedEstimates={unassignedEstimates} />
        )}
      </div>

      {modalType === 'invoice' && (
        <BillingModal title={editingInvoice ? 'Editar factura real' : 'Nueva factura real'} onClose={closeModal}>
          <form onSubmit={handleInvoiceSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Número de factura">
                <input
                  type="text"
                  required
                  value={invoiceForm.invoiceNumber}
                  onChange={(event) => setInvoiceForm({ ...invoiceForm, invoiceNumber: event.target.value })}
                  className="billing-input"
                  placeholder="Ej: FAC-001"
                />
              </Field>
              <Field label="Estado de cobro">
                <select
                  value={invoiceForm.status}
                  onChange={(event) => setInvoiceForm({ ...invoiceForm, status: event.target.value as InvoiceStatus })}
                  className="billing-input"
                >
                  <option value="pending">Pendiente</option>
                  <option value="partial">Cobro parcial</option>
                  <option value="paid">Cobrada</option>
                  <option value="cancelled">Cancelada</option>
                </select>
              </Field>
            </div>

            <Field label="Descripción">
              <input
                type="text"
                value={invoiceForm.description}
                onChange={(event) => setInvoiceForm({ ...invoiceForm, description: event.target.value })}
                className="billing-input"
                placeholder="Concepto de facturación"
              />
            </Field>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Monto facturado">
                <input
                  type="text"
                  inputMode="decimal"
                  required
                  value={invoiceForm.amount}
                  onChange={(event) => setInvoiceForm({ ...invoiceForm, amount: event.target.value })}
                  className="billing-input"
                  placeholder="0"
                />
              </Field>
              <Field label="Monto cobrado">
                <input
                  type="text"
                  inputMode="decimal"
                  value={invoiceForm.collectedAmount}
                  onChange={(event) => setInvoiceForm({ ...invoiceForm, collectedAmount: event.target.value })}
                  className="billing-input"
                  placeholder="Vacío = 0, cobrada = total"
                />
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Fecha de factura">
                <input
                  type="date"
                  required
                  value={invoiceForm.date}
                  onChange={(event) => setInvoiceForm({ ...invoiceForm, date: event.target.value })}
                  className="billing-input"
                />
              </Field>
              <Field label="Fecha esperada de cobro">
                <input
                  type="date"
                  value={invoiceForm.dueDate}
                  onChange={(event) => setInvoiceForm({ ...invoiceForm, dueDate: event.target.value })}
                  className="billing-input"
                />
              </Field>
            </div>

            <BudgetAssociationFields
              budgetLines={budgetSummaries}
              selectedLineId={invoiceForm.budgetLineId}
              selectedPieceId={invoiceForm.budgetPieceId}
              selectedLine={selectedInvoiceLine}
              onLineChange={(budgetLineId) => setInvoiceForm({ ...invoiceForm, budgetLineId, budgetPieceId: '' })}
              onPieceChange={(budgetPieceId) => setInvoiceForm({ ...invoiceForm, budgetPieceId })}
            />

            <Field label="Notas">
              <textarea
                value={invoiceForm.notes}
                onChange={(event) => setInvoiceForm({ ...invoiceForm, notes: event.target.value })}
                className="billing-input min-h-[84px]"
                placeholder="Condiciones, soporte o comentarios internos"
              />
            </Field>

            <ModalActions onCancel={closeModal} submitLabel={editingInvoice ? 'Actualizar factura' : 'Crear factura'} />
          </form>
        </BillingModal>
      )}

      {modalType === 'payment' && (
        <BillingModal title={editingPayment ? 'Editar pago real' : 'Registrar pago real'} onClose={closeModal}>
          <form onSubmit={handlePaymentSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Proveedor o responsable">
                <input
                  type="text"
                  value={paymentForm.vendor}
                  onChange={(event) => setPaymentForm({ ...paymentForm, vendor: event.target.value })}
                  className="billing-input"
                  placeholder="Empresa o persona"
                />
              </Field>
              <Field label="Estado del pago">
                <select
                  value={paymentForm.status}
                  onChange={(event) => setPaymentForm({ ...paymentForm, status: event.target.value as PaymentStatus })}
                  className="billing-input"
                >
                  <option value="paid">Pagado</option>
                  <option value="scheduled">Programado</option>
                  <option value="cancelled">Cancelado</option>
                </select>
              </Field>
            </div>

            <Field label="Descripción del pago">
              <input
                type="text"
                required
                value={paymentForm.description}
                onChange={(event) => setPaymentForm({ ...paymentForm, description: event.target.value })}
                className="billing-input"
                placeholder="Concepto real del costo"
              />
            </Field>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Monto pagado">
                <input
                  type="text"
                  inputMode="decimal"
                  required
                  value={paymentForm.amount}
                  onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })}
                  className="billing-input"
                  placeholder="0"
                />
              </Field>
              <Field label="Fecha del pago">
                <input
                  type="date"
                  required
                  value={paymentForm.date}
                  onChange={(event) => setPaymentForm({ ...paymentForm, date: event.target.value })}
                  className="billing-input"
                />
              </Field>
            </div>

            <BudgetAssociationFields
              budgetLines={budgetSummaries}
              selectedLineId={paymentForm.budgetLineId}
              selectedPieceId={paymentForm.budgetPieceId}
              selectedLine={selectedPaymentLine}
              onLineChange={(budgetLineId) => setPaymentForm({ ...paymentForm, budgetLineId, budgetPieceId: '' })}
              onPieceChange={(budgetPieceId) => setPaymentForm({ ...paymentForm, budgetPieceId })}
            />

            <Field label="Notas">
              <textarea
                value={paymentForm.notes}
                onChange={(event) => setPaymentForm({ ...paymentForm, notes: event.target.value })}
                className="billing-input min-h-[84px]"
                placeholder="Soporte, condición o detalle del pago"
              />
            </Field>

            <ModalActions onCancel={closeModal} submitLabel={editingPayment ? 'Actualizar pago' : 'Registrar pago'} />
          </form>
        </BillingModal>
      )}

      <style jsx global>{`
        .billing-input {
          width: 100%;
          border-radius: 0.9rem;
          border: 1px solid #dbe4f0;
          background: #fff;
          padding: 0.75rem 0.9rem;
          font-size: 0.9rem;
          font-weight: 700;
          color: #0f172a;
          outline: none;
          transition: border-color 160ms ease, box-shadow 160ms ease;
        }
        .billing-input:focus {
          border-color: #4f46e5;
          box-shadow: 0 0 0 4px rgb(79 70 229 / 0.12);
        }
      `}</style>
    </div>
  );
}

function TrendingIcon({ positive }: { positive: boolean }) {
  return positive ? <ArrowUpRight size={20} /> : <ArrowDownRight size={20} />;
}

function MetricCard({
  label,
  value,
  helper,
  icon,
  tone,
}: {
  label: string;
  value: string;
  helper: string;
  icon: React.ReactNode;
  tone: 'emerald' | 'rose' | 'blue' | 'violet' | 'slate';
}) {
  const toneClasses = {
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    rose: 'bg-rose-50 text-rose-700 ring-rose-100',
    blue: 'bg-blue-50 text-blue-700 ring-blue-100',
    violet: 'bg-violet-50 text-violet-700 ring-violet-100',
    slate: 'bg-slate-100 text-slate-700 ring-slate-200',
  };

  return (
    <div className="rounded-[18px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">{label}</p>
          <p className="mt-3 text-2xl font-black text-slate-950">{value}</p>
          <p className="mt-1 text-sm font-bold text-slate-500">{helper}</p>
        </div>
        <div className={`rounded-2xl p-3 ring-1 ${toneClasses[tone]}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

function InsightCard({
  title,
  value,
  body,
  tone,
}: {
  title: string;
  value: string;
  body: string;
  tone: 'blue' | 'violet' | 'rose';
}) {
  const toneClasses = {
    blue: 'bg-blue-50 text-blue-800 ring-blue-100',
    violet: 'bg-violet-50 text-violet-800 ring-violet-100',
    rose: 'bg-rose-50 text-rose-800 ring-rose-100',
  };

  return (
    <div className={`rounded-2xl p-5 ring-1 ${toneClasses[tone]}`}>
      <p className="text-xs font-black uppercase tracking-[0.18em] opacity-70">{title}</p>
      <p className="mt-2 text-xl font-black">{value}</p>
      <p className="mt-2 text-sm font-semibold leading-relaxed opacity-80">{body}</p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-black uppercase tracking-[0.12em] ring-1 ${statusStyles[status] || statusStyles.pending}`}>
      {statusLabels[status] || status}
    </span>
  );
}

function InvoiceTable({
  invoices,
  canEdit,
  getBudgetLineName,
  getBudgetPieceName,
  onEdit,
  onDelete,
}: {
  invoices: Invoice[];
  canEdit: boolean;
  getBudgetLineName: (lineId?: string | null) => string;
  getBudgetPieceName: (lineId?: string | null, pieceId?: string | null) => string;
  onEdit: (invoice: Invoice) => void;
  onDelete: (invoiceId: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-left text-sm">
        <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-400">
          <tr>
            <th className="px-5 py-4">Factura</th>
            <th className="px-5 py-4">Concepto</th>
            <th className="px-5 py-4">Presupuesto vinculado</th>
            <th className="px-5 py-4">Fecha</th>
            <th className="px-5 py-4 text-right">Facturado</th>
            <th className="px-5 py-4 text-right">Cobrado</th>
            <th className="px-5 py-4 text-center">Estado</th>
            {canEdit && <th className="px-5 py-4 text-right">Acciones</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {invoices.length === 0 ? (
            <EmptyRow columns={canEdit ? 8 : 7} icon={<FileText size={30} />} text="No hay facturas registradas" />
          ) : invoices.map((invoice) => (
            <tr key={invoice.id} className="hover:bg-blue-50/40">
              <td className="px-5 py-4 font-black text-slate-950">{invoice.invoiceNumber || 'Sin número'}</td>
              <td className="px-5 py-4">
                <p className="font-bold text-slate-700">{invoice.description || 'Sin descripción'}</p>
                {invoice.notes && <p className="mt-1 max-w-[320px] truncate text-xs font-semibold text-slate-400">{invoice.notes}</p>}
              </td>
              <td className="px-5 py-4 text-xs font-black text-slate-500">
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1">
                  <Link2 size={12} />
                  {getBudgetLineName(invoice.budgetLineId)}
                </span>
                {invoice.budgetPieceId && <p className="mt-1 text-slate-400">{getBudgetPieceName(invoice.budgetLineId, invoice.budgetPieceId)}</p>}
              </td>
              <td className="px-5 py-4 font-semibold text-slate-500">
                {formatDate(invoice.date)}
                {invoice.dueDate && <p className="text-xs text-slate-400">Cobro: {formatDate(invoice.dueDate)}</p>}
              </td>
              <td className="px-5 py-4 text-right font-black text-slate-950">{formatMoney(invoice.amount)}</td>
              <td className="px-5 py-4 text-right font-black text-emerald-700">{formatMoney(getInvoiceCollectedAmount(invoice))}</td>
              <td className="px-5 py-4 text-center"><StatusPill status={invoice.status} /></td>
              {canEdit && (
                <td className="px-5 py-4">
                  <div className="flex justify-end gap-2">
                    <IconButton title="Editar factura" onClick={() => onEdit(invoice)}><Edit size={16} /></IconButton>
                    <IconButton title="Eliminar factura" danger onClick={() => onDelete(invoice.id)}><Trash2 size={16} /></IconButton>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PaymentTable({
  payments,
  canEdit,
  getBudgetLineName,
  getBudgetPieceName,
  onEdit,
  onDelete,
}: {
  payments: BillingPayment[];
  canEdit: boolean;
  getBudgetLineName: (lineId?: string | null) => string;
  getBudgetPieceName: (lineId?: string | null, pieceId?: string | null) => string;
  onEdit: (payment: BillingPayment) => void;
  onDelete: (paymentId: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[920px] text-left text-sm">
        <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-400">
          <tr>
            <th className="px-5 py-4">Pago real</th>
            <th className="px-5 py-4">Proveedor</th>
            <th className="px-5 py-4">Presupuesto vinculado</th>
            <th className="px-5 py-4">Fecha</th>
            <th className="px-5 py-4 text-right">Monto</th>
            <th className="px-5 py-4 text-center">Estado</th>
            {canEdit && <th className="px-5 py-4 text-right">Acciones</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {payments.length === 0 ? (
            <EmptyRow columns={canEdit ? 7 : 6} icon={<CreditCard size={30} />} text="No hay pagos reales registrados" />
          ) : payments.map((payment) => (
            <tr key={payment.id} className="hover:bg-rose-50/30">
              <td className="px-5 py-4">
                <p className="font-black text-slate-950">{payment.description || 'Pago sin descripción'}</p>
                {payment.notes && <p className="mt-1 max-w-[320px] truncate text-xs font-semibold text-slate-400">{payment.notes}</p>}
              </td>
              <td className="px-5 py-4 font-bold text-slate-600">{payment.vendor || 'Sin proveedor'}</td>
              <td className="px-5 py-4 text-xs font-black text-slate-500">
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1">
                  <Link2 size={12} />
                  {getBudgetLineName(payment.budgetLineId)}
                </span>
                {payment.budgetPieceId && <p className="mt-1 text-slate-400">{getBudgetPieceName(payment.budgetLineId, payment.budgetPieceId)}</p>}
              </td>
              <td className="px-5 py-4 font-semibold text-slate-500">{formatDate(payment.date)}</td>
              <td className="px-5 py-4 text-right font-black text-rose-700">{formatMoney(payment.amount)}</td>
              <td className="px-5 py-4 text-center"><StatusPill status={payment.status} /></td>
              {canEdit && (
                <td className="px-5 py-4">
                  <div className="flex justify-end gap-2">
                    <IconButton title="Editar pago" onClick={() => onEdit(payment)}><Edit size={16} /></IconButton>
                    <IconButton title="Eliminar pago" danger onClick={() => onDelete(payment.id)}><Trash2 size={16} /></IconButton>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BudgetRealityTable({
  lines,
  unassignedEstimates,
}: {
  lines: BudgetLineSummary[];
  unassignedEstimates: { income: number; cost: number };
}) {
  return (
    <div className="p-5">
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-black text-slate-950">
            <PieChart size={20} className="text-blue-600" />
            Presupuesto vs realidad
          </h3>
          <p className="text-sm font-semibold text-slate-500">Cada línea cruza plan, Rate Cards estimados, facturas y pagos reales.</p>
        </div>
        {(unassignedEstimates.income > 0 || unassignedEstimates.cost > 0) && (
          <div className="rounded-xl bg-amber-50 px-4 py-2 text-xs font-black text-amber-800 ring-1 ring-amber-100">
            Estimado sin línea: {formatMoney(unassignedEstimates.income - unassignedEstimates.cost)}
          </div>
        )}
      </div>
      <div className="space-y-3">
        {lines.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-sm font-bold text-slate-400">
            No hay líneas de presupuesto para cruzar.
          </div>
        ) : lines.map((line) => {
          const plannedUsage = line.planned > 0 ? Math.min((line.realCost / line.planned) * 100, 100) : 0;
          const realMarginTone = line.margin >= 0 ? 'text-emerald-700' : 'text-rose-700';

          return (
            <div key={line.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ background: line.color }} />
                    <h4 className="truncate text-base font-black text-slate-950">{line.name}</h4>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-black text-slate-500">{line.pieces.length} piezas</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-rose-500" style={{ width: `${plannedUsage}%` }} />
                  </div>
                  <p className="mt-1 text-xs font-bold text-slate-400">Uso real del presupuesto: {plannedUsage.toFixed(1)}%</p>
                </div>
                <div className="grid min-w-[620px] grid-cols-5 gap-2 text-sm">
                  <LineFigure label="Plan" value={formatMoney(line.planned)} />
                  <LineFigure label="Rate ingreso" value={formatMoney(line.estimatedIncome)} tone="emerald" />
                  <LineFigure label="Rate costo" value={formatMoney(line.estimatedCost)} tone="rose" />
                  <LineFigure label="Cobrado real" value={formatMoney(line.collected)} tone="blue" />
                  <LineFigure label="Margen real" value={formatMoney(line.margin)} valueClassName={realMarginTone} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LineFigure({
  label,
  value,
  tone = 'slate',
  valueClassName = '',
}: {
  label: string;
  value: string;
  tone?: 'slate' | 'emerald' | 'rose' | 'blue';
  valueClassName?: string;
}) {
  const toneClasses = {
    slate: 'bg-slate-50',
    emerald: 'bg-emerald-50',
    rose: 'bg-rose-50',
    blue: 'bg-blue-50',
  };
  return (
    <div className={`rounded-xl p-3 ${toneClasses[tone]}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{label}</p>
      <p className={`mt-1 text-sm font-black text-slate-950 ${valueClassName}`}>{value}</p>
    </div>
  );
}

function EmptyRow({ columns, icon, text }: { columns: number; icon: React.ReactNode; text: string }) {
  return (
    <tr>
      <td colSpan={columns} className="px-6 py-14 text-center">
        <div className="mx-auto flex max-w-sm flex-col items-center justify-center text-slate-400">
          <div className="mb-3 rounded-2xl bg-slate-50 p-4 text-slate-300">{icon}</div>
          <p className="text-sm font-bold">{text}</p>
        </div>
      </td>
    </tr>
  );
}

function IconButton({
  title,
  danger,
  onClick,
  children,
}: {
  title: string;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`rounded-xl p-2 transition ${
        danger
          ? 'text-slate-400 hover:bg-rose-50 hover:text-rose-600'
          : 'text-slate-400 hover:bg-blue-50 hover:text-blue-600'
      }`}
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-black uppercase tracking-[0.16em] text-slate-400">{label}</span>
      {children}
    </label>
  );
}

function BudgetAssociationFields({
  budgetLines,
  selectedLineId,
  selectedPieceId,
  selectedLine,
  onLineChange,
  onPieceChange,
}: {
  budgetLines: BudgetLineSummary[];
  selectedLineId: string;
  selectedPieceId: string;
  selectedLine?: BudgetLineSummary;
  onLineChange: (value: string) => void;
  onPieceChange: (value: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4">
      <div className="mb-3 flex items-start gap-2 text-sm font-bold text-blue-900">
        <Link2 size={16} className="mt-0.5 text-blue-600" />
        <div>
          <p>Asociación presupuestal</p>
          <p className="text-xs font-semibold text-blue-600">Opcional: conecta el movimiento real con una línea o pieza del presupuesto.</p>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Línea de presupuesto">
          <select value={selectedLineId} onChange={(event) => onLineChange(event.target.value)} className="billing-input">
            <option value="">Sin línea asociada</option>
            {budgetLines.map((line) => (
              <option key={line.id} value={line.id}>{line.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Pieza específica">
          <select
            value={selectedPieceId}
            onChange={(event) => onPieceChange(event.target.value)}
            className="billing-input"
            disabled={!selectedLine}
          >
            <option value="">Sin pieza específica</option>
            {selectedLine?.pieces.map((piece) => (
              <option key={piece.id} value={piece.id}>{piece.name}</option>
            ))}
          </select>
        </Field>
      </div>
    </div>
  );
}

function BillingModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[22px] bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-6">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-blue-600">Movimiento financiero real</p>
            <h3 className="mt-1 text-2xl font-black text-slate-950">{title}</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={20} />
          </button>
        </div>
        <div className="overflow-y-auto p-6">
          {children}
        </div>
      </div>
    </div>
  );
}

function ModalActions({ onCancel, submitLabel }: { onCancel: () => void; submitLabel: string }) {
  return (
    <div className="flex justify-end gap-3 border-t border-slate-100 pt-5">
      <Button type="button" variant="outline" onClick={onCancel}>
        Cancelar
      </Button>
      <Button type="submit" className="bg-slate-950 text-white hover:bg-slate-800">
        {submitLabel}
      </Button>
    </div>
  );
}
