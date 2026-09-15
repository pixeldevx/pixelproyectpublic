import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ListTodo, Plus, Trash2, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import { collection, query, onSnapshot, addDoc, deleteDoc, doc, serverTimestamp, updateDoc } from '@/lib/supabase/document-store';
import { db } from '@/lib/backend';
import { toast } from 'sonner';
import { RolePermissionSet } from '@/lib/permissions';

export function ProjectActivities({
  projectId,
  project,
  currentUser,
  permissions,
}: {
  projectId: string;
  project: any;
  currentUser: any;
  permissions?: RolePermissionSet;
}) {
  const [activities, setActivities] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [activityToDelete, setActivityToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const canCreateActivities = permissions?.activityCreate !== false;
  const canEditActivityStatus = permissions?.activityEditStatus !== false;
  const canDeleteActivities = permissions?.activityDelete !== false;

  useEffect(() => {
    const q = query(collection(db, 'projects', projectId, 'activities'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      data.sort((a: any, b: any) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
      setActivities(data);
    });
    return () => unsubscribe();
  }, [projectId]);

  useEffect(() => {
    const q = query(collection(db, 'users'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const usersData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setAllUsers(usersData);
    });
    return () => unsubscribe();
  }, []);

  const handleCreateActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreateActivities) {
      toast.error('No tienes permisos para crear actividades.');
      return;
    }
    if (!title.trim() || !assignedTo) return;
    setLoading(true);
    try {
      const activityData: any = {
        projectId,
        title: title.trim(),
        assignedTo,
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: currentUser.uid
      };

      if (description.trim()) {
        activityData.description = description.trim();
      }

      await addDoc(collection(db, 'projects', projectId, 'activities'), activityData);
      setTitle('');
      setDescription('');
      setAssignedTo('');
    } catch (error: any) {
      console.error("Error creating activity:", error);
      toast.error(`Error al crear actividad: ${error.message}`);
    }
    setLoading(false);
  };

  const handleDeleteActivity = (id: string) => {
    if (!canDeleteActivities) {
      toast.error('No tienes permisos para eliminar actividades.');
      return;
    }
    setActivityToDelete(id);
  };

  const executeDeleteActivity = async () => {
    if (!activityToDelete) return;
    setIsDeleting(true);
    try {
      await deleteDoc(doc(db, 'projects', projectId, 'activities', activityToDelete));
      setActivityToDelete(null);
    } catch (error) {
      console.error("Error deleting activity:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleStatusChange = async (id: string, newStatus: string) => {
    if (!canEditActivityStatus) {
      toast.error('No tienes permisos para cambiar el estado de actividades.');
      return;
    }

    try {
      await updateDoc(doc(db, 'projects', projectId, 'activities', id), {
        status: newStatus,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Error updating activity:", error);
    }
  };

  const getUserName = (userId: string) => {
    const u = allUsers.find(u => u.id === userId);
    return u ? (u.displayName || u.email) : 'Usuario desconocido';
  };

  const projectUsers = allUsers.filter(u => project.assignedUsers?.includes(u.id) || u.id === project.ownerId);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      {canCreateActivities && (
        <Card className="lg:col-span-1 border-slate-200 shadow-sm h-fit">
          <CardHeader className="pb-4 border-b border-slate-100 bg-slate-50/50">
            <CardTitle className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <Plus size={18} className="text-indigo-500" />
              Nueva Actividad
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <form onSubmit={handleCreateActivity} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Título</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full h-10 px-3 rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Descripción</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full p-3 rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Asignar a</label>
                <select
                  value={assignedTo}
                  onChange={(e) => setAssignedTo(e.target.value)}
                  className="w-full h-10 px-3 rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                  required
                >
                  <option value="">-- Seleccione un usuario --</option>
                  {projectUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.displayName || u.email}</option>
                  ))}
                </select>
              </div>
              <Button
                type="submit"
                disabled={!title || !assignedTo || loading}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300"
              >
                {loading ? 'Creando...' : 'Crear Actividad'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card className={`${canCreateActivities ? 'lg:col-span-2' : 'lg:col-span-3'} border-slate-200 shadow-sm`}>
        <CardHeader className="pb-4 border-b border-slate-100 bg-slate-50/50">
          <CardTitle className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <ListTodo size={18} className="text-indigo-500" />
            Actividades de Seguimiento
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/50 hover:bg-slate-50/50">
                <TableHead className="font-semibold text-slate-600">Actividad</TableHead>
                <TableHead className="font-semibold text-slate-600">Asignado a</TableHead>
                <TableHead className="font-semibold text-slate-600">Estado</TableHead>
                <TableHead className="font-semibold text-slate-600 text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activities.map((act) => (
                <TableRow key={act.id} className="hover:bg-slate-50/50">
                  <TableCell>
                    <div className="font-medium text-slate-900">{act.title}</div>
                    {act.description && <div className="text-xs text-slate-500 mt-1 line-clamp-1">{act.description}</div>}
                  </TableCell>
                  <TableCell className="text-sm text-slate-600">{getUserName(act.assignedTo)}</TableCell>
                  <TableCell>
                    <select
                      value={act.status}
                      onChange={(e) => handleStatusChange(act.id, e.target.value)}
                      disabled={!canEditActivityStatus}
                      className={`text-xs font-medium px-2 py-1 rounded-md border-0 focus:ring-2 focus:ring-indigo-500/20 ${canEditActivityStatus ? 'cursor-pointer' : 'cursor-default'} ${
                        act.status === 'completed' ? 'bg-emerald-50 text-emerald-700' :
                        act.status === 'in-progress' ? 'bg-amber-50 text-amber-700' :
                        'bg-slate-100 text-slate-700'
                      }`}
                    >
                      <option value="pending">Pendiente</option>
                      <option value="in-progress">En Progreso</option>
                      <option value="completed">Completada</option>
                    </select>
                  </TableCell>
                  <TableCell className="text-right">
                    {canDeleteActivities && (
                      <button
                        onClick={() => handleDeleteActivity(act.id)}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                        title="Eliminar"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {activities.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-slate-500">
                    No hay actividades registradas.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Delete Activity Modal */}
      {activityToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 m-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 text-red-600 mb-4">
              <div className="p-2 bg-red-100 rounded-full">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900">Eliminar Actividad</h3>
            </div>

            <p className="text-slate-600 mb-6">
              ¿Estás seguro de que deseas eliminar esta actividad? Esta acción no se puede deshacer.
            </p>

            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => setActivityToDelete(null)}
                disabled={isDeleting}
                className="border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </Button>
              <Button
                onClick={executeDeleteActivity}
                disabled={isDeleting}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {isDeleting ? 'Eliminando...' : 'Sí, eliminar actividad'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
