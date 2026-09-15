"use client"

import React, { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  BriefcaseBusiness,
  Camera,
  Download,
  Eye,
  ImageIcon,
  Layers3,
  MapPin,
  PackageSearch,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  User,
  Wrench,
  X,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import {
  addDoc,
  arrayUnion,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
} from '@/lib/supabase/document-store';
import { auth, db } from '@/lib/backend';
import { useAuth } from '@/hooks/useAuth';
import { useRolePermissions } from '@/hooks/useRolePermissions';
import { belongsToAnyOrganization, organizationNameFor } from '@/lib/organizations';
import {
  InventoryLocationMap,
  InventoryMapPoint,
  hasMapCoordinates,
  parseMapCoordinate,
} from '@/components/inventory/InventoryLocationMap';
import { toast } from 'sonner';
import { normalizeDecimalInput } from '@/lib/rate-card-config';

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
};

type InventoryPhoto = {
  name?: string;
  url?: string;
  storagePath?: string;
};

type MaintenanceEntry = {
  id?: string;
  type?: string;
  date?: any;
  title?: string;
  description?: string;
  technician?: string;
  cost?: number;
  result?: string;
  actorEmail?: string;
  createdAt?: any;
};

type InventoryItem = {
  id: string;
  projectId: string;
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
  acquisitionDate?: any;
  estimatedValue?: number;
  observations?: string;
  needsRepair?: boolean;
  photos?: InventoryPhoto[];
  maintenanceHistory?: MaintenanceEntry[];
  lifecycleHistory?: MaintenanceEntry[];
  createdAt?: any;
  updatedAt?: any;
};

type InventoryForm = {
  projectId: string;
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

const ACCESS_ROLES = new Set(['admin', 'org_admin', 'manager']);

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

const compactNumber = (value: number) => new Intl.NumberFormat('es-CO').format(Number.isFinite(value) ? value : 0);

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? Math.round(value) : 0);

const getDate = (value: any): Date | null => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getTime = (value: any) => getDate(value)?.getTime() || 0;

const formatDate = (value: any) => {
  const date = getDate(value);
  if (!date) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
};

const toDateInput = (value: any) => {
  const date = getDate(value);
  return date ? date.toISOString().split('T')[0] : '';
};

const csvEscape = (value: any) => `"${String(value ?? '').replace(/"/g, '""')}"`;

const normalizeEmail = (value: any) => String(value || '').trim().toLowerCase();

const emptyInventoryForm = (projectId = ''): InventoryForm => ({
  projectId,
  name: '',
  category: '',
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
});

const createLifecycleEntry = (
  type: string,
  title: string,
  description: string,
  user: any,
  metadata: Record<string, any> = {}
) => ({
  id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
  type,
  date: new Date().toISOString(),
  title,
  description,
  actorId: user?.uid || null,
  actorEmail: user?.email || null,
  metadata,
  createdAt: new Date().toISOString(),
});

const getProjectIdFromSnapshot = (snapshotDoc: any, data: any) => {
  if (data?.projectId) return data.projectId;
  const path = snapshotDoc?.ref?.path || '';
  const segments = path.split('/');
  const projectIndex = segments.indexOf('projects');
  return projectIndex >= 0 ? segments[projectIndex + 1] || '' : '';
};

const getStatusMeta = (value?: string) =>
  STATUS_OPTIONS.find((status) => status.value === value) || STATUS_OPTIONS[0];

const getConditionMeta = (value?: string) =>
  CONDITION_OPTIONS.find((condition) => condition.value === value) || CONDITION_OPTIONS[1];

const isRepairAsset = (item: InventoryItem) =>
  Boolean(item.needsRepair || item.status === 'repair' || item.condition === 'damaged');

const getInventoryHistory = (item: InventoryItem) =>
  [...(item.lifecycleHistory || []), ...(item.maintenanceHistory || [])].sort(
    (left, right) => getTime(right.date || right.createdAt) - getTime(left.date || left.createdAt)
  );

const getResponsibleLabel = (item: InventoryItem, membersById: Map<string, any>) => {
  const member = item.responsibleId ? membersById.get(item.responsibleId) : null;
  return item.responsibleName || member?.name || member?.displayName || member?.email || 'Sin responsable';
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
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">{label}</p>
          <p className="mt-2 truncate text-2xl font-black tracking-tight text-slate-950">{value}</p>
          <p className="mt-1 text-sm font-bold text-slate-500">{detail}</p>
        </div>
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ring-1 ${tone}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

export default function InventoryOverviewPage() {
  const { user, userRole, userOrganizationId, userOrganizationIds } = useAuth();
  const { permissions: rolePermissions } = useRolePermissions(userRole);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [inventoryModalMode, setInventoryModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingInventoryItem, setEditingInventoryItem] = useState<InventoryItem | null>(null);
  const [inventoryForm, setInventoryForm] = useState<InventoryForm>(emptyInventoryForm());
  const [savingInventory, setSavingInventory] = useState(false);

  const managedOrganizationIds = useMemo(
    () => (userOrganizationIds.length > 0 ? userOrganizationIds : userOrganizationId ? [userOrganizationId] : []),
    [userOrganizationId, userOrganizationIds]
  );

  const canAccessInventory = ACCESS_ROLES.has(userRole || '') && rolePermissions.inventoryOverview;
  const canManageInventory = canAccessInventory && rolePermissions.inventoryProjectManage;
  const canSeeAllOrganizations = userRole === 'admin' && managedOrganizationIds.length === 0;

  useEffect(() => {
    if (!user || !canAccessInventory) return;

    const unsubscribeOrganizations = onSnapshot(
      query(collection(db, 'organizations')),
      (snapshot) => setOrganizations(snapshot.docs.map((orgDoc) => ({ id: orgDoc.id, ...orgDoc.data() }))),
      (error) => console.error('Error loading inventory organizations:', error)
    );

    const unsubscribeProjects = onSnapshot(
      query(collection(db, 'projects')),
      (snapshot) => {
        const data = snapshot.docs.map((projectDoc) => ({ id: projectDoc.id, ...projectDoc.data() } as ProjectRow));
        data.sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')));
        setProjects(data);
        setLoading(false);
      },
      (error) => {
        console.error('Error loading inventory projects:', error);
        setLoading(false);
      }
    );

    const unsubscribeTeam = onSnapshot(
      query(collection(db, 'team_members')),
      (snapshot) => setTeamMembers(snapshot.docs.map((memberDoc) => ({ id: memberDoc.id, ...memberDoc.data() }))),
      (error) => console.error('Error loading inventory team members:', error)
    );

    const unsubscribeInventory = onSnapshot(
      query(collectionGroup(db, 'inventoryItems')),
      (snapshot) => {
        const data = snapshot.docs.map((inventoryDoc) => {
          const itemData = inventoryDoc.data();
          return {
            id: inventoryDoc.id,
            projectId: getProjectIdFromSnapshot(inventoryDoc, itemData),
            ...itemData,
          } as InventoryItem;
        });
        setInventoryItems(data);
      },
      (error) => console.error('Error loading global inventory:', error)
    );

    return () => {
      unsubscribeOrganizations();
      unsubscribeProjects();
      unsubscribeTeam();
      unsubscribeInventory();
    };
  }, [canAccessInventory, user]);

  const currentUserIds = useMemo(() => buildUserIds(user, teamMembers), [teamMembers, user]);
  const membersById = useMemo(() => new Map(teamMembers.map((member) => [member.id, member])), [teamMembers]);

  const scopedProjects = useMemo(() => {
    return projects.filter((project) => {
      if (canSeeAllOrganizations) return true;

      const projectInManagedOrg = managedOrganizationIds.length > 0 && belongsToAnyOrganization(project, managedOrganizationIds);
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
  }, [canSeeAllOrganizations, currentUserIds, managedOrganizationIds, projects, user?.email, user?.uid, userRole]);

  const scopedProjectIds = useMemo(() => new Set(scopedProjects.map((project) => project.id)), [scopedProjects]);
  const projectById = useMemo(() => new Map(scopedProjects.map((project) => [project.id, project])), [scopedProjects]);

  const categories = useMemo(() => {
    const values = new Set(inventoryItems.filter((item) => scopedProjectIds.has(item.projectId)).map((item) => item.category).filter(Boolean) as string[]);
    return Array.from(values).sort((left, right) => left.localeCompare(right));
  }, [inventoryItems, scopedProjectIds]);

  const inventoryFormCategories = useMemo(() => {
    const values = new Set(categories);
    inventoryItems.forEach((item) => {
      if (scopedProjectIds.has(item.projectId) && item.category) values.add(item.category);
    });
    return Array.from(values).sort((left, right) => left.localeCompare(right));
  }, [categories, inventoryItems, scopedProjectIds]);

  const responsibleOptions = useMemo(
    () =>
      [...teamMembers].sort((left, right) =>
        String(left.name || left.displayName || left.email || '').localeCompare(String(right.name || right.displayName || right.email || ''))
      ),
    [teamMembers]
  );

  const visibleItems = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();

    return inventoryItems
      .filter((item) => scopedProjectIds.has(item.projectId))
      .filter((item) => selectedProjectId === 'all' || item.projectId === selectedProjectId)
      .filter((item) => statusFilter === 'all' || (statusFilter === 'repair' ? isRepairAsset(item) : item.status === statusFilter))
      .filter((item) => categoryFilter === 'all' || item.category === categoryFilter)
      .filter((item) => {
        if (!search) return true;
        const project = projectById.get(item.projectId);
        return [
          item.name,
          item.category,
          item.assetCode,
          item.serialNumber,
          item.location,
          item.latitude,
          item.longitude,
          item.observations,
          getResponsibleLabel(item, membersById),
          project?.name,
          organizationNameFor(project || {}, organizations),
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(search));
      })
      .sort((left, right) => getTime(right.updatedAt || right.createdAt) - getTime(left.updatedAt || left.createdAt));
  }, [categoryFilter, inventoryItems, membersById, organizations, projectById, scopedProjectIds, searchTerm, selectedProjectId, statusFilter]);

  const geolocatedItems = useMemo(() => visibleItems.filter(hasMapCoordinates), [visibleItems]);

  const mapPoints = useMemo<InventoryMapPoint[]>(
    () =>
      geolocatedItems.map((item) => {
        const project = projectById.get(item.projectId);
        return {
          id: `${item.projectId}::${item.id}`,
          label: item.name || 'Activo',
          latitude: item.latitude,
          longitude: item.longitude,
          tone: isRepairAsset(item)
            ? 'bg-orange-600'
            : item.status === 'retired'
              ? 'bg-slate-500'
              : item.status === 'transferred'
                ? 'bg-violet-600'
                : item.status === 'lost'
                  ? 'bg-red-600'
                  : 'bg-emerald-600',
          meta: project?.name || item.projectId,
        };
      }),
    [geolocatedItems, projectById]
  );

  const selectedItem = useMemo(
    () =>
      selectedItemKey
        ? visibleItems.find((item) => `${item.projectId}::${item.id}` === selectedItemKey) ||
          inventoryItems.find((item) => `${item.projectId}::${item.id}` === selectedItemKey) ||
          null
        : null,
    [inventoryItems, selectedItemKey, visibleItems]
  );

  const stats = useMemo(() => {
    const totalUnits = visibleItems.reduce((sum, item) => sum + Math.max(Number(item.quantity || 0), 0), 0);
    const totalValue = visibleItems.reduce(
      (sum, item) => sum + Math.max(Number(item.quantity || 1), 1) * Math.max(Number(item.estimatedValue || 0), 0),
      0
    );
    const repairCount = visibleItems.filter(isRepairAsset).length;
    const locations = new Set(visibleItems.map((item) => item.location).filter(Boolean));
    const responsibleCount = new Set(visibleItems.map((item) => item.responsibleId || item.responsibleName).filter(Boolean)).size;
    const projectsWithInventory = new Set(visibleItems.map((item) => item.projectId).filter(Boolean)).size;

    return { totalUnits, totalValue, repairCount, locations: locations.size, responsibleCount, projectsWithInventory };
  }, [visibleItems]);

  const locationRows = useMemo(() => {
    const rows = new Map<string, { location: string; units: number; assets: number; repair: number }>();
    visibleItems.forEach((item) => {
      const key = item.location || 'Sin ubicación';
      const row = rows.get(key) || { location: key, units: 0, assets: 0, repair: 0 };
      row.assets += 1;
      row.units += Math.max(Number(item.quantity || 0), 0);
      if (isRepairAsset(item)) row.repair += 1;
      rows.set(key, row);
    });

    return Array.from(rows.values()).sort((left, right) => right.units - left.units || left.location.localeCompare(right.location)).slice(0, 6);
  }, [visibleItems]);

  const downloadCsvReport = () => {
    const headers = ['Proyecto', 'Organización', 'Activo', 'Categoría', 'Código', 'Serial', 'Cantidad', 'Responsable', 'Ubicación', 'Latitud', 'Longitud', 'Estado', 'Condición', 'Valor unitario', 'Requiere reparación', 'Observaciones'];
    const csv = [
      headers.map(csvEscape).join(','),
      ...visibleItems.map((item) => {
        const project = projectById.get(item.projectId);
        return [
          project?.name || item.projectId,
          organizationNameFor(project || {}, organizations),
          item.name || '',
          item.category || '',
          item.assetCode || '',
          item.serialNumber || '',
          item.quantity || 1,
          getResponsibleLabel(item, membersById),
          item.location || '',
          item.latitude ?? '',
          item.longitude ?? '',
          getStatusMeta(item.status).label,
          getConditionMeta(item.condition).label,
          item.estimatedValue || 0,
          isRepairAsset(item) ? 'Si' : 'No',
          item.observations || '',
        ].map(csvEscape).join(',');
      }),
    ].join('\n');

    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `inventario-global-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const openCreateInventoryModal = () => {
    if (!canManageInventory) return;
    const defaultProjectId = selectedProjectId !== 'all' ? selectedProjectId : visibleItems[0]?.projectId || scopedProjects[0]?.id || '';
    if (!defaultProjectId) {
      toast.error('No tienes proyectos disponibles para crear activos');
      return;
    }

    setEditingInventoryItem(null);
    setInventoryForm(emptyInventoryForm(defaultProjectId));
    setInventoryModalMode('create');
  };

  const openEditInventoryModal = (item: InventoryItem) => {
    if (!canManageInventory) return;
    setEditingInventoryItem(item);
    setInventoryForm({
      projectId: item.projectId,
      name: item.name || '',
      category: item.category || '',
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
      acquisitionDate: toDateInput(item.acquisitionDate),
      estimatedValue: item.estimatedValue !== undefined ? String(item.estimatedValue) : '',
      observations: item.observations || '',
      needsRepair: Boolean(item.needsRepair),
    });
    setInventoryModalMode('edit');
  };

  const closeInventoryModal = () => {
    setInventoryModalMode(null);
    setEditingInventoryItem(null);
    setSavingInventory(false);
  };

  const handleInventorySubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!auth.currentUser || !canManageInventory || !inventoryForm.projectId) return;

    const project = projectById.get(inventoryForm.projectId);
    const previousProject = editingInventoryItem ? projectById.get(editingInventoryItem.projectId) : null;
    const responsible = responsibleOptions.find((member) => member.id === inventoryForm.responsibleId);
    const quantity = Math.max(normalizeDecimalInput(inventoryForm.quantity, 1), 1);
    const latitude = parseMapCoordinate(inventoryForm.latitude);
    const longitude = parseMapCoordinate(inventoryForm.longitude);
    const payload = {
      projectId: inventoryForm.projectId,
      name: inventoryForm.name.trim(),
      category: inventoryForm.category.trim(),
      assetCode: inventoryForm.assetCode.trim(),
      serialNumber: inventoryForm.serialNumber.trim(),
      quantity,
      location: inventoryForm.location.trim(),
      mapUrl: inventoryForm.mapUrl.trim(),
      latitude,
      longitude,
      responsibleId: inventoryForm.responsibleId || '',
      responsibleName: responsible?.name || responsible?.displayName || responsible?.email || '',
      condition: inventoryForm.condition,
      status: inventoryForm.status,
      acquisitionDate: inventoryForm.acquisitionDate ? new Date(inventoryForm.acquisitionDate) : null,
      estimatedValue: normalizeDecimalInput(inventoryForm.estimatedValue, 0),
      observations: inventoryForm.observations.trim(),
      needsRepair: Boolean(inventoryForm.needsRepair || inventoryForm.status === 'repair' || inventoryForm.condition === 'damaged'),
      updatedAt: serverTimestamp(),
    };

    setSavingInventory(true);
    try {
      if (editingInventoryItem) {
        const transferred = editingInventoryItem.projectId !== inventoryForm.projectId;
        if (transferred) {
          await addDoc(collection(db, `projects/${inventoryForm.projectId}/inventoryItems`), {
            ...editingInventoryItem,
            ...payload,
            photos: editingInventoryItem.photos || [],
            maintenanceHistory: editingInventoryItem.maintenanceHistory || [],
            lifecycleHistory: [
              ...(editingInventoryItem.lifecycleHistory || []),
              createLifecycleEntry(
                'transferred',
                'Activo trasladado entre proyectos',
                `Trasladado desde ${previousProject?.name || editingInventoryItem.projectId} hacia ${project?.name || inventoryForm.projectId}.`,
                auth.currentUser,
                { fromProjectId: editingInventoryItem.projectId, toProjectId: inventoryForm.projectId }
              ),
            ],
            createdAt: editingInventoryItem.createdAt || serverTimestamp(),
          });
          await deleteDoc(doc(db, `projects/${editingInventoryItem.projectId}/inventoryItems`, editingInventoryItem.id));
          toast.success('Activo trasladado y actualizado');
        } else {
          await updateDoc(doc(db, `projects/${editingInventoryItem.projectId}/inventoryItems`, editingInventoryItem.id), {
            ...payload,
            lifecycleHistory: arrayUnion(
              createLifecycleEntry(
                'updated',
                'Activo actualizado desde inventario global',
                `Actualizado en ${project?.name || inventoryForm.projectId}.`,
                auth.currentUser
              )
            ),
          });
          toast.success('Activo actualizado');
        }
      } else {
        await addDoc(collection(db, `projects/${inventoryForm.projectId}/inventoryItems`), {
          ...payload,
          photos: [],
          maintenanceHistory: [],
          lifecycleHistory: [
            createLifecycleEntry(
              'created',
              'Activo creado desde inventario global',
              `Registrado en ${project?.name || inventoryForm.projectId}.`,
              auth.currentUser
            ),
          ],
          createdAt: serverTimestamp(),
          createdBy: auth.currentUser.uid,
        });
        toast.success('Activo creado');
      }
      closeInventoryModal();
    } catch (error) {
      console.error('Error saving global inventory item:', error);
      toast.error('No se pudo guardar el activo');
      setSavingInventory(false);
    }
  };

  const handleDeleteInventoryItem = async (item: InventoryItem) => {
    if (!canManageInventory || !confirm(`¿Eliminar "${item.name || 'este activo'}" del inventario?`)) return;

    try {
      await deleteDoc(doc(db, `projects/${item.projectId}/inventoryItems`, item.id));
      toast.success('Activo eliminado');
      if (selectedItemKey === `${item.projectId}::${item.id}`) setSelectedItemKey(null);
    } catch (error) {
      console.error('Error deleting global inventory item:', error);
      toast.error('No se pudo eliminar el activo');
    }
  };

  if (!canAccessInventory) {
    return (
      <DashboardLayout>
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
          <ShieldCheck className="mx-auto h-12 w-12 text-slate-300" />
          <h1 className="mt-4 text-2xl font-black text-slate-950">Acceso restringido</h1>
          <p className="mx-auto mt-2 max-w-xl text-sm font-medium text-slate-500">
            El inventario global está disponible para gerentes, administradores de organización y administradores globales con el permiso activo.
          </p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="relative border-b border-slate-100 bg-slate-950 px-5 py-6 text-white">
            <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(90deg,rgba(255,255,255,.08)_1px,transparent_1px),linear-gradient(rgba(255,255,255,.08)_1px,transparent_1px)] [background-size:24px_24px]" />
            <div className="relative flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="max-w-4xl">
                <div className="inline-flex items-center gap-2 rounded bg-cyan-400/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-cyan-200 ring-1 ring-cyan-300/20">
                  <Sparkles size={14} />
                  Control patrimonial inteligente
                </div>
                <h1 className="mt-3 text-3xl font-black tracking-tight">Inventario global</h1>
                <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-300">
                  Visualiza los activos de tus proyectos, dónde están, quién responde por ellos y cuáles requieren atención operativa.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={downloadCsvReport} disabled={visibleItems.length === 0} className="h-11 bg-cyan-400 font-black text-slate-950 hover:bg-cyan-300">
                  <Download size={16} className="mr-2" />
                  Exportar inventario
                </Button>
                {canManageInventory && (
                  <Button type="button" onClick={openCreateInventoryModal} className="h-11 bg-white font-black text-slate-950 hover:bg-slate-100">
                    <Plus size={16} className="mr-2" />
                    Nuevo activo
                  </Button>
                )}
              </div>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard label="Unidades" value={compactNumber(stats.totalUnits)} detail={`${compactNumber(visibleItems.length)} activos visibles`} icon={<PackageSearch size={21} />} tone="bg-indigo-50 text-indigo-700 ring-indigo-100" />
          <MetricCard label="Valor estimado" value={formatCurrency(stats.totalValue)} detail="Total inventariado" icon={<BriefcaseBusiness size={21} />} tone="bg-emerald-50 text-emerald-700 ring-emerald-100" />
          <MetricCard label="Ubicaciones" value={compactNumber(stats.locations)} detail={`${compactNumber(geolocatedItems.length)} con coordenadas`} icon={<MapPin size={21} />} tone="bg-cyan-50 text-cyan-700 ring-cyan-100" />
          <MetricCard label="Responsables" value={compactNumber(stats.responsibleCount)} detail="Personas con activos" icon={<User size={21} />} tone="bg-violet-50 text-violet-700 ring-violet-100" />
          <MetricCard label="Reparación" value={compactNumber(stats.repairCount)} detail="Activos con novedad" icon={<Wrench size={21} />} tone="bg-orange-50 text-orange-700 ring-orange-100" />
        </div>

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 xl:grid-cols-[1fr_220px_200px_200px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Buscar activo, responsable, ubicación, proyecto, serial o código..."
                className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
              />
            </div>
            <select
              value={selectedProjectId}
              onChange={(event) => setSelectedProjectId(event.target.value)}
              className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-600 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
            >
              <option value="all">Todos los proyectos</option>
              {scopedProjects.map((project) => (
                <option key={project.id} value={project.id}>{project.name || project.id}</option>
              ))}
            </select>
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

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-black text-slate-950">
                <MapPin size={19} className="text-indigo-600" />
                Mapa global de activos
              </h2>
              <p className="mt-1 text-xs font-bold text-slate-500">
                {compactNumber(geolocatedItems.length)} activos con coordenadas dentro de los filtros actuales.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded bg-emerald-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-emerald-700 ring-1 ring-emerald-100">
                Operativos
              </span>
              <span className="rounded bg-orange-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-orange-700 ring-1 ring-orange-100">
                Reparación
              </span>
              <span className="rounded bg-red-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-red-700 ring-1 ring-red-100">
                No localizados
              </span>
            </div>
          </div>
          <InventoryLocationMap
            key={`${selectedProjectId}-${categoryFilter}-${statusFilter}-${mapPoints.length}`}
            points={mapPoints}
            selectedPointId={selectedItemKey}
            onPointClick={(point) => setSelectedItemKey(point.id)}
            heightClassName="h-[420px]"
            emptyLabel="Registra coordenadas en los activos de tus proyectos para verlos en este mapa."
            className="rounded-none border-0 shadow-none"
          />
        </section>

        <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div>
                <h2 className="text-lg font-black text-slate-950">Activos en alcance</h2>
                <p className="text-xs font-bold text-slate-500">{compactNumber(visibleItems.length)} activos de {compactNumber(scopedProjects.length)} proyectos visibles</p>
              </div>
              {stats.repairCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-3 py-1 text-xs font-black text-orange-700 ring-1 ring-orange-100">
                  <AlertTriangle size={14} />
                  {stats.repairCount} con alerta
                </span>
              )}
            </div>

            {loading ? (
              <div className="flex justify-center py-16">
                <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-indigo-600" />
              </div>
            ) : visibleItems.length === 0 ? (
              <div className="py-16 text-center">
                <PackageSearch className="mx-auto h-12 w-12 text-slate-300" />
                <h3 className="mt-3 text-lg font-black text-slate-950">Sin activos para mostrar</h3>
                <p className="mt-1 text-sm font-medium text-slate-500">Ajusta los filtros o registra inventario dentro de un proyecto.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {visibleItems.map((item) => {
                  const project = projectById.get(item.projectId);
                  const status = getStatusMeta(item.status);
                  const condition = getConditionMeta(item.condition);
                  const firstPhoto = item.photos?.find((photo) => photo.url);
                  return (
                    <div key={`${item.projectId}-${item.id}`} className="grid gap-4 px-4 py-4 transition hover:bg-slate-50 2xl:grid-cols-[minmax(300px,1.5fr)_1fr_1fr_1fr_auto] 2xl:items-center">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200">
                          {firstPhoto?.url ? (
                            <Image src={firstPhoto.url} alt={item.name || 'Activo'} fill sizes="56px" className="object-cover" />
                          ) : (
                            <ImageIcon size={20} className="text-slate-400" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-black text-slate-950">{item.name || 'Activo sin nombre'}</p>
                            {isRepairAsset(item) && (
                              <span className="rounded bg-orange-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-orange-700 ring-1 ring-orange-100">
                                Reparación
                              </span>
                            )}
                          </div>
                          <p className="mt-1 truncate text-xs font-bold text-slate-500">{item.category || 'Sin categoría'} · {item.assetCode || item.serialNumber || 'Sin código'}</p>
                        </div>
                      </div>

                      <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Proyecto</p>
                        <p className="mt-1 truncate text-sm font-black text-slate-700">{project?.name || item.projectId}</p>
                        <p className="truncate text-xs font-bold text-emerald-700">{organizationNameFor(project || {}, organizations)}</p>
                      </div>

                      <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Dónde está</p>
                        <p className="mt-1 truncate text-sm font-black text-slate-700">{item.location || 'Sin ubicación'}</p>
                        <p className="truncate text-xs font-bold text-slate-500">{getResponsibleLabel(item, membersById)}</p>
                        {hasMapCoordinates(item) && (
                          <p className="mt-1 truncate text-[11px] font-black text-cyan-700">
                            Lat {parseMapCoordinate(item.latitude)?.toFixed(5)} · Lng {parseMapCoordinate(item.longitude)?.toFixed(5)}
                          </p>
                        )}
                      </div>

                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Estado</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <span className={`rounded px-2 py-1 text-xs font-black ring-1 ${status.className}`}>{status.label}</span>
                          <span className={`rounded px-2 py-1 text-xs font-black ring-1 ${condition.className}`}>{condition.label}</span>
                        </div>
                      </div>

                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => setSelectedItemKey(`${item.projectId}::${item.id}`)} className="h-9 border-slate-200">
                          <Eye size={14} />
                          Detalle
                        </Button>
                        {canManageInventory && (
                          <>
                            <Button type="button" variant="ghost" size="sm" onClick={() => openEditInventoryModal(item)} className="h-9 px-2 text-slate-500 hover:text-indigo-700" title="Editar activo">
                              <Pencil size={15} />
                            </Button>
                            <Button type="button" variant="ghost" size="sm" onClick={() => handleDeleteInventoryItem(item)} className="h-9 px-2 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Eliminar activo">
                              <Trash2 size={15} />
                            </Button>
                          </>
                        )}
                        <Link href={`/projects/${item.projectId}?tab=inventory`}>
                          <Button type="button" size="sm" className="h-9 bg-indigo-600 font-black text-white hover:bg-indigo-700">
                            Abrir
                            <ArrowRight size={14} className="ml-1" />
                          </Button>
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <aside className="space-y-4">
            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="flex items-center gap-2 text-base font-black text-slate-950">
                <MapPin size={18} className="text-indigo-600" />
                Ubicaciones principales
              </h3>
              <div className="mt-4 space-y-3">
                {locationRows.length === 0 ? (
                  <p className="text-sm font-medium text-slate-500">Sin ubicaciones registradas.</p>
                ) : (
                  locationRows.map((row) => (
                    <div key={row.location} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-sm font-black text-slate-800">{row.location}</p>
                        <span className="rounded bg-white px-2 py-1 text-xs font-black text-slate-600 ring-1 ring-slate-200">{compactNumber(row.units)}</span>
                      </div>
                      <p className="mt-1 text-xs font-bold text-slate-500">{compactNumber(row.assets)} activos · {compactNumber(row.repair)} con novedad</p>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="flex items-center gap-2 text-base font-black text-slate-950">
                <Layers3 size={18} className="text-indigo-600" />
                Proyectos con inventario
              </h3>
              <p className="mt-1 text-sm font-bold text-slate-500">{compactNumber(stats.projectsWithInventory)} proyectos con activos dentro del filtro actual.</p>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-indigo-600"
                  style={{ width: `${scopedProjects.length > 0 ? Math.min(100, (stats.projectsWithInventory / scopedProjects.length) * 100) : 0}%` }}
                />
              </div>
            </section>
          </aside>
        </div>

        {inventoryModalMode && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
            <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-indigo-600">Gestión global de inventario</p>
                  <h3 className="text-2xl font-black tracking-tight text-slate-950">
                    {inventoryModalMode === 'edit' ? 'Editar activo' : 'Nuevo activo'}
                  </h3>
                  <p className="mt-1 text-sm font-bold text-slate-500">
                    Registra, reasigna o traslada activos dentro de los proyectos a los que tienes acceso.
                  </p>
                </div>
                <button type="button" onClick={closeInventoryModal} className="rounded-md p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
                  <X size={22} />
                </button>
              </div>

              <form onSubmit={handleInventorySubmit} className="min-h-0 flex-1 overflow-y-auto p-5">
                <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
                  <div className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <InventoryField label="Proyecto">
                        <select
                          required
                          value={inventoryForm.projectId}
                          onChange={(event) => setInventoryForm({ ...inventoryForm, projectId: event.target.value })}
                          className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                        >
                          <option value="">Selecciona proyecto</option>
                          {scopedProjects.map((project) => (
                            <option key={project.id} value={project.id}>{project.name || project.id}</option>
                          ))}
                        </select>
                      </InventoryField>
                      <InventoryField label="Responsable">
                        <select
                          value={inventoryForm.responsibleId}
                          onChange={(event) => setInventoryForm({ ...inventoryForm, responsibleId: event.target.value })}
                          className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                        >
                          <option value="">Sin responsable</option>
                          {responsibleOptions.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.name || member.displayName || member.email || member.id}
                            </option>
                          ))}
                        </select>
                      </InventoryField>
                      <InventoryField label="Nombre del activo">
                        <input
                          required
                          value={inventoryForm.name}
                          onChange={(event) => setInventoryForm({ ...inventoryForm, name: event.target.value })}
                          className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                          placeholder="Ej: Portátil Lenovo, silla ergonómica, GPS..."
                        />
                      </InventoryField>
                      <InventoryField label="Categoría">
                        <input
                          list="global-inventory-categories"
                          value={inventoryForm.category}
                          onChange={(event) => setInventoryForm({ ...inventoryForm, category: event.target.value })}
                          className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                          placeholder="Computadores, mobiliario, topografía..."
                        />
                        <datalist id="global-inventory-categories">
                          {inventoryFormCategories.map((category) => (
                            <option key={category} value={category} />
                          ))}
                        </datalist>
                      </InventoryField>
                      <InventoryField label="Código interno">
                        <input
                          value={inventoryForm.assetCode}
                          onChange={(event) => setInventoryForm({ ...inventoryForm, assetCode: event.target.value })}
                          className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                          placeholder="ACT-001"
                        />
                      </InventoryField>
                      <InventoryField label="Serial">
                        <input
                          value={inventoryForm.serialNumber}
                          onChange={(event) => setInventoryForm({ ...inventoryForm, serialNumber: event.target.value })}
                          className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                          placeholder="Serial de fábrica"
                        />
                      </InventoryField>
                      <InventoryField label="Cantidad">
                        <input
                          required
                          type="number"
                          min="0"
                          step="0.01"
                          value={inventoryForm.quantity}
                          onChange={(event) => setInventoryForm({ ...inventoryForm, quantity: event.target.value })}
                          className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                        />
                      </InventoryField>
                      <InventoryField label="Valor unitario estimado">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={inventoryForm.estimatedValue}
                          onChange={(event) => setInventoryForm({ ...inventoryForm, estimatedValue: event.target.value })}
                          className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                          placeholder="0"
                        />
                      </InventoryField>
                      <InventoryField label="Estado">
                        <select
                          value={inventoryForm.status}
                          onChange={(event) => setInventoryForm({ ...inventoryForm, status: event.target.value })}
                          className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                        >
                          {STATUS_OPTIONS.map((status) => (
                            <option key={status.value} value={status.value}>{status.label}</option>
                          ))}
                        </select>
                      </InventoryField>
                      <InventoryField label="Condición">
                        <select
                          value={inventoryForm.condition}
                          onChange={(event) => setInventoryForm({ ...inventoryForm, condition: event.target.value })}
                          className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                        >
                          {CONDITION_OPTIONS.map((condition) => (
                            <option key={condition.value} value={condition.value}>{condition.label}</option>
                          ))}
                        </select>
                      </InventoryField>
                      <InventoryField label="Fecha de adquisición">
                        <input
                          type="date"
                          value={inventoryForm.acquisitionDate}
                          onChange={(event) => setInventoryForm({ ...inventoryForm, acquisitionDate: event.target.value })}
                          className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                        />
                      </InventoryField>
                      <label className="flex items-center gap-3 rounded-lg border border-orange-100 bg-orange-50 px-3 py-3 text-sm font-black text-orange-700">
                        <input
                          type="checkbox"
                          checked={inventoryForm.needsRepair}
                          onChange={(event) => setInventoryForm({ ...inventoryForm, needsRepair: event.target.checked })}
                          className="h-4 w-4 rounded border-orange-200"
                        />
                        Requiere reparación o revisión
                      </label>
                    </div>

                    <InventoryField label="Observaciones">
                      <textarea
                        value={inventoryForm.observations}
                        onChange={(event) => setInventoryForm({ ...inventoryForm, observations: event.target.value })}
                        className="min-h-28 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm font-semibold leading-6 text-slate-700 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                        placeholder="Estado del activo, garantía, restricciones, novedades o contexto operativo."
                      />
                    </InventoryField>
                  </div>

                  <aside className="space-y-4">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <h4 className="text-sm font-black text-slate-950">Ubicación operativa</h4>
                      <p className="mt-1 text-xs font-bold text-slate-500">Haz clic en el mapa o escribe coordenadas para alimentar el inventario global.</p>
                      <div className="mt-3">
                        <InventoryLocationMap
                          value={{
                            latitude: parseMapCoordinate(inventoryForm.latitude) ?? undefined,
                            longitude: parseMapCoordinate(inventoryForm.longitude) ?? undefined,
                          }}
                          onChange={(coordinate) =>
                            setInventoryForm({
                              ...inventoryForm,
                              latitude: coordinate.latitude.toFixed(6),
                              longitude: coordinate.longitude.toFixed(6),
                            })
                          }
                          heightClassName="h-64"
                          emptyLabel="Haz clic para ubicar el activo."
                        />
                      </div>
                      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                        <InventoryField label="Latitud">
                          <input
                            value={inventoryForm.latitude}
                            onChange={(event) => setInventoryForm({ ...inventoryForm, latitude: event.target.value })}
                            className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                            placeholder="4.7110"
                          />
                        </InventoryField>
                        <InventoryField label="Longitud">
                          <input
                            value={inventoryForm.longitude}
                            onChange={(event) => setInventoryForm({ ...inventoryForm, longitude: event.target.value })}
                            className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                            placeholder="-74.0721"
                          />
                        </InventoryField>
                      </div>
                    </div>

                    <InventoryField label="Lugar / sede">
                      <input
                        value={inventoryForm.location}
                        onChange={(event) => setInventoryForm({ ...inventoryForm, location: event.target.value })}
                        className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                        placeholder="Bodega, oficina, municipio, frente de trabajo..."
                      />
                    </InventoryField>
                    <InventoryField label="Link externo de ubicación">
                      <input
                        value={inventoryForm.mapUrl}
                        onChange={(event) => setInventoryForm({ ...inventoryForm, mapUrl: event.target.value })}
                        className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                        placeholder="Google Maps, Street View o enlace de soporte"
                      />
                    </InventoryField>
                  </aside>
                </div>

                <div className="sticky bottom-0 mt-5 flex justify-end gap-2 border-t border-slate-100 bg-white py-4">
                  <Button type="button" variant="outline" onClick={closeInventoryModal} className="border-slate-200 font-black">
                    Cancelar
                  </Button>
                  <Button type="submit" disabled={savingInventory} className="bg-indigo-600 font-black text-white hover:bg-indigo-700">
                    {savingInventory ? 'Guardando...' : inventoryModalMode === 'edit' ? 'Guardar activo' : 'Crear activo'}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {selectedItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
            <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-indigo-600">Ficha global de activo</p>
                  <h3 className="truncate text-2xl font-black tracking-tight text-slate-950">{selectedItem.name || 'Activo'}</h3>
                  <p className="mt-1 text-sm font-bold text-slate-500">
                    {projectById.get(selectedItem.projectId)?.name || selectedItem.projectId} · {selectedItem.category || 'Sin categoría'}
                  </p>
                </div>
                <button type="button" onClick={() => setSelectedItemKey(null)} className="rounded-md p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
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
                        <div key={`${photo.storagePath || photo.url}-${index}`} className={`relative overflow-hidden rounded-xl bg-slate-100 ${index === 0 ? 'col-span-2 h-64' : 'h-28'}`}>
                          {photo.url ? <Image src={photo.url} alt={photo.name || selectedItem.name || 'Foto'} fill sizes="520px" className="object-cover" /> : <ImageIcon size={20} className="text-slate-400" />}
                        </div>
                      ))
                    )}
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <InfoTile label="Responsable" value={getResponsibleLabel(selectedItem, membersById)} icon={<User size={16} />} />
                    <InfoTile label="Ubicación" value={selectedItem.location || 'Sin ubicación'} icon={<MapPin size={16} />} />
                    <InfoTile label="Cantidad" value={compactNumber(Number(selectedItem.quantity || 1))} icon={<PackageSearch size={16} />} />
                    <InfoTile label="Valor" value={formatCurrency(Number(selectedItem.estimatedValue || 0))} icon={<BriefcaseBusiness size={16} />} />
                  </div>

                  {hasMapCoordinates(selectedItem) && (
                    <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
                      <InventoryLocationMap
                        key={`global-detail-${selectedItem.projectId}-${selectedItem.id}`}
                        value={{
                          latitude: parseMapCoordinate(selectedItem.latitude) ?? undefined,
                          longitude: parseMapCoordinate(selectedItem.longitude) ?? undefined,
                        }}
                        heightClassName="h-60"
                        emptyLabel="Activo sin punto geográfico."
                      />
                      <p className="border-t border-slate-100 px-3 py-2 text-xs font-bold text-slate-500">
                        Lat {parseMapCoordinate(selectedItem.latitude)?.toFixed(6)} · Lng {parseMapCoordinate(selectedItem.longitude)?.toFixed(6)}
                      </p>
                    </div>
                  )}

                  {selectedItem.mapUrl && (
                    <a href={selectedItem.mapUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex h-10 items-center rounded-lg border border-indigo-100 bg-indigo-50 px-3 text-sm font-black text-indigo-700 transition hover:bg-indigo-100">
                      Abrir localización externa
                      <ArrowRight size={14} className="ml-2" />
                    </a>
                  )}

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
                    {isRepairAsset(selectedItem) && (
                      <span className="rounded bg-orange-50 px-3 py-1.5 text-xs font-black text-orange-700 ring-1 ring-orange-100">
                        Requiere atención
                      </span>
                    )}
                  </div>

                  <section className="mt-5 rounded-xl border border-slate-200 bg-white">
                    <div className="border-b border-slate-100 p-4">
                      <h4 className="flex items-center gap-2 text-lg font-black text-slate-950">
                        <Wrench size={18} className="text-indigo-600" />
                        Hoja de vida
                      </h4>
                      <p className="mt-1 text-sm font-medium text-slate-500">Historial de reparaciones, inspecciones, traslados y novedades.</p>
                    </div>
                    <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
                      {getInventoryHistory(selectedItem).length === 0 ? (
                        <div className="p-6 text-center text-sm font-medium text-slate-500">Sin eventos registrados.</div>
                      ) : (
                        getInventoryHistory(selectedItem)
                          .map((entry, index) => (
                            <div key={entry.id || index} className="p-4">
                              <span className="rounded bg-indigo-50 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-indigo-700 ring-1 ring-indigo-100">
                                {entry.type || 'Novedad'}
                              </span>
                              <p className="mt-2 text-sm font-black text-slate-950">{entry.title || entry.description || 'Sin descripción'}</p>
                              <p className="mt-1 text-xs font-bold text-slate-500">
                                {formatDate(entry.date || entry.createdAt)} · {entry.technician || entry.actorEmail || 'Sin responsable'} {entry.cost ? `· ${formatCurrency(Number(entry.cost))}` : ''}
                              </p>
                              {(entry.result || entry.description) && entry.title && <p className="mt-2 text-xs font-semibold text-slate-500">{entry.result || entry.description}</p>}
                            </div>
                          ))
                      )}
                    </div>
                  </section>

                  <div className="mt-5 flex flex-wrap justify-end gap-2">
                    {canManageInventory && (
                      <>
                        <Button type="button" variant="outline" onClick={() => openEditInventoryModal(selectedItem)} className="border-slate-200 font-black">
                          <Pencil size={16} className="mr-2" />
                          Editar activo
                        </Button>
                        <Button type="button" variant="outline" onClick={() => handleDeleteInventoryItem(selectedItem)} className="border-red-100 font-black text-red-600 hover:bg-red-50">
                          <Trash2 size={16} className="mr-2" />
                          Eliminar
                        </Button>
                      </>
                    )}
                    <Link href={`/projects/${selectedItem.projectId}?tab=inventory`}>
                      <Button className="bg-indigo-600 font-black text-white hover:bg-indigo-700">
                        Abrir inventario del proyecto
                        <ArrowRight size={16} className="ml-2" />
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
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

function InventoryField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">{label}</span>
      {children}
    </label>
  );
}
