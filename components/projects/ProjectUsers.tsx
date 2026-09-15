import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Users, UserPlus, Trash2, AlertCircle } from 'lucide-react';
import { collection, query, onSnapshot, doc, updateDoc, arrayUnion, arrayRemove } from '@/lib/supabase/document-store';
import { db } from '@/lib/backend';
import { toast } from 'sonner';

export function ProjectUsers({ projectId, project, currentUser }: { projectId: string, project: any, currentUser: any }) {
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [selectedUser, setSelectedUser] = useState('');
  const [loading, setLoading] = useState(false);
  const [userToRemove, setUserToRemove] = useState<string | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);

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

  const handleAssignUser = async () => {
    if (!selectedUser) return;
    setLoading(true);
    try {
      const projectRef = doc(db, 'projects', projectId);
      await updateDoc(projectRef, {
        assignedUsers: arrayUnion(selectedUser)
      });
      setSelectedUser('');
    } catch (error: any) {
      console.error("Error assigning user:", error);
      toast.error(`Error al asignar usuario: ${error.message}`);
    }
    setLoading(false);
  };

  const handleRemoveUser = (userId: string) => {
    setUserToRemove(userId);
  };

  const executeRemoveUser = async () => {
    if (!userToRemove) return;
    setIsRemoving(true);
    try {
      const projectRef = doc(db, 'projects', projectId);
      await updateDoc(projectRef, {
        assignedUsers: arrayRemove(userToRemove)
      });
      setUserToRemove(null);
    } catch (error) {
      console.error("Error removing user:", error);
    } finally {
      setIsRemoving(false);
    }
  };

  const assignedUsersList = allUsers.filter(u => project.assignedUsers?.includes(u.id) || u.id === project.ownerId);
  const availableUsers = allUsers.filter(u => !project.assignedUsers?.includes(u.id) && u.id !== project.ownerId);

  const isOwner = currentUser?.uid === project.ownerId;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      {isOwner && (
        <Card className="lg:col-span-1 border-slate-200 shadow-sm h-fit">
          <CardHeader className="pb-4 border-b border-slate-100 bg-slate-50/50">
            <CardTitle className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <UserPlus size={18} className="text-indigo-500" />
              Asignar Usuario
            </CardTitle>
            <CardDescription className="text-sm text-slate-500">
              Añade usuarios para que puedan ver el proyecto y tener actividades asignadas.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Seleccionar Usuario</label>
                <select 
                  value={selectedUser}
                  onChange={(e) => setSelectedUser(e.target.value)}
                  className="w-full h-10 px-3 rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                >
                  <option value="">-- Seleccione un usuario --</option>
                  {availableUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.displayName || u.email}</option>
                  ))}
                </select>
              </div>
              <Button 
                onClick={handleAssignUser} 
                disabled={!selectedUser || loading} 
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300"
              >
                {loading ? 'Asignando...' : 'Asignar al Proyecto'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className={isOwner ? "lg:col-span-2 border-slate-200 shadow-sm" : "lg:col-span-3 border-slate-200 shadow-sm"}>
        <CardHeader className="pb-4 border-b border-slate-100 bg-slate-50/50">
          <CardTitle className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Users size={18} className="text-indigo-500" />
            Usuarios del Proyecto
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/50 hover:bg-slate-50/50">
                <TableHead className="font-semibold text-slate-600">Usuario</TableHead>
                <TableHead className="font-semibold text-slate-600">Email</TableHead>
                <TableHead className="font-semibold text-slate-600">Rol en Proyecto</TableHead>
                {isOwner && <TableHead className="font-semibold text-slate-600 text-right">Acciones</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignedUsersList.map((u) => (
                <TableRow key={u.id} className="hover:bg-slate-50/50">
                  <TableCell className="font-medium text-slate-900">
                    {u.displayName || 'Usuario'}
                  </TableCell>
                  <TableCell className="text-slate-500">{u.email}</TableCell>
                  <TableCell>
                    {u.id === project.ownerId ? (
                      <span className="bg-indigo-50 text-indigo-700 px-2 py-1 rounded-md text-xs font-medium">Propietario</span>
                    ) : (
                      <span className="bg-slate-100 text-slate-700 px-2 py-1 rounded-md text-xs font-medium">Miembro</span>
                    )}
                  </TableCell>
                  {isOwner && (
                    <TableCell className="text-right">
                      {u.id !== project.ownerId && (
                        <button 
                          onClick={() => handleRemoveUser(u.id)}
                          className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                          title="Eliminar"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {assignedUsersList.length === 0 && (
                <TableRow>
                  <TableCell colSpan={isOwner ? 4 : 3} className="text-center py-8 text-slate-500">
                    No hay usuarios asignados.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Remove User Modal */}
      {userToRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 m-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 text-red-600 mb-4">
              <div className="p-2 bg-red-100 rounded-full">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900">Remover Usuario</h3>
            </div>
            
            <p className="text-slate-600 mb-6">
              ¿Estás seguro de que deseas remover a este usuario del proyecto?
            </p>
            
            <div className="flex justify-end gap-3">
              <Button 
                variant="outline" 
                onClick={() => setUserToRemove(null)}
                disabled={isRemoving}
                className="border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </Button>
              <Button 
                onClick={executeRemoveUser}
                disabled={isRemoving}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {isRemoving ? 'Removiendo...' : 'Sí, remover usuario'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
