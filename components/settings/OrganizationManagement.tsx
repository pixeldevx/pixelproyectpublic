"use client"

import React, { useMemo, useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Plus, Edit2, Loader2, Trash2 } from 'lucide-react';
import { collection, query, onSnapshot, doc, setDoc, serverTimestamp, deleteDoc, getDocs } from '@/lib/supabase/document-store';
import { db } from '@/lib/backend';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { belongsToAnyOrganization } from '@/lib/organizations';
import {
  CONTRACTOR_ACCOUNT_APPROVAL_FIELDS,
  normalizeContractorAccountApprovalConfig,
} from '@/lib/contractor-account-workflow';
import { saveContractorAccountRouteAndReconcile } from '@/lib/contractor-account-route-reconciliation';

import { handleDataError, OperationType } from '@/lib/backend-utils';

export function OrganizationManagement() {
  const { user, userRole } = useAuth();
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingOrg, setEditingOrg] = useState<any>(null);
  const [deletingOrgId, setDeletingOrgId] = useState<string | null>(null);
  
  const [orgName, setOrgName] = useState('');
  const [contractorApprovers, setContractorApprovers] = useState({
    immediateBossId: '',
    operationsManagerId: '',
    qualityComplianceId: '',
    humanTalentId: '',
    accountingId: '',
    administrationId: '',
  });

  useEffect(() => {
    let active = true;
    if (userRole !== 'admin') {
      if (active) setTimeout(() => setLoading(false), 0);
      return;
    }

    const q = query(collection(db, 'organizations'));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const orgs: any[] = [];
      querySnapshot.forEach((doc) => {
        orgs.push({ id: doc.id, ...doc.data() });
      });
      if (active) {
        setOrganizations(orgs);
        setLoading(false);
      }
    }, (error) => {
      if (active) {
        handleDataError(error, OperationType.LIST, 'organizations');
        setLoading(false);
      }
    });
    const unsubscribeMembers = onSnapshot(
      query(collection(db, 'team_members')),
      (snapshot) => setTeamMembers(snapshot.docs.map((memberDoc) => ({ id: memberDoc.id, ...memberDoc.data() }))),
      (error) => handleDataError(error, OperationType.LIST, 'team_members')
    );
    const unsubscribeUsers = onSnapshot(
      query(collection(db, 'users')),
      (snapshot) => setUsers(snapshot.docs.map((userDoc) => ({ id: userDoc.id, ...userDoc.data() }))),
      (error) => handleDataError(error, OperationType.LIST, 'users')
    );

    return () => {
      active = false;
      unsubscribe();
      unsubscribeMembers();
      unsubscribeUsers();
    };
  }, [userRole]);

  const getMemberLabel = (member: any) =>
    member?.name || member?.displayName || member?.fullName || member?.email || 'Sin nombre';

  const getMemberOptionId = (member: any) =>
    String(member?.id || member?.authUserId || member?.email || '').trim();

  const isGlobalAdminCandidate = (person: any) => {
    const values = [
      person?.role,
      person?.userRole,
      person?.systemRole,
      person?.profileRole,
      person?.position,
      person?.cargo,
    ].map((value) => String(value || '').trim().toLowerCase());

    return values.some((value) =>
      value === 'admin' ||
      value === 'administrador global' ||
      value === 'global_admin' ||
      value === 'global-admin' ||
      value.includes('administrador global')
    );
  };

  const selectableMembers = useMemo(() => {
    const byKey = new Map<string, any>();
    const addPerson = (person: any, source: 'team' | 'user') => {
      const optionId = getMemberOptionId(person);
      if (!optionId) return;
      const key = optionId.toLowerCase();
      if (byKey.has(key)) return;
      byKey.set(key, {
        ...person,
        selectableSource: source,
        systemRole: person?.systemRole || person?.role || person?.userRole,
      });
    };

    teamMembers.forEach((member) => addPerson(member, 'team'));
    users.filter(isGlobalAdminCandidate).forEach((adminUser) => addPerson(adminUser, 'user'));

    return Array.from(byKey.values()).sort((left, right) =>
      getMemberLabel(left).localeCompare(getMemberLabel(right), 'es')
    );
  }, [teamMembers, users]);

  const memberNameById = (memberId?: string) => {
    if (!memberId) return 'Sin asignar';
    const normalized = String(memberId).trim().toLowerCase();
    const member = selectableMembers.find((item) =>
      [item.id, item.authUserId, item.uid, item.email].some((value) => String(value || '').trim().toLowerCase() === normalized)
    );
    return member ? getMemberLabel(member) : memberId;
  };

  const scopedMembers = useMemo(() => {
    if (!editingOrg?.id) return selectableMembers;
    return selectableMembers.filter((member) =>
      belongsToAnyOrganization(member, [editingOrg.id]) || isGlobalAdminCandidate(member)
    );
  }, [editingOrg?.id, selectableMembers]);

  const handleOpenModal = (org?: any) => {
    if (org) {
      setEditingOrg(org);
      setOrgName(org.name || '');
      setContractorApprovers({
        immediateBossId: org.contractorAccountApprovalConfig?.immediateBossId || '',
        operationsManagerId: org.contractorAccountApprovalConfig?.operationsManagerId || '',
        qualityComplianceId: org.contractorAccountApprovalConfig?.qualityComplianceId || '',
        humanTalentId: org.contractorAccountApprovalConfig?.humanTalentId || '',
        accountingId: org.contractorAccountApprovalConfig?.accountingId || '',
        administrationId:
          org.contractorAccountApprovalConfig?.administrationId ||
          org.contractorAccountApprovalConfig?.accountingId ||
          '',
      });
    } else {
      setEditingOrg(null);
      setOrgName('');
      setContractorApprovers({
        immediateBossId: '',
        operationsManagerId: '',
        qualityComplianceId: '',
        humanTalentId: '',
        accountingId: '',
        administrationId: '',
      });
    }
    setIsModalOpen(true);
  };

  const handleSaveOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgName.trim() || !user || isSaving) return;

    setIsSaving(true);
    try {
      const configToSave = normalizeContractorAccountApprovalConfig(contractorApprovers);
      if (editingOrg) {
        const result = await saveContractorAccountRouteAndReconcile({
          scope: 'organization',
          targetId: editingOrg.id,
          nextConfig: configToSave,
          organizationName: orgName,
        });
        toast.success(
          `Organización actualizada.${result.reassignedCount > 0
            ? ` ${result.reassignedCount} cuenta${result.reassignedCount === 1 ? '' : 's'} activa${result.reassignedCount === 1 ? '' : 's'} reasignada${result.reassignedCount === 1 ? '' : 's'}.`
            : ''}`
        );
        if (result.notificationFailureCount > 0) {
          toast.warning('La ruta quedó actualizada, pero alguna notificación no pudo enviarse.');
        }
        if (result.reconciliationFailureCount > 0) {
          toast.warning('La ruta quedó guardada, pero alguna cuenta no pudo reasignarse. Revisa las cuentas activas.');
        }
        if (result.concurrentChangeCount > 0) {
          toast.warning('Alguna cuenta cambió durante la actualización. No se envió una alerta obsoleta; revisa su responsable actual.');
        }
      } else {
        const newOrgRef = doc(collection(db, 'organizations'));
        await setDoc(newOrgRef, {
          name: orgName,
          contractorAccountApprovalConfig: configToSave,
          ownerId: user.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        toast.success("Organización creada");
      }
      setIsModalOpen(false);
    } catch (error: any) {
      toast.error(error?.message || 'Error al guardar la organización');
      handleDataError(error, OperationType.WRITE, 'organizations');
    } finally {
      setIsSaving(false);
    }
  };

  const getOrganizationDependencies = async (organizationId: string) => {
    const [projectsSnapshot, teamMembersSnapshot, usersSnapshot] = await Promise.all([
      getDocs(query(collection(db, 'projects'))),
      getDocs(query(collection(db, 'team_members'))),
      getDocs(query(collection(db, 'users'))),
    ]);

    const projectCount = projectsSnapshot.docs.filter((projectDoc) =>
      belongsToAnyOrganization(projectDoc.data(), [organizationId])
    ).length;
    const memberCount = teamMembersSnapshot.docs.filter((memberDoc) =>
      belongsToAnyOrganization(memberDoc.data(), [organizationId])
    ).length;
    const userCount = usersSnapshot.docs.filter((userDoc) =>
      belongsToAnyOrganization(userDoc.data(), [organizationId])
    ).length;

    return { projectCount, memberCount, userCount };
  };

  const handleDeleteOrg = async (organization: any) => {
    if (!organization?.id) return;

    const organizationName = organization.name || organization.id;
    const confirmed = window.confirm(
      `¿Eliminar la organización "${organizationName}"?\n\nEsta acción no se puede deshacer. Pixel revisará primero que no tenga proyectos ni usuarios asociados.`
    );
    if (!confirmed) return;

    setDeletingOrgId(organization.id);
    try {
      const dependencies = await getOrganizationDependencies(organization.id);
      const dependencyMessages = [
        dependencies.projectCount > 0 ? `${dependencies.projectCount} proyecto${dependencies.projectCount === 1 ? '' : 's'}` : '',
        dependencies.memberCount > 0 ? `${dependencies.memberCount} miembro${dependencies.memberCount === 1 ? '' : 's'} de equipo` : '',
        dependencies.userCount > 0 ? `${dependencies.userCount} usuario${dependencies.userCount === 1 ? '' : 's'}` : '',
      ].filter(Boolean);

      if (dependencyMessages.length > 0) {
        toast.error(`No se puede eliminar "${organizationName}" porque tiene ${dependencyMessages.join(', ')} asociados.`);
        return;
      }

      await deleteDoc(doc(db, 'organizations', organization.id));
      toast.success(`Organización "${organizationName}" eliminada`);
    } catch (error) {
      toast.error("Error al eliminar la organización");
      handleDataError(error, OperationType.DELETE, `organizations/${organization.id}`);
    } finally {
      setDeletingOrgId(null);
    }
  };

  if (userRole !== 'admin') {
    return null;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Organizaciones / Espacios de Trabajo</CardTitle>
          <CardDescription>
            Crea organizaciones y define configuraciones globales que los proyectos pueden heredar.
          </CardDescription>
        </div>
        <Button onClick={() => handleOpenModal()} className="bg-indigo-600 hover:bg-indigo-700 text-white">
          <Plus className="w-4 h-4 mr-2" />
          Nueva Organización
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
          </div>
        ) : organizations.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            No hay organizaciones creadas.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Flujo global cuentas de cobro</TableHead>
                <TableHead>Fecha de Creación</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {organizations.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium text-slate-900">{o.name}</TableCell>
                  <TableCell className="text-xs text-slate-500">
                    <div className="space-y-1">
                      <p><span className="font-bold text-slate-700">Jefe:</span> {memberNameById(o.contractorAccountApprovalConfig?.immediateBossId)}</p>
                      <p><span className="font-bold text-slate-700">Operaciones:</span> {memberNameById(o.contractorAccountApprovalConfig?.operationsManagerId)}</p>
                      <p><span className="font-bold text-slate-700">Calidad:</span> {memberNameById(o.contractorAccountApprovalConfig?.qualityComplianceId)}</p>
                      <p><span className="font-bold text-slate-700">Talento humano:</span> {memberNameById(o.contractorAccountApprovalConfig?.humanTalentId)}</p>
                      <p><span className="font-bold text-slate-700">Contabilidad:</span> {memberNameById(o.contractorAccountApprovalConfig?.accountingId)}</p>
                      <p><span className="font-bold text-slate-700">Administración:</span> {memberNameById(o.contractorAccountApprovalConfig?.administrationId || o.contractorAccountApprovalConfig?.accountingId)}</p>
                    </div>
                  </TableCell>
                  <TableCell className="text-slate-500 text-sm">
                    {o.createdAt ? new Date(o.createdAt.toDate()).toLocaleDateString() : 'N/A'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => handleOpenModal(o)}
                        className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
                        title="Editar organización"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={() => handleDeleteOrg(o)}
                        disabled={deletingOrgId === o.id}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                        title="Eliminar organización"
                      >
                        {deletingOrgId === o.id ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <Trash2 size={16} />
                        )}
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full p-6 m-4">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">
              {editingOrg ? 'Editar Organización' : 'Nueva Organización'}
            </h3>
            
            <form onSubmit={handleSaveOrg}>
              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Nombre de la Organización *
                  </label>
                  <input
                    type="text"
                    required
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder="Ej: Acirón S.A."
                    className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="rounded-xl border border-cyan-100 bg-cyan-50/60 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-700">
                    Responsables globales de cuentas de cobro
                  </p>
                  <p className="mt-1 text-xs font-medium text-slate-500">
                    Esta es la ruta por defecto de la organización. Cada proyecto puede sobrescribirla desde su Organigrama.
                  </p>
                  <div className="mt-3 grid gap-3">
                    {CONTRACTOR_ACCOUNT_APPROVAL_FIELDS.map((field) => (
                      <label key={field.key} className="block">
                        <span className="mb-1 block text-xs font-bold text-slate-600">{field.label}</span>
                        <select
                          value={(contractorApprovers as any)[field.key]}
                          onChange={(event) => setContractorApprovers((current) => ({ ...current, [field.key]: event.target.value }))}
                          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                          <option value="">Sin asignar</option>
                          {scopedMembers.map((member) => {
                            const memberId = getMemberOptionId(member);
                            return (
                              <option key={`${field.key}-${memberId}`} value={memberId}>
                                {getMemberLabel(member)}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              
              <div className="flex justify-end gap-3">
                <Button 
                  type="button"
                  variant="outline" 
                  onClick={() => setIsModalOpen(false)}
                  disabled={isSaving}
                >
                  Cancelar
                </Button>
                <Button 
                  type="submit"
                  disabled={isSaving}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {isSaving ? 'Guardando...' : 'Guardar'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Card>
  );
}
