import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CreditCard, Plus, Trash2, AlertCircle, X, TrendingUp, Users, FileText, Download, Upload, DollarSign, WalletCards, Target, Wrench, RefreshCw, Save, CalendarRange, ChevronDown } from 'lucide-react';
import { collection, query, onSnapshot, addDoc, deleteDoc, doc, serverTimestamp, updateDoc, writeBatch } from '@/lib/supabase/document-store';
import { db } from '@/lib/backend';
import { toast } from 'sonner';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Cell } from 'recharts';
import {
  formatRateCardRate,
  formatRateCardUnits,
  formatRateCardValue,
  getRateCardCostRate,
  getRateCardCostValue,
  getRateCardIncomeRate,
  getRateCardIncomeValue,
  getRateCardOutputValue,
  isCurrencyRateCard,
  normalizeDecimalInput,
  normalizeRateCardValueType,
} from '@/lib/rate-card-config';
import { syncRateDrivenIncrementalTasksForRate } from '@/lib/incremental-rate-tasks';
import { getTaskTitle } from '@/lib/task-title';
import {
  addTraceableRateCardMovementToBatch,
  buildHistoricalRateCardRepairPlan,
  getRateCardBusinessMovementKey,
  resolveHistoricalRateCardEntryDate,
} from '@/lib/rate-card-trace';

const toDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseDateLike = (value: any): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }
  if (typeof value?.toMillis === 'function') {
    const date = new Date(value.toMillis());
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value?.seconds === 'number') {
    const date = new Date(value.seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'number') {
    const date = new Date(value < 10000000000 ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
};

const normalizeDateKey = (value: any) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  const dateKeyMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (dateKeyMatch) {
    const [, year, month, day] = dateKeyMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const parsed = parseDateLike(trimmed);
  return parsed ? toDateKey(parsed) : '';
};

const getEntryDateKey = (entry: any) => {
  const directDateKey = normalizeDateKey(entry.dateKey || entry.dayKey || entry.reportDate);
  if (directDateKey) return directDateKey;

  const date =
    parseDateLike(entry.createdAt) ||
    parseDateLike(entry.completedAt) ||
    parseDateLike(entry.approvedAt) ||
    parseDateLike(entry.updatedAt);

  return date ? toDateKey(date) : '';
};

const isHistoricalBalanceEntry = (entry: any) =>
  Boolean(entry?.historicalBalance) ||
  entry?.source === 'historical_user_stats' ||
  entry?.source === 'historical_rework_stats';

const normalizeLookupText = (value: any) =>
  String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const normalizeCsvHeader = (value: any) =>
  normalizeLookupText(value).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const escapeCsvCell = (value: any) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const DEDUPE_UNITS_EPSILON = 0.000001;

const getTraceMovementKey = (traceKey: any) => {
  if (typeof traceKey !== 'string') return '';
  const parts = traceKey.split('::');
  if (parts.length < 6) return '';
  return parts.slice(0, 5).join('::');
};

const isTraceRepairEntry = (entry: any) =>
  String(entry?.source || '').includes('trace_repair') ||
  String(entry?.source || '').includes('manual_trace_repair') ||
  Boolean(entry?.repairedFromHistoricalBalance);

const getEntrySortMillis = (entry: any) => {
  const dates = [
    parseDateLike(entry?.recordedAt),
    parseDateLike(entry?.updatedAt),
    parseDateLike(entry?.adjustedAt),
    parseDateLike(entry?.createdAt),
    parseDateLike(entry?.completedAt),
    parseDateLike(entry?.dateKey ? `${entry.dateKey}T12:00:00` : null),
  ].filter(Boolean) as Date[];
  return dates[0]?.getTime() || 0;
};

const getRateCardEntryMovementKey = (entry: any) => {
  const businessKey = getRateCardBusinessMovementKey(entry);
  if (businessKey) return businessKey;

  const storedKey = String(entry?.rateCardMovementKey || '').trim();
  if (storedKey) return storedKey;

  const traceKey = getTraceMovementKey(entry?.traceKey);
  if (traceKey) return traceKey;

  const fallbackTaskKey = 'sin-tarea';
  const stepKey = typeof entry?.stepIndex === 'number' ? entry.stepIndex : 'task';
  const sourceKey = String(entry?.rateCardSourceKey || '').trim();
  if (sourceKey) {
    return [
      fallbackTaskKey,
      stepKey,
      entry?.rateCardId || 'sin-rate-card',
      entry?.assignedTo || 'sin-profesional',
      sourceKey,
    ].join('::');
  }

  return [
    fallbackTaskKey,
    entry?.rateCardId || 'sin-rate-card',
    entry?.assignedTo || 'sin-profesional',
    getEntryDateKey(entry) || 'sin-fecha',
    entry?.isRework ? 'rework' : 'production',
    Math.abs(normalizeDecimalInput(entry?.units, 0)).toFixed(6),
  ].join('::');
};

const buildRateCardEntryDedupePlan = (entries: any[]) => {
  const traceSeen = new Set<string>();
  const groups = new Map<string, any[]>();
  const duplicateEntries: any[] = [];

  entries.forEach((entry) => {
    const traceKey = String(entry?.traceKey || '').trim();
    if (traceKey) {
      if (traceSeen.has(traceKey)) {
        duplicateEntries.push(entry);
        return;
      }
      traceSeen.add(traceKey);
    }

    const movementKey = getRateCardEntryMovementKey(entry);
    const current = groups.get(movementKey) || [];
    current.push(entry);
    groups.set(movementKey, current);
  });

  const effectiveEntries = Array.from(groups.values())
    .map((group) => {
      const ordered = [...group].sort((left, right) => getEntrySortMillis(right) - getEntrySortMillis(left));
      const latest = ordered[0];
      if (latest?.reversal) {
        duplicateEntries.push(...ordered.slice(1));
        return null;
      }

      const chargeEntries = ordered.filter(entry => !entry?.reversal);
      const preferredCharge = [...chargeEntries].sort((left, right) => {
        const repairScore = Number(isTraceRepairEntry(left)) - Number(isTraceRepairEntry(right));
        if (repairScore !== 0) return repairScore;
        const unitScore = Math.abs(normalizeDecimalInput(right?.units, 0)) - Math.abs(normalizeDecimalInput(left?.units, 0));
        if (Math.abs(unitScore) > DEDUPE_UNITS_EPSILON) return unitScore;
        return getEntrySortMillis(right) - getEntrySortMillis(left);
      })[0];
      duplicateEntries.push(...ordered.filter(entry => entry?.id !== preferredCharge?.id));
      return preferredCharge || null;
    })
    .filter(Boolean);

  return { effectiveEntries, duplicateEntries };
};

const dedupeRateCardEntriesByMovement = (entries: any[]) => {
  return buildRateCardEntryDedupePlan(entries).effectiveEntries;
};

const parseDelimitedRows = (text: string) => {
  const cleanText = text.replace(/^\uFEFF/, '');
  const firstLine = cleanText.split(/\r?\n/, 1)[0] || '';
  const delimiter = firstLine.includes(';') ? ';' : firstLine.includes('\t') ? '\t' : ',';
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
      row.push(cell);
      cell = '';
      continue;
    }

    if (!quoted && (character === '\n' || character === '\r')) {
      if (character === '\r' && nextCharacter === '\n') index += 1;
      row.push(cell);
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += character;
  }

  row.push(cell);
  if (row.some(value => value.trim())) rows.push(row);
  return rows;
};

const normalizeEditableDateKey = (value: any) => {
  const normalized = normalizeDateKey(String(value ?? '').trim());
  if (!normalized) return '';
  const [year, month, day] = normalized.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  ) ? normalized : '';
};

const sanitizeCsvFilename = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'rate-card';

type MaintenanceBulkChange = {
  entryId: string;
  rowNumber: number;
  entry: any;
  updates: Record<string, any>;
  changedFields: string[];
};

type MaintenanceBulkPreview = {
  fileName: string;
  totalRows: number;
  changes: MaintenanceBulkChange[];
  errors: string[];
};

export function ProjectRateCards({ projectId, currentUser, tasks = [], teamMembers = [], budgetLines = [] }: { projectId: string, currentUser: any, tasks?: any[], teamMembers?: any[], budgetLines?: any[] }) {
  const [rateCards, setRateCards] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [indicator, setIndicator] = useState('');
  const [rate, setRate] = useState('');
  const [incomeRate, setIncomeRate] = useState('');
  const [costRate, setCostRate] = useState('');
  const [rateType, setRateType] = useState<'currency' | 'unit'>('currency');
  const [currency, setCurrency] = useState('USD');
  const [unitLabel, setUnitLabel] = useState('');
  const [syncExternal, setSyncExternal] = useState(false);
  const [budgetLineId, setBudgetLineId] = useState('');
  const [currentValue, setCurrentValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [showDetailedMovements, setShowDetailedMovements] = useState(false);
  const [rateCardToDelete, setRateCardToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [rateCardToEdit, setRateCardToEdit] = useState<any>(null);
  const [rateCardEntries, setRateCardEntries] = useState<any[]>([]);
  const [rawRateCardEntries, setRawRateCardEntries] = useState<any[]>([]);
  const [dashboardStartDate, setDashboardStartDate] = useState('');
  const [dashboardEndDate, setDashboardEndDate] = useState('');
  const [selectedRateCardId, setSelectedRateCardId] = useState<string | null>(null);
  const [analysisRateIds, setAnalysisRateIds] = useState<string[]>([]);
  const [maintenanceRateCardId, setMaintenanceRateCardId] = useState<string | null>(null);
  const [entryDrafts, setEntryDrafts] = useState<Record<string, { units: string; assignedTo: string; comment: string }>>({});
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);
  const [maintenanceConfirm, setMaintenanceConfirm] = useState<{ type: 'reset' | 'deleteEntry' | 'repairTrace' | 'cleanupDuplicates'; entry?: any } | null>(null);
  const [maintenanceBulkPreview, setMaintenanceBulkPreview] = useState<MaintenanceBulkPreview | null>(null);
  const maintenanceFileInputRef = useRef<HTMLInputElement | null>(null);

  const EPSILON = 0.000001;

  useEffect(() => {
    const q = query(collection(db, 'projects', projectId, 'rateCards'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      data.sort((a: any, b: any) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
      setRateCards(data);
    });
    return () => unsubscribe();
  }, [projectId]);

  useEffect(() => {
    const q = query(collection(db, 'projects', projectId, 'rateCardEntries'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      data.sort((a: any, b: any) => {
        const right = b.createdAt?.toMillis?.() || Date.parse(b.createdAt || b.dateKey || '') || 0;
        const left = a.createdAt?.toMillis?.() || Date.parse(a.createdAt || a.dateKey || '') || 0;
        return right - left;
      });
      setRawRateCardEntries(data);
      setRateCardEntries(dedupeRateCardEntriesByMovement(data));
    });
    return () => unsubscribe();
  }, [projectId]);

  useEffect(() => {
    if (rateCards.length === 0) {
      setSelectedRateCardId(null);
      setAnalysisRateIds([]);
      return;
    }

    if (!selectedRateCardId || !rateCards.some(card => card.id === selectedRateCardId)) {
      setSelectedRateCardId(rateCards[0].id);
    }

    const validAnalysisIds = analysisRateIds.filter(id => rateCards.some(card => card.id === id));
    if (validAnalysisIds.length === 0) {
      setAnalysisRateIds(rateCards.map(card => card.id));
    } else if (validAnalysisIds.length !== analysisRateIds.length) {
      setAnalysisRateIds(validAnalysisIds);
    }
  }, [rateCards, selectedRateCardId, analysisRateIds]);

  const dashboardDateRangeInvalid = Boolean(
    dashboardStartDate &&
    dashboardEndDate &&
    dashboardStartDate > dashboardEndDate
  );
  const dashboardDateFilteringRequested = Boolean(dashboardStartDate || dashboardEndDate);
  const hasDashboardDateFilter = Boolean(
    !dashboardDateRangeInvalid &&
    (dashboardStartDate || dashboardEndDate)
  );
  const reportableRateCardIds = new Set(rateCards.map(card => card.id));
  const getReportEntryDateResolution = (entry: any) => {
    if (isHistoricalBalanceEntry(entry)) {
      return resolveHistoricalRateCardEntryDate(entry, tasks);
    }

    const dateKey = getEntryDateKey(entry);
    return {
      date: dateKey ? parseDateLike(`${dateKey}T12:00:00`) : null,
      dateKey,
      source: dateKey ? 'movement' : 'unresolved',
      evidence: dateKey ? 'movement_date' : null,
    };
  };
  const dashboardRateCardEntries = rateCardEntries.filter((entry) => {
    if (!reportableRateCardIds.has(entry.rateCardId)) return false;
    if (!hasDashboardDateFilter) return !dashboardDateRangeInvalid;
    const dateKey = getReportEntryDateResolution(entry).dateKey;
    if (!dateKey) return false;
    if (dashboardStartDate && dateKey < dashboardStartDate) return false;
    if (dashboardEndDate && dateKey > dashboardEndDate) return false;
    return true;
  });
  const historicalDateResolutions = rateCardEntries
    .filter(entry => reportableRateCardIds.has(entry.rateCardId) && isHistoricalBalanceEntry(entry))
    .map(entry => getReportEntryDateResolution(entry));
  const historicalTaskDateCount = historicalDateResolutions
    .filter(resolution => resolution.source === 'task_origin').length;
  const historicalInclusionDateCount = historicalDateResolutions
    .filter(resolution => resolution.source === 'historical_inclusion').length;
  const historicalSanitizedDateCount = historicalDateResolutions
    .filter(resolution => resolution.source === 'manual_sanitation').length;
  const unresolvedHistoricalDateCount = historicalDateResolutions
    .filter(resolution => resolution.source === 'unresolved').length;

  // Calculate data for charts and totals
  const userTotals: Record<string, { name: string; income: number; cost: number; output: number; reworkCost: number }> = {};
  const rateCardAnalytics: any[] = [];
  let totalProjectGenerated = 0;
  let totalProjectCost = 0;
  let totalProjectRework = 0;
  let totalUnitOutput = 0;
  let unitRateCardCount = 0;

  rateCards.forEach(card => {
    const rateEntries = dashboardRateCardEntries.filter(entry => entry.rateCardId === card.id);
    const productionEntries = rateEntries.filter(entry => !entry.isRework);
    const reworkEntries = rateEntries.filter(entry => entry.isRework);
    const entryUserStats = productionEntries.reduce((acc: Record<string, number>, entry: any) => {
      const userId = entry.assignedTo || 'unknown';
      acc[userId] = (acc[userId] || 0) + Number(entry.units || 0);
      return acc;
    }, {});
    const entryUserReworkStats = reworkEntries.reduce((acc: Record<string, number>, entry: any) => {
      const userId = entry.assignedTo || 'unknown';
      acc[userId] = (acc[userId] || 0) + Math.abs(Number(entry.units || 0));
      return acc;
    }, {});
    const computedUserStats: Record<string, number> = entryUserStats;
    const computedUserReworkStats: Record<string, number> = entryUserReworkStats;
    const cardTotalUnits = productionEntries.reduce((sum, entry) => sum + Number(entry.units || 0), 0);
    
    const currencyRate = isCurrencyRateCard(card);
    const incomeValue = getRateCardIncomeValue(cardTotalUnits, card);
    const productionCostValue = getRateCardCostValue(cardTotalUnits, card);
    const outputValue = getRateCardOutputValue(cardTotalUnits, card);
    const reworkUnits = Object.values(computedUserReworkStats)
      .reduce((sum: number, val: any) => sum + Math.abs(Number(val) || 0), 0);
    const reworkCostValue = getRateCardCostValue(reworkUnits, card);
    const costValue = productionCostValue + reworkCostValue;
    const associatedBudgetLine = budgetLines.find(bl => bl.id === card.budgetLineId);
    const contributors = Object.entries(computedUserStats)
      .map(([userId, units]: [string, any]) => {
        const member = teamMembers.find(m => m.id === userId);
        const amount = Number(units || 0);
        return {
          userId,
          name: member ? member.name : 'Usuario Desconocido',
          units: amount,
          income: getRateCardIncomeValue(amount, card),
          cost: getRateCardCostValue(amount, card),
          output: getRateCardOutputValue(amount, card),
        };
      })
      .sort((left, right) => right.units - left.units)
      .slice(0, 5);

    if (currencyRate) {
      totalProjectGenerated += incomeValue;
    } else {
      unitRateCardCount += 1;
      totalUnitOutput += outputValue;
    }
    totalProjectCost += costValue;
    totalProjectRework += reworkCostValue;

    rateCardAnalytics.push({
      ...card,
      cardTotalUnits,
      incomeValue,
      costValue,
      productionCostValue,
      outputValue,
      marginValue: incomeValue - costValue,
      reworkCostValue,
      associatedBudgetLine,
      contributors,
      incomeRate: getRateCardIncomeRate(card),
      costRate: getRateCardCostRate(card),
    });

    Object.entries(computedUserStats).forEach(([userId, units]: [string, any]) => {
      const member = teamMembers.find(m => m.id === userId);
      const userName = member ? member.name : 'Usuario Desconocido';
      const amount = Number(units || 0);
      
      if (!userTotals[userId]) {
        userTotals[userId] = { name: userName, income: 0, cost: 0, output: 0, reworkCost: 0 };
      }
      userTotals[userId].income += getRateCardIncomeValue(amount, card);
      userTotals[userId].cost += getRateCardCostValue(amount, card);
      userTotals[userId].output += getRateCardOutputValue(amount, card);
    });
    
    if (Object.keys(computedUserReworkStats).length > 0) {
      Object.entries(computedUserReworkStats).forEach(([userId, units]: [string, any]) => {
        const member = teamMembers.find(m => m.id === userId);
        const userName = member ? member.name : 'Usuario Desconocido';
        const amount = Number(units || 0);
        
        if (!userTotals[userId]) {
          userTotals[userId] = { name: userName, income: 0, cost: 0, output: 0, reworkCost: 0 };
        }
        userTotals[userId].reworkCost += getRateCardCostValue(amount, card);
      });
    }
  });

  const selectedRateCard = rateCardAnalytics.find(card => card.id === selectedRateCardId) || rateCardAnalytics[0] || null;
  const selectedRateCardContribution = selectedRateCard?.contributors || [];
  const userChartData = Object.values(userTotals)
    .map((row) => ({ ...row, margin: row.income - row.cost - row.reworkCost }))
    .sort((a, b) => (b.income + b.output) - (a.income + a.output));
  const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];
  const formatMoney = (value: number, currency = 'USD') =>
    value.toLocaleString('en-US', { style: 'currency', currency, maximumFractionDigits: 0 });
  const formatCompactMoney = (value: number) => {
    const absoluteValue = Math.abs(value);
    if (absoluteValue >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
    if (absoluteValue >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (absoluteValue >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
    return `$${value.toLocaleString('es-CO', { maximumFractionDigits: 0 })}`;
  };
  const shortLabel = (value: string, maxLength = 18) => {
    if (!value) return '';
    return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
  };

  const getEntryPeriodKeys = (date = new Date()) => {
    const year = date.getFullYear();
    const dateKey = toDateKey(date);
    const monthKey = `${year}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const startOfYear = new Date(year, 0, 1);
    const dayOfYear = Math.floor((date.getTime() - startOfYear.getTime()) / 86400000) + 1;
    const weekKey = `${year}-W${String(Math.ceil(dayOfYear / 7)).padStart(2, '0')}`;

    return { dateKey, weekKey, monthKey };
  };

  const formatReportDate = (dateKey: string) => {
    if (!dateKey) return 'Sin fecha';
    const [year, month, day] = dateKey.split('-').map(Number);
    const date = new Date(year, (month || 1) - 1, day || 1);
    return date.toLocaleDateString('es-CO', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  const getMemberName = (memberId: string) =>
    teamMembers.find(member => member.id === memberId)?.name || 'Usuario desconocido';

  const getRateCardById = (rateCardId: string) =>
    rateCards.find(card => card.id === rateCardId);

  const sumNumberRecord = (record: Record<string, any> = {}) =>
    Object.values(record || {}).reduce((sum: number, value: any) => sum + normalizeDecimalInput(value, 0), 0);

  const sumAbsoluteNumberRecord = (record: Record<string, any> = {}) =>
    Object.values(record || {}).reduce((sum: number, value: any) => sum + Math.abs(normalizeDecimalInput(value, 0)), 0);

  const buildMaintenanceHistoricalRows = (card: any, entries: any[]) => {
    if (!card) return [];

    const trackedProductionByUser: Record<string, number> = {};
    const trackedReworkByUser: Record<string, number> = {};
    let trackedProductionTotal = 0;
    let trackedReworkTotal = 0;

    entries.forEach((entry: any) => {
      const units = normalizeDecimalInput(entry.units, 0);
      const userId = entry.assignedTo || '__unassigned__';

      if (entry.isRework) {
        const absoluteUnits = Math.abs(units);
        trackedReworkTotal += absoluteUnits;
        trackedReworkByUser[userId] = (trackedReworkByUser[userId] || 0) + absoluteUnits;
      } else {
        trackedProductionTotal += units;
        trackedProductionByUser[userId] = (trackedProductionByUser[userId] || 0) + units;
      }
    });

    const rows: Array<{
      id: string;
      assignedTo: string;
      units: number;
      isRework: boolean;
      source: string;
      taskTitle: string;
    }> = [];

    const addGapRow = (
      assignedTo: string,
      totalUnits: number,
      trackedUnits: number,
      isRework: boolean,
    ) => {
      const units = totalUnits - trackedUnits;
      if (units <= EPSILON) return;

      const userKey = assignedTo || 'sin-profesional';
      rows.push({
        id: `${card.id}-${isRework ? 'rework' : 'production'}-${userKey}`,
        assignedTo,
        units,
        isRework,
        source: isRework ? 'historical_rework_stats' : 'historical_user_stats',
        taskTitle: isRework ? 'Reproceso histórico sin detalle' : 'Producción histórica sin detalle',
      });
    };

    const productionStats = card.userStats || {};
    const productionUsers = Object.keys(productionStats);
    if (productionUsers.length > 0) {
      productionUsers.forEach((assignedTo) => {
        addGapRow(
          assignedTo,
          normalizeDecimalInput(productionStats[assignedTo], 0),
          trackedProductionByUser[assignedTo] || 0,
          false,
        );
      });

      const unassignedTotal = normalizeDecimalInput(card.currentValue, 0) - sumNumberRecord(productionStats);
      addGapRow('', unassignedTotal, trackedProductionByUser.__unassigned__ || 0, false);
    } else {
      addGapRow('', normalizeDecimalInput(card.currentValue, 0), trackedProductionTotal, false);
    }

    const reworkStats = card.userReworkStats || {};
    const reworkUsers = Object.keys(reworkStats);
    if (reworkUsers.length > 0) {
      reworkUsers.forEach((assignedTo) => {
        addGapRow(
          assignedTo,
          Math.abs(normalizeDecimalInput(reworkStats[assignedTo], 0)),
          trackedReworkByUser[assignedTo] || 0,
          true,
        );
      });

      const unassignedTotal = Math.abs(normalizeDecimalInput(card.reworkValue, 0)) - sumAbsoluteNumberRecord(reworkStats);
      addGapRow('', unassignedTotal, trackedReworkByUser.__unassigned__ || 0, true);
    } else {
      addGapRow('', Math.abs(normalizeDecimalInput(card.reworkValue, 0)), trackedReworkTotal, true);
    }

    return rows;
  };

  const buildReportRow = (entry: any, card: any) => {
    const units = Number(entry.units || 0);
    const rateCardContext = card || entry;
    const isRework = Boolean(entry.isRework);
    const dateResolution = getReportEntryDateResolution(entry);
    const costUnits = isRework ? Math.abs(units) : units;
    const costValue = getRateCardCostValue(costUnits, rateCardContext);
    const recognizedIncomeValue = isRework ? 0 : getRateCardIncomeValue(units, rateCardContext);
    const taskId = entry.taskId || '';
    const parentTaskId = entry.parentTaskId || '';
    const relatedProductionUnits = isRework
      ? rateCardEntries
        .filter((candidate: any) => {
          if (candidate.rateCardId !== entry.rateCardId || candidate.isRework) return false;
          if (taskId) return candidate.taskId === taskId;
          if (parentTaskId) return !candidate.taskId && candidate.parentTaskId === parentTaskId;
          return false;
        })
        .reduce((sum: number, candidate: any) => sum + Number(candidate.units || 0), 0)
      : units;
    const taskIncomeValue = isRework
      ? getRateCardIncomeValue(
        Math.abs(relatedProductionUnits) > EPSILON ? relatedProductionUnits : Math.abs(units),
        rateCardContext,
      )
      : recognizedIncomeValue;
    const displayIncomeValue = isRework ? taskIncomeValue : recognizedIncomeValue;
    const outputValue = isRework ? 0 : getRateCardOutputValue(units, rateCardContext);
    const resultValue = isCurrencyRateCard(rateCardContext)
      ? recognizedIncomeValue - costValue
      : outputValue;

    return {
      ...entry,
      dateKey: dateResolution.dateKey,
      dateOrigin: dateResolution.source,
      dateEvidence: dateResolution.evidence,
      personName: getMemberName(entry.assignedTo),
      rateCardName: card?.name || entry.rateCardName || 'Rate Card eliminado',
      indicator: rateCardContext?.indicator || 'unidades',
      rateType: normalizeRateCardValueType(rateCardContext?.rateType || rateCardContext?.valueType),
      unitLabel: rateCardContext?.unitLabel || rateCardContext?.measureUnit || 'unidades',
      currency: rateCardContext?.currency || 'USD',
      income: displayIncomeValue,
      recognizedIncome: recognizedIncomeValue,
      taskIncome: taskIncomeValue,
      cost: costValue,
      output: outputValue,
      margin: recognizedIncomeValue - costValue,
      value: resultValue,
      units,
    };
  };

  const selectedRateCardEntries = selectedRateCard
    ? dashboardRateCardEntries
      .filter(entry => entry.rateCardId === selectedRateCard.id)
      .map(entry => buildReportRow(entry, selectedRateCard))
      .sort((a, b) => (b.dateKey || '').localeCompare(a.dateKey || ''))
    : [];
  const maintenanceRateCard = maintenanceRateCardId
    ? rateCards.find(card => card.id === maintenanceRateCardId) || null
    : null;
  const maintenanceEntries = maintenanceRateCard
    ? rateCardEntries
      .filter(entry => entry.rateCardId === maintenanceRateCard.id)
      .map(entry => ({
        ...entry,
        dateKey: getEntryDateKey(entry),
        personName: getMemberName(entry.assignedTo),
      }))
      .sort((a, b) => (b.dateKey || '').localeCompare(a.dateKey || ''))
    : [];
  const maintenanceRawEntries = maintenanceRateCard
    ? rawRateCardEntries.filter(entry => entry.rateCardId === maintenanceRateCard.id)
    : [];
  const maintenanceDedupePlan = maintenanceRateCard
    ? buildRateCardEntryDedupePlan(maintenanceRawEntries)
    : { effectiveEntries: [], duplicateEntries: [] };
  const maintenanceDuplicateEntries = maintenanceDedupePlan.duplicateEntries;
  const maintenanceStoredHistoricalRows = maintenanceEntries
    .filter(isHistoricalBalanceEntry)
    .map((entry: any) => ({
      id: `stored-${entry.id}`,
      entryId: entry.id,
      assignedTo: entry.assignedTo || '',
      units: entry.isRework
        ? Math.abs(normalizeDecimalInput(entry.units, 0))
        : Math.max(0, normalizeDecimalInput(entry.units, 0)),
      isRework: Boolean(entry.isRework),
      source: entry.source || (entry.isRework ? 'historical_rework_stats' : 'historical_user_stats'),
      taskTitle: entry.taskTitle || (entry.isRework ? 'Reproceso histórico sin detalle' : 'Producción histórica sin detalle'),
    }))
    .filter(row => row.units > EPSILON);
  const maintenanceHistoricalRows = maintenanceRateCard
    ? buildMaintenanceHistoricalRows(maintenanceRateCard, maintenanceEntries)
    : [];
  const maintenanceHistoricalGaps = [
    ...maintenanceStoredHistoricalRows,
    ...maintenanceHistoricalRows,
  ];
  const maintenanceRawDetailedEntries = maintenanceRawEntries.filter(entry => !isHistoricalBalanceEntry(entry));
  const maintenanceRepairPlan = maintenanceRateCard
    ? buildHistoricalRateCardRepairPlan({
        rateCard: maintenanceRateCard,
        gaps: maintenanceHistoricalGaps,
        entries: maintenanceRawDetailedEntries,
        tasks,
      })
    : { matches: [], unresolved: [], recoverableUnits: 0, unresolvedUnits: 0 };
  const maintenanceUnresolvedRows = maintenanceRepairPlan.unresolved;
  const maintenanceUnresolvedVirtualRows = maintenanceUnresolvedRows.filter(row => !row.entryId);
  const maintenanceHasHistoricalBalance = maintenanceHistoricalGaps.length > 0;
  const maintenanceHistoricalProduction = maintenanceHistoricalGaps
    .filter(row => !row.isRework)
    .reduce((sum, row) => sum + row.units, 0);
  const maintenanceHistoricalRework = maintenanceHistoricalGaps
    .filter(row => row.isRework)
    .reduce((sum, row) => sum + row.units, 0);
  const chartDisplayData = userChartData.slice(0, 8);
  const activeUserCount = userChartData.filter(row => row.income > 0 || row.cost > 0 || row.output > 0 || row.reworkCost > 0).length;
  const totalMovements = dashboardRateCardEntries.length;
  const totalMargin = totalProjectGenerated - totalProjectCost;
  const topFinancialUsers = userChartData
    .filter(row => row.income > 0 || row.cost > 0 || row.reworkCost > 0)
    .slice(0, 5);
  const topProductiveUsers = userChartData
    .filter(row => row.output > 0)
    .sort((left, right) => right.output - left.output)
    .slice(0, 5);
  const selectedRateCardLastEntry = selectedRateCardEntries[0];
  const dashboardPeriodLabel = dashboardDateRangeInvalid
    ? 'Rango de fechas inválido'
    : dashboardStartDate && dashboardEndDate
      ? `${formatReportDate(dashboardStartDate)} - ${formatReportDate(dashboardEndDate)}`
      : dashboardStartDate
        ? `Desde ${formatReportDate(dashboardStartDate)}`
        : dashboardEndDate
          ? `Hasta ${formatReportDate(dashboardEndDate)}`
          : 'Todo el periodo';

  const applyDashboardDatePreset = (preset: 'all' | 'month' | 'last30') => {
    if (preset === 'all') {
      setDashboardStartDate('');
      setDashboardEndDate('');
      return;
    }

    const end = new Date();
    const start =
      preset === 'month'
        ? new Date(end.getFullYear(), end.getMonth(), 1)
        : new Date(end.getFullYear(), end.getMonth(), end.getDate() - 29);
    setDashboardStartDate(toDateKey(start));
    setDashboardEndDate(toDateKey(end));
  };

  const buildRateCardRecalculation = (card: any) => {
    const entries = rateCardEntries.filter(entry => entry.rateCardId === card.id);
    return buildRateCardStateFromEntries(card, entries);
  };

  const buildRateCardStateFromEntries = (card: any, entries: any[]) => {
    const effectiveEntries = dedupeRateCardEntriesByMovement(entries);
    const stats = effectiveEntries.reduce((acc: {
      currentValue: number;
      reworkValue: number;
      userStats: Record<string, number>;
      userReworkStats: Record<string, number>;
    }, entry: any) => {
      const units = normalizeDecimalInput(entry.units, 0);
      const assigneeId = entry.assignedTo || '';

      if (entry.isRework) {
        acc.reworkValue += units;
        if (assigneeId) acc.userReworkStats[assigneeId] = (acc.userReworkStats[assigneeId] || 0) + units;
      } else {
        acc.currentValue += units;
        if (assigneeId) acc.userStats[assigneeId] = (acc.userStats[assigneeId] || 0) + units;
      }

      return acc;
    }, {
      currentValue: 0,
      reworkValue: 0,
      userStats: {},
      userReworkStats: {},
    });

    const productionCost = getRateCardCostValue(stats.currentValue, card);
    const reworkCost = getRateCardCostValue(Math.abs(stats.reworkValue), card);
    const calculatedIncome = getRateCardIncomeValue(stats.currentValue, card);

    return {
      currentValue: stats.currentValue,
      reworkValue: stats.reworkValue,
      userStats: stats.userStats,
      userReworkStats: stats.userReworkStats,
      reportedUnits: stats.currentValue,
      reportedReworkUnits: stats.reworkValue,
      calculatedIncome,
      calculatedCost: productionCost + reworkCost,
      calculatedOutput: getRateCardOutputValue(stats.currentValue, card),
      calculatedMargin: calculatedIncome - productionCost - reworkCost,
      recalculatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
  };

  const recalculateRateCardFromEntries = async (card: any, entries: any[]) => {
    await updateDoc(
      doc(db, 'projects', projectId, 'rateCards', card.id),
      buildRateCardStateFromEntries(card, entries),
    );

    await syncRateDrivenIncrementalTasksForRate({
      projectId,
      rateCardId: card.id,
    });
  };

  const buildEntryDrafts = (entries: any[]) => entries.reduce((acc: Record<string, { units: string; assignedTo: string; comment: string }>, entry: any) => {
    acc[entry.id] = {
      units: String(entry.units ?? 0),
      assignedTo: entry.assignedTo || '',
      comment: entry.comment || '',
    };
    return acc;
  }, {});

  const openMaintenancePanel = (card: any) => {
    const entries = rateCardEntries.filter(entry => entry.rateCardId === card.id);
    setMaintenanceRateCardId(card.id);
    setSelectedRateCardId(card.id);
    setEntryDrafts(buildEntryDrafts(entries));
    setMaintenanceConfirm(null);
    setMaintenanceBulkPreview(null);
  };

  const closeMaintenancePanel = () => {
    setMaintenanceRateCardId(null);
    setEntryDrafts({});
    setMaintenanceConfirm(null);
    setMaintenanceBulkPreview(null);
    if (maintenanceFileInputRef.current) maintenanceFileInputRef.current.value = '';
  };

  const downloadMaintenanceCsv = () => {
    if (!maintenanceRateCard || maintenanceEntries.length === 0) {
      toast.info('Este rate card no tiene movimientos para descargar.');
      return;
    }

    const headers = [
      'movimiento_id',
      'rate_card_id',
      'tipo_movimiento',
      'fecha',
      'persona_id',
      'persona',
      'persona_correo',
      'tarea_id',
      'tarea',
      'cantidad',
      'comentario',
      'fuente',
      'ingreso_tarea_referencia',
      'ingreso_reconocido',
      'costo',
      'impacto_margen',
    ];
    const rows = maintenanceEntries.map((entry: any) => {
      const reportRow = buildReportRow(entry, maintenanceRateCard);
      const member = teamMembers.find(candidate => candidate.id === entry.assignedTo);
      const linkedTask = tasks.find(candidate => candidate.id === entry.taskId);

      return [
        entry.id,
        maintenanceRateCard.id,
        entry.isRework ? 'REPROCESO' : 'PRODUCCION',
        reportRow.dateKey,
        entry.assignedTo || '',
        member?.name || member?.displayName || '',
        member?.email || member?.userEmail || '',
        entry.taskId || '',
        linkedTask ? getTaskTitle(linkedTask) : entry.taskTitle || '',
        entry.units ?? 0,
        entry.comment || '',
        entry.source || '',
        reportRow.taskIncome.toFixed(2),
        reportRow.recognizedIncome.toFixed(2),
        reportRow.cost.toFixed(2),
        reportRow.margin.toFixed(2),
      ];
    });
    const csv = [headers, ...rows]
      .map(row => row.map(escapeCsvCell).join(';'))
      .join('\r\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `saneamiento-${sanitizeCsvFilename(maintenanceRateCard.name)}-${toDateKey(new Date())}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    toast.success('Plantilla de saneamiento descargada.');
  };

  const resolveBulkMember = (row: Record<string, string>, entry: any) => {
    const requestedId = String(row.persona_id || '').trim();
    const requestedEmail = normalizeLookupText(row.persona_correo);
    const requestedName = normalizeLookupText(row.persona);
    if (!requestedId && !requestedEmail && !requestedName) return { member: null, error: '' };

    const currentMember = teamMembers.find((member: any) => member.id === entry.assignedTo);
    const currentId = String(entry.assignedTo || '');
    const currentEmail = normalizeLookupText(currentMember?.email || currentMember?.userEmail);
    const currentName = normalizeLookupText(currentMember?.name || currentMember?.displayName);
    const idChanged = requestedId !== currentId;
    const nameChanged = Boolean(requestedName && requestedName !== currentName);
    const emailChanged = Boolean(requestedEmail && requestedEmail !== currentEmail);
    if (!idChanged && !nameChanged && !emailChanged && currentId) {
      return { member: currentMember || { id: currentId }, error: '' };
    }
    const matches = teamMembers.filter((member: any) => {
      const memberEmail = normalizeLookupText(member.email || member.userEmail);
      const memberName = normalizeLookupText(member.name || member.displayName);
      if (idChanged) return member.id === requestedId || member.uid === requestedId;
      if (nameChanged) return memberName === requestedName;
      if (emailChanged) return memberEmail === requestedEmail;
      return member.id === currentId || member.uid === currentId;
    });

    if (matches.length === 1) return { member: matches[0], error: '' };
    if (matches.length > 1) return { member: null, error: 'la persona es ambigua; usa persona_id' };
    return { member: null, error: 'la persona no pertenece al equipo del proyecto' };
  };

  const resolveBulkTask = (row: Record<string, string>, entry: any) => {
    const requestedId = String(row.tarea_id || '').trim();
    const requestedName = normalizeLookupText(row.tarea);
    if (!requestedId && !requestedName) return { task: null, error: '' };

    const currentTask = tasks.find((task: any) => task.id === entry.taskId);
    const currentId = String(entry.taskId || '');
    const currentName = normalizeLookupText(currentTask ? getTaskTitle(currentTask, '') : entry.taskTitle);
    const idChanged = requestedId !== currentId;
    const nameChanged = Boolean(requestedName && requestedName !== currentName);
    if (!idChanged && !nameChanged && currentId) {
      return {
        task: currentTask || {
          id: currentId,
          title: entry.taskTitle || null,
          externalWorkflowId: entry.externalWorkflowId || null,
          parentTaskId: entry.parentTaskId || null,
        },
        error: '',
      };
    }
    const matches = tasks.filter((task: any) => {
      if (idChanged) return task.id === requestedId || task.externalWorkflowId === requestedId;
      if (!nameChanged) return task.id === currentId;
      return (
        normalizeLookupText(getTaskTitle(task, '')) === requestedName ||
        normalizeLookupText(task.externalWorkflowId) === requestedName
      );
    });

    if (matches.length === 1) return { task: matches[0], error: '' };
    if (matches.length > 1) return { task: null, error: 'la tarea es ambigua; usa tarea_id' };
    return { task: null, error: 'la tarea no existe en este proyecto' };
  };

  const handleMaintenanceCsvFile = async (file: File | null) => {
    if (!file || !maintenanceRateCard) return;

    try {
      const rows = parseDelimitedRows(await file.text());
      if (rows.length < 2) {
        toast.warning('La plantilla no contiene movimientos para sanear.');
        return;
      }

      const headers = rows[0].map(normalizeCsvHeader);
      const requiredHeaders = ['movimiento_id', 'fecha', 'cantidad'];
      const missingHeaders = requiredHeaders.filter(header => !headers.includes(header));
      if (missingHeaders.length > 0) {
        toast.error(`Faltan columnas obligatorias: ${missingHeaders.join(', ')}.`);
        return;
      }

      const changes: MaintenanceBulkChange[] = [];
      const errors: string[] = [];
      const seenEntryIds = new Set<string>();
      const entryById = new Map(maintenanceEntries.map((entry: any) => [entry.id, entry]));
      const hasCommentColumn = headers.includes('comentario');

      rows.slice(1).forEach((cells, rowIndex) => {
        const rowNumber = rowIndex + 2;
        const row = headers.reduce((record: Record<string, string>, header, cellIndex) => {
          if (header) record[header] = String(cells[cellIndex] ?? '').trim();
          return record;
        }, {});
        const entryId = row.movimiento_id;

        if (!entryId) {
          errors.push(`Fila ${rowNumber}: falta movimiento_id.`);
          return;
        }
        if (seenEntryIds.has(entryId)) {
          errors.push(`Fila ${rowNumber}: movimiento_id duplicado (${entryId}).`);
          return;
        }
        seenEntryIds.add(entryId);

        const entry = entryById.get(entryId);
        if (!entry) {
          errors.push(`Fila ${rowNumber}: el movimiento no pertenece a este rate card.`);
          return;
        }
        if (row.rate_card_id && row.rate_card_id !== maintenanceRateCard.id) {
          errors.push(`Fila ${rowNumber}: rate_card_id no coincide con el panel abierto.`);
          return;
        }

        const dateKey = normalizeEditableDateKey(row.fecha);
        if (!dateKey) {
          errors.push(`Fila ${rowNumber}: fecha inválida; usa AAAA-MM-DD.`);
          return;
        }

        const parsedUnits = normalizeDecimalInput(row.cantidad, Number.NaN);
        if (!Number.isFinite(parsedUnits)) {
          errors.push(`Fila ${rowNumber}: cantidad inválida.`);
          return;
        }

        const memberResolution = resolveBulkMember(row, entry);
        if (memberResolution.error) {
          errors.push(`Fila ${rowNumber}: ${memberResolution.error}.`);
          return;
        }
        const taskResolution = resolveBulkTask(row, entry);
        if (taskResolution.error) {
          errors.push(`Fila ${rowNumber}: ${taskResolution.error}.`);
          return;
        }

        const [year, month, day] = dateKey.split('-').map(Number);
        const periodKeys = getEntryPeriodKeys(new Date(year, month - 1, day, 12));
        const nextAssignedTo = memberResolution.member?.id || null;
        const nextTask = taskResolution.task;
        const nextComment = hasCommentColumn ? row.comentario || null : entry.comment || null;
        const updates: Record<string, any> = {
          ...periodKeys,
          sanitizedDateKey: dateKey,
          dateSource: 'bulk_sanitation',
          units: parsedUnits,
          assignedTo: nextAssignedTo,
          taskId: nextTask?.id || null,
          taskTitle: nextTask ? getTaskTitle(nextTask) : null,
          externalWorkflowId: nextTask?.externalWorkflowId || null,
          parentTaskId: nextTask?.parentTaskId || null,
          comment: nextComment,
          manuallyAdjusted: true,
          adjustedAt: serverTimestamp(),
          adjustedBy: currentUser?.uid || null,
          adjustedByEmail: currentUser?.email || null,
          bulkAdjustedAt: serverTimestamp(),
          bulkAdjustedBy: currentUser?.uid || null,
          bulkAdjustedByEmail: currentUser?.email || null,
          updatedAt: serverTimestamp(),
        };
        const changedFields: string[] = [];
        if (getReportEntryDateResolution(entry).dateKey !== dateKey) changedFields.push('fecha');
        if ((entry.assignedTo || null) !== nextAssignedTo) changedFields.push('persona');
        if ((entry.taskId || null) !== (nextTask?.id || null)) changedFields.push('tarea');
        if (Math.abs(Number(entry.units || 0) - parsedUnits) > EPSILON) changedFields.push('cantidad');
        if ((entry.comment || null) !== nextComment) changedFields.push('comentario');

        if (changedFields.length > 0) {
          changes.push({ entryId, rowNumber, entry, updates, changedFields });
        }
      });

      setMaintenanceBulkPreview({
        fileName: file.name,
        totalRows: rows.length - 1,
        changes,
        errors,
      });
    } catch (error: any) {
      console.error('Error reading rate card sanitation template:', error);
      toast.error(`No se pudo leer la plantilla: ${error.message}`);
    } finally {
      if (maintenanceFileInputRef.current) maintenanceFileInputRef.current.value = '';
    }
  };

  const executeBulkMaintenanceImport = async () => {
    if (
      !maintenanceRateCard ||
      !maintenanceBulkPreview ||
      maintenanceBulkPreview.errors.length > 0 ||
      maintenanceBulkPreview.changes.length === 0
    ) return;

    setMaintenanceLoading(true);
    try {
      const batch = writeBatch(db);
      const updatesById = new Map(
        maintenanceBulkPreview.changes.map(change => [change.entryId, change.updates]),
      );
      maintenanceBulkPreview.changes.forEach(change => {
        batch.update(
          doc(db, 'projects', projectId, 'rateCardEntries', change.entryId),
          change.updates,
        );
      });
      const nextEntries = rateCardEntries
        .filter(entry => entry.rateCardId === maintenanceRateCard.id)
        .map(entry => updatesById.has(entry.id) ? { ...entry, ...updatesById.get(entry.id) } : entry);
      batch.update(
        doc(db, 'projects', projectId, 'rateCards', maintenanceRateCard.id),
        buildRateCardStateFromEntries(maintenanceRateCard, nextEntries),
      );

      await batch.commit();
      await syncRateDrivenIncrementalTasksForRate({
        projectId,
        rateCardId: maintenanceRateCard.id,
      });
      setEntryDrafts(buildEntryDrafts(nextEntries));
      toast.success(
        `${maintenanceBulkPreview.changes.length} movimiento${maintenanceBulkPreview.changes.length === 1 ? '' : 's'} saneado${maintenanceBulkPreview.changes.length === 1 ? '' : 's'} y rate card recalculado.`,
      );
      setMaintenanceBulkPreview(null);
    } catch (error: any) {
      console.error('Error importing rate card sanitation template:', error);
      toast.error(`No se pudo aplicar el saneamiento masivo: ${error.message}`);
    } finally {
      setMaintenanceLoading(false);
    }
  };

  const updateEntryDraft = (entryId: string, updates: Partial<{ units: string; assignedTo: string; comment: string }>) => {
    setEntryDrafts(previous => ({
      ...previous,
      [entryId]: {
        units: previous[entryId]?.units ?? '0',
        assignedTo: previous[entryId]?.assignedTo ?? '',
        comment: previous[entryId]?.comment ?? '',
        ...updates,
      },
    }));
  };

  const handleUpdateRateCardEntry = async (entry: any) => {
    if (!maintenanceRateCard) return;
    const draft = entryDrafts[entry.id] || { units: String(entry.units ?? 0), assignedTo: entry.assignedTo || '', comment: entry.comment || '' };
    const parsedUnits = normalizeDecimalInput(draft.units, Number.NaN);

    if (!Number.isFinite(parsedUnits)) {
      toast.warning('La cantidad del movimiento debe ser un número válido.');
      return;
    }

    setMaintenanceLoading(true);
    try {
      const nextEntry = {
        ...entry,
        units: parsedUnits,
        assignedTo: draft.assignedTo || null,
        comment: draft.comment?.trim() || null,
      };
      const nextEntries = rateCardEntries.map(candidate => candidate.id === entry.id ? nextEntry : candidate)
        .filter(candidate => candidate.rateCardId === maintenanceRateCard.id);

      await updateDoc(doc(db, 'projects', projectId, 'rateCardEntries', entry.id), {
        units: parsedUnits,
        assignedTo: draft.assignedTo || null,
        comment: draft.comment?.trim() || null,
        manuallyAdjusted: true,
        adjustedAt: serverTimestamp(),
        adjustedBy: currentUser?.uid || null,
        adjustedByEmail: currentUser?.email || null,
      });
      await recalculateRateCardFromEntries(maintenanceRateCard, nextEntries);
      toast.success('Movimiento actualizado y rate card recalculado.');
    } catch (error: any) {
      console.error('Error updating rate card entry:', error);
      toast.error(`No se pudo actualizar el movimiento: ${error.message}`);
    } finally {
      setMaintenanceLoading(false);
    }
  };

  const handleDeleteRateCardEntry = async (entry: any) => {
    if (!maintenanceRateCard) return;
    setMaintenanceConfirm({ type: 'deleteEntry', entry });
  };

  const executeDeleteRateCardEntry = async (entry: any) => {
    if (!maintenanceRateCard) return;
    setMaintenanceLoading(true);
    try {
      const nextEntries = rateCardEntries.filter(candidate => candidate.rateCardId === maintenanceRateCard.id && candidate.id !== entry.id);
      await deleteDoc(doc(db, 'projects', projectId, 'rateCardEntries', entry.id));
      await recalculateRateCardFromEntries(maintenanceRateCard, nextEntries);
      setEntryDrafts(previous => {
        const next = { ...previous };
        delete next[entry.id];
        return next;
      });
      toast.success('Movimiento eliminado y rate card recalculado.');
    } catch (error: any) {
      console.error('Error deleting rate card entry:', error);
      toast.error(`No se pudo eliminar el movimiento: ${error.message}`);
    } finally {
      setMaintenanceLoading(false);
      setMaintenanceConfirm(null);
    }
  };

  const executeCleanupDuplicateRateCardEntries = async () => {
    if (!maintenanceRateCard || maintenanceDuplicateEntries.length === 0) return;

    setMaintenanceLoading(true);
    try {
      const batch = writeBatch(db);
      maintenanceDuplicateEntries.forEach((entry: any) => {
        batch.delete(doc(db, 'projects', projectId, 'rateCardEntries', entry.id));
      });

      const nextEffectiveEntries = maintenanceDedupePlan.effectiveEntries
        .filter((entry: any) => entry.rateCardId === maintenanceRateCard.id);
      batch.update(
        doc(db, 'projects', projectId, 'rateCards', maintenanceRateCard.id),
        buildRateCardStateFromEntries(maintenanceRateCard, nextEffectiveEntries),
      );

      await batch.commit();
      await syncRateDrivenIncrementalTasksForRate({
        projectId,
        rateCardId: maintenanceRateCard.id,
      });
      setEntryDrafts(buildEntryDrafts(nextEffectiveEntries));
      toast.success(
        `Se eliminaron ${maintenanceDuplicateEntries.length} registro${maintenanceDuplicateEntries.length === 1 ? '' : 's'} repetido${maintenanceDuplicateEntries.length === 1 ? '' : 's'} y se recalculó el rate card.`,
      );
    } catch (error: any) {
      console.error('Error cleaning duplicate rate card entries:', error);
      toast.error(`No se pudieron limpiar los duplicados: ${error.message}`);
    } finally {
      setMaintenanceLoading(false);
      setMaintenanceConfirm(null);
    }
  };

  const handleRecalculateMaintenanceRateCard = async () => {
    if (!maintenanceRateCard) return;

    if (maintenanceHasHistoricalBalance) {
      toast.warning('Este rate card tiene saldo acumulado sin movimientos detallados. Convierte primero el saldo en movimiento editable o usa Reiniciar si quieres dejarlo en cero.');
      return;
    }

    setMaintenanceLoading(true);
    try {
      await recalculateRateCardFromEntries(maintenanceRateCard, rateCardEntries.filter(entry => entry.rateCardId === maintenanceRateCard.id));
      toast.success('Rate card recalculado desde sus movimientos.');
    } catch (error: any) {
      console.error('Error recalculating rate card:', error);
      toast.error(`No se pudo recalcular el rate card: ${error.message}`);
    } finally {
      setMaintenanceLoading(false);
    }
  };

  const handleCreateHistoricalMaintenanceEntries = async () => {
    if (!maintenanceRateCard || maintenanceUnresolvedVirtualRows.length === 0) return;

    setMaintenanceLoading(true);
    try {
      const batch = writeBatch(db);
      const now = new Date();
      const periodKeys = getEntryPeriodKeys(now);
      const nextHistoricalEntries = maintenanceUnresolvedVirtualRows.map((row) => {
        const entryRef = doc(collection(db, 'projects', projectId, 'rateCardEntries'));
        const entryData = {
          projectId,
          taskId: null,
          taskTitle: row.taskTitle,
          rateCardId: maintenanceRateCard.id,
          rateCardName: maintenanceRateCard.name || null,
          assignedTo: row.assignedTo || null,
          units: row.units,
          source: row.source,
          comment: 'Movimiento creado desde saneamiento para convertir un acumulado histórico sin detalle en historial editable.',
          isRework: row.isRework,
          historicalBalance: true,
          dateSource: 'historical_inclusion',
          manuallyAdjusted: true,
          ...periodKeys,
          createdAt: serverTimestamp(),
          createdBy: currentUser?.uid || null,
          createdByEmail: currentUser?.email || null,
        };

        batch.set(entryRef, entryData);

        return {
          id: entryRef.id,
          ...entryData,
          createdAt: now,
        };
      });

      const nextEntries = [...maintenanceEntries, ...nextHistoricalEntries];
      batch.update(
        doc(db, 'projects', projectId, 'rateCards', maintenanceRateCard.id),
        buildRateCardStateFromEntries(maintenanceRateCard, nextEntries),
      );

      await batch.commit();
      await syncRateDrivenIncrementalTasksForRate({
        projectId,
        rateCardId: maintenanceRateCard.id,
      });
      setEntryDrafts(previous => ({
        ...previous,
        ...buildEntryDrafts(nextHistoricalEntries),
      }));
      toast.success(`Se creó ${nextHistoricalEntries.length} movimiento${nextHistoricalEntries.length === 1 ? '' : 's'} de ajuste histórico.`);
    } catch (error: any) {
      console.error('Error creating historical rate card entries:', error);
      toast.error(`No se pudo crear el ajuste histórico: ${error.message}`);
    } finally {
      setMaintenanceLoading(false);
    }
  };

  const executeRepairHistoricalTrace = async () => {
    if (!maintenanceRateCard || maintenanceRepairPlan.matches.length === 0) return;

    setMaintenanceLoading(true);
    try {
      const existingTraceKeys = new Set(
        maintenanceRawEntries.map(entry => entry.traceKey).filter(Boolean),
      );
      const existingBusinessMovementKeys = new Set(
        maintenanceRawEntries
          .filter(entry =>
            entry?.rateCardId === maintenanceRateCard.id &&
            !entry?.isRework &&
            !entry?.reversal &&
            !isHistoricalBalanceEntry(entry)
          )
          .map(getRateCardBusinessMovementKey)
          .filter(Boolean),
      );
      const queuedBusinessMovementKeys = new Set<string>();
      const repairableMatches = maintenanceRepairPlan.matches.filter(match => {
        const businessKey = getRateCardBusinessMovementKey({
          taskId: match.taskId,
          externalWorkflowId: match.externalWorkflowId,
          taskTitle: match.taskTitle,
          rateCardId: maintenanceRateCard.id,
          assignedTo: match.assignedTo,
          isRework: false,
        });
        if (!businessKey || existingTraceKeys.has(match.traceKey) || existingBusinessMovementKeys.has(businessKey) || queuedBusinessMovementKeys.has(businessKey)) {
          return false;
        }
        queuedBusinessMovementKeys.add(businessKey);
        return true;
      });

      if (repairableMatches.length === 0) {
        toast.info('La trazabilidad recuperable ya fue registrada.');
        setMaintenanceConfirm(null);
        return;
      }

      const batch = writeBatch(db);
      const repairedEntries = repairableMatches.map(match =>
        addTraceableRateCardMovementToBatch(batch, {
          projectId,
          task: {
            id: match.taskId,
            title: match.taskTitle,
            externalWorkflowId: match.externalWorkflowId,
            parentTaskId: match.parentTaskId,
          },
          rateCardId: maintenanceRateCard.id,
          assignedTo: match.assignedTo,
          units: match.units,
          source: 'workflow_manual_trace_repair',
          rateCardSourceKey: match.rateCardSourceKeys.join('|'),
          stepIndex: match.stepIndex,
          stepName: match.stepName,
          comment: 'Trazabilidad reconstruida desde la tarea, el paso aprobado, el profesional, las unidades y la fecha real de cierre.',
          occurredAt: match.occurredAt,
          actor: {
            id: currentUser?.uid || null,
            email: currentUser?.email || null,
            name: currentUser?.displayName || currentUser?.email || 'Administrador',
          },
          updateAggregate: false,
          completionMode: 'historical_manual_workflow_repair',
          extra: {
            traceKey: match.traceKey,
            repairedFromHistoricalBalance: true,
            manuallyAdjusted: false,
            historicalBalance: false,
            completionEvidence: match.completionEvidence,
            originalCompletedBy: match.originalCompletedBy,
          },
        }),
      ).filter(Boolean) as any[];

      const repairUnitsByUser = repairableMatches.reduce((totals, match) => {
        totals.set(match.assignedTo, (totals.get(match.assignedTo) || 0) + match.units);
        return totals;
      }, new Map<string, number>());

      maintenanceStoredHistoricalRows
        .filter(row => !row.isRework && row.entryId)
        .forEach(row => {
          const remainingRepairUnits = repairUnitsByUser.get(row.assignedTo) || 0;
          if (remainingRepairUnits <= EPSILON || !row.entryId) return;

          const consumedUnits = Math.min(row.units, remainingRepairUnits);
          const leftoverUnits = row.units - consumedUnits;
          const historicalEntryRef = doc(db, 'projects', projectId, 'rateCardEntries', row.entryId);

          if (leftoverUnits <= EPSILON) {
            batch.delete(historicalEntryRef);
          } else {
            batch.update(historicalEntryRef, {
              units: leftoverUnits,
              comment: 'Saldo histórico remanente después de recuperar trazabilidad verificable.',
              updatedAt: serverTimestamp(),
              updatedBy: currentUser?.uid || null,
              updatedByEmail: currentUser?.email || null,
            });
          }
          repairUnitsByUser.set(row.assignedTo, Math.max(0, remainingRepairUnits - consumedUnits));
        });

      await batch.commit();
      setEntryDrafts(previous => ({
        ...previous,
        ...buildEntryDrafts(repairedEntries),
      }));
      toast.success(
        `Se recuperó la trazabilidad de ${repairedEntries.length} movimiento${repairedEntries.length === 1 ? '' : 's'} sin alterar el acumulado.`,
      );
    } catch (error: any) {
      console.error('Error repairing historical rate card trace:', error);
      toast.error(`No se pudo reparar la trazabilidad: ${error.message}`);
    } finally {
      setMaintenanceLoading(false);
      setMaintenanceConfirm(null);
    }
  };

  const handleResetMaintenanceRateCard = async () => {
    if (!maintenanceRateCard) return;
    setMaintenanceConfirm({ type: 'reset' });
  };

  const executeResetMaintenanceRateCard = async () => {
    if (!maintenanceRateCard) return;
    setMaintenanceLoading(true);
    try {
      const batch = writeBatch(db);
      maintenanceEntries.forEach(entry => {
        batch.delete(doc(db, 'projects', projectId, 'rateCardEntries', entry.id));
      });
      batch.update(doc(db, 'projects', projectId, 'rateCards', maintenanceRateCard.id), buildRateCardStateFromEntries(maintenanceRateCard, []));
      await batch.commit();
      await syncRateDrivenIncrementalTasksForRate({
        projectId,
        rateCardId: maintenanceRateCard.id,
      });
      setEntryDrafts({});
      toast.success('Rate card reiniciado en cero.');
    } catch (error: any) {
      console.error('Error resetting rate card:', error);
      toast.error(`No se pudo reiniciar el rate card: ${error.message}`);
    } finally {
      setMaintenanceLoading(false);
      setMaintenanceConfirm(null);
    }
  };

  const formatEntrySource = (source: string) => {
    const labels: Record<string, string> = {
      workflow_step: 'Workflow',
      workflow_step_dynamic: 'Workflow dinámico',
      project_task_status: 'Tarea por estado',
      project_task_status_manual_units: 'Tarea manual',
      project_task_status_reversal: 'Reverso tarea',
      subtask_completion_form: 'Formulario subtarea',
      subtask_completion_form_dynamic: 'Formulario dinámico',
      subtask_completion_form_reversal: 'Reverso formulario',
      manual_adjustment: 'Ajuste manual',
      historical_user_stats: 'Balance histórico',
      historical_rework_stats: 'Reproceso histórico',
      workflow_step_manual_approval: 'Aprobación manual de paso',
      workflow_step_manual_reversal: 'Reversión manual de paso',
      workflow_task_manual_completion: 'Cierre manual de workflow',
      workflow_task_manual_reversal: 'Reapertura manual de workflow',
      workflow_manual_trace_repair: 'Trazabilidad recuperada',
      workflow_task_completion: 'Cierre de workflow',
      assigned_task_progress: 'Avance de tarea',
      workflow_reset_step_reversal: 'Reverso por reinicio de paso',
      workflow_reset_task_reversal: 'Reverso por reinicio de workflow',
    };

    return labels[source] || source || 'Movimiento';
  };

  const toggleAnalysisRate = (rateCardId: string) => {
    setAnalysisRateIds(previous => {
      if (previous.includes(rateCardId)) {
        return previous.length === 1 ? previous : previous.filter(id => id !== rateCardId);
      }
      return [...previous, rateCardId];
    });
  };

  const selectAllAnalysisRates = () => {
    setAnalysisRateIds(rateCards.map(card => card.id));
  };

  const reportRows = dashboardRateCardEntries
    .filter(entry => analysisRateIds.length === 0 || analysisRateIds.includes(entry.rateCardId))
    .map(entry => buildReportRow(entry, getRateCardById(entry.rateCardId)))
    .sort((a, b) => (b.dateKey || '').localeCompare(a.dateKey || '') || a.personName.localeCompare(b.personName));
  const reportHasHistoricalBalances = reportRows.some((entry: any) => entry.historicalBalance);
  const reportIncome = reportRows.reduce((sum: number, entry: any) => sum + entry.recognizedIncome, 0);
  const reportCost = reportRows.reduce((sum: number, entry: any) => sum + entry.cost, 0);
  const reportMargin = reportIncome - reportCost;
  const reportUsesAllRateCards = rateCards.length > 0 && analysisRateIds.length === rateCards.length;

  const reportSummaryRows = Object.values(reportRows.reduce((acc: Record<string, any>, entry: any) => {
    const key = `${entry.assignedTo || 'unknown'}::${entry.rateCardId || 'unknown'}`;
    if (!acc[key]) {
      acc[key] = {
        key,
        personName: entry.personName,
        rateCardName: entry.rateCardName,
        indicator: entry.indicator,
        currency: entry.currency,
        rateType: entry.rateType,
        unitLabel: entry.unitLabel,
        units: 0,
        income: 0,
        cost: 0,
        value: 0,
        movements: 0,
      };
    }
    acc[key].units += entry.units;
    acc[key].income += entry.recognizedIncome;
    acc[key].cost += entry.cost;
    acc[key].value += entry.value;
    acc[key].movements += 1;
    return acc;
  }, {})).sort((a: any, b: any) => b.value - a.value || b.units - a.units);

  const selectedAnalysisCards = rateCards.filter(card => analysisRateIds.includes(card.id));
  const reportChartData = Object.values(reportRows.reduce((acc: Record<string, any>, entry: any) => {
    if (!acc[entry.dateKey]) {
      acc[entry.dateKey] = {
        dateKey: entry.dateKey,
        dateLabel: formatReportDate(entry.dateKey),
      };
    }
    acc[entry.dateKey][entry.rateCardId] = (acc[entry.dateKey][entry.rateCardId] || 0) + entry.units;
    return acc;
  }, {})).sort((a: any, b: any) => a.dateKey.localeCompare(b.dateKey));

  const exportReportCsv = () => {
    if (reportRows.length === 0) {
      toast.info('No hay movimientos para exportar en este rango.');
      return;
    }

    const headers = ['Fecha', 'Origen de fecha', 'Persona', 'Rate Card', 'Tarea', 'Unidades', 'Indicador', 'Ingreso tarea / referencia', 'Ingreso reconocido', 'Costo', 'Resultado', 'Tipo', 'Unidad/moneda', 'Fuente'];
    const csvRows = reportRows.map((entry: any) => [
      entry.displayDate || entry.dateKey,
      entry.dateOrigin === 'task_origin'
        ? 'Tarea de origen'
        : entry.dateOrigin === 'manual_sanitation'
          ? 'Fecha saneada'
          : entry.dateOrigin === 'historical_inclusion'
          ? 'Incorporación histórica'
          : 'Movimiento',
      entry.personName,
      entry.rateCardName,
      entry.taskTitle || '',
      entry.units,
      entry.indicator,
      entry.income.toFixed(2),
      entry.recognizedIncome.toFixed(2),
      entry.cost.toFixed(2),
      entry.value.toFixed(2),
      entry.rateType === 'unit' ? 'Unidad' : 'Dinero',
      entry.rateType === 'unit' ? entry.unitLabel : entry.currency,
      entry.source || '',
    ]);
    const escapeCsv = (value: any) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [headers, ...csvRows].map(row => row.map(escapeCsv).join(',')).join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const periodToken = dashboardStartDate || dashboardEndDate
      ? `${dashboardStartDate || 'inicio'}-${dashboardEndDate || 'fin'}`
      : 'todo-el-periodo';
    link.download = `informe-rate-cards-${periodToken}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleCreateRateCard = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedIncomeRate = normalizeDecimalInput(incomeRate, Number.NaN);
    const parsedCostRate = normalizeDecimalInput(costRate, 0);
    const parsedRate = rateType === 'currency'
      ? parsedIncomeRate
      : normalizeDecimalInput(rate, Number.NaN);
    if (!name.trim() || !indicator.trim() || !Number.isFinite(parsedRate) || parsedRate < 0 || !Number.isFinite(parsedCostRate) || parsedCostRate < 0) {
      toast.warning('Completa nombre, indicador y valores válidos en cero o mayores.');
      return;
    }
    if (rateType === 'unit' && !unitLabel.trim()) {
      toast.warning('Define la unidad o medida que produce este rate card.');
      return;
    }
    setLoading(true);
    try {
      await addDoc(collection(db, 'projects', projectId, 'rateCards'), {
        projectId,
        name: name.trim(),
        indicator: indicator.trim(),
        rate: parsedRate,
        incomeRate: rateType === 'currency' ? parsedIncomeRate : null,
        costRate: parsedCostRate,
        unitCost: parsedCostRate,
        rateType,
        valueType: rateType,
        currency: rateType === 'currency' ? currency : null,
        unitLabel: rateType === 'unit' ? unitLabel.trim() : null,
        syncExternal,
        budgetLineId: budgetLineId || null,
        reportedUnits: 0,
        calculatedIncome: 0,
        calculatedCost: 0,
        calculatedOutput: 0,
        calculatedMargin: 0,
        createdAt: serverTimestamp(),
        createdBy: currentUser.uid
      });
      setName('');
      setIndicator('');
      setRate('');
      setIncomeRate('');
      setCostRate('');
      setRateType('currency');
      setUnitLabel('');
      setCurrency('USD');
      setBudgetLineId('');
      setSyncExternal(false);
      setIsCreateModalOpen(false);
      toast.success('Rate card creado exitosamente');
    } catch (error: any) {
      console.error("Error creating rate card:", error);
      toast.error(`Error al crear rate card: ${error.message}`);
    }
    setLoading(false);
  };

  const handleEditRateCard = (card: any) => {
    setRateCardToEdit(card);
    setName(card.name);
    setIndicator(card.indicator);
    setRate(String(card.rate ?? ''));
    setIncomeRate(String(card.incomeRate ?? card.rate ?? ''));
    setCostRate(String(card.costRate ?? card.unitCost ?? '0'));
    setRateType(normalizeRateCardValueType(card.rateType || card.valueType));
    setCurrency(card.currency || 'USD');
    setUnitLabel(card.unitLabel || card.measureUnit || '');
    setSyncExternal(card.syncExternal || false);
    setBudgetLineId(card.budgetLineId || '');
    setCurrentValue(card.currentValue ? card.currentValue.toString() : '0');
    setIsEditModalOpen(true);
  };

  const executeEditRateCard = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedIncomeRate = normalizeDecimalInput(incomeRate, Number.NaN);
    const parsedCostRate = normalizeDecimalInput(costRate, 0);
    const parsedRate = rateType === 'currency'
      ? parsedIncomeRate
      : normalizeDecimalInput(rate, Number.NaN);
    if (!rateCardToEdit || !name.trim() || !indicator.trim() || !Number.isFinite(parsedRate) || parsedRate < 0 || !Number.isFinite(parsedCostRate) || parsedCostRate < 0) {
      toast.warning('Completa nombre, indicador y valores válidos en cero o mayores.');
      return;
    }
    if (rateType === 'unit' && !unitLabel.trim()) {
      toast.warning('Define la unidad o medida que produce este rate card.');
      return;
    }
    setLoading(true);
    try {
      const updateData: any = {
        name: name.trim(),
        indicator: indicator.trim(),
        rate: parsedRate,
        incomeRate: rateType === 'currency' ? parsedIncomeRate : null,
        costRate: parsedCostRate,
        unitCost: parsedCostRate,
        rateType,
        valueType: rateType,
        currency: rateType === 'currency' ? currency : null,
        unitLabel: rateType === 'unit' ? unitLabel.trim() : null,
        syncExternal,
        budgetLineId: budgetLineId || null,
      };
      
      if (syncExternal && currentValue !== '') {
        updateData.currentValue = normalizeDecimalInput(currentValue, 0);
      }

      Object.assign(updateData, buildRateCardRecalculation({
        ...rateCardToEdit,
        ...updateData,
        id: rateCardToEdit.id,
      }));
      
      await updateDoc(doc(db, 'projects', projectId, 'rateCards', rateCardToEdit.id), updateData);
      setName('');
      setIndicator('');
      setRate('');
      setIncomeRate('');
      setCostRate('');
      setRateType('currency');
      setUnitLabel('');
      setCurrency('USD');
      setBudgetLineId('');
      setSyncExternal(false);
      setCurrentValue('');
      setIsEditModalOpen(false);
      setRateCardToEdit(null);
      toast.success('Rate card actualizado y recalculado con las unidades reportadas.');
    } catch (error: any) {
      console.error("Error updating rate card:", error);
      toast.error(`Error al actualizar rate card: ${error.message}`);
    }
    setLoading(false);
  };

  const handleDeleteRateCard = (id: string) => {
    setRateCardToDelete(id);
  };

  const executeDeleteRateCard = async () => {
    if (!rateCardToDelete) return;
    setIsDeleting(true);
    try {
      await deleteDoc(doc(db, 'projects', projectId, 'rateCards', rateCardToDelete));
      setRateCardToDelete(null);
      toast.success('Rate card eliminado');
    } catch (error) {
      console.error("Error deleting rate card:", error);
      toast.error('Error al eliminar rate card');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <CreditCard size={20} className="text-indigo-500" />
            Rate Cards del Proyecto
          </h2>
          <p className="text-sm text-slate-500 mt-1">Gestiona las tarifas y métricas de facturación.</p>
        </div>
        <Button 
          onClick={() => setIsCreateModalOpen(true)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white"
        >
          <Plus size={16} className="mr-2" />
          Nuevo Rate Card
        </Button>
      </div>

      {/* Dashboard Section */}
      {rateCards.length > 0 && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <span className="rounded-xl bg-indigo-50 p-2.5 text-indigo-600 ring-1 ring-indigo-100">
                  <CalendarRange size={20} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-black text-slate-900">Periodo de las estadísticas</p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">
                    {dashboardPeriodLabel} · {totalMovements} movimiento{totalMovements === 1 ? '' : 's'}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => applyDashboardDatePreset('all')}
                    className={`h-10 rounded-lg px-3 text-xs font-black ring-1 transition ${
                      !dashboardDateFilteringRequested
                        ? 'bg-indigo-600 text-white ring-indigo-600'
                        : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    Todo el periodo
                  </button>
                  <button
                    type="button"
                    onClick={() => applyDashboardDatePreset('month')}
                    className="h-10 rounded-lg bg-white px-3 text-xs font-black text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50"
                  >
                    Este mes
                  </button>
                  <button
                    type="button"
                    onClick={() => applyDashboardDatePreset('last30')}
                    className="h-10 rounded-lg bg-white px-3 text-xs font-black text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50"
                  >
                    Últimos 30 días
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                    Desde
                    <input
                      type="date"
                      value={dashboardStartDate}
                      max={dashboardEndDate || undefined}
                      onChange={(event) => setDashboardStartDate(event.target.value)}
                      className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold normal-case tracking-normal text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </label>
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                    Hasta
                    <input
                      type="date"
                      value={dashboardEndDate}
                      min={dashboardStartDate || undefined}
                      onChange={(event) => setDashboardEndDate(event.target.value)}
                      className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold normal-case tracking-normal text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </label>
                </div>
              </div>
            </div>

            {dashboardDateRangeInvalid && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">
                <AlertCircle size={14} />
                La fecha inicial no puede ser posterior a la fecha final.
              </div>
            )}
            {hasDashboardDateFilter && (historicalTaskDateCount > 0 || historicalInclusionDateCount > 0 || historicalSanitizedDateCount > 0) && (
              <p className="mt-3 text-xs font-semibold text-emerald-700">
                Los movimientos históricos también se filtran por fecha:
                {historicalTaskDateCount > 0 ? ` ${historicalTaskDateCount} recuperado${historicalTaskDateCount === 1 ? '' : 's'} desde la tarea de origen` : ''}
                {historicalTaskDateCount > 0 && (historicalInclusionDateCount > 0 || historicalSanitizedDateCount > 0) ? ',' : ''}
                {historicalInclusionDateCount > 0 ? ` ${historicalInclusionDateCount} desde su fecha documentada de incorporación` : ''}
                {historicalInclusionDateCount > 0 && historicalSanitizedDateCount > 0 ? ' y' : ''}
                {historicalSanitizedDateCount > 0 ? ` ${historicalSanitizedDateCount} con fecha saneada manualmente` : ''}.
              </p>
            )}
            {hasDashboardDateFilter && unresolvedHistoricalDateCount > 0 && (
              <p className="mt-3 text-xs font-semibold text-amber-700">
                {unresolvedHistoricalDateCount} movimiento{unresolvedHistoricalDateCount === 1 ? '' : 's'} histórico{unresolvedHistoricalDateCount === 1 ? '' : 's'} sin tarea ni fecha de incorporación se excluye{unresolvedHistoricalDateCount === 1 ? '' : 'n'} del rango.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Card className="border-emerald-200 bg-emerald-50/40 shadow-sm">
              <CardContent className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wider text-emerald-700">Ingresos</p>
                    <p className="mt-2 text-2xl font-black text-slate-900">{formatMoney(totalProjectGenerated)}</p>
                    <p className="mt-1 text-xs font-semibold text-emerald-700">Rates monetarios</p>
                  </div>
                  <DollarSign className="h-8 w-8 text-emerald-500" />
                </div>
              </CardContent>
            </Card>
            <Card className="border-rose-200 bg-rose-50/40 shadow-sm">
              <CardContent className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wider text-rose-700">Costos</p>
                    <p className="mt-2 text-2xl font-black text-slate-900">{formatMoney(totalProjectCost)}</p>
                    <p className="mt-1 text-xs font-semibold text-rose-700">
                      Producción y reproceso{totalProjectRework > 0 ? ` · incluye ${formatMoney(totalProjectRework)} de reproceso` : ''}
                    </p>
                  </div>
                  <WalletCards className="h-8 w-8 text-rose-500" />
                </div>
              </CardContent>
            </Card>
            <Card className="border-indigo-200 bg-indigo-50/40 shadow-sm">
              <CardContent className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wider text-indigo-700">Margen</p>
                    <p className="mt-2 text-2xl font-black text-slate-900">{formatMoney(totalProjectGenerated - totalProjectCost)}</p>
                    <p className="mt-1 text-xs font-semibold text-indigo-700">Ingreso - costo</p>
                  </div>
                  <TrendingUp className="h-8 w-8 text-indigo-500" />
                </div>
              </CardContent>
            </Card>
            <Card className="border-cyan-200 bg-cyan-50/40 shadow-sm">
              <CardContent className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wider text-cyan-700">Productividad</p>
                    <p className="mt-2 text-2xl font-black text-slate-900">{totalUnitOutput.toLocaleString('es-CO', { maximumFractionDigits: 1 })}</p>
                    <p className="mt-1 text-xs font-semibold text-cyan-700">{unitRateCardCount} rates por unidad</p>
                  </div>
                  <Target className="h-8 w-8 text-cyan-500" />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_420px] 2xl:grid-cols-[minmax(0,1fr)_460px]">
            <Card className="min-w-0 border-slate-200 shadow-sm">
              <CardHeader className="pb-2">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base font-black text-slate-900">
                      <Users size={18} className="text-indigo-500" />
                      Contribución por usuario
                    </CardTitle>
                    <CardDescription className="mt-1">
                      Compara ingreso, costo y reproceso sin perder las etiquetas del gráfico.
                    </CardDescription>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-xl bg-slate-50 px-3 py-2">
                      <p className="font-black uppercase tracking-wider text-slate-400">Usuarios</p>
                      <p className="mt-1 text-lg font-black text-slate-900">{activeUserCount}</p>
                    </div>
                    <div className="rounded-xl bg-indigo-50 px-3 py-2">
                      <p className="font-black uppercase tracking-wider text-indigo-500">Mov.</p>
                      <p className="mt-1 text-lg font-black text-indigo-700">{totalMovements}</p>
                    </div>
                    <div className={`rounded-xl px-3 py-2 ${totalMargin >= 0 ? 'bg-emerald-50' : 'bg-rose-50'}`}>
                      <p className={`font-black uppercase tracking-wider ${totalMargin >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>Margen</p>
                      <p className="mt-1 text-lg font-black text-slate-900">{formatCompactMoney(totalMargin)}</p>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {chartDisplayData.length > 0 ? (
                  <div className="h-[340px] min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartDisplayData} margin={{ top: 12, right: 24, left: 8, bottom: 28 }} barCategoryGap="24%">
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis
                          dataKey="name"
                          axisLine={false}
                          tickLine={false}
                          interval={0}
                          minTickGap={6}
                          tick={{ fontSize: 11, fill: '#64748b' }}
                          tickFormatter={(value) => shortLabel(String(value), 14)}
                        />
                        <YAxis
                          width={76}
                          axisLine={false}
                          tickLine={false}
                          tick={{ fontSize: 11, fill: '#64748b' }}
                          tickFormatter={(value) => formatCompactMoney(Number(value || 0))}
                        />
                        <RechartsTooltip
                          formatter={(value: any, name: any, item: any) => {
                            const metricKey = item?.dataKey || name;
                            const labels: Record<string, string> = {
                              income: 'Ingreso',
                              Ingreso: 'Ingreso',
                              cost: 'Costo',
                              Costo: 'Costo',
                              reworkCost: 'Reproceso',
                              Reproceso: 'Reproceso',
                            };

                            return [
                              formatMoney(Number(value || 0)),
                              labels[metricKey] || String(name || metricKey),
                            ];
                          }}
                          labelFormatter={(label) => String(label)}
                          cursor={{ fill: '#f8fafc' }}
                          contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 16px 30px -20px rgb(15 23 42 / 0.45)' }}
                        />
                        <Bar dataKey="income" name="Ingreso" fill="#10b981" radius={[5, 5, 0, 0]} maxBarSize={42}>
                          {chartDisplayData.map((entry, index) => (
                            <Cell key={`income-${entry.name}-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Bar>
                        <Bar dataKey="cost" name="Costo" fill="#ef4444" radius={[5, 5, 0, 0]} maxBarSize={42} />
                        <Bar dataKey="reworkCost" name="Reproceso" fill="#f97316" radius={[5, 5, 0, 0]} maxBarSize={42} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="flex min-h-[260px] items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-sm italic text-slate-400">
                    {dashboardDateFilteringRequested
                      ? 'No hay movimientos por usuario en el periodo seleccionado.'
                      : 'No hay datos por usuario aún.'}
                  </div>
                )}

                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Top financiero</p>
                      <span className="text-[10px] font-black text-slate-400">{topFinancialUsers.length} visibles</span>
                    </div>
                    <div className="mt-2 space-y-2">
                      {topFinancialUsers.length === 0 ? (
                        <p className="rounded-lg bg-white p-3 text-xs font-semibold text-slate-500">
                          {dashboardDateFilteringRequested ? 'Sin contribución monetaria en este periodo.' : 'Sin contribución monetaria todavía.'}
                        </p>
                      ) : (
                        topFinancialUsers.map((person, index) => (
                          <div key={`${person.name}-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg bg-white px-3 py-2 text-xs ring-1 ring-slate-100">
                            <span className="truncate font-bold text-slate-800" title={person.name}>{person.name}</span>
                            <span className={`font-black ${person.margin >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                              {formatCompactMoney(person.margin)}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Top productividad</p>
                      <span className="text-[10px] font-black text-slate-400">{unitRateCardCount} rates unidad</span>
                    </div>
                    <div className="mt-2 space-y-2">
                      {topProductiveUsers.length === 0 ? (
                        <p className="rounded-lg bg-white p-3 text-xs font-semibold text-slate-500">
                          {dashboardDateFilteringRequested ? 'Sin producción por unidad en este periodo.' : 'Sin producción por unidad todavía.'}
                        </p>
                      ) : (
                        topProductiveUsers.map((person, index) => (
                          <div key={`${person.name}-output-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg bg-white px-3 py-2 text-xs ring-1 ring-slate-100">
                            <span className="truncate font-bold text-slate-800" title={person.name}>{person.name}</span>
                            <span className="font-black text-indigo-700">
                              {person.output.toLocaleString('es-CO', { maximumFractionDigits: 1 })}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="min-w-0 border-slate-200 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-black text-slate-900">Rate seleccionado</CardTitle>
                <CardDescription>Elige un indicador y revisa quién más aporta.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <select
                  value={selectedRateCard?.id || ''}
                  onChange={(event) => setSelectedRateCardId(event.target.value)}
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20"
                >
                  {rateCardAnalytics.map(card => (
                    <option key={card.id} value={card.id}>{card.name}</option>
                  ))}
                </select>
                {selectedRateCard && (
                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-black uppercase tracking-wider text-slate-400">
                          {isCurrencyRateCard(selectedRateCard) ? 'Monetario' : 'Productividad'}
                        </p>
                        <p className="mt-1 break-words text-lg font-black leading-tight text-slate-900">{selectedRateCard.name}</p>
                        <p className="mt-1 text-xs font-semibold text-slate-500">
                          {selectedRateCard.associatedBudgetLine?.name || 'Sin línea de presupuesto'}
                        </p>
                      </div>
                      <span className="max-w-[160px] rounded-full bg-white px-2 py-1 text-right text-[11px] font-black leading-tight text-indigo-700 ring-1 ring-indigo-100">
                        {formatRateCardUnits(selectedRateCard.cardTotalUnits, selectedRateCard, 1)}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="min-w-0 rounded-lg bg-white p-2">
                        <p className="font-bold text-slate-400">Ingreso</p>
                        <p className="break-words font-black text-emerald-700">{formatMoney(selectedRateCard.incomeValue, selectedRateCard.currency || 'USD')}</p>
                      </div>
                      <div className="min-w-0 rounded-lg bg-white p-2">
                        <p className="font-bold text-slate-400">Costo</p>
                        <p className="break-words font-black text-rose-700">{formatMoney(selectedRateCard.costValue, selectedRateCard.currency || 'USD')}</p>
                      </div>
                      <div className="min-w-0 rounded-lg bg-white p-2">
                        <p className="font-bold text-slate-400">Resultado</p>
                        <p className="break-words font-black text-indigo-700">{formatRateCardValue(selectedRateCard.outputValue, selectedRateCard)}</p>
                      </div>
                      <div className="min-w-0 rounded-lg bg-white p-2">
                        <p className="font-bold text-slate-400">Margen</p>
                        <p className="break-words font-black text-slate-900">{formatMoney(selectedRateCard.marginValue, selectedRateCard.currency || 'USD')}</p>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg border border-slate-100 bg-white p-2">
                        <p className="font-bold text-slate-400">Movimientos</p>
                        <p className="mt-1 font-black text-slate-900">{selectedRateCardEntries.length}</p>
                      </div>
                      <div className="rounded-lg border border-slate-100 bg-white p-2">
                        <p className="font-bold text-slate-400">Último</p>
                        <p className="mt-1 truncate font-black text-slate-900" title={selectedRateCardLastEntry?.personName || 'Sin movimiento'}>
                          {selectedRateCardLastEntry ? formatReportDate(selectedRateCardLastEntry.dateKey) : 'Sin dato'}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 space-y-2">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Top contribuyentes</p>
                      {selectedRateCardContribution.length === 0 ? (
                        <p className="rounded-lg bg-white p-3 text-xs font-semibold text-slate-500">
                          {dashboardDateFilteringRequested ? 'Sin contribuyentes en el periodo seleccionado.' : 'Sin movimientos individuales.'}
                        </p>
                      ) : (
                        selectedRateCardContribution.map((person: any) => (
                          <div key={person.userId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg bg-white p-2">
                            <span className="truncate text-xs font-bold text-slate-700" title={person.name}>{person.name}</span>
                            <span className="max-w-[180px] break-words text-right text-xs font-black leading-tight text-indigo-700">
                              {formatRateCardUnits(person.units, selectedRateCard, 1)}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="mt-4 space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Interacciones recientes</p>
                        <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-slate-500 ring-1 ring-slate-100">
                          {selectedRateCardEntries.length}
                        </span>
                      </div>
                      {selectedRateCardEntries.length === 0 ? (
                        <p className="rounded-lg bg-white p-3 text-xs font-semibold text-slate-500">
                          {dashboardDateFilteringRequested
                            ? 'Este rate no tiene interacciones en el periodo seleccionado.'
                            : 'Este rate todavía no tiene interacciones reportadas.'}
                        </p>
                      ) : (
                        <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
                          {selectedRateCardEntries.slice(0, 8).map((entry: any) => (
                            <div key={entry.id} className="rounded-lg bg-white p-2 text-xs ring-1 ring-slate-100">
                              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                                <span className="truncate font-bold text-slate-800" title={entry.personName}>{entry.personName}</span>
                                <span className="max-w-[180px] break-words text-right font-black leading-tight text-indigo-700">
                                  {formatRateCardUnits(entry.units, selectedRateCard, 1)}
                                </span>
                              </div>
                              <div className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-2 text-[11px] text-slate-500">
                                <span>{formatReportDate(entry.dateKey)}</span>
                                <span className="truncate text-right" title={entry.taskTitle || 'Sin tarea asociada'}>{entry.taskTitle || 'Sin tarea asociada'}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <CardTitle className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <FileText size={18} className="text-indigo-500" />
                Estadísticas e interacciones de rates
              </CardTitle>
              <CardDescription className="mt-1">
                Usa el mismo periodo y los mismos movimientos del tablero superior para la gráfica, las tablas y el CSV.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2">
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-indigo-500">Periodo unificado</p>
                <p className="mt-0.5 text-sm font-bold text-indigo-900">{dashboardPeriodLabel}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={exportReportCsv}
                disabled={dashboardDateRangeInvalid || reportRows.length === 0}
                className="h-10 border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                <Download size={15} className="mr-2" />
                CSV
              </Button>
            </div>
          </div>
          <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Rates a graficar</p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={selectAllAnalysisRates} className="h-8 border-slate-200 text-xs">
                  Todos
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setAnalysisRateIds(selectedRateCard ? [selectedRateCard.id] : rateCards.slice(0, 1).map(card => card.id));
                  }}
                  className="h-8 border-slate-200 text-xs"
                >
                  Rate activo
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {rateCards.map(card => {
                const active = analysisRateIds.includes(card.id);
                return (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => toggleAnalysisRate(card.id)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-black transition ${
                      active
                        ? 'border-indigo-200 bg-indigo-600 text-white shadow-sm'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:text-indigo-700'
                    }`}
                  >
                    {card.name}
                  </button>
                );
              })}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!reportUsesAllRateCards && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-800">
              Este detalle resume {selectedAnalysisCards.length} de {rateCards.length} indicadores. Selecciona “Todos” para que sus totales coincidan con el tablero general.
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Movimientos seleccionados</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">{reportRows.length}</p>
                </div>
                <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Ingresos</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">
                    {formatMoney(reportIncome, rateCards[0]?.currency || 'USD')}
                  </p>
                </div>
                <div className="rounded-lg border border-rose-100 bg-rose-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-rose-700">Costos</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">
                    {formatMoney(reportCost, rateCards[0]?.currency || 'USD')}
                  </p>
                </div>
                <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-indigo-700">Margen</p>
                  <p className={`mt-1 text-2xl font-bold ${reportMargin < 0 ? 'text-rose-700' : 'text-slate-900'}`}>
                    {formatMoney(reportMargin, rateCards[0]?.currency || 'USD')}
                  </p>
                </div>
              </div>
              {reportHasHistoricalBalances && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                  Algunos valores vienen de saldos acumulados antiguos. Cuando no existe una tarea vinculada, se ubican por la fecha documentada en que fueron incorporados al historial.
                </div>
              )}

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-black text-slate-900">Movimiento por indicador</h3>
                    <p className="text-xs text-slate-500">La gráfica muestra unidades reportadas por día para comparar rates distintos sin mezclar moneda y productividad.</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">
                    {selectedAnalysisCards.length} seleccionados
                  </span>
                </div>
                {reportChartData.length > 0 ? (
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={reportChartData} margin={{ top: 10, right: 16, left: -10, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="dateLabel" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                        <RechartsTooltip
                          formatter={(value: any, name: any, item: any) => {
                            const metricKey = item?.dataKey || name;
                            const card = rateCards.find(rate => rate.id === metricKey || rate.name === name);
                            return [
                              formatRateCardUnits(Number(value || 0), card || { indicator: 'unidades' }, 2),
                              card?.name || name,
                            ];
                          }}
                          cursor={{ fill: '#f8fafc' }}
                          contentStyle={{ borderRadius: '10px', border: '1px solid #e2e8f0', boxShadow: '0 12px 24px -16px rgb(15 23 42 / 0.35)' }}
                        />
                        {selectedAnalysisCards.map((card, index) => (
                          <Bar
                            key={card.id}
                            dataKey={card.id}
                            name={card.name}
                            fill={COLORS[index % COLORS.length]}
                            radius={[4, 4, 0, 0]}
                            maxBarSize={34}
                          />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 py-10 text-center text-sm text-slate-500">
                    No hay datos para graficar en el rango y rates seleccionados.
                  </div>
                )}
              </div>

              {reportSummaryRows.length > 0 && (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                        <TableHead className="font-semibold text-slate-600">Persona</TableHead>
                        <TableHead className="font-semibold text-slate-600">Rate Card</TableHead>
                        <TableHead className="font-semibold text-slate-600">Movimientos</TableHead>
                        <TableHead className="font-semibold text-slate-600">Unidades netas</TableHead>
                        <TableHead className="font-semibold text-slate-600 text-right">Ingreso</TableHead>
                        <TableHead className="font-semibold text-slate-600 text-right">Costo</TableHead>
                        <TableHead className="font-semibold text-slate-600 text-right">Margen / resultado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reportSummaryRows.map((row: any) => (
                        <TableRow key={row.key}>
                          <TableCell className="font-medium text-slate-900">{row.personName}</TableCell>
                          <TableCell className="text-slate-700">{row.rateCardName}</TableCell>
                          <TableCell className="text-slate-600">{row.movements}</TableCell>
                          <TableCell className="text-slate-700">
                            {formatRateCardUnits(row.units, row)}
                          </TableCell>
                          <TableCell className="text-right font-semibold text-emerald-700">
                            {formatMoney(row.income, row.currency || 'USD')}
                          </TableCell>
                          <TableCell className="text-right font-semibold text-rose-700">
                            {formatMoney(row.cost, row.currency || 'USD')}
                          </TableCell>
                          <TableCell className="text-right font-semibold text-emerald-700">
                            {formatRateCardValue(row.value, row)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              <div className="rounded-xl border border-slate-200 bg-white">
                <button
                  type="button"
                  onClick={() => setShowDetailedMovements(previous => !previous)}
                  className="flex w-full flex-col gap-3 px-4 py-3 text-left transition hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <h3 className="text-sm font-black text-slate-900">Detalle de movimientos individuales</h3>
                    <p className="mt-0.5 text-xs font-semibold text-slate-500">
                      {showDetailedMovements
                        ? 'Oculta esta tabla para volver rápido al panel de saneamiento.'
                        : `${reportRows.length} movimiento${reportRows.length === 1 ? '' : 's'} oculto${reportRows.length === 1 ? '' : 's'} para mantener la vista compacta.`}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">
                    {showDetailedMovements ? 'Ocultar detalle' : 'Mostrar detalle'}
                    <ChevronDown size={14} className={`transition ${showDetailedMovements ? 'rotate-180' : ''}`} />
                  </span>
                </button>

                {showDetailedMovements && (
                  <div className="overflow-x-auto border-t border-slate-200">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                          <TableHead className="font-semibold text-slate-600">Día</TableHead>
                          <TableHead className="font-semibold text-slate-600">Persona</TableHead>
                          <TableHead className="font-semibold text-slate-600">Rate Card</TableHead>
                          <TableHead className="font-semibold text-slate-600">Tarea</TableHead>
                          <TableHead className="font-semibold text-slate-600">Unidades</TableHead>
                          <TableHead className="font-semibold text-slate-600 text-right">Ingreso</TableHead>
                          <TableHead className="font-semibold text-slate-600 text-right">Costo</TableHead>
                          <TableHead className="font-semibold text-slate-600 text-right">Margen / resultado</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {reportRows.map((entry: any) => (
                          <TableRow key={entry.id}>
                            <TableCell className="whitespace-nowrap text-slate-700">
                              <div>{entry.displayDate || formatReportDate(entry.dateKey)}</div>
                              {isHistoricalBalanceEntry(entry) && (
                                <span className="mt-1 inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                                  {entry.dateOrigin === 'task_origin'
                                    ? 'Fecha de tarea'
                                    : entry.dateOrigin === 'manual_sanitation'
                                      ? 'Fecha saneada'
                                      : 'Fecha de incorporación'}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="font-medium text-slate-900">{entry.personName}</TableCell>
                            <TableCell className="text-slate-700">{entry.rateCardName}</TableCell>
                            <TableCell className="max-w-[260px] truncate text-slate-600" title={entry.taskTitle || ''}>
                              {entry.taskTitle || 'Sin tarea'}
                            </TableCell>
                            <TableCell className={entry.units < 0 ? 'font-medium text-red-600' : 'font-medium text-emerald-700'}>
                              {formatRateCardUnits(entry.units, entry)}
                            </TableCell>
                            <TableCell className="text-right font-semibold text-emerald-700">
                              <div>{formatMoney(entry.income, entry.currency || 'USD')}</div>
                              {entry.isRework && (
                                <div className="mt-0.5 text-[10px] font-bold text-slate-400">
                                  Ingreso de la tarea · no se duplica
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-right font-semibold text-rose-700">
                              {formatMoney(entry.cost, entry.currency || 'USD')}
                            </TableCell>
                            <TableCell className={`text-right font-semibold ${entry.value < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                              {formatRateCardValue(entry.value, entry)}
                            </TableCell>
                          </TableRow>
                        ))}
                        {reportRows.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={8} className="py-8 text-center text-sm text-slate-500">
                              No hay movimientos registrados en el rango seleccionado.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/50 hover:bg-slate-50/50">
                <TableHead className="font-semibold text-slate-600">Nombre</TableHead>
                <TableHead className="font-semibold text-slate-600">Línea de Presupuesto</TableHead>
                <TableHead className="font-semibold text-slate-600">Indicador</TableHead>
                <TableHead className="font-semibold text-slate-600">Sincronización</TableHead>
                <TableHead className="font-semibold text-slate-600">Tipo / Factor</TableHead>
                <TableHead className="font-semibold text-slate-600">Generado</TableHead>
                <TableHead className="font-semibold text-slate-600 text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rateCards.map((card) => {
                const analytics = rateCardAnalytics.find(row => row.id === card.id);
                const totalUnits = analytics?.cardTotalUnits || 0;
                const totalGenerated = analytics?.outputValue || 0;
                const incomeValue = analytics?.incomeValue || 0;
                const costValue = analytics?.costValue || 0;
                const marginValue = analytics?.marginValue || 0;
                const reworkCostValue = analytics?.reworkCostValue || 0;
                const associatedBudgetLine = analytics?.associatedBudgetLine || budgetLines.find(bl => bl.id === card.budgetLineId);

                return (
                  <TableRow
                    key={card.id}
                    onClick={() => setSelectedRateCardId(card.id)}
                    className={`cursor-pointer hover:bg-slate-50/70 ${selectedRateCardId === card.id ? 'bg-indigo-50/60 ring-1 ring-inset ring-indigo-100' : ''}`}
                  >
                    <TableCell className="font-medium text-slate-900">{card.name}</TableCell>
                    <TableCell className="text-slate-600">
                      {associatedBudgetLine ? (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">
                          {associatedBudgetLine.name}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic text-xs">Ninguna</span>
                      )}
                    </TableCell>
                    <TableCell className="text-slate-600">{card.indicator}</TableCell>
                    <TableCell>
                      {card.syncExternal ? (
                        <span className="px-2 py-1 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded uppercase">Activa</span>
                      ) : (
                        <span className="px-2 py-1 bg-slate-100 text-slate-500 text-[10px] font-bold rounded uppercase">Manual</span>
                      )}
                    </TableCell>
                    <TableCell className="font-medium text-indigo-600">
                      <div>{formatRateCardRate(isCurrencyRateCard(card) ? getRateCardIncomeRate(card) : card.rate, card)}</div>
                      {getRateCardCostRate(card) > 0 && (
                        <div className="mt-1 text-[11px] font-semibold text-rose-600">
                          Costo {formatMoney(getRateCardCostRate(card), card.currency || 'USD')} / {card.indicator || 'unidad'}
                        </div>
                      )}
                      <div className="mt-1 text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">
                        {isCurrencyRateCard(card) ? 'Dinero' : 'Unidad / medida'}
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">
                      <div className="text-emerald-700">
                        {formatRateCardValue(totalGenerated, card)}
                        <div className="text-xs text-slate-500 font-normal">{formatRateCardUnits(totalUnits, card, 1)}</div>
                      </div>
                      <div className="mt-1 grid grid-cols-1 gap-1 text-[11px] text-slate-500">
                        {isCurrencyRateCard(card) && <span>Ingreso: <b className="text-emerald-700">{formatMoney(incomeValue, card.currency || 'USD')}</b></span>}
                        {costValue > 0 && <span>Costo: <b className="text-rose-700">{formatMoney(costValue, card.currency || 'USD')}</b></span>}
                        {isCurrencyRateCard(card) && <span>Margen: <b className={marginValue < 0 ? 'text-rose-700' : 'text-slate-900'}>{formatMoney(marginValue, card.currency || 'USD')}</b></span>}
                      </div>
                      {reworkCostValue > 0 && (
                        <div className="mt-1 text-red-600" title="Costo de reproceso (Devoluciones)">
                          -{formatMoney(reworkCostValue, card.currency || 'USD')}
                          <div className="text-[10px] font-normal">{formatRateCardUnits(card.reworkValue, card, 1)} reproceso</div>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            openMaintenancePanel(card);
                          }}
                          className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-md transition-colors"
                          title="Saneamiento de movimientos"
                        >
                          <Wrench size={16} />
                        </button>
                        <button 
                          onClick={(event) => {
                            event.stopPropagation();
                            handleEditRateCard(card);
                          }}
                          className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
                          title="Editar"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                        </button>
                        <button 
                          onClick={(event) => {
                            event.stopPropagation();
                            handleDeleteRateCard(card.id);
                          }}
                          className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                          title="Eliminar"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {rateCards.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-slate-500">
                    <CreditCard className="w-12 h-12 text-slate-200 mx-auto mb-3" />
                    <h3 className="text-base font-medium text-slate-900">No hay rate cards</h3>
                    <p className="text-sm text-slate-500 mt-1 mb-4">Crea un rate card para empezar a medir el valor generado.</p>
                    <Button onClick={() => setIsCreateModalOpen(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                      <Plus size={16} className="mr-2" />
                      Crear Rate Card
                    </Button>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Rate Card Maintenance Modal */}
      {maintenanceRateCard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="m-4 flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="border-b border-slate-100 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-amber-700">
                    <Wrench size={13} />
                    Panel de saneamiento
                  </div>
                  <h3 className="mt-3 truncate text-2xl font-black text-slate-950">{maintenanceRateCard.name}</h3>
                  <p className="mt-1 text-sm font-medium text-slate-500">
                    Corrige movimientos uno a uno o descarga la plantilla para sanear fecha, persona, tarea, cantidad y comentario en lote.
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  <input
                    ref={maintenanceFileInputRef}
                    type="file"
                    accept=".csv,.txt,text/csv,text/plain"
                    className="hidden"
                    onChange={(event) => handleMaintenanceCsvFile(event.target.files?.[0] || null)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={downloadMaintenanceCsv}
                    disabled={maintenanceLoading || maintenanceEntries.length === 0}
                    className="border-slate-200 text-slate-700 hover:bg-slate-50"
                  >
                    <Download size={15} className="mr-2" />
                    Descargar CSV
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => maintenanceFileInputRef.current?.click()}
                    disabled={maintenanceLoading}
                    className="border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                  >
                    <Upload size={15} className="mr-2" />
                    Cargar saneamiento
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleRecalculateMaintenanceRateCard}
                    disabled={maintenanceLoading}
                    className="border-slate-200 text-slate-700 hover:bg-slate-50"
                  >
                    <RefreshCw size={15} className={`mr-2 ${maintenanceLoading ? 'animate-spin' : ''}`} />
                    Recalcular
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setMaintenanceConfirm({ type: 'cleanupDuplicates' })}
                    disabled={maintenanceLoading || maintenanceDuplicateEntries.length === 0}
                    className="border-amber-200 text-amber-700 hover:bg-amber-50 disabled:text-slate-400"
                  >
                    <Wrench size={15} className="mr-2" />
                    Limpiar duplicados
                    {maintenanceDuplicateEntries.length > 0 ? ` (${maintenanceDuplicateEntries.length})` : ''}
                  </Button>
                  <Button
                    type="button"
                    onClick={handleResetMaintenanceRateCard}
                    disabled={maintenanceLoading}
                    className="bg-rose-600 text-white hover:bg-rose-700"
                  >
                    <Trash2 size={15} className="mr-2" />
                    Reiniciar
                  </Button>
                  <button
                    type="button"
                    onClick={closeMaintenancePanel}
                    className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                    aria-label="Cerrar saneamiento de rate card"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Movimientos</p>
                  <p className="mt-1 text-xl font-black text-slate-900">{maintenanceEntries.length}</p>
                </div>
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3">
                  <p className="text-[10px] font-black uppercase tracking-wider text-emerald-700">Producción</p>
                  <p className="mt-1 break-words text-lg font-black text-emerald-800">
                    {formatRateCardUnits(maintenanceRateCard.currentValue || 0, maintenanceRateCard, 1)}
                  </p>
                </div>
                <div className="rounded-xl border border-rose-100 bg-rose-50 p-3">
                  <p className="text-[10px] font-black uppercase tracking-wider text-rose-700">Reproceso</p>
                  <p className="mt-1 break-words text-lg font-black text-rose-800">
                    {formatRateCardUnits(maintenanceRateCard.reworkValue || 0, maintenanceRateCard, 1)}
                  </p>
                </div>
                <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3">
                  <p className="text-[10px] font-black uppercase tracking-wider text-indigo-700">Ingreso</p>
                  <p className="mt-1 break-words text-lg font-black text-indigo-900">
                    {formatMoney(getRateCardIncomeValue(maintenanceRateCard.currentValue || 0, maintenanceRateCard), maintenanceRateCard.currency || 'USD')}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-100 bg-white p-3">
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Costo total</p>
                  <p className="mt-1 break-words text-lg font-black text-slate-900">
                    {formatMoney(
                      getRateCardCostValue(maintenanceRateCard.currentValue || 0, maintenanceRateCard) +
                      getRateCardCostValue(Math.abs(Number(maintenanceRateCard.reworkValue || 0)), maintenanceRateCard),
                      maintenanceRateCard.currency || 'USD'
                    )}
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-indigo-700">
                      Instructivo de saneamiento masivo
                    </p>
                    <p className="mt-1 text-sm font-semibold leading-6 text-slate-700">
                      Descarga el CSV, edita únicamente las columnas de fecha, persona, tarea/origen,
                      cantidad y comentario, y vuelve a cargarlo desde este panel.
                    </p>
                  </div>
                  <div className="grid gap-2 text-xs font-bold text-slate-600 sm:grid-cols-2 lg:min-w-[520px]">
                    <span className="rounded-xl bg-white px-3 py-2">Fecha: usa AAAA-MM-DD.</span>
                    <span className="rounded-xl bg-white px-3 py-2">Cantidad: se aceptan 0,051 o 0.051.</span>
                    <span className="rounded-xl bg-white px-3 py-2">No uses separadores de miles.</span>
                    <span className="rounded-xl bg-white px-3 py-2">Cada fila debe representar un movimiento único.</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto bg-slate-50/70 p-5">
              {maintenanceHasHistoricalBalance && (
                <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-amber-700">
                        <AlertCircle size={13} />
                        Saldo histórico sin detalle
                      </div>
                      <h4 className="mt-3 text-base font-black text-slate-950">
                        Hay producción acumulada, pero faltan movimientos individuales para editarla.
                      </h4>
                      <p className="mt-1 max-w-3xl text-sm font-semibold leading-6 text-amber-900/80">
                        No es por la unidad de medida. El acumulado viene de campos antiguos del rate card
                        como producción, reproceso o estadísticas por usuario; la tabla solo lista entradas
                        históricas guardadas como movimientos.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs font-black">
                        {maintenanceHistoricalProduction > EPSILON && (
                          <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">
                            Producción por convertir: {formatRateCardUnits(maintenanceHistoricalProduction, maintenanceRateCard, 2)}
                          </span>
                        )}
                        {maintenanceHistoricalRework > EPSILON && (
                          <span className="rounded-full bg-rose-100 px-3 py-1 text-rose-800">
                            Reproceso por convertir: {formatRateCardUnits(maintenanceHistoricalRework, maintenanceRateCard, 2)}
                          </span>
                        )}
                        <span className="rounded-full bg-white px-3 py-1 text-slate-700">
                          {maintenanceHistoricalGaps.length} ajuste{maintenanceHistoricalGaps.length === 1 ? '' : 's'} posible{maintenanceHistoricalGaps.length === 1 ? '' : 's'}
                        </span>
                        {maintenanceRepairPlan.matches.length > 0 && (
                          <span className="rounded-full bg-indigo-100 px-3 py-1 text-indigo-800">
                            {maintenanceRepairPlan.matches.length} con tarea y fecha verificadas
                          </span>
                        )}
                        {maintenanceRepairPlan.unresolved.length > 0 && (
                          <span className="rounded-full bg-slate-200 px-3 py-1 text-slate-700">
                            {maintenanceRepairPlan.unresolved.length} requieren revisión manual
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col">
                      {maintenanceRepairPlan.matches.length > 0 && (
                        <Button
                          type="button"
                          onClick={() => setMaintenanceConfirm({ type: 'repairTrace' })}
                          disabled={maintenanceLoading}
                          className="bg-indigo-600 text-white hover:bg-indigo-700"
                        >
                          <Wrench size={15} className="mr-2" />
                          Reparar trazabilidad
                        </Button>
                      )}
                      {maintenanceUnresolvedVirtualRows.length > 0 && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleCreateHistoricalMaintenanceEntries}
                          disabled={maintenanceLoading}
                          className="border-amber-300 bg-white text-amber-800 hover:bg-amber-50"
                        >
                          <Save size={15} className="mr-2" />
                          Convertir remanente manual
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {maintenanceEntries.length === 0 ? (
                <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white text-center">
                  <CreditCard className="mb-3 h-10 w-10 text-slate-300" />
                  <h4 className="text-lg font-black text-slate-900">
                    {maintenanceHasHistoricalBalance ? 'Sin movimientos editables todavía' : 'Sin movimientos registrados'}
                  </h4>
                  <p className="mt-1 max-w-md text-sm font-medium text-slate-500">
                    {maintenanceHasHistoricalBalance
                      ? 'Convierte el saldo histórico en un movimiento editable para poder corregirlo desde este panel.'
                      : 'Este rate card no tiene entradas históricas. Puedes reiniciarlo si necesitas dejar sus acumulados en cero.'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50 hover:bg-slate-50">
                        <TableHead className="min-w-[115px] font-black uppercase tracking-wider text-slate-500">Fecha</TableHead>
                        <TableHead className="min-w-[180px] font-black uppercase tracking-wider text-slate-500">Persona</TableHead>
                        <TableHead className="min-w-[140px] font-black uppercase tracking-wider text-slate-500">Cantidad</TableHead>
                        <TableHead className="min-w-[220px] font-black uppercase tracking-wider text-slate-500">Tarea / origen</TableHead>
                        <TableHead className="min-w-[220px] font-black uppercase tracking-wider text-slate-500">Comentario</TableHead>
                        <TableHead className="min-w-[130px] text-right font-black uppercase tracking-wider text-slate-500">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {maintenanceEntries.map((entry: any) => {
                        const draft = entryDrafts[entry.id] || {
                          units: String(entry.units ?? 0),
                          assignedTo: entry.assignedTo || '',
                          comment: entry.comment || '',
                        };

                        return (
                          <TableRow key={entry.id} className={entry.manuallyAdjusted ? 'bg-amber-50/40' : ''}>
                            <TableCell className="whitespace-nowrap text-sm font-bold text-slate-700">
                              <div>{formatReportDate(entry.dateKey)}</div>
                              {entry.isRework && (
                                <span className="mt-1 inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-rose-700">
                                  Reproceso
                                </span>
                              )}
                              {entry.reversal && (
                                <span className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-slate-600">
                                  Reverso
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              <select
                                value={draft.assignedTo}
                                onChange={(event) => updateEntryDraft(entry.id, { assignedTo: event.target.value })}
                                disabled={maintenanceLoading}
                                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20"
                              >
                                <option value="">Sin profesional</option>
                                {teamMembers.map(member => (
                                  <option key={member.id} value={member.id}>{member.name}</option>
                                ))}
                              </select>
                            </TableCell>
                            <TableCell>
                              <input
                                type="text"
                                inputMode="decimal"
                                pattern="[0-9]*[.,]?[0-9]*"
                                value={draft.units}
                                onChange={(event) => updateEntryDraft(entry.id, { units: event.target.value })}
                                disabled={maintenanceLoading}
                                className="h-9 w-full rounded-lg border border-slate-200 px-2 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/20"
                              />
                              <p className="mt-1 text-[10px] font-bold text-slate-400">
                                Guardado: {formatRateCardUnits(entry.units || 0, maintenanceRateCard, 6)}
                              </p>
                            </TableCell>
                            <TableCell className="text-sm">
                              <p className="max-w-[280px] truncate font-black text-slate-900" title={entry.taskTitle || 'Sin tarea asociada'}>
                                {entry.taskTitle || 'Sin tarea asociada'}
                              </p>
                              <p className="mt-1 text-xs font-semibold text-slate-500">
                                {formatEntrySource(entry.source)}
                              </p>
                            </TableCell>
                            <TableCell>
                              <input
                                type="text"
                                value={draft.comment}
                                onChange={(event) => updateEntryDraft(entry.id, { comment: event.target.value })}
                                disabled={maintenanceLoading}
                                className="h-9 w-full rounded-lg border border-slate-200 px-2 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20"
                                placeholder="Motivo o comentario"
                              />
                              {entry.manuallyAdjusted && (
                                <p className="mt-1 text-[10px] font-black uppercase tracking-wider text-amber-700">Ajustado manualmente</p>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleUpdateRateCardEntry(entry)}
                                  disabled={maintenanceLoading}
                                  className="h-8 border-slate-200 px-2 text-xs"
                                  title="Guardar corrección"
                                >
                                  <Save size={14} />
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleDeleteRateCardEntry(entry)}
                                  disabled={maintenanceLoading}
                                  className="h-8 border-rose-200 px-2 text-xs text-rose-600 hover:bg-rose-50"
                                  title="Eliminar movimiento"
                                >
                                  <Trash2 size={14} />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {maintenanceRateCard && maintenanceBulkPreview && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="border-b border-slate-100 p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${maintenanceBulkPreview.errors.length > 0 ? 'bg-rose-50 text-rose-600' : 'bg-indigo-50 text-indigo-600'}`}>
                    <Upload size={22} />
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-lg font-black text-slate-950">Validar saneamiento masivo</h4>
                    <p className="mt-1 truncate text-sm font-semibold text-slate-500" title={maintenanceBulkPreview.fileName}>
                      {maintenanceBulkPreview.fileName}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMaintenanceBulkPreview(null)}
                  disabled={maintenanceLoading}
                  className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Cerrar validación del saneamiento"
                >
                  <X size={19} />
                </button>
              </div>

              <div className="mt-5 grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Filas leídas</p>
                  <p className="mt-1 text-xl font-black text-slate-900">{maintenanceBulkPreview.totalRows}</p>
                </div>
                <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3">
                  <p className="text-[10px] font-black uppercase tracking-wider text-indigo-600">Con cambios</p>
                  <p className="mt-1 text-xl font-black text-indigo-900">{maintenanceBulkPreview.changes.length}</p>
                </div>
                <div className={`rounded-xl border p-3 ${maintenanceBulkPreview.errors.length > 0 ? 'border-rose-100 bg-rose-50' : 'border-emerald-100 bg-emerald-50'}`}>
                  <p className={`text-[10px] font-black uppercase tracking-wider ${maintenanceBulkPreview.errors.length > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>Errores</p>
                  <p className={`mt-1 text-xl font-black ${maintenanceBulkPreview.errors.length > 0 ? 'text-rose-900' : 'text-emerald-900'}`}>{maintenanceBulkPreview.errors.length}</p>
                </div>
              </div>
            </div>

            <div className="max-h-[48vh] space-y-4 overflow-auto bg-slate-50/70 p-6">
              {maintenanceBulkPreview.errors.length > 0 && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
                  <p className="text-sm font-black text-rose-900">
                    Corrige estos errores y vuelve a cargar la plantilla
                  </p>
                  <ul className="mt-3 space-y-2 text-xs font-semibold text-rose-800">
                    {maintenanceBulkPreview.errors.slice(0, 12).map((error, index) => (
                      <li key={`${error}-${index}`} className="rounded-lg bg-white/70 px-3 py-2">{error}</li>
                    ))}
                  </ul>
                  {maintenanceBulkPreview.errors.length > 12 && (
                    <p className="mt-3 text-xs font-black text-rose-700">
                      Y {maintenanceBulkPreview.errors.length - 12} error{maintenanceBulkPreview.errors.length - 12 === 1 ? '' : 'es'} más.
                    </p>
                  )}
                </div>
              )}

              {maintenanceBulkPreview.errors.length === 0 && maintenanceBulkPreview.changes.length === 0 && (
                <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center">
                  <p className="font-black text-slate-900">La plantilla no contiene cambios</p>
                  <p className="mt-1 text-sm font-medium text-slate-500">Los valores coinciden con la información actual.</p>
                </div>
              )}

              {maintenanceBulkPreview.changes.length > 0 && (
                <div className="rounded-2xl border border-slate-200 bg-white">
                  <div className="border-b border-slate-100 px-4 py-3">
                    <p className="text-sm font-black text-slate-900">Cambios detectados</p>
                    <p className="mt-0.5 text-xs font-medium text-slate-500">La carga conserva el tipo y la fuente de cada movimiento.</p>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {maintenanceBulkPreview.changes.slice(0, 20).map(change => (
                      <div key={change.entryId} className="flex items-center justify-between gap-4 px-4 py-3 text-xs">
                        <div className="min-w-0">
                          <p className="truncate font-black text-slate-800">
                            Fila {change.rowNumber} · {change.entry.taskTitle || change.entry.id}
                          </p>
                          <p className="mt-1 truncate font-semibold text-slate-500">{change.entryId}</p>
                        </div>
                        <div className="flex shrink-0 flex-wrap justify-end gap-1">
                          {change.changedFields.map(field => (
                            <span key={field} className="rounded-full bg-indigo-50 px-2 py-1 font-black text-indigo-700">{field}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  {maintenanceBulkPreview.changes.length > 20 && (
                    <p className="border-t border-slate-100 px-4 py-3 text-xs font-black text-slate-500">
                      Y {maintenanceBulkPreview.changes.length - 20} movimiento{maintenanceBulkPreview.changes.length - 20 === 1 ? '' : 's'} más.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-100 p-5">
              <Button
                type="button"
                variant="outline"
                onClick={() => setMaintenanceBulkPreview(null)}
                disabled={maintenanceLoading}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={executeBulkMaintenanceImport}
                disabled={
                  maintenanceLoading ||
                  maintenanceBulkPreview.errors.length > 0 ||
                  maintenanceBulkPreview.changes.length === 0
                }
                className="bg-indigo-600 text-white hover:bg-indigo-700"
              >
                {maintenanceLoading ? <RefreshCw size={15} className="mr-2 animate-spin" /> : <Save size={15} className="mr-2" />}
                Aplicar saneamiento
              </Button>
            </div>
          </div>
        </div>
      )}

      {maintenanceRateCard && maintenanceConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-start gap-3">
              <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
                maintenanceConfirm.type === 'repairTrace'
                  ? 'bg-indigo-50 text-indigo-600'
                  : maintenanceConfirm.type === 'cleanupDuplicates'
                    ? 'bg-amber-50 text-amber-600'
                    : 'bg-rose-50 text-rose-600'
              }`}>
                {maintenanceConfirm.type === 'repairTrace' || maintenanceConfirm.type === 'cleanupDuplicates' ? <Wrench size={22} /> : <AlertCircle size={22} />}
              </div>
              <div>
                <h4 className="text-lg font-black text-slate-950">
                  {maintenanceConfirm.type === 'reset'
                    ? 'Reiniciar rate card'
                    : maintenanceConfirm.type === 'repairTrace'
                      ? 'Reparar trazabilidad histórica'
                      : maintenanceConfirm.type === 'cleanupDuplicates'
                        ? 'Limpiar movimientos repetidos'
                        : 'Eliminar movimiento'}
                </h4>
                <p className="mt-2 text-sm font-medium leading-6 text-slate-600">
                  {maintenanceConfirm.type === 'reset'
                    ? `Se eliminarán ${maintenanceEntries.length} movimiento${maintenanceEntries.length === 1 ? '' : 's'}${maintenanceHasHistoricalBalance ? ' y el saldo histórico sin detalle' : ''}; los acumulados de "${maintenanceRateCard.name}" quedarán en cero.`
                    : maintenanceConfirm.type === 'repairTrace'
                      ? `Se crearán ${maintenanceRepairPlan.matches.length} movimiento${maintenanceRepairPlan.matches.length === 1 ? '' : 's'} detallado${maintenanceRepairPlan.matches.length === 1 ? '' : 's'} con su tarea, paso, profesional y fecha de cierre. El acumulado de "${maintenanceRateCard.name}" no cambiará.`
                      : maintenanceConfirm.type === 'cleanupDuplicates'
                        ? `Se eliminarán ${maintenanceDuplicateEntries.length} registro${maintenanceDuplicateEntries.length === 1 ? '' : 's'} repetido${maintenanceDuplicateEntries.length === 1 ? '' : 's'} de "${maintenanceRateCard.name}". Pixel conservará un solo movimiento efectivo por tarea, persona y rate card; si la tarea tiene movimientos de personas diferentes, se mantienen separados.`
                        : `Se eliminará este movimiento de "${maintenanceRateCard.name}" y se recalcularán sus totales.`}
                </p>
              </div>
            </div>

            {maintenanceConfirm.type === 'repairTrace' && (
              <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-sm">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-indigo-500">Recuperable</p>
                  <p className="mt-1 font-black text-indigo-950">
                    {formatRateCardUnits(maintenanceRepairPlan.recoverableUnits, maintenanceRateCard, 2)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Sin evidencia suficiente</p>
                  <p className="mt-1 font-black text-slate-800">
                    {formatRateCardUnits(maintenanceRepairPlan.unresolvedUnits, maintenanceRateCard, 2)}
                  </p>
                </div>
              </div>
            )}

            {maintenanceConfirm.type === 'deleteEntry' && maintenanceConfirm.entry && (
              <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm">
                <p className="font-black text-slate-900">{maintenanceConfirm.entry.taskTitle || 'Sin tarea asociada'}</p>
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  {formatRateCardUnits(maintenanceConfirm.entry.units || 0, maintenanceRateCard, 2)} · {formatReportDate(getEntryDateKey(maintenanceConfirm.entry))}
                </p>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setMaintenanceConfirm(null)}
                disabled={maintenanceLoading}
                className="border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={() => {
                  if (maintenanceConfirm.type === 'reset') {
                    void executeResetMaintenanceRateCard();
                  } else if (maintenanceConfirm.type === 'repairTrace') {
                    void executeRepairHistoricalTrace();
                  } else if (maintenanceConfirm.type === 'cleanupDuplicates') {
                    void executeCleanupDuplicateRateCardEntries();
                  } else if (maintenanceConfirm.entry) {
                    void executeDeleteRateCardEntry(maintenanceConfirm.entry);
                  }
                }}
                disabled={maintenanceLoading}
                className={
                  maintenanceConfirm.type === 'repairTrace'
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                    : maintenanceConfirm.type === 'cleanupDuplicates'
                      ? 'bg-amber-600 text-white hover:bg-amber-700'
                      : 'bg-rose-600 text-white hover:bg-rose-700'
                }
              >
                {maintenanceLoading
                  ? 'Procesando...'
                  : maintenanceConfirm.type === 'reset'
                    ? 'Sí, reiniciar'
                    : maintenanceConfirm.type === 'repairTrace'
                      ? 'Reparar movimientos'
                      : maintenanceConfirm.type === 'cleanupDuplicates'
                        ? 'Limpiar duplicados'
                        : 'Sí, eliminar'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Create Rate Card Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6 m-4 shadow-xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-100 rounded-lg">
                  <CreditCard className="w-5 h-5 text-indigo-600" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900">Nuevo Rate Card</h3>
              </div>
              <button 
                onClick={() => setIsCreateModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleCreateRateCard} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Nombre</label>
                <input 
                  type="text" 
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full h-10 px-3 rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                  placeholder="Ej. Tarifa Consultor Senior"
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Indicador a medir</label>
                <input 
                  type="text" 
                  value={indicator}
                  onChange={(e) => setIndicator(e.target.value)}
                  className="w-full h-10 px-3 rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                  placeholder="Ej. Horas trabajadas"
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Tipo de resultado</label>
                <select
                  value={rateType}
                  onChange={(e) => setRateType(e.target.value === 'unit' ? 'unit' : 'currency')}
                  className="w-full h-10 px-3 rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                >
                  <option value="currency">Dinero / tarifa monetaria</option>
                  <option value="unit">Unidad / métrica medible</option>
                </select>
              </div>
              {rateType === 'currency' ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Ingreso por indicador</label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={incomeRate}
                      onChange={(e) => setIncomeRate(e.target.value)}
                      className="w-full h-10 px-3 rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                      placeholder="0.00"
                      required
                    />
                    <p className="text-xs text-slate-500">Puede ser 0 si solo genera costo.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Costo por indicador</label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={costRate}
                      onChange={(e) => setCostRate(e.target.value)}
                      className="w-full h-10 px-3 rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                      placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Moneda</label>
                    <select
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      className="w-full h-10 px-3 rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                    >
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                      <option value="COP">COP</option>
                      <option value="MXN">MXN</option>
                    </select>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Factor productivo</label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={rate}
                      onChange={(e) => setRate(e.target.value)}
                      className="w-full h-10 px-3 rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                      placeholder="1.00"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Unidad resultado</label>
                    <input
                      type="text"
                      value={unitLabel}
                      onChange={(e) => setUnitLabel(e.target.value)}
                      className="w-full h-10 px-3 rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                      placeholder="Ej. predios, m2, puntos"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Costo por unidad</label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={costRate}
                      onChange={(e) => setCostRate(e.target.value)}
                      className="w-full h-10 px-3 rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                      placeholder="0.00"
                    />
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Línea de Presupuesto (Opcional)</label>
                <select 
                  value={budgetLineId}
                  onChange={(e) => setBudgetLineId(e.target.value)}
                  className="w-full h-10 px-3 rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                >
                  <option value="">Ninguna</option>
                  {budgetLines.map(line => (
                    <option key={line.id} value={line.id}>{line.name} ({line.plannedAmount.toLocaleString('es-CO', { style: 'currency', currency: line.currency, maximumFractionDigits: 0 })})</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2 pt-2">
                <input 
                  type="checkbox" 
                  id="syncExternalRC"
                  checked={syncExternal}
                  onChange={(e) => setSyncExternal(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <label htmlFor="syncExternalRC" className="text-sm font-medium text-slate-700 cursor-pointer">
                  Sincronizar con base de datos externa
                </label>
              </div>
              
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 mt-6">
                <Button 
                  type="button"
                  variant="outline" 
                  onClick={() => setIsCreateModalOpen(false)}
                  className="border-slate-200 text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </Button>
                <Button 
                  type="submit" 
                  disabled={!name || !indicator || (rateType === 'currency' ? incomeRate === '' : rate === '') || loading} 
                  className="bg-indigo-600 hover:bg-indigo-700 text-white disabled:bg-slate-300"
                >
                  {loading ? 'Creando...' : 'Crear Rate Card'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Rate Card Modal */}
      {isEditModalOpen && rateCardToEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6 m-4 shadow-xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-100 rounded-lg">
                  <CreditCard className="w-5 h-5 text-indigo-600" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900">Editar Rate Card</h3>
              </div>
              <button 
                onClick={() => {
                  setIsEditModalOpen(false);
                  setRateCardToEdit(null);
                }}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={executeEditRateCard} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Nombre</label>
                <input 
                  type="text" 
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full h-10 px-3 rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                  placeholder="Ej. Tarifa Consultor Senior"
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Indicador a medir</label>
                <input 
                  type="text" 
                  value={indicator}
                  onChange={(e) => setIndicator(e.target.value)}
                  className="w-full h-10 px-3 rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                  placeholder="Ej. Horas trabajadas"
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Tipo de resultado</label>
                <select
                  value={rateType}
                  onChange={(e) => setRateType(e.target.value === 'unit' ? 'unit' : 'currency')}
                  className="w-full h-10 px-3 rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                >
                  <option value="currency">Dinero / tarifa monetaria</option>
                  <option value="unit">Unidad / métrica medible</option>
                </select>
              </div>
              {rateType === 'currency' ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Ingreso por indicador</label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={incomeRate}
                      onChange={(e) => setIncomeRate(e.target.value)}
                      className="w-full h-10 px-3 rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                      placeholder="0.00"
                      required
                    />
                    <p className="text-xs text-slate-500">Puede ser 0 si solo genera costo.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Costo por indicador</label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={costRate}
                      onChange={(e) => setCostRate(e.target.value)}
                      className="w-full h-10 px-3 rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                      placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Moneda</label>
                    <select
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      className="w-full h-10 px-3 rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                    >
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                      <option value="COP">COP</option>
                      <option value="MXN">MXN</option>
                    </select>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Factor productivo</label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={rate}
                      onChange={(e) => setRate(e.target.value)}
                      className="w-full h-10 px-3 rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                      placeholder="1.00"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Unidad resultado</label>
                    <input
                      type="text"
                      value={unitLabel}
                      onChange={(e) => setUnitLabel(e.target.value)}
                      className="w-full h-10 px-3 rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                      placeholder="Ej. predios, m2, puntos"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Costo por unidad</label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={costRate}
                      onChange={(e) => setCostRate(e.target.value)}
                      className="w-full h-10 px-3 rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                      placeholder="0.00"
                    />
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Línea de Presupuesto (Opcional)</label>
                <select 
                  value={budgetLineId}
                  onChange={(e) => setBudgetLineId(e.target.value)}
                  className="w-full h-10 px-3 rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                >
                  <option value="">Ninguna</option>
                  {budgetLines.map(line => (
                    <option key={line.id} value={line.id}>{line.name} ({line.plannedAmount.toLocaleString('es-CO', { style: 'currency', currency: line.currency, maximumFractionDigits: 0 })})</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2 pt-2">
                <input 
                  type="checkbox" 
                  id="syncExternalRCEdit"
                  checked={syncExternal}
                  onChange={(e) => setSyncExternal(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <label htmlFor="syncExternalRCEdit" className="text-sm font-medium text-slate-700 cursor-pointer">
                  Sincronizar con base de datos externa
                </label>
              </div>

              {syncExternal && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                  <label className="text-sm font-medium text-slate-700">Valor Actual (Cantidad)</label>
                  <input 
                    type="number" 
                    step="any"
                    min="0"
                    value={currentValue}
                    onChange={(e) => setCurrentValue(e.target.value)}
                    className="w-full h-10 px-3 rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                    placeholder="0.00"
                    required={syncExternal}
                  />
                  <p className="text-xs text-slate-500">
                    Como la sincronización externa está activa, puedes ajustar el valor actual manualmente si es necesario.
                  </p>
                </div>
              )}
              
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 mt-6">
                <Button 
                  type="button"
                  variant="outline" 
                  onClick={() => {
                    setIsEditModalOpen(false);
                    setRateCardToEdit(null);
                  }}
                  className="border-slate-200 text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </Button>
                <Button 
                  type="submit" 
                  disabled={!name || !indicator || (rateType === 'currency' ? incomeRate === '' : rate === '') || loading} 
                  className="bg-indigo-600 hover:bg-indigo-700 text-white disabled:bg-slate-300"
                >
                  {loading ? 'Guardando...' : 'Guardar Cambios'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Rate Card Modal */}
      {rateCardToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 m-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 text-red-600 mb-4">
              <div className="p-2 bg-red-100 rounded-full">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900">Eliminar Rate Card</h3>
            </div>
            
            <p className="text-slate-600 mb-6">
              ¿Estás seguro de que deseas eliminar este rate card? Esta acción no se puede deshacer.
            </p>
            
            <div className="flex justify-end gap-3">
              <Button 
                variant="outline" 
                onClick={() => setRateCardToDelete(null)}
                disabled={isDeleting}
                className="border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </Button>
              <Button 
                onClick={executeDeleteRateCard}
                disabled={isDeleting}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {isDeleting ? 'Eliminando...' : 'Sí, eliminar rate card'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
