"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Connection,
  type Node,
  type OnNodeDrag,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  CheckCircle2,
  ClipboardList,
  Diamond,
  GitBranch,
  Maximize2,
  MousePointer2,
  Plus,
  Route,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { WorkflowStepFormBuilderModal } from "@/components/projects/WorkflowStepFormBuilderModal";
import {
  createWorkflowRouteId,
  getWorkflowRouteDescription,
  getWorkflowStepFormFields,
  getWorkflowTargetLabel,
  normalizeWorkflowDefaultTarget,
  normalizeWorkflowParallelRoutes,
  normalizeWorkflowRoutes,
  routeOperatorNeedsValue,
  WORKFLOW_ROUTE_OPERATORS,
  type WorkflowConditionalRoute,
  type WorkflowParallelRoute,
  type WorkflowRouteOperator,
  type WorkflowRouteTarget,
} from "@/lib/workflow-routing";

type WorkflowRoutingBuilderProps = {
  steps: any[];
  onChange: (steps: any[]) => void;
  rateCards?: any[];
  teamMembers?: any[];
  allowAnyTarget?: boolean;
  linearOnly?: boolean;
  projectId?: string;
  project?: any;
  onSaveView?: (steps: any[]) => Promise<void> | void;
};

const COMPLETE_NODE_ID = "workflow-complete";
const DECISION_NODE_PREFIX = "workflow-decision-";
const PARALLEL_NODE_PREFIX = "workflow-parallel-";

type WorkflowConnectMode = "default" | "condition" | "parallel";

const getStepTitle = (step: any, index: number) =>
  String(step?.label || `Paso ${index + 1}`);

const getDefaultRouteTarget = (currentIndex: number, stepCount: number): WorkflowRouteTarget =>
  currentIndex < stepCount - 1 ? currentIndex + 1 : "complete";

type WorkflowNodePosition = {
  x: number;
  y: number;
};

const normalizeWorkflowNodePosition = (value: any): WorkflowNodePosition | null => {
  const x = Number(value?.x);
  const y = Number(value?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
};

const getDefaultWorkflowNodePosition = (index: number): WorkflowNodePosition => ({
  x: index * 360,
  y: index % 2 === 0 ? 0 : 36,
});

const getWorkflowNodePosition = (step: any, index: number): WorkflowNodePosition =>
  normalizeWorkflowNodePosition(step?.visualPosition || step?.workflowPosition || step?.nodePosition) ||
  getDefaultWorkflowNodePosition(index);

const getWorkflowCompleteNodePosition = (
  steps: any[],
  fallbackPosition: WorkflowNodePosition
): WorkflowNodePosition =>
  normalizeWorkflowNodePosition(
    steps[0]?.workflowCompletePosition ||
      steps[0]?.completeNodePosition ||
      steps[0]?.workflowEndPosition
  ) || fallbackPosition;

const getTargetOptions = (steps: any[], currentIndex: number, allowAnyTarget = false) => {
  const targetSteps = steps
    .map((step, index) => ({ step, index }))
    .filter(({ index }) => (allowAnyTarget ? index !== currentIndex : index > currentIndex));

  return [
    ...targetSteps.map(({ step, index }) => ({
      value: String(index),
      label:
        allowAnyTarget && index < currentIndex
          ? `↩ Devolver a paso ${index + 1}: ${step.label || "Sin nombre"}`
          : allowAnyTarget && index > currentIndex
            ? `Avanzar a paso ${index + 1}: ${step.label || "Sin nombre"}`
            : `Paso ${index + 1}: ${step.label || "Sin nombre"}`,
    })),
    { value: "complete", label: "Finalizar workflow" },
  ];
};

const targetToSelectValue = (target: WorkflowRouteTarget | undefined | null, currentIndex: number, stepCount: number) => {
  if (target === "complete") return "complete";
  if (typeof target === "number") return String(target);
  return "";
};

const selectValueToTarget = (value: string): WorkflowRouteTarget =>
  value === "" ? null :
  value === "complete" ? "complete" : Number(value);

const targetToNodeId = (target: WorkflowRouteTarget | undefined, currentIndex: number, stepCount: number) => {
  const resolvedTarget = target;
  if (resolvedTarget === "complete") return COMPLETE_NODE_ID;
  if (resolvedTarget === null || resolvedTarget === undefined) return null;
  if (typeof resolvedTarget !== "number") return null;
  if (resolvedTarget < 0 || resolvedTarget >= stepCount || resolvedTarget === currentIndex) return null;
  return `workflow-step-${resolvedTarget}`;
};

const nodeIdToTarget = (nodeId?: string | null): WorkflowRouteTarget | undefined => {
  if (!nodeId) return undefined;
  if (nodeId === COMPLETE_NODE_ID) return "complete";
  if (!nodeId.startsWith("workflow-step-")) return undefined;
  const index = Number(nodeId.replace("workflow-step-", ""));
  return Number.isFinite(index) ? index : undefined;
};

const parseWorkflowEditorNodeId = (nodeId?: string | null) => {
  if (!nodeId) return null;
  if (nodeId.startsWith("workflow-step-")) {
    const stepIndex = Number(nodeId.replace("workflow-step-", ""));
    return Number.isFinite(stepIndex) ? { kind: "step" as const, stepIndex } : null;
  }
  if (nodeId.startsWith(DECISION_NODE_PREFIX)) {
    const stepIndex = Number(nodeId.replace(DECISION_NODE_PREFIX, ""));
    return Number.isFinite(stepIndex) ? { kind: "decision" as const, stepIndex } : null;
  }
  if (nodeId.startsWith(PARALLEL_NODE_PREFIX)) {
    const stepIndex = Number(nodeId.replace(PARALLEL_NODE_PREFIX, ""));
    return Number.isFinite(stepIndex) ? { kind: "parallel" as const, stepIndex } : null;
  }
  return null;
};

function WorkflowStepNode({ data, selected }: NodeProps) {
  const nodeData = data as any;
  const routeCount = Number(nodeData.routeCount || 0);
  const hasForm = Boolean(nodeData.hasForm);

  return (
    <div
      className={`w-[260px] cursor-grab rounded-2xl border bg-white shadow-xl transition-all active:cursor-grabbing ${
        selected
          ? "border-indigo-500 ring-4 ring-indigo-500/15"
          : "border-slate-200 hover:border-indigo-200 hover:shadow-2xl"
      }`}
    >
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-white !bg-indigo-500" />
      <div className="rounded-t-2xl border-b border-slate-100 bg-slate-50 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-indigo-500">
              Paso {nodeData.index + 1}
            </p>
            <p className="mt-1 truncate text-sm font-black text-slate-950" title={nodeData.title}>
              {nodeData.title}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-indigo-100 px-2 py-1 text-[10px] font-black text-indigo-700">
            {routeCount}
          </span>
        </div>
      </div>
      <div className="space-y-3 px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          <span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-wider ${
            hasForm ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
          }`}>
            {hasForm ? "Con formulario" : "Sin formulario"}
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-slate-500">
            {nodeData.fieldCount} variables
          </span>
        </div>
        <p className="line-clamp-2 text-[11px] font-semibold text-slate-500">
          {nodeData.description}
        </p>
      </div>
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-white !bg-indigo-500" />
    </div>
  );
}

function WorkflowCompleteNode() {
  return (
    <div className="w-[220px] rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 shadow-xl">
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-white !bg-emerald-500" />
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500 text-white">
          <CheckCircle2 size={20} />
        </div>
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700">
            Salida
          </p>
          <p className="text-sm font-black text-emerald-950">Workflow finalizado</p>
        </div>
      </div>
    </div>
  );
}

function WorkflowDecisionNode({ data, selected }: NodeProps) {
  const nodeData = data as any;
  const routeCount = Number(nodeData.routeCount || 0);

  return (
    <div className="relative flex h-[154px] w-[154px] items-center justify-center">
      <Handle type="target" position={Position.Left} className="!left-0 !h-3 !w-3 !border-2 !border-white !bg-amber-500" />
      <div
        className={`flex h-[112px] w-[112px] rotate-45 items-center justify-center border bg-amber-50 shadow-xl transition-all ${
          selected
            ? "border-amber-500 ring-4 ring-amber-400/20"
            : "border-amber-200 hover:border-amber-400"
        }`}
      >
        <div className="-rotate-45 text-center">
          <Diamond size={18} className="mx-auto text-amber-600" />
          <p className="mt-1 text-[9px] font-black uppercase tracking-[0.16em] text-amber-700">
            Decisión
          </p>
          <p className="mt-1 text-xl font-black text-amber-950">{routeCount}</p>
          <p className="text-[9px] font-black uppercase tracking-wider text-amber-500">
            rutas
          </p>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!right-0 !h-3 !w-3 !border-2 !border-white !bg-amber-500" />
    </div>
  );
}

function WorkflowParallelNode({ data, selected }: NodeProps) {
  const nodeData = data as any;
  const routeCount = Number(nodeData.routeCount || 0);

  return (
    <div
      className={`w-[210px] rounded-2xl border bg-cyan-50 px-4 py-3 shadow-xl transition-all ${
        selected
          ? "border-cyan-500 ring-4 ring-cyan-400/20"
          : "border-cyan-200 hover:border-cyan-400"
      }`}
    >
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-white !bg-cyan-500" />
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-500 text-white">
          <GitBranch size={19} />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-700">
            Paralelo
          </p>
          <p className="text-sm font-black text-cyan-950">
            {routeCount} rama{routeCount === 1 ? "" : "s"}
          </p>
        </div>
      </div>
      <p className="mt-2 text-[11px] font-semibold leading-4 text-cyan-700">
        Conecta desde aquí las tareas que deben iniciar al tiempo.
      </p>
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-white !bg-cyan-500" />
    </div>
  );
}

const workflowNodeTypes = {
  workflowStep: WorkflowStepNode,
  workflowDecision: WorkflowDecisionNode,
  workflowParallel: WorkflowParallelNode,
  workflowComplete: WorkflowCompleteNode,
};

export function WorkflowRoutingBuilder({
  steps,
  onChange,
  rateCards = [],
  teamMembers = [],
  allowAnyTarget = false,
  linearOnly = false,
  projectId = '',
  project,
  onSaveView,
}: WorkflowRoutingBuilderProps) {
  const [isVisualEditorOpen, setIsVisualEditorOpen] = useState(false);

  if (steps.length === 0) return null;

  const totalRoutes = steps.reduce(
    (count, step) =>
      count +
      normalizeWorkflowRoutes(step.conditionalRoutes || []).length +
      normalizeWorkflowParallelRoutes(step.parallelRoutes || step.parallelNextStepIndexes || []).length,
    0
  );
  const variablesCount = steps.reduce(
    (count, step) => count + getWorkflowStepFormFields(step).length,
    0
  );

  return (
    <>
      <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-cyan-50 p-4 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-200">
              <GitBranch size={20} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-indigo-600">
                {linearOnly ? "Mapa del procedimiento" : "Mapa visual de decisiones"}
              </p>
              <h4 className="mt-1 text-base font-black text-slate-950">
                {linearOnly
                  ? "Configura estados, formularios y responsables en pantalla completa"
                  : "Configura rutas, variables y condiciones en pantalla completa"}
              </h4>
              <p className="mt-1 max-w-2xl text-xs font-semibold leading-relaxed text-slate-500">
                {linearOnly
                  ? "Este procedimiento conserva una única ruta consecutiva. Usa el lienzo para ordenar estados y configura en cada uno formularios, responsables, documentos y controles."
                  : allowAnyTarget
                  ? "Abre el lienzo para conectar rutas no lineales, devoluciones y salidas alternativas sin perder espacio."
                  : "La vista del flujo ya no se edita dentro de este modal. Abre el lienzo para ver todo el workflow como mapa interactivo y configurar cada paso sin perder espacio."}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-white bg-white/80 px-3 py-2 text-center shadow-sm">
                <p className="text-lg font-black text-slate-950">{steps.length}</p>
                <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Pasos</p>
              </div>
              <div className="rounded-xl border border-white bg-white/80 px-3 py-2 text-center shadow-sm">
                <p className="text-lg font-black text-indigo-600">
                  {linearOnly ? Math.max(steps.length - 1, 0) : totalRoutes}
                </p>
                <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">
                  {linearOnly ? "Secuencia" : "Rutas"}
                </p>
              </div>
              <div className="rounded-xl border border-white bg-white/80 px-3 py-2 text-center shadow-sm">
                <p className="text-lg font-black text-emerald-600">{variablesCount}</p>
                <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Variables</p>
              </div>
            </div>
            <Button
              type="button"
              onClick={() => setIsVisualEditorOpen(true)}
              className="h-12 rounded-2xl bg-slate-950 px-5 text-xs font-black text-white shadow-lg shadow-slate-200 hover:bg-indigo-700"
            >
              <Maximize2 size={14} className="mr-2" />
              Abrir editor full screen
            </Button>
          </div>
        </div>
      </div>

      {isVisualEditorOpen && (
        <WorkflowVisualEditorModal
          steps={steps}
          onChange={onChange}
          onClose={() => setIsVisualEditorOpen(false)}
          onSaveView={onSaveView}
          rateCards={rateCards}
          teamMembers={teamMembers}
          allowAnyTarget={allowAnyTarget}
          linearOnly={linearOnly}
          projectId={projectId}
          project={project}
        />
      )}
    </>
  );
}

function WorkflowVisualEditorModal({
  steps,
  onChange,
  onClose,
  rateCards,
  teamMembers,
  allowAnyTarget,
  linearOnly,
  projectId,
  project,
  onSaveView,
}: {
  steps: any[];
  onChange: (steps: any[]) => void;
  onClose: () => void;
  rateCards: any[];
  teamMembers: any[];
  allowAnyTarget: boolean;
  linearOnly: boolean;
  projectId: string;
  project?: any;
  onSaveView?: (steps: any[]) => Promise<void> | void;
}) {
  const [selectedStepIndex, setSelectedStepIndex] = useState(0);
  const [selectedNodeKind, setSelectedNodeKind] = useState<"step" | "decision" | "parallel">("step");
  const [formStepIndex, setFormStepIndex] = useState<number | null>(null);
  const [connectMode, setConnectMode] = useState<WorkflowConnectMode>("default");
  const [isSavingView, setIsSavingView] = useState(false);
  const activeSelectedStepIndex = Math.min(selectedStepIndex, Math.max(0, steps.length - 1));

  const updateStep = (stepIndex: number, updates: Record<string, any>) => {
    onChange(
      steps.map((step, index) =>
        index === stepIndex ? { ...step, ...updates } : step
      )
    );
  };

  const removeDecisionNode = (stepIndex: number) => {
    const step = steps[stepIndex];
    if (!step) return;

    updateStep(stepIndex, {
      decisionNodeEnabled: false,
      decisionPosition: null,
      conditionalRoutes: [],
      defaultNextStepIndex: null,
      disableImplicitLinearRoute: true,
    });
    setSelectedNodeKind("step");
    toast.success("Nodo de decisión y sus condiciones eliminados.");
  };

  const removeParallelNode = (stepIndex: number) => {
    const step = steps[stepIndex];
    if (!step) return;

    updateStep(stepIndex, {
      parallelNodeEnabled: false,
      parallelPosition: null,
      parallelRoutes: [],
      parallelNextStepIndexes: null,
      disableImplicitLinearRoute: true,
    });
    setSelectedNodeKind("step");
    toast.success("Nodo paralelo y sus ramas eliminados.");
  };

  const updateRoute = (
    stepIndex: number,
    routeId: string,
    updates: Partial<WorkflowConditionalRoute>
  ) => {
    const step = steps[stepIndex];
    const routes = normalizeWorkflowRoutes(step.conditionalRoutes || []);
    updateStep(stepIndex, {
      conditionalRoutes: routes.map((route) =>
        route.id === routeId ? { ...route, ...updates } : route
      ),
    });
  };

  const updateParallelRoute = (
    stepIndex: number,
    routeId: string,
    updates: Partial<WorkflowParallelRoute>
  ) => {
    const step = steps[stepIndex];
    const routes = normalizeWorkflowParallelRoutes(step.parallelRoutes || step.parallelNextStepIndexes || []);
    updateStep(stepIndex, {
      parallelRoutes: routes.map((route) =>
        route.id === routeId ? { ...route, ...updates } : route
      ),
      parallelNextStepIndexes: null,
    });
  };

  const buildDecisionRouteUpdates = (
    step: any,
    stepIndex: number,
    targetStepIndex: WorkflowRouteTarget = null
  ) => {
    let fields = getWorkflowStepFormFields(step);
    let form = step.form;
    let field = fields[0];

    if (!field) {
      field = {
        id: `decision_field_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        label: "Resultado de la decisión",
        type: "select",
        required: true,
        options: ["Sí", "No"],
        selectionMode: "single",
      };
      fields = [field];
      form = {
        ...(step.form || {}),
        title: step.form?.title || `Formulario para ${getStepTitle(step, stepIndex)}`,
        fields,
      };
    }

    const route: WorkflowConditionalRoute = {
      id: createWorkflowRouteId(),
      fieldId: field.id,
      fieldLabel: field.label,
      operator: "equals",
      value: "",
      targetStepIndex,
    };

    return {
      form,
      decisionNodeEnabled: true,
      disableImplicitLinearRoute: true,
      conditionalRoutes: [...normalizeWorkflowRoutes(step.conditionalRoutes || []), route],
    };
  };

  const addRoute = (stepIndex: number) => {
    const step = steps[stepIndex];
    if (!step) return;

    updateStep(stepIndex, buildDecisionRouteUpdates(step, stepIndex));
    toast.success("Condición creada. Ajusta su valor y destino en el panel.");
  };

  const addDecisionNode = (stepIndex: number) => {
    const step = steps[stepIndex];
    const currentPosition = getWorkflowNodePosition(step, stepIndex);
    updateStep(stepIndex, {
      decisionNodeEnabled: true,
      decisionPosition: step.decisionPosition || {
        x: Math.round(currentPosition.x + 330),
        y: Math.round(currentPosition.y - 70),
      },
      disableImplicitLinearRoute: true,
    });
    setConnectMode("condition");
  };

  const addParallelNode = (stepIndex: number) => {
    const step = steps[stepIndex];
    const currentPosition = getWorkflowNodePosition(step, stepIndex);
    updateStep(stepIndex, {
      parallelNodeEnabled: true,
      parallelPosition: step.parallelPosition || {
        x: Math.round(currentPosition.x + 330),
        y: Math.round(currentPosition.y + 120),
      },
      parallelNextStepIndexes: null,
      disableImplicitLinearRoute: true,
    });
    setConnectMode("parallel");
  };

  const addStepFromCanvas = () => {
    const nextIndex = steps.length;
    const lastPosition = steps.length > 0
      ? getWorkflowNodePosition(steps[steps.length - 1], steps.length - 1)
      : getDefaultWorkflowNodePosition(0);

    onChange([
      ...steps,
      {
        assignedTo: "",
        label: "",
        unitsToAdd: 1,
        autoAddUnits: true,
        rateCards: [],
        plannedDurationDays: 1,
        disableImplicitLinearRoute: !linearOnly,
        visualPosition: {
          x: Math.round(lastPosition.x + 360),
          y: Math.round(lastPosition.y + (nextIndex % 2 === 0 ? -36 : 36)),
        },
      },
    ]);
    setSelectedStepIndex(nextIndex);
  };

  const removeRoute = (stepIndex: number, routeId: string) => {
    const step = steps[stepIndex];
    updateStep(stepIndex, {
      conditionalRoutes: normalizeWorkflowRoutes(step.conditionalRoutes || []).filter(
        (route) => route.id !== routeId
      ),
    });
  };

  const removeParallelRoute = (stepIndex: number, routeId: string) => {
    const step = steps[stepIndex];
    updateStep(stepIndex, {
      parallelRoutes: normalizeWorkflowParallelRoutes(step.parallelRoutes || step.parallelNextStepIndexes || []).filter(
        (route) => route.id !== routeId
      ),
      parallelNextStepIndexes: null,
    });
  };

  const saveStepForm = (stepIndex: number, form: any) => {
    const step = steps[stepIndex];
    const fields = Array.isArray(form?.fields) ? form.fields : [];
    const nextRoutes = normalizeWorkflowRoutes(step.conditionalRoutes || [])
      .filter((route) => fields.some((field: any) => field.id === route.fieldId))
      .map((route) => {
        const field = fields.find((candidate: any) => candidate.id === route.fieldId);
        return {
          ...route,
          fieldLabel: field?.label || route.fieldLabel || route.fieldId,
        };
      });

    updateStep(stepIndex, {
      form,
      conditionalRoutes: form ? nextRoutes : [],
    });
  };

  const handleSaveView = async () => {
    if (!onSaveView) {
      onClose();
      return;
    }

    setIsSavingView(true);
    try {
      await onSaveView(steps);
      onClose();
    } catch (error: any) {
      console.error("Error saving workflow visual view:", error);
      toast.error(error?.message || "No se pudo guardar la vista del workflow.");
    } finally {
      setIsSavingView(false);
    }
  };

  const handleNodeDragStop: OnNodeDrag<Node> = (_event, node) => {
    const nodeId = String(node.id || "");
    const position = {
      x: Math.round(node.position.x),
      y: Math.round(node.position.y),
    };

    if (nodeId === COMPLETE_NODE_ID) {
      onChange(
        steps.map((step, index) =>
          index === 0
            ? {
                ...step,
                workflowCompletePosition: position,
              }
            : step
        )
      );
      return;
    }

    const parsedNode = parseWorkflowEditorNodeId(nodeId);
    if (!parsedNode || !steps[parsedNode.stepIndex]) return;

    if (parsedNode.kind === "decision") {
      updateStep(parsedNode.stepIndex, { decisionPosition: position });
      return;
    }

    if (parsedNode.kind === "parallel") {
      updateStep(parsedNode.stepIndex, { parallelPosition: position });
      return;
    }

    updateStep(parsedNode.stepIndex, { visualPosition: position });
  };

  const handleConnect = useCallback((connection: Connection) => {
    const sourceNode = parseWorkflowEditorNodeId(connection.source);
    const target = nodeIdToTarget(connection.target);

    if (!sourceNode || target === undefined) {
      toast.warning("Conecta desde un paso, decisión o paralelo hacia una tarea o el final.");
      return;
    }

    if (typeof target === "number" && target === sourceNode.stepIndex) {
      toast.warning("Una ruta no puede regresar al mismo nodo.");
      return;
    }

    if (linearOnly) {
      const expectedTarget: WorkflowRouteTarget =
        sourceNode.stepIndex < steps.length - 1 ? sourceNode.stepIndex + 1 : "complete";
      if (sourceNode.kind !== "step" || target !== expectedTarget) {
        toast.warning("El procedimiento por estados solo permite avanzar al estado siguiente.");
        return;
      }

      toast.success(target === "complete" ? "El último estado cierra el procedimiento." : "La ruta consecutiva ya está activa.");
      return;
    }

    if (!allowAnyTarget && typeof target === "number" && target <= sourceNode.stepIndex) {
      toast.warning("Este workflow solo permite conectar hacia pasos posteriores.");
      return;
    }

    const step = steps[sourceNode.stepIndex];
    if (!step) return;

    const routeMode: WorkflowConnectMode =
      sourceNode.kind === "decision"
        ? "condition"
        : sourceNode.kind === "parallel"
          ? "parallel"
          : connectMode;

    if (routeMode === "condition") {
      updateStep(sourceNode.stepIndex, buildDecisionRouteUpdates(step, sourceNode.stepIndex, target));
      setSelectedStepIndex(sourceNode.stepIndex);
      toast.success("Ruta condicional creada. Ajusta la regla en el panel derecho.");
      return;
    }

    if (routeMode === "parallel") {
      if (target === "complete") {
        toast.warning("Una rama paralela debe iniciar otra tarea; usa ruta principal para finalizar.");
        return;
      }

      const route: WorkflowParallelRoute = {
        id: createWorkflowRouteId(),
        targetStepIndex: target,
        label: "",
      };

      updateStep(sourceNode.stepIndex, {
        parallelNodeEnabled: true,
        disableImplicitLinearRoute: true,
        parallelRoutes: [...normalizeWorkflowParallelRoutes(step.parallelRoutes || step.parallelNextStepIndexes || []), route],
        parallelNextStepIndexes: null,
      });
      setSelectedStepIndex(sourceNode.stepIndex);
      toast.success("Rama paralela conectada.");
      return;
    }

    updateStep(sourceNode.stepIndex, {
      defaultNextStepIndex: target,
      disableImplicitLinearRoute: true,
      ...(target === "complete" ? { finishWorkflowOnComplete: false } : {}),
    });
    setSelectedStepIndex(sourceNode.stepIndex);
    toast.success(target === "complete" ? "Ruta de cierre conectada." : "Ruta principal conectada.");
  }, [allowAnyTarget, connectMode, linearOnly, onChange, steps]);

  const handleEdgesDelete = useCallback((deletedEdges: Edge[]) => {
    if (deletedEdges.length === 0) return;

    let didChange = false;
    let nextSteps = steps.map((step) => ({ ...step }));

    deletedEdges.forEach((edge) => {
      const edgeId = String(edge.id || "");
      const defaultMatch = edgeId.match(/^default-(\d+)-/);
      if (defaultMatch) {
        const stepIndex = Number(defaultMatch[1]);
        if (Number.isFinite(stepIndex) && nextSteps[stepIndex]) {
          nextSteps[stepIndex] = {
            ...nextSteps[stepIndex],
            defaultNextStepIndex: null,
            disableImplicitLinearRoute: true,
          };
          didChange = true;
        }
        return;
      }

      nextSteps = nextSteps.map((step) => {
        const routes = normalizeWorkflowRoutes(step.conditionalRoutes || []);
        if (routes.some((route) => route.id === edgeId)) {
          didChange = true;
          return {
            ...step,
            conditionalRoutes: routes.filter((route) => route.id !== edgeId),
            decisionNodeEnabled: routes.length > 1 || Boolean(step.decisionNodeEnabled),
            disableImplicitLinearRoute: true,
          };
        }

        const parallelRoutes = normalizeWorkflowParallelRoutes(step.parallelRoutes || step.parallelNextStepIndexes || []);
        if (parallelRoutes.some((route) => route.id === edgeId)) {
          didChange = true;
          return {
            ...step,
            parallelRoutes: parallelRoutes.filter((route) => route.id !== edgeId),
            parallelNextStepIndexes: null,
            parallelNodeEnabled: parallelRoutes.length > 1 || Boolean(step.parallelNodeEnabled),
            disableImplicitLinearRoute: true,
          };
        }

        return step;
      });
    });

    if (!didChange) return;
    onChange(nextSteps);
    toast.success("Conexión eliminada del workflow.");
  }, [onChange, steps]);

  const nodes = useMemo<Node[]>(() => {
    const stepPositions = steps.map((step, index) => getWorkflowNodePosition(step, index));
    const stepNodes = steps.map((step, index) => {
      const fields = getWorkflowStepFormFields(step);
      const routes = normalizeWorkflowRoutes(step.conditionalRoutes || []);
      const parallelRoutes = normalizeWorkflowParallelRoutes(step.parallelRoutes || step.parallelNextStepIndexes || []);
      const explicitDefaultTarget = normalizeWorkflowDefaultTarget(
        step.defaultNextStepIndex ?? step.defaultNextStepTarget,
        index,
        steps.length
      );

      return {
        id: `workflow-step-${index}`,
        type: "workflowStep",
        position: stepPositions[index],
        data: {
          index,
          title: getStepTitle(step, index),
          routeCount: routes.length + parallelRoutes.length,
          fieldCount: fields.length,
          hasForm: Boolean(step.form),
          description:
            step.finishWorkflowOnComplete
              ? "Nodo de cierre: al completarse finaliza el workflow."
              :
            routes.length === 0
              ? explicitDefaultTarget !== undefined && explicitDefaultTarget !== null
                ? `Ruta hacia ${getWorkflowTargetLabel(explicitDefaultTarget, steps, index)}${parallelRoutes.length ? ` + ${parallelRoutes.length} paralelo(s)` : ""}`
                : parallelRoutes.length
                  ? `${parallelRoutes.length} rama(s) paralela(s). Sin ruta principal.`
                  : "Sin conexiones. Arrastra una línea para crear la ruta."
              : routes
                  .slice(0, 2)
                  .map((route) => getWorkflowRouteDescription(route, steps, index))
                  .join(" / "),
        },
      } satisfies Node;
    });
    const decisionNodes = steps.flatMap((step, index) => {
      const routes = normalizeWorkflowRoutes(step.conditionalRoutes || []);
      if (!step.decisionNodeEnabled && routes.length === 0) return [];
      const stepPosition = stepPositions[index];
      return [{
        id: `${DECISION_NODE_PREFIX}${index}`,
        type: "workflowDecision",
        position: normalizeWorkflowNodePosition(step.decisionPosition) || {
          x: Math.round(stepPosition.x + 330),
          y: Math.round(stepPosition.y - 70),
        },
        data: {
          stepIndex: index,
          routeCount: routes.length,
        },
      } satisfies Node];
    });
    const parallelNodes = steps.flatMap((step, index) => {
      const parallelRoutes = normalizeWorkflowParallelRoutes(step.parallelRoutes || step.parallelNextStepIndexes || []);
      if (!step.parallelNodeEnabled && parallelRoutes.length === 0) return [];
      const stepPosition = stepPositions[index];
      return [{
        id: `${PARALLEL_NODE_PREFIX}${index}`,
        type: "workflowParallel",
        position: normalizeWorkflowNodePosition(step.parallelPosition) || {
          x: Math.round(stepPosition.x + 330),
          y: Math.round(stepPosition.y + 120),
        },
        data: {
          stepIndex: index,
          routeCount: parallelRoutes.length,
        },
      } satisfies Node];
    });

    const maxStepX = stepPositions.reduce((max, position) => Math.max(max, position.x), 0);
    const averageStepY = stepPositions.length > 0
      ? stepPositions.reduce((sum, position) => sum + position.y, 0) / stepPositions.length
      : 18;
    const fallbackCompletePosition = {
      x: Math.round(maxStepX + 360),
      y: Math.round(averageStepY),
    };

    return [
      ...stepNodes,
      ...decisionNodes,
      ...parallelNodes,
      {
        id: COMPLETE_NODE_ID,
        type: "workflowComplete",
        position: getWorkflowCompleteNodePosition(steps, fallbackCompletePosition),
        data: {},
      } satisfies Node,
    ];
  }, [steps]);

  const edges = useMemo<Edge[]>(() => {
    const nextEdges: Edge[] = [];

    steps.forEach((step, index) => {
      const routes = normalizeWorkflowRoutes(step.conditionalRoutes || []);
      const parallelRoutes = normalizeWorkflowParallelRoutes(step.parallelRoutes || step.parallelNextStepIndexes || []);
      const defaultTarget = normalizeWorkflowDefaultTarget(
        step.defaultNextStepIndex ?? step.defaultNextStepTarget,
        index,
        steps.length
      );
      const defaultTargetId = targetToNodeId(defaultTarget, index, steps.length);
      const hasDecisionNode = Boolean(step.decisionNodeEnabled || routes.length > 0);
      const hasParallelNode = Boolean(step.parallelNodeEnabled || parallelRoutes.length > 0);
      const decisionNodeId = `${DECISION_NODE_PREFIX}${index}`;
      const parallelNodeId = `${PARALLEL_NODE_PREFIX}${index}`;

      if (defaultTargetId && !step.finishWorkflowOnComplete) {
        nextEdges.push({
          id: `default-${index}-${defaultTargetId}`,
          source: hasDecisionNode ? decisionNodeId : `workflow-step-${index}`,
          target: defaultTargetId,
          type: "smoothstep",
          label: routes.length > 0 ? "si no coincide" : "lineal",
          animated: routes.length === 0,
          markerEnd: { type: MarkerType.ArrowClosed, color: routes.length > 0 ? "#94a3b8" : "#4f46e5" },
          style: {
            stroke: routes.length > 0 ? "#94a3b8" : "#4f46e5",
            strokeWidth: routes.length > 0 ? 1.5 : 2.5,
            strokeDasharray: routes.length > 0 ? "6 5" : undefined,
          },
          labelStyle: { fill: "#475569", fontSize: 11, fontWeight: 800 },
          labelBgStyle: { fill: "#ffffff", fillOpacity: 0.9 },
          labelBgPadding: [6, 4],
          labelBgBorderRadius: 8,
        });
      }

      if (hasDecisionNode) {
        nextEdges.push({
          id: `decision-entry-${index}`,
          source: `workflow-step-${index}`,
          target: decisionNodeId,
          type: "smoothstep",
          label: "decidir",
          deletable: false,
          animated: false,
          markerEnd: { type: MarkerType.ArrowClosed, color: "#f59e0b" },
          style: { stroke: "#f59e0b", strokeWidth: 2.5 },
          labelStyle: { fill: "#b45309", fontSize: 11, fontWeight: 900 },
          labelBgStyle: { fill: "#fffbeb", fillOpacity: 0.95 },
          labelBgPadding: [6, 4],
          labelBgBorderRadius: 8,
        });
      }

      if (hasParallelNode) {
        nextEdges.push({
          id: `parallel-entry-${index}`,
          source: `workflow-step-${index}`,
          target: parallelNodeId,
          type: "smoothstep",
          label: "abrir paralelo",
          deletable: false,
          animated: false,
          markerEnd: { type: MarkerType.ArrowClosed, color: "#06b6d4" },
          style: { stroke: "#06b6d4", strokeWidth: 2.5, strokeDasharray: "8 4" },
          labelStyle: { fill: "#0891b2", fontSize: 11, fontWeight: 900 },
          labelBgStyle: { fill: "#ecfeff", fillOpacity: 0.95 },
          labelBgPadding: [6, 4],
          labelBgBorderRadius: 8,
        });
      }

      routes.forEach((route, routeIndex) => {
        const targetId = targetToNodeId(route.targetStepIndex, index, steps.length);
        if (!targetId) return;
        const color = routeIndex % 2 === 0 ? "#f97316" : "#7c3aed";
        const label = routeOperatorNeedsValue(route.operator)
          ? `${route.fieldLabel || route.fieldId} ${route.value || "..."}`
          : `${route.fieldLabel || route.fieldId}`;

        nextEdges.push({
          id: route.id || `route-${index}-${routeIndex}`,
          source: hasDecisionNode ? decisionNodeId : `workflow-step-${index}`,
          target: targetId,
          type: "smoothstep",
          label,
          animated: true,
          markerEnd: { type: MarkerType.ArrowClosed, color },
          style: { stroke: color, strokeWidth: 3 },
          labelStyle: { fill: color, fontSize: 11, fontWeight: 900 },
          labelBgStyle: { fill: "#fff7ed", fillOpacity: 0.95 },
          labelBgPadding: [6, 4],
          labelBgBorderRadius: 8,
        });
      });

      parallelRoutes.forEach((route, routeIndex) => {
        const targetId = targetToNodeId(route.targetStepIndex, index, steps.length);
        if (!targetId) return;
        nextEdges.push({
          id: route.id || `parallel-${index}-${routeIndex}`,
          source: hasParallelNode ? parallelNodeId : `workflow-step-${index}`,
          target: targetId,
          type: "smoothstep",
          label: route.label || "paralelo",
          animated: true,
          markerEnd: { type: MarkerType.ArrowClosed, color: "#06b6d4" },
          style: { stroke: "#06b6d4", strokeWidth: 3, strokeDasharray: "10 4" },
          labelStyle: { fill: "#0891b2", fontSize: 11, fontWeight: 900 },
          labelBgStyle: { fill: "#ecfeff", fillOpacity: 0.95 },
          labelBgPadding: [6, 4],
          labelBgBorderRadius: 8,
        });
      });
    });

    return nextEdges;
  }, [steps]);

  const selectedStep = steps[activeSelectedStepIndex];
  const selectedFields = getWorkflowStepFormFields(selectedStep);
  const selectedRoutes = normalizeWorkflowRoutes(selectedStep?.conditionalRoutes || []);
  const selectedParallelRoutes = normalizeWorkflowParallelRoutes(selectedStep?.parallelRoutes || selectedStep?.parallelNextStepIndexes || []);
  const selectedDefaultTarget = normalizeWorkflowDefaultTarget(
    selectedStep?.defaultNextStepIndex ?? selectedStep?.defaultNextStepTarget,
    activeSelectedStepIndex,
    steps.length
  );
  const selectedTargetOptions = getTargetOptions(steps, activeSelectedStepIndex, allowAnyTarget);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;

      if (selectedNodeKind === "decision") {
        event.preventDefault();
        removeDecisionNode(activeSelectedStepIndex);
      }

      if (selectedNodeKind === "parallel") {
        event.preventDefault();
        removeParallelNode(activeSelectedStepIndex);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeSelectedStepIndex, selectedNodeKind, steps]);

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-slate-950 text-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-slate-950 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 shadow-lg shadow-indigo-950/30">
            <GitBranch size={22} />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-xl font-black">
              {linearOnly ? "Editor del procedimiento por estados" : allowAnyTarget ? "Editor visual de workflow variable" : "Editor visual de workflow"}
            </h2>
            <p className="text-xs font-semibold text-slate-400">
              {steps.length} estados visibles · clic en un nodo para configurar responsable, formulario y controles.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {linearOnly ? (
            <div className="hidden h-10 items-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 text-[10px] font-black uppercase tracking-wider text-emerald-100 md:flex">
              Ruta lineal fija · una ejecución
            </div>
          ) : (
            <div className="hidden items-center gap-1 rounded-2xl border border-white/10 bg-white/[0.04] p-1 md:flex">
              {[
                { value: "default", label: "Ruta principal" },
                { value: "condition", label: "Condición" },
                { value: "parallel", label: "Paralelo" },
              ].map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  onClick={() => setConnectMode(mode.value as WorkflowConnectMode)}
                  className={`h-8 rounded-xl px-3 text-[10px] font-black uppercase tracking-wider transition-colors ${
                    connectMode === mode.value
                      ? "bg-white text-slate-950"
                      : "text-slate-300 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={addStepFromCanvas}
            className="h-10 border-white/10 bg-white/5 text-xs font-black text-white hover:bg-white/10"
          >
            <Plus size={14} className="mr-2" />
            Agregar paso
          </Button>
          <Button
            type="button"
            onClick={() => void handleSaveView()}
            disabled={isSavingView}
            className="h-10 rounded-xl bg-white text-xs font-black text-slate-950 hover:bg-slate-100"
          >
            {isSavingView ? "Guardando..." : onSaveView ? "Guardar vista" : "Aplicar vista"}
          </Button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 hover:bg-white/10 hover:text-white"
            aria-label="Cerrar editor visual"
          >
            <X size={20} />
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_430px]">
        <section className="relative min-h-[55vh] bg-[radial-gradient(circle_at_top_left,rgba(79,70,229,.24),transparent_34%),#f8fafc] text-slate-950">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={workflowNodeTypes}
            nodesDraggable
            nodesConnectable
            elementsSelectable
            fitView
            minZoom={0.25}
            maxZoom={1.8}
            onNodeClick={(_, node) => {
              const parsedNode = parseWorkflowEditorNodeId(String(node.id || ""));
              if (!parsedNode) return;
              setSelectedStepIndex(parsedNode.stepIndex);
              setSelectedNodeKind(parsedNode.kind);
              if (parsedNode.kind === "decision") setConnectMode("condition");
              if (parsedNode.kind === "parallel") setConnectMode("parallel");
            }}
            onConnect={handleConnect}
            onEdgesDelete={linearOnly ? undefined : handleEdgesDelete}
            onNodeDragStop={handleNodeDragStop}
            fitViewOptions={{ padding: 0.18 }}
            attributionPosition="bottom-left"
          >
            <div className="pointer-events-none absolute left-4 top-4 z-10 rounded-2xl border border-white/70 bg-white/90 px-4 py-3 shadow-xl">
              <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-indigo-600">
                <MousePointer2 size={14} />
                Lienzo interactivo
              </p>
              <p className="mt-1 max-w-sm text-[11px] font-semibold text-slate-500">
                {linearOnly
                  ? "Ordena los estados y configura cada uno. Pixel mantiene automáticamente la secuencia de principio a fin."
                  : "Elige modo arriba y arrastra desde un punto de salida hacia otra tarea. Las tareas nuevas nacen desconectadas."}
              </p>
            </div>
            <Controls showInteractive={false} />
            <MiniMap
              nodeColor={(node) => (node.id === COMPLETE_NODE_ID ? "#10b981" : "#4f46e5")}
              maskColor="rgba(15, 23, 42, 0.08)"
              pannable
              zoomable
            />
            <Background color="#cbd5e1" gap={22} />
          </ReactFlow>
        </section>

        <aside className="min-h-0 overflow-y-auto border-l border-white/10 bg-slate-950 p-4">
          {!selectedStep ? (
            <div className="rounded-2xl border border-dashed border-white/15 p-5 text-sm text-slate-400">
              Selecciona un paso del workflow para editar sus decisiones.
            </div>
          ) : (
            <div className="space-y-4">
              {selectedNodeKind !== "step" && (
                <div className={`rounded-2xl border p-4 ${
                  selectedNodeKind === "decision"
                    ? "border-amber-300/30 bg-amber-400/10"
                    : "border-cyan-300/30 bg-cyan-400/10"
                }`}>
                  <p className={`text-[10px] font-black uppercase tracking-[0.2em] ${
                    selectedNodeKind === "decision" ? "text-amber-100" : "text-cyan-100"
                  }`}>
                    Nodo seleccionado
                  </p>
                  <p className="mt-1 text-xs font-semibold leading-5 text-white/75">
                    {selectedNodeKind === "decision"
                      ? "Este rombo contiene las condiciones del paso seleccionado."
                      : "Este nodo contiene las ramas paralelas del paso seleccionado."}
                  </p>
                  <Button
                    type="button"
                    onClick={() =>
                      selectedNodeKind === "decision"
                        ? removeDecisionNode(activeSelectedStepIndex)
                        : removeParallelNode(activeSelectedStepIndex)
                    }
                    className="mt-3 h-10 w-full rounded-xl border border-red-400/30 bg-red-500/15 text-xs font-black uppercase tracking-wider text-red-100 hover:bg-red-500/25"
                  >
                    <Trash2 size={14} className="mr-2" />
                    {selectedNodeKind === "decision" ? "Eliminar rombo y condiciones" : "Eliminar nodo paralelo y ramas"}
                  </Button>
                </div>
              )}
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-300">
                  Paso seleccionado
                </p>
                <input
                  value={selectedStep.label || ""}
                  onChange={(event) => updateStep(activeSelectedStepIndex, { label: event.target.value })}
                  placeholder={`Paso ${activeSelectedStepIndex + 1}`}
                  className="mt-3 h-11 w-full rounded-xl border border-white/10 bg-white px-3 text-sm font-black text-slate-950 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/20"
                />
                {linearOnly ? (
                  <div className="mt-3 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3">
                    <span className="block text-xs font-black text-emerald-100">
                      Estado {activeSelectedStepIndex + 1} de {steps.length}
                    </span>
                    <span className="mt-0.5 block text-[11px] font-semibold leading-5 text-emerald-100/80">
                      {activeSelectedStepIndex === steps.length - 1
                        ? "Al completar este último estado, Pixel finaliza el procedimiento."
                        : `Al completar este estado, Pixel habilita únicamente ${getStepTitle(steps[activeSelectedStepIndex + 1], activeSelectedStepIndex + 1)}.`}
                    </span>
                  </div>
                ) : (
                  <>
                    <label className="mt-3 flex items-start gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedStep.finishWorkflowOnComplete)}
                        onChange={(event) =>
                          updateStep(activeSelectedStepIndex, {
                            finishWorkflowOnComplete: event.target.checked,
                            defaultNextStepIndex: event.target.checked ? "complete" : selectedStep.defaultNextStepIndex,
                            ...(event.target.checked
                              ? {
                                  conditionalRoutes: [],
                                  parallelRoutes: [],
                                  parallelNextStepIndexes: null,
                                }
                              : {}),
                          })
                        }
                        className="mt-0.5 h-4 w-4 rounded border-white/20 text-emerald-500"
                      />
                      <span>
                        <span className="block text-xs font-black text-emerald-100">Nodo de finalización</span>
                        <span className="mt-0.5 block text-[11px] font-semibold leading-5 text-emerald-100/80">
                          Al completar este paso, Pixel cierra el workflow aunque existan pasos posteriores.
                        </span>
                      </span>
                    </label>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        onClick={() => addDecisionNode(activeSelectedStepIndex)}
                        disabled={Boolean(selectedStep.finishWorkflowOnComplete)}
                        className="h-10 rounded-xl bg-amber-400 text-[10px] font-black uppercase tracking-wider text-amber-950 hover:bg-amber-300 disabled:opacity-40"
                      >
                        <Diamond size={14} className="mr-2" />
                        Rombo decisión
                      </Button>
                      <Button
                        type="button"
                        onClick={() => addParallelNode(activeSelectedStepIndex)}
                        disabled={Boolean(selectedStep.finishWorkflowOnComplete)}
                        className="h-10 rounded-xl bg-cyan-400 text-[10px] font-black uppercase tracking-wider text-cyan-950 hover:bg-cyan-300 disabled:opacity-40"
                      >
                        <GitBranch size={14} className="mr-2" />
                        Nodo paralelo
                      </Button>
                    </div>
                  </>
                )}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-white/[0.05] p-3">
                    <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Variables</p>
                    <p className="mt-1 text-2xl font-black text-white">{selectedFields.length}</p>
                  </div>
                  <div className="rounded-xl bg-white/[0.05] p-3">
                    <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Rutas</p>
                    <p className="mt-1 text-2xl font-black text-white">
                      {selectedRoutes.length + selectedParallelRoutes.length}
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-200">
                      Formulario del paso
                    </p>
                    <p className="mt-1 text-xs font-semibold text-slate-400">
                      {linearOnly
                        ? "Define aquí la información, documentos, firmas y controles que se exigen para completar este estado."
                        : "Estos campos son las variables que gobiernan las rutas."}
                    </p>
                  </div>
                  <Button
                    type="button"
                    onClick={() => setFormStepIndex(activeSelectedStepIndex)}
                    className="h-9 shrink-0 rounded-xl bg-cyan-400 px-3 text-xs font-black text-slate-950 hover:bg-cyan-300"
                  >
                    <ClipboardList size={14} className="mr-2" />
                    {selectedStep.form ? "Editar" : "Crear"}
                  </Button>
                </div>

                <div className="mt-3 space-y-2">
                  {selectedFields.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/15 p-3 text-xs font-semibold text-slate-400">
                      {linearOnly
                        ? "Este estado aún no tiene formulario. Puedes crear campos, adjuntos, firmas y validaciones."
                        : "Este paso aún no tiene variables. Si agregas una condición, Pixel creará una variable base llamada “Resultado de la decisión”."}
                    </div>
                  ) : (
                    selectedFields.map((field: any) => (
                      <div key={field.id} className="flex items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 text-slate-950">
                        <span className="truncate text-xs font-black">{field.label}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-slate-500">
                          {field.type}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {linearOnly ? (
                <div className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 p-4">
                  <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-100">
                    <Route size={14} />
                    Secuencia protegida
                  </p>
                  <p className="mt-2 text-xs font-semibold leading-5 text-emerald-100/80">
                    Este procedimiento no admite saltos, decisiones, rutas paralelas ni ciclos. La devolución de una aprobación conserva la trazabilidad y regresa el mismo estado para corrección.
                  </p>
                </div>
              ) : (
                <>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-indigo-200">
                  <Route size={14} />
                  Caminos del paso
                </p>
                <label className="mt-3 block text-[10px] font-black uppercase tracking-wider text-slate-400">
                  Ruta si ninguna condicion coincide
                </label>
                <select
                  disabled={Boolean(selectedStep.finishWorkflowOnComplete)}
                  value={targetToSelectValue(selectedDefaultTarget, activeSelectedStepIndex, steps.length)}
                  onChange={(event) =>
                    updateStep(activeSelectedStepIndex, {
                      defaultNextStepIndex: selectValueToTarget(event.target.value),
                      disableImplicitLinearRoute: true,
                    })
                  }
                  className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-white px-3 text-xs font-bold text-slate-800 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/20 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                >
                  <option value="">Sin ruta principal</option>
                  {selectedTargetOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                    Condiciones
                  </p>
                  <div className="flex items-center gap-2">
                    {(selectedStep.decisionNodeEnabled || selectedRoutes.length > 0) && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => removeDecisionNode(activeSelectedStepIndex)}
                        className="h-8 rounded-xl border border-red-400/25 bg-red-500/10 px-3 text-[10px] font-black text-red-100 hover:bg-red-500/20"
                      >
                        <Trash2 size={12} className="mr-1" />
                        Eliminar rombo
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => addRoute(activeSelectedStepIndex)}
                      disabled={Boolean(selectedStep.finishWorkflowOnComplete)}
                      className="h-8 rounded-xl bg-indigo-500 px-3 text-[10px] font-black text-white hover:bg-indigo-400 disabled:opacity-40"
                    >
                      <Plus size={12} className="mr-1" />
                      Condicion
                    </Button>
                  </div>
                </div>

                <div className="mt-3 space-y-3">
                  {selectedRoutes.length > 0 && (
                    <div className="rounded-xl border border-amber-300/20 bg-amber-400/10 p-3">
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-100">
                        Caminos de la decisión
                      </p>
                      <div className="mt-2 space-y-1.5">
                        {selectedRoutes.map((route, routeIndex) => (
                          <div key={`decision-summary-${route.id}`} className="rounded-lg bg-white/10 px-3 py-2 text-[11px] font-bold text-amber-50">
                            Camino {routeIndex + 1}: {getWorkflowRouteDescription(route, steps, activeSelectedStepIndex)}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {selectedRoutes.length === 0 && (
                    <div className="rounded-xl border border-dashed border-white/15 p-3 text-xs font-semibold text-slate-400">
                      {selectedStep.finishWorkflowOnComplete
                        ? "Este nodo finaliza el workflow y no abre nuevas rutas."
                        : "Sin condiciones. Presiona + Condición o arrastra una salida desde el rombo para crear un camino."}
                    </div>
                  )}

                  {selectedRoutes.map((route) => {
                    const needsValue = routeOperatorNeedsValue(route.operator);

                    return (
                      <div key={route.id} className="rounded-2xl border border-white/10 bg-slate-900 p-3">
                        <div className="grid grid-cols-1 gap-2">
                          <select
                            value={route.fieldId}
                            onChange={(event) => {
                              const field = selectedFields.find((candidate: any) => candidate.id === event.target.value);
                              updateRoute(activeSelectedStepIndex, route.id, {
                                fieldId: event.target.value,
                                fieldLabel: field?.label || "",
                              });
                            }}
                            className="h-9 rounded-xl border border-white/10 bg-white px-3 text-xs font-bold text-slate-800 outline-none"
                          >
                            {selectedFields.map((field: any) => (
                              <option key={field.id} value={field.id}>
                                {field.label}
                              </option>
                            ))}
                          </select>
                          <div className="grid grid-cols-2 gap-2">
                            <select
                              value={route.operator}
                              onChange={(event) =>
                                updateRoute(activeSelectedStepIndex, route.id, {
                                  operator: event.target.value as WorkflowRouteOperator,
                                  value: routeOperatorNeedsValue(event.target.value) ? route.value || "" : "",
                                })
                              }
                              className="h-9 rounded-xl border border-white/10 bg-white px-3 text-xs font-bold text-slate-800 outline-none"
                            >
                              {WORKFLOW_ROUTE_OPERATORS.map((operator) => (
                                <option key={operator.value} value={operator.value}>
                                  {operator.label}
                                </option>
                              ))}
                            </select>
                            {needsValue ? (
                              <input
                                value={route.value || ""}
                                onChange={(event) => updateRoute(activeSelectedStepIndex, route.id, { value: event.target.value })}
                                placeholder="Valor esperado"
                                className="h-9 rounded-xl border border-white/10 bg-white px-3 text-xs font-bold text-slate-800 outline-none"
                              />
                            ) : (
                              <div className="flex h-9 items-center rounded-xl border border-white/10 bg-white/5 px-3 text-[10px] font-bold text-slate-400">
                                No requiere valor
                              </div>
                            )}
                          </div>
                          <div className="grid grid-cols-[minmax(0,1fr)_38px] gap-2">
                            <select
                              value={targetToSelectValue(route.targetStepIndex, activeSelectedStepIndex, steps.length)}
                              onChange={(event) =>
                                updateRoute(activeSelectedStepIndex, route.id, {
                                  targetStepIndex: selectValueToTarget(event.target.value),
                                })
                              }
                              className="h-9 rounded-xl border border-indigo-200 bg-indigo-50 px-3 text-xs font-black text-indigo-800 outline-none"
                            >
                              <option value="">Sin destino: conectar en lienzo</option>
                              {selectedTargetOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => removeRoute(activeSelectedStepIndex, route.id)}
                              className="flex h-9 items-center justify-center rounded-xl border border-red-400/20 bg-red-500/10 text-red-200 hover:bg-red-500/20"
                              title="Eliminar condicion"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-2xl border border-cyan-300/20 bg-cyan-400/10 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-cyan-100">
                      <GitBranch size={14} />
                      Ramas paralelas
                    </p>
                    <p className="mt-1 text-xs font-semibold leading-5 text-cyan-100/75">
                      Estos nodos se inician al mismo tiempo que la ruta principal cuando este paso finaliza.
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => addParallelNode(activeSelectedStepIndex)}
                    disabled={Boolean(selectedStep.finishWorkflowOnComplete)}
                    className="h-8 shrink-0 rounded-xl bg-cyan-400 px-3 text-[10px] font-black text-slate-950 hover:bg-cyan-300 disabled:opacity-40"
                  >
                    <Plus size={12} className="mr-1" />
                    Nodo
                  </Button>
                </div>
                {(selectedStep.parallelNodeEnabled || selectedParallelRoutes.length > 0) && (
                  <Button
                    type="button"
                    onClick={() => removeParallelNode(activeSelectedStepIndex)}
                    className="mt-3 h-9 w-full rounded-xl border border-red-400/25 bg-red-500/10 text-[10px] font-black uppercase tracking-wider text-red-100 hover:bg-red-500/20"
                  >
                    <Trash2 size={13} className="mr-2" />
                    Eliminar nodo paralelo y todas sus ramas
                  </Button>
                )}

                <div className="mt-3 space-y-2">
                  {selectedParallelRoutes.length === 0 && (
                    <div className="rounded-xl border border-dashed border-cyan-300/25 p-3 text-xs font-semibold text-cyan-100/70">
                      Sin ramas paralelas. El paso solo abrirá la ruta principal.
                    </div>
                  )}
                  {selectedParallelRoutes.map((route) => (
                    <div key={route.id} className="grid grid-cols-[minmax(0,1fr)_38px] gap-2 rounded-2xl border border-cyan-300/20 bg-slate-900 p-3">
                      <div className="space-y-2">
                        <select
                          value={targetToSelectValue(route.targetStepIndex, activeSelectedStepIndex, steps.length)}
                          onChange={(event) =>
                            updateParallelRoute(activeSelectedStepIndex, route.id, {
                              targetStepIndex: selectValueToTarget(event.target.value),
                            })
                          }
                          className="h-9 w-full rounded-xl border border-cyan-200 bg-cyan-50 px-3 text-xs font-black text-cyan-900 outline-none"
                        >
                          {selectedTargetOptions
                            .filter((option) => option.value !== "complete")
                            .map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                        </select>
                        <input
                          value={route.label || ""}
                          onChange={(event) => updateParallelRoute(activeSelectedStepIndex, route.id, { label: event.target.value })}
                          placeholder="Etiqueta opcional, ej. Revisión jurídica"
                          className="h-9 w-full rounded-xl border border-white/10 bg-white px-3 text-xs font-bold text-slate-800 outline-none"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeParallelRoute(activeSelectedStepIndex, route.id)}
                        className="flex h-9 items-center justify-center rounded-xl border border-red-400/20 bg-red-500/10 text-red-200 hover:bg-red-500/20"
                        title="Eliminar rama paralela"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
                </>
              )}
            </div>
          )}
        </aside>
      </div>

      {formStepIndex !== null && (
        <WorkflowStepFormBuilderModal
          isOpen={formStepIndex !== null}
          overlayClassName="z-[90]"
          onClose={() => setFormStepIndex(null)}
          stepName={steps[formStepIndex]?.label || `Paso ${formStepIndex + 1}`}
          initialForm={steps[formStepIndex]?.form}
          rateCards={rateCards}
          teamMembers={teamMembers}
          projectId={projectId}
          project={project}
          onSave={(form) => {
            if (formStepIndex === null) return;
            saveStepForm(formStepIndex, form);
          }}
        />
      )}
    </div>
  );
}
