"use client"

import React, { useMemo, useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Building2,
  ChevronLeft,
  CheckCircle2,
  Clock,
  Code2,
  Folder,
  FolderKanban,
  Gauge,
  Layers3,
  Plus,
  Search,
  Sparkles,
  Target,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { collection, query, onSnapshot, orderBy, addDoc, serverTimestamp, where, or, updateDoc, doc, deleteDoc } from '@/lib/supabase/document-store';
import { db } from '@/lib/backend';
import { useAuth } from '@/hooks/useAuth';
import Link from 'next/link';
import { toast } from 'sonner';
import Image from 'next/image';
import { belongsToAnyOrganization, getOrganizationIds } from '@/lib/organizations';
import { differenceInCalendarDays, format } from 'date-fns';
import { es } from 'date-fns/locale';
import { isWorkflowTaskType } from '@/lib/workflow-routing';
import { SOFTWARE_PROJECT_MODE, isSoftwareProject, type ProjectMode } from '@/lib/scrum';

type ProjectTask = {
  id: string;
  title?: string;
  name?: string;
  status?: string;
  priority?: string;
  progress?: number;
  type?: string;
  parentTaskId?: string;
  workflowSteps?: any[];
  endDate?: any;
  end?: any;
  dueDate?: any;
  updatedAt?: any;
  createdAt?: any;
};

type ProjectStats = {
  total: number;
  open: number;
  pending: number;
  active: number;
  blocked: number;
  completed: number;
  completedLate: number;
  overdue: number;
  dueSoon: number;
  highPriority: number;
  workflows: number;
  averageProgress: number;
  completionRate: number;
  nextDueDate: Date | null;
  lastActivity: number;
};

type HealthFilter = 'all' | 'risk' | 'dueSoon' | 'healthy';

type OrganizationStats = {
  totalProjects: number;
  activeProjects: number;
  completedProjects: number;
  pausedProjects: number;
  memberCount: number;
  lastActivity: number;
};

const COMPLETED_STATUSES = new Set(['completed', 'completed_late', 'listo']);
const ACTIVE_STATUSES = new Set(['in_progress', 'en_curso', 'trabajando', 'reproceso']);
const BLOCKED_STATUSES = new Set(['stuck', 'detenido', 'blocked', 'devuelto']);
const PENDING_STATUSES = new Set(['todo', 'pending', 'not_started', 'no_iniciado']);

const EMPTY_PROJECT_STATS: ProjectStats = {
  total: 0,
  open: 0,
  pending: 0,
  active: 0,
  blocked: 0,
  completed: 0,
  completedLate: 0,
  overdue: 0,
  dueSoon: 0,
  highPriority: 0,
  workflows: 0,
  averageProgress: 0,
  completionRate: 0,
  nextDueDate: null,
  lastActivity: 0,
};

const compactNumber = (value: number) => new Intl.NumberFormat('es-CO').format(value);

const getProjectOrganizationIds = (project: any) => getOrganizationIds(project);

const getDate = (value: any): Date | null => {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getTime = (value: any) => getDate(value)?.getTime() || 0;

const getStatusBucket = (status?: string) => {
  const normalized = String(status || 'todo').toLowerCase();
  if (normalized === 'completed_late') return 'completedLate';
  if (COMPLETED_STATUSES.has(normalized)) return 'completed';
  if (BLOCKED_STATUSES.has(normalized)) return 'blocked';
  if (ACTIVE_STATUSES.has(normalized)) return 'active';
  if (PENDING_STATUSES.has(normalized)) return 'pending';
  return 'pending';
};

const isCompletedTask = (task: ProjectTask) => COMPLETED_STATUSES.has(String(task.status || '').toLowerCase());

const getScheduleState = (task: ProjectTask) => {
  if (isCompletedTask(task)) return task.status === 'completed_late' ? 'completed_late' : 'completed';
  if (['stuck', 'detenido', 'blocked'].includes(String(task.status || '').toLowerCase())) return 'paused';
  const endDate = getDate(task.endDate || task.end || task.dueDate);
  if (!endDate) return 'none';
  const days = differenceInCalendarDays(endDate, new Date());
  if (days < 0) return 'overdue';
  if (days <= 3) return 'due_soon';
  return 'ok';
};

const formatDate = (value: any) => {
  const date = getDate(value);
  return date ? format(date, 'd MMM yyyy', { locale: es }) : 'Reciente';
};

const formatShortDate = (date: Date | null) => {
  if (!date) return 'Sin fecha crítica';
  return format(date, 'd MMM', { locale: es });
};

const calculateProjectStats = (tasks: ProjectTask[]): ProjectStats => {
  const safeTasks = tasks.filter(Boolean);
  const total = safeTasks.length;
  const openTasks = safeTasks.filter((task) => !isCompletedTask(task));
  const dueDates = openTasks
    .map((task) => getDate(task.endDate || task.end || task.dueDate))
    .filter((date): date is Date => Boolean(date))
    .sort((left, right) => left.getTime() - right.getTime());

  return {
    total,
    open: openTasks.length,
    pending: safeTasks.filter((task) => getStatusBucket(task.status) === 'pending').length,
    active: safeTasks.filter((task) => getStatusBucket(task.status) === 'active').length,
    blocked: safeTasks.filter((task) => getStatusBucket(task.status) === 'blocked').length,
    completed: safeTasks.filter((task) => getStatusBucket(task.status) === 'completed').length,
    completedLate: safeTasks.filter((task) => getStatusBucket(task.status) === 'completedLate').length,
    overdue: openTasks.filter((task) => getScheduleState(task) === 'overdue').length,
    dueSoon: openTasks.filter((task) => getScheduleState(task) === 'due_soon').length,
    highPriority: openTasks.filter((task) => String(task.priority || '').toLowerCase() === 'high').length,
    workflows: safeTasks.filter((task) => isWorkflowTaskType(task.type) || Array.isArray(task.workflowSteps)).length,
    averageProgress: total ? Math.round(safeTasks.reduce((sum, task) => sum + Number(task.progress || 0), 0) / total) : 0,
    completionRate: total ? Math.round(((safeTasks.filter(isCompletedTask).length) / total) * 100) : 0,
    nextDueDate: dueDates[0] || null,
    lastActivity: Math.max(...safeTasks.map((task) => getTime(task.updatedAt || task.createdAt)), 0),
  };
};

const getProjectHealth = (stats: ProjectStats) => {
  if (stats.overdue > 0 || stats.blocked > 0) {
    return {
      key: 'risk',
      label: 'Atención crítica',
      hint: 'Hay tareas vencidas o bloqueadas',
      rail: 'bg-red-500',
      badge: 'bg-red-50 text-red-700 ring-red-100',
      glow: 'from-red-50 to-white',
      icon: AlertTriangle,
    };
  }

  if (stats.dueSoon > 0 || stats.highPriority > 0) {
    return {
      key: 'dueSoon',
      label: 'Vigilancia activa',
      hint: 'Se acercan cierres importantes',
      rail: 'bg-orange-500',
      badge: 'bg-orange-50 text-orange-700 ring-orange-100',
      glow: 'from-orange-50 to-white',
      icon: Clock,
    };
  }

  if (stats.total > 0 && stats.completionRate >= 80) {
    return {
      key: 'healthy',
      label: 'Saludable',
      hint: 'Avance sólido y controlado',
      rail: 'bg-emerald-500',
      badge: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
      glow: 'from-emerald-50 to-white',
      icon: CheckCircle2,
    };
  }

  return {
    key: 'steady',
    label: 'En marcha',
    hint: 'Plan en seguimiento',
    rail: 'bg-indigo-500',
    badge: 'bg-indigo-50 text-indigo-700 ring-indigo-100',
    glow: 'from-indigo-50 to-white',
    icon: Gauge,
  };
};

function PortfolioMetric({
  label,
  value,
  detail,
  icon,
  tone,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: React.ReactNode;
  tone: 'indigo' | 'emerald' | 'orange' | 'red';
}) {
  const toneClass = {
    indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-100',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    orange: 'bg-orange-50 text-orange-700 ring-orange-100',
    red: 'bg-red-50 text-red-700 ring-red-100',
  }[tone];

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">{label}</p>
          <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p>
          <p className="mt-1 text-sm font-medium text-slate-500">{detail}</p>
        </div>
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1 ${toneClass}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const { user, userRole, userOrganizationId, userOrganizationIds } = useAuth();
  const [projects, setProjects] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [newProjectMode, setNewProjectMode] = useState<ProjectMode>('general');
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [selectedProjectOrgId, setSelectedProjectOrgId] = useState('');
  const [projectSearch, setProjectSearch] = useState('');
  const [organizationSearch, setOrganizationSearch] = useState('');
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(null);
  const [healthFilter, setHealthFilter] = useState<HealthFilter>('all');
  const [tasksByProject, setTasksByProject] = useState<Record<string, ProjectTask[]>>({});

  // Edit Team State
  const [editingTeamProjectId, setEditingTeamProjectId] = useState<string | null>(null);
  const [editSelectedMembers, setEditSelectedMembers] = useState<string[]>([]);
  const [editSelectedOrgId, setEditSelectedOrgId] = useState<string>('');
  const [editProjectMode, setEditProjectMode] = useState<ProjectMode>('general');
  const [isSavingTeam, setIsSavingTeam] = useState(false);
  const managedOrganizationIds = useMemo(
    () => (userOrganizationIds.length > 0 ? userOrganizationIds : userOrganizationId ? [userOrganizationId] : []),
    [userOrganizationId, userOrganizationIds]
  );
  const organizationsById = useMemo(
    () => new Map(organizations.map((organization) => [organization.id, organization])),
    [organizations]
  );
  const accessibleOrganizationIds = useMemo(() => {
    if (userRole === 'admin') return organizations.map((organization) => organization.id);

    const ids = new Set<string>(managedOrganizationIds);
    projects.forEach((project) => {
      getProjectOrganizationIds(project).forEach((organizationId) => ids.add(organizationId));
    });
    return Array.from(ids).filter(Boolean);
  }, [managedOrganizationIds, organizations, projects, userRole]);
  const visibleOrganizations = useMemo(() => {
    const accessibleSet = new Set(accessibleOrganizationIds);
    return organizations
      .filter((organization) => accessibleSet.has(organization.id))
      .sort((left, right) => String(left.name || left.id).localeCompare(String(right.name || right.id), 'es'));
  }, [accessibleOrganizationIds, organizations]);
  const selectedOrganization = useMemo(
    () => visibleOrganizations.find((organization) => organization.id === selectedOrganizationId) || null,
    [selectedOrganizationId, visibleOrganizations]
  );
  const selectedOrganizationProjects = useMemo(() => {
    if (!selectedOrganizationId) return [];
    return projects.filter((project) => belongsToAnyOrganization(project, [selectedOrganizationId]));
  }, [projects, selectedOrganizationId]);

  useEffect(() => {
    if (!user) return;

    let q;
    if (userRole === 'admin' || userRole === 'org_admin') {
      q = query(collection(db, 'projects'));
    } else {
      const conditions = [
        where('ownerId', '==', user.uid),
        where('assignedUsers', 'array-contains', user.uid)
      ];

      if (user.email) {
        conditions.push(where('assignedEmails', 'array-contains', user.email));
      }

      q = query(
        collection(db, 'projects'),
        or(...conditions)
      );
    }
    
    // Everyone needs to know organizations to create projects or assign them
    const unsubscribeOrgs = onSnapshot(query(collection(db, 'organizations')), (snap) => {
      const orgsData = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setOrganizations(orgsData);
    });

    const unsubscribe = onSnapshot(q, (snapshot) => {
      let projectsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      if (userRole === 'org_admin') {
        projectsData = projectsData.filter((project) => belongsToAnyOrganization(project, managedOrganizationIds));
      }
      // Sort by createdAt descending
      projectsData.sort((a: any, b: any) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
      setProjects(projectsData);
      setLoading(false);
    }, (error: any) => {
      console.error("Error fetching projects:", error);
      toast.error(`Error al cargar proyectos: ${error.message}`);
      setLoading(false);
    });

    // Fetch team members for assignment
    let qTeam = query(collection(db, 'team_members'));
    const unsubscribeTeam = onSnapshot(qTeam, (snapshot) => {
      let teamData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      if (userRole !== 'admin') {
        teamData = teamData.filter((member) => belongsToAnyOrganization(member, managedOrganizationIds));
      }
      setTeamMembers(teamData);
    }, (error) => {
      console.error("Error fetching team members:", error);
    });

    return () => {
      unsubscribe();
      unsubscribeOrgs();
      unsubscribeTeam();
    };
  }, [user, userRole, managedOrganizationIds]);

  useEffect(() => {
    if (!user || !selectedOrganizationId) {
      return;
    }
    if (selectedOrganizationProjects.length === 0) {
      return;
    }

    const unsubscribes = selectedOrganizationProjects.map((project) =>
      onSnapshot(
        query(collection(db, 'projects', project.id, 'tasks'), orderBy('displayOrder', 'asc')),
        (snapshot) => {
          const tasks = snapshot.docs.map((taskDoc) => ({
            id: taskDoc.id,
            ...taskDoc.data(),
          } as ProjectTask));

          setTasksByProject((current) => ({ ...current, [project.id]: tasks }));
        },
        (error) => {
          console.error(`Error loading tasks for project ${project.id}:`, error);
        }
      )
    );

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [selectedOrganizationId, selectedOrganizationProjects, user]);

  const projectStatsById = useMemo(() => {
    return Object.fromEntries(selectedOrganizationProjects.map((project) => [project.id, calculateProjectStats(tasksByProject[project.id] || [])]));
  }, [selectedOrganizationProjects, tasksByProject]);

  const portfolioStats = useMemo(() => {
    const stats = selectedOrganizationProjects.map((project) => projectStatsById[project.id] || EMPTY_PROJECT_STATS);
    const activeProjects = selectedOrganizationProjects.filter((project) => project.status !== 'completed').length;
    const totalTasks = stats.reduce((sum, item) => sum + item.total, 0);
    const totalOpen = stats.reduce((sum, item) => sum + item.open, 0);
    const totalOverdue = stats.reduce((sum, item) => sum + item.overdue, 0);
    const totalDueSoon = stats.reduce((sum, item) => sum + item.dueSoon, 0);
    const totalWorkflows = stats.reduce((sum, item) => sum + item.workflows, 0);
    const averageProgress = totalTasks
      ? Math.round(stats.reduce((sum, item) => sum + item.averageProgress * item.total, 0) / totalTasks)
      : 0;

    return {
      activeProjects,
      totalTasks,
      totalOpen,
      totalOverdue,
      totalDueSoon,
      totalWorkflows,
      averageProgress,
    };
  }, [projectStatsById, selectedOrganizationProjects]);

  const healthCounts = useMemo(() => {
    return selectedOrganizationProjects.reduce(
      (counts, project) => {
        const stats = projectStatsById[project.id] || EMPTY_PROJECT_STATS;
        const health = getProjectHealth(stats);
        if (health.key === 'risk') counts.risk += 1;
        if (health.key === 'dueSoon') counts.dueSoon += 1;
        if (health.key === 'healthy') counts.healthy += 1;
        return counts;
      },
      { all: selectedOrganizationProjects.length, risk: 0, dueSoon: 0, healthy: 0 }
    );
  }, [projectStatsById, selectedOrganizationProjects]);

  const organizationStatsById = useMemo(() => {
    const initial = new Map<string, OrganizationStats>();
    visibleOrganizations.forEach((organization) => {
      initial.set(organization.id, {
        totalProjects: 0,
        activeProjects: 0,
        completedProjects: 0,
        pausedProjects: 0,
        memberCount: 0,
        lastActivity: 0,
      });
    });

    projects.forEach((project) => {
      getProjectOrganizationIds(project).forEach((organizationId) => {
        if (!initial.has(organizationId)) return;
        const current = initial.get(organizationId)!;
        current.totalProjects += 1;
        if (project.status === 'completed') current.completedProjects += 1;
        else current.activeProjects += 1;
        if (project.status === 'on-hold') current.pausedProjects += 1;
        current.lastActivity = Math.max(current.lastActivity, getTime(project.updatedAt || project.createdAt));
      });
    });

    visibleOrganizations.forEach((organization) => {
      const memberIds = new Set<string>();
      projects
        .filter((project) => belongsToAnyOrganization(project, [organization.id]))
        .forEach((project) => {
          (project.assignedTeamMembers || []).forEach((memberId: string) => memberIds.add(memberId));
        });
      const current = initial.get(organization.id);
      if (current) current.memberCount = memberIds.size;
    });

    return initial;
  }, [projects, visibleOrganizations]);

  const filteredOrganizations = useMemo(() => {
    const search = organizationSearch.trim().toLowerCase();
    return visibleOrganizations.filter((organization) => {
      if (!search) return true;
      const stats = organizationStatsById.get(organization.id);
      return [organization.name, organization.id, organization.description, stats?.totalProjects]
        .filter((value) => value !== undefined && value !== null)
        .some((value) => String(value).toLowerCase().includes(search));
    });
  }, [organizationSearch, organizationStatsById, visibleOrganizations]);

  const organizationOverviewStats = useMemo(() => {
    const memberIds = new Set<string>();
    projects.forEach((project) => {
      (project.assignedTeamMembers || []).forEach((memberId: string) => memberIds.add(memberId));
    });

    return {
      organizations: visibleOrganizations.length,
      projects: projects.length,
      activeProjects: projects.filter((project) => project.status !== 'completed').length,
      members: memberIds.size,
    };
  }, [projects, visibleOrganizations]);

  const filteredProjects = useMemo(() => {
    const search = projectSearch.trim().toLowerCase();

    return selectedOrganizationProjects.filter((project) => {
      const stats = projectStatsById[project.id] || EMPTY_PROJECT_STATS;
      const health = getProjectHealth(stats);
      const organization =
        organizationsById.get(project.organizationId) ||
        (project.organizationIds || [])
          .map((organizationId: string) => organizationsById.get(organizationId))
          .find(Boolean);
      const teamNames = (project.assignedTeamMembers || [])
        .map((memberId: string) => teamMembers.find((member) => member.id === memberId)?.name)
        .filter(Boolean)
        .join(' ');

      const matchesSearch =
        !search ||
        [project.name, project.description, organization?.name, teamNames]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(search));

      const matchesHealth =
        healthFilter === 'all' ||
        (healthFilter === 'risk' && health.key === 'risk') ||
        (healthFilter === 'dueSoon' && health.key === 'dueSoon') ||
        (healthFilter === 'healthy' && health.key === 'healthy');

      return matchesSearch && matchesHealth;
    });
  }, [healthFilter, organizationsById, projectSearch, projectStatsById, selectedOrganizationProjects, teamMembers]);

  const toggleMemberSelection = (memberId: string) => {
    setSelectedMembers(prev => 
      prev.includes(memberId) 
        ? prev.filter(id => id !== memberId)
        : [...prev, memberId]
    );
  };

  const toggleCreateProject = () => {
    setIsCreating((current) => {
      const next = !current;
      if (next) {
        setSelectedProjectOrgId(selectedOrganizationId || visibleOrganizations[0]?.id || '');
      }
      return next;
    });
  };

  const openOrganization = (organizationId: string) => {
    setSelectedOrganizationId(organizationId);
    setProjectSearch('');
    setHealthFilter('all');
  };

  const closeOrganization = () => {
    setSelectedOrganizationId(null);
    setProjectSearch('');
    setHealthFilter('all');
    setTasksByProject({});
  };

  const handleOpenEditTeam = (project: any) => {
    setEditingTeamProjectId(project.id);
    setEditSelectedMembers(project.assignedTeamMembers || []);
    setEditSelectedOrgId(project.organizationId || '');
    setEditProjectMode(isSoftwareProject(project) ? SOFTWARE_PROJECT_MODE : 'general');
  };

  const toggleEditMemberSelection = (memberId: string) => {
    setEditSelectedMembers(prev => 
      prev.includes(memberId) 
        ? prev.filter(id => id !== memberId)
        : [...prev, memberId]
    );
  };

  const handleSaveTeam = async () => {
    if (!editingTeamProjectId) return;
    setIsSavingTeam(true);
    try {
      const assignedEmails = editSelectedMembers
        .map(id => teamMembers.find(m => m.id === id)?.email)
        .filter(email => !!email);

      const updateData: any = {
        assignedTeamMembers: editSelectedMembers,
        assignedEmails: assignedEmails,
        projectMode: editProjectMode,
      };

      if (editProjectMode === SOFTWARE_PROJECT_MODE) {
        const currentProject = projects.find((project) => project.id === editingTeamProjectId);
        updateData.scrumSettings = currentProject?.scrumSettings || {
          productGoal: '',
          sprintLengthWeeks: 2,
          pointScale: [1, 2, 3, 5, 8, 13, 21],
        };
      }

      if (userRole === 'admin') {
         updateData.organizationId = editSelectedOrgId;
      } else if (userRole === 'org_admin' && visibleOrganizations.length > 1) {
        if (!editSelectedOrgId || !managedOrganizationIds.includes(editSelectedOrgId)) {
          toast.warning("Selecciona una organización válida para el proyecto.");
          setIsSavingTeam(false);
          return;
        }
        updateData.organizationId = editSelectedOrgId;
      }

      await updateDoc(doc(db, 'projects', editingTeamProjectId), updateData);
      toast.success("Proyecto actualizado exitosamente.");
      setEditingTeamProjectId(null);
    } catch (error) {
      console.error("Error updating project:", error);
      toast.error("Error al actualizar el proyecto");
    } finally {
      setIsSavingTeam(false);
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newProjectName.trim()) return;

    try {
      const projectOrganizationId =
        userRole === 'admin' || userRole === 'org_admin'
          ? selectedProjectOrgId || visibleOrganizations[0]?.id || ''
          : userOrganizationId || '';

      if (!projectOrganizationId) {
        toast.warning("Selecciona una organización para el proyecto.");
        return;
      }

      const assignedEmails = selectedMembers
        .map(id => teamMembers.find(m => m.id === id)?.email)
        .filter(email => !!email);

      await addDoc(collection(db, 'projects'), {
        name: newProjectName,
        description: newProjectDesc,
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        ownerId: user.uid,
        assignedUsers: [],
        assignedTeamMembers: selectedMembers,
        assignedEmails: assignedEmails,
        organizationId: projectOrganizationId,
        projectMode: newProjectMode,
        ...(newProjectMode === SOFTWARE_PROJECT_MODE
          ? {
              scrumSettings: {
                productGoal: '',
                sprintLengthWeeks: 2,
                pointScale: [1, 2, 3, 5, 8, 13, 21],
              },
            }
          : {}),
      });
      setIsCreating(false);
      setNewProjectName('');
      setNewProjectDesc('');
      setNewProjectMode('general');
      setSelectedMembers([]);
      setSelectedProjectOrgId('');
    } catch (error) {
      console.error("Error creating project:", error);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active': return <span className="rounded px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-amber-700 ring-1 ring-amber-100 bg-amber-50">Activo</span>;
      case 'completed': return <span className="rounded px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-700 ring-1 ring-emerald-100 bg-emerald-50">Completado</span>;
      case 'on-hold': return <span className="rounded px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-red-700 ring-1 ring-red-100 bg-red-50">En pausa</span>;
      default: return <span className="rounded px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-slate-600 ring-1 ring-slate-200 bg-slate-50">Proyecto</span>;
    }
  };

  const canEditProject = (project: any) => {
    return userRole === 'admin' || userRole === 'org_admin' || userRole === 'manager' || userRole === 'coordinador' || project.ownerId === user?.uid;
  };

  const canDeleteProject = (project: any) => {
    return userRole === 'admin' || (userRole === 'org_admin' && belongsToAnyOrganization(project, managedOrganizationIds)) || project.ownerId === user?.uid;
  };

  const handleDeleteProject = async (projectId: string) => {
    if (window.confirm("¿Estás seguro de que deseas eliminar este proyecto? Esta acción no se puede deshacer.")) {
      try {
        await deleteDoc(doc(db, 'projects', projectId));
        toast.success("Proyecto eliminado exitosamente.");
      } catch (error) {
        console.error("Error al eliminar proyecto:", error);
        toast.error("Error al eliminar el proyecto");
      }
    }
  };

  const getProjectMembers = (project: any) =>
    (project.assignedTeamMembers || [])
      .map((memberId: string) => teamMembers.find((member) => member.id === memberId))
      .filter(Boolean);

  const filterOptions: { id: HealthFilter; label: string; count: number }[] = [
    { id: 'all', label: 'Todos', count: healthCounts.all },
    { id: 'risk', label: 'Críticos', count: healthCounts.risk },
    { id: 'dueSoon', label: 'Por vencer', count: healthCounts.dueSoon },
    { id: 'healthy', label: 'Saludables', count: healthCounts.healthy },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="max-w-3xl">
              <div className="mb-3 inline-flex items-center gap-2 rounded bg-indigo-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-indigo-700 ring-1 ring-indigo-100">
                <Sparkles size={14} />
                Centro de proyectos
              </div>
              {selectedOrganization && (
                <button
                  type="button"
                  onClick={closeOrganization}
                  className="mb-3 inline-flex items-center gap-2 text-sm font-black text-slate-500 transition hover:text-indigo-700"
                >
                  <ChevronLeft size={16} />
                  Volver a organizaciones
                </button>
              )}
              <h1 className="text-3xl font-black tracking-tight text-slate-950">
                {selectedOrganization ? selectedOrganization.name || 'Organización' : 'Organizaciones'}
              </h1>
              <p className="mt-2 text-base font-medium text-slate-500">
                {selectedOrganization
                  ? 'Prioriza, compara y entra al proyecto correcto dentro de esta organización.'
                  : 'Primero elige la organización objetivo; luego verás únicamente los proyectos a los que tienes acceso.'}
              </p>
            </div>
            {(userRole === 'admin' || userRole === 'org_admin' || userRole === 'manager' || userRole === 'coordinador') && (
              <Button onClick={toggleCreateProject} className="h-12 shrink-0 bg-indigo-600 px-5 font-black hover:bg-indigo-700">
                <Plus size={18} />
                Nuevo Proyecto
              </Button>
            )}
          </div>
        </section>

        {selectedOrganization ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <PortfolioMetric
              label="Activos"
              value={compactNumber(portfolioStats.activeProjects)}
              detail={`${compactNumber(selectedOrganizationProjects.length)} proyectos en la organización`}
              icon={<FolderKanban size={20} />}
              tone="indigo"
            />
            <PortfolioMetric
              label="Tareas abiertas"
              value={compactNumber(portfolioStats.totalOpen)}
              detail={`${portfolioStats.averageProgress}% de avance promedio`}
              icon={<Target size={20} />}
              tone="emerald"
            />
            <PortfolioMetric
              label="Riesgo"
              value={compactNumber(portfolioStats.totalOverdue)}
              detail={`${compactNumber(portfolioStats.totalDueSoon)} por vencer pronto`}
              icon={<AlertTriangle size={20} />}
              tone={portfolioStats.totalOverdue > 0 ? 'red' : 'orange'}
            />
            <PortfolioMetric
              label="Workflows"
              value={compactNumber(portfolioStats.totalWorkflows)}
              detail={`${compactNumber(portfolioStats.totalTasks)} tareas monitoreadas`}
              icon={<Layers3 size={20} />}
              tone="indigo"
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <PortfolioMetric
              label="Organizaciones"
              value={compactNumber(organizationOverviewStats.organizations)}
              detail="Ámbitos a los que tienes acceso"
              icon={<Building2 size={20} />}
              tone="indigo"
            />
            <PortfolioMetric
              label="Proyectos visibles"
              value={compactNumber(organizationOverviewStats.projects)}
              detail={`${compactNumber(organizationOverviewStats.activeProjects)} activos`}
              icon={<FolderKanban size={20} />}
              tone="emerald"
            />
            <PortfolioMetric
              label="Equipo vinculado"
              value={compactNumber(organizationOverviewStats.members)}
              detail="Personas asignadas a proyectos visibles"
              icon={<Users size={20} />}
              tone="indigo"
            />
            <PortfolioMetric
              label="Cobertura"
              value={`${compactNumber(organizationOverviewStats.organizations)} ${
                organizationOverviewStats.organizations === 1 ? 'organización' : 'organizaciones'
              }`}
              detail={`${compactNumber(organizationOverviewStats.projects)} proyectos visibles`}
              icon={<Layers3 size={20} />}
              tone="orange"
            />
          </div>
        )}

        {isCreating && (
          <Card className="border-indigo-100 bg-indigo-50/30 shadow-sm">
            <CardContent className="pt-6">
              <form onSubmit={handleCreateProject} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Nombre del Proyecto</label>
                  <input 
                    type="text" 
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    className="w-full h-10 px-3 rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    placeholder="Ej. Actualización Catastral 2026"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Descripción</label>
                  <input 
                    type="text" 
                    value={newProjectDesc}
                    onChange={(e) => setNewProjectDesc(e.target.value)}
                    className="w-full h-10 px-3 rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    placeholder="Breve descripción del proyecto"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Tipo de proyecto</label>
                <div className="grid gap-3 md:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setNewProjectMode('general')}
                    className={`rounded-xl border p-4 text-left transition ${
                      newProjectMode === 'general'
                        ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-500/10'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-black text-slate-900">
                      <FolderKanban size={17} className="text-indigo-600" />
                      Proyecto operativo
                    </div>
                    <p className="mt-1 text-xs leading-5 text-slate-500">Mantiene la experiencia actual de tareas, documentos y operación.</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewProjectMode(SOFTWARE_PROJECT_MODE)}
                    className={`rounded-xl border p-4 text-left transition ${
                      newProjectMode === SOFTWARE_PROJECT_MODE
                        ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-500/10'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-black text-slate-900">
                      <Code2 size={17} className="text-indigo-600" />
                      Desarrollo de software
                    </div>
                    <p className="mt-1 text-xs leading-5 text-slate-500">Activa backlog, épicas, sprints, tablero y trabajo individual o colaborativo.</p>
                  </button>
                </div>
              </div>

              {(userRole === 'admin' || userRole === 'org_admin') && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Organización *</label>
                  <select 
                    value={selectedProjectOrgId}
                    onChange={(e) => setSelectedProjectOrgId(e.target.value)}
                    className="w-full h-10 px-3 rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
                    required
                  >
                    <option value="">Selecciona una organización</option>
                    {visibleOrganizations.map(org => (
                      <option key={org.id} value={org.id}>{org.name}</option>
                    ))}
                  </select>
                </div>
              )}
              
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Asignar Equipo (Opcional)</label>
                <div className="border border-slate-200 rounded-md p-3 max-h-40 overflow-y-auto bg-white">
                  {teamMembers.length === 0 ? (
                    <p className="text-sm text-slate-500 text-center py-2">No hay miembros en el equipo. Puedes añadirlos en la sección &quot;Team Performance&quot;.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                      {teamMembers.map(member => (
                        <label key={member.id} className="flex items-center gap-2 p-2 hover:bg-slate-50 rounded cursor-pointer border border-transparent hover:border-slate-100">
                          <input 
                            type="checkbox" 
                            checked={selectedMembers.includes(member.id)}
                            onChange={() => toggleMemberSelection(member.id)}
                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <div className="flex items-center gap-2 overflow-hidden">
                            <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs shrink-0">
                              {member.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="truncate">
                              <p className="text-sm font-medium text-slate-900 truncate">{member.name}</p>
                              <p className="text-xs text-slate-500 truncate">{member.roleName}</p>
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsCreating(false)}>Cancelar</Button>
                <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700">Guardar Proyecto</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

        {!selectedOrganization ? (
          <>
            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <h2 className="text-xl font-black tracking-tight text-slate-950">Organizaciones disponibles</h2>
                  <p className="mt-1 text-sm font-medium text-slate-500">
                    Selecciona la organización objetivo para ver sus proyectos y cargar sus métricas.
                  </p>
                </div>
                <span className="inline-flex h-9 items-center rounded border border-indigo-100 bg-indigo-50 px-3 text-xs font-black uppercase tracking-[0.12em] text-indigo-700">
                  {compactNumber(filteredOrganizations.length)} visibles
                </span>
              </div>
              <div className="mt-4">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={organizationSearch}
                    onChange={(event) => setOrganizationSearch(event.target.value)}
                    className="h-11 w-full rounded-md border border-slate-200 bg-white pl-10 pr-3 text-sm font-medium text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                    placeholder="Buscar organización..."
                  />
                </div>
              </div>
            </section>

            {loading ? (
              <div className="rounded-lg border border-slate-200 bg-white py-14 text-center text-slate-500 shadow-sm">Cargando organizaciones...</div>
            ) : visibleOrganizations.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-white py-14 text-center shadow-sm">
                <Building2 className="mx-auto mb-3 h-12 w-12 text-slate-300" />
                <h3 className="text-lg font-black text-slate-900">No hay organizaciones disponibles</h3>
                <p className="mt-1 text-slate-500">Tu usuario aún no tiene organizaciones o proyectos asociados.</p>
              </div>
            ) : filteredOrganizations.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-white py-14 text-center shadow-sm">
                <Search className="mx-auto mb-3 h-12 w-12 text-slate-300" />
                <h3 className="text-lg font-black text-slate-900">No encontramos organizaciones</h3>
                <p className="mt-1 text-slate-500">Prueba con otro nombre o limpia la búsqueda.</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="grid grid-cols-[minmax(0,1fr)_120px_120px_120px_150px_44px] gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400 max-xl:hidden">
                  <span>Organización</span>
                  <span>Proyectos</span>
                  <span>Activos</span>
                  <span>Equipo</span>
                  <span>Actividad</span>
                  <span />
                </div>
                <div className="divide-y divide-slate-100">
                  {filteredOrganizations.map((organization) => {
                    const stats = organizationStatsById.get(organization.id) || {
                      totalProjects: 0,
                      activeProjects: 0,
                      completedProjects: 0,
                      pausedProjects: 0,
                      memberCount: 0,
                      lastActivity: 0,
                    };
                    const lastActivityLabel = stats.lastActivity ? formatDate(stats.lastActivity) : 'Sin actividad';
                    const hasProjects = stats.totalProjects > 0;
                    const completionRatio = stats.totalProjects
                      ? Math.round((stats.completedProjects / stats.totalProjects) * 100)
                      : 0;

                    return (
                      <button
                        key={organization.id}
                        type="button"
                        onClick={() => openOrganization(organization.id)}
                        className="group grid w-full grid-cols-1 gap-4 bg-white px-4 py-4 text-left transition hover:bg-indigo-50/60 xl:grid-cols-[minmax(0,1fr)_120px_120px_120px_150px_44px]"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-sm shadow-indigo-600/20">
                            <Building2 size={23} />
                            <div className="absolute inset-0 opacity-0 transition group-hover:opacity-20 bg-white" />
                          </div>
                          <div className="min-w-0">
                            <div className="mb-1 flex flex-wrap items-center gap-2">
                              <span className="inline-flex rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-indigo-700 ring-1 ring-indigo-100">
                                Organización
                              </span>
                              <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] ring-1 ${hasProjects ? 'bg-emerald-50 text-emerald-700 ring-emerald-100' : 'bg-slate-50 text-slate-500 ring-slate-200'}`}>
                                {hasProjects ? 'Operativa' : 'Sin proyectos'}
                              </span>
                            </div>
                            <h3 className="truncate text-lg font-black tracking-tight text-slate-950 group-hover:text-indigo-800">
                              {organization.name || organization.id}
                            </h3>
                            <p className="mt-1 line-clamp-1 text-sm font-medium text-slate-500">
                              {organization.description || 'Agrupa proyectos, equipos y permisos de acceso.'}
                            </p>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4 xl:contents">
                          <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-100 xl:bg-transparent xl:p-0 xl:ring-0">
                            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400 xl:hidden">Proyectos</p>
                            <p className="text-lg font-black text-slate-950">{compactNumber(stats.totalProjects)}</p>
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                              <div className="h-full rounded-full bg-indigo-500" style={{ width: `${completionRatio}%` }} />
                            </div>
                          </div>
                          <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-100 xl:bg-transparent xl:p-0 xl:ring-0">
                            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400 xl:hidden">Activos</p>
                            <p className="text-lg font-black text-emerald-700">{compactNumber(stats.activeProjects)}</p>
                            <p className="text-[11px] font-bold text-slate-400">{compactNumber(stats.completedProjects)} cerrados</p>
                          </div>
                          <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-100 xl:bg-transparent xl:p-0 xl:ring-0">
                            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400 xl:hidden">Equipo</p>
                            <p className="text-lg font-black text-slate-950">{compactNumber(stats.memberCount)}</p>
                            <p className="text-[11px] font-bold text-slate-400">personas</p>
                          </div>
                          <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-100 xl:bg-transparent xl:p-0 xl:ring-0">
                            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400 xl:hidden">Actividad</p>
                            <p className="truncate text-sm font-black text-slate-700">{lastActivityLabel}</p>
                            <p className="truncate text-[11px] font-bold text-slate-400">
                              {stats.pausedProjects > 0
                                ? `${compactNumber(stats.pausedProjects)} en pausa`
                                : 'Lista para entrar'}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center justify-end xl:hidden">
                          <span className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-xs font-black text-white">
                            Entrar
                            <ArrowRight size={14} />
                          </span>
                        </div>
                        <div className="hidden items-center justify-end xl:flex">
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition group-hover:border-indigo-200 group-hover:bg-indigo-600 group-hover:text-white">
                            <ArrowRight size={16} />
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="text-xl font-black tracking-tight text-slate-950">Radar de proyectos</h2>
              <p className="mt-1 text-sm font-medium text-slate-500">Busca por nombre, organización o equipo asignado.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {filterOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setHealthFilter(option.id)}
                  className={`inline-flex h-9 items-center gap-2 rounded border px-3 text-xs font-black uppercase tracking-[0.12em] transition ${
                    healthFilter === option.id
                      ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-indigo-50'
                  }`}
                >
                  {option.label}
                  <span className={`rounded px-1.5 py-0.5 text-[10px] ${healthFilter === option.id ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>
                    {option.count}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-3 lg:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={projectSearch}
                onChange={(event) => setProjectSearch(event.target.value)}
                className="h-11 w-full rounded-md border border-slate-200 bg-white pl-10 pr-3 text-sm font-medium text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                placeholder="Buscar proyecto, organización o responsable..."
              />
            </div>
          </div>
        </section>

        {loading ? (
          <div className="rounded-lg border border-slate-200 bg-white py-14 text-center text-slate-500 shadow-sm">Cargando proyectos...</div>
        ) : selectedOrganizationProjects.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-white py-14 text-center shadow-sm">
            <Folder className="mx-auto mb-3 h-12 w-12 text-slate-300" />
            <h3 className="text-lg font-black text-slate-900">No hay proyectos en esta organización</h3>
            <p className="mt-1 text-slate-500">Crea un proyecto o revisa que tu usuario esté vinculado al equipo correcto.</p>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white py-14 text-center shadow-sm">
            <Search className="mx-auto mb-3 h-12 w-12 text-slate-300" />
            <h3 className="text-lg font-black text-slate-900">No encontramos coincidencias</h3>
            <p className="mt-1 text-slate-500">Prueba con otro nombre, organización o filtro de salud.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="grid grid-cols-[minmax(250px,1.35fr)_minmax(220px,1fr)_minmax(230px,.85fr)_minmax(112px,.35fr)] gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400 max-xl:hidden">
              <span>Proyecto</span>
              <span>Avance y señales</span>
              <span>Operación</span>
              <span className="text-right">Acciones</span>
            </div>
            <div className="divide-y divide-slate-100">
              {filteredProjects.map((project) => {
                const stats = projectStatsById[project.id] || EMPTY_PROJECT_STATS;
                const health = getProjectHealth(stats);
                const HealthIcon = health.icon;
                const projectMembers = getProjectMembers(project);
                const organization =
                  organizationsById.get(project.organizationId) ||
                  (project.organizationIds || [])
                    .map((organizationId: string) => organizationsById.get(organizationId))
                    .find(Boolean);
                const memberCount = project.assignedTeamMembers?.length || 0;
                const lastActivityLabel = stats.lastActivity ? formatDate(stats.lastActivity) : formatDate(project.updatedAt || project.createdAt);
                const progressValue = Math.min(Math.max(stats.averageProgress, 0), 100);

                return (
                  <article key={project.id} className="group relative overflow-hidden bg-white transition hover:bg-slate-50">
                    <div className={`absolute left-0 top-0 h-full w-1.5 ${health.rail}`} />
                    <div className={`pointer-events-none absolute inset-y-0 left-0 w-2/3 bg-gradient-to-r ${health.glow} opacity-0 transition group-hover:opacity-80`} />
                    <div className="relative grid grid-cols-1 gap-4 px-4 py-4 xl:grid-cols-[minmax(250px,1.35fr)_minmax(220px,1fr)_minmax(230px,.85fr)_minmax(112px,.35fr)] xl:items-center">
                      <div className="flex min-w-0 items-start gap-3 pl-2">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white text-indigo-600 shadow-sm ring-1 ring-slate-200 transition group-hover:ring-indigo-200">
                          <FolderKanban size={22} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            {getStatusBadge(project.status)}
                            {isSoftwareProject(project) && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-indigo-700 ring-1 ring-indigo-100">
                                <Code2 size={12} /> Scrum
                              </span>
                            )}
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ring-1 ${health.badge}`}>
                              <HealthIcon size={12} />
                              {health.label}
                            </span>
                          </div>
                          <h3 className="truncate text-lg font-black tracking-tight text-slate-950 group-hover:text-indigo-800">{project.name}</h3>
                          <p className="mt-1 line-clamp-1 text-sm font-medium text-slate-500">
                            {project.description || 'Sin descripción'}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-400">
                            <span className="inline-flex items-center gap-1">
                              <Building2 size={13} />
                              {organization?.name || 'Sin organización'}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Clock size={13} />
                              Actividad: {lastActivityLabel}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-100 bg-white/80 p-3 shadow-sm">
                        <div className="mb-2 flex items-center justify-between text-xs font-black uppercase tracking-[0.12em] text-slate-400">
                          <span>Avance general</span>
                          <span className="text-slate-800">{progressValue}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                          <div className={`h-full rounded-full ${health.rail}`} style={{ width: `${progressValue}%` }} />
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold text-slate-500">
                          <div className="flex min-w-0 items-center gap-2 rounded-lg bg-slate-50 px-2 py-1.5">
                            <Clock size={14} className="shrink-0 text-slate-400" />
                            <span className="truncate">Cierre: {formatShortDate(stats.nextDueDate)}</span>
                          </div>
                          <div className="flex min-w-0 items-center gap-2 rounded-lg bg-slate-50 px-2 py-1.5">
                            <BarChart3 size={14} className="shrink-0 text-slate-400" />
                            <span className="truncate">{compactNumber(stats.workflows)} workflows</span>
                          </div>
                        </div>
                      </div>

                      <div className="min-w-0 space-y-2">
                        <div className="grid grid-cols-3 gap-1.5">
                          <div className="min-w-0 rounded-lg bg-slate-50 px-2.5 py-2 ring-1 ring-slate-100">
                            <p className="truncate text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">Abiertas</p>
                            <p className="text-lg font-black text-slate-950">{compactNumber(stats.open)}</p>
                          </div>
                          <div className={`min-w-0 rounded-lg px-2.5 py-2 ring-1 ${stats.overdue > 0 ? 'bg-red-50 ring-red-100' : 'bg-slate-50 ring-slate-100'}`}>
                            <p className={`truncate text-[10px] font-black uppercase tracking-[0.12em] ${stats.overdue > 0 ? 'text-red-500' : 'text-slate-400'}`}>Vencidas</p>
                            <p className={`text-lg font-black ${stats.overdue > 0 ? 'text-red-700' : 'text-slate-950'}`}>{compactNumber(stats.overdue)}</p>
                          </div>
                          <div className={`min-w-0 rounded-lg px-2.5 py-2 ring-1 ${stats.dueSoon > 0 ? 'bg-orange-50 ring-orange-100' : 'bg-slate-50 ring-slate-100'}`}>
                            <p className={`truncate text-[10px] font-black uppercase tracking-[0.12em] ${stats.dueSoon > 0 ? 'text-orange-500' : 'text-slate-400'}`}>Próx.</p>
                            <p className={`text-lg font-black ${stats.dueSoon > 0 ? 'text-orange-700' : 'text-slate-950'}`}>{compactNumber(stats.dueSoon)}</p>
                          </div>
                        </div>
                        <div className="flex min-w-0 items-center gap-2 rounded-lg bg-white/70 px-1.5 py-1 ring-1 ring-slate-100">
                          <div className="flex shrink-0 -space-x-2 overflow-hidden">
                            {projectMembers.slice(0, 4).map((member: any) => {
                              const display = member.name || member.email || '?';
                              return (
                                <div key={member.id} className="relative inline-flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-indigo-100 text-[10px] font-black text-indigo-700 ring-2 ring-white" title={display}>
                                  {member.photoURL ? (
                                    <Image src={member.photoURL} alt={display} fill className="object-cover" referrerPolicy="no-referrer" />
                                  ) : (
                                    display.charAt(0).toUpperCase()
                                  )}
                                </div>
                              );
                            })}
                            {memberCount > 4 && (
                              <div className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-[10px] font-black text-slate-600 ring-2 ring-white">
                                +{memberCount - 4}
                              </div>
                            )}
                          </div>
                          <span className="truncate text-xs font-bold text-slate-500">
                            {memberCount} miembro{memberCount !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-start gap-2 xl:flex-col xl:items-stretch xl:justify-center">
                        {canEditProject(project) && (
                          <Button variant="outline" size="sm" onClick={() => handleOpenEditTeam(project)} className="h-9 justify-center border-slate-200 bg-white px-3 text-slate-600 hover:bg-slate-50 xl:w-full">
                            <Users size={14} />
                            <span className="xl:sr-only 2xl:not-sr-only">Equipo</span>
                          </Button>
                        )}
                        <Link href={`/projects/${project.id}${isSoftwareProject(project) ? '?tab=scrum' : ''}`} className="min-w-0 xl:w-full">
                          <Button className="h-9 w-full bg-slate-950 px-4 font-black text-white hover:bg-indigo-700">
                            Abrir
                            <ArrowRight size={15} />
                          </Button>
                        </Link>
                        {canDeleteProject(project) && (
                          <button
                            onClick={() => handleDeleteProject(project.id)}
                            className="flex h-9 w-9 items-center justify-center rounded-md border border-red-100 bg-white text-red-500 transition hover:bg-red-50 xl:w-full"
                            title="Eliminar proyecto"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}
          </>
        )}
      </div>
      
      {/* Edit Team Modal */}
      {editingTeamProjectId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 m-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">Editar Configuración del Proyecto</h3>
              <button onClick={() => setEditingTeamProjectId(null)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            
            {(userRole === 'admin' || (userRole === 'org_admin' && visibleOrganizations.length > 1)) && (
              <div className="space-y-2 mb-4">
                <label className="text-sm font-medium text-slate-700">Organización *</label>
                <select 
                  value={editSelectedOrgId}
                  onChange={(e) => setEditSelectedOrgId(e.target.value)}
                  className="w-full h-10 px-3 rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
                  required
                >
                  <option value="">Selecciona una organización</option>
                  {visibleOrganizations.map(org => (
                    <option key={org.id} value={org.id}>{org.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="mb-4 space-y-2">
              <label className="text-sm font-medium text-slate-700">Tipo de proyecto</label>
              <select
                value={editProjectMode}
                onChange={(event) => setEditProjectMode(event.target.value as ProjectMode)}
                className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="general">Proyecto operativo</option>
                <option value={SOFTWARE_PROJECT_MODE}>Desarrollo de software · Scrum</option>
              </select>
              {editProjectMode === SOFTWARE_PROJECT_MODE && (
                <p className="text-xs leading-5 text-slate-500">
                  Al guardar aparecerá el espacio Scrum. Las tareas y documentos existentes se conservan.
                </p>
              )}
            </div>
            
            <label className="text-sm font-medium text-slate-700 mb-2 block">Asignar Equipo</label>
            <div className="border border-slate-200 rounded-md p-3 max-h-60 overflow-y-auto bg-white mb-6">
              {teamMembers.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-2">No hay miembros en el equipo. Puedes añadirlos en la sección &quot;Team Performance&quot;.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {teamMembers.map(member => (
                    <label key={member.id} className="flex items-center gap-3 p-2 hover:bg-slate-50 rounded cursor-pointer border border-transparent hover:border-slate-100">
                      <input 
                        type="checkbox" 
                        checked={editSelectedMembers.includes(member.id)}
                        onChange={() => toggleEditMemberSelection(member.id)}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm shrink-0 overflow-hidden relative">
                          {member.photoURL ? (
                            <Image src={member.photoURL} alt={member.name} fill className="object-cover" referrerPolicy="no-referrer" />
                          ) : (
                            member.name.charAt(0).toUpperCase()
                          )}
                        </div>
                        <div className="truncate">
                          <p className="text-sm font-medium text-slate-900 truncate">{member.name}</p>
                          <p className="text-xs text-slate-500 truncate">{member.roleName}</p>
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setEditingTeamProjectId(null)} className="border-slate-200 text-slate-700 hover:bg-slate-50">
                Cancelar
              </Button>
              <Button onClick={handleSaveTeam} disabled={isSavingTeam} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                {isSavingTeam ? 'Guardando...' : 'Guardar Cambios'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
