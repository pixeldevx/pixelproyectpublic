import { db } from '@/lib/backend';
import { collection } from '@/lib/supabase/document-store';
import { supabase } from '@/lib/supabase/client';

export const SCRUM_STORY_CATALOG_COLLECTION = 'scrumStoryCatalogs';

export const SCRUM_STORY_CATALOG_TYPES = [
  'task_type',
  'role',
  'permission',
  'acceptance_criterion',
  'section',
  'field_name',
  'format',
  'origin',
] as const;

export type ScrumStoryCatalogType = typeof SCRUM_STORY_CATALOG_TYPES[number];

export type ScrumStoryCatalogActor = {
  id?: string | null;
  uid?: string | null;
  email?: string | null;
  name?: string | null;
  displayName?: string | null;
};

export type ScrumStoryCatalogEntry = {
  id: string;
  projectId: string;
  catalogType: ScrumStoryCatalogType;
  label: string;
  normalizedLabel: string;
  description?: string;
  template?: Record<string, any>;
  sortOrder?: number;
  active: boolean;
  source: 'system' | 'project';
  isDefault?: boolean;
  createdBy?: string | null;
  createdByName?: string | null;
  createdByEmail?: string | null;
  createdAt?: any;
  updatedBy?: string | null;
  updatedByName?: string | null;
  updatedByEmail?: string | null;
  updatedAt?: any;
  statusHistory?: Array<{
    action: 'created' | 'activated' | 'deactivated';
    active: boolean;
    changedAt: string;
    changedBy: string | null;
    changedByName: string | null;
    changedByEmail: string | null;
  }>;
};

type CatalogDefault = {
  label: string;
  description?: string;
  template?: Record<string, any>;
  sortOrder?: number;
};

export const SCRUM_STORY_CATALOG_LABELS: Record<ScrumStoryCatalogType, string> = {
  task_type: 'Tipo de tarea',
  role: 'Rol',
  permission: 'Permiso',
  acceptance_criterion: 'Criterio de aceptación',
  section: 'Sección',
  field_name: 'Campo',
  format: 'Formato',
  origin: 'Origen',
};

export const DEFAULT_SCRUM_STORY_CATALOG_VALUES: Record<ScrumStoryCatalogType, readonly CatalogDefault[]> = {
  task_type: [
    {
      label: 'Historia de usuario',
      description: 'Necesidad funcional expresada desde la perspectiva de una persona usuaria.',
      template: { scrumKind: 'story' },
    },
    {
      label: 'Error',
      description: 'Corrección de un comportamiento defectuoso o inesperado.',
      template: { scrumKind: 'bug' },
    },
    {
      label: 'Tarea técnica',
      description: 'Trabajo técnico que no corresponde a una historia de usuario.',
      template: { scrumKind: 'technical_task' },
    },
    {
      label: 'Investigación',
      description: 'Exploración con alcance y resultado de aprendizaje definidos.',
      template: { scrumKind: 'spike' },
    },
  ],
  role: [
    { label: 'Administrador global' },
    { label: 'Product Owner' },
    { label: 'Scrum Master' },
    { label: 'Líder técnico' },
    { label: 'Desarrollador' },
    { label: 'Analista funcional' },
    { label: 'QA / Validador' },
    { label: 'Usuario final' },
    { label: 'Integración externa' },
  ],
  permission: [
    { label: 'Consultar' },
    { label: 'Crear' },
    { label: 'Editar' },
    { label: 'Eliminar' },
    { label: 'Aprobar' },
    { label: 'Rechazar o devolver' },
    { label: 'Exportar' },
    { label: 'Administrar configuración' },
  ],
  acceptance_criterion: [
    { label: 'Validar los campos obligatorios antes de guardar' },
    { label: 'Confirmar el guardado exitoso y conservar la información' },
    { label: 'Impedir acciones que el rol no tenga autorizadas' },
    { label: 'Mostrar un mensaje claro cuando una validación falle' },
    { label: 'Registrar en la trazabilidad quién realizó la acción y cuándo' },
    { label: 'Mantener una visualización usable en escritorio y móvil' },
  ],
  section: [
    { label: 'Identificación' },
    { label: 'Datos generales' },
    { label: 'Ubicación' },
    { label: 'Responsables' },
    { label: 'Flujo y estados' },
    { label: 'Documentos y soportes' },
    { label: 'Observaciones' },
    { label: 'Auditoría y trazabilidad' },
  ],
  field_name: [
    { label: 'Nombre' },
    { label: 'Descripción' },
    { label: 'Estado' },
    { label: 'Fecha de creación' },
    { label: 'Fecha de actualización' },
    { label: 'Responsable' },
    { label: 'Observaciones' },
  ],
  format: [
    { label: 'Texto corto (varchar)', description: 'Una línea de texto con longitud controlada.' },
    { label: 'Texto largo (text)', description: 'Contenido de varias líneas.' },
    { label: 'Número entero (integer)' },
    { label: 'Número entero largo (bigint)' },
    { label: 'Número decimal (numeric)' },
    { label: 'Moneda COP (numeric)' },
    { label: 'Porcentaje (numeric)' },
    { label: 'Fecha (date)' },
    { label: 'Fecha y hora (timestamp)' },
    { label: 'Fecha y hora con zona (timestamptz)' },
    { label: 'Hora' },
    { label: 'Sí / No (boolean)' },
    { label: 'Identificador UUID' },
    { label: 'JSON estructurado (jsonb)' },
    { label: 'Relación / llave foránea' },
    { label: 'Lista de selección única' },
    { label: 'Lista de selección múltiple' },
    { label: 'Correo electrónico' },
    { label: 'Teléfono' },
    { label: 'URL' },
    { label: 'Documento o archivo' },
    { label: 'Imagen' },
    { label: 'Coordenadas geográficas' },
    { label: 'Geometría / geografía espacial' },
  ],
  origin: [
    { label: 'Digitado por el usuario' },
    { label: 'Generado por el sistema' },
    { label: 'Cálculo automático' },
    { label: 'Catálogo o dominio' },
    { label: 'Perfil del usuario' },
    { label: 'Configuración del proyecto' },
    { label: 'Integración o API' },
    { label: 'Archivo importado' },
    { label: 'Heredado de otra entidad' },
  ],
};

export const normalizeScrumStoryCatalogLabel = (value: unknown) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const slugify = (value: string) =>
  normalizeScrumStoryCatalogLabel(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 54) || 'valor';

const stableHash = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const getEntryId = (catalogType: ScrumStoryCatalogType, label: string) => {
  const normalizedLabel = normalizeScrumStoryCatalogLabel(label);
  return `${catalogType}--${slugify(label)}--${stableHash(normalizedLabel)}`;
};

const getCatalogAccessToken = async () => {
  const { data, error } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (error || !accessToken) throw new Error('Tu sesión de Pixel expiró. Vuelve a iniciar sesión.');
  return accessToken;
};

const parseCatalogApiResponse = async (response: Response) => {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || 'No se pudo actualizar el catálogo del proyecto.');
  }
  return payload;
};

export const getDefaultScrumStoryCatalogEntries = (
  projectId: string,
  catalogType: ScrumStoryCatalogType,
): ScrumStoryCatalogEntry[] =>
  DEFAULT_SCRUM_STORY_CATALOG_VALUES[catalogType].map((entry, index) => ({
    id: `system--${getEntryId(catalogType, entry.label)}`,
    projectId,
    catalogType,
    label: entry.label,
    normalizedLabel: normalizeScrumStoryCatalogLabel(entry.label),
    description: entry.description,
    template: entry.template,
    sortOrder: Number.isFinite(entry.sortOrder) ? entry.sortOrder : (index + 1) * 100,
    active: true,
    source: 'system',
    isDefault: true,
    createdBy: 'pixel-system',
    createdByName: 'Pixel Project',
    createdByEmail: null,
  }));

export const normalizeScrumStoryCatalogEntry = (
  id: string,
  data: Record<string, any>,
): ScrumStoryCatalogEntry | null => {
  const catalogType = String(data?.catalogType || '') as ScrumStoryCatalogType;
  const label = String(data?.label || data?.name || '').trim();
  if (!SCRUM_STORY_CATALOG_TYPES.includes(catalogType) || !label) return null;

  return {
    ...data,
    id,
    projectId: String(data?.projectId || ''),
    catalogType,
    label,
    normalizedLabel: normalizeScrumStoryCatalogLabel(data?.normalizedLabel || label),
    template: catalogType === 'task_type' && data?.source !== 'system'
      ? { scrumKind: 'technical_task' }
      : data?.template,
    active: data?.active !== false,
    sortOrder: Number.isFinite(Number(data?.sortOrder)) ? Number(data.sortOrder) : 10_000,
    source: data?.source === 'system' ? 'system' : 'project',
  } as ScrumStoryCatalogEntry;
};

export const mergeScrumStoryCatalogEntries = ({
  projectId,
  catalogType,
  storedEntries,
}: {
  projectId: string;
  catalogType: ScrumStoryCatalogType;
  storedEntries: ScrumStoryCatalogEntry[];
}) => {
  const merged = new Map<string, ScrumStoryCatalogEntry>();
  getDefaultScrumStoryCatalogEntries(projectId, catalogType).forEach((entry) => {
    merged.set(entry.normalizedLabel, entry);
  });
  storedEntries
    .filter((entry) => (
      entry.catalogType === catalogType &&
      (!entry.projectId || entry.projectId === projectId)
    ))
    .forEach((entry) => {
      merged.set(entry.normalizedLabel, entry);
    });

  return Array.from(merged.values()).sort((left, right) => {
    const orderDifference = Number(left.sortOrder ?? 10_000) - Number(right.sortOrder ?? 10_000);
    if (orderDifference !== 0) return orderDifference;
    return left.label.localeCompare(right.label, 'es', { sensitivity: 'base' });
  });
};

export const createScrumStoryCatalogEntry = async ({
  projectId,
  catalogType,
  label,
  description = '',
  template,
  actor,
}: {
  projectId: string;
  catalogType: ScrumStoryCatalogType;
  label: string;
  description?: string;
  template?: Record<string, any>;
  actor?: ScrumStoryCatalogActor | null;
}): Promise<ScrumStoryCatalogEntry> => {
  const cleanProjectId = String(projectId || '').trim();
  const cleanLabel = String(label || '').replace(/\s+/g, ' ').trim();
  if (!cleanProjectId) throw new Error('No se identificó el proyecto del catálogo.');
  if (!SCRUM_STORY_CATALOG_TYPES.includes(catalogType)) throw new Error('El tipo de catálogo no es válido.');
  if (!cleanLabel) throw new Error('Escribe el valor que deseas agregar.');

  const builtIn = getDefaultScrumStoryCatalogEntries(cleanProjectId, catalogType)
    .find((entry) => entry.normalizedLabel === normalizeScrumStoryCatalogLabel(cleanLabel));
  if (builtIn) return builtIn;

  void actor;
  const accessToken = await getCatalogAccessToken();
  const response = await fetch(`/api/projects/${encodeURIComponent(cleanProjectId)}/scrum/catalogs`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      catalogType,
      label: cleanLabel,
      description: description.trim(),
      ...(template ? { template } : {}),
    }),
    cache: 'no-store',
  });
  const payload = await parseCatalogApiResponse(response);
  const entry = normalizeScrumStoryCatalogEntry(String(payload?.entry?.id || ''), payload?.entry || {});
  if (!entry) throw new Error('El servidor devolvió un valor de catálogo inválido.');
  return entry;
};

export const setScrumStoryCatalogEntryActive = async ({
  projectId,
  entry,
  active,
  actor,
}: {
  projectId: string;
  entry: ScrumStoryCatalogEntry;
  active: boolean;
  actor?: ScrumStoryCatalogActor | null;
}) => {
  if (entry.source === 'system' || entry.isDefault) {
    throw new Error('Los valores base de Pixel no se pueden desactivar.');
  }
  void actor;
  const accessToken = await getCatalogAccessToken();
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/scrum/catalogs`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ entryId: entry.id, active }),
    cache: 'no-store',
  });
  await parseCatalogApiResponse(response);
};

export const setScrumStoryCatalogEntrySortOrder = async ({
  projectId,
  entry,
  sortOrder,
  actor,
}: {
  projectId: string;
  entry: ScrumStoryCatalogEntry;
  sortOrder: number;
  actor?: ScrumStoryCatalogActor | null;
}) => {
  if (entry.source === 'system' || entry.isDefault) {
    throw new Error('El orden de los valores base de Pixel es fijo.');
  }
  if (!Number.isFinite(sortOrder) || sortOrder < 0) {
    throw new Error('El orden del dominio no es válido.');
  }
  void actor;
  const accessToken = await getCatalogAccessToken();
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/scrum/catalogs`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ entryId: entry.id, sortOrder: Math.round(sortOrder) }),
    cache: 'no-store',
  });
  await parseCatalogApiResponse(response);
};

export const getScrumStoryCatalogCollection = (projectId: string) =>
  collection(db, 'projects', projectId, SCRUM_STORY_CATALOG_COLLECTION);
