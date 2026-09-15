import React, { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, where } from '@/lib/supabase/document-store';
import { deleteObject, getDownloadURL, ref, uploadBytes } from '@/lib/supabase/storage-shim';
import { db, storage } from '@/lib/backend';
import { Download, ExternalLink, Eye, FileText, Loader2, Lock, Trash2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { getTaskDisplayTitle } from '@/lib/task-title';
import { ProjectDocumentViewer } from '@/components/projects/ProjectDocumentViewer';
import {
  buildDocumentStoragePath,
  canUserAccessDocument,
  getProjectTeamMembers,
  getTaskStorageFolderSegments,
} from '@/lib/document-storage';

interface TaskDocumentsViewerProps {
  isOpen: boolean;
  onClose: () => void;
  task: any;
  userId: string;
  currentUser?: any;
  project?: any;
  tasks?: any[];
  teamMembers?: any[];
  canUploadDocuments?: boolean;
  canManageAccess?: boolean;
  canDeleteDocuments?: boolean;
}

export const TaskDocumentsViewer: React.FC<TaskDocumentsViewerProps> = ({
  isOpen,
  onClose,
  task,
  userId,
  currentUser,
  project,
  tasks = [],
  teamMembers = [],
  canUploadDocuments = true,
  canManageAccess = false,
  canDeleteDocuments = true,
}) => {
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewDocument, setPreviewDocument] = useState<any | null>(null);
  const [accessMode, setAccessMode] = useState<'all' | 'restricted'>('all');
  const [allowedMemberIds, setAllowedMemberIds] = useState<string[]>([]);
  const isUserStory = task?.scrumKind === 'story' || task?.kind === 'story';
  const entityLabel = isUserStory ? 'historia de usuario' : 'tarea';

  const viewer = useMemo(() => currentUser || { uid: userId }, [currentUser, userId]);
  const projectMembers = useMemo(
    () => getProjectTeamMembers(project, teamMembers),
    [project, teamMembers]
  );
  const visibleDocuments = useMemo(
    () =>
      documents.filter((document) =>
        canUserAccessDocument({
          document,
          currentUser: viewer,
          teamMembers,
          canManageAccess,
        })
      ),
    [documents, viewer, teamMembers, canManageAccess]
  );

  useEffect(() => {
    if (!isOpen || !task) return;
    setLoading(true);

    const q = query(
      collection(db, 'projects', task.projectId, 'documents'),
      where('taskId', '==', task.id)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setDocuments(snapshot.docs.map((document) => ({ id: document.id, ...document.data() })));
      setLoading(false);
    }, (error) => {
      console.error('Error loading task documents:', error);
      toast.error('Error al cargar documentos de la tarea.');
      setLoading(false);
    });

    return () => unsubscribe();
  }, [isOpen, task]);

  useEffect(() => {
    if (!isOpen) return;
    setFile(null);
    setPreviewDocument(null);
    setAccessMode('all');
    setAllowedMemberIds([]);
  }, [isOpen]);

  const toggleAllowedMember = (memberId: string) => {
    setAllowedMemberIds((current) =>
      current.includes(memberId)
        ? current.filter((id) => id !== memberId)
        : [...current, memberId]
    );
  };

  const handleUpload = async () => {
    if (!file || !task) return;

    if (!canUploadDocuments) {
      toast.error('No tienes permisos para subir documentos.');
      return;
    }

    if (accessMode === 'restricted' && allowedMemberIds.length === 0) {
      toast.warning('Selecciona al menos una persona autorizada para ver el documento.');
      return;
    }

    setUploading(true);
    try {
      const storagePath = buildDocumentStoragePath({
        projectId: task.projectId,
        projectName: project?.name || task.projectName,
        task,
        tasks,
        fileName: file.name,
        documentName: file.name,
      });
      const storageFolder = storagePath.split('/').slice(0, -1).join('/');
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(storageRef);

      await addDoc(collection(db, 'projects', task.projectId, 'documents'), {
        projectId: task.projectId,
        taskId: task.id,
        taskTitle: getTaskDisplayTitle(task),
        ...(isUserStory
          ? {
              storyId: task.id,
              storyTitle: getTaskDisplayTitle(task),
              entityType: 'user_story',
            }
          : { entityType: 'task' }),
        taskFolderSegments: getTaskStorageFolderSegments(task, tasks),
        scope: isUserStory ? 'user_story' : 'task',
        name: file.name,
        type: 'workflow_document',
        url: downloadURL,
        storagePath: storageRef.fullPath,
        storageFolder,
        uploadedBy: userId,
        uploadedAt: serverTimestamp(),
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type || null,
        accessMode,
        allowedMemberIds: accessMode === 'restricted' ? allowedMemberIds : [],
        providerPathVersion: 'structured-v1',
      });

      setFile(null);
      setAccessMode('all');
      setAllowedMemberIds([]);
      toast.success(`Documento subido a la ${entityLabel}.`);
    } catch (error) {
      console.error('Error uploading document:', error);
      toast.error('Error al subir el documento');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (docId: string, storagePath: string) => {
    if (!canDeleteDocuments) {
      toast.error('No tienes permisos para eliminar documentos.');
      return;
    }
    if (!confirm('¿Está seguro de eliminar este documento?')) return;
    try {
      if (storagePath) {
        await deleteObject(ref(storage, storagePath));
      }
      await deleteDoc(doc(db, 'projects', task.projectId, 'documents', docId));
    } catch (error) {
      console.error('Error deleting document:', error);
      toast.error('Error al eliminar el documento');
    }
  };

  if (!isOpen || !task) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 p-6">
          <div>
            <h2 className="text-xl font-black text-slate-800">
              Documentos de la {entityLabel}
            </h2>
            <p className="mt-1 text-sm font-medium text-slate-500">
              {getTaskDisplayTitle(task)}
            </p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        {canUploadDocuments ? (
          <div className="border-b border-slate-100 bg-slate-50 p-6">
            <h3 className="mb-3 text-sm font-bold text-slate-700">Agregar nuevo documento</h3>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="flex-1 text-sm text-slate-500 file:mr-4 file:rounded-full file:border-0 file:bg-indigo-50 file:px-4 file:py-2 file:text-sm file:font-bold file:text-indigo-700 hover:file:bg-indigo-100"
              />
              <Button
                onClick={handleUpload}
                disabled={!file || uploading}
                className="bg-indigo-600 text-white hover:bg-indigo-700"
              >
                {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                Subir
              </Button>
            </div>

            {canManageAccess && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-black text-slate-800">
                  <Lock size={15} className="text-indigo-600" />
                  Visibilidad
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm font-bold">
                    <input
                      type="radio"
                      checked={accessMode === 'all'}
                      onChange={() => {
                        setAccessMode('all');
                        setAllowedMemberIds([]);
                      }}
                    />
                    Todo el equipo
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm font-bold">
                    <input
                      type="radio"
                      checked={accessMode === 'restricted'}
                      onChange={() => setAccessMode('restricted')}
                    />
                    Restringido
                  </label>
                </div>
                {accessMode === 'restricted' && (
                  <div className="mt-2 max-h-36 overflow-y-auto rounded-lg bg-slate-50 p-2">
                    {projectMembers.map((member) => (
                      <label key={member.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm font-semibold text-slate-700 hover:bg-white">
                        <input
                          type="checkbox"
                          checked={allowedMemberIds.includes(member.id)}
                          onChange={() => toggleAllowedMember(member.id)}
                        />
                        <span>{member.name || member.email || 'Miembro'}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-indigo-600" /></div>
          ) : visibleDocuments.length === 0 ? (
            <div className="py-8 text-center text-slate-500">
              <FileText className="mx-auto mb-3 h-12 w-12 text-slate-300" />
              <p>No hay documentos visibles adjuntos a esta {entityLabel}.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleDocuments.map((document) => (
                <div key={document.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-indigo-300">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                      <FileText size={20} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-bold text-slate-900">{document.name}</p>
                        {document.accessMode === 'restricted' && (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700">Restringido</span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {document.uploadedAt?.toDate ? format(document.uploadedAt.toDate(), 'dd/MM/yyyy HH:mm') : 'Reciente'}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setPreviewDocument(document)}
                      className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                      title="Ver en Pixel"
                    >
                      <Eye size={18} />
                    </button>
                    <a
                      href={document.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                      title="Abrir"
                    >
                      <ExternalLink size={18} />
                    </a>
                    <a
                      href={document.url}
                      download
                      className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                      title="Descargar"
                    >
                      <Download size={18} />
                    </a>
                    {canDeleteDocuments && (
                      <button
                        type="button"
                        onClick={() => handleDelete(document.id, document.storagePath)}
                        className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                        title="Eliminar"
                      >
                        <Trash2 size={18} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <ProjectDocumentViewer
        document={previewDocument}
        isOpen={!!previewDocument}
        onClose={() => setPreviewDocument(null)}
      />
    </div>
  );
};
