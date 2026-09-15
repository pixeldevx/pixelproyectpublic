import React, { useEffect, useMemo, useState } from 'react';
import { FileText, Files, Folder, FolderTree, Lock, Upload, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { db, storage } from '@/lib/backend';
import { ref, uploadBytes, getDownloadURL } from '@/lib/supabase/storage-shim';
import { collection, addDoc, serverTimestamp } from '@/lib/supabase/document-store';
import {
  buildDocumentStoragePath,
  getDocumentFolderStorageSegments,
  getProjectTeamMembers,
  getTaskStorageFolderSegments,
  isDocumentFolder,
} from '@/lib/document-storage';
import { createFolderPathFromRelativeSegments } from '@/lib/document-folders';
import { toast } from 'sonner';

interface UploadDocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  user: any;
  project?: any;
  tasks?: any[];
  documents?: any[];
  initialFolderId?: string | null;
  teamMembers?: any[];
  canManageAccess?: boolean;
}

type UploadScope = 'project' | 'task';
type UploadMode = 'file' | 'folder';
type AccessMode = 'all' | 'restricted';

type SelectedUpload = {
  file: File;
  relativePath: string;
  segments: string[];
};

const getTaskTitle = (task: any) =>
  task?.externalWorkflowId || task?.title || task?.name || 'Tarea sin nombre';

const getNameWithoutExtension = (fileName: string) => {
  const lastDot = fileName.lastIndexOf('.');
  return lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
};

const normalizeRelativeSegments = (value: string) =>
  String(value || '')
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== '.' && segment !== '..');

const buildTaskOptions = (tasks: any[] = []) => {
  const childrenByParent = new Map<string, any[]>();
  const roots: any[] = [];

  tasks.forEach((task) => {
    if (task?.parentTaskId) {
      const children = childrenByParent.get(task.parentTaskId) || [];
      children.push(task);
      childrenByParent.set(task.parentTaskId, children);
    } else {
      roots.push(task);
    }
  });

  const sortTasks = (items: any[]) =>
    [...items].sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0) || getTaskTitle(a).localeCompare(getTaskTitle(b)));
  const output: Array<{ task: any; label: string }> = [];
  const walk = (task: any, depth = 0) => {
    output.push({ task, label: `${depth > 0 ? `${'  '.repeat(depth)}↳ ` : ''}${getTaskTitle(task)}` });
    sortTasks(childrenByParent.get(task.id) || []).forEach((child) => walk(child, depth + 1));
  };

  sortTasks(roots).forEach((task) => walk(task));
  return output;
};

const buildFolderOptions = (documents: any[] = []) => {
  const folders = documents.filter((document) => isDocumentFolder(document));
  const childrenByParent = new Map<string, any[]>();
  const roots: any[] = [];

  folders.forEach((folder) => {
    if (folder?.parentFolderId) {
      const children = childrenByParent.get(folder.parentFolderId) || [];
      children.push(folder);
      childrenByParent.set(folder.parentFolderId, children);
    } else {
      roots.push(folder);
    }
  });

  const sortFolders = (items: any[]) =>
    [...items].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  const output: Array<{ folder: any; label: string }> = [];
  const walk = (folder: any, depth = 0) => {
    output.push({ folder, label: `${depth > 0 ? `${'  '.repeat(depth)}↳ ` : ''}${folder.name || 'Carpeta sin nombre'}` });
    sortFolders(childrenByParent.get(folder.id) || []).forEach((child) => walk(child, depth + 1));
  };

  sortFolders(roots).forEach((folder) => walk(folder));
  return output;
};

const formatFileSize = (bytes: number) => {
  if (!bytes) return '0 Bytes';
  const units = ['Bytes', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${parseFloat((bytes / Math.pow(1024, index)).toFixed(2))} ${units[index]}`;
};

export function UploadDocumentModal({
  isOpen,
  onClose,
  projectId,
  user,
  project,
  tasks = [],
  documents = [],
  initialFolderId = null,
  teamMembers = [],
  canManageAccess = false,
}: UploadDocumentModalProps) {
  const [uploadMode, setUploadMode] = useState<UploadMode>('file');
  const [selectedUploads, setSelectedUploads] = useState<SelectedUpload[]>([]);
  const [docName, setDocName] = useState('');
  const [docType, setDocType] = useState('contract');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('');
  const [scope, setScope] = useState<UploadScope>('project');
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState('');
  const [accessMode, setAccessMode] = useState<AccessMode>('all');
  const [allowedMemberIds, setAllowedMemberIds] = useState<string[]>([]);

  const projectMembers = useMemo(() => getProjectTeamMembers(project, teamMembers), [project, teamMembers]);
  const taskOptions = useMemo(() => buildTaskOptions(tasks), [tasks]);
  const folderOptions = useMemo(() => buildFolderOptions(documents), [documents]);
  const selectedTask = useMemo(
    () => taskOptions.find((option) => option.task.id === selectedTaskId)?.task || null,
    [selectedTaskId, taskOptions]
  );
  const selectedFolder = useMemo(
    () => folderOptions.find((option) => option.folder.id === selectedFolderId)?.folder || null,
    [selectedFolderId, folderOptions]
  );
  const selectedFolderSegments = useMemo(
    () => getDocumentFolderStorageSegments(selectedFolderId, folderOptions.map((option) => option.folder)),
    [selectedFolderId, folderOptions]
  );
  const totalBytes = useMemo(
    () => selectedUploads.reduce((total, item) => total + item.file.size, 0),
    [selectedUploads]
  );
  const importedFolderCount = useMemo(() => {
    const paths = new Set<string>();
    selectedUploads.forEach((item) => {
      item.segments.slice(0, -1).forEach((_, index) => paths.add(item.segments.slice(0, index + 1).join('/')));
    });
    return paths.size;
  }, [selectedUploads]);

  useEffect(() => {
    if (!isOpen) return;
    setUploadMode('file');
    setSelectedUploads([]);
    setDocName('');
    setDocType('contract');
    setUploading(false);
    setUploadProgress(0);
    setUploadStatus('');
    setScope('project');
    setSelectedTaskId('');
    setSelectedFolderId(initialFolderId || '');
    setAccessMode('all');
    setAllowedMemberIds([]);
  }, [initialFolderId, isOpen]);

  if (!isOpen) return null;

  const handleSelection = (fileList: FileList | null, mode: UploadMode) => {
    const files = Array.from(fileList || []);
    const uploads = files.map((file) => {
      const relativePath = mode === 'folder' && file.webkitRelativePath ? file.webkitRelativePath : file.name;
      const segments = normalizeRelativeSegments(relativePath);
      return { file, relativePath: segments.join('/'), segments };
    }).filter((item) => item.segments.length > 0);

    setSelectedUploads(uploads);
    if (mode === 'file' && uploads[0]) {
      setDocName(getNameWithoutExtension(uploads[0].file.name));
    }
  };

  const toggleMember = (memberId: string) => {
    setAllowedMemberIds((current) =>
      current.includes(memberId) ? current.filter((id) => id !== memberId) : [...current, memberId]
    );
  };

  const chooseMode = (mode: UploadMode) => {
    setUploadMode(mode);
    setSelectedUploads([]);
    setDocName('');
    if (mode === 'folder') {
      setScope('project');
      setSelectedTaskId('');
    }
  };

  const handleUpload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || selectedUploads.length === 0) return;
    if (uploadMode === 'file' && !docName.trim()) return;
    if (scope === 'task' && !selectedTask) {
      toast.warning('Selecciona la tarea o subtarea donde quedará este documento.');
      return;
    }
    if (accessMode === 'restricted' && allowedMemberIds.length === 0) {
      toast.warning('Selecciona al menos una persona autorizada.');
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    const batchId = crypto.randomUUID();
    const workingFolders = documents.filter((document) => isDocumentFolder(document)).map((folder) => ({ ...folder }));
    const failures: string[] = [];
    let completed = 0;

    for (const selected of selectedUploads) {
      try {
        let parentFolderId = scope === 'project' ? selectedFolderId || null : null;
        let folderSegments = scope === 'project' ? selectedFolderSegments : [];

        if (uploadMode === 'folder') {
          const relativeFolderSegments = selected.segments.slice(0, -1);
          const folderResult = await createFolderPathFromRelativeSegments({
            projectId,
            segments: relativeFolderSegments,
            parentFolderId,
            userId: user.uid,
            folders: workingFolders,
            rootAccessMode: accessMode,
            rootAllowedMemberIds: allowedMemberIds,
            batchId,
          });
          parentFolderId = folderResult.leafFolderId;
          folderSegments = getDocumentFolderStorageSegments(parentFolderId, workingFolders);
        }

        const documentName = uploadMode === 'file' ? docName.trim() : getNameWithoutExtension(selected.file.name);
        const storagePath = buildDocumentStoragePath({
          projectId,
          projectName: project?.name,
          task: scope === 'task' ? selectedTask : null,
          tasks,
          fileName: selected.file.name,
          documentName,
          folderSegments: scope === 'project' ? folderSegments : [],
        });
        const storageFolder = storagePath.split('/').slice(0, -1).join('/');
        const storageRef = ref(storage, storagePath);
        setUploadStatus(`Subiendo ${completed + 1} de ${selectedUploads.length}: ${selected.relativePath}`);
        const snapshot = await uploadBytes(storageRef, selected.file);
        const downloadURL = await getDownloadURL(snapshot.ref);

        await addDoc(collection(db, 'projects', projectId, 'documents'), {
          projectId,
          name: documentName,
          type: uploadMode === 'file' ? docType : 'other',
          itemKind: 'file',
          scope,
          parentFolderId: scope === 'project' ? parentFolderId : null,
          taskId: scope === 'task' ? selectedTask?.id || null : null,
          taskTitle: scope === 'task' ? getTaskTitle(selectedTask) : null,
          taskFolderSegments: scope === 'task' ? getTaskStorageFolderSegments(selectedTask, tasks) : [],
          projectFolderSegments: scope === 'project' ? folderSegments : [],
          url: downloadURL,
          storagePath: storageRef.fullPath,
          storageFolder,
          uploadedAt: serverTimestamp(),
          uploadedBy: user.uid,
          fileName: selected.file.name,
          fileSize: selected.file.size,
          contentType: selected.file.type || null,
          accessMode: uploadMode === 'folder' ? 'inherit' : accessMode,
          allowedMemberIds: uploadMode === 'file' && accessMode === 'restricted' ? allowedMemberIds : [],
          uploadBatchId: batchId,
          relativePath: selected.relativePath,
          uploadSource: uploadMode === 'folder' ? 'folder-import' : 'single-file',
          auditStatus: 'uploaded',
          providerPathVersion: 'structured-v2',
        });
      } catch (error: any) {
        console.error(`Error uploading ${selected.relativePath}:`, error);
        failures.push(`${selected.relativePath}: ${error?.message || 'Error desconocido'}`);
      } finally {
        completed += 1;
        setUploadProgress((completed / selectedUploads.length) * 100);
      }
    }

    setUploading(false);
    setUploadStatus('');
    if (failures.length > 0) {
      toast.error(`${selectedUploads.length - failures.length} archivo(s) cargados y ${failures.length} con error. Revisa la consola para el detalle.`);
      console.error('Folder import failures:', failures);
      return;
    }

    toast.success(
      uploadMode === 'folder'
        ? `Carpeta importada: ${selectedUploads.length} archivos auditados.`
        : 'Documento subido correctamente.'
    );
    onClose();
  };

  const previewPath = uploadMode === 'folder'
    ? `${selectedFolder ? selectedFolder.name : 'Documentación del proyecto'} / ${selectedUploads[0]?.segments[0] || 'carpeta seleccionada'}`
    : selectedUploads[0]
      ? buildDocumentStoragePath({
          projectId,
          projectName: project?.name,
          task: scope === 'task' ? selectedTask : null,
          tasks,
          fileName: selectedUploads[0].file.name,
          documentName: docName || selectedUploads[0].file.name,
          folderSegments: scope === 'project' ? selectedFolderSegments : [],
        }).split('/').slice(0, -1).join(' / ')
      : scope === 'task'
        ? 'projects / proyecto / tareas / tarea seleccionada'
        : 'projects / proyecto / documentacion-del-proyecto';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="max-h-[94vh] w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-indigo-100 p-2.5"><Upload className="h-5 w-5 text-indigo-600" /></div>
            <div>
              <h3 className="text-xl font-black text-slate-900">Cargar al gestor documental</h3>
              <p className="text-sm font-medium text-slate-500">Importa un archivo o una carpeta completa conservando su jerarquía.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={uploading} className="rounded-full p-2 text-slate-400 hover:bg-slate-100"><X size={20} /></button>
        </div>

        <form onSubmit={handleUpload} className="max-h-[calc(94vh-86px)] overflow-y-auto p-6">
          <div className="grid gap-3 md:grid-cols-2">
            <button type="button" onClick={() => chooseMode('file')} className={`rounded-2xl border p-4 text-left transition ${uploadMode === 'file' ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 hover:border-indigo-200'}`}>
              <FileText className="mb-3 h-5 w-5 text-indigo-600" />
              <p className="text-sm font-black text-slate-900">Archivo individual</p>
              <p className="mt-1 text-xs font-medium text-slate-500">Carga y clasifica un documento.</p>
            </button>
            <button type="button" onClick={() => chooseMode('folder')} className={`rounded-2xl border p-4 text-left transition ${uploadMode === 'folder' ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 hover:border-indigo-200'}`}>
              <FolderTree className="mb-3 h-5 w-5 text-indigo-600" />
              <p className="text-sm font-black text-slate-900">Carpeta completa</p>
              <p className="mt-1 text-xs font-medium text-slate-500">Conserva subcarpetas y audita cada archivo.</p>
            </button>
          </div>

          {uploadMode === 'file' && (
            <>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">Tipo de documento</label>
                  <select value={docType} onChange={(event) => setDocType(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold">
                    <option value="contract">Contrato</option><option value="proposal">Propuesta</option><option value="technical">Técnico</option><option value="evidence">Evidencia</option><option value="other">Otro documento</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">Nombre del documento</label>
                  <input value={docName} onChange={(event) => setDocName(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold" placeholder="Ej. Anexo técnico" required />
                </div>
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <button type="button" onClick={() => setScope('project')} className={`rounded-2xl border p-4 text-left ${scope === 'project' ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200'}`}><Folder className="mb-2 h-5 w-5 text-indigo-600" /><p className="text-sm font-black">Documentación del proyecto</p></button>
                <button type="button" onClick={() => setScope('task')} className={`rounded-2xl border p-4 text-left ${scope === 'task' ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200'}`}><Files className="mb-2 h-5 w-5 text-indigo-600" /><p className="text-sm font-black">Documento de tarea</p></button>
              </div>
            </>
          )}

          {scope === 'task' && uploadMode === 'file' ? (
            <div className="mt-4 space-y-2"><label className="text-sm font-bold text-slate-700">Tarea o subtarea</label><select value={selectedTaskId} onChange={(event) => setSelectedTaskId(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold"><option value="">Selecciona dónde guardar...</option>{taskOptions.map(({ task, label }) => <option key={task.id} value={task.id}>{label}</option>)}</select></div>
          ) : (
            <div className="mt-4 space-y-2"><label className="text-sm font-bold text-slate-700">Carpeta destino</label><select value={selectedFolderId} onChange={(event) => setSelectedFolderId(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold"><option value="">Documentación del proyecto / raíz</option>{folderOptions.map(({ folder, label }) => <option key={folder.id} value={folder.id}>{label}</option>)}</select></div>
          )}

          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Ruta documental</p><p className="mt-2 break-all text-sm font-bold text-slate-700">{previewPath}</p></div>

          {canManageAccess && (
            <div className="mt-5 rounded-2xl border border-slate-200 p-4">
              <div className="mb-3 flex items-center gap-2"><Lock className="h-4 w-4 text-indigo-600" /><p className="text-sm font-black text-slate-900">Seguridad {uploadMode === 'folder' ? 'de la carpeta y sus descendientes' : 'del documento'}</p></div>
              <div className="grid gap-2 md:grid-cols-2">
                <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm font-bold"><input type="radio" checked={accessMode === 'all'} onChange={() => { setAccessMode('all'); setAllowedMemberIds([]); }} />Todo el equipo del proyecto</label>
                <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm font-bold"><input type="radio" checked={accessMode === 'restricted'} onChange={() => setAccessMode('restricted')} />Solo personas seleccionadas</label>
              </div>
              {accessMode === 'restricted' && <div className="mt-3 max-h-44 overflow-y-auto rounded-xl bg-slate-50 p-2">{projectMembers.map((member) => <label key={member.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-white"><input type="checkbox" checked={allowedMemberIds.includes(member.id)} onChange={() => toggleMember(member.id)} /><span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 text-xs font-black text-indigo-700">{(member.name || member.email || '?').charAt(0).toUpperCase()}</span><span className="min-w-0 truncate">{member.name || member.email || 'Miembro'}</span></label>)}</div>}
            </div>
          )}

          <div className="mt-5 space-y-2">
            <label className="text-sm font-bold text-slate-700">{uploadMode === 'folder' ? 'Carpeta de origen' : 'Archivo'}</label>
            <div className="relative cursor-pointer rounded-2xl border-2 border-dashed border-slate-200 p-6 text-center transition hover:bg-slate-50">
              {uploadMode === 'folder' ? (
                <input type="file" multiple onChange={(event) => handleSelection(event.target.files, 'folder')} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" {...({ webkitdirectory: '', directory: '' } as any)} />
              ) : (
                <input type="file" onChange={(event) => handleSelection(event.target.files, 'file')} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
              )}
              <div className="flex flex-col items-center gap-2">
                {uploadMode === 'folder' ? <FolderTree className="h-9 w-9 text-slate-400" /> : <FileText className="h-9 w-9 text-slate-400" />}
                {selectedUploads.length > 0 ? <><span className="font-bold text-indigo-600">{uploadMode === 'folder' ? selectedUploads[0].segments[0] : selectedUploads[0].file.name}</span><span className="text-xs font-semibold text-slate-500">{selectedUploads.length} archivo(s) · {importedFolderCount} carpeta(s) · {formatFileSize(totalBytes)}</span></> : <span className="text-sm text-slate-600">{uploadMode === 'folder' ? 'Haz clic para seleccionar una carpeta completa' : 'Haz clic o arrastra un archivo aquí'}</span>}
              </div>
            </div>
            {uploadMode === 'folder' && <p className="text-xs font-semibold leading-5 text-slate-400">Los navegadores no informan carpetas totalmente vacías; se conservarán todas las carpetas que contengan archivos.</p>}
          </div>

          {uploading && <div className="mt-4 space-y-2"><div className="flex justify-between gap-4 text-xs font-bold text-slate-500"><span className="truncate">{uploadStatus || 'Preparando carga...'}</span><span>{Math.round(uploadProgress)}%</span></div><div className="h-1.5 w-full rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-indigo-600 transition-all" style={{ width: `${uploadProgress}%` }} /></div></div>}

          <div className="mt-6 flex flex-col-reverse justify-end gap-3 border-t border-slate-100 pt-4 sm:flex-row">
            <Button type="button" variant="outline" onClick={onClose} disabled={uploading}>Cancelar</Button>
            <Button type="submit" disabled={selectedUploads.length === 0 || uploading || (uploadMode === 'file' && !docName.trim())} className="bg-indigo-600 text-white hover:bg-indigo-700"><Users size={16} className="mr-2" />{uploading ? 'Procesando...' : uploadMode === 'folder' ? 'Importar carpeta' : 'Guardar documento'}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
