import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { buildDocumentStoragePath, getTaskStorageFolderSegments, slugifyStorageSegment } from '@/lib/document-storage';
import { createS3PresignedUrl } from '@/lib/storage/s3-presign';
import { buildS3ObjectKey, getDocumentStorageSettings, getS3RuntimeConfig } from '@/lib/storage/server-config';
import { formatS3StoragePath, parseS3StoragePath } from '@/lib/storage/paths';
import { ensureProjectAccess, listDocuments, readDocument, writeDocument } from '@/lib/github/server';
import {
  DEFAULT_ROLE_PERMISSIONS,
  normalizeRolePermissions,
  resolveRolePermissions,
  type PermissionKey,
} from '@/lib/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_FILE_SIZE = 4 * 1024 * 1024;
const MAX_REQUEST_SIZE = MAX_FILE_SIZE + 256 * 1024;
const MAX_IMAGE_DIMENSION = 8192;
const MAX_IMAGE_PIXELS = 20_000_000;
const MAX_EVIDENCE_PER_STORY = 50;
const DOCUMENT_KIND = 'story_visual_evidence';

const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status });
const cleanText = (value: unknown, maxLength: number) => String(value || '')
  .replace(/[\u0000-\u001F\u007F]/g, '')
  .trim()
  .slice(0, maxLength);

type DetectedImage = {
  contentType: 'image/png' | 'image/jpeg';
  extension: 'png' | 'jpg';
  width: number;
  height: number;
};

const getJpegDimensions = (buffer: Buffer) => {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) break;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (segmentLength < 7) break;
      return { height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) };
    }
    offset += segmentLength;
  }
  return null;
};

const inspectImage = (file: File, buffer: Buffer): DetectedImage => {
  let detected: DetectedImage | null = null;
  const isPng = buffer.length >= 24
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (isPng) {
    detected = {
      contentType: 'image/png',
      extension: 'png',
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  } else if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9) {
    const dimensions = getJpegDimensions(buffer);
    if (dimensions) detected = { contentType: 'image/jpeg', extension: 'jpg', ...dimensions };
  }
  if (!detected) throw Object.assign(new Error('El archivo no contiene una imagen PNG o JPG válida.'), { status: 415 });

  const declaredMime = String(file.type || '').toLowerCase();
  if (declaredMime && declaredMime !== 'application/octet-stream' && declaredMime !== detected.contentType) {
    throw Object.assign(new Error('El tipo declarado no coincide con el contenido real de la imagen.'), { status: 415 });
  }
  const extension = file.name.toLowerCase().split('.').pop() || '';
  const validExtension = detected.extension === 'png' ? extension === 'png' : ['jpg', 'jpeg'].includes(extension);
  if (!validExtension) throw Object.assign(new Error('La extensión no coincide con el contenido real de la imagen.'), { status: 415 });
  if (
    !detected.width
    || !detected.height
    || detected.width > MAX_IMAGE_DIMENSION
    || detected.height > MAX_IMAGE_DIMENSION
    || detected.width * detected.height > MAX_IMAGE_PIXELS
  ) {
    throw Object.assign(new Error('La imagen supera el límite seguro de dimensiones (8.192 px o 20 megapíxeles).'), { status: 413 });
  }
  return detected;
};

const authorize = async (
  request: NextRequest,
  projectId: string,
  requiredPermissions: PermissionKey[],
) => {
  const access = await ensureProjectAccess(request, projectId);
  if (access.error) return { error: access.error } as const;
  const permissionDocument = await readDocument(access.supabase, 'settings', 'rolePermissions');
  const settings = normalizeRolePermissions(permissionDocument || DEFAULT_ROLE_PERMISSIONS);
  const permissions = resolveRolePermissions(settings, access.actor.role);
  const missing = requiredPermissions.find((permission) => !permissions[permission]);
  if (missing) return { error: json({ error: 'Tu rol no permite realizar esta operación sobre evidencias.' }, 403) } as const;
  return { access } as const;
};

const readStory = async (supabase: any, projectId: string, storyId: string) => {
  const story = await readDocument(supabase, `projects/${projectId}/tasks`, storyId);
  if (!story || story.deletedAt || story.scrumKind !== 'story') return null;
  return story;
};

const getActorName = (actor: any) => cleanText(
  actor?.profile?.displayName || actor?.profile?.name || actor?.profile?.fullName || actor?.email,
  240,
);

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ projectId: string; storyId: string }> },
) {
  let uploaded: { bucket: string; key: string; region: string; accessKeyId: string; secretAccessKey: string; sessionToken?: string } | null = null;
  try {
    const { projectId, storyId } = await context.params;
    const authorized = await authorize(request, projectId, ['taskEditDetails', 'documentUpload']);
    if ('error' in authorized) return authorized.error;
    const story = await readStory(authorized.access.supabase, projectId, storyId);
    if (!story) return json({ error: 'La historia no existe o ya no está disponible.' }, 404);

    const settings = await getDocumentStorageSettings();
    if (settings.provider !== 's3') {
      return json({ error: 'Las evidencias visuales requieren el almacenamiento seguro S3 configurado para documentos.' }, 503);
    }
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_SIZE) {
      return json({ error: 'La imagen supera el límite de 4 MB.' }, 413);
    }
    const formData = await request.formData();
    const attachedFiles = Array.from(formData.entries()).filter((entry) => typeof entry[1] !== 'string');
    const fileValues = formData.getAll('file');
    if (attachedFiles.length !== 1 || attachedFiles[0][0] !== 'file' || fileValues.length !== 1 || typeof fileValues[0] === 'string') {
      return json({ error: 'Adjunta exactamente una imagen.' }, 400);
    }
    const file = fileValues[0];
    if (!file.size) return json({ error: 'La imagen está vacía.' }, 400);
    if (file.size > MAX_FILE_SIZE) return json({ error: 'La imagen supera el límite de 4 MB.' }, 413);
    const buffer = Buffer.from(await file.arrayBuffer());
    const detected = inspectImage(file, buffer);

    const section = cleanText(formData.get('section'), 120);
    const caption = cleanText(formData.get('caption'), 240);
    const altText = cleanText(formData.get('altText'), 300);
    const criterionId = cleanText(formData.get('criterionId'), 180) || null;
    const fieldId = cleanText(formData.get('fieldId'), 180) || null;
    const roleId = cleanText(formData.get('roleId'), 180) || null;
    if (!section) return json({ error: 'Selecciona la sección de la historia.' }, 400);
    if (!altText) return json({ error: 'Escribe el texto alternativo de la imagen.' }, 400);

    const collectionPath = `projects/${projectId}/documents`;
    const documents = await listDocuments(authorized.access.supabase, collectionPath, 1_000);
    const currentEvidence = documents.filter((item: any) =>
      item.type === DOCUMENT_KIND && String(item.storyId || item.taskId || '') === storyId && !item.deletedAt,
    );
    if (currentEvidence.length >= MAX_EVIDENCE_PER_STORY) {
      return json({ error: `La historia alcanzó el máximo de ${MAX_EVIDENCE_PER_STORY} evidencias visuales.` }, 409);
    }

    const originalBaseName = cleanText(file.name.replace(/\.[^.]+$/, ''), 80) || 'evidencia';
    const uniqueName = `${slugifyStorageSegment(originalBaseName, 'evidencia')}-${crypto.randomUUID()}.${detected.extension}`;
    const storyLike = { id: storyId, title: story.title || story.name || 'Historia de usuario', parentTaskId: story.parentTaskId };
    const storagePath = buildDocumentStoragePath({
      projectId,
      projectName: authorized.access.project?.name || authorized.access.project?.title,
      task: storyLike,
      tasks: [storyLike],
      fileName: uniqueName,
      documentName: uniqueName,
      folderSegments: ['evidencias-visuales', slugifyStorageSegment(section, 'general')],
    });
    const s3 = await getS3RuntimeConfig();
    const key = buildS3ObjectKey(s3.prefix, storagePath);
    const uploadUrl = createS3PresignedUrl({
      method: 'PUT',
      bucket: s3.bucket,
      key,
      region: s3.region,
      accessKeyId: s3.accessKeyId,
      secretAccessKey: s3.secretAccessKey,
      sessionToken: s3.sessionToken,
      expiresInSeconds: 120,
    });
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      body: new Uint8Array(buffer),
      headers: { 'Content-Type': detected.contentType },
    });
    if (!uploadResponse.ok) throw new Error(`Amazon S3 rechazó la imagen (${uploadResponse.status}).`);
    uploaded = { ...s3, key };

    const evidenceId = crypto.randomUUID();
    const changedAt = new Date().toISOString();
    const actorName = getActorName(authorized.access.actor);
    const storyTitle = cleanText(story.title || story.name || 'Historia de usuario', 300);
    const storageUri = formatS3StoragePath(s3.bucket, key);
    const evidence = await writeDocument(authorized.access.supabase, collectionPath, evidenceId, {
      projectId,
      taskId: storyId,
      taskTitle: storyTitle,
      storyId,
      storyTitle,
      entityType: 'user_story',
      scope: 'user_story_evidence',
      documentKind: 'visual_evidence',
      type: DOCUMENT_KIND,
      visualEvidence: true,
      section,
      criterionId,
      fieldId,
      roleId,
      caption,
      altText,
      order: currentEvidence.reduce((maximum: number, item: any) => Math.max(maximum, Number(item.order || 0)), 0) + 1,
      name: caption || originalBaseName,
      fileName: cleanText(file.name, 180),
      fileSize: file.size,
      width: detected.width,
      height: detected.height,
      contentType: detected.contentType,
      storagePath: storageUri,
      storageFolder: storageUri.split('/').slice(0, -1).join('/'),
      taskFolderSegments: getTaskStorageFolderSegments(storyLike, [storyLike]),
      accessMode: 'all',
      allowedMemberIds: [],
      uploadedBy: authorized.access.actor.id,
      uploadedByName: actorName,
      uploadedByEmail: authorized.access.actor.email,
      uploadedAt: changedAt,
      createdBy: authorized.access.actor.id,
      createdAt: changedAt,
      updatedBy: authorized.access.actor.id,
      updatedAt: changedAt,
      providerPathVersion: 'structured-v1',
      auditTrail: [{ action: 'created', at: changedAt, by: authorized.access.actor.id, byName: actorName }],
    }, false);
    uploaded = null;
    return json({ evidence });
  } catch (error: any) {
    if (uploaded) {
      try {
        const deleteUrl = createS3PresignedUrl({ method: 'DELETE', ...uploaded, expiresInSeconds: 120 });
        await fetch(deleteUrl, { method: 'DELETE' });
      } catch (cleanupError) {
        console.error('Could not clean up failed visual evidence upload:', cleanupError);
      }
    }
    console.error('Error creating story visual evidence:', error);
    return json({ error: error?.message || 'No se pudo guardar la evidencia visual.' }, Number(error?.status) || 500);
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ projectId: string; storyId: string }> },
) {
  try {
    const { projectId, storyId } = await context.params;
    const authorized = await authorize(request, projectId, ['documentDelete']);
    if ('error' in authorized) return authorized.error;
    if (!(await readStory(authorized.access.supabase, projectId, storyId))) {
      return json({ error: 'La historia no existe o ya no está disponible.' }, 404);
    }
    const body = await request.json().catch(() => ({}));
    const evidenceId = cleanText(body.evidenceId, 180);
    if (!evidenceId) return json({ error: 'No se identificó la evidencia.' }, 400);
    const collectionPath = `projects/${projectId}/documents`;
    const evidence = await readDocument(authorized.access.supabase, collectionPath, evidenceId);
    if (!evidence || evidence.type !== DOCUMENT_KIND || String(evidence.storyId || evidence.taskId || '') !== storyId) {
      return json({ error: 'La evidencia no pertenece a esta historia.' }, 404);
    }
    const changedAt = new Date().toISOString();
    const actorName = getActorName(authorized.access.actor);
    await writeDocument(authorized.access.supabase, collectionPath, evidenceId, {
      deletedAt: changedAt,
      deletedBy: authorized.access.actor.id,
      deletedByName: actorName,
      updatedAt: changedAt,
      updatedBy: authorized.access.actor.id,
      auditTrail: [
        ...(Array.isArray(evidence.auditTrail) ? evidence.auditTrail.slice(-49) : []),
        { action: 'deleted', at: changedAt, by: authorized.access.actor.id, byName: actorName },
      ],
    });

    const parsed = parseS3StoragePath(String(evidence.storagePath || ''));
    if (parsed) {
      const s3 = await getS3RuntimeConfig();
      if (parsed.bucket !== s3.bucket) return json({ error: 'La evidencia usa un bucket no autorizado.' }, 403);
      const deleteUrl = createS3PresignedUrl({
        method: 'DELETE',
        bucket: s3.bucket,
        key: parsed.key,
        region: s3.region,
        accessKeyId: s3.accessKeyId,
        secretAccessKey: s3.secretAccessKey,
        sessionToken: s3.sessionToken,
        expiresInSeconds: 120,
      });
      const deleted = await fetch(deleteUrl, { method: 'DELETE' });
      if (!deleted.ok) return json({ error: 'La evidencia se retiró de la historia, pero el archivo quedó pendiente de limpieza.' }, 502);
    }
    return json({ ok: true });
  } catch (error: any) {
    console.error('Error deleting story visual evidence:', error);
    return json({ error: error?.message || 'No se pudo eliminar la evidencia.' }, 500);
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ projectId: string; storyId: string }> },
) {
  try {
    const { projectId, storyId } = await context.params;
    const authorized = await authorize(request, projectId, ['taskEditDetails']);
    if ('error' in authorized) return authorized.error;
    if (!(await readStory(authorized.access.supabase, projectId, storyId))) {
      return json({ error: 'La historia no existe o ya no está disponible.' }, 404);
    }
    const body = await request.json().catch(() => ({}));
    const orderedIds = Array.isArray(body.orderedIds)
      ? body.orderedIds.map((id: unknown) => cleanText(id, 180)).filter(Boolean)
      : [];
    if (!orderedIds.length || orderedIds.length > MAX_EVIDENCE_PER_STORY || new Set(orderedIds).size !== orderedIds.length) {
      return json({ error: 'El orden enviado no es válido.' }, 400);
    }
    const collectionPath = `projects/${projectId}/documents`;
    const documents = await listDocuments(authorized.access.supabase, collectionPath, 1_000);
    const activeEvidence = documents.filter((item: any) =>
      item.type === DOCUMENT_KIND && String(item.storyId || item.taskId || '') === storyId && !item.deletedAt,
    );
    const validIds = new Set(activeEvidence.map((item: any) => String(item.id)));
    if (orderedIds.length !== validIds.size || orderedIds.some((id: string) => !validIds.has(id))) {
      return json({ error: 'El orden debe incluir exactamente las evidencias activas de esta historia.' }, 409);
    }
    const changedAt = new Date().toISOString();
    await Promise.all(orderedIds.map((id: string, index: number) => writeDocument(
      authorized.access.supabase,
      collectionPath,
      id,
      { order: index + 1, updatedAt: changedAt, updatedBy: authorized.access.actor.id },
    )));
    return json({ ok: true });
  } catch (error: any) {
    console.error('Error reordering story visual evidence:', error);
    return json({ error: error?.message || 'No se pudo guardar el orden de las evidencias.' }, 500);
  }
}
