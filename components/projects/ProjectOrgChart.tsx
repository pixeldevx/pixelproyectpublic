import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import Image from 'next/image';
import {
  ReactFlow,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  Node,
  Panel,
  MarkerType
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Save, Plus, Trash2, Users, ShieldCheck, WalletCards, AlertTriangle, BriefcaseBusiness, Maximize2, Minimize2, X, GitBranch, Building2 } from 'lucide-react';
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc } from '@/lib/supabase/document-store';
import { db } from '@/lib/backend';
import { toast } from 'sonner';
import { handleDataError, OperationType } from '@/lib/backend-utils';
import { useAuth } from '@/hooks/useAuth';
import { useRolePermissions } from '@/hooks/useRolePermissions';
import { getOrganizationIds } from '@/lib/organizations';
import {
  CONTRACTOR_ACCOUNT_APPROVAL_FIELDS,
  hasContractorAccountApprovalConfig,
  normalizeContractorAccountApprovalConfig,
  resolveContractorAccountApprovalConfig,
} from '@/lib/contractor-account-workflow';
import { saveContractorAccountRouteAndReconcile } from '@/lib/contractor-account-route-reconciliation';
import { OrgChartNode } from './OrgChartNode';

interface ProjectOrgChartProps {
  projectId: string;
  project?: any;
  teamMembers: any[];
}

type BudgetPiece = {
  assignedMemberIds?: string[];
  startMonth?: number;
  activeMonths?: number[];
  quantity?: number;
  duration?: number;
  multiplier?: number;
  unitCost?: number;
};

type BudgetLine = {
  id: string;
  name?: string;
  components?: BudgetPiece[];
};

type MemberCoverage = {
  memberId: string;
  allocated: number;
  coveredMonths: number;
  firstGapMonth: number | null;
  coveragePercent: number;
  status: 'covered' | 'gap' | 'uncovered';
  statusLabel: string;
};

const initialEdges: Edge[] = [];
const MONTH_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const COVERAGE_WINDOW = 12;
const getNewNodePosition = (currentCount: number, columnWidth = 160, rowHeight = 120) => ({
  x: 120 + (currentCount % 4) * columnWidth,
  y: 80 + (Math.floor(currentCount / 4) % 4) * rowHeight,
});

const currencyFormatter = (value: number, currency = 'COP') =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'COP' ? 0 : 2,
  }).format(Number.isFinite(value) ? value : 0);

const compactNumber = (value: number) => new Intl.NumberFormat('es-CO').format(Number.isFinite(value) ? value : 0);

const toNumber = (value: any, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeIds = (value: any) =>
  Array.from(new Set((Array.isArray(value) ? value : []).map((item) => String(item || '').trim()).filter(Boolean)));

const clampMonthNumber = (value: any, fallback = 1) => Math.max(1, Math.round(toNumber(value, fallback)));

const getTimelineMonthLabel = (monthNumber: number) => {
  const safeMonth = clampMonthNumber(monthNumber);
  const monthIndex = (safeMonth - 1) % MONTH_LABELS.length;
  const cycle = Math.floor((safeMonth - 1) / MONTH_LABELS.length);
  return cycle === 0 ? MONTH_LABELS[monthIndex] : `${MONTH_LABELS[monthIndex]} +${cycle}`;
};

const normalizeActiveMonths = (months: any[] = []) =>
  Array.from(new Set(months.map((month) => clampMonthNumber(month)).filter((month) => month > 0))).sort((a, b) => a - b);

const buildContinuousMonths = (startMonth: number, duration: number) =>
  Array.from({ length: Math.max(0, Math.ceil(toNumber(duration, 0))) }, (_, index) => clampMonthNumber(startMonth) + index);

const getPieceActiveMonths = (piece: BudgetPiece) => {
  if (Array.isArray(piece.activeMonths) && piece.activeMonths.length > 0) {
    return normalizeActiveMonths(piece.activeMonths);
  }
  return buildContinuousMonths(clampMonthNumber(piece.startMonth), Math.max(1, Math.ceil(toNumber(piece.duration, 1))));
};

const getPieceDuration = (piece: BudgetPiece) => {
  const parsedDuration = toNumber(piece.duration, NaN);
  return Number.isFinite(parsedDuration) ? Math.max(0, parsedDuration) : getPieceActiveMonths(piece).length || 0;
};

const pieceTotal = (piece: BudgetPiece) =>
  toNumber(piece.quantity) * getPieceDuration(piece) * toNumber(piece.multiplier, 1) * toNumber(piece.unitCost);

const memberName = (member: any) => member?.name || member?.email?.split('@')[0] || 'Profesional';

const statusClassName: Record<MemberCoverage['status'], string> = {
  covered: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  gap: 'bg-amber-50 text-amber-700 ring-amber-100',
  uncovered: 'bg-red-50 text-red-700 ring-red-100',
};

const buildCoverageByMember = (
  lines: BudgetLine[],
  members: any[],
  currentMonthNumber: number
) => {
  const map = new Map<string, MemberCoverage>();
  const activeMonthsByMember = new Map<string, Set<number>>();

  members.forEach((member) => {
    map.set(member.id, {
      memberId: member.id,
      allocated: 0,
      coveredMonths: 0,
      firstGapMonth: currentMonthNumber,
      coveragePercent: 0,
      status: 'uncovered',
      statusLabel: 'Sin cobertura',
    });
    activeMonthsByMember.set(member.id, new Set());
  });

  lines.forEach((line) => {
    (line.components || []).forEach((piece) => {
      const assignedIds = normalizeIds(piece.assignedMemberIds);
      if (assignedIds.length === 0) return;
      const pieceAmount = pieceTotal(piece);
      const activeMonths = getPieceActiveMonths(piece);

      assignedIds.forEach((memberId) => {
        const current = map.get(memberId) || {
          memberId,
          allocated: 0,
          coveredMonths: 0,
          firstGapMonth: currentMonthNumber,
          coveragePercent: 0,
          status: 'uncovered' as const,
          statusLabel: 'Sin cobertura',
        };
        current.allocated += pieceAmount;
        map.set(memberId, current);

        const activeMonthsForMember = activeMonthsByMember.get(memberId) || new Set<number>();
        activeMonths.forEach((month) => activeMonthsForMember.add(month));
        activeMonthsByMember.set(memberId, activeMonthsForMember);
      });
    });
  });

  map.forEach((coverage) => {
    const activeMonths = activeMonthsByMember.get(coverage.memberId) || new Set<number>();
    coverage.coveredMonths = Array.from(activeMonths).filter((month) => month >= currentMonthNumber && month < currentMonthNumber + COVERAGE_WINDOW).length;
    coverage.firstGapMonth = Array.from({ length: COVERAGE_WINDOW }, (_, index) => currentMonthNumber + index).find((month) => !activeMonths.has(month)) || null;
    coverage.coveragePercent = Math.round((coverage.coveredMonths / COVERAGE_WINDOW) * 100);
    coverage.status = coverage.allocated <= 0 ? 'uncovered' : coverage.firstGapMonth ? 'gap' : 'covered';
    coverage.statusLabel = coverage.status === 'covered' ? 'Cubierto' : coverage.status === 'gap' ? `Hueco desde ${getTimelineMonthLabel(coverage.firstGapMonth || currentMonthNumber)}` : 'Sin cobertura';
  });

  return map;
};

function CoveragePixels({ coverage, startMonth }: { coverage: MemberCoverage | null; startMonth: number }) {
  const months = Array.from({ length: COVERAGE_WINDOW }, (_, index) => startMonth + index);
  return (
    <div className="flex gap-1">
      {months.map((month) => {
        const covered = Boolean(coverage && coverage.coveredMonths > 0 && (!coverage.firstGapMonth || month < coverage.firstGapMonth));
        return (
          <span
            key={month}
            title={`${getTimelineMonthLabel(month)} · ${covered ? 'Con cobertura' : 'Sin cobertura'}`}
            className={`h-3.5 w-3.5 rounded border ${covered ? 'border-emerald-300 bg-emerald-500' : 'border-slate-200 bg-slate-100'}`}
          />
        );
      })}
    </div>
  );
}

function PersonnelMetric({
  label,
  value,
  detail,
  icon,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
  tone: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{label}</p>
          <p className="mt-2 truncate text-2xl font-black tracking-tight text-slate-950">{value}</p>
          <p className="mt-1 text-xs font-bold text-slate-500">{detail}</p>
        </div>
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ${tone}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

export function ProjectOrgChart({ projectId, project, teamMembers }: ProjectOrgChartProps) {
  const { userRole } = useAuth();
  const { permissions } = useRolePermissions(userRole);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [budgetLines, setBudgetLines] = useState<BudgetLine[]>([]);
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [contractorApprovalConfig, setContractorApprovalConfig] = useState<Record<string, string>>(
    () => normalizeContractorAccountApprovalConfig(project?.contractorAccountApprovalConfig)
  );
  const [isSavingContractorApprovalConfig, setIsSavingContractorApprovalConfig] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isApprovalRouteModalOpen, setIsApprovalRouteModalOpen] = useState(false);
  const loadedOrgChartProjectRef = useRef<string | null>(null);

  const nodeTypes = useMemo(() => ({ orgChartNode: OrgChartNode }), []);
  const canView = Boolean(permissions.orgChartView);
  const canEdit = Boolean(permissions.orgChartManage);
  const canViewBudget = Boolean(permissions.personnelBudgetView);
  const currentMonthNumber = new Date().getMonth() + 1;
  const projectOrganizationIds = useMemo(() => getOrganizationIds(project), [project]);
  const projectOrganization = useMemo(() => {
    const organizationId = projectOrganizationIds[0];
    return organizations.find((organization) => organization.id === organizationId) || null;
  }, [organizations, projectOrganizationIds]);
  const organizationApprovalConfig = useMemo(
    () => normalizeContractorAccountApprovalConfig(projectOrganization?.contractorAccountApprovalConfig),
    [projectOrganization]
  );
  const hasProjectApprovalConfig = hasContractorAccountApprovalConfig(contractorApprovalConfig);
  const effectiveContractorApprovalConfig = useMemo(
    () => resolveContractorAccountApprovalConfig(contractorApprovalConfig, organizationApprovalConfig),
    [contractorApprovalConfig, organizationApprovalConfig]
  );
  const activeApproverCount = useMemo(
    () => CONTRACTOR_ACCOUNT_APPROVAL_FIELDS.filter((field) => String(effectiveContractorApprovalConfig[field.key] || '').trim()).length,
    [effectiveContractorApprovalConfig]
  );
  const memberOptionId = useCallback((member: any) => (
    String(member?.id || member?.authUserId || member?.uid || member?.email || '').trim()
  ), []);
  const memberNameById = useCallback((value: string) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return 'Sin responsable';
    const member = teamMembers.find((item) => [item?.id, item?.authUserId, item?.uid, item?.email]
      .some((candidate) => String(candidate || '').trim().toLowerCase() === normalized));
    return member ? memberName(member) : 'Responsable no vinculado';
  }, [teamMembers]);

  const handleNodeLabelChange = useCallback((id: string, newLabel: string) => {
    setNodes((nds) =>
      nds.map((node) => (
        node.id === id
          ? {
              ...node,
              data: {
                ...node.data,
                label: newLabel,
              },
            }
          : node
      ))
    );
  }, [setNodes]);

  const handleNodeAliasChange = useCallback((id: string, newAlias: string) => {
    setNodes((nds) =>
      nds.map((node) => (
        node.id === id
          ? {
              ...node,
              data: {
                ...node.data,
                alias: newAlias,
              },
            }
          : node
      ))
    );
  }, [setNodes]);

  const coverageByMember = useMemo(
    () => buildCoverageByMember(budgetLines, teamMembers, currentMonthNumber),
    [budgetLines, currentMonthNumber, teamMembers]
  );

  const enrichNodeData = useCallback((node: Node, coverageMap = coverageByMember): Node => {
    const memberId = String(node.data?.memberId || '');
    const member = memberId ? teamMembers.find((item) => item.id === memberId) : null;
    const coverage = memberId ? coverageMap.get(memberId) : null;

    return {
      ...node,
      data: {
        ...node.data,
        label: member ? memberName(member) : node.data?.label || 'Doble clic para editar',
        member: member?.role || member?.systemRole || node.data?.member || 'Miembro',
        alias: node.data?.alias || node.data?.positionAlias || '',
        photoURL: member?.photoURL || node.data?.photoURL || null,
        coverageStatus: coverage?.status,
        coverageLabel: canViewBudget ? coverage?.statusLabel : 'Presupuesto protegido',
        budgetAmount: canViewBudget ? coverage?.allocated : null,
        canEdit,
        onChange: (newLabel: string) => handleNodeLabelChange(node.id, newLabel),
        onAliasChange: (newAlias: string) => handleNodeAliasChange(node.id, newAlias),
      },
    };
  }, [canEdit, canViewBudget, coverageByMember, handleNodeAliasChange, handleNodeLabelChange, teamMembers]);

  useEffect(() => {
    if (!isFullscreen) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsFullscreen(false);
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFullscreen]);

  useEffect(() => {
    if (!canView) return;
    if (loadedOrgChartProjectRef.current === projectId) return;

    loadedOrgChartProjectRef.current = projectId;

    const fetchOrgChart = async () => {
      setIsLoading(true);
      try {
        const [docSnap, budgetSnapshot, organizationsSnapshot] = await Promise.all([
          getDoc(doc(db, 'projects', projectId, 'orgChart', 'data')),
          getDocs(collection(db, 'projects', projectId, 'budgetLines')),
          getDocs(collection(db, 'organizations')),
        ]);

        const loadedBudgetLines = budgetSnapshot.docs.map((docSnapItem) => ({ id: docSnapItem.id, ...docSnapItem.data() } as BudgetLine));
        const loadedCoverageByMember = buildCoverageByMember(loadedBudgetLines, teamMembers, currentMonthNumber);
        setBudgetLines(loadedBudgetLines);
        setOrganizations(organizationsSnapshot.docs.map((organizationDoc) => ({ id: organizationDoc.id, ...organizationDoc.data() })));

        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.nodes && data.nodes.length > 0) {
            setNodes(data.nodes.map((node: Node) => enrichNodeData(node, loadedCoverageByMember)));
          } else {
            setNodes([enrichNodeData({
              id: '1',
              type: 'orgChartNode',
              data: { label: 'Director del Proyecto' },
              position: { x: 250, y: 25 },
            }, loadedCoverageByMember)]);
          }
          if (data.edges) {
            setEdges(data.edges);
          }
        } else {
          setNodes([enrichNodeData({
            id: '1',
            type: 'orgChartNode',
            data: { label: 'Director del Proyecto' },
            position: { x: 250, y: 25 },
          }, loadedCoverageByMember)]);
        }
      } catch (error) {
        loadedOrgChartProjectRef.current = null;
        console.error("Error fetching org chart:", error);
        handleDataError(error, OperationType.GET, `projects/${projectId}/orgChart/data`);
      } finally {
        setIsLoading(false);
      }
    };

    void fetchOrgChart();
  }, [canView, currentMonthNumber, enrichNodeData, projectId, setEdges, setNodes, teamMembers]);

  const onConnect = useCallback(
    (params: Connection | Edge) => {
      if (!canEdit) return;
      setEdges((eds) => addEdge({ ...params, type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } }, eds));
    },
    [canEdit, setEdges],
  );

  const onSave = useCallback(async () => {
    if (!canEdit) {
      toast.error('No tienes permiso para editar el organigrama.');
      return;
    }

    setIsSaving(true);
    try {
      const nodesToSave = nodes.map(node => {
        const dataToSave = { ...node.data };
        delete dataToSave.onChange;
        delete dataToSave.onAliasChange;
        delete dataToSave.canEdit;
        return {
          ...node,
          data: dataToSave
        };
      });

      await setDoc(doc(db, 'projects', projectId, 'orgChart', 'data'), {
        nodes: nodesToSave,
        edges,
        updatedAt: new Date()
      });
      toast.success('Organigrama guardado correctamente');
    } catch (error: any) {
      console.error("Error saving org chart:", error);
      toast.error(`Error al guardar: ${error.message}`);
      handleDataError(error, OperationType.WRITE, `projects/${projectId}/orgChart/data`);
    } finally {
      setIsSaving(false);
    }
  }, [canEdit, projectId, nodes, edges]);

  const saveContractorApprovalConfig = useCallback(async () => {
    if (!canEdit) {
      toast.error('No tienes permiso para configurar aprobaciones del proyecto.');
      return;
    }

    setIsSavingContractorApprovalConfig(true);
    try {
      const configToSave = normalizeContractorAccountApprovalConfig(contractorApprovalConfig);
      const result = await saveContractorAccountRouteAndReconcile({
        scope: 'project',
        targetId: projectId,
        nextConfig: configToSave,
      });
      toast.success(
        `${hasContractorAccountApprovalConfig(configToSave)
          ? 'Ruta particular del proyecto guardada.'
          : 'Ruta particular vacía. Pixel usará la configuración global.'}${
          result.reassignedCount > 0
            ? ` ${result.reassignedCount} cuenta${result.reassignedCount === 1 ? '' : 's'} activa${result.reassignedCount === 1 ? '' : 's'} reasignada${result.reassignedCount === 1 ? '' : 's'}.`
            : ''
        }`
      );
      if (result.notificationFailureCount > 0) {
        toast.warning('La ruta quedó actualizada, pero alguna notificación no pudo enviarse.');
      }
      if (result.reconciliationFailureCount > 0) {
        toast.warning('La ruta quedó guardada, pero alguna cuenta no pudo reasignarse. Revisa las cuentas activas.');
      }
      if (result.concurrentChangeCount > 0) {
        toast.warning('Una cuenta cambió mientras se guardaba la ruta. No se envió una alerta obsoleta; revisa su responsable actual.');
      }
      setIsApprovalRouteModalOpen(false);
    } catch (error: any) {
      console.error('Error saving project contractor approval config:', error);
      toast.error(`No se pudo guardar la ruta de aprobaciones: ${error.message || 'error desconocido'}`);
      handleDataError(error, OperationType.WRITE, `projects/${projectId}`);
    } finally {
      setIsSavingContractorApprovalConfig(false);
    }
  }, [canEdit, contractorApprovalConfig, projectId]);

  const addCustomNode = () => {
    if (!canEdit) return;
    const newId = `node_${new Date().getTime()}`;
    const newNode: Node = enrichNodeData({
      id: newId,
      type: 'orgChartNode',
      data: { label: 'Doble clic para editar', alias: 'Cargo o alias' },
      position: getNewNodePosition(nodes.length, 150, 110),
    });
    setNodes((nds) => nds.concat(newNode));
    setIsAddMenuOpen(false);
  };

  const addTeamMemberNode = (member: any) => {
    if (!canEdit) return;
    const newId = `node_${new Date().getTime()}`;
    const newNode: Node = enrichNodeData({
      id: newId,
      type: 'orgChartNode',
      data: {
        label: memberName(member),
        member: member.role || member.systemRole || 'Miembro',
        alias: member.role || member.systemRole || '',
        memberId: member.id,
        photoURL: member.photoURL || null,
      },
      position: getNewNodePosition(nodes.length),
    });
    setNodes((nds) => nds.concat(newNode));
    setIsAddMenuOpen(false);
  };

  const deleteSelected = () => {
    if (!canEdit) return;
    setNodes((nds) => nds.filter((node) => !node.selected));
    setEdges((eds) => eds.filter((edge) => !edge.selected));
  };

  const metrics = useMemo(() => {
    const coverages = Array.from(coverageByMember.values());
    return {
      people: teamMembers.length,
      allocated: coverages.reduce((sum, coverage) => sum + coverage.allocated, 0),
      uncovered: coverages.filter((coverage) => coverage.status === 'uncovered').length,
      gaps: coverages.filter((coverage) => coverage.status === 'gap').length,
    };
  }, [coverageByMember, teamMembers.length]);

  const flowCanvas = (
    <div
      className={
        isFullscreen
          ? 'fixed inset-0 z-[90] flex flex-col bg-white'
          : 'flex h-[680px] min-h-[560px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm'
      }
    >
      {isFullscreen && (
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-950 px-5 py-4 text-white">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.28em] text-indigo-200">Organigrama interactivo</p>
            <h2 className="truncate text-2xl font-black">Vista completa del equipo</h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setIsFullscreen(false)}
            className="text-white hover:bg-white/10 hover:text-white"
            aria-label="Cerrar pantalla completa"
          >
            <X size={22} />
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={canEdit ? onNodesChange : undefined}
          onEdgesChange={canEdit ? onEdgesChange : undefined}
          onConnect={onConnect}
          nodesDraggable={canEdit}
          nodesConnectable={canEdit}
          elementsSelectable={canEdit}
          fitView
          attributionPosition="bottom-left"
        >
          <Panel position="top-right" className="flex flex-wrap justify-end gap-2">
            <Button onClick={() => setIsFullscreen((value) => !value)} variant="outline" size="sm" className="bg-white font-bold shadow-sm">
              {isFullscreen ? <Minimize2 size={16} className="mr-1" /> : <Maximize2 size={16} className="mr-1" />}
              {isFullscreen ? 'Salir' : 'Pantalla completa'}
            </Button>
            {canEdit && (
              <>
                <div className="relative">
                  <Button onClick={() => setIsAddMenuOpen(!isAddMenuOpen)} variant="outline" size="sm" className="bg-white font-bold shadow-sm">
                    <Plus size={16} className="mr-1" /> Nuevo nodo
                  </Button>
                  {isAddMenuOpen && (
                    <div className="absolute right-0 top-full z-50 mt-2 max-h-96 w-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-900/10">
                      <div className="px-2 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Estructura</div>
                      <button
                        onClick={addCustomNode}
                        className="w-full rounded-lg px-2 py-2 text-left text-sm font-bold text-slate-700 hover:bg-slate-50"
                      >
                        Nodo personalizado
                      </button>
                      {teamMembers.length > 0 && (
                        <>
                          <div className="mt-3 px-2 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Personas del proyecto</div>
                          {teamMembers.map(member => (
                            <button
                              key={member.id}
                              onClick={() => addTeamMemberNode(member)}
                              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-indigo-50"
                            >
                              <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full bg-indigo-100 text-indigo-600">
                                {member.photoURL ? (
                                  <Image src={member.photoURL} alt={memberName(member)} fill className="object-cover" referrerPolicy="no-referrer" />
                                ) : (
                                  <span className="flex h-full w-full items-center justify-center text-xs font-black">{memberName(member).charAt(0).toUpperCase()}</span>
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="truncate text-sm font-black text-slate-900">{memberName(member)}</div>
                                <div className="truncate text-xs font-semibold text-slate-500">{member.role || member.systemRole || 'Miembro'}</div>
                              </div>
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>
                <Button onClick={deleteSelected} variant="outline" size="sm" className="bg-white font-bold text-red-600 shadow-sm hover:text-red-700">
                  <Trash2 size={16} className="mr-1" /> Eliminar
                </Button>
              </>
            )}
            <Button onClick={onSave} disabled={isSaving || !canEdit} size="sm" className="bg-indigo-600 font-bold text-white shadow-sm hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-500">
              <Save size={16} className="mr-1" /> {isSaving ? 'Guardando...' : canEdit ? 'Guardar' : 'Solo lectura'}
            </Button>
          </Panel>
          <Controls />
          <Background color="#dbe4f0" gap={18} />
        </ReactFlow>
      </div>
    </div>
  );

  if (!canView) {
    return (
      <section className="rounded-2xl border border-amber-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-700 ring-1 ring-amber-100">
          <ShieldCheck size={28} />
        </div>
        <h2 className="mt-4 text-2xl font-black tracking-tight text-slate-950">Organigrama protegido</h2>
        <p className="mx-auto mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-500">
          El organigrama y el panel administrativo de personal requieren permiso de visualización.
        </p>
      </section>
    );
  }

  if (isLoading) {
    return <div className="flex h-[600px] items-center justify-center text-slate-500">Cargando organigrama...</div>;
  }

  return (
    <div className="space-y-5">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <PersonnelMetric
          label="Equipo visible"
          value={compactNumber(metrics.people)}
          detail="personas asignadas al proyecto"
          icon={<Users size={21} className="text-indigo-700" />}
          tone="bg-indigo-50 text-indigo-700 ring-indigo-100"
        />
        <PersonnelMetric
          label="Cobertura"
          value={canViewBudget ? currencyFormatter(metrics.allocated) : 'Protegida'}
          detail={canViewBudget ? 'presupuesto de personal' : 'requiere permiso'}
          icon={<WalletCards size={21} className="text-emerald-700" />}
          tone="bg-emerald-50 text-emerald-700 ring-emerald-100"
        />
        <PersonnelMetric
          label="Sin cobertura"
          value={compactNumber(metrics.uncovered)}
          detail="personas sin pieza asignada"
          icon={<AlertTriangle size={21} className="text-red-700" />}
          tone="bg-red-50 text-red-700 ring-red-100"
        />
        <PersonnelMetric
          label="Huecos"
          value={compactNumber(metrics.gaps)}
          detail="cobertura incompleta a 12 meses"
          icon={<BriefcaseBusiness size={21} className="text-orange-700" />}
          tone="bg-orange-50 text-orange-700 ring-orange-100"
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_360px]">
        {flowCanvas}

        <aside className="space-y-4">
          <section className="rounded-2xl border border-cyan-200 bg-cyan-50/70 p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-cyan-700 ring-1 ring-cyan-100">
                <GitBranch size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[10px] font-black uppercase tracking-[0.2em] text-cyan-700">Ruta cuentas</p>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-wider ring-1 ${
                    hasProjectApprovalConfig
                      ? 'bg-cyan-100 text-cyan-800 ring-cyan-200'
                      : 'bg-white text-slate-600 ring-slate-200'
                  }`}>
                    {hasProjectApprovalConfig ? 'Proyecto' : 'Global'}
                  </span>
                </div>
                <h3 className="mt-1 text-base font-black text-slate-950">Aprobaciones de cuentas</h3>
                <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                  {activeApproverCount} de {CONTRACTOR_ACCOUNT_APPROVAL_FIELDS.length} responsables configurados.
                </p>
                <Button
                  type="button"
                  onClick={() => setIsApprovalRouteModalOpen(true)}
                  variant="outline"
                  className="mt-3 h-9 w-full border-cyan-200 bg-white text-xs font-black text-cyan-800 hover:bg-cyan-100"
                >
                  Configurar ruta
                </Button>
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 p-4">
              <h3 className="text-lg font-black text-slate-950">Personal del proyecto</h3>
              <p className="text-sm font-semibold text-slate-500">Cobertura y alertas antes de ubicar a cada persona en el organigrama.</p>
            </div>
            <div className="max-h-[616px] divide-y divide-slate-100 overflow-y-auto">
              {teamMembers.length === 0 ? (
                <div className="p-6 text-center text-sm font-bold text-slate-500">No hay personas asignadas a este proyecto.</div>
              ) : teamMembers.map((member) => {
                const coverage = coverageByMember.get(member.id) || null;
                const status = coverage?.status || 'uncovered';
                return (
                  <div key={member.id} className="p-4 transition hover:bg-slate-50">
                    <div className="flex items-start gap-3">
                      <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full bg-indigo-100 text-indigo-700 ring-1 ring-indigo-100">
                        {member.photoURL ? (
                          <Image src={member.photoURL} alt={memberName(member)} fill className="object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-sm font-black">{memberName(member).charAt(0).toUpperCase()}</span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-black text-slate-950">{memberName(member)}</p>
                            <p className="truncate text-xs font-bold text-slate-500">{member.role || member.systemRole || 'Sin rol'}</p>
                          </div>
                          <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-wider ring-1 ${statusClassName[status]}`}>
                            {coverage?.statusLabel || 'Sin cobertura'}
                          </span>
                        </div>
                        <div className="mt-3">
                          <CoveragePixels coverage={coverage} startMonth={currentMonthNumber} />
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-black text-slate-900">{canViewBudget ? currencyFormatter(coverage?.allocated || 0) : 'Presupuesto protegido'}</p>
                            <Progress value={coverage?.coveragePercent || 0} className="mt-1 h-1.5 bg-slate-100" />
                          </div>
                          {canEdit && (
                            <Button type="button" variant="outline" size="sm" onClick={() => addTeamMemberNode(member)} className="h-8 shrink-0 border-slate-200 text-xs font-black">
                              Agregar
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </aside>
      </section>

      {isApprovalRouteModalOpen && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl shadow-slate-950/30">
            <div className="flex items-start justify-between gap-4 border-b border-cyan-100 bg-cyan-50/80 p-5">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-700">
                  <GitBranch size={15} /> Ruta de cuentas de cobro
                </p>
                <h3 className="mt-1 text-2xl font-black tracking-tight text-slate-950">Aprobaciones del proyecto</h3>
                <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-600">
                  Configura una ruta particular para este proyecto. Si todos los campos quedan vacíos, Pixel usa la ruta global de la organización.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-wider ring-1 ${
                  hasProjectApprovalConfig
                    ? 'bg-cyan-100 text-cyan-800 ring-cyan-200'
                    : 'bg-white text-slate-600 ring-slate-200'
                }`}>
                  {hasProjectApprovalConfig ? 'Configuración del proyecto' : 'Heredando global'}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsApprovalRouteModalOpen(false)}
                  className="h-9 w-9 rounded-full text-slate-500 hover:bg-white hover:text-slate-900"
                  aria-label="Cerrar configuración de ruta"
                >
                  <X size={18} />
                </Button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="grid gap-3 md:grid-cols-2">
                {CONTRACTOR_ACCOUNT_APPROVAL_FIELDS.map((field, index) => {
                  const localValue = contractorApprovalConfig[field.key] || '';
                  const inheritedValue = organizationApprovalConfig[field.key] || '';
                  const effectiveValue = effectiveContractorApprovalConfig[field.key] || '';
                  const isInherited = !localValue && Boolean(inheritedValue);
                  return (
                    <div key={field.key} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Paso {index + 1}</p>
                          <p className="truncate text-base font-black text-slate-950">{field.label}</p>
                          <p className="text-xs font-semibold text-slate-500">{field.detail}</p>
                        </div>
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-cyan-700 ring-1 ring-cyan-100">
                          {index + 1}
                        </div>
                      </div>
                      <select
                        value={localValue}
                        onChange={(event) => setContractorApprovalConfig((current) => ({
                          ...current,
                          [field.key]: event.target.value,
                        }))}
                        disabled={!canEdit}
                        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100 disabled:bg-slate-100 disabled:text-slate-500"
                      >
                        <option value="">{inheritedValue ? 'Usar heredado global' : 'Sin responsable'}</option>
                        {teamMembers.map((member) => {
                          const optionId = memberOptionId(member);
                          if (!optionId) return null;
                          return (
                            <option key={optionId} value={optionId}>
                              {memberName(member)} · {member.role || member.systemRole || 'Miembro'}
                            </option>
                          );
                        })}
                      </select>
                      <p className="mt-2 flex items-center gap-1 text-xs font-bold text-slate-500">
                        {isInherited ? <Building2 size={13} /> : <Users size={13} />}
                        {isInherited
                          ? `Heredado: ${memberNameById(inheritedValue)}`
                          : effectiveValue
                            ? `Activo: ${memberNameById(effectiveValue)}`
                            : 'Este paso aún no tiene responsable configurado.'}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-slate-100 bg-white p-5 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsApprovalRouteModalOpen(false)}
                className="font-bold"
              >
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={saveContractorApprovalConfig}
                disabled={!canEdit || isSavingContractorApprovalConfig}
                className="bg-cyan-600 font-black text-white hover:bg-cyan-700 disabled:bg-slate-200 disabled:text-slate-500"
              >
                <Save size={16} className="mr-2" />
                {isSavingContractorApprovalConfig ? 'Guardando ruta...' : canEdit ? 'Guardar ruta del proyecto' : 'Solo lectura'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
