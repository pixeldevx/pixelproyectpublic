import { workspaceErrorStatus } from '@/lib/workspaces/server';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { ensureProjectAccess, listDocuments, readDocument, writeDocument } from '@/lib/github/server';
import {
  DEFAULT_ROLE_PERMISSIONS,
  normalizeRolePermissions,
  resolveRolePermissions,
} from '@/lib/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CATALOG_TYPES = new Set([
  'task_type',
  'role',
  'permission',
  'acceptance_criterion',
  'section',
  'field_name',
  'format',
  'origin',
]);
const MAX_BODY_BYTES = 48 * 1024;
const COLLECTION = 'scrumStoryCatalogs';

const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status });
const cleanText = (value: unknown, maxLength: number) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
const normalizeLabel = (value: unknown) => cleanText(value, 500)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();
const slugify = (value: string) => normalizeLabel(value)
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
const getEntryId = (catalogType: string, label: string) =>
  `${catalogType}--${slugify(label)}--${stableHash(normalizeLabel(label))}`;
const RESERVED_TASK_TYPE_LABELS = new Set([
  'Historia de usuario',
  'Error',
  'Tarea técnica',
  'Investigación',
].map(normalizeLabel));

const getActorName = (actor: any) => cleanText(
  actor?.profile?.displayName || actor?.profile?.name || actor?.profile?.fullName || actor?.email,
  240,
);

const authorizeCatalogMutation = async (request: NextRequest, projectId: string) => {
  const access = await ensureProjectAccess(request, projectId);
  if (access.error) return { error: access.error } as const;
  const permissionDocument = await readDocument(access.supabase, 'settings', 'rolePermissions');
  const settings = normalizeRolePermissions(permissionDocument || DEFAULT_ROLE_PERMISSIONS);
  const permissions = resolveRolePermissions(settings, access.actor.role);
  if (!permissions.taskEditDetails) {
    return { error: json({ error: 'No tienes permiso para administrar los dominios de historias de usuario.' }, 403) } as const;
  }
  return { access } as const;
};

const parseBody = async (request: Request) => {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return null;
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return null;
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, any> : {};
  } catch {
    return {};
  }
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    const authorized = await authorizeCatalogMutation(request, projectId);
    if ('error' in authorized) return authorized.error;
    const body = await parseBody(request);
    if (!body) return json({ error: 'La definición del catálogo supera el límite permitido.' }, 413);

    const catalogType = cleanText(body.catalogType, 40);
    const label = cleanText(body.label, 500);
    const description = cleanText(body.description, 2_000);
    if (!CATALOG_TYPES.has(catalogType)) return json({ error: 'El tipo de catálogo no es válido.' }, 400);
    if (!label) return json({ error: 'Escribe el valor que deseas agregar.' }, 400);
    if (catalogType === 'task_type' && RESERVED_TASK_TYPE_LABELS.has(normalizeLabel(label))) {
      return json({ error: 'Este tipo base ya existe en Pixel y no necesita crearse de nuevo.' }, 409);
    }
    const submittedTemplate = body.template && typeof body.template === 'object' && !Array.isArray(body.template)
      ? JSON.parse(JSON.stringify(body.template))
      : undefined;
    if (submittedTemplate && JSON.stringify(submittedTemplate).length > 24_000) {
      return json({ error: 'La plantilla del dominio es demasiado extensa.' }, 413);
    }
    if (catalogType === 'task_type' && submittedTemplate?.scrumKind && submittedTemplate.scrumKind !== 'technical_task') {
      return json({ error: 'Los tipos personalizados deben conservar el comportamiento técnico de una tarea.' }, 400);
    }
    const template = catalogType === 'task_type'
      ? { scrumKind: 'technical_task' }
      : submittedTemplate;

    const { access } = authorized;
    const collectionPath = `projects/${projectId}/${COLLECTION}`;
    const entryId = getEntryId(catalogType, label);
    const existing = await readDocument(access.supabase, collectionPath, entryId);
    if (existing?.projectId && String(existing.projectId) !== projectId) {
      return json({ error: 'El valor solicitado no pertenece a este proyecto.' }, 409);
    }
    const changedAt = new Date().toISOString();
    const actorName = getActorName(access.actor);
    const wasInactive = existing?.active === false;
    const history = Array.isArray(existing?.statusHistory) ? existing.statusHistory.slice(-49) : [];
    const catalogEntries = existing ? [] : await listDocuments(access.supabase, collectionPath, 1_000);
    const configuredOrders = catalogEntries
      .filter((entry: any) => entry.catalogType === catalogType)
      .map((entry: any) => Number(entry.sortOrder))
      .filter(Number.isFinite);
    const defaultOrderFloor = catalogType === 'task_type' ? 400 : 1_000;
    const sortOrder = Number.isFinite(Number(existing?.sortOrder))
      ? Number(existing.sortOrder)
      : Math.max(defaultOrderFloor, ...configuredOrders, 0) + 100;
    const entry = await writeDocument(access.supabase, collectionPath, entryId, {
      projectId,
      catalogType,
      label,
      normalizedLabel: normalizeLabel(label),
      description: description || existing?.description || '',
      sortOrder,
      ...(template ? { template } : {}),
      active: true,
      source: 'project',
      createdBy: existing?.createdBy || access.actor.id,
      createdByName: existing?.createdByName || actorName,
      createdByEmail: existing?.createdByEmail || access.actor.email,
      createdAt: existing?.createdAt || changedAt,
      updatedBy: access.actor.id,
      updatedByName: actorName,
      updatedByEmail: access.actor.email,
      updatedAt: changedAt,
      ...(wasInactive ? { reactivatedAt: changedAt, reactivatedBy: access.actor.id } : {}),
      statusHistory: existing
        ? wasInactive
          ? [...history, {
              action: 'activated',
              active: true,
              changedAt,
              changedBy: access.actor.id,
              changedByName: actorName,
              changedByEmail: access.actor.email,
            }]
          : history
        : [{
            action: 'created',
            active: true,
            changedAt,
            changedBy: access.actor.id,
            changedByName: actorName,
            changedByEmail: access.actor.email,
          }],
    });
    return json({ entry });
  } catch (error: any) {
    console.error('Error creating Scrum story catalog entry:', error);
    return json({ error: error?.message || 'No se pudo actualizar el catálogo del proyecto.' }, workspaceErrorStatus(error));
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    const authorized = await authorizeCatalogMutation(request, projectId);
    if ('error' in authorized) return authorized.error;
    const body = await parseBody(request);
    if (!body) return json({ error: 'La solicitud supera el límite permitido.' }, 413);
    const entryId = cleanText(body.entryId, 220);
    const hasActiveChange = typeof body.active === 'boolean';
    const active = body.active === true;
    const requestedSortOrder = Number(body.sortOrder);
    const hasSortOrderChange = Number.isFinite(requestedSortOrder) && requestedSortOrder >= 0;
    if (!hasActiveChange && !hasSortOrderChange) {
      return json({ error: 'Indica el estado o el orden que deseas actualizar.' }, 400);
    }
    if (!/^(task_type|role|permission|acceptance_criterion|section|field_name|format|origin)--[a-z0-9-]+--[a-z0-9]+$/.test(entryId)) {
      return json({ error: 'El valor de catálogo no es válido.' }, 400);
    }

    const { access } = authorized;
    const collectionPath = `projects/${projectId}/${COLLECTION}`;
    const existing = await readDocument(access.supabase, collectionPath, entryId);
    if (!existing || existing.source === 'system' || existing.isDefault) {
      return json({ error: 'El valor no existe o corresponde a una opción base de Pixel.' }, 404);
    }
    if (existing.projectId && String(existing.projectId) !== projectId) {
      return json({ error: 'El valor no pertenece a este proyecto.' }, 403);
    }
    const changedAt = new Date().toISOString();
    const actorName = getActorName(access.actor);
    const history = Array.isArray(existing.statusHistory) ? existing.statusHistory.slice(-49) : [];
    const entry = await writeDocument(access.supabase, collectionPath, entryId, {
      ...(hasActiveChange ? { active } : {}),
      ...(hasSortOrderChange ? { sortOrder: Math.round(requestedSortOrder) } : {}),
      updatedBy: access.actor.id,
      updatedByName: actorName,
      updatedByEmail: access.actor.email,
      updatedAt: changedAt,
      ...(hasActiveChange
        ? active
          ? { reactivatedAt: changedAt, reactivatedBy: access.actor.id }
          : { deactivatedAt: changedAt, deactivatedBy: access.actor.id }
        : {}),
      ...(hasActiveChange ? {
        statusHistory: [...history, {
          action: active ? 'activated' : 'deactivated',
          active,
          changedAt,
          changedBy: access.actor.id,
          changedByName: actorName,
          changedByEmail: access.actor.email,
        }],
      } : {}),
    });
    return json({ entry });
  } catch (error: any) {
    console.error('Error changing Scrum story catalog status:', error);
    return json({ error: error?.message || 'No se pudo actualizar el catálogo del proyecto.' }, workspaceErrorStatus(error));
  }
}
