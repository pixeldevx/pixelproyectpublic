import React, { useCallback, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Download, ExternalLink, Eye, File, FileText, Folder, FolderPlus, Lock, Save, Trash2, Upload, X } from 'lucide-react';
import { canUserAccessDocument, getDocumentAccessMode, isDocumentFolder } from '@/lib/document-storage';

interface ProjectDocumentsTreeProps {
  documents: any[];
  tasks: any[];
  onDeleteDocument: (docId: string, storagePath: string, name: string, versionStoragePaths?: string[]) => void;
  onViewDocument?: (doc: any) => void;
  onCreateFolder?: (name: string, parentFolderId: string | null) => Promise<void> | void;
  onUploadToFolder?: (folderId: string | null) => void;
  onUpdateFolderAccess?: (folderId: string, accessMode: 'all' | 'restricted', allowedMemberIds: string[]) => Promise<void> | void;
  searchQuery?: string;
  currentUser?: any;
  teamMembers?: any[];
  canManageAccess?: boolean;
  canDeleteDocuments?: boolean;
  canCreateFolders?: boolean;
}

const formatFileSize = (bytes?: number) => {
  if (!Number(bytes)) return '';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(Number(bytes)) / Math.log(k));
  return parseFloat((Number(bytes) / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const formatUploadedAt = (value: any) => {
  if (!value) return '';
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
};

const getDocTypeBadge = (type: string) => {
  switch (type) {
    case 'contract':
      return <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-bold text-blue-700">Contrato</span>;
    case 'proposal':
      return <span className="rounded-full bg-purple-100 px-2 py-1 text-xs font-bold text-purple-700">Propuesta</span>;
    case 'task_completion':
      return <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-700">Evidencia tarea</span>;
    case 'workflow_start':
      return <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-700">Inicio workflow</span>;
    default:
      return <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">Otro</span>;
  }
};

const getTaskTitle = (task: any) => task?.title || task?.name || task?.externalWorkflowId || 'Sin título';

const DocumentItem = ({
  doc,
  onDeleteDocument,
  onViewDocument,
  canDeleteDocuments,
}: {
  doc: any;
  onDeleteDocument: ProjectDocumentsTreeProps['onDeleteDocument'];
  onViewDocument?: (doc: any) => void;
  canDeleteDocuments: boolean;
}) => {
  const uploadedAt = formatUploadedAt(doc.uploadedAt);
  const restricted = getDocumentAccessMode(doc) === 'restricted';

  return (
    <div className="group flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5 last:border-0 hover:bg-slate-50">
      <button
        type="button"
        onClick={() => onViewDocument?.(doc)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-none transition focus-visible:ring-2 focus-visible:ring-indigo-500/30"
      >
        <FileText size={16} className="shrink-0 text-slate-400" />
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-sm font-bold text-slate-700">{doc.name}</span>
            {getDocTypeBadge(doc.type)}
            {Number(doc.versionCount) > 1 && (
              <span className="rounded-full bg-indigo-100 px-2 py-1 text-xs font-black text-indigo-700">
                v{Number(doc.currentVersion) || Number(doc.versionCount)} · {Number(doc.versionCount)} versiones
              </span>
            )}
            {restricted && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">
                <Lock size={12} />
                Restringido
              </span>
            )}
          </div>
          <div className="mt-0.5 text-xs font-medium text-slate-400">
            {doc.fileName ? `${doc.fileName}${formatFileSize(doc.fileSize) ? ` (${formatFileSize(doc.fileSize)})` : ''}` : 'Archivo del proyecto'}
            {uploadedAt ? ` · Subido el ${uploadedAt}` : ''}
          </div>
          {doc.storageFolder && (
            <div className="mt-0.5 truncate text-[11px] font-semibold text-slate-400">
              {String(doc.storageFolder).replaceAll('/', ' / ')}
            </div>
          )}
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
        <button
          type="button"
          onClick={() => onViewDocument?.(doc)}
          className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
          title="Ver en Pixel"
        >
          <Eye size={16} />
        </button>
        <button
          type="button"
          onClick={() => onViewDocument?.(doc)}
          className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
          title="Abrir con autorización"
        >
          <ExternalLink size={16} />
        </button>
        <button
          type="button"
          onClick={() => onViewDocument?.(doc)}
          className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
          title="Descargar desde el visor seguro"
        >
          <Download size={16} />
        </button>
        {canDeleteDocuments && (
          <button
            type="button"
            onClick={() => onDeleteDocument(
              doc.id,
              doc.storagePath,
              doc.name,
              Array.isArray(doc.versions)
                ? doc.versions.map((version: any) => version?.storagePath).filter(Boolean)
                : [],
            )}
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
            title="Eliminar"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </div>
  );
};

const FolderNode = ({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-2 bg-slate-50/80 p-3 text-left transition-colors hover:bg-slate-100"
      >
        {isOpen ? <ChevronDown size={18} className="text-slate-500" /> : <ChevronRight size={18} className="text-slate-500" />}
        <Folder size={18} className="text-indigo-500" />
        <span className="text-sm font-black text-slate-800">{title}</span>
      </button>
      {isOpen && <div className="border-t border-slate-100 bg-white pl-4 md:pl-6">{children}</div>}
    </div>
  );
};

const ProjectFolderBrowser = ({
  documents,
  searchQuery,
  onDeleteDocument,
  onViewDocument,
  onCreateFolder,
  onUploadToFolder,
  onUpdateFolderAccess,
  teamMembers,
  canManageAccess,
  canCreateFolders,
  canDeleteDocuments,
}: {
  documents: any[];
  searchQuery: string;
  onDeleteDocument: ProjectDocumentsTreeProps['onDeleteDocument'];
  onViewDocument?: (doc: any) => void;
  onCreateFolder?: ProjectDocumentsTreeProps['onCreateFolder'];
  onUploadToFolder?: ProjectDocumentsTreeProps['onUploadToFolder'];
  onUpdateFolderAccess?: ProjectDocumentsTreeProps['onUpdateFolderAccess'];
  teamMembers: any[];
  canManageAccess: boolean;
  canCreateFolders: boolean;
  canDeleteDocuments: boolean;
}) => {
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isSavingFolder, setIsSavingFolder] = useState(false);
  const [securityFolder, setSecurityFolder] = useState<any | null>(null);
  const [securityAccessMode, setSecurityAccessMode] = useState<'all' | 'restricted'>('all');
  const [securityMemberIds, setSecurityMemberIds] = useState<string[]>([]);
  const [isSavingSecurity, setIsSavingSecurity] = useState(false);

  const folders = useMemo(() => documents.filter((document) => isDocumentFolder(document)), [documents]);
  const files = useMemo(() => documents.filter((document) => !isDocumentFolder(document)), [documents]);
  const folderById = useMemo(
    () => new Map(folders.filter((folder) => folder?.id).map((folder) => [folder.id as string, folder])),
    [folders]
  );
  const activeFolderId = currentFolderId && folderById.has(currentFolderId) ? currentFolderId : null;
  const normalizedSearch = searchQuery.trim().toLowerCase();

  const getFolderPath = useCallback((folderId: string | null | undefined) => {
    const path: any[] = [];
    const visited = new Set<string>();
    let current = folderId ? folderById.get(folderId) : null;

    while (current?.id && !visited.has(current.id)) {
      visited.add(current.id);
      path.unshift(current);
      current = current.parentFolderId ? folderById.get(current.parentFolderId) : null;
    }

    return path;
  }, [folderById]);

  const currentBreadcrumb = getFolderPath(activeFolderId);

  const getFolderPathLabel = useCallback((folderId: string | null | undefined) => {
    const path = getFolderPath(folderId);
    return path.length ? path.map((folder) => folder.name).join(' / ') : 'Documentación del proyecto';
  }, [getFolderPath]);

  const childCountByFolderId = useMemo(() => {
    const counts = new Map<string, number>();
    documents.forEach((document) => {
      if (!document?.parentFolderId) return;
      counts.set(document.parentFolderId, (counts.get(document.parentFolderId) || 0) + 1);
    });
    return counts;
  }, [documents]);

  const matchesQuery = useCallback((document: any) => {
    if (!normalizedSearch) return true;
    return (
      document.name?.toLowerCase().includes(normalizedSearch) ||
      document.fileName?.toLowerCase().includes(normalizedSearch) ||
      document.type?.toLowerCase().includes(normalizedSearch) ||
      getFolderPathLabel(document.parentFolderId).toLowerCase().includes(normalizedSearch)
    );
  }, [getFolderPathLabel, normalizedSearch]);

  const visibleFolders = useMemo(() => {
    const sorted = [...folders].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    if (normalizedSearch) return sorted.filter(matchesQuery);
    return sorted.filter((folder) => (folder.parentFolderId || null) === activeFolderId);
  }, [activeFolderId, folders, matchesQuery, normalizedSearch]);

  const visibleFiles = useMemo(() => {
    const sorted = [...files].sort((a, b) => {
      const aTime = a.uploadedAt?.toDate ? a.uploadedAt.toDate().getTime() : new Date(a.uploadedAt || 0).getTime();
      const bTime = b.uploadedAt?.toDate ? b.uploadedAt.toDate().getTime() : new Date(b.uploadedAt || 0).getTime();
      return bTime - aTime || String(a.name || '').localeCompare(String(b.name || ''));
    });
    if (normalizedSearch) return sorted.filter(matchesQuery);
    return sorted.filter((document) => (document.parentFolderId || null) === activeFolderId);
  }, [activeFolderId, files, matchesQuery, normalizedSearch]);

  const handleCreateFolder = async () => {
    const cleanName = newFolderName.trim();
    if (!cleanName || !onCreateFolder) return;

    setIsSavingFolder(true);
    try {
      await onCreateFolder(cleanName, activeFolderId);
      setNewFolderName('');
      setIsCreatingFolder(false);
    } finally {
      setIsSavingFolder(false);
    }
  };

  const openFolderSecurity = (folder: any) => {
    setSecurityFolder(folder);
    setSecurityAccessMode(getDocumentAccessMode(folder) === 'restricted' ? 'restricted' : 'all');
    setSecurityMemberIds(Array.isArray(folder.allowedMemberIds) ? folder.allowedMemberIds : []);
  };

  const toggleSecurityMember = (memberId: string) => {
    setSecurityMemberIds((current) =>
      current.includes(memberId) ? current.filter((id) => id !== memberId) : [...current, memberId]
    );
  };

  const saveFolderSecurity = async () => {
    if (!securityFolder || !onUpdateFolderAccess) return;
    if (securityAccessMode === 'restricted' && securityMemberIds.length === 0) return;
    setIsSavingSecurity(true);
    try {
      await onUpdateFolderAccess(
        securityFolder.id,
        securityAccessMode,
        securityAccessMode === 'restricted' ? securityMemberIds : []
      );
      setSecurityFolder(null);
    } finally {
      setIsSavingSecurity(false);
    }
  };

  return (
    <div className="space-y-4 p-1">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 text-xs font-black text-slate-500">
            <button
              type="button"
              onClick={() => setCurrentFolderId(null)}
              className={`rounded-full px-2.5 py-1 transition ${!activeFolderId ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-indigo-50 hover:text-indigo-700'}`}
            >
              Proyecto
            </button>
            {currentBreadcrumb.map((folder) => (
              <React.Fragment key={folder.id}>
                <ChevronRight size={14} className="text-slate-300" />
                <button
                  type="button"
                  onClick={() => setCurrentFolderId(folder.id)}
                  className="max-w-44 truncate rounded-full bg-white px-2.5 py-1 text-slate-700 transition hover:bg-indigo-50 hover:text-indigo-700"
                >
                  {folder.name}
                </button>
              </React.Fragment>
            ))}
          </div>
          <p className="mt-2 text-xs font-semibold text-slate-400">
            {normalizedSearch
              ? 'Mostrando coincidencias en todas las carpetas.'
              : activeFolderId
                ? `Dentro de ${getFolderPathLabel(activeFolderId)}`
                : 'Raíz documental del proyecto.'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {canCreateFolders && onCreateFolder && (
            <button
              type="button"
              onClick={() => setIsCreatingFolder((value) => !value)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
            >
              <FolderPlus size={15} />
              Nueva carpeta
            </button>
          )}
          {onUploadToFolder && (
            <button
              type="button"
              onClick={() => onUploadToFolder(activeFolderId)}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-black text-white shadow-sm transition hover:bg-indigo-700"
            >
              <Upload size={15} />
              Subir aquí
            </button>
          )}
        </div>
      </div>

      {isCreatingFolder && (
        <div className="flex flex-col gap-2 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-3 sm:flex-row">
          <input
            type="text"
            value={newFolderName}
            onChange={(event) => setNewFolderName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleCreateFolder();
              }
            }}
            className="min-h-10 flex-1 rounded-xl border border-indigo-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            placeholder="Nombre de la carpeta"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setIsCreatingFolder(false);
                setNewFolderName('');
              }}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleCreateFolder}
              disabled={!newFolderName.trim() || isSavingFolder}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSavingFolder ? 'Creando...' : 'Crear'}
            </button>
          </div>
        </div>
      )}

      {(visibleFolders.length > 0 || visibleFiles.length > 0) ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {visibleFolders.map((folder) => {
            const childCount = childCountByFolderId.get(folder.id) || 0;
            const canDeleteFolder = canDeleteDocuments && childCount === 0;

            return (
              <div key={folder.id} className="group flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 hover:bg-indigo-50/50">
                <button
                  type="button"
                  onClick={() => setCurrentFolderId(folder.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
                    <Folder size={18} />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="block truncate text-sm font-black text-slate-800">{folder.name}</span>
                      {getDocumentAccessMode(folder) === 'restricted' && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-700">
                          <Lock size={10} /> Restringida
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs font-semibold text-slate-400">
                      {normalizedSearch ? getFolderPathLabel(folder.parentFolderId) : `${childCount} elemento${childCount === 1 ? '' : 's'}`}
                    </span>
                  </span>
                </button>
                <div className="flex items-center gap-1">
                  {canManageAccess && onUpdateFolderAccess && (
                    <button type="button" onClick={() => openFolderSecurity(folder)} className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-amber-50 hover:text-amber-700" title="Gestionar seguridad"><Lock size={16} /></button>
                  )}
                  {canDeleteDocuments && (
                    <button
                      type="button"
                      onClick={() => canDeleteFolder && onDeleteDocument(folder.id, '', folder.name)}
                      disabled={!canDeleteFolder}
                      className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                      title={canDeleteFolder ? 'Eliminar carpeta' : 'La carpeta debe estar vacía para eliminarla'}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {visibleFiles.map((document) => (
            <DocumentItem
              key={document.id}
              doc={document}
              onDeleteDocument={onDeleteDocument}
              onViewDocument={onViewDocument}
              canDeleteDocuments={canDeleteDocuments}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center">
          <Folder className="mx-auto mb-3 h-10 w-10 text-slate-200" />
          <h3 className="text-sm font-black text-slate-800">
            {normalizedSearch ? 'No hay coincidencias en carpetas' : 'Esta carpeta está vacía'}
          </h3>
          <p className="mt-1 text-xs font-semibold text-slate-400">
            {normalizedSearch ? 'Prueba con otro nombre, archivo o ruta.' : 'Crea una carpeta o sube documentos en esta ubicación.'}
          </p>
        </div>
      )}

      {securityFolder && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-[11px] font-black uppercase tracking-[0.18em] text-amber-600">Seguridad heredable</p><h3 className="mt-1 text-xl font-black text-slate-900">{securityFolder.name}</h3><p className="mt-2 text-sm font-medium leading-6 text-slate-500">Esta regla protege todos los archivos y subcarpetas. Una subcarpeta no puede ampliar el acceso bloqueado por su carpeta superior.</p></div>
              <button type="button" onClick={() => setSecurityFolder(null)} className="rounded-full p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
            </div>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm font-bold"><input type="radio" checked={securityAccessMode === 'all'} onChange={() => { setSecurityAccessMode('all'); setSecurityMemberIds([]); }} />Todo el equipo autorizado</label>
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm font-bold"><input type="radio" checked={securityAccessMode === 'restricted'} onChange={() => setSecurityAccessMode('restricted')} />Personas seleccionadas</label>
            </div>
            {securityAccessMode === 'restricted' && (
              <div className="mt-3 max-h-64 overflow-y-auto rounded-xl bg-slate-50 p-2">
                {teamMembers.map((member) => (
                  <label key={member.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-white">
                    <input type="checkbox" checked={securityMemberIds.includes(member.id)} onChange={() => toggleSecurityMember(member.id)} />
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-xs font-black text-indigo-700">{(member.name || member.email || '?').charAt(0).toUpperCase()}</span>
                    <span className="min-w-0 truncate">{member.name || member.email || 'Miembro'}</span>
                  </label>
                ))}
              </div>
            )}
            {securityAccessMode === 'restricted' && securityMemberIds.length === 0 && <p className="mt-2 text-xs font-bold text-rose-600">Selecciona al menos una persona.</p>}
            <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button type="button" onClick={() => setSecurityFolder(null)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600">Cancelar</button>
              <button type="button" onClick={saveFolderSecurity} disabled={isSavingSecurity || (securityAccessMode === 'restricted' && securityMemberIds.length === 0)} className="inline-flex items-center rounded-xl bg-indigo-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50"><Save size={15} className="mr-2" />{isSavingSecurity ? 'Guardando...' : 'Guardar seguridad'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const ProjectDocumentsTree: React.FC<ProjectDocumentsTreeProps> = ({
  documents,
  tasks,
  onDeleteDocument,
  onViewDocument,
  onCreateFolder,
  onUploadToFolder,
  onUpdateFolderAccess,
  searchQuery = '',
  currentUser,
  teamMembers = [],
  canManageAccess = false,
  canDeleteDocuments = false,
  canCreateFolders = false,
}) => {
  const accessibleDocuments = useMemo(
    () =>
      documents.filter((document) =>
        canUserAccessDocument({
          document,
          documents,
          currentUser,
          teamMembers,
          canManageAccess,
        })
      ),
    [documents, currentUser, teamMembers, canManageAccess]
  );

  const filteredDocuments = useMemo(() => {
    if (!searchQuery.trim()) return accessibleDocuments;
    const lowerQuery = searchQuery.toLowerCase();
    return accessibleDocuments.filter((document) =>
      document.name?.toLowerCase().includes(lowerQuery) ||
      document.fileName?.toLowerCase().includes(lowerQuery) ||
      document.taskTitle?.toLowerCase().includes(lowerQuery) ||
      document.taskId?.toLowerCase().includes(lowerQuery)
    );
  }, [accessibleDocuments, searchQuery]);

  const projectDocuments = useMemo(
    () => accessibleDocuments.filter((document) => !document.taskId),
    [accessibleDocuments]
  );
  const taskDocs = useMemo(
    () => filteredDocuments.filter((document) => document.taskId && !isDocumentFolder(document)),
    [filteredDocuments]
  );
  const parentTasks = useMemo(
    () => tasks.filter((task) => !task.parentTaskId).sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0)),
    [tasks]
  );

  const getSubtasks = (parentId: string) =>
    tasks.filter((task) => task.parentTaskId === parentId).sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));

  const getTaskDocuments = (taskId: string) => taskDocs.filter((document) => document.taskId === taskId);

  if (accessibleDocuments.length === 0 && !canCreateFolders && !onUploadToFolder) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-12 text-center">
        <File className="mx-auto mb-3 h-12 w-12 text-slate-200" />
        <h3 className="text-base font-bold text-slate-900">No hay documentos visibles</h3>
        <p className="mt-1 text-sm font-medium text-slate-500">Sube archivos o solicita acceso a la documentación restringida.</p>
      </div>
    );
  }

  if (filteredDocuments.length === 0 && searchQuery) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-12 text-center">
        <File className="mx-auto mb-3 h-12 w-12 text-slate-200" />
        <h3 className="text-base font-bold text-slate-900">No se encontraron documentos</h3>
        <p className="mt-1 text-sm font-medium text-slate-500">No hay documentos visibles que coincidan con &quot;{searchQuery}&quot;.</p>
      </div>
    );
  }

  const hasDocumentsInSubtree = (taskId: string): boolean => {
    if (getTaskDocuments(taskId).length > 0) return true;
    return getSubtasks(taskId).some((subtask) => hasDocumentsInSubtree(subtask.id));
  };

  const renderTaskDocuments = (documentsForTask: any[]) => {
    type DocumentFolderNode = {
      name: string;
      path: string;
      documents: any[];
      children: Map<string, DocumentFolderNode>;
    };

    const root: DocumentFolderNode = { name: '', path: '', documents: [], children: new Map() };
    documentsForTask.forEach((document) => {
      const segments = Array.isArray(document.documentFolderSegments)
        ? document.documentFolderSegments.filter(Boolean)
        : String(document.workflowDocumentFolderPath || '')
            .split('/')
            .map((segment) => segment.trim())
            .filter(Boolean);
      let current = root;
      segments.forEach((segment: string) => {
        const childPath = current.path ? `${current.path}/${segment}` : segment;
        if (!current.children.has(segment)) {
          current.children.set(segment, {
            name: segment,
            path: childPath,
            documents: [],
            children: new Map(),
          });
        }
        current = current.children.get(segment)!;
      });
      current.documents.push(document);
    });

    const renderNode = (node: DocumentFolderNode): React.ReactNode => (
      <FolderNode key={node.path} title={node.name} defaultOpen={Boolean(searchQuery)}>
        {node.documents.map((document) => (
          <DocumentItem
            key={document.id}
            doc={document}
            onDeleteDocument={onDeleteDocument}
            onViewDocument={onViewDocument}
            canDeleteDocuments={canDeleteDocuments}
          />
        ))}
        {[...node.children.values()].map(renderNode)}
      </FolderNode>
    );

    return (
      <>
        {root.documents.map((document) => (
          <DocumentItem
            key={document.id}
            doc={document}
            onDeleteDocument={onDeleteDocument}
            onViewDocument={onViewDocument}
            canDeleteDocuments={canDeleteDocuments}
          />
        ))}
        {[...root.children.values()].map(renderNode)}
      </>
    );
  };

  const renderTaskNode = (task: any) => {
    const taskTitle = getTaskTitle(task);
    const matchesSearch = searchQuery.trim() && (
      taskTitle.toLowerCase().includes(searchQuery.toLowerCase()) ||
      task.id?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    if (!hasDocumentsInSubtree(task.id) && !matchesSearch) return null;

    const subtasks = getSubtasks(task.id);
    const docs = getTaskDocuments(task.id);

    return (
      <FolderNode key={task.id} title={taskTitle} defaultOpen={!!searchQuery}>
        {docs.length > 0 && (
          <div className="py-1">
            {renderTaskDocuments(docs)}
          </div>
        )}
        {subtasks.length > 0 && (
          <div className="my-2 ml-3 border-l border-slate-100 py-2 pl-3 md:ml-4 md:pl-4">
            {subtasks.map((subtask) => renderTaskNode(subtask))}
          </div>
        )}
      </FolderNode>
    );
  };

  const renderedTasks = parentTasks.map((task) => renderTaskNode(task)).filter(Boolean);
  const allTaskIds = new Set(tasks.map((task) => task.id));
  const orphanedDocs = taskDocs.filter((document) => !allTaskIds.has(document.taskId));

  return (
    <div className="space-y-4">
      <FolderNode title="Documentación del proyecto" defaultOpen>
        <ProjectFolderBrowser
          documents={projectDocuments}
          searchQuery={searchQuery}
          onDeleteDocument={onDeleteDocument}
          onViewDocument={onViewDocument}
          onCreateFolder={onCreateFolder}
          onUploadToFolder={onUploadToFolder}
          onUpdateFolderAccess={onUpdateFolderAccess}
          teamMembers={teamMembers}
          canManageAccess={canManageAccess}
          canCreateFolders={canCreateFolders}
          canDeleteDocuments={canDeleteDocuments}
        />
      </FolderNode>

      {(renderedTasks.length > 0 || orphanedDocs.length > 0) && (
        <FolderNode title="Documentos de tareas y subtareas" defaultOpen>
          <div className="p-3">
            {renderedTasks}

            {orphanedDocs.length > 0 && (
              <FolderNode title="Tareas eliminadas o sin vínculo" defaultOpen={false}>
                <div className="py-1">
                  {orphanedDocs.map((document) => (
                    <DocumentItem
                      key={document.id}
                      doc={document}
                      onDeleteDocument={onDeleteDocument}
                      onViewDocument={onViewDocument}
                      canDeleteDocuments={canDeleteDocuments}
                    />
                  ))}
                </div>
              </FolderNode>
            )}
          </div>
        </FolderNode>
      )}
    </div>
  );
};
