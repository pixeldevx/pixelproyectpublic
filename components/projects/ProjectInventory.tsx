"use client"

import React, { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import {
  AlertTriangle,
  Archive,
  ArrowRightLeft,
  Calendar,
  Camera,
  CheckCircle2,
  ClipboardList,
  DollarSign,
  Download,
  Eye,
  ImageIcon,
  MapPin,
  Package,
  Pencil,
  Plus,
  Printer,
  Search,
  Trash2,
  Upload,
  User,
  Wrench,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from '@/lib/supabase/document-store';
import { ref, uploadBytes, getDownloadURL, deleteObject } from '@/lib/supabase/storage-shim';
import { db, storage } from '@/lib/backend';
import { toast } from 'sonner';
import { InventoryLocationMap, hasMapCoordinates, parseMapCoordinate } from '@/components/inventory/InventoryLocationMap';

type InventoryPhoto = {
  name: string;
  url: string;
  storagePath: string;
  uploadedAt: string;
};

type LifecycleEventType =
  | 'created'
  | 'imported'
  | 'updated'
  | 'reassigned'
  | 'transferred'
  | 'retired'
  | 'maintenance';

type LifecycleEntry = {
  id: string;
  type: LifecycleEventType;
  date: string;
  title: string;
  description: string;
  from?: string | null;
  to?: string | null;
  actorId?: string | null;
  actorEmail?: string | null;
  metadata?: Record<string, any>;
  createdAt: string;
};

type InventoryItem = {
  id: string;
  name?: string;
  category?: string;
  assetCode?: string;
  serialNumber?: string;
  quantity?: number;
  location?: string;
  mapUrl?: string;
  latitude?: number | string | null;
  longitude?: number | string | null;
  responsibleId?: string;
  responsibleName?: string;
  condition?: string;
  status?: string;
  acquisitionDate?: string;
  estimatedValue?: number;
  observations?: string;
  needsRepair?: boolean;
  photos?: InventoryPhoto[];
  maintenanceHistory?: MaintenanceEntry[];
  lifecycleHistory?: LifecycleEntry[];
  transferredToProject?: string;
  retiredAt?: string | null;
  createdAt?: any;
  updatedAt?: any;
};

type MaintenanceEntry = {
  id: string;
  type: string;
  date: string;
  description: string;
  technician?: string;
  cost?: number;
  result?: string;
  createdAt: string;
  createdBy?: string | null;
};

type InventoryForm = {
  name: string;
  category: string;
  assetCode: string;
  serialNumber: string;
  quantity: string;
  location: string;
  mapUrl: string;
  latitude: string;
  longitude: string;
  responsibleId: string;
  condition: string;
  status: string;
  acquisitionDate: string;
  estimatedValue: string;
  observations: string;
  needsRepair: boolean;
};

type MaintenanceForm = {
  type: string;
  date: string;
  description: string;
  technician: string;
  cost: string;
  result: string;
};

type AssetActionType = 'reassign' | 'transfer' | 'retire';

type AssetLifecycleForm = {
  action: AssetActionType;
  date: string;
  responsibleId: string;
  targetProject: string;
  targetLocation: string;
  reason: string;
};

type BulkInventoryRow = {
  name: string;
  category: string;
  assetCode: string;
  serialNumber: string;
  quantity: number;
  location: string;
  mapUrl: string;
  latitude: number | null;
  longitude: number | null;
  responsibleId: string;
  responsibleName: string;
  condition: string;
  status: string;
  acquisitionDate: string;
  estimatedValue: number;
  observations: string;
  needsRepair: boolean;
};

type BulkInventoryPreview = {
  validRows: BulkInventoryRow[];
  invalidRows: Array<{ line: number; reason: string; raw: string }>;
};

type ProjectInventoryProps = {
  projectId: string;
  project: any;
  teamMembers: any[];
  currentUser: any;
  canView?: boolean;
  canManage: boolean;
};

const INVENTORY_CATEGORIES = [
  'Computador',
  'Silla',
  'Mesa',
  'Monitor',
  'Impresora',
  'Celular',
  'Herramienta',
  'Equipo de campo',
  'Licencia',
  'Otro',
];

const STATUS_OPTIONS = [
  { value: 'available', label: 'Disponible', className: 'bg-emerald-50 text-emerald-700 ring-emerald-100' },
  { value: 'assigned', label: 'Asignado', className: 'bg-indigo-50 text-indigo-700 ring-indigo-100' },
  { value: 'repair', label: 'En reparación', className: 'bg-orange-50 text-orange-700 ring-orange-100' },
  { value: 'transferred', label: 'Trasladado', className: 'bg-violet-50 text-violet-700 ring-violet-100' },
  { value: 'retired', label: 'Retirado', className: 'bg-slate-100 text-slate-700 ring-slate-200' },
  { value: 'lost', label: 'No localizado', className: 'bg-red-50 text-red-700 ring-red-100' },
];

const CONDITION_OPTIONS = [
  { value: 'excellent', label: 'Excelente', className: 'bg-emerald-50 text-emerald-700 ring-emerald-100' },
  { value: 'good', label: 'Bueno', className: 'bg-cyan-50 text-cyan-700 ring-cyan-100' },
  { value: 'fair', label: 'Regular', className: 'bg-amber-50 text-amber-700 ring-amber-100' },
  { value: 'damaged', label: 'Dañado', className: 'bg-red-50 text-red-700 ring-red-100' },
];

const emptyForm: InventoryForm = {
  name: '',
  category: 'Computador',
  assetCode: '',
  serialNumber: '',
  quantity: '1',
  location: '',
  mapUrl: '',
  latitude: '',
  longitude: '',
  responsibleId: '',
  condition: 'good',
  status: 'available',
  acquisitionDate: '',
  estimatedValue: '',
  observations: '',
  needsRepair: false,
};

const emptyMaintenanceForm: MaintenanceForm = {
  type: 'reparacion',
  date: new Date().toISOString().slice(0, 10),
  description: '',
  technician: '',
  cost: '',
  result: '',
};

const emptyLifecycleForm = (action: AssetActionType = 'reassign'): AssetLifecycleForm => ({
  action,
  date: new Date().toISOString().slice(0, 10),
  responsibleId: '',
  targetProject: '',
  targetLocation: '',
  reason: '',
});

const BULK_IMPORT_SAMPLE = [
  'nombre,categoria,codigo,serial,cantidad,ubicacion,latitud,longitud,responsable,estado,condicion,valor,observaciones',
  'Portatil Dell,Computador,INV-001,SN-7788,1,Oficina principal,4.7110,-74.0721,persona@example.com,asignado,bueno,3500000,Equipo de campo',
  'Silla ergonomica,Silla,INV-002,,3,Sala operativa,,,,disponible,excelente,420000,',
].join('\n');

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Math.round(value || 0));

const formatNumber = (value: number) => new Intl.NumberFormat('es-CO').format(value || 0);

const toDate = (value: any): Date | null => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDate = (value: any) => {
  const date = toDate(value);
  if (!date) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
};

const getStatusMeta = (value?: string) =>
  STATUS_OPTIONS.find((status) => status.value === value) || STATUS_OPTIONS[0];

const getConditionMeta = (value?: string) =>
  CONDITION_OPTIONS.find((condition) => condition.value === value) || CONDITION_OPTIONS[1];

const normalizeMoneyInput = (value: string) => value.replace(/[^\d]/g, '');

const formatMoneyInput = (value: string) => {
  const clean = normalizeMoneyInput(value);
  if (!clean) return '';
  return new Intl.NumberFormat('es-CO').format(Number(clean));
};

const parseMoneyInput = (value: string) => Number(normalizeMoneyInput(value) || 0);

const csvEscape = (value: any) => {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
};

const htmlEscape = (value: any) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const normalizeKey = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');

const normalizeCategoryName = (value: string) => String(value || '').trim().replace(/\s+/g, ' ');

const uniqueInventoryCategories = (values: Array<string | null | undefined>) => {
  const seen = new Set<string>();
  const categories: string[] = [];

  values.forEach((value) => {
    const cleanValue = normalizeCategoryName(String(value || ''));
    if (!cleanValue) return;
    const key = normalizeKey(cleanValue);
    if (!key || seen.has(key)) return;
    seen.add(key);
    categories.push(cleanValue);
  });

  return categories.sort((left, right) => left.localeCompare(right));
};

const resolveInventoryCategory = (value: string, categories: string[]) => {
  const cleanValue = normalizeCategoryName(value);
  if (!cleanValue) return categories[0] || null;
  return categories.find((category) => normalizeKey(category) === normalizeKey(cleanValue)) || null;
};

const isDefaultInventoryCategory = (category: string) =>
  INVENTORY_CATEGORIES.some((baseCategory) => normalizeKey(baseCategory) === normalizeKey(category));

const splitDelimitedLine = (line: string, delimiter: string) => {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
};

const detectDelimiter = (line: string) => {
  const candidates = ['\t', ';', ','];
  return candidates
    .map((delimiter) => ({ delimiter, count: line.split(delimiter).length - 1 }))
    .sort((left, right) => right.count - left.count)[0]?.delimiter || ',';
};

const parseLooseNumber = (value: string) => {
  const clean = String(value || '')
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '');
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeStatusValue = (value: string, needsRepair = false) => {
  if (needsRepair) return 'repair';
  const normalized = normalizeKey(value);
  if (['asignado', 'assigned', 'entregado'].includes(normalized)) return 'assigned';
  if (['reparacion', 'enreparacion', 'repair', 'mantenimiento'].includes(normalized)) return 'repair';
  if (['retirado', 'baja', 'dadodebaja', 'retired'].includes(normalized)) return 'retired';
  if (['trasladado', 'transferido', 'transferred'].includes(normalized)) return 'transferred';
  if (['perdido', 'nolocalizado', 'lost'].includes(normalized)) return 'lost';
  return 'available';
};

const normalizeConditionValue = (value: string) => {
  const normalized = normalizeKey(value);
  if (['excelente', 'excellent', 'nuevo'].includes(normalized)) return 'excellent';
  if (['regular', 'fair'].includes(normalized)) return 'fair';
  if (['danado', 'deteriorado', 'malo', 'damaged'].includes(normalized)) return 'damaged';
  return 'good';
};

const normalizeBoolean = (value: string) => ['si', 'sí', 'true', '1', 'x', 'yes'].includes(String(value || '').trim().toLowerCase());

const HEADER_ALIASES: Record<string, keyof BulkInventoryRow | 'needsRepair'> = {
  nombre: 'name',
  activo: 'name',
  name: 'name',
  categoria: 'category',
  category: 'category',
  tipo: 'category',
  codigo: 'assetCode',
  codigointerno: 'assetCode',
  placa: 'assetCode',
  assetcode: 'assetCode',
  serial: 'serialNumber',
  serialnumber: 'serialNumber',
  serie: 'serialNumber',
  cantidad: 'quantity',
  quantity: 'quantity',
  ubicacion: 'location',
  localizacion: 'location',
  location: 'location',
  responsable: 'responsibleName',
  responsible: 'responsibleName',
  responsablecorreo: 'responsibleName',
  emailresponsable: 'responsibleName',
  estado: 'status',
  status: 'status',
  condicion: 'condition',
  condition: 'condition',
  adquisicion: 'acquisitionDate',
  fechaadquisicion: 'acquisitionDate',
  acquisitiondate: 'acquisitionDate',
  valor: 'estimatedValue',
  valorunitario: 'estimatedValue',
  estimatedvalue: 'estimatedValue',
  observaciones: 'observations',
  observacion: 'observations',
  notes: 'observations',
  mapurl: 'mapUrl',
  linkubicacion: 'mapUrl',
  latitud: 'latitude',
  latitude: 'latitude',
  lat: 'latitude',
  longitud: 'longitude',
  longitude: 'longitude',
  lng: 'longitude',
  lon: 'longitude',
  reparacion: 'needsRepair',
  requierereparacion: 'needsRepair',
};

const DEFAULT_BULK_COLUMNS: Array<keyof BulkInventoryRow | 'needsRepair'> = [
  'name',
  'category',
  'assetCode',
  'serialNumber',
  'quantity',
  'location',
  'responsibleName',
  'status',
  'condition',
  'estimatedValue',
  'observations',
];

const parseBulkInventory = (
  rawInput: string,
  categories: string[],
  resolveMember: (value: string) => any | null
): BulkInventoryPreview => {
  const lines = rawInput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return { validRows: [], invalidRows: [] };

  const delimiter = detectDelimiter(lines[0]);
  const firstValues = splitDelimitedLine(lines[0], delimiter);
  const headerFields = firstValues.map((value) => HEADER_ALIASES[normalizeKey(value)]).filter(Boolean);
  const hasHeader = headerFields.length >= 2;
  const columns = hasHeader
    ? firstValues.map((value) => HEADER_ALIASES[normalizeKey(value)] || null)
    : DEFAULT_BULK_COLUMNS;
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const invalidRows: BulkInventoryPreview['invalidRows'] = [];
  const validRows: BulkInventoryRow[] = [];

  dataLines.forEach((line, index) => {
    const values = splitDelimitedLine(line, delimiter);
    const draft: Partial<BulkInventoryRow> & { needsRepair?: boolean } = {};

    values.forEach((value, valueIndex) => {
      const key = columns[valueIndex];
      if (!key) return;
      if (key === 'quantity') {
        draft.quantity = Math.max(Math.round(parseLooseNumber(value) || 1), 1);
      } else if (key === 'estimatedValue') {
        draft.estimatedValue = Math.max(parseLooseNumber(value), 0);
      } else if (key === 'needsRepair') {
        draft.needsRepair = normalizeBoolean(value);
      } else if (key === 'latitude' || key === 'longitude') {
        (draft as any)[key] = parseMapCoordinate(value);
      } else {
        (draft as any)[key] = value;
      }
    });

    const cleanName = String(draft.name || '').trim();
    if (!cleanName) {
      invalidRows.push({ line: (hasHeader ? index + 2 : index + 1), reason: 'Falta el nombre del activo.', raw: line });
      return;
    }

    const responsibleText = String(draft.responsibleName || '').trim();
    const responsibleMember = responsibleText ? resolveMember(responsibleText) : null;
    const needsRepair = Boolean(draft.needsRepair);
    const category = resolveInventoryCategory(String(draft.category || ''), categories);

    if (!category) {
      invalidRows.push({
        line: (hasHeader ? index + 2 : index + 1),
        reason: `La categoría "${String(draft.category || '').trim() || 'sin categoría'}" no existe en el catálogo.`,
        raw: line,
      });
      return;
    }

    validRows.push({
      name: cleanName,
      category,
      assetCode: String(draft.assetCode || '').trim(),
      serialNumber: String(draft.serialNumber || '').trim(),
      quantity: Math.max(Number(draft.quantity || 1), 1),
      location: String(draft.location || '').trim(),
      mapUrl: String(draft.mapUrl || '').trim(),
      latitude: parseMapCoordinate(draft.latitude) ?? null,
      longitude: parseMapCoordinate(draft.longitude) ?? null,
      responsibleId: responsibleMember?.id || '',
      responsibleName: responsibleMember?.name || responsibleMember?.email || responsibleText,
      condition: normalizeConditionValue(String(draft.condition || 'good')),
      status: normalizeStatusValue(String(draft.status || ''), needsRepair),
      acquisitionDate: String(draft.acquisitionDate || '').trim(),
      estimatedValue: Math.max(Number(draft.estimatedValue || 0), 0),
      observations: String(draft.observations || '').trim(),
      needsRepair,
    });
  });

  return { validRows, invalidRows };
};

export function ProjectInventory({
  projectId,
  project,
  teamMembers,
  currentUser,
  canView = true,
  canManage,
}: ProjectInventoryProps) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [form, setForm] = useState<InventoryForm>(emptyForm);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [maintenanceForm, setMaintenanceForm] = useState<MaintenanceForm>(emptyMaintenanceForm);
  const [savingMaintenance, setSavingMaintenance] = useState(false);
  const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);
  const [bulkImportText, setBulkImportText] = useState('');
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });
  const [assetActionForm, setAssetActionForm] = useState<AssetLifecycleForm | null>(null);
  const [savingAssetAction, setSavingAssetAction] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [savingCategory, setSavingCategory] = useState(false);

  const projectMemberIds = useMemo(
    () => new Set((project?.assignedTeamMembers || []).filter(Boolean)),
    [project?.assignedTeamMembers]
  );

  const projectMembers = useMemo(() => {
    const filtered = teamMembers.filter((member) => projectMemberIds.size === 0 || projectMemberIds.has(member.id));
    return filtered.length > 0 ? filtered : teamMembers;
  }, [projectMemberIds, teamMembers]);

  const memberById = useMemo(() => {
    const map = new Map<string, any>();
    teamMembers.forEach((member) => {
      if (member.id) map.set(member.id, member);
      if (member.authUserId) map.set(member.authUserId, member);
      if (member.uid) map.set(member.uid, member);
    });
    return map;
  }, [teamMembers]);

  const resolveMember = useMemo(() => {
    const lookup = new Map<string, any>();
    projectMembers.forEach((member) => {
      [member.id, member.authUserId, member.uid, member.email, member.name]
        .filter(Boolean)
        .forEach((value) => lookup.set(String(value).trim().toLowerCase(), member));
    });
    return (value: string) => lookup.get(String(value || '').trim().toLowerCase()) || null;
  }, [projectMembers]);

  useEffect(() => {
    if (!projectId || !canView) {
      setItems([]);
      setLoading(false);
      return;
    }

    const inventoryQuery = query(
      collection(db, 'projects', projectId, 'inventoryItems'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(inventoryQuery, (snapshot) => {
      setItems(snapshot.docs.map((document) => ({ id: document.id, ...document.data() } as InventoryItem)));
      setLoading(false);
    }, (error) => {
      console.error('Error loading inventory:', error);
      toast.error('No se pudo cargar el inventario.');
      setLoading(false);
    });

    return () => unsubscribe();
  }, [canView, projectId]);

  useEffect(() => {
    setSelectedItem((current) => {
      if (!current) return current;
      return items.find((item) => item.id === current.id) || current;
    });
  }, [items]);

  const stats = useMemo(() => {
    const totalUnits = items.reduce((sum, item) => sum + Math.max(Number(item.quantity || 0), 0), 0);
    const totalValue = items.reduce((sum, item) => sum + Math.max(Number(item.estimatedValue || 0), 0) * Math.max(Number(item.quantity || 1), 1), 0);
    const repairCount = items.filter((item) => item.needsRepair || item.status === 'repair' || item.condition === 'damaged').length;
    const assignedCount = items.filter((item) => Boolean(item.responsibleId)).length;
    const locations = new Set(items.map((item) => item.location).filter(Boolean));

    return { totalUnits, totalValue, repairCount, assignedCount, locations: locations.size };
  }, [items]);

  const customCategories = useMemo(
    () => uniqueInventoryCategories(Array.isArray(project?.inventoryCategories) ? project.inventoryCategories : []),
    [project?.inventoryCategories]
  );

  const catalogCategories = useMemo(
    () => uniqueInventoryCategories([...INVENTORY_CATEGORIES, ...customCategories]),
    [customCategories]
  );

  const legacyCategories = useMemo(
    () => uniqueInventoryCategories(items.map((item) => item.category).filter(Boolean) as string[]),
    [items]
  );

  const categories = useMemo(
    () => uniqueInventoryCategories([...catalogCategories, ...legacyCategories]),
    [catalogCategories, legacyCategories]
  );

  const formCategories = useMemo(
    () => uniqueInventoryCategories([...catalogCategories, editingItem?.category]),
    [catalogCategories, editingItem?.category]
  );

  const uncataloguedCategories = useMemo(
    () => legacyCategories.filter((category) => !catalogCategories.some((catalogCategory) => normalizeKey(catalogCategory) === normalizeKey(category))),
    [catalogCategories, legacyCategories]
  );

  const categoryUsageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    items.forEach((item) => {
      const key = normalizeKey(item.category || '');
      if (!key) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }, [items]);

  const bulkPreview = useMemo(
    () => parseBulkInventory(bulkImportText, catalogCategories, resolveMember),
    [bulkImportText, catalogCategories, resolveMember]
  );

  const filteredItems = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    return items.filter((item) => {
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
      if (statusFilter !== 'all') {
        if (statusFilter === 'repair') {
          if (!(item.needsRepair || item.status === 'repair' || item.condition === 'damaged')) return false;
        } else if (item.status !== statusFilter) {
          return false;
        }
      }

      if (!search) return true;
      const responsible = item.responsibleName || memberById.get(item.responsibleId || '')?.name || '';
      return [
        item.name,
        item.category,
        item.assetCode,
        item.serialNumber,
        item.location,
        item.latitude,
        item.longitude,
        item.observations,
        responsible,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
    });
  }, [categoryFilter, items, memberById, searchTerm, statusFilter]);

  const getResponsibleLabel = (item: InventoryItem) => {
    const member = item.responsibleId ? memberById.get(item.responsibleId) : null;
    return item.responsibleName || member?.name || member?.email || 'Sin responsable';
  };

  const buildLifecycleEntry = (
    type: LifecycleEventType,
    title: string,
    description: string,
    details: Partial<LifecycleEntry> = {}
  ): LifecycleEntry => ({
    id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    date: details.date || new Date().toISOString().slice(0, 10),
    title,
    description,
    from: details.from ?? null,
    to: details.to ?? null,
    actorId: currentUser?.uid || currentUser?.id || null,
    actorEmail: currentUser?.email || null,
    metadata: details.metadata || {},
    createdAt: new Date().toISOString(),
  });

  const getLifecycleEntries = (item: InventoryItem) => {
    const lifecycleEntries = item.lifecycleHistory || [];
    const lifecycleMaintenanceIds = new Set(
      lifecycleEntries
        .map((entry) => entry.metadata?.maintenanceId)
        .filter(Boolean)
    );
    const legacyMaintenanceEntries: LifecycleEntry[] = (item.maintenanceHistory || [])
      .filter((entry) => !lifecycleMaintenanceIds.has(entry.id))
      .map((entry) => ({
        id: `legacy-maintenance-${entry.id}`,
        type: 'maintenance',
        date: entry.date,
        title: entry.type || 'Novedad',
        description: entry.description,
        actorId: entry.createdBy || null,
        actorEmail: null,
        metadata: {
          maintenanceId: entry.id,
          technician: entry.technician,
          cost: entry.cost,
          result: entry.result,
          legacy: true,
        },
        createdAt: entry.createdAt || entry.date,
      }));

    return [...lifecycleEntries, ...legacyMaintenanceEntries].sort((left, right) => {
      const rightDate = new Date(right.createdAt || right.date).getTime();
      const leftDate = new Date(left.createdAt || left.date).getTime();
      return rightDate - leftDate;
    });
  };

  const buildUpdateLifecycleEvents = (previous: InventoryItem, next: any, uploadedPhotoCount: number) => {
    const events: LifecycleEntry[] = [];
    const previousResponsible = getResponsibleLabel(previous);
    const nextResponsible = next.responsibleName || 'Sin responsable';

    if ((previous.responsibleId || '') !== (next.responsibleId || '')) {
      events.push(buildLifecycleEntry(
        'reassigned',
        'Responsable actualizado',
        `El activo fue reasignado de ${previousResponsible} a ${nextResponsible}.`,
        { from: previousResponsible, to: nextResponsible }
      ));
    }

    if ((previous.status || 'available') !== next.status) {
      const from = getStatusMeta(previous.status).label;
      const to = getStatusMeta(next.status).label;
      events.push(buildLifecycleEntry(
        next.status === 'retired' ? 'retired' : next.status === 'transferred' ? 'transferred' : 'updated',
        'Estado actualizado',
        `El estado cambió de ${from} a ${to}.`,
        { from, to }
      ));
    }

    if ((previous.location || '') !== (next.location || '')) {
      events.push(buildLifecycleEntry(
        'updated',
        'Ubicación actualizada',
        `La ubicación cambió de ${previous.location || 'Sin ubicación'} a ${next.location || 'Sin ubicación'}.`,
        { from: previous.location || null, to: next.location || null }
      ));
    }

    if (uploadedPhotoCount > 0) {
      events.push(buildLifecycleEntry(
        'updated',
        'Evidencia fotográfica agregada',
        `Se agregaron ${uploadedPhotoCount} foto(s) al activo.`,
        { metadata: { uploadedPhotoCount } }
      ));
    }

    return events;
  };

  const resetForm = () => {
    setForm(emptyForm);
    setEditingItem(null);
    setPhotoFiles([]);
    setIsFormOpen(false);
  };

  const openCreateForm = () => {
    setEditingItem(null);
    setForm(emptyForm);
    setPhotoFiles([]);
    setIsFormOpen(true);
  };

  const openEditForm = (item: InventoryItem) => {
    setEditingItem(item);
    setForm({
      name: item.name || '',
      category: item.category || 'Computador',
      assetCode: item.assetCode || '',
      serialNumber: item.serialNumber || '',
      quantity: String(item.quantity || 1),
      location: item.location || '',
      mapUrl: item.mapUrl || '',
      latitude: item.latitude !== null && item.latitude !== undefined ? String(item.latitude) : '',
      longitude: item.longitude !== null && item.longitude !== undefined ? String(item.longitude) : '',
      responsibleId: item.responsibleId || '',
      condition: item.condition || 'good',
      status: item.status || 'available',
      acquisitionDate: item.acquisitionDate || '',
      estimatedValue: item.estimatedValue ? formatMoneyInput(String(item.estimatedValue)) : '',
      observations: item.observations || '',
      needsRepair: Boolean(item.needsRepair),
    });
    setPhotoFiles([]);
    setIsFormOpen(true);
  };

  const openBulkImport = () => {
    setBulkImportText((current) => current || BULK_IMPORT_SAMPLE);
    setBulkProgress({ done: 0, total: 0 });
    setIsBulkImportOpen(true);
  };

  const getCustomCategoryPayload = (nextCategories: string[]) =>
    uniqueInventoryCategories(nextCategories).filter((category) => !isDefaultInventoryCategory(category));

  const saveCustomCategories = async (nextCategories: string[]) => {
    await updateDoc(doc(db, 'projects', projectId), {
      inventoryCategories: getCustomCategoryPayload(nextCategories),
      updatedAt: serverTimestamp(),
      updatedBy: currentUser?.uid || currentUser?.id || null,
    });
  };

  const handleAddCategory = async () => {
    if (!canManage) return;
    const cleanCategory = normalizeCategoryName(newCategoryName);

    if (!cleanCategory) {
      toast.warning('Escribe el nombre de la categoría.');
      return;
    }

    const exists = catalogCategories.some((category) => normalizeKey(category) === normalizeKey(cleanCategory));
    if (exists) {
      toast.info('Esa categoría ya existe en el catálogo.');
      setNewCategoryName('');
      return;
    }

    setSavingCategory(true);
    try {
      await saveCustomCategories([...customCategories, cleanCategory]);
      setNewCategoryName('');
      toast.success('Categoría creada para inventarios.');
    } catch (error: any) {
      console.error('Error saving inventory category:', error);
      toast.error(error?.message || 'No se pudo crear la categoría.');
    } finally {
      setSavingCategory(false);
    }
  };

  const handleRegisterUncataloguedCategories = async () => {
    if (!canManage || uncataloguedCategories.length === 0) return;

    setSavingCategory(true);
    try {
      await saveCustomCategories([...customCategories, ...uncataloguedCategories]);
      toast.success('Categorías existentes agregadas al catálogo.');
    } catch (error: any) {
      console.error('Error registering inventory categories:', error);
      toast.error(error?.message || 'No se pudieron agregar las categorías.');
    } finally {
      setSavingCategory(false);
    }
  };

  const handleRemoveCategory = async (category: string) => {
    if (!canManage) return;

    if (isDefaultInventoryCategory(category)) {
      toast.info('Las categorías base permanecen disponibles para todos los proyectos.');
      return;
    }

    const usageCount = categoryUsageCounts.get(normalizeKey(category)) || 0;
    if (usageCount > 0) {
      toast.warning(`No se puede eliminar "${category}" porque tiene ${usageCount} activo(s) asociado(s).`);
      return;
    }

    setSavingCategory(true);
    try {
      await saveCustomCategories(customCategories.filter((customCategory) => normalizeKey(customCategory) !== normalizeKey(category)));
      if (categoryFilter === category) setCategoryFilter('all');
      if (form.category === category) {
        const fallbackCategory = catalogCategories.find((catalogCategory) => normalizeKey(catalogCategory) !== normalizeKey(category)) || emptyForm.category;
        setForm((current) => ({ ...current, category: fallbackCategory }));
      }
      toast.success('Categoría eliminada del catálogo.');
    } catch (error: any) {
      console.error('Error removing inventory category:', error);
      toast.error(error?.message || 'No se pudo eliminar la categoría.');
    } finally {
      setSavingCategory(false);
    }
  };

  const uploadPhotos = async (files: File[]) => {
    const uploaded: InventoryPhoto[] = [];

    for (const [index, file] of files.entries()) {
      const safeName = file.name.replace(/[^\w.\-]+/g, '_');
      const storagePath = `projects/${projectId}/inventory/${Date.now()}_${index}_${safeName}`;
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      uploaded.push({
        name: file.name,
        url,
        storagePath: storageRef.fullPath,
        uploadedAt: new Date().toISOString(),
      });
    }

    return uploaded;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!canManage) {
      toast.error('No tienes permisos para administrar el inventario.');
      return;
    }

    const cleanName = form.name.trim();
    const cleanCategory = resolveInventoryCategory(form.category, formCategories);
    const quantity = Math.max(Number(form.quantity || 1), 1);

    if (!cleanName || !cleanCategory) {
      toast.warning('Ingresa nombre y selecciona una categoría creada en el catálogo.');
      return;
    }

    setSaving(true);
    try {
      const uploadedPhotos = await uploadPhotos(photoFiles);
      const responsibleMember = form.responsibleId ? memberById.get(form.responsibleId) : null;
      const payload = {
        name: cleanName,
        category: cleanCategory,
        assetCode: form.assetCode.trim(),
        serialNumber: form.serialNumber.trim(),
        quantity,
        location: form.location.trim(),
        mapUrl: form.mapUrl.trim(),
        latitude: parseMapCoordinate(form.latitude),
        longitude: parseMapCoordinate(form.longitude),
        responsibleId: form.responsibleId || null,
        responsibleName: responsibleMember?.name || responsibleMember?.email || null,
        condition: form.condition,
        status: form.needsRepair ? 'repair' : form.status,
        acquisitionDate: form.acquisitionDate || null,
        estimatedValue: parseMoneyInput(form.estimatedValue),
        observations: form.observations.trim(),
        needsRepair: form.needsRepair,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser?.uid || null,
      };

      if (editingItem) {
        const lifecycleEvents = buildUpdateLifecycleEvents(editingItem, payload, uploadedPhotos.length);
        const updatePayload: Record<string, any> = {
          ...payload,
          photos: [...(editingItem.photos || []), ...uploadedPhotos],
        };
        if (lifecycleEvents.length > 0) {
          updatePayload.lifecycleHistory = arrayUnion(...lifecycleEvents);
        }
        if (payload.status === 'retired') {
          updatePayload.retiredAt = editingItem.retiredAt || new Date().toISOString();
        }
        if (payload.status !== 'retired') {
          updatePayload.retiredAt = null;
        }
        await updateDoc(doc(db, 'projects', projectId, 'inventoryItems', editingItem.id), updatePayload);
        toast.success('Activo actualizado.');
      } else {
        const createdEntry = buildLifecycleEntry(
          'created',
          'Activo creado',
          `Activo creado en el inventario del proyecto ${project?.name || 'actual'}.`
        );
        await addDoc(collection(db, 'projects', projectId, 'inventoryItems'), {
          ...payload,
          photos: uploadedPhotos,
          maintenanceHistory: [],
          lifecycleHistory: [createdEntry],
          retiredAt: payload.status === 'retired' ? new Date().toISOString() : null,
          createdAt: serverTimestamp(),
          createdBy: currentUser?.uid || null,
        });
        toast.success('Activo agregado al inventario.');
      }

      resetForm();
    } catch (error: any) {
      console.error('Error saving inventory item:', error);
      toast.error(error?.message || 'No se pudo guardar el activo.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item: InventoryItem) => {
    if (!canManage) return;
    const confirmed = window.confirm(`Eliminar "${item.name || 'activo'}" del inventario?`);
    if (!confirmed) return;

    try {
      for (const photo of item.photos || []) {
        if (photo.storagePath) {
          await deleteObject(ref(storage, photo.storagePath));
        }
      }
      await deleteDoc(doc(db, 'projects', projectId, 'inventoryItems', item.id));
      if (selectedItem?.id === item.id) setSelectedItem(null);
      toast.success('Activo eliminado.');
    } catch (error: any) {
      console.error('Error deleting inventory item:', error);
      toast.error(error?.message || 'No se pudo eliminar el activo.');
    }
  };

  const handleBulkImport = async () => {
    if (!canManage) {
      toast.error('No tienes permisos para administrar el inventario.');
      return;
    }

    if (bulkPreview.validRows.length === 0) {
      toast.warning('No hay filas válidas para importar.');
      return;
    }

    setBulkImporting(true);
    setBulkProgress({ done: 0, total: bulkPreview.validRows.length });

    try {
      const inventoryCollection = collection(db, 'projects', projectId, 'inventoryItems');
      const chunkSize = 150;

      for (let index = 0; index < bulkPreview.validRows.length; index += chunkSize) {
        const chunk = bulkPreview.validRows.slice(index, index + chunkSize);
        const batch = writeBatch(db);

        chunk.forEach((row) => {
          const rowRef = doc(inventoryCollection);
          const importedEntry = buildLifecycleEntry(
            'imported',
            'Activo importado',
            `Activo importado por carga masiva en ${project?.name || 'este proyecto'}.`,
            {
              metadata: {
                source: 'bulk_import',
                assetCode: row.assetCode || null,
                serialNumber: row.serialNumber || null,
              },
            }
          );

          batch.set(rowRef, {
            ...row,
            responsibleId: row.responsibleId || null,
            responsibleName: row.responsibleName || null,
            acquisitionDate: row.acquisitionDate || null,
            status: row.needsRepair ? 'repair' : row.status,
            photos: [],
            maintenanceHistory: [],
            lifecycleHistory: [importedEntry],
            retiredAt: row.status === 'retired' ? new Date().toISOString() : null,
            createdAt: serverTimestamp(),
            createdBy: currentUser?.uid || null,
            updatedAt: serverTimestamp(),
            updatedBy: currentUser?.uid || null,
          });
        });

        await batch.commit();
        setBulkProgress({ done: Math.min(index + chunk.length, bulkPreview.validRows.length), total: bulkPreview.validRows.length });
      }

      toast.success(`${bulkPreview.validRows.length} activo(s) importados.`);
      setIsBulkImportOpen(false);
      setBulkImportText('');
      setBulkProgress({ done: 0, total: 0 });
    } catch (error: any) {
      console.error('Error importing inventory:', error);
      toast.error(error?.message || 'No se pudo completar la carga masiva.');
    } finally {
      setBulkImporting(false);
    }
  };

  const openAssetAction = (action: AssetActionType) => {
    if (!selectedItem) return;
    setAssetActionForm({
      ...emptyLifecycleForm(action),
      responsibleId: action === 'reassign' ? selectedItem.responsibleId || '' : '',
      targetLocation: selectedItem.location || '',
    });
  };

  const handleAssetLifecycleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedItem || !assetActionForm || !canManage) return;

    const reason = assetActionForm.reason.trim();
    const updatePayload: Record<string, any> = {
      updatedAt: serverTimestamp(),
      updatedBy: currentUser?.uid || null,
    };
    let lifecycleEntry: LifecycleEntry;

    if (assetActionForm.action === 'reassign') {
      const nextMember = assetActionForm.responsibleId ? memberById.get(assetActionForm.responsibleId) : null;
      if (!nextMember) {
        toast.warning('Selecciona el nuevo responsable del activo.');
        return;
      }
      const previousResponsible = getResponsibleLabel(selectedItem);
      const nextResponsible = nextMember.name || nextMember.email || 'Responsable seleccionado';
      lifecycleEntry = buildLifecycleEntry(
        'reassigned',
        'Activo reasignado',
        reason || `El activo fue reasignado de ${previousResponsible} a ${nextResponsible}.`,
        {
          date: assetActionForm.date,
          from: previousResponsible,
          to: nextResponsible,
        }
      );
      updatePayload.responsibleId = nextMember.id;
      updatePayload.responsibleName = nextResponsible;
      updatePayload.status = 'assigned';
      updatePayload.retiredAt = null;
    } else if (assetActionForm.action === 'transfer') {
      const targetProject = assetActionForm.targetProject.trim();
      if (!targetProject) {
        toast.warning('Ingresa el proyecto destino del traslado.');
        return;
      }
      lifecycleEntry = buildLifecycleEntry(
        'transferred',
        'Activo trasladado',
        reason || `El activo fue trasladado al proyecto ${targetProject}.`,
        {
          date: assetActionForm.date,
          from: project?.name || 'Proyecto actual',
          to: targetProject,
          metadata: {
            targetLocation: assetActionForm.targetLocation.trim() || null,
          },
        }
      );
      updatePayload.status = 'transferred';
      updatePayload.transferredToProject = targetProject;
      updatePayload.location = assetActionForm.targetLocation.trim() || selectedItem.location || '';
      updatePayload.retiredAt = null;
    } else {
      if (!reason) {
        toast.warning('Describe por qué se da de baja el activo.');
        return;
      }
      lifecycleEntry = buildLifecycleEntry(
        'retired',
        'Activo dado de baja',
        reason,
        {
          date: assetActionForm.date,
          from: getStatusMeta(selectedItem.status).label,
          to: 'Retirado',
        }
      );
      updatePayload.status = 'retired';
      updatePayload.needsRepair = false;
      updatePayload.retiredAt = new Date(`${assetActionForm.date}T00:00:00`).toISOString();
    }

    setSavingAssetAction(true);
    try {
      await updateDoc(doc(db, 'projects', projectId, 'inventoryItems', selectedItem.id), {
        ...updatePayload,
        lifecycleHistory: arrayUnion(lifecycleEntry),
      });
      setSelectedItem((current) => current ? {
        ...current,
        ...updatePayload,
        lifecycleHistory: [...(current.lifecycleHistory || []), lifecycleEntry],
      } : current);
      setAssetActionForm(null);
      toast.success('Hoja de vida del activo actualizada.');
    } catch (error: any) {
      console.error('Error saving asset lifecycle action:', error);
      toast.error(error?.message || 'No se pudo guardar la acción del activo.');
    } finally {
      setSavingAssetAction(false);
    }
  };

  const handleMaintenanceSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedItem || !canManage) return;

    const description = maintenanceForm.description.trim();
    if (!description) {
      toast.warning('Describe la intervención o novedad del activo.');
      return;
    }

    const entry: MaintenanceEntry = {
      id: `${selectedItem.id}-${Date.now()}`,
      type: maintenanceForm.type,
      date: maintenanceForm.date || new Date().toISOString().slice(0, 10),
      description,
      technician: maintenanceForm.technician.trim(),
      cost: parseMoneyInput(maintenanceForm.cost),
      result: maintenanceForm.result.trim(),
      createdAt: new Date().toISOString(),
      createdBy: currentUser?.uid || null,
    };

    setSavingMaintenance(true);
    try {
      const lifecycleEntry = buildLifecycleEntry(
        'maintenance',
        entry.type || 'Novedad registrada',
        entry.description,
        {
          date: entry.date,
          metadata: {
            maintenanceId: entry.id,
            technician: entry.technician || null,
            cost: entry.cost || 0,
            result: entry.result || null,
          },
        }
      );
      await updateDoc(doc(db, 'projects', projectId, 'inventoryItems', selectedItem.id), {
        maintenanceHistory: arrayUnion(entry),
        lifecycleHistory: arrayUnion(lifecycleEntry),
        needsRepair: maintenanceForm.type === 'reparacion' ? false : selectedItem.needsRepair,
        status: maintenanceForm.type === 'reparacion' ? 'assigned' : selectedItem.status,
        condition: maintenanceForm.type === 'reparacion' && selectedItem.condition === 'damaged' ? 'good' : selectedItem.condition,
        updatedAt: serverTimestamp(),
      });
      setSelectedItem((current) => current ? {
        ...current,
        maintenanceHistory: [...(current.maintenanceHistory || []), entry],
        lifecycleHistory: [...(current.lifecycleHistory || []), lifecycleEntry],
        needsRepair: maintenanceForm.type === 'reparacion' ? false : current.needsRepair,
        status: maintenanceForm.type === 'reparacion' ? 'assigned' : current.status,
        condition: maintenanceForm.type === 'reparacion' && current.condition === 'damaged' ? 'good' : current.condition,
      } : current);
      setMaintenanceForm(emptyMaintenanceForm);
      toast.success('Hoja de vida actualizada.');
    } catch (error: any) {
      console.error('Error saving maintenance history:', error);
      toast.error(error?.message || 'No se pudo registrar la novedad.');
    } finally {
      setSavingMaintenance(false);
    }
  };

  const buildReportRows = () =>
    filteredItems.map((item) => ({
      activo: item.name || '',
      categoria: item.category || '',
      codigo: item.assetCode || '',
      serial: item.serialNumber || '',
      cantidad: item.quantity || 1,
      responsable: getResponsibleLabel(item),
      ubicacion: item.location || '',
      latitud: item.latitude ?? '',
      longitud: item.longitude ?? '',
      estado: getStatusMeta(item.status).label,
      condicion: getConditionMeta(item.condition).label,
      requiereReparacion: item.needsRepair ? 'Si' : 'No',
      valor: item.estimatedValue || 0,
      eventos: getLifecycleEntries(item).length,
      observaciones: item.observations || '',
    }));

  const downloadCsvReport = () => {
    const headers = ['Activo', 'Categoría', 'Código', 'Serial', 'Cantidad', 'Responsable', 'Ubicación', 'Latitud', 'Longitud', 'Estado', 'Condición', 'Requiere reparación', 'Valor unitario', 'Eventos hoja de vida', 'Observaciones'];
    const rows = buildReportRows();
    const csv = [
      headers.map(csvEscape).join(','),
      ...rows.map((row) => [
        row.activo,
        row.categoria,
        row.codigo,
        row.serial,
        row.cantidad,
        row.responsable,
        row.ubicacion,
        row.latitud,
        row.longitud,
        row.estado,
        row.condicion,
        row.requiereReparacion,
        row.valor,
        row.eventos,
        row.observaciones,
      ].map(csvEscape).join(',')),
    ].join('\n');

    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `inventario-${project?.name || projectId}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const openPrintReport = () => {
    const rows = buildReportRows();
    const reportProjectName = htmlEscape(project?.name || 'Proyecto');
    const generatedAt = htmlEscape(new Date().toLocaleString('es-CO'));
    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Reporte de inventario - ${reportProjectName}</title>
          <style>
            body { font-family: Arial, sans-serif; color: #0f172a; margin: 32px; }
            h1 { margin-bottom: 4px; }
            .muted { color: #64748b; }
            .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 24px 0; }
            .stat { border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; }
            .stat strong { display: block; font-size: 22px; margin-top: 8px; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th, td { border-bottom: 1px solid #e2e8f0; padding: 9px; text-align: left; vertical-align: top; }
            th { background: #f8fafc; color: #475569; text-transform: uppercase; font-size: 10px; letter-spacing: .08em; }
            .repair { color: #b91c1c; font-weight: 700; }
          </style>
        </head>
        <body>
          <p class="muted">Pixel Project · Reporte de inventario</p>
          <h1>${reportProjectName}</h1>
          <p class="muted">Generado el ${generatedAt}</p>
          <div class="stats">
            <div class="stat">Unidades<strong>${formatNumber(stats.totalUnits)}</strong></div>
            <div class="stat">Valor estimado<strong>${formatCurrency(stats.totalValue)}</strong></div>
            <div class="stat">Reparación<strong>${formatNumber(stats.repairCount)}</strong></div>
            <div class="stat">Ubicaciones<strong>${formatNumber(stats.locations)}</strong></div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Activo</th><th>Categoría</th><th>Código</th><th>Responsable</th><th>Ubicación</th><th>Estado</th><th>Valor</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((row) => `
                <tr>
                  <td><strong>${htmlEscape(row.activo)}</strong><br/><span class="muted">${htmlEscape(row.serial || row.observaciones)}</span></td>
                  <td>${htmlEscape(row.categoria)}</td>
                  <td>${htmlEscape(row.codigo)}</td>
                  <td>${htmlEscape(row.responsable)}</td>
                  <td>${htmlEscape(row.ubicacion)}</td>
                  <td class="${row.requiereReparacion === 'Si' ? 'repair' : ''}">${htmlEscape(row.estado)} · ${htmlEscape(row.condicion)}</td>
                  <td>${formatCurrency(Number(row.valor || 0))}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </body>
      </html>
    `;

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('El navegador bloqueó la ventana del reporte.');
      return;
    }
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => printWindow.print(), 250);
  };

  if (!canView) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-amber-600 shadow-sm">
          <AlertTriangle size={26} />
        </div>
        <h2 className="mt-4 text-2xl font-black text-slate-950">Inventario restringido</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm font-semibold leading-6 text-amber-900/80">
          Tu rol no tiene permiso para visualizar el inventario de este proyecto. Un administrador puede habilitarlo desde la consola de permisos.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="relative border-b border-slate-100 bg-slate-950 px-5 py-5 text-white">
          <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(90deg,rgba(255,255,255,.08)_1px,transparent_1px),linear-gradient(rgba(255,255,255,.08)_1px,transparent_1px)] [background-size:22px_22px]" />
          <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-md bg-cyan-400/10 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-cyan-200 ring-1 ring-cyan-300/20">
                <Package size={14} />
                Inventario inteligente
              </div>
              <h2 className="mt-3 text-2xl font-black tracking-tight">Inventario del proyecto</h2>
              <p className="mt-2 text-sm font-medium leading-6 text-slate-300">
                Controla activos, responsables, fotos, ubicación y hoja de vida operativa de cada elemento del proyecto.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={downloadCsvReport} className="border-white/15 bg-white/10 text-white hover:bg-white/15">
                <Download size={16} className="mr-2" />
                CSV
              </Button>
              <Button type="button" variant="outline" onClick={openPrintReport} className="border-white/15 bg-white/10 text-white hover:bg-white/15">
                <Printer size={16} className="mr-2" />
                Reporte
              </Button>
              {canManage && (
                <>
                  <Button type="button" variant="outline" onClick={openBulkImport} className="border-white/15 bg-white/10 text-white hover:bg-white/15">
                    <Upload size={16} className="mr-2" />
                    Carga masiva
                  </Button>
                  <Button type="button" onClick={openCreateForm} className="bg-cyan-400 font-black text-slate-950 hover:bg-cyan-300">
                    <Plus size={16} className="mr-2" />
                    Nuevo activo
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-px bg-slate-100 md:grid-cols-5">
          {[
            { label: 'Unidades', value: formatNumber(stats.totalUnits), icon: <Package size={18} />, tone: 'text-indigo-700 bg-indigo-50' },
            { label: 'Valor estimado', value: formatCurrency(stats.totalValue), icon: <DollarSign size={18} />, tone: 'text-emerald-700 bg-emerald-50' },
            { label: 'Responsables', value: `${formatNumber(stats.assignedCount)}/${formatNumber(items.length)}`, icon: <User size={18} />, tone: 'text-cyan-700 bg-cyan-50' },
            { label: 'Reparación', value: formatNumber(stats.repairCount), icon: <Wrench size={18} />, tone: 'text-orange-700 bg-orange-50' },
            { label: 'Ubicaciones', value: formatNumber(stats.locations), icon: <MapPin size={18} />, tone: 'text-slate-700 bg-slate-50' },
          ].map((stat) => (
            <div key={stat.label} className="bg-white p-4">
              <div className={`mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg ${stat.tone}`}>
                {stat.icon}
              </div>
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{stat.label}</p>
              <p className="mt-1 text-xl font-black text-slate-950">{stat.value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[1fr_220px_220px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Buscar por activo, código, serial, ubicación o responsable..."
              className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-600 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
          >
            <option value="all">Todas las categorías</option>
            {categories.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-600 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
          >
            <option value="all">Todos los estados</option>
            {STATUS_OPTIONS.map((status) => (
              <option key={status.value} value={status.value}>{status.label}</option>
            ))}
          </select>
        </div>
      </section>

      {canManage && (
        <section className="rounded-xl border border-emerald-100 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700">Dominios cerrados</p>
              <h3 className="mt-1 text-lg font-black text-slate-950">Catálogo de categorías del inventario</h3>
              <p className="mt-1 text-sm font-semibold leading-6 text-slate-500">
                Las categorías se crean aquí y luego se seleccionan en formularios o cargas masivas. Así evitamos duplicados como computador, computadores o equipo cómputo.
              </p>
            </div>
            <div className="flex w-full flex-col gap-2 sm:flex-row xl:max-w-lg">
              <input
                value={newCategoryName}
                onChange={(event) => setNewCategoryName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    handleAddCategory();
                  }
                }}
                className="h-11 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                placeholder="Nueva categoría cerrada"
                disabled={savingCategory}
              />
              <Button
                type="button"
                onClick={handleAddCategory}
                disabled={savingCategory}
                className="h-11 bg-emerald-600 font-black text-white hover:bg-emerald-700"
              >
                <Plus size={16} className="mr-2" />
                Crear
              </Button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {catalogCategories.map((category) => {
              const usageCount = categoryUsageCounts.get(normalizeKey(category)) || 0;
              const isBaseCategory = isDefaultInventoryCategory(category);
              const canRemoveCategory = !isBaseCategory && usageCount === 0 && !savingCategory;
              return (
                <span
                  key={category}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-black text-slate-700"
                >
                  {category}
                  <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-slate-400 ring-1 ring-slate-100">
                    {isBaseCategory ? 'base' : `${formatNumber(usageCount)} activos`}
                  </span>
                  {!isBaseCategory && (
                    <button
                      type="button"
                      onClick={() => handleRemoveCategory(category)}
                      disabled={!canRemoveCategory}
                      className="rounded-full p-0.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                      title={usageCount > 0 ? 'No se puede eliminar una categoría con activos asociados' : 'Eliminar categoría'}
                    >
                      <X size={12} />
                    </button>
                  )}
                </span>
              );
            })}
          </div>

          {uncataloguedCategories.length > 0 && (
            <div className="mt-4 flex flex-col gap-3 rounded-xl border border-amber-100 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-700">Categorías heredadas detectadas</p>
                <p className="mt-1 text-sm font-semibold text-amber-900">
                  Hay {formatNumber(uncataloguedCategories.length)} categoría(s) usadas por activos anteriores que aún no hacen parte del catálogo cerrado.
                </p>
                <p className="mt-1 text-xs font-bold text-amber-800">{uncataloguedCategories.join(', ')}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={handleRegisterUncataloguedCategories}
                disabled={savingCategory}
                className="border-amber-200 bg-white font-black text-amber-800 hover:bg-amber-100"
              >
                Incorporar al catálogo
              </Button>
            </div>
          )}
        </section>
      )}

      {isFormOpen && canManage && (
        <section className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-5 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-indigo-600">
                  {editingItem ? 'Editar activo' : 'Nuevo activo'}
                </p>
                <h3 className="mt-1 text-lg font-black text-slate-950">
                  {editingItem ? editingItem.name : 'Registrar elemento de inventario'}
                </h3>
              </div>
              <button type="button" onClick={resetForm} className="rounded-md p-2 text-slate-400 transition hover:bg-white hover:text-slate-700">
                <X size={18} />
              </button>
            </div>

            <div className="grid gap-4 lg:grid-cols-4">
              <Field label="Nombre del activo *" className="lg:col-span-2">
                <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className={inputClass} placeholder="Ej. Portátil Dell, silla ergonómica, mesa sala 1" />
              </Field>
              <Field label="Categoría">
                <select value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} className={inputClass}>
                  {formCategories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                      {!catalogCategories.some((catalogCategory) => normalizeKey(catalogCategory) === normalizeKey(category)) ? ' (heredada)' : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Cantidad">
                <input type="number" min={1} value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))} className={inputClass} />
              </Field>
              <Field label="Código interno">
                <input value={form.assetCode} onChange={(event) => setForm((current) => ({ ...current, assetCode: event.target.value }))} className={inputClass} placeholder="INV-001" />
              </Field>
              <Field label="Serial">
                <input value={form.serialNumber} onChange={(event) => setForm((current) => ({ ...current, serialNumber: event.target.value }))} className={inputClass} placeholder="Serial o placa" />
              </Field>
              <Field label="Responsable">
                <select value={form.responsibleId} onChange={(event) => setForm((current) => ({ ...current, responsibleId: event.target.value }))} className={inputClass}>
                  <option value="">Sin responsable</option>
                  {projectMembers.map((member) => (
                    <option key={member.id} value={member.id}>{member.name || member.email}</option>
                  ))}
                </select>
              </Field>
              <Field label="Valor unitario">
                <input value={form.estimatedValue} onChange={(event) => setForm((current) => ({ ...current, estimatedValue: formatMoneyInput(event.target.value) }))} className={inputClass} placeholder="0" />
              </Field>
              <Field label="Ubicación física" className="lg:col-span-2">
                <input value={form.location} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))} className={inputClass} placeholder="Bodega, oficina, ciudad, coordenadas..." />
              </Field>
              <Field label="Coordenadas del activo" className="lg:col-span-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    value={form.latitude}
                    onChange={(event) => setForm((current) => ({ ...current, latitude: event.target.value }))}
                    className={inputClass}
                    placeholder="Latitud"
                  />
                  <input
                    value={form.longitude}
                    onChange={(event) => setForm((current) => ({ ...current, longitude: event.target.value }))}
                    className={inputClass}
                    placeholder="Longitud"
                  />
                </div>
              </Field>
              <div className="lg:col-span-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Ubicar en mapa</p>
                  <p className="text-xs font-bold text-slate-500">Haz clic para fijar el punto del activo.</p>
                </div>
                <InventoryLocationMap
                  key={editingItem?.id || 'new-inventory-location'}
                  value={{
                    latitude: parseMapCoordinate(form.latitude) ?? undefined,
                    longitude: parseMapCoordinate(form.longitude) ?? undefined,
                  }}
                  onChange={(coordinate) => setForm((current) => ({
                    ...current,
                    latitude: coordinate.latitude.toFixed(6),
                    longitude: coordinate.longitude.toFixed(6),
                  }))}
                  heightClassName="h-72"
                  emptyLabel="Haz clic en el mapa para guardar latitud y longitud."
                />
              </div>
              <Field label="Estado">
                <select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))} className={inputClass}>
                  {STATUS_OPTIONS.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
                </select>
              </Field>
              <Field label="Condición">
                <select value={form.condition} onChange={(event) => setForm((current) => ({ ...current, condition: event.target.value }))} className={inputClass}>
                  {CONDITION_OPTIONS.map((condition) => <option key={condition.value} value={condition.value}>{condition.label}</option>)}
                </select>
              </Field>
              <Field label="Fecha de adquisición">
                <input type="date" value={form.acquisitionDate} onChange={(event) => setForm((current) => ({ ...current, acquisitionDate: event.target.value }))} className={inputClass} />
              </Field>
              <Field label="Fotos">
                <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-indigo-200 bg-white px-3 text-sm font-black text-indigo-700 transition hover:bg-indigo-50">
                  <Upload size={16} />
                  {photoFiles.length > 0 ? `${photoFiles.length} archivo(s)` : 'Subir fotos'}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(event) => setPhotoFiles(Array.from(event.target.files || []))}
                  />
                </label>
              </Field>
              <label className="flex items-center gap-3 rounded-lg border border-orange-100 bg-orange-50 px-3 py-3 text-sm font-black text-orange-800">
                <input
                  type="checkbox"
                  checked={form.needsRepair}
                  onChange={(event) => setForm((current) => ({ ...current, needsRepair: event.target.checked }))}
                  className="h-4 w-4 rounded border-orange-300 text-orange-600"
                />
                Requiere reparación
              </label>
              <Field label="Observaciones" className="lg:col-span-4">
                <textarea value={form.observations} onChange={(event) => setForm((current) => ({ ...current, observations: event.target.value }))} className={`${inputClass} min-h-24 resize-y py-3`} placeholder="Estado, accesorios, garantías, novedades o restricciones de uso." />
              </Field>
            </div>

            <div className="flex justify-end gap-2 border-t border-indigo-100 pt-4">
              <Button type="button" variant="outline" onClick={resetForm}>Cancelar</Button>
              <Button type="submit" disabled={saving} className="bg-indigo-600 font-black text-white hover:bg-indigo-700">
                {saving ? 'Guardando...' : editingItem ? 'Guardar cambios' : 'Crear activo'}
              </Button>
            </div>
          </form>
        </section>
      )}

      {isBulkImportOpen && canManage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
              <div>
                <p className="inline-flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-emerald-700 ring-1 ring-emerald-100">
                  <Upload size={14} />
                  Carga masiva de inventario
                </p>
                <h3 className="mt-3 text-2xl font-black tracking-tight text-slate-950">Importar activos por tabla</h3>
                <p className="mt-1 text-sm font-semibold text-slate-500">
                  Pega datos desde Excel, CSV o texto separado por comas. Las columnas con encabezado se detectan automáticamente.
                </p>
              </div>
              <button
                type="button"
                onClick={() => !bulkImporting && setIsBulkImportOpen(false)}
                className="rounded-md p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={bulkImporting}
              >
                <X size={22} />
              </button>
            </div>

            <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[1.4fr_.8fr]">
              <div className="space-y-4 border-b border-slate-200 p-5 lg:border-b-0 lg:border-r">
                <textarea
                  value={bulkImportText}
                  onChange={(event) => setBulkImportText(event.target.value)}
                  className="min-h-[360px] w-full resize-y rounded-xl border border-slate-200 bg-slate-950 p-4 font-mono text-sm font-semibold leading-6 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-400/10"
                  placeholder={BULK_IMPORT_SAMPLE}
                  disabled={bulkImporting}
                />
                <div className="rounded-xl border border-cyan-100 bg-cyan-50 p-4 text-sm font-semibold leading-6 text-cyan-900">
                  <p className="font-black">Columnas reconocidas</p>
                  <p className="mt-1">
                    nombre, categoria, codigo, serial, cantidad, ubicacion, latitud, longitud, responsable, estado, condicion, valor, observaciones, linkubicacion y reparacion.
                  </p>
                  <p className="mt-1">
                    La categoría debe existir en el catálogo cerrado del inventario. El responsable puede ser nombre o correo de una persona asignada al proyecto.
                  </p>
                </div>
              </div>

              <aside className="space-y-4 bg-slate-50 p-5">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700">Listos</p>
                    <p className="mt-2 text-3xl font-black text-emerald-900">{formatNumber(bulkPreview.validRows.length)}</p>
                  </div>
                  <div className="rounded-xl border border-red-100 bg-red-50 p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-red-700">Con error</p>
                    <p className="mt-2 text-3xl font-black text-red-900">{formatNumber(bulkPreview.invalidRows.length)}</p>
                  </div>
                </div>

                {bulkProgress.total > 0 && (
                  <div className="rounded-xl border border-indigo-100 bg-white p-4">
                    <div className="flex items-center justify-between text-xs font-black text-slate-500">
                      <span>Progreso</span>
                      <span>{formatNumber(bulkProgress.done)} / {formatNumber(bulkProgress.total)}</span>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all"
                        style={{ width: `${bulkProgress.total ? Math.round((bulkProgress.done / bulkProgress.total) * 100) : 0}%` }}
                      />
                    </div>
                  </div>
                )}

                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Vista previa</p>
                  <div className="mt-3 max-h-52 space-y-2 overflow-y-auto">
                    {bulkPreview.validRows.slice(0, 8).map((row, index) => (
                      <div key={`${row.name}-${index}`} className="rounded-lg bg-slate-50 px-3 py-2">
                        <p className="truncate text-sm font-black text-slate-900">{row.name}</p>
                        <p className="truncate text-xs font-bold text-slate-500">{row.category} · {row.assetCode || row.serialNumber || 'Sin código'}</p>
                      </div>
                    ))}
                    {bulkPreview.validRows.length === 0 && (
                      <p className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-sm font-semibold text-slate-500">
                        Pega una tabla para ver la vista previa.
                      </p>
                    )}
                  </div>
                </div>

                {bulkPreview.invalidRows.length > 0 && (
                  <div className="rounded-xl border border-red-100 bg-white p-4">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-red-500">Errores detectados</p>
                    <div className="mt-3 max-h-40 space-y-2 overflow-y-auto">
                      {bulkPreview.invalidRows.slice(0, 6).map((row) => (
                        <div key={`${row.line}-${row.raw}`} className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
                          Línea {row.line}: {row.reason}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </aside>
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs font-semibold text-slate-500">
                Cada activo importado queda con evento de creación en la hoja de vida.
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsBulkImportOpen(false)} disabled={bulkImporting}>
                  Cancelar
                </Button>
                <Button
                  type="button"
                  onClick={handleBulkImport}
                  disabled={bulkImporting || bulkPreview.validRows.length === 0}
                  className="bg-emerald-600 font-black text-white hover:bg-emerald-700"
                >
                  {bulkImporting ? 'Importando...' : `Importar ${formatNumber(bulkPreview.validRows.length)}`}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div>
            <h3 className="font-black text-slate-950">Activos registrados</h3>
            <p className="text-xs font-semibold text-slate-500">{formatNumber(filteredItems.length)} visibles de {formatNumber(items.length)} activos</p>
          </div>
          {stats.repairCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-3 py-1 text-xs font-black text-orange-700 ring-1 ring-orange-100">
              <AlertTriangle size={14} />
              {stats.repairCount} con novedad
            </span>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-14">
            <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-indigo-600" />
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="py-16 text-center">
            <Package className="mx-auto h-12 w-12 text-slate-300" />
            <h3 className="mt-3 text-lg font-black text-slate-950">No hay activos para mostrar</h3>
            <p className="mt-1 text-sm font-medium text-slate-500">Crea el primer activo o ajusta los filtros de búsqueda.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredItems.map((item) => {
              const status = getStatusMeta(item.status);
              const condition = getConditionMeta(item.condition);
              const firstPhoto = item.photos?.[0];
              return (
                <div key={item.id} className="grid gap-4 px-4 py-4 transition hover:bg-slate-50 xl:grid-cols-[minmax(320px,1.5fr)_repeat(4,minmax(120px,1fr))_auto] xl:items-center">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200">
                      {firstPhoto?.url ? (
                        <Image src={firstPhoto.url} alt={item.name || 'Activo'} fill className="object-cover" />
                      ) : (
                        <ImageIcon size={22} className="text-slate-400" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-base font-black text-slate-950">{item.name || 'Activo sin nombre'}</p>
                        {item.needsRepair && (
                          <span className="rounded bg-orange-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-orange-700 ring-1 ring-orange-100">
                            Reparación
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs font-bold text-slate-500">
                        {item.category || 'Sin categoría'} · {item.assetCode || item.serialNumber || 'Sin código'}
                      </p>
                      {hasMapCoordinates(item) && (
                        <span className="mt-2 inline-flex rounded bg-cyan-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-cyan-700 ring-1 ring-cyan-100">
                          Georreferenciado
                        </span>
                      )}
                    </div>
                  </div>

                  <MetricCell label="Responsable" value={getResponsibleLabel(item)} />
                  <MetricCell label="Ubicación" value={item.location || 'Sin ubicación'} />
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Estado</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <span className={`rounded px-2 py-1 text-xs font-black ring-1 ${status.className}`}>{status.label}</span>
                      <span className={`rounded px-2 py-1 text-xs font-black ring-1 ${condition.className}`}>{condition.label}</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Cantidad / Valor</p>
                    <p className="mt-1 text-sm font-black text-slate-950">{formatNumber(Number(item.quantity || 1))} unidad(es)</p>
                    <p className="text-xs font-bold text-slate-500">{formatCurrency(Number(item.estimatedValue || 0))}</p>
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setSelectedItem(item)} className="h-9 border-slate-200">
                      <Eye size={14} />
                      Detalle
                    </Button>
                    {canManage && (
                      <>
                        <button type="button" onClick={() => openEditForm(item)} className="rounded-md p-2 text-slate-400 transition hover:bg-indigo-50 hover:text-indigo-600" title="Editar">
                          <Pencil size={16} />
                        </button>
                        <button type="button" onClick={() => handleDelete(item)} className="rounded-md p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600" title="Eliminar">
                          <Trash2 size={16} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-indigo-600">Ficha de activo</p>
                <h3 className="truncate text-2xl font-black tracking-tight text-slate-950">{selectedItem.name || 'Activo'}</h3>
                <p className="mt-1 text-sm font-bold text-slate-500">{selectedItem.category || 'Sin categoría'} · {selectedItem.assetCode || selectedItem.serialNumber || 'Sin código'}</p>
              </div>
              <button type="button" onClick={() => setSelectedItem(null)} className="rounded-md p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
                <X size={22} />
              </button>
            </div>

            <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[0.9fr_1.1fr]">
              <div className="border-b border-slate-200 p-5 lg:border-b-0 lg:border-r">
                <div className="grid grid-cols-2 gap-2">
                  {(selectedItem.photos || []).length === 0 ? (
                    <div className="col-span-2 flex min-h-64 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                      <Camera size={42} />
                    </div>
                  ) : (
                    (selectedItem.photos || []).slice(0, 4).map((photo, index) => (
                      <div key={`${photo.storagePath}-${index}`} className={`relative overflow-hidden rounded-xl bg-slate-100 ${index === 0 ? 'col-span-2 h-64' : 'h-28'}`}>
                        <Image src={photo.url} alt={photo.name || selectedItem.name || 'Foto'} fill className="object-cover" />
                      </div>
                    ))
                  )}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <InfoTile label="Responsable" value={getResponsibleLabel(selectedItem)} icon={<User size={16} />} />
                  <InfoTile label="Cantidad" value={formatNumber(Number(selectedItem.quantity || 1))} icon={<Package size={16} />} />
                  <InfoTile label="Valor unitario" value={formatCurrency(Number(selectedItem.estimatedValue || 0))} icon={<DollarSign size={16} />} />
                  <InfoTile label="Adquisición" value={formatDate(selectedItem.acquisitionDate)} icon={<Calendar size={16} />} />
                </div>

                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <h4 className="flex items-center gap-2 text-sm font-black text-slate-950">
                    <MapPin size={16} className="text-indigo-600" />
                    Localización
                  </h4>
                  <p className="mt-2 text-sm font-semibold text-slate-600">{selectedItem.location || 'Sin ubicación registrada.'}</p>
                  {hasMapCoordinates(selectedItem) && (
                    <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
                      <InventoryLocationMap
                        key={`detail-${selectedItem.id}`}
                        value={{
                          latitude: parseMapCoordinate(selectedItem.latitude) ?? undefined,
                          longitude: parseMapCoordinate(selectedItem.longitude) ?? undefined,
                        }}
                        heightClassName="h-56"
                        emptyLabel="Activo sin punto geográfico."
                      />
                      <p className="border-t border-slate-100 px-3 py-2 text-xs font-bold text-slate-500">
                        Lat {parseMapCoordinate(selectedItem.latitude)?.toFixed(6)} · Lng {parseMapCoordinate(selectedItem.longitude)?.toFixed(6)}
                      </p>
                    </div>
                  )}
                  {selectedItem.mapUrl && (
                    <a href={selectedItem.mapUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-sm font-black text-indigo-700 hover:text-indigo-900">
                      Abrir ubicación
                    </a>
                  )}
                </div>

                {selectedItem.observations && (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
                    <h4 className="text-sm font-black text-slate-950">Observaciones</h4>
                    <p className="mt-2 whitespace-pre-wrap text-sm font-medium leading-6 text-slate-600">{selectedItem.observations}</p>
                  </div>
                )}
              </div>

              <div className="p-5">
                <div className="flex flex-wrap gap-2">
                  <span className={`rounded px-3 py-1.5 text-xs font-black ring-1 ${getStatusMeta(selectedItem.status).className}`}>
                    {getStatusMeta(selectedItem.status).label}
                  </span>
                  <span className={`rounded px-3 py-1.5 text-xs font-black ring-1 ${getConditionMeta(selectedItem.condition).className}`}>
                    {getConditionMeta(selectedItem.condition).label}
                  </span>
                  {selectedItem.needsRepair && (
                    <span className="rounded bg-orange-50 px-3 py-1.5 text-xs font-black text-orange-700 ring-1 ring-orange-100">
                      Requiere reparación
                    </span>
                  )}
                </div>

                {canManage && (
                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    <button
                      type="button"
                      onClick={() => openAssetAction('reassign')}
                      className="flex items-center justify-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-700 transition hover:bg-indigo-100"
                    >
                      <User size={15} />
                      Reasignar
                    </button>
                    <button
                      type="button"
                      onClick={() => openAssetAction('transfer')}
                      className="flex items-center justify-center gap-2 rounded-lg border border-violet-100 bg-violet-50 px-3 py-2 text-xs font-black text-violet-700 transition hover:bg-violet-100"
                    >
                      <ArrowRightLeft size={15} />
                      Trasladar
                    </button>
                    <button
                      type="button"
                      onClick={() => openAssetAction('retire')}
                      className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-100"
                    >
                      <Archive size={15} />
                      Dar de baja
                    </button>
                  </div>
                )}

                <section className="mt-5 rounded-xl border border-slate-200 bg-white">
                  <div className="border-b border-slate-100 p-4">
                    <h4 className="flex items-center gap-2 text-lg font-black text-slate-950">
                      <ClipboardList size={18} className="text-indigo-600" />
                      Hoja de vida
                    </h4>
                    <p className="mt-1 text-sm font-medium text-slate-500">Creación, importación, reasignaciones, traslados, bajas, intervenciones y novedades.</p>
                  </div>

                  <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
                    {getLifecycleEntries(selectedItem).length === 0 ? (
                      <div className="p-6 text-center text-sm font-medium text-slate-500">Sin eventos registrados.</div>
                    ) : (
                      getLifecycleEntries(selectedItem)
                        .map((entry) => (
                          <div key={entry.id} className="p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <span className={`rounded px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ring-1 ${getLifecycleTone(entry.type)}`}>
                                  {getLifecycleLabel(entry.type)}
                                </span>
                                <p className="mt-2 text-sm font-black text-slate-950">{entry.title}</p>
                                <p className="mt-1 text-sm font-semibold leading-5 text-slate-600">{entry.description}</p>
                                <p className="mt-1 text-xs font-bold text-slate-500">
                                  {formatDate(entry.date)}
                                  {entry.actorEmail ? ` · ${entry.actorEmail}` : ''}
                                  {entry.from || entry.to ? ` · ${entry.from || 'Sin origen'} → ${entry.to || 'Sin destino'}` : ''}
                                </p>
                              </div>
                              {entry.type === 'maintenance' && <CheckCircle2 size={18} className="text-emerald-600" />}
                            </div>
                            {entry.metadata?.result && <p className="mt-2 text-xs font-semibold text-slate-500">{entry.metadata.result}</p>}
                            {Number(entry.metadata?.cost || 0) > 0 && (
                              <p className="mt-2 text-xs font-black text-slate-700">Costo: {formatCurrency(Number(entry.metadata?.cost || 0))}</p>
                            )}
                          </div>
                        ))
                    )}
                  </div>
                </section>

                {assetActionForm && canManage && (
                  <form onSubmit={handleAssetLifecycleSubmit} className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                          {assetActionForm.action === 'reassign' ? 'Reasignación' : assetActionForm.action === 'transfer' ? 'Traslado de proyecto' : 'Baja de activo'}
                        </p>
                        <h4 className="mt-1 text-base font-black text-slate-950">
                          Registrar acción patrimonial
                        </h4>
                      </div>
                      <button type="button" onClick={() => setAssetActionForm(null)} className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-slate-700">
                        <X size={17} />
                      </button>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <input
                        type="date"
                        value={assetActionForm.date}
                        onChange={(event) => setAssetActionForm((current) => current ? ({ ...current, date: event.target.value }) : current)}
                        className={inputClass}
                      />
                      {assetActionForm.action === 'reassign' && (
                        <select
                          value={assetActionForm.responsibleId}
                          onChange={(event) => setAssetActionForm((current) => current ? ({ ...current, responsibleId: event.target.value }) : current)}
                          className={inputClass}
                        >
                          <option value="">Seleccionar nuevo responsable</option>
                          {projectMembers.map((member) => (
                            <option key={member.id} value={member.id}>{member.name || member.email}</option>
                          ))}
                        </select>
                      )}
                      {assetActionForm.action === 'transfer' && (
                        <>
                          <input
                            value={assetActionForm.targetProject}
                            onChange={(event) => setAssetActionForm((current) => current ? ({ ...current, targetProject: event.target.value }) : current)}
                            className={inputClass}
                            placeholder="Proyecto destino"
                          />
                          <input
                            value={assetActionForm.targetLocation}
                            onChange={(event) => setAssetActionForm((current) => current ? ({ ...current, targetLocation: event.target.value }) : current)}
                            className={inputClass}
                            placeholder="Nueva ubicación física"
                          />
                        </>
                      )}
                      <textarea
                        value={assetActionForm.reason}
                        onChange={(event) => setAssetActionForm((current) => current ? ({ ...current, reason: event.target.value }) : current)}
                        className={`${inputClass} min-h-20 resize-y py-3 md:col-span-2`}
                        placeholder={assetActionForm.action === 'retire' ? 'Motivo obligatorio de la baja' : 'Argumento o contexto de la acción'}
                      />
                    </div>
                    <div className="mt-3 flex justify-end gap-2">
                      <Button type="button" variant="outline" onClick={() => setAssetActionForm(null)} disabled={savingAssetAction}>
                        Cancelar
                      </Button>
                      <Button type="submit" disabled={savingAssetAction} className="bg-slate-950 font-black text-white hover:bg-slate-800">
                        {savingAssetAction ? 'Guardando...' : 'Guardar en hoja de vida'}
                      </Button>
                    </div>
                  </form>
                )}

                {canManage && (
                  <form onSubmit={handleMaintenanceSubmit} className="mt-5 rounded-xl border border-indigo-100 bg-indigo-50/30 p-4">
                    <h4 className="flex items-center gap-2 text-sm font-black text-slate-950">
                      <Wrench size={16} className="text-indigo-600" />
                      Registrar novedad
                    </h4>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <select value={maintenanceForm.type} onChange={(event) => setMaintenanceForm((current) => ({ ...current, type: event.target.value }))} className={inputClass}>
                        <option value="reparacion">Reparación</option>
                        <option value="inspeccion">Inspección</option>
                        <option value="traslado">Traslado</option>
                        <option value="mantenimiento">Mantenimiento</option>
                        <option value="novedad">Novedad</option>
                      </select>
                      <input type="date" value={maintenanceForm.date} onChange={(event) => setMaintenanceForm((current) => ({ ...current, date: event.target.value }))} className={inputClass} />
                      <input value={maintenanceForm.technician} onChange={(event) => setMaintenanceForm((current) => ({ ...current, technician: event.target.value }))} className={inputClass} placeholder="Responsable o proveedor" />
                      <input value={maintenanceForm.cost} onChange={(event) => setMaintenanceForm((current) => ({ ...current, cost: formatMoneyInput(event.target.value) }))} className={inputClass} placeholder="Costo" />
                      <textarea value={maintenanceForm.description} onChange={(event) => setMaintenanceForm((current) => ({ ...current, description: event.target.value }))} className={`${inputClass} min-h-20 resize-y py-3 md:col-span-2`} placeholder="Qué pasó, qué se reparó o qué novedad se encontró." />
                      <input value={maintenanceForm.result} onChange={(event) => setMaintenanceForm((current) => ({ ...current, result: event.target.value }))} className={`${inputClass} md:col-span-2`} placeholder="Resultado o recomendación" />
                    </div>
                    <div className="mt-3 flex justify-end">
                      <Button type="submit" disabled={savingMaintenance} className="bg-indigo-600 font-black text-white hover:bg-indigo-700">
                        {savingMaintenance ? 'Guardando...' : 'Agregar a hoja de vida'}
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function getLifecycleLabel(type: LifecycleEventType) {
  const labels: Record<LifecycleEventType, string> = {
    created: 'Creación',
    imported: 'Importación',
    updated: 'Actualización',
    reassigned: 'Reasignación',
    transferred: 'Traslado',
    retired: 'Baja',
    maintenance: 'Mantenimiento',
  };
  return labels[type] || 'Novedad';
}

function getLifecycleTone(type: LifecycleEventType) {
  const tones: Record<LifecycleEventType, string> = {
    created: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    imported: 'bg-cyan-50 text-cyan-700 ring-cyan-100',
    updated: 'bg-slate-100 text-slate-700 ring-slate-200',
    reassigned: 'bg-indigo-50 text-indigo-700 ring-indigo-100',
    transferred: 'bg-violet-50 text-violet-700 ring-violet-100',
    retired: 'bg-red-50 text-red-700 ring-red-100',
    maintenance: 'bg-orange-50 text-orange-700 ring-orange-100',
  };
  return tones[type] || tones.updated;
}

const inputClass =
  'h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 disabled:bg-slate-50';

function Field({
  label,
  children,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`space-y-1.5 ${className}`}>
      <span className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className="mt-1 truncate text-sm font-black text-slate-700">{value}</p>
    </div>
  );
}

function InfoTile({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-2 text-slate-400">{icon}</div>
      <p className="mt-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className="mt-1 break-words text-sm font-black text-slate-950">{value}</p>
    </div>
  );
}
