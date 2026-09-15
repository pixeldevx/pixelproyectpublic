"use client";

/* eslint-disable @next/next/no-img-element */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Eye,
  ImageIcon,
  ImagePlus,
  Loader2,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { db, storage } from '@/lib/backend';
import {
  collection,
  onSnapshot,
  query,
  where,
} from '@/lib/supabase/document-store';
import {
  getAuthorizedDownloadURL,
  ref,
} from '@/lib/supabase/storage-shim';
import {
  canUserAccessDocument,
} from '@/lib/document-storage';
import { ProjectDocumentViewer } from '@/components/projects/ProjectDocumentViewer';
import { supabase } from '@/lib/supabase/client';

export type StoryVisualEvidenceOption = string | {
  id: string;
  label?: string;
  title?: string;
  name?: string;
};

export type StoryVisualEvidence = {
  id: string;
  projectId: string;
  storyId: string;
  storyTitle: string;
  section: string;
  criterionId?: string | null;
  fieldId?: string | null;
  roleId?: string | null;
  caption: string;
  altText: string;
  order: number;
  name: string;
  fileName: string;
  fileSize?: number;
  contentType?: string | null;
  storagePath: string;
  storageFolder?: string;
  url?: string;
  previewUrl?: string;
  uploadedBy?: string | null;
  uploadedAt?: any;
  accessMode?: 'all' | 'restricted';
  allowedMemberIds?: string[];
  [key: string]: any;
};

export type StoryVisualEvidenceGalleryProps = {
  projectId: string;
  project?: any;
  story: any;
  stories?: any[];
  currentUser: any;
  teamMembers?: any[];
  sections?: StoryVisualEvidenceOption[];
  criteria?: StoryVisualEvidenceOption[];
  fields?: StoryVisualEvidenceOption[];
  roles?: StoryVisualEvidenceOption[];
  canUpload?: boolean;
  canManageAccess?: boolean;
  canDelete?: boolean;
  canReorder?: boolean;
  onVisibleEvidenceChange?: (evidence: StoryVisualEvidence[]) => void;
  className?: string;
};

type NormalizedOption = {
  id: string;
  label: string;
};

const MAX_IMAGE_SIZE = 4 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg']);
const EMPTY_LIST: any[] = [];
const EMPTY_OPTIONS: StoryVisualEvidenceOption[] = [];

const normalizeOptions = (options: StoryVisualEvidenceOption[] = []): NormalizedOption[] => {
  const seen = new Set<string>();
  return options.flatMap((option) => {
    const label = typeof option === 'string'
      ? option.trim()
      : String(option.label || option.title || option.name || '').trim();
    const id = typeof option === 'string' ? label : String(option.id || label).trim();
    const key = `${id}:${label}`.toLocaleLowerCase('es');
    if (!id || !label || seen.has(key)) return [];
    seen.add(key);
    return [{ id, label }];
  });
};

const isImageFile = (file: File) => {
  if (file.type && !['image/png', 'image/jpeg'].includes(file.type.toLowerCase())) return false;
  const extension = file.name.toLowerCase().split('.').pop() || '';
  return IMAGE_EXTENSIONS.has(extension);
};

const getEvidenceAccessToken = async () => {
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token) throw new Error('Tu sesión de Pixel expiró. Vuelve a iniciar sesión.');
  return token;
};

const parseEvidenceApiResponse = async (response: Response) => {
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || 'No se pudo actualizar la evidencia visual.');
  return payload;
};

const formatFileSize = (bytes?: number) => {
  const value = Number(bytes || 0);
  if (!value) return '';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

const normalizeEvidence = (id: string, data: Record<string, any>): StoryVisualEvidence | null => {
  if (data?.deletedAt) return null;
  if (data?.type !== 'story_visual_evidence') return null;
  const storyId = String(data?.storyId || data?.taskId || '').trim();
  const storagePath = String(data?.storagePath || '').trim();
  if (!storyId || !storagePath) return null;
  return {
    ...data,
    id,
    projectId: String(data?.projectId || ''),
    storyId,
    storyTitle: String(data?.storyTitle || data?.taskTitle || 'Historia de usuario'),
    section: String(data?.section || 'General'),
    caption: String(data?.caption || ''),
    altText: String(data?.altText || data?.caption || data?.name || 'Evidencia visual'),
    order: Math.max(0, Number(data?.order || 0)),
    name: String(data?.name || data?.fileName || 'Evidencia visual'),
    fileName: String(data?.fileName || data?.name || 'evidencia'),
    storagePath,
    accessMode: data?.accessMode === 'restricted' ? 'restricted' : 'all',
    allowedMemberIds: Array.isArray(data?.allowedMemberIds) ? data.allowedMemberIds.filter(Boolean) : [],
  } as StoryVisualEvidence;
};

export const getStoryVisualEvidenceDownloadUrl = async (evidence: StoryVisualEvidence) => {
  if (evidence.storagePath) {
    return getAuthorizedDownloadURL(ref(storage, evidence.storagePath));
  }
  if (evidence.url) return evidence.url;
  throw new Error('La evidencia no tiene una ruta disponible.');
};

export function StoryVisualEvidenceGallery({
  projectId,
  story,
  currentUser,
  teamMembers = EMPTY_LIST,
  sections = EMPTY_OPTIONS,
  criteria = EMPTY_OPTIONS,
  fields = EMPTY_OPTIONS,
  roles = EMPTY_OPTIONS,
  canUpload = false,
  canManageAccess = false,
  canDelete = false,
  canReorder = canManageAccess,
  onVisibleEvidenceChange,
  className = '',
}: StoryVisualEvidenceGalleryProps) {
  const [evidence, setEvidence] = useState<StoryVisualEvidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [section, setSection] = useState('General');
  const [criterionId, setCriterionId] = useState('');
  const [fieldId, setFieldId] = useState('');
  const [roleId, setRoleId] = useState('');
  const [caption, setCaption] = useState('');
  const [altText, setAltText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [reordering, setReordering] = useState(false);
  const [previewEvidence, setPreviewEvidence] = useState<StoryVisualEvidence | null>(null);
  const [authorizedUrls, setAuthorizedUrls] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const visibleChangeRef = useRef(onVisibleEvidenceChange);
  visibleChangeRef.current = onVisibleEvidenceChange;

  const sectionOptions = useMemo(() => normalizeOptions(sections), [sections]);
  const criterionOptions = useMemo(() => normalizeOptions(criteria), [criteria]);
  const fieldOptions = useMemo(() => normalizeOptions(fields), [fields]);
  const roleOptions = useMemo(() => normalizeOptions(roles), [roles]);
  const documentStory = useMemo(
    () => story ? { ...story, projectId: story.projectId || projectId } : null,
    [projectId, story],
  );

  useEffect(() => {
    const preferredSection = sectionOptions[0]?.label || 'General';
    if (section === 'General' || !section.trim()) {
      Promise.resolve().then(() => setSection(preferredSection));
    }
  }, [section, sectionOptions]);

  useEffect(() => {
    if (!projectId || !story?.id) return;
    const documentsQuery = query(
      collection(db, 'projects', projectId, 'documents'),
      where('taskId', '==', story.id),
    );
    return onSnapshot(
      documentsQuery,
      (snapshot) => {
        const nextEvidence = snapshot.docs
          .map((entry) => normalizeEvidence(entry.id, entry.data()))
          .filter((entry): entry is StoryVisualEvidence => Boolean(entry))
          .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name, 'es'));
        setEvidence(nextEvidence);
        setLoading(false);
        setLoadError('');
      },
      (error) => {
        console.error('Error loading story visual evidence:', error);
        setLoading(false);
        setLoadError('No se pudieron cargar las evidencias visuales.');
      },
    );
  }, [projectId, story?.id]);

  const visibleEvidence = useMemo(
    () => evidence.filter((item) => (
      item.storyId === String(story?.id || '') &&
      canUserAccessDocument({
        document: item,
        currentUser,
        teamMembers,
        canManageAccess,
      })
    )),
    [canManageAccess, currentUser, evidence, story?.id, teamMembers],
  );

  useEffect(() => {
    let active = true;
    if (visibleEvidence.length === 0) {
      Promise.resolve().then(() => {
        if (active) setAuthorizedUrls({});
      });
      return () => { active = false; };
    }

    Promise.all(visibleEvidence.map(async (item) => {
      try {
        return [item.id, await getStoryVisualEvidenceDownloadUrl(item)] as const;
      } catch (error) {
        console.error(`Error authorizing visual evidence ${item.id}:`, error);
        return [item.id, ''] as const;
      }
    })).then((entries) => {
      if (active) setAuthorizedUrls(Object.fromEntries(entries));
    });

    return () => { active = false; };
  }, [visibleEvidence]);

  const visibleEvidenceForConsumers = useMemo(
    () => visibleEvidence.map((item) => ({ ...item, previewUrl: authorizedUrls[item.id] || '' })),
    [authorizedUrls, visibleEvidence],
  );

  useEffect(() => {
    visibleChangeRef.current?.(visibleEvidenceForConsumers);
  }, [visibleEvidenceForConsumers]);

  const resetForm = () => {
    setFile(null);
    setCriterionId('');
    setFieldId('');
    setRoleId('');
    setCaption('');
    setAltText('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileChange = (nextFile: File | null) => {
    if (nextFile && !isImageFile(nextFile)) {
      toast.error('Solo se permiten imágenes PNG o JPG.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      setFile(null);
      return;
    }
    if (nextFile && nextFile.size > MAX_IMAGE_SIZE) {
      toast.error('La imagen supera el límite de 4 MB.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      setFile(null);
      return;
    }
    setFile(nextFile);
    if (nextFile && !altText.trim()) {
      setAltText(nextFile.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '));
    }
  };

  const handleUpload = async () => {
    if (!canUpload || !documentStory || !currentUser || uploading) return;
    if (!file) {
      toast.warning('Selecciona una imagen.');
      return;
    }
    if (!isImageFile(file)) {
      toast.error('Solo se permiten archivos de imagen.');
      return;
    }
    if (!section.trim()) {
      toast.warning('Selecciona la sección de la historia.');
      return;
    }
    if (!altText.trim()) {
      toast.warning('Escribe un texto alternativo para la imagen.');
      return;
    }
    setUploading(true);
    try {
      const accessToken = await getEvidenceAccessToken();
      const body = new FormData();
      body.append('file', file, file.name);
      body.append('section', section.trim());
      body.append('caption', caption.trim());
      body.append('altText', altText.trim());
      if (criterionId) body.append('criterionId', criterionId);
      if (fieldId) body.append('fieldId', fieldId);
      if (roleId) body.append('roleId', roleId);
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/scrum/stories/${encodeURIComponent(String(documentStory.id))}/evidence`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
          body,
          cache: 'no-store',
        },
      );
      await parseEvidenceApiResponse(response);
      resetForm();
      toast.success('Evidencia visual agregada a la historia.');
    } catch (error: any) {
      console.error('Error uploading story visual evidence:', error);
      toast.error(error?.message || 'No se pudo subir la evidencia visual.');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (item: StoryVisualEvidence) => {
    if (!canDelete || deletingId) return;
    if (!window.confirm(`¿Eliminar la evidencia “${item.caption || item.fileName}”?`)) return;
    setDeletingId(item.id);
    try {
      const accessToken = await getEvidenceAccessToken();
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/scrum/stories/${encodeURIComponent(String(story.id))}/evidence`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ evidenceId: item.id }),
          cache: 'no-store',
        },
      );
      await parseEvidenceApiResponse(response);
      toast.success('Evidencia visual eliminada.');
    } catch (error: any) {
      console.error('Error deleting story visual evidence:', error);
      toast.error(error?.message || 'No se pudo eliminar la evidencia.');
    } finally {
      setDeletingId('');
    }
  };

  const moveEvidence = async (itemId: string, direction: -1 | 1) => {
    if (!canReorder || reordering) return;
    const currentIndex = visibleEvidence.findIndex((item) => item.id === itemId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= visibleEvidence.length) return;
    const reordered = [...visibleEvidence];
    const [moved] = reordered.splice(currentIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    setReordering(true);
    try {
      const accessToken = await getEvidenceAccessToken();
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/scrum/stories/${encodeURIComponent(String(story.id))}/evidence`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ orderedIds: reordered.map((item) => item.id) }),
          cache: 'no-store',
        },
      );
      await parseEvidenceApiResponse(response);
    } catch (error: any) {
      console.error('Error reordering story visual evidence:', error);
      toast.error(error?.message || 'No se pudo guardar el orden de las evidencias.');
    } finally {
      setReordering(false);
    }
  };

  return (
    <section className={`min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white ${className}`}>
      <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ImageIcon size={18} className="shrink-0 text-violet-600" />
            <h3 className="text-sm font-black text-slate-950">Evidencias visuales</h3>
            <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-black text-violet-700">
              {visibleEvidence.length}
            </span>
          </div>
          <p className="mt-1 text-xs font-medium text-slate-500">
            Capturas, diagramas y referencias visuales vinculadas a la historia.
          </p>
        </div>
      </div>

      {canUpload && (
        <div className="border-b border-slate-200 bg-slate-50 p-4">
          <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="block min-w-0 xl:col-span-2">
              <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Imagen *</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".png,.jpg,.jpeg,image/png,image/jpeg"
                onChange={(event) => handleFileChange(event.target.files?.[0] || null)}
                className="block h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-600 file:mr-3 file:h-full file:border-0 file:bg-violet-50 file:px-3 file:text-xs file:font-black file:text-violet-700"
              />
            </label>
            <label className="block min-w-0">
              <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Sección *</span>
              {sectionOptions.length > 0 ? (
                <select value={section} onChange={(event) => setSection(event.target.value)} className="h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800">
                  {sectionOptions.map((option) => <option key={option.id} value={option.label}>{option.label}</option>)}
                </select>
              ) : (
                <input value={section} onChange={(event) => setSection(event.target.value)} placeholder="Ej. Flujo y estados" className="h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800" />
              )}
            </label>
            <label className="block min-w-0">
              <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Criterio relacionado</span>
              <select value={criterionId} onChange={(event) => setCriterionId(event.target.value)} className="h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800">
                <option value="">Ninguno</option>
                {criterionOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
            <label className="block min-w-0 md:col-span-2">
              <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Descripción visible</span>
              <input value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={240} placeholder="Qué demuestra esta imagen" className="h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800" />
            </label>
            <label className="block min-w-0 md:col-span-2">
              <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Texto alternativo *</span>
              <input value={altText} onChange={(event) => setAltText(event.target.value)} maxLength={300} placeholder="Describe la imagen para accesibilidad" className="h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800" />
            </label>
            {fieldOptions.length > 0 && (
              <label className="block min-w-0">
                <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Campo relacionado</span>
                <select value={fieldId} onChange={(event) => setFieldId(event.target.value)} className="h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800">
                  <option value="">Ninguno</option>
                  {fieldOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              </label>
            )}
            {roleOptions.length > 0 && (
              <label className="block min-w-0">
                <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Rol relacionado</span>
                <select value={roleId} onChange={(event) => setRoleId(event.target.value)} className="h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800">
                  <option value="">Ninguno</option>
                  {roleOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              </label>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-500">PNG o JPG, máximo 4 MB. La evidencia queda disponible para el equipo del proyecto.</p>
            <button type="button" onClick={() => void handleUpload()} disabled={!file || !altText.trim() || uploading} className="inline-flex h-10 items-center justify-center rounded-xl bg-violet-600 px-4 text-sm font-black text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50">
              {uploading ? <Loader2 size={16} className="mr-2 animate-spin" /> : <ImagePlus size={16} className="mr-2" />}
              {uploading ? 'Subiendo...' : 'Agregar evidencia'}
            </button>
          </div>
        </div>
      )}

      <div className="p-4">
        {loading ? (
          <div className="flex min-h-32 items-center justify-center gap-2 text-sm font-bold text-slate-500"><Loader2 size={18} className="animate-spin text-violet-600" />Cargando evidencias...</div>
        ) : loadError ? (
          <div className="rounded-xl border border-rose-100 bg-rose-50 p-4 text-sm font-bold text-rose-700">{loadError}</div>
        ) : visibleEvidence.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
            <ImageIcon size={32} className="mx-auto text-slate-300" />
            <p className="mt-2 text-sm font-black text-slate-700">Sin evidencias visuales</p>
            <p className="mt-1 text-xs font-medium text-slate-500">Agrega una captura, diagrama o referencia para documentar la historia.</p>
          </div>
        ) : (
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visibleEvidence.map((item, index) => {
              const imageUrl = authorizedUrls[item.id] || '';
              return (
                <figure key={item.id} className="group min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <button type="button" onClick={() => setPreviewEvidence(item)} className="relative block aspect-video w-full overflow-hidden bg-slate-100 text-left" aria-label={`Ver evidencia: ${item.altText}`}>
                    {imageUrl ? (
                      <img src={imageUrl} alt={item.altText} loading="lazy" className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]" />
                    ) : (
                      <span className="flex h-full items-center justify-center"><Loader2 size={22} className="animate-spin text-violet-500" /></span>
                    )}
                    <span className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-slate-950/75 text-white opacity-0 transition group-hover:opacity-100"><Eye size={15} /></span>
                  </button>
                  <figcaption className="p-3">
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-black uppercase tracking-[0.12em] text-violet-700">{item.section}</p>
                        <p className="mt-1 line-clamp-2 text-sm font-bold leading-5 text-slate-900">{item.caption || item.fileName}</p>
                        <p className="mt-1 truncate text-[11px] font-medium text-slate-500">{formatFileSize(item.fileSize)}{item.accessMode === 'restricted' ? ' · Restringida' : ''}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        {canReorder && (
                          <>
                            <button type="button" disabled={index === 0 || reordering} onClick={() => void moveEvidence(item.id, -1)} className="rounded-md p-1.5 text-slate-400 hover:bg-violet-50 hover:text-violet-700 disabled:opacity-30" aria-label={`Subir posición de ${item.caption || item.fileName}`}><ArrowUp size={14} /></button>
                            <button type="button" disabled={index === visibleEvidence.length - 1 || reordering} onClick={() => void moveEvidence(item.id, 1)} className="rounded-md p-1.5 text-slate-400 hover:bg-violet-50 hover:text-violet-700 disabled:opacity-30" aria-label={`Bajar posición de ${item.caption || item.fileName}`}><ArrowDown size={14} /></button>
                          </>
                        )}
                        {canDelete && (
                          <button type="button" disabled={deletingId === item.id} onClick={() => void handleDelete(item)} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40" aria-label={`Eliminar ${item.caption || item.fileName}`}>
                            {deletingId === item.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                          </button>
                        )}
                      </div>
                    </div>
                    {(item.criterionId || item.fieldId || item.roleId) && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {item.criterionId && <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">Criterio</span>}
                        {item.fieldId && <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">Campo</span>}
                        {item.roleId && <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">Rol</span>}
                      </div>
                    )}
                  </figcaption>
                </figure>
              );
            })}
          </div>
        )}
      </div>

      <ProjectDocumentViewer
        document={previewEvidence}
        isOpen={Boolean(previewEvidence)}
        onClose={() => setPreviewEvidence(null)}
      />
    </section>
  );
}
