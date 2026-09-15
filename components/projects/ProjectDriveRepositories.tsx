"use client"

import React, { useEffect, useMemo, useState } from 'react';
import { collection, query, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, orderBy } from '@/lib/supabase/document-store';
import { db } from '@/lib/backend';
import { Button } from '@/components/ui/button';
import { ExternalLink, Link2, Lock, Pencil, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

type DriveRepositoryForm = {
  name: string;
  url: string;
  accessMode: 'all' | 'restricted';
  allowedMemberIds: string[];
};

interface ProjectDriveRepositoriesProps {
  projectId: string;
  project: any;
  teamMembers: any[];
  currentUser: any;
  canManage: boolean;
}

const emptyForm: DriveRepositoryForm = {
  name: '',
  url: '',
  accessMode: 'all',
  allowedMemberIds: [],
};

const normalizeUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

const getRepoUrlHost = (value: string) => {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
};

export function ProjectDriveRepositories({
  projectId,
  project,
  teamMembers,
  currentUser,
  canManage,
}: ProjectDriveRepositoriesProps) {
  const [repositories, setRepositories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingRepository, setEditingRepository] = useState<any>(null);
  const [form, setForm] = useState<DriveRepositoryForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const projectMemberIds = useMemo(
    () => new Set((project?.assignedTeamMembers || []).filter(Boolean)),
    [project?.assignedTeamMembers]
  );

  const projectMembers = useMemo(
    () => teamMembers.filter((member) => projectMemberIds.has(member.id)),
    [projectMemberIds, teamMembers]
  );

  const viewerMember = useMemo(() => {
    const email = currentUser?.email?.toLowerCase();
    return teamMembers.find((member) => {
      return (
        member.id === currentUser?.uid ||
        member.authUserId === currentUser?.uid ||
        (email && member.email?.toLowerCase() === email)
      );
    });
  }, [currentUser?.email, currentUser?.uid, teamMembers]);

  useEffect(() => {
    if (!projectId) return;

    const q = query(
      collection(db, 'projects', projectId, 'driveRepositories'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setRepositories(snapshot.docs.map((document) => ({ id: document.id, ...document.data() })));
      setLoading(false);
    }, (error) => {
      console.error('Error loading drive repositories:', error);
      toast.error('Error al cargar los repositorios de Drive.');
      setLoading(false);
    });

    return () => unsubscribe();
  }, [projectId]);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingRepository(null);
    setIsFormOpen(false);
  };

  const openCreateForm = () => {
    setEditingRepository(null);
    setForm(emptyForm);
    setIsFormOpen(true);
  };

  const openEditForm = (repository: any) => {
    setEditingRepository(repository);
    setForm({
      name: repository.name || '',
      url: repository.url || '',
      accessMode: repository.accessMode === 'restricted' ? 'restricted' : 'all',
      allowedMemberIds: repository.allowedMemberIds || [],
    });
    setIsFormOpen(true);
  };

  const toggleAllowedMember = (memberId: string) => {
    setForm((current) => ({
      ...current,
      allowedMemberIds: current.allowedMemberIds.includes(memberId)
        ? current.allowedMemberIds.filter((id) => id !== memberId)
        : [...current.allowedMemberIds, memberId],
    }));
  };

  const canOpenRepository = (repository: any) => {
    if (canManage) return true;
    const isProjectMember = Boolean(viewerMember?.id && projectMemberIds.has(viewerMember.id));
    if (repository.accessMode !== 'restricted') return isProjectMember;

    const allowedMemberIds = repository.allowedMemberIds || [];
    return Boolean(
      isProjectMember && viewerMember?.id && allowedMemberIds.includes(viewerMember.id)
    );
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!canManage) {
      toast.error('No tienes permisos para administrar repositorios de Drive.');
      return;
    }

    const cleanName = form.name.trim();
    const cleanUrl = normalizeUrl(form.url);

    if (!cleanName || !cleanUrl) {
      toast.warning('Ingresa nombre y link del repositorio.');
      return;
    }

    try {
      const parsedUrl = new URL(cleanUrl);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        toast.warning('El link debe iniciar con http o https.');
        return;
      }
    } catch {
      toast.warning('Ingresa un link valido.');
      return;
    }

    if (form.accessMode === 'restricted' && form.allowedMemberIds.length === 0) {
      toast.warning('Selecciona al menos una persona autorizada.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: cleanName,
        url: cleanUrl,
        accessMode: form.accessMode,
        allowedMemberIds: form.accessMode === 'restricted' ? form.allowedMemberIds : [],
        updatedAt: serverTimestamp(),
      };

      if (editingRepository) {
        await updateDoc(doc(db, 'projects', projectId, 'driveRepositories', editingRepository.id), payload);
        toast.success('Repositorio actualizado.');
      } else {
        await addDoc(collection(db, 'projects', projectId, 'driveRepositories'), {
          ...payload,
          createdAt: serverTimestamp(),
          createdBy: currentUser?.uid || null,
        });
        toast.success('Repositorio agregado.');
      }

      resetForm();
    } catch (error: any) {
      console.error('Error saving drive repository:', error);
      toast.error(error?.message || 'No se pudo guardar el repositorio.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (repository: any) => {
    if (!canManage) return;
    const confirmed = window.confirm(`Eliminar el repositorio "${repository.name}"?`);
    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, 'projects', projectId, 'driveRepositories', repository.id));
      toast.success('Repositorio eliminado.');
    } catch (error: any) {
      console.error('Error deleting drive repository:', error);
      toast.error(error?.message || 'No se pudo eliminar el repositorio.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Link2 size={20} className="text-indigo-500" />
            Repositorios Drive
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Links externos del proyecto con acceso controlado por personas del equipo.
          </p>
        </div>
        {canManage && (
          <Button onClick={openCreateForm} className="bg-indigo-600 hover:bg-indigo-700 text-white">
            <Plus size={16} className="mr-2" />
            Nuevo Repositorio
          </Button>
        )}
      </div>

      {isFormOpen && canManage && (
        <form onSubmit={handleSubmit} className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-slate-800">
              {editingRepository ? 'Editar repositorio' : 'Nuevo repositorio'}
            </h3>
            <button
              type="button"
              onClick={resetForm}
              aria-label="Cerrar formulario"
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-white"
            >
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Nombre</label>
              <input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                className="w-full h-10 px-3 rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                placeholder="Ej. Drive planos finales"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Link de Drive</label>
              <input
                value={form.url}
                onChange={(event) => setForm({ ...form, url: event.target.value })}
                className="w-full h-10 px-3 rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                placeholder="https://drive.google.com/..."
                required
              />
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium text-slate-700">Visibilidad</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 cursor-pointer hover:border-indigo-200">
                <input
                  type="radio"
                  checked={form.accessMode === 'all'}
                  onChange={() => setForm({ ...form, accessMode: 'all', allowedMemberIds: [] })}
                  className="mt-1 text-indigo-600 focus:ring-indigo-500"
                />
                <div>
                  <p className="text-sm font-semibold text-slate-800">Todo el equipo</p>
                  <p className="text-xs text-slate-500">Cualquier persona asignada al proyecto puede abrirlo.</p>
                </div>
              </label>
              <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 cursor-pointer hover:border-indigo-200">
                <input
                  type="radio"
                  checked={form.accessMode === 'restricted'}
                  onChange={() => setForm({ ...form, accessMode: 'restricted' })}
                  className="mt-1 text-indigo-600 focus:ring-indigo-500"
                />
                <div>
                  <p className="text-sm font-semibold text-slate-800">Restringido</p>
                  <p className="text-xs text-slate-500">Solo personas seleccionadas pueden ver el link.</p>
                </div>
              </label>
            </div>
          </div>

          {form.accessMode === 'restricted' && (
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                Personas autorizadas
              </p>
              {projectMembers.length === 0 ? (
                <p className="text-sm text-slate-500">No hay personas asignadas al proyecto.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-44 overflow-y-auto">
                  {projectMembers.map((member) => (
                    <label key={member.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.allowedMemberIds.includes(member.id)}
                        onChange={() => toggleAllowedMember(member.id)}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-sm text-slate-700 truncate">{member.name || member.email}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={resetForm} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving} className="bg-indigo-600 hover:bg-indigo-700 text-white">
              {saving ? 'Guardando...' : editingRepository ? 'Guardar cambios' : 'Crear repositorio'}
            </Button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {loading ? (
          <div className="col-span-full rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            Cargando repositorios...
          </div>
        ) : repositories.length === 0 ? (
          <div className="col-span-full rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <Link2 className="w-10 h-10 mx-auto text-slate-300 mb-3" />
            <h3 className="font-semibold text-slate-800">No hay repositorios Drive</h3>
            <p className="text-sm text-slate-500 mt-1">
              Agrega links de carpetas o repositorios externos del proyecto.
            </p>
          </div>
        ) : (
          repositories.map((repository) => {
            const hasAccess = canOpenRepository(repository);
            const restricted = repository.accessMode === 'restricted';
            const allowedNames = (repository.allowedMemberIds || [])
              .map((memberId: string) => teamMembers.find((member) => member.id === memberId)?.name)
              .filter(Boolean);

            return (
              <div key={repository.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className={`px-2 py-0.5 text-[10px] font-bold rounded uppercase tracking-wider ${restricted ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                        {restricted ? 'Restringido' : 'Equipo'}
                      </span>
                      {!hasAccess && (
                        <span className="px-2 py-0.5 text-[10px] font-bold rounded uppercase tracking-wider bg-red-50 text-red-700">
                          Bloqueado
                        </span>
                      )}
                    </div>
                    <h3 className="text-base font-bold text-slate-900 truncate">{repository.name}</h3>
                    <p className={`text-sm mt-1 truncate ${hasAccess ? 'text-slate-500' : 'text-slate-400 blur-[3px] select-none'}`}>
                      {getRepoUrlHost(repository.url)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {canManage && (
                      <>
                        <button
                          onClick={() => openEditForm(repository)}
                          aria-label={`Editar repositorio ${repository.name}`}
                          className="p-2 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"
                          title="Editar"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(repository)}
                          aria-label={`Eliminar repositorio ${repository.name}`}
                          className="p-2 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50"
                          title="Eliminar"
                        >
                          <Trash2 size={16} />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <div className="text-xs text-slate-500 min-w-0">
                    {restricted ? (
                      <span className="truncate block">
                        Acceso: {allowedNames.length > 0 ? allowedNames.join(', ') : 'sin personas autorizadas'}
                      </span>
                    ) : (
                      'Visible para el equipo asignado'
                    )}
                  </div>
                  {hasAccess ? (
                    <a
                      href={repository.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-9 items-center rounded-md bg-indigo-600 px-3 text-sm font-medium text-white hover:bg-indigo-700"
                    >
                      <ExternalLink size={15} className="mr-2" />
                      Abrir
                    </a>
                  ) : (
                    <Button type="button" disabled variant="outline" className="h-9">
                      <Lock size={15} className="mr-2" />
                      Sin acceso
                    </Button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
