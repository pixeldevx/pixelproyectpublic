"use client"

import React, { useCallback, useState, useEffect } from 'react';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { AlertTriangle, ArrowRightLeft, CheckCircle2, Plus, RefreshCw, Send, Shield, Trash2, User as UserIcon } from 'lucide-react';
import { collection, query, onSnapshot, doc, updateDoc, setDoc, getDocs, where } from '@/lib/supabase/document-store';
import { db } from '@/lib/backend';
import { toast } from 'sonner';
import { uploadProfilePicture } from '@/lib/storage-utils';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase/client';
import { belongsToAnyOrganization, getOrganizationIds, getPrimaryOrganizationId, organizationNameFor } from '@/lib/organizations';

const API_TIMEOUT_MS = 30000;
const PHOTO_UPLOAD_TIMEOUT_MS = 20000;

const fetchWithTimeout = async (
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMessage: string,
  timeoutMs = API_TIMEOUT_MS,
) => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
};

const withTimeout = async <T,>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> => {
  let timeoutId: number | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  }
};

const toggleId = (current: string[], id: string) =>
  current.includes(id) ? current.filter((item) => item !== id) : [...current, id];

type ReassignmentPreview = {
  source: any;
  target: any;
  counts: {
    documents: number;
    references: number;
    projects: number;
    activeTasks: number;
    contractorAccounts: number;
    workflowSteps: number;
    workflowTemplates: number;
    approvalRoutes: number;
    meetings: number;
    orgChartNodes: number;
  };
  projectIds: string[];
  ratesPreserved: boolean;
  historicalDataPreserved: boolean;
  operationId?: string;
};

export function UserManagement() {
  const { user, userRole: currentUserRole, userOrganizationId, userOrganizationIds } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [projectRoles, setProjectRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [orgs, setOrgs] = useState<any[]>([]);
  const managedOrganizationIds = React.useMemo(
    () => (userOrganizationIds.length > 0 ? userOrganizationIds : userOrganizationId ? [userOrganizationId] : []),
    [userOrganizationId, userOrganizationIds]
  );

  useEffect(() => {
    if (currentUserRole === 'admin' || currentUserRole === 'org_admin') {
      const q = query(collection(db, 'organizations'));
      return onSnapshot(q, (snapshot) => {
        let o: any[] = [];
        snapshot.forEach(doc => o.push({ id: doc.id, ...doc.data()}));
        if (currentUserRole === 'org_admin') {
          o = o.filter((organization) => managedOrganizationIds.includes(organization.id));
        }
        setOrgs(o);
      });
    }
  }, [currentUserRole, managedOrganizationIds]);
  const [editingUser, setEditingUser] = useState<any>(null);
  
  const [userEmail, setUserEmail] = useState('');
  const [formSystemRole, setFormSystemRole] = useState('user');
  const [userName, setUserName] = useState('');
  const [projectRoleId, setProjectRoleId] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedOrganizationIds, setSelectedOrganizationIds] = useState<string[]>([]);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [resendingUserId, setResendingUserId] = useState<string | null>(null);
  const [isSyncingEmail, setIsSyncingEmail] = useState(false);
  const [reassignmentSource, setReassignmentSource] = useState<any>(null);
  const [reassignmentTargetId, setReassignmentTargetId] = useState('');
  const [reassignmentReason, setReassignmentReason] = useState('');
  const [reassignmentPreview, setReassignmentPreview] = useState<ReassignmentPreview | null>(null);
  const [reassignmentResult, setReassignmentResult] = useState<ReassignmentPreview | null>(null);
  const [reassignmentConfirmed, setReassignmentConfirmed] = useState(false);
  const [isAnalyzingReassignment, setIsAnalyzingReassignment] = useState(false);
  const [isExecutingReassignment, setIsExecutingReassignment] = useState(false);

  const systemRoles = [
    { id: 'admin', name: 'Administrador Global' },
    { id: 'org_admin', name: 'Administrador de Organización' },
    { id: 'manager', name: 'Gerente' },
    { id: 'coordinador', name: 'Coordinador' },
    { id: 'administrativo', name: 'Administrativo' },
    { id: 'user', name: 'Usuario' }
  ];

  const getAccessToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;

    if (!accessToken) {
      throw new Error('Tu sesión expiró. Inicia sesión nuevamente.');
    }

    return accessToken;
  }, []);

  const loadAuthUsers = useCallback(async () => {
    if (currentUserRole !== 'admin') return;

    setLoading(true);
    try {
      const accessToken = await getAccessToken();
      const response = await fetchWithTimeout('/api/admin/users', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }, 'La carga de usuarios tardó demasiado. Intenta refrescar nuevamente.');
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.error || 'No fue posible cargar los usuarios.');
      }

      setUsers(result.users || []);
    } catch (error) {
      console.error("Error fetching auth users:", error);
      toast.error(error instanceof Error ? error.message : "Error al cargar usuarios");
    } finally {
      setLoading(false);
    }
  }, [currentUserRole, getAccessToken]);

  useEffect(() => {
    if (!currentUserRole) return;

    let unsubscribeUsers: (() => void) | undefined;

    if (currentUserRole === 'admin') {
      void loadAuthUsers();
    } else {
      let qUsers = query(collection(db, 'users'));
      unsubscribeUsers = onSnapshot(qUsers, (querySnapshot) => {
        const usersData: any[] = [];
        querySnapshot.forEach((doc) => {
          const data = { id: doc.id, ...doc.data() };
          if (managedOrganizationIds.length === 0 || belongsToAnyOrganization(data, managedOrganizationIds)) {
            usersData.push(data);
          }
        });
        setUsers(usersData);
        setLoading(false);
      }, (error) => {
        console.error("Error fetching users:", error);
        setLoading(false);
      });
    }

    let qRoles = query(collection(db, 'roles'));
    const unsubscribeRoles = onSnapshot(qRoles, (querySnapshot) => {
      const rolesData: any[] = [];
      querySnapshot.forEach((doc) => {
        const data = { id: doc.id, ...doc.data() };
        if (
          currentUserRole === 'admin' ||
          data.isDefault ||
          managedOrganizationIds.length === 0 ||
          belongsToAnyOrganization(data, managedOrganizationIds)
        ) {
          rolesData.push(data);
        }
      });
      setProjectRoles(rolesData);
      if (rolesData.length > 0) {
        setProjectRoleId(rolesData[0].id);
      }
    });

    return () => {
      unsubscribeUsers?.();
      unsubscribeRoles();
    };
  }, [currentUserRole, loadAuthUsers, managedOrganizationIds]);

  const handleOpenModal = (u?: any) => {
    if (u) {
      setEditingUser(u);
      setUserEmail(u.email || '');
      setFormSystemRole(u.role || 'user');
      setUserName(u.displayName || '');
      setPhotoPreview(u.photoURL || null);
      const orgIds = getOrganizationIds(u);
      setSelectedOrganizationIds(orgIds);
      setPhotoFile(null);
    } else {
      setEditingUser(null);
      setUserEmail('');
      setFormSystemRole('user');
      setUserName('');
      setSelectedOrganizationIds(currentUserRole === 'org_admin' ? managedOrganizationIds : []);
      setPhotoPreview(null);
      setPhotoFile(null);
      if (projectRoles.length > 0) {
        setProjectRoleId(projectRoles[0].id);
      }
    }
    setIsModalOpen(true);
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setPhotoFile(file);
      setPhotoPreview(URL.createObjectURL(file));
    }
  };

  const inviteUser = async (payload: Record<string, any>) => {
    const accessToken = await getAccessToken();

    const response = await fetchWithTimeout('/api/admin/users/invite', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    }, 'La invitación tardó demasiado. Revisa si el usuario fue creado y vuelve a intentar si no aparece.');
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.error || 'No fue posible enviar la invitación.');
    }

    return result;
  };

  const deleteUser = async (targetUser: any) => {
    if (currentUserRole !== 'admin') return;
    if (targetUser.id === user?.uid) {
      toast.error('No puedes eliminar tu propio usuario desde esta pantalla.');
      return;
    }

    const confirmed = window.confirm(`¿Eliminar a ${targetUser.email}? Esta acción borrará su acceso en Supabase Auth y su perfil de la app.`);
    if (!confirmed) return;

    setDeletingUserId(targetUser.id);
    try {
      const accessToken = await getAccessToken();
      const response = await fetchWithTimeout('/api/admin/users', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          userId: targetUser.id,
          email: targetUser.email,
        }),
      }, 'La eliminación tardó demasiado. Refresca la lista para confirmar el estado.');
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.error || 'No fue posible eliminar el usuario.');
      }

      toast.success(result.message || 'Usuario eliminado.');
      await loadAuthUsers();
    } catch (error) {
      console.error("Error deleting user:", error);
      toast.error(error instanceof Error ? error.message : "Error al eliminar usuario");
    } finally {
      setDeletingUserId(null);
    }
  };

  const resendInvitation = async (targetUser: any) => {
    if (currentUserRole !== 'admin') return;
    if (targetUser.emailConfirmed) {
      toast.info('Este usuario ya confirmó su correo.');
      return;
    }

    const confirmed = window.confirm(`¿Reenviar el enlace de invitación a ${targetUser.email}?`);
    if (!confirmed) return;

    setResendingUserId(targetUser.id);
    try {
      const accessToken = await getAccessToken();
      const response = await fetchWithTimeout('/api/admin/users/resend-invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          userId: targetUser.id,
          email: targetUser.email,
        }),
      }, 'El reenvío tardó demasiado. Refresca la lista para confirmar el estado.');
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.error || 'No fue posible reenviar la invitación.');
      }

      toast.success(result.message || 'Invitación reenviada.');
      await loadAuthUsers();
    } catch (error) {
      console.error("Error resending invitation:", error);
      toast.error(error instanceof Error ? error.message : "Error al reenviar invitación");
    } finally {
      setResendingUserId(null);
    }
  };

  const openReassignmentModal = (sourceUser: any) => {
    setReassignmentSource(sourceUser);
    setReassignmentTargetId('');
    setReassignmentReason('');
    setReassignmentPreview(null);
    setReassignmentResult(null);
    setReassignmentConfirmed(false);
  };

  const closeReassignmentModal = () => {
    if (isExecutingReassignment) return;
    setReassignmentSource(null);
    setReassignmentTargetId('');
    setReassignmentReason('');
    setReassignmentPreview(null);
    setReassignmentResult(null);
    setReassignmentConfirmed(false);
  };

  const analyzeReassignment = async () => {
    if (!reassignmentSource?.id || !reassignmentTargetId) {
      toast.warning('Selecciona el usuario que recibirá las responsabilidades.');
      return;
    }

    setIsAnalyzingReassignment(true);
    setReassignmentPreview(null);
    setReassignmentResult(null);
    setReassignmentConfirmed(false);
    try {
      const accessToken = await getAccessToken();
      const search = new URLSearchParams({
        sourceUserId: reassignmentSource.id,
        targetUserId: reassignmentTargetId,
      });
      const response = await fetchWithTimeout(`/api/admin/users/reassign?${search.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }, 'El análisis tardó demasiado. Intenta nuevamente.', 60000);
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'No fue posible analizar la reasignación.');
      setReassignmentPreview(result);
    } catch (error) {
      console.error('Error previewing user reassignment:', error);
      toast.error(error instanceof Error ? error.message : 'No fue posible analizar la reasignación.');
    } finally {
      setIsAnalyzingReassignment(false);
    }
  };

  const executeReassignment = async () => {
    if (!reassignmentSource?.id || !reassignmentTargetId || !reassignmentPreview) return;
    if (reassignmentReason.trim().length < 8) {
      toast.warning('Describe el motivo de la reasignación con al menos 8 caracteres.');
      return;
    }
    if (!reassignmentConfirmed) {
      toast.warning('Confirma que revisaste el alcance antes de continuar.');
      return;
    }

    setIsExecutingReassignment(true);
    try {
      const accessToken = await getAccessToken();
      const response = await fetchWithTimeout('/api/admin/users/reassign', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          sourceUserId: reassignmentSource.id,
          targetUserId: reassignmentTargetId,
          reason: reassignmentReason.trim(),
        }),
      }, 'La reasignación tardó demasiado. Refresca la lista antes de volver a intentarla.', 120000);
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'No fue posible completar la reasignación.');

      setReassignmentResult({
        ...reassignmentPreview,
        ...result,
        counts: result.counts || reassignmentPreview.counts,
        projectIds: result.projectIds || reassignmentPreview.projectIds,
      });
      toast.success(result.message || 'Responsabilidades reasignadas correctamente.');
      await loadAuthUsers();
    } catch (error) {
      console.error('Error executing user reassignment:', error);
      toast.error(error instanceof Error ? error.message : 'No fue posible completar la reasignación.');
    } finally {
      setIsExecutingReassignment(false);
    }
  };

  const syncUserEmailIfNeeded = async (targetUser: any, nextEmail: string) => {
    const currentEmail = String(targetUser?.email || '').trim().toLowerCase();
    const normalizedNextEmail = nextEmail.trim().toLowerCase();

    if (!normalizedNextEmail || currentEmail === normalizedNextEmail) {
      return normalizedNextEmail;
    }

    if (currentUserRole !== 'admin') {
      throw new Error('Solo el administrador global puede cambiar el correo de acceso.');
    }

    const confirmed = window.confirm(
      `¿Cambiar el correo de acceso de ${currentEmail || targetUser.displayName || 'este usuario'} a ${normalizedNextEmail}?`
    );
    if (!confirmed) {
      throw new Error('Cambio de correo cancelado.');
    }

    setIsSyncingEmail(true);
    try {
      const accessToken = await getAccessToken();
      const response = await fetchWithTimeout('/api/admin/users', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          userId: targetUser.id,
          email: normalizedNextEmail,
        }),
      }, 'La actualización del correo tardó demasiado. Refresca la lista antes de volver a intentar.');
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.error || 'No fue posible actualizar el correo de acceso.');
      }

      const syncedEmail = result.email || normalizedNextEmail;
      setEditingUser((prev: any) => prev ? { ...prev, email: syncedEmail } : prev);
      setUsers((prevUsers) =>
        prevUsers.map((item) => item.id === targetUser.id ? { ...item, email: syncedEmail } : item)
      );
      toast.success(result.message || 'Correo de acceso actualizado.');
      return syncedEmail;
    } finally {
      setIsSyncingEmail(false);
    }
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userEmail.trim()) return;

    setIsUploading(true);
    try {
      let normalizedEmail = userEmail.trim().toLowerCase();
      const cleanOrganizationIds = formSystemRole === 'admin'
        ? []
        : Array.from(new Set(selectedOrganizationIds.filter(Boolean)));
      const primaryOrganizationId = getPrimaryOrganizationId({ organizationIds: cleanOrganizationIds });

      if (formSystemRole !== 'admin' && cleanOrganizationIds.length === 0) {
        toast.warning('Selecciona al menos una organización.');
        setIsUploading(false);
        return;
      }
      
      let uploadedPhotoURL = editingUser?.photoURL || null;

      if (editingUser) {
        const originalEmail = String(editingUser.email || '').trim().toLowerCase();
        normalizedEmail = await syncUserEmailIfNeeded(editingUser, normalizedEmail);

        if (photoFile) {
          uploadedPhotoURL = await withTimeout(
            uploadProfilePicture(editingUser.id, photoFile),
            PHOTO_UPLOAD_TIMEOUT_MS,
            'La foto tardó demasiado en subir. Intenta guardar sin foto o vuelve a subirla después.'
          );
        }

        await setDoc(doc(db, 'users', editingUser.id), {
          uid: editingUser.id,
          authUserId: editingUser.id,
          role: formSystemRole,
          email: normalizedEmail,
          displayName: userName || normalizedEmail.split('@')[0],
          ...(uploadedPhotoURL && { photoURL: uploadedPhotoURL }),
          ...(currentUserRole === 'admin'
            ? {
                organizationId: primaryOrganizationId,
                organizationIds: cleanOrganizationIds,
              }
            : {})
        }, { merge: true });

        // Also update team_members collection if the user exists there
        const teamMemberDocs = new Map<string, any>();
        const teamQueries = [
          query(collection(db, 'team_members'), where('authUserId', '==', editingUser.id)),
          ...(originalEmail ? [query(collection(db, 'team_members'), where('email', '==', originalEmail))] : []),
          query(collection(db, 'team_members'), where('email', '==', normalizedEmail)),
        ];

        for (const tmQuery of teamQueries) {
          const tmSnapshot = await getDocs(tmQuery);
          tmSnapshot.docs.forEach((tmDoc) => teamMemberDocs.set(tmDoc.id, tmDoc));
        }

        for (const tmDoc of teamMemberDocs.values()) {
          await updateDoc(doc(db, 'team_members', tmDoc.id), {
            email: normalizedEmail,
            name: userName || normalizedEmail.split('@')[0],
            authUserId: editingUser.id,
            ...(uploadedPhotoURL && { photoURL: uploadedPhotoURL }),
            ...(currentUserRole === 'admin'
              ? {
                  organizationId: primaryOrganizationId,
                  organizationIds: cleanOrganizationIds,
                }
              : {})
          });
        }

        toast.success("Usuario actualizado exitosamente.");
        setIsModalOpen(false);
        if (currentUserRole === 'admin') {
          void loadAuthUsers();
        }
      } else {
        if (currentUserRole !== 'admin') {
          throw new Error('Solo el administrador global puede invitar usuarios.');
        }

        const selectedProjectRole = projectRoles.find(r => r.id === projectRoleId);

        const selectedPhotoFile = photoFile;
        const inviteResult = await inviteUser({
          email: normalizedEmail,
          displayName: userName || normalizedEmail.split('@')[0],
          systemRole: formSystemRole,
          projectRoleId: projectRoleId || 'system_created',
          projectRoleName: selectedProjectRole?.name || 'Usuario del Sistema',
          organizationId: primaryOrganizationId,
          organizationIds: cleanOrganizationIds,
        });

        toast.success(inviteResult.message || "Usuario creado e invitación enviada.");
        setIsModalOpen(false);
        setIsUploading(false);

        void (async () => {
          if (selectedPhotoFile && inviteResult.userId) {
            try {
              const invitedPhotoURL = await withTimeout(
                uploadProfilePicture(inviteResult.userId, selectedPhotoFile),
                PHOTO_UPLOAD_TIMEOUT_MS,
                'La invitación fue enviada, pero la foto tardó demasiado en subir.'
              );

              await setDoc(doc(db, 'users', inviteResult.userId), {
                photoURL: invitedPhotoURL,
                updatedAt: new Date().toISOString(),
              }, { merge: true });

              const tmQuery = query(collection(db, 'team_members'), where('email', '==', normalizedEmail));
              const tmSnapshot = await getDocs(tmQuery);
              for (const tmDoc of tmSnapshot.docs) {
                await updateDoc(doc(db, 'team_members', tmDoc.id), {
                  photoURL: invitedPhotoURL,
                  updatedAt: new Date().toISOString(),
                });
              }
            } catch (photoError) {
              console.error("Error uploading invited user photo:", photoError);
              toast.warning(photoError instanceof Error ? photoError.message : 'Usuario invitado, pero no se pudo subir la foto.');
            }
          }

          await loadAuthUsers();
        })();

        return;
      }
    } catch (error) {
      console.error("Error saving user:", error);
      toast.error(error instanceof Error ? error.message : "Error al guardar el usuario");
    } finally {
      setIsUploading(false);
    }
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin': return 'bg-red-100 text-red-800 border-red-200';
      case 'manager': return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'administrativo': return 'bg-blue-100 text-blue-800 border-blue-200';
      default: return 'bg-slate-100 text-slate-800 border-slate-200';
    }
  };

  const getRoleName = (roleId: string) => {
    return systemRoles.find(r => r.id === roleId)?.name || 'Usuario';
  };

  const formatDate = (value: any) => {
    if (!value) return 'N/A';
    const date = value?.toDate ? value.toDate() : new Date(value);
    return Number.isNaN(date.getTime()) ? 'N/A' : date.toLocaleDateString();
  };

  const getAuthStatus = (u: any) => {
    switch (u.authStatus) {
      case 'confirmed':
        return { label: 'Confirmado', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
      case 'invite_sent':
        return { label: 'Invitación enviada', className: 'bg-amber-50 text-amber-700 border-amber-200' };
      case 'recovery_sent':
        return { label: 'Recuperación enviada', className: 'bg-sky-50 text-sky-700 border-sky-200' };
      case 'confirmation_sent':
        return { label: 'Confirmación enviada', className: 'bg-indigo-50 text-indigo-700 border-indigo-200' };
      default:
        return { label: 'Pendiente', className: 'bg-slate-50 text-slate-700 border-slate-200' };
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Usuarios del Sistema</CardTitle>
          <CardDescription>
            Gestiona los niveles de acceso y roles del sistema para los usuarios.
          </CardDescription>
        </div>
        {currentUserRole === 'admin' && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={loadAuthUsers} disabled={loading} className="border-slate-200 text-slate-700 hover:bg-slate-50">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button onClick={() => handleOpenModal()} className="bg-indigo-600 hover:bg-indigo-700 text-white">
              <Plus className="w-4 h-4 mr-2" />
              Invitar Usuario
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            No hay usuarios registrados.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuario</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Rol del Sistema</TableHead>
                <TableHead>Organizaciones</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Correo enviado</TableHead>
                <TableHead>Último Acceso</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold overflow-hidden">
                        {u.photoURL ? (
                          <Image src={u.photoURL} alt={u.displayName || 'User'} width={32} height={32} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          u.displayName?.charAt(0).toUpperCase() || u.email?.charAt(0).toUpperCase() || <UserIcon size={16} />
                        )}
                      </div>
                      {u.displayName || 'Usuario'}
                      {u.isPreRegistered && <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full ml-2">Invitado</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-slate-500">{u.email}</TableCell>
                  <TableCell>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${getRoleBadgeColor(u.role || 'user')}`}>
                      {getRoleName(u.role || 'user')}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[220px] text-xs text-slate-500">
                    {u.role === 'admin' ? 'Todas' : organizationNameFor(u, orgs)}
                  </TableCell>
                  <TableCell>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${getAuthStatus(u).className}`}>
                      {getAuthStatus(u).label}
                    </span>
                  </TableCell>
                  <TableCell className="text-slate-500 text-sm">
                    {formatDate(u.lastInvitationSentAt || u.inviteResentAt || u.invitedAt || u.confirmationSentAt || u.recoverySentAt)}
                  </TableCell>
                  <TableCell className="text-slate-500 text-sm">
                    {u.lastSignInAt || u.lastLoginAt ? formatDate(u.lastSignInAt || u.lastLoginAt) : 'Nunca'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {currentUserRole === 'admin' && !u.emailConfirmed && (
                        <button
                          onClick={() => resendInvitation(u)}
                          disabled={resendingUserId === u.id}
                          className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Reenviar invitación"
                        >
                          {resendingUserId === u.id ? (
                            <RefreshCw size={16} className="animate-spin" />
                          ) : (
                            <Send size={16} />
                          )}
                        </button>
                      )}
                      <button 
                        onClick={() => handleOpenModal(u)}
                        className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
                        title="Editar usuario"
                      >
                        <Shield size={16} />
                      </button>
                      {currentUserRole === 'admin' && (
                        <button
                          onClick={() => openReassignmentModal(u)}
                          className="p-2 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded-md transition-colors"
                          title="Reasignar responsabilidades"
                        >
                          <ArrowRightLeft size={16} />
                        </button>
                      )}
                      {currentUserRole === 'admin' && (
                        <button
                          onClick={() => deleteUser(u)}
                          disabled={deletingUserId === u.id || u.id === user?.uid}
                          className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          title={u.id === user?.uid ? 'No puedes eliminar tu propio usuario' : 'Eliminar usuario'}
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* User Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 m-4 animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">
              {editingUser ? 'Editar Usuario' : 'Invitar Nuevo Usuario'}
            </h3>
            
            <form onSubmit={handleSaveUser}>
              <div className="space-y-4 mb-6">
                <div className="flex flex-col items-center mb-4">
                  <div className="w-20 h-20 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden mb-2 relative group">
                    {photoPreview ? (
                      <Image src={photoPreview} alt="Preview" fill className="object-cover" />
                    ) : (
                      <UserIcon size={32} className="text-slate-400" />
                    )}
                    <label className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity">
                      <span className="text-white text-xs font-medium">Cambiar</span>
                      <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
                    </label>
                  </div>
                  <p className="text-xs text-slate-500">Foto de perfil (opcional)</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Nombre (Opcional)
                  </label>
                  <input
                    type="text"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    placeholder="Ej: Juan Pérez"
                    className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Correo Electrónico *
                  </label>
                  <input
                    type="email"
                    required
                    value={userEmail}
                    onChange={(e) => setUserEmail(e.target.value)}
                    placeholder="correo@ejemplo.com"
                    disabled={Boolean(editingUser && currentUserRole !== 'admin')}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
                  />
                  {editingUser && (
                    <p className="text-xs text-slate-500 mt-1">
                      {currentUserRole === 'admin'
                        ? 'Si cambias este correo se actualiza el inicio de sesión en Supabase Auth y las asignaciones por email.'
                        : 'Solo el administrador global puede cambiar el correo de acceso.'}
                    </p>
                  )}
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Rol del Sistema *
                  </label>
                  <select
                    value={formSystemRole}
                    onChange={(e) => setFormSystemRole(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                  >
                    {systemRoles.filter(role => currentUserRole === 'admin' ? true : role.id !== 'admin').map(role => (
                      <option key={role.id} value={role.id}>{role.name}</option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-500 mt-1">
                    El rol del sistema determina los permisos globales (ej. facturación, configuración).
                  </p>
                </div>

                {currentUserRole === 'admin' && formSystemRole !== 'admin' && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      {formSystemRole === 'org_admin' ? 'Organizaciones que administra *' : 'Organizaciones vinculadas *'}
                    </label>
                    <div className="max-h-36 overflow-y-auto rounded-md border border-slate-200 bg-white p-2 space-y-1">
                      {orgs.map(org => (
                        <label key={org.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedOrganizationIds.includes(org.id)}
                            onChange={() => {
                              const nextIds = toggleId(selectedOrganizationIds, org.id);
                              setSelectedOrganizationIds(nextIds);
                            }}
                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          {org.name}
                        </label>
                      ))}
                      {orgs.length === 0 && (
                        <p className="px-2 py-1.5 text-xs text-slate-500">
                          No hay organizaciones disponibles.
                        </p>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Puedes seleccionar una o varias organizaciones.
                    </p>
                  </div>
                )}

                {!editingUser && projectRoles.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Rol de Proyecto (Cargo) *
                    </label>
                    <select
                      value={projectRoleId}
                      onChange={(e) => setProjectRoleId(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                      required
                    >
                      {projectRoles.map(role => (
                        <option key={role.id} value={role.id}>{role.name}</option>
                      ))}
                    </select>
                    <p className="text-xs text-slate-500 mt-1">
                      Este rol define la función del usuario dentro de los proyectos.
                    </p>
                  </div>
                )}
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
                  disabled={isUploading || isSyncingEmail}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  {isSyncingEmail ? 'Sincronizando correo...' : isUploading ? 'Guardando...' : editingUser ? 'Guardar' : 'Enviar Invitación'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {reassignmentSource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-violet-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-violet-700">
                    <ArrowRightLeft className="h-3.5 w-3.5" />
                    Reasignación controlada
                  </div>
                  <h3 className="text-xl font-bold text-slate-950">Trasladar responsabilidades a otro usuario</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    Pixel moverá únicamente asignaciones operativas activas y conservará la autoría histórica.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeReassignmentModal}
                  disabled={isExecutingReassignment}
                  className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100 disabled:opacity-50"
                >
                  Cerrar
                </button>
              </div>
            </div>

            <div className="space-y-5 px-6 py-5">
              {reassignmentResult ? (
                <div className="space-y-5">
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" />
                      <div>
                        <h4 className="font-bold text-emerald-950">Reasignación completada</h4>
                        <p className="mt-1 text-sm text-emerald-800">
                          La trazabilidad quedó registrada con el identificador <span className="font-mono font-bold">{reassignmentResult.operationId}</span>.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      ['Documentos actualizados', reassignmentResult.counts.documents],
                      ['Tareas activas', reassignmentResult.counts.activeTasks],
                      ['Cuentas de cobro activas', reassignmentResult.counts.contractorAccounts],
                      ['Pasos de workflow', reassignmentResult.counts.workflowSteps],
                      ['Proyectos', reassignmentResult.projectIds.length],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
                        <p className="mt-1 text-2xl font-black text-slate-950">{value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="flex justify-end">
                    <Button onClick={closeReassignmentModal} className="bg-slate-950 text-white hover:bg-slate-800">
                      Finalizar
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
                    <div>
                      <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Usuario origen</label>
                      <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
                        <p className="font-bold text-slate-950">{reassignmentSource.displayName || 'Usuario'}</p>
                        <p className="truncate text-xs text-slate-600">{reassignmentSource.email}</p>
                      </div>
                    </div>
                    <ArrowRightLeft className="mx-auto mb-3 hidden h-5 w-5 text-violet-500 sm:block" />
                    <div>
                      <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Usuario destino</label>
                      <select
                        value={reassignmentTargetId}
                        onChange={(event) => {
                          setReassignmentTargetId(event.target.value);
                          setReassignmentPreview(null);
                          setReassignmentConfirmed(false);
                        }}
                        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
                      >
                        <option value="">Seleccionar usuario existente...</option>
                        {users
                          .filter((candidate) => candidate.id !== reassignmentSource.id)
                          .map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {candidate.displayName || candidate.email} · {candidate.email}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>

                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <div className="flex gap-3">
                      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                      <div className="text-sm text-amber-950">
                        <p className="font-bold">Los datos históricos no se reescriben.</p>
                        <p className="mt-1 text-amber-800">
                          Los rate cards ya generados, aprobaciones realizadas, comentarios, calidad y cierres conservarán al usuario original.
                        </p>
                      </div>
                    </div>
                  </div>

                  {!reassignmentPreview ? (
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        onClick={analyzeReassignment}
                        disabled={!reassignmentTargetId || isAnalyzingReassignment}
                        className="bg-violet-600 text-white hover:bg-violet-700"
                      >
                        {isAnalyzingReassignment ? (
                          <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <ArrowRightLeft className="mr-2 h-4 w-4" />
                        )}
                        {isAnalyzingReassignment ? 'Analizando...' : 'Analizar alcance'}
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-5">
                      <div>
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div>
                            <h4 className="font-bold text-slate-950">Vista previa del traslado</h4>
                            <p className="text-xs text-slate-500">No se ha modificado información todavía.</p>
                          </div>
                          <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-bold text-violet-700">
                            {reassignmentPreview.counts.references} referencias
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                          {[
                            ['Tareas activas', reassignmentPreview.counts.activeTasks],
                            ['Cuentas de cobro activas', reassignmentPreview.counts.contractorAccounts],
                            ['Pasos de workflow', reassignmentPreview.counts.workflowSteps],
                            ['Proyectos', reassignmentPreview.projectIds.length],
                            ['Plantillas', reassignmentPreview.counts.workflowTemplates],
                            ['Rutas de aprobación', reassignmentPreview.counts.approvalRoutes],
                            ['Reuniones', reassignmentPreview.counts.meetings],
                            ['Organigrama', reassignmentPreview.counts.orgChartNodes],
                            ['Documentos', reassignmentPreview.counts.documents],
                          ].map(([label, value]) => (
                            <div key={String(label)} className="rounded-xl border border-slate-200 p-3">
                              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
                              <p className="mt-1 text-xl font-black text-slate-950">{value}</p>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                          Motivo de la reasignación *
                        </label>
                        <textarea
                          value={reassignmentReason}
                          onChange={(event) => setReassignmentReason(event.target.value)}
                          rows={3}
                          placeholder="Ej. Cambio de responsable por retiro, vacaciones o reorganización del equipo."
                          className="w-full resize-none rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
                        />
                      </div>

                      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <input
                          type="checkbox"
                          checked={reassignmentConfirmed}
                          onChange={(event) => setReassignmentConfirmed(event.target.checked)}
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                        />
                        <span className="text-sm text-slate-700">
                          Confirmo que revisé el alcance y que <strong>{reassignmentPreview.target.displayName}</strong> debe recibir estas responsabilidades operativas.
                        </span>
                      </label>

                      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <Button type="button" variant="outline" onClick={analyzeReassignment} disabled={isAnalyzingReassignment || isExecutingReassignment}>
                          Volver a analizar
                        </Button>
                        <Button
                          type="button"
                          onClick={executeReassignment}
                          disabled={isExecutingReassignment || !reassignmentConfirmed || reassignmentReason.trim().length < 8}
                          className="bg-violet-600 text-white hover:bg-violet-700"
                        >
                          {isExecutingReassignment ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRightLeft className="mr-2 h-4 w-4" />}
                          {isExecutingReassignment ? 'Reasignando...' : 'Confirmar reasignación'}
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
