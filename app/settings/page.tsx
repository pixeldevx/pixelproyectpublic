"use client"

import React, { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Trash2, Edit2, AlertCircle, Shield, Users, SlidersHorizontal, Palette, Cloud } from 'lucide-react';
import { collection, query, onSnapshot, addDoc, deleteDoc, doc, serverTimestamp, updateDoc } from '@/lib/supabase/document-store';
import { db } from '@/lib/backend';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { UserManagement } from '@/components/settings/UserManagement';
import { OrganizationManagement } from '@/components/settings/OrganizationManagement';
import { PermissionManagement } from '@/components/settings/PermissionManagement';
import { BrandingManagement } from '@/components/settings/BrandingManagement';
import { DocumentStorageManagement } from '@/components/settings/DocumentStorageManagement';
import { Building } from 'lucide-react';
import { belongsToAnyOrganization } from '@/lib/organizations';

export default function SettingsPage() {
  const { user, userRole, userOrganizationId, userOrganizationIds } = useAuth();
  const [activeTab, setActiveTab] = useState<'roles' | 'users' | 'permissions' | 'organizations' | 'branding' | 'storage'>('roles');
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<any>(null);
  const [roleName, setRoleName] = useState('');
  const [roleDescription, setRoleDescription] = useState('');

  const [roleToDelete, setRoleToDelete] = useState<{id: string, name: string} | null>(null);
  const [isDeletingRole, setIsDeletingRole] = useState(false);
  const managedOrganizationIds = React.useMemo(
    () => (userOrganizationIds.length > 0 ? userOrganizationIds : userOrganizationId ? [userOrganizationId] : []),
    [userOrganizationId, userOrganizationIds]
  );

  useEffect(() => {
    if (!user || (!userRole)) return;

    let qRoles = query(collection(db, 'roles'));

    const unsubscribe = onSnapshot(qRoles, (querySnapshot) => {
      const rolesData: any[] = [];
      querySnapshot.forEach((doc) => {
        const data = { id: doc.id, ...doc.data() };
        if (
          userRole === 'admin' ||
          data.isDefault ||
          managedOrganizationIds.length === 0 ||
          belongsToAnyOrganization(data, managedOrganizationIds)
        ) {
          rolesData.push(data);
        }
      });
      setRoles(rolesData);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching roles:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user, userRole, managedOrganizationIds]);

  if (userRole !== 'admin' && userRole !== 'org_admin') {
    return (
      <DashboardLayout>
        <div className="flex justify-center items-center h-full">
          <div className="text-center">
            <Shield className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-slate-700">Acceso Denegado</h2>
            <p className="text-slate-500 mt-2">No tienes permisos para ver esta página.</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const handleOpenModal = (role?: any) => {
    if (role) {
      setEditingRole(role);
      setRoleName(role.name);
      setRoleDescription(role.description);
    } else {
      setEditingRole(null);
      setRoleName('');
      setRoleDescription('');
    }
    setIsModalOpen(true);
  };

  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleName.trim()) return;

    try {
      if (editingRole) {
        await updateDoc(doc(db, 'roles', editingRole.id), {
          name: roleName,
          description: roleDescription,
        });
        toast.success("Cargo actualizado exitosamente.");
      } else {
        await addDoc(collection(db, 'roles'), {
          name: roleName,
          description: roleDescription,
          createdAt: serverTimestamp(),
          ...(userOrganizationId && userRole !== 'admin' ? { organizationId: userOrganizationId } : {})
        });
        toast.success("Cargo creado exitosamente.");
      }
      setIsModalOpen(false);
    } catch (error) {
      console.error("Error saving role:", error);
      toast.error("Error al guardar el rol");
    }
  };

  const handleDeleteRole = (id: string) => {
    const role = roles.find(r => r.id === id);
    if (role) {
      setRoleToDelete({ id, name: role.name });
    }
  };

  const executeDeleteRole = async () => {
    if (!roleToDelete) return;
    setIsDeletingRole(true);
    try {
      await deleteDoc(doc(db, 'roles', roleToDelete.id));
      toast.success("Rol eliminado exitosamente.");
      setRoleToDelete(null);
    } catch (error) {
      console.error("Error deleting role:", error);
      toast.error("Error al eliminar el rol");
    } finally {
      setIsDeletingRole(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Configuración</h1>
          <p className="text-slate-500">Administra los roles y usuarios del sistema</p>
        </div>
        {activeTab === 'roles' && (
          <Button onClick={() => handleOpenModal()} className="bg-indigo-600 hover:bg-indigo-700 text-white">
            <Plus className="w-4 h-4 mr-2" />
            Nuevo Rol
          </Button>
        )}
      </div>

      <div className="mb-6 border-b border-slate-200">
        <div className="flex gap-6">
          <button
            onClick={() => setActiveTab('roles')}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'roles'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <Shield size={16} />
              Cargos (Roles de Proyecto)
            </div>
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'users'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <Users size={16} />
              Usuarios del Sistema
            </div>
          </button>
          <button
            onClick={() => setActiveTab('permissions')}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'permissions'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <SlidersHorizontal size={16} />
              Permisos
            </div>
          </button>
          
          {userRole === 'admin' && (
            <button
              onClick={() => setActiveTab('organizations')}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'organizations'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <Building size={16} />
                Organizaciones
              </div>
            </button>
          )}

          {userRole === 'admin' && (
            <button
              onClick={() => setActiveTab('branding')}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'branding'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <Palette size={16} />
                Marca
              </div>
            </button>
          )}

          {userRole === 'admin' && (
            <button
              onClick={() => setActiveTab('storage')}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'storage'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <Cloud size={16} />
                Gestor documental
              </div>
            </button>
          )}
        </div>
      </div>

      {activeTab === 'organizations' && userRole === 'admin' ? (
        <OrganizationManagement />
      ) : activeTab === 'branding' && userRole === 'admin' ? (
        <BrandingManagement />
      ) : activeTab === 'storage' && userRole === 'admin' ? (
        <DocumentStorageManagement />
      ) : activeTab === 'permissions' ? (
        <PermissionManagement currentUser={user} />
      ) : activeTab === 'roles' ? (
        <Card>
          <CardHeader>
            <CardTitle>Cargos (Roles de Proyecto)</CardTitle>
            <CardDescription>
              Define los cargos que podrán ser asignados a los miembros del equipo en los proyectos.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
              </div>
            ) : roles.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                No hay cargos configurados. Crea el primer cargo para empezar.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre del Cargo</TableHead>
                    <TableHead>Descripción</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roles.map((role) => (
                    <TableRow key={role.id}>
                      <TableCell className="font-medium">{role.name}</TableCell>
                      <TableCell className="text-slate-500">{role.description || '-'}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <button 
                            onClick={() => handleOpenModal(role)}
                            className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
                            title="Editar"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button 
                            onClick={() => handleDeleteRole(role.id)}
                            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                            title="Eliminar"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : (
        <UserManagement />
      )}

      {/* Role Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 m-4 animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">
              {editingRole ? 'Editar Rol' : 'Nuevo Rol'}
            </h3>
            
            <form onSubmit={handleSaveRole}>
              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Nombre del Cargo *
                  </label>
                  <input
                    type="text"
                    required
                    value={roleName}
                    onChange={(e) => setRoleName(e.target.value)}
                    placeholder="Ej: Residente de Obra"
                    className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Descripción (Opcional)
                  </label>
                  <textarea
                    value={roleDescription}
                    onChange={(e) => setRoleDescription(e.target.value)}
                    placeholder="Breve descripción de las responsabilidades"
                    className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[80px]"
                  />
                </div>
              </div>
              
              <div className="flex justify-end gap-3">
                <Button 
                  type="button"
                  variant="outline" 
                  onClick={() => setIsModalOpen(false)}
                  className="border-slate-200 text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </Button>
                <Button 
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  Guardar
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Role Modal */}
      {roleToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 m-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 text-red-600 mb-4">
              <div className="p-2 bg-red-100 rounded-full">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900">Eliminar Rol</h3>
            </div>
            
            <p className="text-slate-600 mb-6">
              ¿Estás seguro de que deseas eliminar el rol <strong className="text-slate-900">&quot;{roleToDelete.name}&quot;</strong>? 
              Esta acción no se puede deshacer.
            </p>
            
            <div className="flex justify-end gap-3">
              <Button 
                variant="outline" 
                onClick={() => setRoleToDelete(null)}
                disabled={isDeletingRole}
                className="border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </Button>
              <Button 
                onClick={executeDeleteRole}
                disabled={isDeletingRole}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {isDeletingRole ? 'Eliminando...' : 'Sí, eliminar rol'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
