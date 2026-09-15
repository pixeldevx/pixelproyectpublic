import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Boxes,
  Calculator,
  CheckCircle2,
  Copy,
  DollarSign,
  Layers3,
  PackagePlus,
  Plus,
  Save,
  Sparkles,
  Timer,
  Trash2,
  TrendingUp,
  UserRound,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, updateDoc } from '@/lib/supabase/document-store';
import { db } from '@/lib/backend';
import { getOrganizationIds } from '@/lib/organizations';
import { toast } from 'sonner';
import {
  getRateCardCostValue,
  getRateCardIncomeValue,
  normalizeDecimalInput,
} from '@/lib/rate-card-config';

type BudgetPiece = {
  id: string;
  name: string;
  category: string;
  categoryLabel?: string;
  startMonth: number;
  activeMonths?: number[];
  assignedMemberIds?: string[];
  quantity: number;
  duration: number;
  multiplier: number;
  unitCost: number;
  unitLabel: string;
  notes?: string;
};

type BudgetLine = {
  id: string;
  name?: string;
  description?: string;
  category?: string;
  color?: string;
  plannedAmount?: number;
  currency?: string;
  components?: BudgetPiece[];
  createdAt?: any;
};

type BudgetLineTemplate = {
  id: string;
  label: string;
  hint?: string;
  name?: string;
  description?: string;
  currency?: string;
  color?: string;
  pieces: BudgetPiece[];
  projectId?: string | null;
  projectName?: string | null;
  organizationId?: string | null;
  organizationIds?: string[];
  organizationName?: string | null;
  isSystem?: boolean;
  createdAt?: any;
};

type BudgetPieceType = {
  id: string;
  label: string;
  tone: string;
  pixel: string;
  dot: string;
  icon?: any;
  isDefault?: boolean;
};

type BudgetLineData = BudgetLine & {
  pieces: BudgetPiece[];
  plannedAmount: number;
  actualAmount: number;
  operatingCost: number;
  operatingIncome: number;
  variance: number;
  percentUsed: number;
  pieceCount: number;
};

type PieceViewMode = 'table' | 'timeline';

const TYPE_PALETTE = [
  { tone: 'bg-violet-50 text-violet-700 ring-violet-100', pixel: 'bg-violet-500', dot: 'bg-violet-500' },
  { tone: 'bg-cyan-50 text-cyan-700 ring-cyan-100', pixel: 'bg-cyan-500', dot: 'bg-cyan-500' },
  { tone: 'bg-emerald-50 text-emerald-700 ring-emerald-100', pixel: 'bg-emerald-500', dot: 'bg-emerald-500' },
  { tone: 'bg-orange-50 text-orange-700 ring-orange-100', pixel: 'bg-orange-500', dot: 'bg-orange-500' },
  { tone: 'bg-rose-50 text-rose-700 ring-rose-100', pixel: 'bg-rose-500', dot: 'bg-rose-500' },
  { tone: 'bg-sky-50 text-sky-700 ring-sky-100', pixel: 'bg-sky-500', dot: 'bg-sky-500' },
  { tone: 'bg-amber-50 text-amber-700 ring-amber-100', pixel: 'bg-amber-500', dot: 'bg-amber-500' },
  { tone: 'bg-slate-100 text-slate-700 ring-slate-200', pixel: 'bg-slate-500', dot: 'bg-slate-500' },
];

const DEFAULT_PIECE_TYPES: BudgetPieceType[] = [
  { id: 'people', label: 'Personas', icon: UserRound, isDefault: true, ...TYPE_PALETTE[0] },
  { id: 'licenses', label: 'Licencias', icon: Copy, isDefault: true, ...TYPE_PALETTE[1] },
  { id: 'operations', label: 'Operación', icon: Boxes, isDefault: true, ...TYPE_PALETTE[2] },
  { id: 'deliverables', label: 'Entregables', icon: Layers3, isDefault: true, ...TYPE_PALETTE[3] },
  { id: 'other', label: 'Otro', icon: PackagePlus, isDefault: true, ...TYPE_PALETTE[7] },
];

const MONTH_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const BUDGET_LINE_COLORS = [
  { value: '#4f46e5', label: 'Índigo', soft: '#eef2ff' },
  { value: '#059669', label: 'Verde', soft: '#ecfdf5' },
  { value: '#0891b2', label: 'Cian', soft: '#ecfeff' },
  { value: '#f97316', label: 'Naranja', soft: '#fff7ed' },
  { value: '#e11d48', label: 'Rosa', soft: '#fff1f2' },
  { value: '#7c3aed', label: 'Violeta', soft: '#f5f3ff' },
  { value: '#475569', label: 'Slate', soft: '#f8fafc' },
];

const BUDGET_TEMPLATES: BudgetLineTemplate[] = [
  {
    id: 'system-human-team',
    label: 'Equipo humano',
    hint: 'Profesionales por tiempo y dedicación.',
    name: 'Equipo humano',
    description: 'Profesionales por tiempo y dedicación.',
    currency: 'COP',
    color: BUDGET_LINE_COLORS[0].value,
    isSystem: true,
    pieces: [
      { id: 'tpl-manager', name: 'Gerente de proyecto', category: 'people', categoryLabel: 'Personas', startMonth: 1, quantity: 1, duration: 3, multiplier: 1, unitCost: 0, unitLabel: 'mes' },
      { id: 'tpl-analyst', name: 'Analistas', category: 'people', categoryLabel: 'Personas', startMonth: 1, quantity: 2, duration: 3, multiplier: 1, unitCost: 0, unitLabel: 'mes' },
    ],
  },
  {
    id: 'system-software-licenses',
    label: 'Licencias y software',
    hint: 'Suscripciones multiplicadas por usuarios y meses.',
    name: 'Licencias y software',
    description: 'Suscripciones multiplicadas por usuarios y meses.',
    currency: 'COP',
    color: BUDGET_LINE_COLORS[2].value,
    isSystem: true,
    pieces: [
      { id: 'tpl-license', name: 'Licencias de software', category: 'licenses', categoryLabel: 'Licencias', startMonth: 1, quantity: 5, duration: 3, multiplier: 1, unitCost: 0, unitLabel: 'licencia/mes' },
    ],
  },
  {
    id: 'system-field-operations',
    label: 'Operación de campo',
    hint: 'Jornadas, viáticos, equipos o logística.',
    name: 'Operación de campo',
    description: 'Jornadas, viáticos, equipos o logística.',
    currency: 'COP',
    color: BUDGET_LINE_COLORS[1].value,
    isSystem: true,
    pieces: [
      { id: 'tpl-field', name: 'Jornadas operativas', category: 'operations', categoryLabel: 'Operación', startMonth: 1, quantity: 10, duration: 1, multiplier: 1, unitCost: 0, unitLabel: 'jornada' },
      { id: 'tpl-logistics', name: 'Logística y transporte', category: 'operations', categoryLabel: 'Operación', startMonth: 1, quantity: 1, duration: 1, multiplier: 1, unitCost: 0, unitLabel: 'global' },
    ],
  },
];

const currencyFormatter = (value: number, currency = 'COP') =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'COP' ? 0 : 2,
  }).format(Number.isFinite(value) ? value : 0);

const compactNumber = (value: number) => new Intl.NumberFormat('es-CO').format(Number.isFinite(value) ? value : 0);

const formatPlainNumber = (value: number) =>
  new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(Number.isFinite(Number(value)) ? Number(value) : 0);

const parseFormattedNumber = (value: string | number) => {
  if (typeof value === 'number') return value;
  const normalized = value
    .replace(/\s/g, '')
    .replace(/\$/g, '')
    .replace(/\./g, '')
    .replace(/,/g, '.')
    .replace(/[^\d.-]/g, '');
  return toNumber(normalized, 0);
};

const createId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
};

const toNumber = (value: any, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toDurationNumber = (value: any, fallback = 1) => Math.max(0, toNumber(value, fallback));

const getLineColorConfig = (color?: string) =>
  BUDGET_LINE_COLORS.find((item) => item.value === color) || BUDGET_LINE_COLORS[0];

const getNotesRows = (notes = '') => Math.min(4, Math.max(1, Math.ceil(notes.length / 86), notes.split('\n').length));

const clampMonthNumber = (value: any, fallback = 1) => Math.max(1, Math.round(toNumber(value, fallback)));

const getTimelineMonthLabel = (monthNumber: number) => {
  const safeMonth = clampMonthNumber(monthNumber);
  const monthIndex = (safeMonth - 1) % MONTH_LABELS.length;
  const cycle = Math.floor((safeMonth - 1) / MONTH_LABELS.length);
  return cycle === 0 ? MONTH_LABELS[monthIndex] : `${MONTH_LABELS[monthIndex]} +${cycle}`;
};

const normalizeActiveMonths = (months: any[] = []) =>
  Array.from(
    new Set(
      months
        .map((month) => clampMonthNumber(month))
        .filter((month) => Number.isFinite(month) && month > 0)
    )
  ).sort((a, b) => a - b);

const normalizeStringArray = (value: any) =>
  Array.from(new Set((Array.isArray(value) ? value : []).map((item) => String(item || '').trim()).filter(Boolean)));

const buildContinuousMonths = (startMonth: number, duration: number) =>
  Array.from({ length: Math.max(0, Math.ceil(toNumber(duration, 0))) }, (_, index) => clampMonthNumber(startMonth) + index);

const getPieceActiveMonths = (piece: BudgetPiece) => {
  if (Array.isArray(piece.activeMonths)) return normalizeActiveMonths(piece.activeMonths);
  return buildContinuousMonths(clampMonthNumber(piece.startMonth), Math.max(1, toDurationNumber(piece.duration, 1)));
};

const getPieceDuration = (piece: BudgetPiece) => toDurationNumber(piece.duration, getPieceActiveMonths(piece).length || 0);

const applyPieceSchedule = (piece: BudgetPiece, months: number[]) => {
  const activeMonths = normalizeActiveMonths(months);
  return {
    ...piece,
    activeMonths,
    duration: activeMonths.length,
    startMonth: activeMonths[0] || clampMonthNumber(piece.startMonth),
  };
};

const updatePieceField = (piece: BudgetPiece, field: keyof BudgetPiece, value: string | number | string[]): BudgetPiece => {
  if (field === 'startMonth') {
    const startMonth = clampMonthNumber(value);
    const duration = toDurationNumber(piece.duration, 0);
    return {
      ...piece,
      startMonth,
      activeMonths: buildContinuousMonths(startMonth, duration),
    };
  }

  if (field === 'duration') {
    const duration = toDurationNumber(value, 0);
    return {
      ...piece,
      duration,
      activeMonths: buildContinuousMonths(piece.startMonth, duration),
    };
  }

  if (['quantity', 'multiplier', 'unitCost'].includes(field)) {
    return { ...piece, [field]: toNumber(value) };
  }

  if (field === 'assignedMemberIds') {
    return { ...piece, assignedMemberIds: normalizeStringArray(value) };
  }

  return { ...piece, [field]: value };
};

const createBlankPiece = (overrides: Partial<BudgetPiece> = {}): BudgetPiece => ({
  id: createId(),
  name: 'Nueva pieza',
  category: 'people',
  startMonth: 1,
  activeMonths: [1],
  assignedMemberIds: [],
  quantity: 1,
  duration: 1,
  multiplier: 1,
  unitCost: 0,
  unitLabel: 'mes',
  notes: '',
  ...overrides,
});

const normalizePiece = (piece: any): BudgetPiece => {
  const startMonth = clampMonthNumber(piece?.startMonth);
  const savedActiveMonths = Array.isArray(piece?.activeMonths)
    ? normalizeActiveMonths(piece.activeMonths)
    : null;
  const duration = toDurationNumber(piece?.duration, savedActiveMonths?.length || 1);
  const activeMonths = savedActiveMonths || buildContinuousMonths(startMonth, Math.max(1, duration));

  return {
    id: piece?.id || createId(),
    name: piece?.name || 'Pieza de presupuesto',
    category: piece?.category || 'other',
    categoryLabel: piece?.categoryLabel || piece?.categoryName || '',
    startMonth: activeMonths[0] || startMonth,
    activeMonths,
    assignedMemberIds: normalizeStringArray(piece?.assignedMemberIds),
    quantity: toNumber(piece?.quantity, 1),
    duration,
    multiplier: toNumber(piece?.multiplier, 1),
    unitCost: toNumber(piece?.unitCost, 0),
    unitLabel: piece?.unitLabel || 'unidad',
    notes: piece?.notes || '',
  };
};

const normalizeBudgetPieces = (line: BudgetLine): BudgetPiece[] => {
  if (Array.isArray(line.components) && line.components.length > 0) {
    return line.components.map(normalizePiece);
  }

  if (Number(line.plannedAmount || 0) > 0) {
    return [
      createBlankPiece({
        id: 'base-budget',
        name: 'Presupuesto base',
        category: 'other',
        startMonth: 1,
        activeMonths: [1],
        assignedMemberIds: [],
        quantity: 1,
        duration: 1,
        multiplier: 1,
        unitCost: Number(line.plannedAmount || 0),
        unitLabel: 'global',
      }),
    ];
  }

  return [createBlankPiece()];
};

const pieceTotal = (piece: BudgetPiece) => {
  return toNumber(piece.quantity, 0) * getPieceDuration(piece) * toNumber(piece.multiplier, 0) * toNumber(piece.unitCost, 0);
};

const piecesTotal = (pieces: BudgetPiece[]) => pieces.reduce((sum, piece) => sum + pieceTotal(piece), 0);

const getPieceTypeTone = (index: number) => TYPE_PALETTE[index % TYPE_PALETTE.length];

const normalizePieceType = (pieceType: any, index: number): BudgetPieceType => ({
  id: pieceType?.id || createId(),
  label: pieceType?.label || pieceType?.name || 'Tipo personalizado',
  icon: PackagePlus,
  isDefault: false,
  ...getPieceTypeTone(index + DEFAULT_PIECE_TYPES.length),
});

const normalizeTemplateName = (value = '') => value.trim().replace(/\s+/g, ' ').toLowerCase();

const normalizeBudgetLineTemplate = (template: any): BudgetLineTemplate => {
  const pieces = Array.isArray(template?.pieces)
    ? template.pieces.map(normalizePiece)
    : Array.isArray(template?.components)
      ? template.components.map(normalizePiece)
      : [];

  return {
    id: template?.id || createId(),
    label: template?.label || template?.name || 'Plantilla de presupuesto',
    hint: template?.hint || template?.description || '',
    name: template?.name || template?.label || '',
    description: template?.description || template?.hint || '',
    currency: template?.currency || 'COP',
    color: template?.color || BUDGET_LINE_COLORS[0].value,
    pieces,
    projectId: template?.projectId || null,
    projectName: template?.projectName || null,
    organizationId: template?.organizationId || null,
    organizationIds: getOrganizationIds(template),
    organizationName: template?.organizationName || null,
    isSystem: Boolean(template?.isSystem),
    createdAt: template?.createdAt,
  };
};

const getBudgetTemplateScopeLabel = (template: BudgetLineTemplate, currentProjectId: string) => {
  if (template.isSystem) return 'Base';
  if (template.projectId === currentProjectId) return 'Este proyecto';
  if (template.organizationName) return template.organizationName;
  if (template.projectName) return template.projectName;
  return 'Organización';
};

export function ProjectBudget({
  projectId,
  rateCards = [],
  tasks = [],
  teamMembers = [],
}: {
  projectId: string;
  rateCards?: any[];
  tasks?: any[];
  teamMembers?: any[];
}) {
  const [budgetLines, setBudgetLines] = useState<BudgetLine[]>([]);
  const [projectContext, setProjectContext] = useState<any>(null);
  const [customPieceTypes, setCustomPieceTypes] = useState<BudgetPieceType[]>([]);
  const [savedBudgetTemplates, setSavedBudgetTemplates] = useState<BudgetLineTemplate[]>([]);
  const [lineDrafts, setLineDrafts] = useState<Record<string, BudgetPiece[]>>({});
  const [dirtyLines, setDirtyLines] = useState<Record<string, boolean>>({});
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [currency, setCurrency] = useState('COP');
  const [lineColor, setLineColor] = useState(BUDGET_LINE_COLORS[0].value);
  const [newLinePieces, setNewLinePieces] = useState<BudgetPiece[]>([createBlankPiece()]);
  const [newLineViewMode, setNewLineViewMode] = useState<PieceViewMode>('table');
  const [lineViewModes, setLineViewModes] = useState<Record<string, PieceViewMode>>({});
  const [loading, setLoading] = useState(false);
  const [budgetLineToDelete, setBudgetLineToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newPieceTypeName, setNewPieceTypeName] = useState('');
  const [editingPieceTypeId, setEditingPieceTypeId] = useState<string | null>(null);
  const [editingPieceTypeLabel, setEditingPieceTypeLabel] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [templateHint, setTemplateHint] = useState('');
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);

  const pieceTypes = useMemo(() => [...DEFAULT_PIECE_TYPES, ...customPieceTypes], [customPieceTypes]);
  const projectOrganizationIds = useMemo(() => getOrganizationIds(projectContext), [projectContext]);

  const getCategoryConfig = (category: string) =>
    pieceTypes.find((item) => item.id === category) || pieceTypes.find((item) => item.id === 'other') || DEFAULT_PIECE_TYPES[DEFAULT_PIECE_TYPES.length - 1];

  const projectName = projectContext?.name || projectContext?.title || projectContext?.projectName || 'Proyecto';
  const projectOrganizationName =
    projectContext?.organizationName || projectContext?.organization || projectContext?.clientName || '';

  const reusableBudgetTemplates = useMemo(() => {
    const organizationSet = new Set(projectOrganizationIds);
    return savedBudgetTemplates
      .filter((template) => {
        if (template.projectId === projectId) return true;
        if (projectOrganizationIds.length === 0) return false;

        const templateOrganizationIds = getOrganizationIds(template);
        return templateOrganizationIds.some((organizationId) => organizationSet.has(organizationId));
      })
      .sort((left, right) => {
        const scopeCompare = getBudgetTemplateScopeLabel(left, projectId).localeCompare(getBudgetTemplateScopeLabel(right, projectId));
        if (scopeCompare !== 0) return scopeCompare;
        return left.label.localeCompare(right.label);
      });
  }, [projectId, projectOrganizationIds, savedBudgetTemplates]);

  const availableBudgetTemplates = useMemo(
    () => [...BUDGET_TEMPLATES, ...reusableBudgetTemplates],
    [reusableBudgetTemplates]
  );

  const createTemplatePiece = (piece: BudgetPiece) => {
    const normalized = normalizePiece(piece);
    const categoryConfig = getCategoryConfig(normalized.category);
    return {
      ...normalized,
      id: createId(),
      assignedMemberIds: [],
      categoryLabel: categoryConfig.label,
    };
  };

  const createPieceFromTemplate = (piece: BudgetPiece) => {
    const normalized = normalizePiece(piece);
    const label = normalizeTemplateName(normalized.categoryLabel || '');
    const matchingCategory =
      pieceTypes.find((item) => item.id === normalized.category) ||
      pieceTypes.find((item) => normalizeTemplateName(item.label) === label) ||
      pieceTypes.find((item) => item.id === 'other') ||
      DEFAULT_PIECE_TYPES[DEFAULT_PIECE_TYPES.length - 1];

    return {
      ...normalized,
      id: createId(),
      assignedMemberIds: [],
      category: matchingCategory.id,
      categoryLabel: matchingCategory.label,
    };
  };

  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, 'projects', projectId),
      (snapshot) => {
        setProjectContext(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
      },
      (error) => {
        console.error('Error loading project context for budget templates:', error);
      }
    );

    return () => unsubscribe();
  }, [projectId]);

  useEffect(() => {
    const budgetQuery = query(collection(db, 'projects', projectId, 'budgetLines'));
    const unsubscribe = onSnapshot(budgetQuery, (snapshot) => {
      const data = snapshot.docs.map((budgetDoc) => ({
        id: budgetDoc.id,
        ...budgetDoc.data(),
      } as BudgetLine));
      data.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      setBudgetLines(data);
      setLineDrafts((current) => {
        const next: Record<string, BudgetPiece[]> = {};
        data.forEach((line) => {
          next[line.id] = current[line.id] || normalizeBudgetPieces(line);
        });
        return next;
      });
    });

    return () => unsubscribe();
  }, [projectId]);

  useEffect(() => {
    const templatesQuery = query(collection(db, 'budgetLineTemplates'));
    const unsubscribe = onSnapshot(
      templatesQuery,
      (snapshot) => {
        const data = snapshot.docs.map((templateDoc) =>
          normalizeBudgetLineTemplate({
            id: templateDoc.id,
            ...templateDoc.data(),
          })
        );
        setSavedBudgetTemplates(data);
      },
      (error) => {
        console.error('Error loading budget line templates:', error);
      }
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const typeQuery = query(collection(db, 'projects', projectId, 'budgetPieceTypes'));
    const unsubscribe = onSnapshot(typeQuery, (snapshot) => {
      const data = snapshot.docs.map((typeDoc, index) =>
        normalizePieceType(
          {
            id: typeDoc.id,
            ...typeDoc.data(),
          },
          index
        )
      );
      data.sort((a, b) => a.label.localeCompare(b.label));
      setCustomPieceTypes(data);
    });

    return () => unsubscribe();
  }, [projectId]);

  const resetCreateForm = () => {
    setName('');
    setDescription('');
    setCurrency('COP');
    setLineColor(BUDGET_LINE_COLORS[0].value);
    setNewLinePieces([createBlankPiece()]);
    setNewLineViewMode('table');
    setTemplateName('');
    setTemplateHint('');
  };

  const openCreateModal = () => {
    resetCreateForm();
    setIsCreateModalOpen(true);
  };

  const handleCreatePieceType = async () => {
    const label = newPieceTypeName.trim();
    if (!label) {
      toast.warning('Escribe el nombre del nuevo tipo.');
      return;
    }

    const exists = pieceTypes.some((item) => item.label.toLowerCase() === label.toLowerCase());
    if (exists) {
      toast.warning('Ya existe un tipo con ese nombre.');
      return;
    }

    try {
      await addDoc(collection(db, 'projects', projectId, 'budgetPieceTypes'), {
        label,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setNewPieceTypeName('');
      toast.success('Tipo de pieza creado.');
    } catch (error) {
      console.error('Error creating budget piece type:', error);
      toast.error('No se pudo crear el tipo de pieza.');
    }
  };

  const handleStartEditingPieceType = (pieceType: BudgetPieceType) => {
    if (pieceType.isDefault) return;
    setEditingPieceTypeId(pieceType.id);
    setEditingPieceTypeLabel(pieceType.label);
  };

  const handleSavePieceType = async () => {
    if (!editingPieceTypeId) return;
    const label = editingPieceTypeLabel.trim();
    if (!label) {
      toast.warning('El tipo necesita un nombre.');
      return;
    }

    try {
      await updateDoc(doc(db, 'projects', projectId, 'budgetPieceTypes', editingPieceTypeId), {
        label,
        updatedAt: serverTimestamp(),
      });
      setEditingPieceTypeId(null);
      setEditingPieceTypeLabel('');
      toast.success('Tipo actualizado.');
    } catch (error) {
      console.error('Error updating budget piece type:', error);
      toast.error('No se pudo actualizar el tipo.');
    }
  };

  const handleDeletePieceType = async (pieceTypeId: string) => {
    const isInUse = [...newLinePieces, ...Object.values(lineDrafts).flat()].some((piece) => piece.category === pieceTypeId);
    if (isInUse) {
      toast.warning('Este tipo está usado en una pieza. Cámbialo antes de eliminarlo.');
      return;
    }

    try {
      await deleteDoc(doc(db, 'projects', projectId, 'budgetPieceTypes', pieceTypeId));
      toast.success('Tipo eliminado.');
    } catch (error) {
      console.error('Error deleting budget piece type:', error);
      toast.error('No se pudo eliminar el tipo.');
    }
  };

  const handleSaveBudgetTemplate = async () => {
    const cleanName = (templateName.trim() || name.trim()).replace(/\s+/g, ' ');
    if (!cleanName) {
      toast.warning('Escribe el nombre de la plantilla o de la línea.');
      return;
    }

    const cleanPieces = newLinePieces.map(createTemplatePiece).filter((piece) => piece.name.trim());
    if (cleanPieces.length === 0) {
      toast.warning('Agrega al menos una pieza antes de guardar la plantilla.');
      return;
    }

    const normalizedName = normalizeTemplateName(cleanName);
    const existingTemplate = reusableBudgetTemplates.find(
      (template) => !template.isSystem && normalizeTemplateName(template.label || template.name || '') === normalizedName
    );

    if (existingTemplate) {
      const confirmed = window.confirm(`Ya existe la plantilla "${existingTemplate.label}". ¿Quieres reescribirla con esta línea?`);
      if (!confirmed) return;
    }

    const cleanHint = (templateHint.trim() || description.trim()).replace(/\s+/g, ' ');
    const templateData = {
      label: cleanName,
      hint: cleanHint,
      name: name.trim() || cleanName,
      description: description.trim() || cleanHint,
      currency,
      color: lineColor,
      pieces: cleanPieces,
      projectId,
      projectName,
      organizationId: projectOrganizationIds[0] || null,
      organizationIds: projectOrganizationIds,
      organizationName: projectOrganizationName,
      updatedAt: serverTimestamp(),
    };

    setIsSavingTemplate(true);
    try {
      if (existingTemplate) {
        await updateDoc(doc(db, 'budgetLineTemplates', existingTemplate.id), templateData);
        toast.success('Plantilla actualizada.');
      } else {
        await addDoc(collection(db, 'budgetLineTemplates'), {
          ...templateData,
          createdAt: serverTimestamp(),
        });
        toast.success('Plantilla rápida creada.');
      }
      setTemplateName('');
      setTemplateHint('');
    } catch (error) {
      console.error('Error saving budget line template:', error);
      toast.error('No se pudo guardar la plantilla.');
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const handleDeleteBudgetTemplate = async (template: BudgetLineTemplate) => {
    if (template.isSystem) return;
    const confirmed = window.confirm(`¿Eliminar la plantilla "${template.label}"? Esta acción no se puede deshacer.`);
    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, 'budgetLineTemplates', template.id));
      toast.success('Plantilla eliminada.');
    } catch (error) {
      console.error('Error deleting budget line template:', error);
      toast.error('No se pudo eliminar la plantilla.');
    }
  };

  const handleCreateBudgetLine = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      toast.warning('Ponle un nombre a la línea de presupuesto.');
      return;
    }

    const cleanPieces = newLinePieces.map(normalizePiece).filter((piece) => piece.name.trim());
    if (cleanPieces.length === 0) {
      toast.warning('Agrega al menos una pieza de presupuesto.');
      return;
    }

    const plannedAmount = piecesTotal(cleanPieces);
    setLoading(true);
    try {
      await addDoc(collection(db, 'projects', projectId, 'budgetLines'), {
        name: name.trim(),
        description: description.trim(),
        currency,
        color: lineColor,
        plannedAmount,
        components: cleanPieces,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      resetCreateForm();
      setIsCreateModalOpen(false);
      toast.success('Línea de presupuesto creada.');
    } catch (error) {
      console.error('Error creating budget line:', error);
      toast.error('Error al crear la línea de presupuesto.');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateBudgetLineColor = async (lineId: string, color: string) => {
    try {
      await updateDoc(doc(db, 'projects', projectId, 'budgetLines', lineId), {
        color,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('Error updating budget line color:', error);
      toast.error('No se pudo actualizar el color de la línea.');
    }
  };

  const handleDeleteBudgetLine = async () => {
    if (!budgetLineToDelete) return;
    setIsDeleting(true);
    try {
      await deleteDoc(doc(db, 'projects', projectId, 'budgetLines', budgetLineToDelete));
      setBudgetLineToDelete(null);
      toast.success('Línea de presupuesto eliminada.');
    } catch (error) {
      console.error('Error deleting budget line:', error);
      toast.error('Error al eliminar la línea de presupuesto.');
    } finally {
      setIsDeleting(false);
    }
  };

  const updateDraftPiece = (lineId: string, pieceId: string, field: keyof BudgetPiece, value: string | number | string[]) => {
    setLineDrafts((current) => ({
      ...current,
      [lineId]: (current[lineId] || []).map((piece) =>
        piece.id === pieceId ? updatePieceField(piece, field, value) : piece
      ),
    }));
    setDirtyLines((current) => ({ ...current, [lineId]: true }));
  };

  const toggleDraftPieceMonth = (lineId: string, pieceId: string, monthNumber: number) => {
    setLineDrafts((current) => ({
      ...current,
      [lineId]: (current[lineId] || []).map((piece) => {
        if (piece.id !== pieceId) return piece;
        const activeMonths = getPieceActiveMonths(piece);
        const nextMonths = activeMonths.includes(monthNumber)
          ? activeMonths.filter((month) => month !== monthNumber)
          : [...activeMonths, monthNumber];
        return applyPieceSchedule(piece, nextMonths);
      }),
    }));
    setDirtyLines((current) => ({ ...current, [lineId]: true }));
  };

  const addDraftPiece = (lineId: string, categoryHint = 'people') => {
    setLineDrafts((current) => ({
      ...current,
      [lineId]: [...(current[lineId] || []), createBlankPiece({ category: categoryHint })],
    }));
    setDirtyLines((current) => ({ ...current, [lineId]: true }));
  };

  const duplicateDraftPiece = (lineId: string, piece: BudgetPiece) => {
    setLineDrafts((current) => ({
      ...current,
      [lineId]: [...(current[lineId] || []), { ...piece, id: createId(), name: `${piece.name} copia` }],
    }));
    setDirtyLines((current) => ({ ...current, [lineId]: true }));
  };

  const removeDraftPiece = (lineId: string, pieceId: string) => {
    setLineDrafts((current) => ({
      ...current,
      [lineId]: (current[lineId] || []).filter((piece) => piece.id !== pieceId),
    }));
    setDirtyLines((current) => ({ ...current, [lineId]: true }));
  };

  const saveLineDraft = async (line: BudgetLineData) => {
    const pieces = (lineDrafts[line.id] || []).map(normalizePiece).filter((piece) => piece.name.trim());
    if (pieces.length === 0) {
      toast.warning('La línea debe tener al menos una pieza.');
      return;
    }

    try {
      await updateDoc(doc(db, 'projects', projectId, 'budgetLines', line.id), {
        components: pieces,
        plannedAmount: piecesTotal(pieces),
        updatedAt: serverTimestamp(),
      });
      setDirtyLines((current) => ({ ...current, [line.id]: false }));
      toast.success('Presupuesto actualizado.');
    } catch (error) {
      console.error('Error updating budget line:', error);
      toast.error('No se pudo actualizar la línea.');
    }
  };

  const updateNewPiece = (pieceId: string, field: keyof BudgetPiece, value: string | number | string[]) => {
    setNewLinePieces((current) =>
      current.map((piece) =>
        piece.id === pieceId ? updatePieceField(piece, field, value) : piece
      )
    );
  };

  const toggleNewPieceMonth = (pieceId: string, monthNumber: number) => {
    setNewLinePieces((current) =>
      current.map((piece) => {
        if (piece.id !== pieceId) return piece;
        const activeMonths = getPieceActiveMonths(piece);
        const nextMonths = activeMonths.includes(monthNumber)
          ? activeMonths.filter((month) => month !== monthNumber)
          : [...activeMonths, monthNumber];
        return applyPieceSchedule(piece, nextMonths);
      })
    );
  };

  const addNewPiece = (categoryHint = pieceTypes[0]?.id || 'people') => {
    setNewLinePieces((current) => [...current, createBlankPiece({ category: categoryHint })]);
  };

  const applyTemplate = (template: BudgetLineTemplate) => {
    setNewLinePieces((current) => [
      ...current.filter((piece) => piece.name !== 'Nueva pieza' || pieceTotal(piece) > 0),
      ...template.pieces.map(createPieceFromTemplate),
    ]);
    if (!name.trim() && (template.name || template.label)) setName(template.name || template.label);
    if (!description.trim() && (template.description || template.hint)) setDescription(template.description || template.hint || '');
    if (template.currency) setCurrency(template.currency);
    if (template.color) setLineColor(template.color);
    toast.success(`Plantilla "${template.label}" aplicada.`);
  };

  const removeNewPiece = (pieceId: string) => {
    setNewLinePieces((current) => current.filter((piece) => piece.id !== pieceId));
  };

  const rateCardActuals = useMemo(() => {
    return rateCards.map((card) => {
      let cardTotalUnits = 0;
      const computedUserStats: Record<string, number> = { ...(card.userStats || {}) };

      if (card.syncExternal) {
        cardTotalUnits = normalizeDecimalInput(card.currentValue, 0);
      } else {
        cardTotalUnits = normalizeDecimalInput(card.currentValue, 0);

        tasks.forEach((task) => {
          if (!task.isRateCardTask && task.indicator && task.indicator.toLowerCase() === card.indicator?.toLowerCase()) {
            const value = normalizeDecimalInput(task.indicatorValue, 0);
            const progress = normalizeDecimalInput(task.progress, 0);
            const units = value * (progress / 100);
            cardTotalUnits += units;

            if (units > 0 && task.assignedTo) {
              computedUserStats[task.assignedTo] = (computedUserStats[task.assignedTo] || 0) + units;
            }
          }
        });

        const userStatsTotal = Object.values(computedUserStats).reduce((sum: number, val: any) => sum + normalizeDecimalInput(val, 0), 0);
        if (userStatsTotal > cardTotalUnits) {
          cardTotalUnits = userStatsTotal;
        }
      }

      const reworkUnits = normalizeDecimalInput(card.reworkValue, 0);
      const operatingIncome = getRateCardIncomeValue(cardTotalUnits, card);
      const operatingCost = getRateCardCostValue(cardTotalUnits + reworkUnits, card);

      return {
        ...card,
        units: cardTotalUnits,
        reworkUnits,
        operatingIncome,
        operatingCost,
        estimatedIncome: operatingIncome,
        estimatedCost: operatingCost,
      };
    });
  }, [rateCards, tasks]);

  const budgetData = useMemo<BudgetLineData[]>(() => {
    return budgetLines.map((line) => {
      const pieces = lineDrafts[line.id] || normalizeBudgetPieces(line);
      const plannedAmount = piecesTotal(pieces);
      const associatedRateCards = rateCardActuals.filter((rateCard) => rateCard.budgetLineId === line.id);
      const operatingCost = associatedRateCards.reduce((sum, rateCard) => sum + normalizeDecimalInput(rateCard.operatingCost, 0), 0);
      const operatingIncome = associatedRateCards.reduce((sum, rateCard) => sum + normalizeDecimalInput(rateCard.operatingIncome, 0), 0);
      const variance = plannedAmount - operatingCost;
      const percentUsed = plannedAmount > 0 ? (operatingCost / plannedAmount) * 100 : 0;

      return {
        ...line,
        pieces,
        plannedAmount,
        actualAmount: operatingCost,
        operatingCost,
        operatingIncome,
        variance,
        percentUsed,
        pieceCount: pieces.length,
      };
    });
  }, [budgetLines, lineDrafts, rateCardActuals]);

  const unassignedActuals = rateCardActuals.filter((rateCard) => !rateCard.budgetLineId && normalizeDecimalInput(rateCard.operatingCost, 0) > 0);
  const totalUnassignedActual = unassignedActuals.reduce((sum, rateCard) => sum + normalizeDecimalInput(rateCard.operatingCost, 0), 0);
  const totalPlanned = budgetData.reduce((sum, line) => sum + line.plannedAmount, 0);
  const totalOperatingCost = budgetData.reduce((sum, line) => sum + line.operatingCost, 0) + totalUnassignedActual;
  const totalOperatingIncome = rateCardActuals.reduce((sum, rateCard) => sum + normalizeDecimalInput(rateCard.operatingIncome, 0), 0);
  const totalVariance = totalPlanned - totalOperatingCost;
  const totalPercentUsed = totalPlanned > 0 ? (totalOperatingCost / totalPlanned) * 100 : 0;
  const totalPieces = budgetData.reduce((sum, line) => sum + line.pieceCount, 0);
  const activeCurrency = budgetData[0]?.currency || currency;

  const categoryTotals = pieceTypes.map((item) => ({
    ...item,
    total: budgetData.reduce(
      (sum, line) => sum + line.pieces.filter((piece) => piece.category === item.id).reduce((inner, piece) => inner + pieceTotal(piece), 0),
      0
    ),
  })).filter((item) => item.total > 0);

  const renderPieceEditor = (
    pieces: BudgetPiece[],
    handlers: {
      update: (pieceId: string, field: keyof BudgetPiece, value: string | number | string[]) => void;
      duplicate?: (piece: BudgetPiece) => void;
      remove: (pieceId: string) => void;
    },
    options: { compact?: boolean } = {}
  ) => (
    <div className="overflow-x-auto">
      <div className="min-w-[1360px]">
        <div className="grid grid-cols-[1.5fr_140px_220px_90px_90px_90px_90px_140px_130px_90px] gap-2 border-b border-slate-200 px-2 pb-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
          <span>Pieza</span>
          <span>Tipo</span>
          <span>Personal</span>
          <span>Inicio</span>
          <span>Cantidad</span>
          <span>Tiempo</span>
          <span>Factor</span>
          <span>Valor unitario</span>
          <span>Subtotal</span>
          <span className="text-right">Acciones</span>
        </div>
        <div className="divide-y divide-slate-100">
          {pieces.map((piece) => {
            const categoryConfig = getCategoryConfig(piece.category);
            const CategoryIcon = categoryConfig.icon || PackagePlus;
            const assignedMemberIds = normalizeStringArray(piece.assignedMemberIds);
            const selectableMembers = teamMembers.filter((member) => !assignedMemberIds.includes(member.id));

            return (
              <div
                key={piece.id}
                className="group grid grid-cols-[1.5fr_140px_220px_90px_90px_90px_90px_140px_130px_90px] gap-2 rounded-lg border border-transparent px-2 py-2 transition hover:border-indigo-100 hover:bg-indigo-50/60 hover:shadow-sm focus-within:border-indigo-200 focus-within:bg-indigo-50/70 focus-within:shadow-sm"
              >
                <div className="min-w-0">
                  <input
                    value={piece.name}
                    onChange={(event) => handlers.update(piece.id, 'name', event.target.value)}
                    className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition group-hover:border-indigo-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                    placeholder="Ej. Analista catastral"
                  />
                  {!options.compact && (
                    <textarea
                      value={piece.notes || ''}
                      onChange={(event) => handlers.update(piece.id, 'notes', event.target.value)}
                      rows={getNotesRows(piece.notes || '')}
                      className="mt-1 min-h-8 w-full resize-y rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-xs font-medium leading-relaxed text-slate-500 outline-none transition group-hover:border-indigo-100 group-hover:bg-white focus:border-indigo-300"
                      placeholder="Nota o supuesto de cálculo"
                    />
                  )}
                </div>
                <div className="min-w-0">
                  <select
                    value=""
                    onChange={(event) => {
                      const memberId = event.target.value;
                      if (!memberId) return;
                      handlers.update(piece.id, 'assignedMemberIds', [...assignedMemberIds, memberId]);
                    }}
                    className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-xs font-black text-slate-600 outline-none transition group-hover:border-indigo-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                  >
                    <option value="">
                      {assignedMemberIds.length > 0 ? 'Agregar persona' : 'Vincular persona'}
                    </option>
                    {selectableMembers.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name || member.email || 'Profesional'}
                      </option>
                    ))}
                  </select>
                  {!options.compact && (
                    <div className="mt-1 flex min-h-8 flex-wrap gap-1">
                      {assignedMemberIds.length === 0 ? (
                        <span className="rounded bg-orange-50 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-orange-700 ring-1 ring-orange-100">
                          Sin personal
                        </span>
                      ) : (
                        assignedMemberIds.map((memberId) => {
                          const member = teamMembers.find((item) => item.id === memberId);
                          return (
                            <span
                              key={`${piece.id}-${memberId}`}
                              className="inline-flex max-w-full items-center gap-1 rounded bg-white px-2 py-1 text-[10px] font-black text-slate-600 ring-1 ring-slate-200"
                            >
                              <span className="max-w-[130px] truncate">{member?.name || member?.email || 'Profesional'}</span>
                              <button
                                type="button"
                                onClick={() => handlers.update(piece.id, 'assignedMemberIds', assignedMemberIds.filter((id) => id !== memberId))}
                                className="text-slate-400 transition hover:text-red-600"
                                title="Quitar de la pieza"
                              >
                                <X size={11} />
                              </button>
                            </span>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
                <div>
                  <select
                    value={piece.category}
                    onChange={(event) => handlers.update(piece.id, 'category', event.target.value)}
                    className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-xs font-black text-slate-600 outline-none transition group-hover:border-indigo-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                  >
                    {pieceTypes.map((item) => (
                      <option key={item.id} value={item.id}>{item.label}</option>
                    ))}
                  </select>
                  {!options.compact && (
                    <span className={`mt-1 inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ring-1 ${categoryConfig.tone}`}>
                      <CategoryIcon size={12} />
                      {categoryConfig.label}
                    </span>
                  )}
                </div>
                <div>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={piece.startMonth}
                    onChange={(event) => handlers.update(piece.id, 'startMonth', event.target.value)}
                    className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-right text-sm font-bold text-slate-700 outline-none transition group-hover:border-indigo-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                  />
                  {!options.compact && (
                    <p className="mt-1 truncate text-[10px] font-bold text-slate-400">{getTimelineMonthLabel(piece.startMonth)}</p>
                  )}
                </div>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={piece.quantity}
                  onChange={(event) => handlers.update(piece.id, 'quantity', event.target.value)}
                  className="h-9 rounded-md border border-slate-200 px-2 text-right text-sm font-bold text-slate-700 outline-none transition group-hover:border-indigo-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                />
                <div>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={piece.duration}
                    onChange={(event) => handlers.update(piece.id, 'duration', event.target.value)}
                    className="h-9 w-full rounded-md border border-slate-200 px-2 text-right text-sm font-bold text-slate-700 outline-none transition group-hover:border-indigo-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                  />
                  {!options.compact && (
                    <input
                      value={piece.unitLabel}
                      onChange={(event) => handlers.update(piece.id, 'unitLabel', event.target.value)}
                      className="mt-1 h-8 w-full rounded-md border border-slate-100 bg-slate-50 px-2 text-xs font-medium text-slate-500 outline-none transition group-hover:border-indigo-100 group-hover:bg-white focus:border-indigo-300"
                      placeholder="mes"
                    />
                  )}
                </div>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={piece.multiplier}
                  onChange={(event) => handlers.update(piece.id, 'multiplier', event.target.value)}
                  className="h-9 rounded-md border border-slate-200 px-2 text-right text-sm font-bold text-slate-700 outline-none transition group-hover:border-indigo-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                />
                <input
                  type="text"
                  inputMode="numeric"
                  value={formatPlainNumber(piece.unitCost)}
                  onChange={(event) => handlers.update(piece.id, 'unitCost', parseFormattedNumber(event.target.value))}
                  onFocus={(event) => event.currentTarget.select()}
                  className="h-9 rounded-md border border-slate-200 px-2 text-right text-sm font-bold text-slate-700 outline-none transition group-hover:border-indigo-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                />
                <div className="flex h-9 items-center justify-end rounded-md bg-slate-50 px-2 text-sm font-black text-slate-900 ring-1 ring-slate-100">
                  {currencyFormatter(pieceTotal(piece), activeCurrency)}
                </div>
                <div className="flex items-center justify-end gap-1">
                  {handlers.duplicate && (
                    <button
                      type="button"
                      onClick={() => handlers.duplicate?.(piece)}
                      className="rounded-md p-2 text-slate-400 transition hover:bg-indigo-50 hover:text-indigo-600"
                      title="Duplicar pieza"
                    >
                      <Copy size={15} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handlers.remove(piece.id)}
                    className="rounded-md p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                    title="Eliminar pieza"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  const renderMonthlyPixelMap = (
    pieces: BudgetPiece[],
    title = 'Mapa mensual de piezas',
    options: { editable?: boolean; onToggleMonth?: (pieceId: string, monthNumber: number) => void } = {}
  ) => {
    const maxMonth = Math.max(
      12,
      ...pieces.flatMap((piece) => {
        const activeMonths = getPieceActiveMonths(piece);
        const projectedEnd = clampMonthNumber(piece.startMonth) + Math.max(0, Math.ceil(toNumber(piece.duration, 0))) - 1;
        return [...activeMonths, projectedEnd];
      })
    );
    const timelineMonths = Array.from({ length: maxMonth }, (_, index) => index + 1);
    const gridTemplateColumns = `210px repeat(${timelineMonths.length}, minmax(34px, 1fr))`;
    const minWidth = 210 + timelineMonths.length * 40;

    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
        <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h4 className="flex items-center gap-2 text-sm font-black text-slate-950">
              <Timer size={15} className="text-emerald-600" />
              {title}
            </h4>
            <p className="text-xs font-medium text-slate-500">
              {options.editable
                ? 'Haz click sobre los meses para activar o quitar gasto. Los huecos descuentan tiempo y presupuesto.'
                : 'Cada bloque representa un mes activo de la pieza dentro de la línea presupuestal.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded bg-white px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-slate-500 ring-1 ring-slate-200">
              {compactNumber(pieces.length)} piezas
            </span>
            <span className="rounded bg-white px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-slate-500 ring-1 ring-slate-200">
              {compactNumber(timelineMonths.length)} meses visibles
            </span>
          </div>
        </div>
        <div className="overflow-x-auto pb-1">
          <div className="space-y-1" style={{ minWidth }}>
            <div
              className="grid gap-1 text-[10px] font-black uppercase tracking-[0.12em] text-slate-400"
              style={{ gridTemplateColumns }}
            >
              <span />
              {timelineMonths.map((monthNumber) => (
                <span key={`header-${monthNumber}`} className="text-center">{getTimelineMonthLabel(monthNumber)}</span>
              ))}
            </div>
            {pieces.map((piece) => {
              const config = getCategoryConfig(piece.category);
              const activeMonths = getPieceActiveMonths(piece);
              const activeMonthSet = new Set(activeMonths);
              const firstMonth = activeMonths[0];
              const lastMonth = activeMonths[activeMonths.length - 1];
              const monthRange = activeMonths.length > 0
                ? `${getTimelineMonthLabel(firstMonth)} - ${getTimelineMonthLabel(lastMonth)}`
                : 'Sin meses activos';

              return (
                <div
                  key={`timeline-${piece.id}`}
                  className="grid items-center gap-1 rounded-md px-1 py-1 transition hover:bg-indigo-50/70"
                  style={{ gridTemplateColumns }}
                >
                  <div className="flex min-w-0 items-center gap-2 pr-2">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${config.dot}`} />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-black text-slate-700">{piece.name || 'Pieza'}</p>
                      <p className="truncate text-[10px] font-bold text-slate-400">
                        {compactNumber(getPieceDuration(piece))} tiempo · {compactNumber(activeMonths.length)} pixels · {monthRange}
                      </p>
                    </div>
                  </div>
                  {timelineMonths.map((monthNumber) => {
                    const isActive = activeMonthSet.has(monthNumber);
                    const titleText = `${piece.name || 'Pieza'} · ${getTimelineMonthLabel(monthNumber)} · ${isActive ? 'activo' : 'inactivo'}`;
                    const cellClassName = `h-7 rounded-sm transition ${
                      isActive
                        ? `${config.pixel} shadow-sm hover:brightness-95`
                        : options.editable
                          ? 'bg-white ring-1 ring-slate-200 hover:bg-slate-100 hover:ring-slate-300'
                          : 'bg-white ring-1 ring-slate-200'
                    }`;

                    if (options.editable) {
                      return (
                        <button
                          key={`${piece.id}-${monthNumber}`}
                          type="button"
                          aria-pressed={isActive}
                          title={titleText}
                          onClick={() => options.onToggleMonth?.(piece.id, monthNumber)}
                          className={cellClassName}
                        />
                      );
                    }

                    return (
                      <div
                        key={`${piece.id}-${monthNumber}`}
                        title={titleText}
                        className={cellClassName}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded bg-emerald-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-emerald-700 ring-1 ring-emerald-100">
              <Sparkles size={14} />
              Constructor financiero
            </div>
            <h2 className="flex items-center gap-2 text-3xl font-black tracking-tight text-slate-950">
              <DollarSign size={28} className="text-emerald-600" />
              Presupuesto del proyecto
            </h2>
            <p className="mt-2 text-base font-medium text-slate-500">
              Arma el presupuesto con piezas reutilizables: personas, licencias, tiempos, factores y valores unitarios.
            </p>
          </div>
          <Button onClick={openCreateModal} className="h-12 shrink-0 bg-emerald-600 px-5 font-black text-white hover:bg-emerald-700">
            <Plus size={18} />
            Nueva línea
          </Button>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">Planificado</p>
              <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{currencyFormatter(totalPlanned, activeCurrency)}</p>
              <p className="mt-1 text-sm font-medium text-slate-500">{compactNumber(totalPieces)} piezas en {compactNumber(budgetData.length)} líneas</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
              <Calculator size={20} />
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">Costo operativo</p>
              <p className="mt-2 text-3xl font-black tracking-tight text-indigo-700">{currencyFormatter(totalOperatingCost, activeCurrency)}</p>
              <p className="mt-1 text-sm font-medium text-slate-500">Solo rates con costo mayor a 0</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100">
              <TrendingUp size={20} />
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">Ingreso operativo</p>
              <p className="mt-2 text-3xl font-black tracking-tight text-emerald-700">{currencyFormatter(totalOperatingIncome, activeCurrency)}</p>
              <p className="mt-1 text-sm font-medium text-slate-500">Estimado por Rate Cards</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
              <DollarSign size={20} />
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">Disponible</p>
              <p className={`mt-2 text-3xl font-black tracking-tight ${totalVariance >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                {currencyFormatter(totalVariance, activeCurrency)}
              </p>
              <p className="mt-1 text-sm font-medium text-slate-500">{totalPercentUsed.toFixed(1)}% de uso</p>
            </div>
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg ring-1 ${totalVariance >= 0 ? 'bg-emerald-50 text-emerald-700 ring-emerald-100' : 'bg-red-50 text-red-700 ring-red-100'}`}>
              {totalVariance >= 0 ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
            </div>
          </div>
          <Progress value={Math.min(totalPercentUsed, 100)} className="mt-4 h-2 bg-slate-100" indicatorClassName={totalPercentUsed > 100 ? 'bg-red-500' : 'bg-emerald-500'} />
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">Sin asignar</p>
              <p className="mt-2 text-3xl font-black tracking-tight text-orange-700">{currencyFormatter(totalUnassignedActual, activeCurrency)}</p>
              <p className="mt-1 text-sm font-medium text-slate-500">{compactNumber(unassignedActuals.length)} rates con costo sin línea</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-50 text-orange-700 ring-1 ring-orange-100">
              <AlertCircle size={20} />
            </div>
          </div>
        </div>
      </div>

      {categoryTotals.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-black text-slate-950">Composición del presupuesto</h3>
              <p className="text-sm font-medium text-slate-500">Dónde se concentra la planeación antes de ejecutar.</p>
            </div>
            <span className="rounded bg-slate-100 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-slate-600">
              {totalPlanned > 0 ? '100%' : '0%'} distribuido
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
            {categoryTotals.map((item) => {
              const Icon = item.icon || PackagePlus;
              const percent = totalPlanned > 0 ? (item.total / totalPlanned) * 100 : 0;
              return (
                <div key={item.id} className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                  <div className="flex items-center gap-2">
                    <span className={`flex h-8 w-8 items-center justify-center rounded-md ring-1 ${item.tone}`}>
                      <Icon size={16} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-slate-900">{item.label}</p>
                      <p className="text-xs font-bold text-slate-500">{percent.toFixed(1)}%</p>
                    </div>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(percent, 100)}%` }} />
                  </div>
                  <p className="mt-2 text-xs font-black text-slate-700">{currencyFormatter(item.total, activeCurrency)}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {budgetData.length === 0 ? (
        <section className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
          <Calculator className="mx-auto h-12 w-12 text-slate-300" />
          <h3 className="mt-4 text-xl font-black text-slate-950">Todavía no hay líneas de presupuesto</h3>
          <p className="mx-auto mt-2 max-w-xl text-sm font-medium text-slate-500">
            Crea la primera línea y desglósala en piezas: cargos, licencias, meses, jornadas, valores unitarios y factores.
          </p>
          <Button onClick={openCreateModal} className="mt-5 bg-emerald-600 font-black text-white hover:bg-emerald-700">
            <Plus size={16} />
            Crear primera línea
          </Button>
        </section>
      ) : (
        <section className="space-y-4">
          {budgetData.map((line) => {
            const isDirty = Boolean(dirtyLines[line.id]);
            const linePieceTypes = pieceTypes.filter((item) => line.pieces.some((piece) => piece.category === item.id)).slice(0, 4);
            const defaultPieceType = line.pieces[0]?.category || pieceTypes[0]?.id || 'people';
            const lineViewMode = lineViewModes[line.id] || 'table';
            const lineColorConfig = getLineColorConfig(line.color);

            return (
              <article
                key={line.id}
                className="overflow-hidden rounded-lg border border-l-4 border-slate-200 bg-white shadow-sm"
                style={{ borderLeftColor: lineColorConfig.value }}
              >
                <div
                  className="border-b border-slate-200 p-4"
                  style={{ background: `linear-gradient(90deg, ${lineColorConfig.soft} 0%, #ffffff 48%)` }}
                >
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-slate-600 ring-1 ring-slate-200">
                          Línea macro
                        </span>
                        {linePieceTypes.map((pieceType) => {
                          const Icon = pieceType.icon || PackagePlus;
                          return (
                            <span key={`${line.id}-${pieceType.id}`} className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ring-1 ${pieceType.tone}`}>
                              <Icon size={12} />
                              {pieceType.label}
                            </span>
                          );
                        })}
                        {isDirty && (
                          <span className="rounded bg-orange-50 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-orange-700 ring-1 ring-orange-100">
                            Cambios sin guardar
                          </span>
                        )}
                        <div className="inline-flex items-center gap-1 rounded bg-white/80 px-2 py-1 ring-1 ring-slate-200">
                          <span className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">Color</span>
                          {BUDGET_LINE_COLORS.map((item) => (
                            <button
                              key={`${line.id}-${item.value}`}
                              type="button"
                              onClick={() => void handleUpdateBudgetLineColor(line.id, item.value)}
                              className={`h-4 w-4 rounded-full border transition hover:scale-110 ${lineColorConfig.value === item.value ? 'border-slate-950 ring-2 ring-slate-300' : 'border-white ring-1 ring-slate-200'}`}
                              style={{ backgroundColor: item.value }}
                              title={`Color ${item.label}`}
                            />
                          ))}
                        </div>
                      </div>
                      <h3 className="text-xl font-black tracking-tight text-slate-950">{line.name}</h3>
                      <p className="mt-1 text-sm font-medium text-slate-500">{line.description || 'Sin descripción'}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-5 xl:min-w-[780px]">
                      <div className="rounded-md bg-slate-50 p-3 ring-1 ring-slate-100">
                        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Plan</p>
                        <p className="mt-1 text-sm font-black text-slate-950">{currencyFormatter(line.plannedAmount, line.currency)}</p>
                      </div>
                      <div className="rounded-md bg-indigo-50 p-3 ring-1 ring-indigo-100">
                        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-indigo-600">Costo op.</p>
                        <p className="mt-1 text-sm font-black text-indigo-700">{currencyFormatter(line.operatingCost, line.currency)}</p>
                      </div>
                      <div className="rounded-md bg-emerald-50 p-3 ring-1 ring-emerald-100">
                        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-600">Ingreso op.</p>
                        <p className="mt-1 text-sm font-black text-emerald-700">{currencyFormatter(line.operatingIncome, line.currency)}</p>
                      </div>
                      <div className={`rounded-md p-3 ring-1 ${line.variance >= 0 ? 'bg-emerald-50 ring-emerald-100' : 'bg-red-50 ring-red-100'}`}>
                        <p className={`text-[10px] font-black uppercase tracking-[0.14em] ${line.variance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>Disponible</p>
                        <p className={`mt-1 text-sm font-black ${line.variance >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{currencyFormatter(line.variance, line.currency)}</p>
                      </div>
                      <div className="rounded-md bg-slate-50 p-3 ring-1 ring-slate-100">
                        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Uso</p>
                        <p className="mt-1 text-sm font-black text-slate-950">{line.percentUsed.toFixed(1)}%</p>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-3">
                      <Progress value={Math.min(line.percentUsed, 100)} className="h-2 w-64 max-w-full bg-slate-100" indicatorClassName={line.percentUsed > 100 ? 'bg-red-500' : 'bg-emerald-500'} />
                      <span className="text-xs font-bold text-slate-500">{compactNumber(line.pieceCount)} piezas</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => addDraftPiece(line.id, defaultPieceType)} className="border-slate-200 text-slate-700 hover:bg-slate-50">
                        <Plus size={14} />
                        Agregar pieza
                      </Button>
                      <Button type="button" size="sm" onClick={() => saveLineDraft(line)} disabled={!isDirty} className="bg-slate-950 font-black text-white hover:bg-emerald-700 disabled:opacity-50">
                        <Save size={14} />
                        Guardar
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setBudgetLineToDelete(line.id)} className="text-red-600 hover:bg-red-50 hover:text-red-700">
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="bg-white p-3">
                  <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <p className="text-xs font-bold text-slate-500">
                      Alterna entre edición tipo hoja de cálculo y calendario mensual editable.
                    </p>
                    <div className="inline-flex rounded-md bg-slate-100 p-1 ring-1 ring-slate-200">
                      <button
                        type="button"
                        onClick={() => setLineViewModes((current) => ({ ...current, [line.id]: 'table' }))}
                        className={`rounded px-3 py-1.5 text-xs font-black transition ${lineViewMode === 'table' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        Hoja
                      </button>
                      <button
                        type="button"
                        onClick={() => setLineViewModes((current) => ({ ...current, [line.id]: 'timeline' }))}
                        className={`rounded px-3 py-1.5 text-xs font-black transition ${lineViewMode === 'timeline' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        Meses
                      </button>
                    </div>
                  </div>
                  {lineViewMode === 'table'
                    ? renderPieceEditor(line.pieces, {
                        update: (pieceId, field, value) => updateDraftPiece(line.id, pieceId, field, value),
                        duplicate: (piece) => duplicateDraftPiece(line.id, piece),
                        remove: (pieceId) => removeDraftPiece(line.id, pieceId),
                      })
                    : renderMonthlyPixelMap(line.pieces, 'Calendario mensual editable', {
                        editable: true,
                        onToggleMonth: (pieceId, monthNumber) => toggleDraftPieceMonth(line.id, pieceId, monthNumber),
                      })}
                </div>
              </article>
            );
          })}
        </section>
      )}

      {totalUnassignedActual > 0 && (
        <section className="rounded-lg border border-orange-200 bg-orange-50/40 p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-orange-600" />
            <div>
              <h3 className="font-black text-orange-900">Costos operativos sin línea de presupuesto</h3>
              <p className="mt-1 text-sm font-medium text-orange-800">
                Hay {compactNumber(unassignedActuals.length)} rate cards con costo operativo por {currencyFormatter(totalUnassignedActual, activeCurrency)} sin estar vinculados a una línea.
              </p>
            </div>
          </div>
        </section>
      )}

      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div className="flex h-[94vh] w-[96vw] max-w-[1700px] flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-600">Nueva estructura presupuestal</p>
                <h3 className="text-2xl font-black tracking-tight text-slate-950">Crear línea con piezas</h3>
                <p className="mt-1 text-sm font-medium text-slate-500">Define la línea y arma su fórmula con una o varias piezas.</p>
              </div>
              <button onClick={() => setIsCreateModalOpen(false)} className="rounded-md p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
                <X size={22} />
              </button>
            </div>

            <form onSubmit={handleCreateBudgetLine} className="overflow-y-auto p-6">
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_220px_260px]">
                    <div className="lg:col-span-1">
                      <label className="mb-1 block text-sm font-bold text-slate-700">Nombre de la línea *</label>
                      <input
                        type="text"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        className="h-11 w-full rounded-md border border-slate-200 px-3 text-sm font-bold text-slate-800 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                        placeholder="Ej. Equipo de análisis"
                        required
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-bold text-slate-700">Moneda</label>
                      <select
                        value={currency}
                        onChange={(event) => setCurrency(event.target.value)}
                        className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                      >
                        <option value="COP">COP - Peso Colombiano</option>
                        <option value="USD">USD - Dólar Estadounidense</option>
                        <option value="EUR">EUR - Euro</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-bold text-slate-700">Total calculado</label>
                      <div className="flex h-11 items-center rounded-md bg-slate-50 px-3 text-sm font-black text-slate-950 ring-1 ring-slate-200">
                        {currencyFormatter(piecesTotal(newLinePieces), currency)}
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-bold text-slate-700">Descripción de la línea macro</label>
                    <input
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      className="h-11 w-full rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                      placeholder="Supuesto, alcance o criterio de esta línea"
                    />
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <label className="block text-sm font-bold text-slate-700">Color de la línea</label>
                        <p className="text-xs font-medium text-slate-500">Ayuda a diferenciar visualmente cada línea macro del presupuesto.</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {BUDGET_LINE_COLORS.map((item) => (
                          <button
                            key={`new-line-${item.value}`}
                            type="button"
                            onClick={() => setLineColor(item.value)}
                            className={`flex h-9 items-center gap-2 rounded-md border bg-white px-3 text-xs font-black text-slate-700 transition hover:border-slate-300 hover:shadow-sm ${lineColor === item.value ? 'border-slate-950 ring-2 ring-slate-200' : 'border-slate-200'}`}
                            title={`Color ${item.label}`}
                          >
                            <span className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: item.value }} />
                            {item.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200">
                    <div className="flex items-center justify-between gap-3 border-b border-slate-200 p-3">
                      <div>
                        <h4 className="font-black text-slate-950">Hoja de cálculo de piezas</h4>
                        <p className="text-xs font-medium text-slate-500">Subtotal = cantidad x tiempo x factor x valor unitario. El tiempo admite decimales.</p>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <div className="inline-flex rounded-md bg-slate-100 p-1 ring-1 ring-slate-200">
                          <button
                            type="button"
                            onClick={() => setNewLineViewMode('table')}
                            className={`rounded px-3 py-1.5 text-xs font-black transition ${newLineViewMode === 'table' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                          >
                            Hoja
                          </button>
                          <button
                            type="button"
                            onClick={() => setNewLineViewMode('timeline')}
                            className={`rounded px-3 py-1.5 text-xs font-black transition ${newLineViewMode === 'timeline' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                          >
                            Meses
                          </button>
                        </div>
                        <Button type="button" variant="outline" size="sm" onClick={() => addNewPiece()} className="border-slate-200">
                          <Plus size={14} />
                          Agregar pieza
                        </Button>
                      </div>
                    </div>
                    <div className="p-3">
                      {newLineViewMode === 'table'
                        ? renderPieceEditor(newLinePieces, {
                            update: updateNewPiece,
                            duplicate: (piece) => setNewLinePieces((current) => [...current, { ...piece, id: createId(), name: `${piece.name} copia` }]),
                            remove: removeNewPiece,
                          })
                        : renderMonthlyPixelMap(newLinePieces, 'Vista mensual editable de la nueva línea', {
                            editable: true,
                            onToggleMonth: toggleNewPieceMonth,
                          })}
                    </div>
                  </div>
                </div>

                <aside className="space-y-3">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="flex items-center gap-2 font-black text-slate-950">
                          <Sparkles size={16} className="text-emerald-600" />
                          Plantillas rápidas
                        </h4>
                        <p className="mt-1 text-xs font-medium text-slate-500">
                          Usa bases del sistema o tipologías guardadas por organización.
                        </p>
                      </div>
                      <span className="rounded bg-white px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-slate-500 ring-1 ring-slate-200">
                        {availableBudgetTemplates.length}
                      </span>
                    </div>
                    <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
                      {availableBudgetTemplates.map((template) => {
                        const scopeLabel = getBudgetTemplateScopeLabel(template, projectId);
                        return (
                          <div key={template.id} className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => applyTemplate(template)}
                              className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white p-3 text-left transition hover:border-emerald-200 hover:bg-emerald-50"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate text-sm font-black text-slate-900">{template.label}</p>
                                <span className={`shrink-0 rounded px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] ring-1 ${
                                  template.isSystem
                                    ? 'bg-slate-100 text-slate-500 ring-slate-200'
                                    : template.projectId === projectId
                                      ? 'bg-indigo-50 text-indigo-700 ring-indigo-100'
                                      : 'bg-emerald-50 text-emerald-700 ring-emerald-100'
                                }`}>
                                  {scopeLabel}
                                </span>
                              </div>
                              <p className="mt-1 line-clamp-2 text-xs font-medium text-slate-500">{template.hint || 'Plantilla presupuestal reutilizable.'}</p>
                              <p className="mt-2 text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">
                                {compactNumber(template.pieces.length)} piezas
                              </p>
                            </button>
                            {!template.isSystem && (
                              <button
                                type="button"
                                onClick={() => handleDeleteBudgetTemplate(template)}
                                className="self-stretch rounded-md border border-slate-200 bg-white px-2 text-slate-400 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                                title="Eliminar plantilla"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-4 rounded-md border border-emerald-100 bg-white p-3">
                      <p className="text-xs font-black uppercase tracking-[0.12em] text-emerald-700">Guardar tipología</p>
                      <p className="mt-1 text-xs font-medium text-slate-500">
                        Convierte la línea actual en una plantilla rápida para otros proyectos de esta organización.
                      </p>
                      <div className="mt-3 space-y-2">
                        <input
                          value={templateName}
                          onChange={(event) => setTemplateName(event.target.value)}
                          className="h-9 w-full rounded-md border border-slate-200 px-3 text-xs font-bold text-slate-700 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                          placeholder="Nombre de la plantilla"
                        />
                        <textarea
                          value={templateHint}
                          onChange={(event) => setTemplateHint(event.target.value)}
                          rows={2}
                          className="w-full resize-none rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                          placeholder="Uso sugerido o alcance"
                        />
                        <Button
                          type="button"
                          onClick={handleSaveBudgetTemplate}
                          disabled={isSavingTemplate}
                          className="h-9 w-full bg-emerald-600 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-60"
                        >
                          <Save size={14} />
                          {isSavingTemplate ? 'Guardando...' : 'Guardar plantilla'}
                        </Button>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <h4 className="flex items-center gap-2 font-black text-slate-950">
                      <PackagePlus size={16} className="text-emerald-600" />
                      Tipos de piezas
                    </h4>
                    <p className="mt-1 text-xs font-medium text-slate-500">Crea categorías propias para clasificar cada pieza del presupuesto.</p>
                    <div className="mt-3 flex gap-2">
                      <input
                        value={newPieceTypeName}
                        onChange={(event) => setNewPieceTypeName(event.target.value)}
                        className="h-9 min-w-0 flex-1 rounded-md border border-slate-200 px-3 text-xs font-bold text-slate-700 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                        placeholder="Ej. Vehículos"
                      />
                      <Button type="button" size="sm" onClick={handleCreatePieceType} className="h-9 bg-slate-950 font-black text-white hover:bg-emerald-700">
                        <Plus size={14} />
                      </Button>
                    </div>
                    <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
                      {pieceTypes.map((pieceType) => {
                        const Icon = pieceType.icon || PackagePlus;
                        const isEditing = editingPieceTypeId === pieceType.id;

                        return (
                          <div key={pieceType.id} className="rounded-md border border-slate-100 bg-slate-50 p-2">
                            {isEditing ? (
                              <div className="flex gap-2">
                                <input
                                  value={editingPieceTypeLabel}
                                  onChange={(event) => setEditingPieceTypeLabel(event.target.value)}
                                  className="h-8 min-w-0 flex-1 rounded-md border border-slate-200 px-2 text-xs font-bold outline-none focus:border-emerald-500"
                                />
                                <button type="button" onClick={handleSavePieceType} className="rounded-md p-2 text-emerald-700 transition hover:bg-emerald-50" title="Guardar tipo">
                                  <Save size={14} />
                                </button>
                                <button type="button" onClick={() => setEditingPieceTypeId(null)} className="rounded-md p-2 text-slate-400 transition hover:bg-slate-100" title="Cancelar edición">
                                  <X size={14} />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-between gap-2">
                                <span className={`inline-flex min-w-0 items-center gap-1 rounded px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ring-1 ${pieceType.tone}`}>
                                  <Icon size={12} />
                                  <span className="truncate">{pieceType.label}</span>
                                </span>
                                {!pieceType.isDefault && (
                                  <div className="flex shrink-0 items-center gap-1">
                                    <button type="button" onClick={() => handleStartEditingPieceType(pieceType)} className="rounded-md px-2 py-1 text-[10px] font-black text-slate-500 transition hover:bg-white hover:text-emerald-700">
                                      Editar
                                    </button>
                                    <button type="button" onClick={() => handleDeletePieceType(pieceType.id)} className="rounded-md p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600" title="Eliminar tipo">
                                      <Trash2 size={13} />
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                    <h4 className="font-black text-emerald-900">Cómo leer la fórmula</h4>
                    <p className="mt-2 text-sm font-medium text-emerald-800">
                      La línea es el contenedor macro. Las piezas son los bloques que totalizan el valor y su calendario mensual.
                    </p>
                  </div>
                </aside>
              </div>

              <div className="mt-5 flex justify-end gap-3 border-t border-slate-200 pt-4">
                <Button type="button" variant="outline" onClick={() => setIsCreateModalOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={loading} className="bg-emerald-600 font-black text-white hover:bg-emerald-700">
                  {loading ? 'Guardando...' : 'Crear línea'}
                  <ArrowRight size={16} />
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {budgetLineToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 text-center shadow-xl">
            <AlertCircle className="mx-auto mb-4 h-12 w-12 text-red-500" />
            <h3 className="mb-2 text-lg font-black text-slate-950">¿Eliminar línea de presupuesto?</h3>
            <p className="mb-6 text-sm font-medium text-slate-500">
              Esta acción no se puede deshacer. Los rate cards asociados perderán su vinculación.
            </p>
            <div className="flex justify-center gap-3">
              <Button variant="outline" onClick={() => setBudgetLineToDelete(null)} disabled={isDeleting}>
                Cancelar
              </Button>
              <Button variant="destructive" onClick={handleDeleteBudgetLine} disabled={isDeleting}>
                {isDeleting ? 'Eliminando...' : 'Sí, eliminar'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
