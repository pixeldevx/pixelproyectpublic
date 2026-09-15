"use client"

import React, { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ClipboardList, CornerDownRight, CreditCard, Loader2, Plus, Settings, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from "@/lib/supabase/document-store";
import { db } from "@/lib/backend";
import {
  CustomForm,
  FormRateCardItem,
  WorkflowStepFormBuilderModal,
} from "@/components/projects/WorkflowStepFormBuilderModal";
import { WorkflowRoutingBuilder } from "@/components/projects/WorkflowRoutingBuilder";
import {
  getWorkflowTemplateScopeData,
  getWorkflowTemplateScopeLabel,
  loadWorkflowTemplatesForScope,
} from "@/lib/workflow-templates";
import { getStaticRateCardAssignmentKey, isInvalidRateCardUnits, normalizeRateCardUnits } from "@/lib/rate-card-config";
import { getIncrementalRateBinding, IncrementalRateBinding } from "@/lib/incremental-rate-tasks";
import {
  getWorkflowStepPlannedDuration,
  normalizeWorkflowDayCountingEnabled,
  normalizeWorkflowScheduleMode,
  type WorkflowScheduleMode,
} from "@/lib/workflow-schedule";
import {
  isStateWorkflowTaskType,
  isVariableWorkflowTaskType,
  isWorkflowTaskType,
  normalizeStateWorkflowSteps,
  normalizeWorkflowDefaultTarget,
  normalizeWorkflowParallelRoutes,
  normalizeWorkflowRoutes,
  remapWorkflowStepRouteTargets,
  routeOperatorNeedsValue,
  type WorkflowConditionalRoute,
  type WorkflowParallelRoute,
  type WorkflowRouteTarget,
} from "@/lib/workflow-routing";

type WorkflowStepDraft = {
  assignedTo?: string;
  label: string;
  form?: CustomForm;
  rateCardMode?: "static" | "dynamic" | null;
  dynamicRateCard?: boolean | null;
  dynamicRateCardConfig?: {
    defaultUnits: number;
    requirePerson: boolean;
    requireRateCard: boolean;
    promptForUnits?: boolean;
  } | null;
  rateCards?: FormRateCardItem[];
  rateCardId?: string | null;
  unitsToAdd?: number | string | null;
  autoAddUnits?: boolean | null;
  assignsNextStep?: boolean | null;
  isQualityGate?: boolean | null;
  plannedDurationDays?: number | null;
  conditionalRoutes?: WorkflowConditionalRoute[];
  parallelRoutes?: WorkflowParallelRoute[];
  finishWorkflowOnComplete?: boolean | null;
  decisionNodeEnabled?: boolean | null;
  parallelNodeEnabled?: boolean | null;
  decisionPosition?: { x: number; y: number } | null;
  parallelPosition?: { x: number; y: number } | null;
  workflowCompletePosition?: { x: number; y: number } | null;
  visualPosition?: { x: number; y: number } | null;
  disableImplicitLinearRoute?: boolean | null;
  defaultNextStepIndex?: WorkflowRouteTarget;
};

type SubtaskDraft = {
  title: string;
  description: string;
  assignedTo: string;
  priority: string;
  status: string;
  startDate: string;
  endDate: string;
  completionForm?: CustomForm;
  isIncremental?: boolean;
  incrementIndicator?: string;
  incrementTarget?: number;
  incrementMode?: "manual" | "rate_card";
  incrementRateCardId?: string;
  incrementFilterByAssignee?: boolean;
  incrementAssigneeId?: string;
  incrementFilterByDate?: boolean;
  incrementStartDate?: string;
  incrementEndDate?: string;
};

interface EditTaskStructureModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  project?: any;
  task: any | null;
  user: any;
  teamMembers: any[];
  rateCards?: any[];
  subtasks?: any[];
  canEditTaskStructure?: boolean;
  canManageWorkflowTemplates?: boolean;
  userRole?: string | null;
  templateScopeOrganizationIds?: string[];
  onCreateSubtask?: (parentTask: any, subtask: SubtaskDraft) => Promise<void> | void;
  onUpdateSubtaskCompletionForm?: (subtask: any, form: CustomForm | undefined) => Promise<void> | void;
  onSave: (updates: {
    title: string;
    quantitative?: {
      indicator: string;
      indicatorValue: number;
    };
    workflowSteps?: WorkflowStepDraft[];
    workflowScheduleMode?: WorkflowScheduleMode;
    workflowDayCountingEnabled?: boolean;
    rateCard?: {
      isRateCardTask: boolean;
      rateCardMode: "static" | "dynamic" | null;
      dynamicRateCard: boolean;
      dynamicRateCardConfig: {
        defaultUnits: number;
        requirePerson: boolean;
        requireRateCard: boolean;
        promptForUnits?: boolean;
      } | null;
      rateCardId: string | null;
      unitsToAdd: number | null;
      autoAddUnits: boolean;
    };
    incrementalRateBinding?: IncrementalRateBinding | null;
  }) => Promise<void> | void;
}

const getTaskTitle = (task: any) => task?.title || task?.name || "";

const createStepRateCardItem = (): FormRateCardItem => ({
  id: `step_rc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  rateCardId: "",
  unitsToAdd: 1,
  autoAddUnits: true,
  assigneeMode: "default",
  assignToProfessional: false,
  assignedTo: "",
});

const getEditableStepRateCards = (step: any): FormRateCardItem[] => {
  if (Array.isArray(step?.rateCards) && step.rateCards.length > 0) {
    return step.rateCards.map((item: any, index: number) => ({
      id: item.id || `step_rc_existing_${item.rateCardId || "empty"}_${index}`,
      rateCardId: item.rateCardId || "",
      unitsToAdd: normalizeRateCardUnits(item.unitsToAdd),
      autoAddUnits: item.autoAddUnits !== false,
      assigneeMode: item.assigneeMode || (item.assignToProfessional ? "fixed" : "default"),
      assignToProfessional: Boolean(item.assignToProfessional || item.assigneeMode === "fixed" || item.assigneeMode === "runtime"),
      assignedTo: item.assignedTo || "",
    }));
  }

  if (step?.rateCardId) {
    return [
      {
        id: "step_rc_legacy",
        rateCardId: step.rateCardId,
        unitsToAdd: normalizeRateCardUnits(step.unitsToAdd),
        autoAddUnits: step.autoAddUnits !== false,
        assigneeMode: step.assigneeMode || (step.assignToProfessional ? "fixed" : "default"),
        assignToProfessional: Boolean(step.assignToProfessional || step.assigneeMode === "fixed" || step.assigneeMode === "runtime"),
        assignedTo: step.assignedTo || "",
      },
    ];
  }

  return [];
};

const cleanStepRateCards = (step: any) =>
  getEditableStepRateCards(step)
    .filter((item) => item.rateCardId)
    .map((item) => ({
      ...item,
      unitsToAdd: normalizeRateCardUnits(item.unitsToAdd, 0),
      autoAddUnits: item.autoAddUnits !== false,
      assigneeMode: item.assigneeMode || (item.assignToProfessional ? "fixed" : "default"),
      assignToProfessional: (item.assigneeMode || (item.assignToProfessional ? "fixed" : "default")) !== "default",
      assignedTo: (item.assigneeMode || (item.assignToProfessional ? "fixed" : "default")) === "fixed" ? item.assignedTo || "" : "",
    }));

const getTaskDate = (value: any) => {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toDateInputValue = (value: any) => {
  const date = getTaskDate(value);
  if (!date) return "";
  return date.toISOString().slice(0, 10);
};

const getStatusLabel = (status: string) => {
  switch (status) {
    case "completed":
      return "Listo";
    case "in_progress":
      return "En curso";
    case "stuck":
      return "Estancado";
    case "todo":
    case "pending":
      return "Pendiente";
    default:
      return status || "Pendiente";
  }
};

const toDraftSteps = (steps: any[] = []): WorkflowStepDraft[] =>
  steps.map((step, index) => ({
    label: step?.label || "",
    assignedTo: step?.assignedTo || "",
    form: step?.form,
    rateCards: getEditableStepRateCards(step),
    rateCardMode: step?.rateCardMode ?? (step?.dynamicRateCard ? "dynamic" : getEditableStepRateCards(step).length > 0 ? "static" : null),
    dynamicRateCard: step?.dynamicRateCard ?? false,
    dynamicRateCardConfig: step?.dynamicRateCardConfig ?? null,
    rateCardId: step?.rateCardId ?? null,
    unitsToAdd: step?.unitsToAdd ?? null,
    autoAddUnits: step?.autoAddUnits ?? null,
    assignsNextStep: step?.assignsNextStep ?? null,
    isQualityGate: index === 0 ? false : step?.isQualityGate ?? null,
    plannedDurationDays: getWorkflowStepPlannedDuration(step),
    conditionalRoutes: normalizeWorkflowRoutes(step?.conditionalRoutes || step?.routes || []),
    parallelRoutes: normalizeWorkflowParallelRoutes(step?.parallelRoutes || step?.parallelNextStepIndexes || []),
    finishWorkflowOnComplete: Boolean(step?.finishWorkflowOnComplete),
    decisionNodeEnabled: Boolean(step?.decisionNodeEnabled),
    parallelNodeEnabled: Boolean(step?.parallelNodeEnabled),
    decisionPosition: step?.decisionPosition ?? null,
    parallelPosition: step?.parallelPosition ?? null,
    workflowCompletePosition: step?.workflowCompletePosition ?? step?.completeNodePosition ?? step?.workflowEndPosition ?? null,
    visualPosition: step?.visualPosition ?? step?.workflowPosition ?? step?.nodePosition ?? null,
    disableImplicitLinearRoute: Boolean(step?.disableImplicitLinearRoute),
    defaultNextStepIndex: normalizeWorkflowDefaultTarget(
      step?.defaultNextStepIndex ?? step?.defaultNextStepTarget,
      index,
      steps.length
    ) ?? null,
  }));

export function EditTaskStructureModal({
  isOpen,
  onClose,
  projectId,
  project,
  task,
  user,
  teamMembers,
  rateCards = [],
  subtasks = [],
  canEditTaskStructure = true,
  canManageWorkflowTemplates = false,
  userRole,
  templateScopeOrganizationIds = [],
  onCreateSubtask,
  onUpdateSubtaskCompletionForm,
  onSave,
}: EditTaskStructureModalProps) {
  const [title, setTitle] = useState("");
  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStepDraft[]>([]);
  const [workflowScheduleMode, setWorkflowScheduleMode] = useState<WorkflowScheduleMode>("calendar");
  const [workflowDayCountingEnabled, setWorkflowDayCountingEnabled] = useState(true);
  const [subtaskDraft, setSubtaskDraft] = useState<SubtaskDraft>({
    title: "",
    description: "",
    assignedTo: "",
    priority: "medium",
    status: "todo",
    startDate: "",
    endDate: "",
  });
  const [subtaskFormTarget, setSubtaskFormTarget] = useState<{
    mode: "draft" | "existing";
    subtask?: any;
  } | null>(null);
  const [isUpdatingSubtaskForm, setIsUpdatingSubtaskForm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingWorkflowView, setIsSavingWorkflowView] = useState(false);
  const [isCreatingSubtask, setIsCreatingSubtask] = useState(false);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [workflowTemplates, setWorkflowTemplates] = useState<any[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [isFormBuilderOpen, setIsFormBuilderOpen] = useState(false);
  const [currentStepIndexForForm, setCurrentStepIndexForForm] = useState<number | null>(null);
  const [taskRateCardEnabled, setTaskRateCardEnabled] = useState(false);
  const [taskRateCardMode, setTaskRateCardMode] = useState<"static" | "dynamic">("static");
  const [taskRateCardId, setTaskRateCardId] = useState("");
  const [taskUnitsToAdd, setTaskUnitsToAdd] = useState<string>("1");
  const [taskAutoAddUnits, setTaskAutoAddUnits] = useState(true);
  const [taskIndicator, setTaskIndicator] = useState("");
  const [taskIndicatorValue, setTaskIndicatorValue] = useState<number>(1);
  const [incrementRateBindingEnabled, setIncrementRateBindingEnabled] = useState(false);
  const [incrementRateCardId, setIncrementRateCardId] = useState("");
  const [incrementRateFilterByAssignee, setIncrementRateFilterByAssignee] = useState(false);
  const [incrementRateAssigneeId, setIncrementRateAssigneeId] = useState("");
  const [incrementRateFilterByDate, setIncrementRateFilterByDate] = useState(false);
  const [incrementRateStartDate, setIncrementRateStartDate] = useState("");
  const [incrementRateEndDate, setIncrementRateEndDate] = useState("");
  const templateScopeOrganizationKey = templateScopeOrganizationIds.join("|");

  const isVariableWorkflow = isVariableWorkflowTaskType(task?.type);
  const isStateWorkflow = isStateWorkflowTaskType(task?.type);
  const canEditWorkflow = Boolean(canEditTaskStructure && (isWorkflowTaskType(task?.type) || (task?.workflowSteps?.length || 0) > 0));
  const canManageSubtasks = Boolean(
    (task?.type === "state" || task?.type === "quantitative") && !task?.parentTaskId && onCreateSubtask
  );
  const hasDirectSubtasks = subtasks.length > 0;
  const taskDelegatesIncrementToSubtasks = Boolean(task?.type === "quantitative" && hasDirectSubtasks);
  const canConfigureTaskIncrementRate = Boolean(task?.type === "quantitative" && !hasDirectSubtasks);

  useEffect(() => {
    if (!isOpen || !task) return;
    setTitle(getTaskTitle(task));
    const loadedWorkflowSteps = toDraftSteps(task.workflowSteps || []);
    setWorkflowSteps(
      isStateWorkflowTaskType(task.type)
        ? normalizeStateWorkflowSteps(loadedWorkflowSteps)
        : loadedWorkflowSteps,
    );
    setWorkflowScheduleMode(normalizeWorkflowScheduleMode(task.workflowScheduleMode));
    setWorkflowDayCountingEnabled(normalizeWorkflowDayCountingEnabled(task.workflowDayCountingEnabled));
    setTaskIndicator(task.type === "quantitative" && hasDirectSubtasks ? "avance subtareas" : task.indicator || "avance");
    setTaskIndicatorValue(task.type === "quantitative" && hasDirectSubtasks ? 100 : Number(task.indicatorValue || 1));
    setSubtaskDraft({
      title: "",
      description: "",
      assignedTo: task.assignedTo || "",
      priority: task.priority || "medium",
      status: "todo",
      startDate: toDateInputValue(task.startDate),
      endDate: toDateInputValue(task.endDate),
      completionForm: undefined,
      isIncremental: task.type === "quantitative",
      incrementIndicator: task.type === "quantitative" ? task.indicator || "avance" : "",
      incrementTarget: task.type === "quantitative" ? Number(task.indicatorValue || 1) : 1,
      incrementMode: "manual",
      incrementRateCardId: "",
      incrementFilterByAssignee: false,
      incrementAssigneeId: "",
      incrementFilterByDate: false,
      incrementStartDate: "",
      incrementEndDate: "",
    });
    setSubtaskFormTarget(null);
    setIsUpdatingSubtaskForm(false);
    setIsSaving(false);
    setIsCreatingSubtask(false);
    setIsSavingTemplate(false);
    setTemplateName("");
    setShowTemplateModal(false);
    setIsFormBuilderOpen(false);
    setCurrentStepIndexForForm(null);
    setTaskRateCardEnabled(Boolean(task.isRateCardTask || task.dynamicRateCard || task.rateCardId));
    setTaskRateCardMode(task.dynamicRateCard || task.rateCardMode === "dynamic" ? "dynamic" : "static");
    setTaskRateCardId(task.rateCardId || "");
    setTaskUnitsToAdd(String(normalizeRateCardUnits(task.unitsToAdd ?? task.dynamicRateCardConfig?.defaultUnits)));
    setTaskAutoAddUnits(task.autoAddUnits !== false);
    const incrementalBinding = getIncrementalRateBinding(task);
    setIncrementRateBindingEnabled(Boolean(incrementalBinding));
    setIncrementRateCardId(incrementalBinding?.rateCardId || "");
    setIncrementRateFilterByAssignee(incrementalBinding?.assigneeMode === "fixed");
    setIncrementRateAssigneeId(incrementalBinding?.assignedTo || "");
    setIncrementRateFilterByDate(incrementalBinding?.dateMode === "range");
    setIncrementRateStartDate(toDateInputValue(incrementalBinding?.startDate));
    setIncrementRateEndDate(toDateInputValue(incrementalBinding?.endDate));
  }, [isOpen, task, hasDirectSubtasks]);

  useEffect(() => {
    if (!isOpen || !projectId) return;

    const fetchTemplates = async () => {
      try {
        const templates = await loadWorkflowTemplatesForScope({
          projectId,
          project,
          userRole,
          organizationIds: templateScopeOrganizationKey ? templateScopeOrganizationKey.split("|") : [],
        });
        setWorkflowTemplates(templates);
      } catch (error) {
        console.error("Error loading workflow templates:", error);
      }
    };

    void fetchTemplates();
  }, [isOpen, projectId, project, userRole, templateScopeOrganizationKey]);

  const currentProjectWorkflowTemplates = React.useMemo(
    () => workflowTemplates.filter((template) => template.projectId === projectId),
    [projectId, workflowTemplates]
  );
  const sharedWorkflowTemplates = React.useMemo(
    () => workflowTemplates.filter((template) => template.projectId !== projectId),
    [projectId, workflowTemplates]
  );

  if (!isOpen || !task) return null;

  const updateStep = (index: number, updates: Partial<WorkflowStepDraft>) => {
    setWorkflowSteps((currentSteps) =>
      currentSteps.map((step, stepIndex) =>
        stepIndex === index ? { ...step, ...updates } : step
      )
    );
  };

  const updateStepRateCard = (index: number, value: string) => {
    if (value === "__dynamic__") {
      updateStep(index, {
        rateCardMode: "dynamic",
        dynamicRateCard: true,
        dynamicRateCardConfig: {
          defaultUnits: normalizeRateCardUnits(workflowSteps[index]?.unitsToAdd),
          requirePerson: true,
          requireRateCard: true,
          promptForUnits: workflowSteps[index]?.autoAddUnits === false,
        },
        rateCards: [],
        rateCardId: null,
        autoAddUnits: workflowSteps[index]?.autoAddUnits !== false,
      });
      return;
    }

    if (value === "__static__") {
      const currentCards = getEditableStepRateCards(workflowSteps[index]);
      const nextCards = currentCards.length > 0 ? currentCards : [createStepRateCardItem()];
      const firstRateCard = nextCards[0];

      updateStep(index, {
        rateCardMode: "static",
        dynamicRateCard: false,
        dynamicRateCardConfig: null,
        rateCards: nextCards,
        rateCardId: firstRateCard?.rateCardId || null,
        autoAddUnits: firstRateCard?.autoAddUnits !== false,
        unitsToAdd: firstRateCard?.unitsToAdd ?? 1,
      });
      return;
    }

    updateStep(index, {
      rateCardMode: null,
      dynamicRateCard: false,
      dynamicRateCardConfig: null,
      rateCards: [],
      rateCardId: null,
      autoAddUnits: true,
      unitsToAdd: null,
    });
  };

  const updateStepStaticRateCards = (
    index: number,
    updater: (currentCards: FormRateCardItem[]) => FormRateCardItem[]
  ) => {
    setWorkflowSteps((currentSteps) =>
      currentSteps.map((step, stepIndex) => {
        if (stepIndex !== index) return step;

        const nextCards = updater(getEditableStepRateCards(step));
        const firstRateCard = nextCards[0];

        return {
          ...step,
          rateCardMode: nextCards.length > 0 ? "static" : null,
          dynamicRateCard: false,
          dynamicRateCardConfig: null,
          rateCards: nextCards,
          rateCardId: firstRateCard?.rateCardId || null,
          unitsToAdd: firstRateCard ? firstRateCard.unitsToAdd : null,
          autoAddUnits: firstRateCard ? firstRateCard.autoAddUnits !== false : true,
        };
      })
    );
  };

  const addStep = () => {
    setWorkflowSteps((currentSteps) => {
      const nextSteps = [
        ...currentSteps,
        {
          label: `Paso ${currentSteps.length + 1}`,
          assignedTo: "",
          rateCards: [],
          unitsToAdd: 1,
          autoAddUnits: true,
          plannedDurationDays: 1,
          disableImplicitLinearRoute: isVariableWorkflow,
        },
      ];
      return isStateWorkflow ? normalizeStateWorkflowSteps(nextSteps) : nextSteps;
    });
  };

  const removeStep = (index: number) => {
    if (index === 0 && workflowSteps[1]?.isQualityGate) {
      toast.warning("No puedes dejar un paso de calidad como primer paso. Mueve o desmarca ese control antes de borrar.");
      return;
    }

    setWorkflowSteps((currentSteps) => {
      const keptSteps = currentSteps.filter((_, stepIndex) => stepIndex !== index);
      const oldIndexByNewIndex = currentSteps
        .map((_, oldIndex) => oldIndex)
        .filter((oldIndex) => oldIndex !== index);
      const remappedSteps = remapWorkflowStepRouteTargets(keptSteps, oldIndexByNewIndex);
      return isStateWorkflow ? normalizeStateWorkflowSteps(remappedSteps) : remappedSteps;
    });
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    if (direction === -1 && index === 1 && workflowSteps[index]?.isQualityGate) {
      toast.warning("El control de calidad necesita un paso anterior y no puede quedar primero.");
      return;
    }

    if (direction === 1 && index === 0 && workflowSteps[1]?.isQualityGate) {
      toast.warning("El control de calidad necesita un paso anterior y no puede quedar primero.");
      return;
    }

    setWorkflowSteps((currentSteps) => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= currentSteps.length) return currentSteps;

      const nextSteps = [...currentSteps];
      const [movedStep] = nextSteps.splice(index, 1);
      nextSteps.splice(targetIndex, 0, movedStep);
      const oldIndexByNewIndex = nextSteps.map((step) => currentSteps.indexOf(step));
      const remappedSteps = remapWorkflowStepRouteTargets(nextSteps, oldIndexByNewIndex);
      return isStateWorkflow ? normalizeStateWorkflowSteps(remappedSteps) : remappedSteps;
    });
  };

  const updateSubtaskDraft = (updates: Partial<SubtaskDraft>) => {
    setSubtaskDraft((currentDraft) => ({ ...currentDraft, ...updates }));
  };

  const resetSubtaskDraft = () => {
    setSubtaskDraft({
      title: "",
      description: "",
      assignedTo: task.assignedTo || "",
      priority: task.priority || "medium",
      status: "todo",
      startDate: toDateInputValue(task.startDate),
      endDate: toDateInputValue(task.endDate),
      completionForm: undefined,
      isIncremental: task.type === "quantitative",
      incrementIndicator: task.type === "quantitative" ? task.indicator || "avance" : "",
      incrementTarget: task.type === "quantitative" ? Number(task.indicatorValue || 1) : 1,
      incrementMode: "manual",
      incrementRateCardId: "",
      incrementFilterByAssignee: false,
      incrementAssigneeId: "",
      incrementFilterByDate: false,
      incrementStartDate: "",
      incrementEndDate: "",
    });
  };

  const getSubtaskCompletionFormSummary = (form?: CustomForm | null) => {
    if (!form) return "Sin formulario de cierre";
    const fieldsCount = form.fields?.length || 0;
    const rateCardsCount = form.rateCards?.length || (form.rateCardId ? 1 : 0) || (form.dynamicRateCard ? 1 : 0);
    return `${form.title || "Formulario de cierre"} · ${fieldsCount} campos${rateCardsCount ? ` · ${rateCardsCount} rates` : ""}`;
  };

  const handleSaveSubtaskCompletionForm = async (form: CustomForm | undefined) => {
    if (!subtaskFormTarget) return;

    if (subtaskFormTarget.mode === "draft") {
      updateSubtaskDraft({ completionForm: form });
      setSubtaskFormTarget(null);
      return;
    }

    if (!subtaskFormTarget.subtask || !onUpdateSubtaskCompletionForm) return;

    setIsUpdatingSubtaskForm(true);
    try {
      await onUpdateSubtaskCompletionForm(subtaskFormTarget.subtask, form);
      setSubtaskFormTarget(null);
    } finally {
      setIsUpdatingSubtaskForm(false);
    }
  };

  const handleCreateSubtask = async () => {
    if (!canManageSubtasks || !onCreateSubtask) return;

    if (!subtaskDraft.title.trim()) {
      toast.warning("Ingresa el nombre de la subtarea.");
      return;
    }

    if (!subtaskDraft.startDate || !subtaskDraft.endDate) {
      toast.warning("Define fecha de inicio y fin para la subtarea.");
      return;
    }

    if (task.type === "quantitative" && subtaskDraft.isIncremental) {
      if (!String(subtaskDraft.incrementIndicator || "").trim()) {
        toast.warning("Define la unidad o indicador incremental de la subtarea.");
        return;
      }

      if (Number(subtaskDraft.incrementTarget || 0) <= 0) {
        toast.warning("Define una meta incremental mayor a cero para la subtarea.");
        return;
      }

      if (subtaskDraft.incrementMode === "rate_card" && !subtaskDraft.incrementRateCardId) {
        toast.warning("Selecciona el Rate Card que incrementará esta subtarea.");
        return;
      }

      if (subtaskDraft.incrementMode === "rate_card" && subtaskDraft.incrementFilterByAssignee && !subtaskDraft.incrementAssigneeId) {
        toast.warning("Selecciona la persona que debe generar el Rate Card de esta subtarea.");
        return;
      }

      if (subtaskDraft.incrementMode === "rate_card" && subtaskDraft.incrementFilterByDate) {
        if (!subtaskDraft.incrementStartDate || !subtaskDraft.incrementEndDate) {
          toast.warning("Define el rango de fechas del Rate Card incremental de esta subtarea.");
          return;
        }

        if (new Date(`${subtaskDraft.incrementStartDate}T00:00:00`).getTime() > new Date(`${subtaskDraft.incrementEndDate}T23:59:59`).getTime()) {
          toast.warning("La fecha inicial del filtro incremental no puede ser posterior a la fecha final.");
          return;
        }
      }
    }

    setIsCreatingSubtask(true);
    try {
      await onCreateSubtask(task, {
        ...subtaskDraft,
        title: subtaskDraft.title.trim(),
        description: subtaskDraft.description.trim(),
      });
      resetSubtaskDraft();
    } catch (error: any) {
      console.error("Error creating subtask:", error);
      toast.error(error?.message || "No se pudo crear la subtarea.");
    } finally {
      setIsCreatingSubtask(false);
    }
  };

  const getCleanWorkflowSteps = (sourceSteps: WorkflowStepDraft[] = workflowSteps): WorkflowStepDraft[] => {
    const cleanSteps = sourceSteps.map((step, index) => {
      const staticRateCards = step.dynamicRateCard ? [] : cleanStepRateCards(step);
      const firstRateCard = staticRateCards[0];

      return {
        ...step,
        isQualityGate: index === 0 ? false : step.isQualityGate,
        label: step.label.trim(),
        plannedDurationDays: getWorkflowStepPlannedDuration(step),
        rateCards: staticRateCards,
        rateCardMode: step.dynamicRateCard
          ? ("dynamic" as const)
          : staticRateCards.length > 0
            ? ("static" as const)
            : null,
        dynamicRateCard: Boolean(step.dynamicRateCard),
        dynamicRateCardConfig: step.dynamicRateCard
          ? {
              defaultUnits: normalizeRateCardUnits(step.unitsToAdd ?? step.dynamicRateCardConfig?.defaultUnits),
              requirePerson: true,
              requireRateCard: true,
              promptForUnits: step.autoAddUnits === false,
            }
          : null,
        rateCardId: step.dynamicRateCard ? null : firstRateCard?.rateCardId || null,
        unitsToAdd: step.dynamicRateCard
          ? normalizeRateCardUnits(step.unitsToAdd)
          : firstRateCard
            ? normalizeRateCardUnits(firstRateCard.unitsToAdd)
            : null,
        autoAddUnits: step.dynamicRateCard
          ? step.autoAddUnits !== false
          : firstRateCard
            ? firstRateCard.autoAddUnits !== false
            : true,
        conditionalRoutes: normalizeWorkflowRoutes(step.conditionalRoutes || []).map((route) => {
          const field = step.form?.fields?.find((candidate) => candidate.id === route.fieldId);
          return {
            ...route,
            fieldLabel: field?.label || route.fieldLabel || route.fieldId,
          };
        }),
        parallelRoutes: normalizeWorkflowParallelRoutes(step.parallelRoutes || []).map((route) => ({
          ...route,
          targetStepIndex: route.targetStepIndex,
        })),
        parallelNextStepIndexes: null,
        finishWorkflowOnComplete: Boolean(step.finishWorkflowOnComplete),
        decisionNodeEnabled: Boolean(step.decisionNodeEnabled),
        parallelNodeEnabled: Boolean(step.parallelNodeEnabled),
        decisionPosition: step.decisionPosition || null,
        parallelPosition: step.parallelPosition || null,
        workflowCompletePosition: step.workflowCompletePosition || null,
        visualPosition: step.visualPosition || null,
        disableImplicitLinearRoute: Boolean(step.disableImplicitLinearRoute),
        defaultNextStepIndex: normalizeWorkflowDefaultTarget(
          step.defaultNextStepIndex,
          index,
          sourceSteps.length
        ) ?? null,
      };
    });

    return isStateWorkflow ? normalizeStateWorkflowSteps(cleanSteps) : cleanSteps;
  };

  const getCleanTaskRateCard = () => {
    if (taskDelegatesIncrementToSubtasks || !taskRateCardEnabled) {
      return {
        isRateCardTask: false,
        rateCardMode: null,
        dynamicRateCard: false,
        dynamicRateCardConfig: null,
        rateCardId: null,
        unitsToAdd: null,
        autoAddUnits: true,
      };
    }

    if (taskRateCardMode === "dynamic") {
      return {
        isRateCardTask: true,
        rateCardMode: "dynamic" as const,
        dynamicRateCard: true,
        dynamicRateCardConfig: {
          defaultUnits: normalizeRateCardUnits(taskUnitsToAdd),
          requirePerson: true,
          requireRateCard: true,
          promptForUnits: !taskAutoAddUnits,
        },
        rateCardId: null,
        unitsToAdd: normalizeRateCardUnits(taskUnitsToAdd),
        autoAddUnits: taskAutoAddUnits,
      };
    }

    return {
      isRateCardTask: true,
      rateCardMode: "static" as const,
      dynamicRateCard: false,
      dynamicRateCardConfig: null,
      rateCardId: taskRateCardId || null,
      unitsToAdd: normalizeRateCardUnits(taskUnitsToAdd),
      autoAddUnits: taskAutoAddUnits,
    };
  };

  const getCleanIncrementalRateBinding = (): IncrementalRateBinding | null => {
    if (!canConfigureTaskIncrementRate || !incrementRateBindingEnabled) return null;

    return {
      enabled: true,
      rateCardId: incrementRateCardId || null,
      assigneeMode: incrementRateFilterByAssignee ? "fixed" : "any",
      assignedTo: incrementRateFilterByAssignee ? incrementRateAssigneeId || null : null,
      dateMode: incrementRateFilterByDate ? "range" : "any",
      startDate: incrementRateFilterByDate && incrementRateStartDate
        ? new Date(`${incrementRateStartDate}T00:00:00`)
        : null,
      endDate: incrementRateFilterByDate && incrementRateEndDate
        ? new Date(`${incrementRateEndDate}T23:59:59`)
        : null,
    };
  };

  const normalizeTemplateName = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

  const validateWorkflowSteps = (sourceSteps: WorkflowStepDraft[] = workflowSteps) => {
    if (sourceSteps.length === 0) {
      toast.warning("Esta tarea necesita al menos un paso de workflow.");
      return false;
    }

    if (sourceSteps.some((step) => !step.label.trim())) {
      toast.warning("Todos los pasos deben tener nombre.");
      return false;
    }

    if (sourceSteps[0]?.isQualityGate) {
      toast.warning("El primer paso no puede ser control de calidad; debe existir un paso anterior que envíe a revisión.");
      return false;
    }

    const hasStaticStepWithoutRateCard = sourceSteps.some(
      (step) => step.rateCardMode === "static" && cleanStepRateCards(step).length === 0
    );
    if (hasStaticStepWithoutRateCard) {
      toast.warning("Agrega al menos un Rate Card fijo en cada paso configurado.");
      return false;
    }

    const hasInvalidStepUnits = sourceSteps.some(
      (step) => {
        if (step.dynamicRateCard) return isInvalidRateCardUnits(step.unitsToAdd);
        return cleanStepRateCards(step).some((item) => isInvalidRateCardUnits(item.unitsToAdd));
      }
    );
    if (hasInvalidStepUnits) {
      toast.warning("Define unidades de Rate Card en cero o mayores en los pasos.");
      return false;
    }

    const hasMissingStepRateCardAssignee = sourceSteps.some((step) =>
      cleanStepRateCards(step).some((item) => item.assigneeMode === "fixed" && !item.assignedTo)
    );
    if (hasMissingStepRateCardAssignee) {
      toast.warning("Selecciona el profesional para cada Rate Card fijo asignable.");
      return false;
    }

    const hasDuplicatedStaticRateCardAssignments = sourceSteps.some((step) => {
      const cards = cleanStepRateCards(step);
      return cards.some(
        (item, itemIndex) =>
          cards.findIndex(
            (candidate) =>
              getStaticRateCardAssignmentKey(candidate, step.assignedTo) === getStaticRateCardAssignmentKey(item, step.assignedTo)
          ) !== itemIndex
      );
    });
    if (hasDuplicatedStaticRateCardAssignments) {
      toast.warning("Puedes repetir un Rate Card solo si se carga a profesionales diferentes.");
      return false;
    }

    const hasInvalidDuration = sourceSteps.some(
      (step) => !Number.isFinite(Number(step.plannedDurationDays ?? 1)) || Number(step.plannedDurationDays ?? 1) <= 0
    );
    if (hasInvalidDuration) {
      toast.warning("Cada paso del workflow debe tener una duracion mayor a cero dias.");
      return false;
    }

    const hasInvalidConditionalRoute = sourceSteps.some((step, stepIndex) =>
      normalizeWorkflowRoutes(step.conditionalRoutes || []).some((route) => {
        const target = normalizeWorkflowDefaultTarget(route.targetStepIndex, stepIndex, sourceSteps.length);
        if (!route.fieldId || target === undefined || target === null) return true;
        return routeOperatorNeedsValue(route.operator) && !String(route.value || "").trim();
      })
    );
    if (hasInvalidConditionalRoute) {
      toast.warning("Completa las condiciones del workflow: variable, valor y destino.");
      return false;
    }

    const hasInvalidParallelRoute = sourceSteps.some((step, stepIndex) =>
      normalizeWorkflowParallelRoutes(step.parallelRoutes || []).some((route) => {
        const target = normalizeWorkflowDefaultTarget(route.targetStepIndex, stepIndex, sourceSteps.length);
        return typeof target !== "number";
      })
    );
    if (hasInvalidParallelRoute) {
      toast.warning("Hay una rama paralela sin destino válido. Reconexiona esa rama antes de guardar.");
      return false;
    }

    return true;
  };

  const handleSaveWorkflowView = async (nextSteps: WorkflowStepDraft[]) => {
    if (!validateWorkflowSteps(nextSteps)) return;

    const cleanSteps = getCleanWorkflowSteps(nextSteps);
    setIsSavingWorkflowView(true);
    try {
      await updateDoc(doc(db, "projects", projectId, "tasks", task.id), {
        workflowSteps: cleanSteps,
        workflowScheduleMode,
        workflowDayCountingEnabled,
        updatedAt: serverTimestamp(),
      });
      setWorkflowSteps(cleanSteps);
      toast.success("Vista y rutas del workflow guardadas.");
    } finally {
      setIsSavingWorkflowView(false);
    }
  };

  const handleSaveTemplate = async () => {
    const cleanTemplateName = templateName.trim().replace(/\s+/g, " ");
    if (!cleanTemplateName) {
      toast.warning("Ingresa un nombre para la plantilla.");
      return;
    }

    if (!validateWorkflowSteps()) return;

    setIsSavingTemplate(true);
    try {
      const existingTemplate = currentProjectWorkflowTemplates.find(
        (template) => normalizeTemplateName(template.name || "") === normalizeTemplateName(cleanTemplateName)
      );
      const templateData = {
        name: cleanTemplateName,
        ...getWorkflowTemplateScopeData(projectId, project),
        steps: getCleanWorkflowSteps(),
        workflowScheduleMode,
        workflowDayCountingEnabled,
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid || "unknown",
        sourceTaskId: task.id,
      };

      if (existingTemplate) {
        const confirmed = window.confirm(`Ya existe la plantilla "${existingTemplate.name}". ¿Quieres reescribirla con este workflow?`);
        if (!confirmed) return;

        await updateDoc(doc(db, "workflow_templates", existingTemplate.id), templateData);
        setWorkflowTemplates((currentTemplates) =>
          currentTemplates
            .map((template) =>
              template.id === existingTemplate.id
                ? { ...template, ...templateData }
                : template
            )
            .sort((left: any, right: any) => String(left.name || "").localeCompare(String(right.name || "")))
        );
        toast.success("Plantilla reescrita correctamente.");
      } else {
        const templateToCreate = {
          ...templateData,
          createdAt: serverTimestamp(),
          createdBy: user?.uid || "unknown",
        };
        const docRef = await addDoc(collection(db, "workflow_templates"), templateToCreate);
        setWorkflowTemplates((currentTemplates) =>
          [
            ...currentTemplates,
            { id: docRef.id, ...templateToCreate },
          ].sort((left: any, right: any) => String(left.name || "").localeCompare(String(right.name || "")))
        );
        toast.success("Workflow guardado como plantilla.");
      }

      setShowTemplateModal(false);
      setTemplateName("");
    } catch (error: any) {
      console.error("Error saving workflow template:", error);
      toast.error(error?.message || "Error al guardar el workflow.");
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const handleDeleteTemplate = async (templateId: string, name: string) => {
    if (!canManageWorkflowTemplates) {
      toast.error("No tienes permisos para eliminar plantillas.");
      return;
    }

    const confirmed = window.confirm(`¿Eliminar la plantilla "${name}"? Esta acción no se puede deshacer.`);
    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, "workflow_templates", templateId));
      setWorkflowTemplates((currentTemplates) => currentTemplates.filter((template) => template.id !== templateId));
      toast.success("Plantilla eliminada.");
    } catch (error: any) {
      console.error("Error deleting workflow template:", error);
      toast.error(error?.message || "No se pudo eliminar la plantilla.");
    }
  };

  const handleLoadTemplate = (templateId: string) => {
    if (!templateId) return;

    const template = workflowTemplates.find((candidate) => candidate.id === templateId);
    if (!template?.steps) return;

    const loadedSteps = toDraftSteps(template.steps);
    setWorkflowSteps(isStateWorkflow ? normalizeStateWorkflowSteps(loadedSteps) : loadedSteps);
    setWorkflowScheduleMode(normalizeWorkflowScheduleMode(template.workflowScheduleMode));
    setWorkflowDayCountingEnabled(normalizeWorkflowDayCountingEnabled(template.workflowDayCountingEnabled));
    if (template.steps[0]?.isQualityGate) {
      toast.warning("Se desmarco calidad del primer paso porque necesita un paso anterior.");
    }
    toast.success("Plantilla cargada.");
  };

  const handleSave = async () => {
    if (!canEditTaskStructure) {
      toast.error("No tienes permisos para editar la estructura de esta tarea.");
      return;
    }

    const cleanTitle = title.trim();
    if (!cleanTitle) {
      toast.warning("El nombre de la tarea no puede estar vacio.");
      return;
    }

    if (canEditWorkflow) {
      if (!validateWorkflowSteps()) return;
    }

    if (!taskDelegatesIncrementToSubtasks && taskRateCardEnabled && taskRateCardMode === "static" && !taskRateCardId) {
      toast.warning("Selecciona el Rate Card fijo de la tarea.");
      return;
    }

    if (!taskDelegatesIncrementToSubtasks && taskRateCardEnabled && isInvalidRateCardUnits(taskUnitsToAdd)) {
      toast.warning("Define unidades de Rate Card en cero o mayores para la tarea.");
      return;
    }

    if (task?.type === "quantitative" && !taskDelegatesIncrementToSubtasks) {
      if (!taskIndicator.trim()) {
        toast.warning("Define la unidad o indicador incremental de esta tarea.");
        return;
      }

      if (Number(taskIndicatorValue || 0) <= 0) {
        toast.warning("Define una meta incremental mayor a cero para esta tarea.");
        return;
      }
    }

    if (canConfigureTaskIncrementRate && incrementRateBindingEnabled && !incrementRateCardId) {
      toast.warning("Selecciona el Rate Card que gobernará el avance incremental.");
      return;
    }

    if (canConfigureTaskIncrementRate && incrementRateBindingEnabled && incrementRateFilterByAssignee && !incrementRateAssigneeId) {
      toast.warning("Selecciona la persona que debe generar el Rate Card para contar el avance.");
      return;
    }

    if (canConfigureTaskIncrementRate && incrementRateBindingEnabled && incrementRateFilterByDate) {
      if (!incrementRateStartDate || !incrementRateEndDate) {
        toast.warning("Define fecha inicial y final para el filtro del Rate Card incremental.");
        return;
      }

      if (new Date(`${incrementRateStartDate}T00:00:00`).getTime() > new Date(`${incrementRateEndDate}T23:59:59`).getTime()) {
        toast.warning("La fecha inicial del filtro no puede ser posterior a la fecha final.");
        return;
      }
    }

    setIsSaving(true);
    try {
      await onSave({
        title: cleanTitle,
        quantitative: task?.type === "quantitative"
          ? taskDelegatesIncrementToSubtasks
            ? {
                indicator: "avance subtareas",
                indicatorValue: 100,
              }
            : {
                indicator: taskIndicator.trim(),
                indicatorValue: Number(taskIndicatorValue),
              }
          : undefined,
        workflowSteps: canEditWorkflow
          ? getCleanWorkflowSteps()
          : undefined,
        workflowScheduleMode: canEditWorkflow ? workflowScheduleMode : undefined,
        workflowDayCountingEnabled: canEditWorkflow ? workflowDayCountingEnabled : undefined,
        rateCard: getCleanTaskRateCard(),
        incrementalRateBinding: getCleanIncrementalRateBinding(),
      });
      onClose();
    } catch (error: any) {
      console.error("Error updating task structure:", error);
      toast.error(error?.message || "No se pudo actualizar la estructura de la tarea.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-start justify-between p-6 border-b border-slate-100">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Settings size={20} className="text-indigo-600" />
              <h2 className="text-xl font-bold text-slate-800">
                {canEditWorkflow
                  ? "Editar tarea y dependientes"
                  : canEditTaskStructure
                    ? "Editar tarea"
                    : "Administrar subtareas"}
              </h2>
            </div>
            <p className="text-sm text-slate-500 mt-1">
              {canEditWorkflow
                ? isStateWorkflow
                  ? "Edita la secuencia única, los responsables, formularios, documentos y controles de cada estado."
                  : "Los cambios se aplicaran a esta tarea y a todas sus subtareas dependientes."
                : canEditTaskStructure
                  ? "Ajusta la tarea por estado y administra sus subtareas."
                  : "Crea y revisa subtareas sin cambiar la estructura principal."}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
            disabled={isSaving}
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {canEditTaskStructure ? (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Nombre de la tarea
              </label>
              <input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="Nombre visible de la tarea"
              />
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Tarea</p>
              <p className="mt-1 text-sm font-semibold text-slate-800">{getTaskTitle(task)}</p>
            </div>
          )}

          {canEditTaskStructure && task?.type === "quantitative" && (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4">
              <div className="flex items-start gap-2">
                <div className="mt-0.5 rounded-lg bg-white p-1.5 text-emerald-600 shadow-sm">
                  <ClipboardList size={15} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">Meta incremental de esta tarea</h3>
                  <p className="text-xs text-slate-500">
                    {hasDirectSubtasks
                      ? "La matriz se completará desde sus subtareas. Cada subtarea puede tener su propia meta y filtros."
                      : "Ajusta la unidad de avance y la meta que debe alcanzar esta tarea."}
                  </p>
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_140px]">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                    Indicador
                  </label>
                  <input
                    type="text"
                    value={taskDelegatesIncrementToSubtasks ? "avance subtareas" : taskIndicator}
                    onChange={(event) => setTaskIndicator(event.target.value)}
                    disabled={taskDelegatesIncrementToSubtasks}
                    className="h-10 w-full rounded-lg border border-emerald-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:bg-emerald-50 disabled:text-emerald-700"
                    placeholder="Ej. predios, revisiones, unidades"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                    Meta
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={taskDelegatesIncrementToSubtasks ? 100 : taskIndicatorValue}
                    onChange={(event) => setTaskIndicatorValue(Number(event.target.value))}
                    disabled={taskDelegatesIncrementToSubtasks}
                    className="h-10 w-full rounded-lg border border-emerald-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:bg-emerald-50 disabled:text-emerald-700"
                    placeholder="Meta"
                  />
                </div>
              </div>
              {taskDelegatesIncrementToSubtasks && (
                <div className="mt-3 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-medium text-emerald-700">
                  La tarea madre no tiene una meta directa: su 100% se calcula con la completitud promedio de sus subtareas incrementales.
                </div>
              )}
            </div>
          )}

          {canEditTaskStructure && taskDelegatesIncrementToSubtasks && (
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
              <div className="flex items-start gap-2">
                <div className="mt-0.5 rounded-lg bg-white p-1.5 text-indigo-600 shadow-sm">
                  <CreditCard size={15} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">Rate Cards en subtareas</h3>
                  <p className="text-xs text-slate-500">
                    Esta matriz consolida el avance de sus subtareas. Configura Rate Cards, metas y filtros en cada subtarea incremental.
                  </p>
                </div>
              </div>
            </div>
          )}

          {canEditTaskStructure && !taskDelegatesIncrementToSubtasks && (
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-2">
                  <div className="mt-0.5 rounded-lg bg-white p-1.5 text-indigo-600 shadow-sm">
                    <CreditCard size={15} />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">Rate Card de la tarea principal</h3>
                    <p className="text-xs text-slate-500">
                      Define si esta tarea suma unidades a un perfil de Rate Card al completarse.
                    </p>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-600">
                  <input
                    type="checkbox"
                    checked={taskRateCardEnabled}
                    onChange={(event) => setTaskRateCardEnabled(event.target.checked)}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  Tiene Rate Card
                </label>
              </div>

              {taskRateCardEnabled && (
                <div className="mt-4 grid gap-3 md:grid-cols-[160px_minmax(0,1fr)_120px_150px]">
                  <select
                    value={taskRateCardMode}
                    onChange={(event) => {
                      const mode = event.target.value as "static" | "dynamic";
                      setTaskRateCardMode(mode);
                      if (mode === "dynamic") setTaskRateCardId("");
                    }}
                    className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    <option value="static">Rate Card fijo</option>
                    <option value="dynamic">Rate Card dinámico</option>
                  </select>

                  {taskRateCardMode === "static" ? (
                    <select
                      value={taskRateCardId}
                      onChange={(event) => setTaskRateCardId(event.target.value)}
                      className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    >
                      <option value="">Seleccionar Rate Card...</option>
                      {rateCards.map((rateCard) => (
                        <option key={rateCard.id} value={rateCard.id}>
                          {rateCard.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="flex h-10 items-center rounded-lg border border-emerald-100 bg-emerald-50 px-3 text-xs font-medium text-emerald-700">
                      Dinámico al completar
                    </div>
                  )}

                  <label className="flex h-10 items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 text-xs font-medium text-emerald-700">
                    <input
                      type="checkbox"
                      checked={taskAutoAddUnits}
                      onChange={(event) => setTaskAutoAddUnits(event.target.checked)}
                      className="rounded border-emerald-200 text-emerald-600 focus:ring-emerald-500"
                    />
                    Sumar auto.
                  </label>

                  {taskAutoAddUnits ? (
                    <div className="space-y-1">
                      <input
                        type="text"
                        inputMode="decimal"
                        pattern="[0-9]*[.,]?[0-9]*"
                        value={taskUnitsToAdd}
                        onChange={(event) => setTaskUnitsToAdd(event.target.value)}
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                        placeholder="Ej. 0,051"
                        title="Puedes usar coma o punto decimal. Ejemplo: 0,051 o 0.051"
                      />
                      <p className="text-[10px] font-bold text-emerald-700">
                        Puedes usar coma o punto decimal. Ejemplo: 0,051 o 0.051.
                      </p>
                    </div>
                  ) : (
                    <div className="h-10 rounded-lg border border-dashed border-emerald-200 bg-white px-3 py-2 text-[10px] font-medium text-emerald-700">
                      Pedirá unidades al completar.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {canEditTaskStructure && canConfigureTaskIncrementRate && (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-2">
                  <div className="mt-0.5 rounded-lg bg-white p-1.5 text-emerald-600 shadow-sm">
                    <ClipboardList size={15} />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">Avance gobernado por Rate Card</h3>
                    <p className="text-xs text-slate-500">
                      Hace que el contador de esta tarea avance solo con movimientos del Rate Card seleccionado.
                    </p>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-700">
                  <input
                    type="checkbox"
                    checked={incrementRateBindingEnabled}
                    onChange={(event) => setIncrementRateBindingEnabled(event.target.checked)}
                    className="rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  Activar
                </label>
              </div>

              {incrementRateBindingEnabled && (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                      Rate Card que suma avance
                    </label>
                    <select
                      value={incrementRateCardId}
                      onChange={(event) => setIncrementRateCardId(event.target.value)}
                      className="h-10 w-full rounded-lg border border-emerald-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    >
                      <option value="">Seleccionar Rate Card...</option>
                      {rateCards.map((rateCard) => (
                        <option key={rateCard.id} value={rateCard.id}>
                          {rateCard.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <label className="flex h-10 items-center gap-2 rounded-lg border border-emerald-100 bg-white px-3 text-xs font-bold text-slate-700">
                    <input
                      type="checkbox"
                      checked={incrementRateFilterByAssignee}
                      onChange={(event) => setIncrementRateFilterByAssignee(event.target.checked)}
                      className="rounded border-emerald-200 text-emerald-600 focus:ring-emerald-500"
                    />
                    Solo contar una persona
                  </label>

                  {incrementRateFilterByAssignee ? (
                    <select
                      value={incrementRateAssigneeId}
                      onChange={(event) => setIncrementRateAssigneeId(event.target.value)}
                      className="h-10 rounded-lg border border-emerald-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    >
                      <option value="">Seleccionar persona...</option>
                      {teamMembers.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name || member.email}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="flex h-10 items-center rounded-lg border border-emerald-100 bg-white px-3 text-xs font-medium text-emerald-700">
                      Cuenta movimientos de cualquier profesional.
                    </div>
                  )}

                  <label className="flex h-10 items-center gap-2 rounded-lg border border-emerald-100 bg-white px-3 text-xs font-bold text-slate-700">
                    <input
                      type="checkbox"
                      checked={incrementRateFilterByDate}
                      onChange={(event) => setIncrementRateFilterByDate(event.target.checked)}
                      className="rounded border-emerald-200 text-emerald-600 focus:ring-emerald-500"
                    />
                    Contar solo un periodo
                  </label>

                  {incrementRateFilterByDate ? (
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="date"
                        value={incrementRateStartDate}
                        onChange={(event) => setIncrementRateStartDate(event.target.value)}
                        className="h-10 rounded-lg border border-emerald-200 bg-white px-3 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                      />
                      <input
                        type="date"
                        value={incrementRateEndDate}
                        onChange={(event) => setIncrementRateEndDate(event.target.value)}
                        className="h-10 rounded-lg border border-emerald-200 bg-white px-3 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                      />
                    </div>
                  ) : (
                    <div className="flex h-10 items-center rounded-lg border border-emerald-100 bg-white px-3 text-xs font-medium text-emerald-700">
                      Cuenta todos los movimientos históricos del rate.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {canEditWorkflow ? (
            <div>
              <div className="mb-4 flex min-w-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-slate-800">
                    {isStateWorkflow ? "Estados del procedimiento" : "Pasos del workflow"}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {isStateWorkflow
                      ? "Cada estado se ejecuta una vez y habilita únicamente el siguiente, conservando toda la trazabilidad."
                      : workflowDayCountingEnabled
                      ? "Cambia nombres, responsables, formularios y los dias que consumira cada paso."
                      : "El workflow conserva su periodo; los dias de cada paso quedan solo como estadistica de planeacion."}
                  </p>
                </div>
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center xl:justify-end">
                  <label className="flex h-9 items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50 px-3 text-xs font-bold text-indigo-700">
                    <input
                      type="checkbox"
                      checked={workflowDayCountingEnabled}
                      onChange={(event) => setWorkflowDayCountingEnabled(event.target.checked)}
                      className="h-4 w-4 rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    Conteo por pasos
                  </label>
                  <select
                    value={workflowScheduleMode}
                    disabled={!workflowDayCountingEnabled}
                    onChange={(event) => setWorkflowScheduleMode(normalizeWorkflowScheduleMode(event.target.value))}
                    className="h-9 min-w-0 rounded-lg border border-indigo-200 bg-white px-3 text-xs font-semibold text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 sm:w-[160px]"
                    title="Modo de calculo de fechas"
                  >
                    <option value="calendar">Dias calendario</option>
                    <option value="business">Dias laborales</option>
                  </select>
                  {workflowTemplates.length > 0 && (
                    <select
                      className="h-9 min-w-0 rounded-lg border border-indigo-200 bg-white px-3 text-xs font-semibold text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 sm:w-[220px] lg:w-[260px]"
                      onChange={(event) => handleLoadTemplate(event.target.value)}
                      defaultValue=""
                    >
                      <option value="" disabled>
                        Cargar plantilla...
                      </option>
                      {currentProjectWorkflowTemplates.length > 0 && (
                        <optgroup label="Este proyecto">
                          {currentProjectWorkflowTemplates.map((template) => (
                            <option key={template.id} value={template.id}>
                              {template.name || "Plantilla sin nombre"}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {sharedWorkflowTemplates.length > 0 && (
                        <optgroup label="Organizaciones asignadas">
                          {sharedWorkflowTemplates.map((template) => (
                            <option key={template.id} value={template.id}>
                              {template.name || "Plantilla sin nombre"} · {getWorkflowTemplateScopeLabel(template, projectId)}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  )}
                  {workflowSteps.length > 0 && (
                    <Button
                      type="button"
                      onClick={() => setShowTemplateModal(true)}
                      size="sm"
                      variant="outline"
                      className="h-9 shrink-0 rounded-lg border-indigo-200 px-3 text-xs text-indigo-600 hover:bg-indigo-50"
                    >
                      <ClipboardList size={14} className="mr-1" />
                      {isStateWorkflow ? "Guardar procedimiento" : "Guardar workflow"}
                    </Button>
                  )}
                  <Button
                    type="button"
                    onClick={addStep}
                    size="sm"
                    variant="outline"
                    className="h-9 shrink-0 rounded-lg border-indigo-200 px-3 text-xs font-bold text-indigo-600 hover:bg-indigo-50"
                  >
                    <Plus size={14} className="mr-1" />
                    Agregar paso
                  </Button>
                </div>
              </div>

              {workflowSteps.length > 0 && (
                <div className="mb-4">
                  {isSavingWorkflowView && (
                    <p className="mb-2 text-xs font-bold text-indigo-600">Guardando vista del workflow...</p>
                  )}
                  <WorkflowRoutingBuilder
                    steps={workflowSteps}
                    rateCards={rateCards}
                    teamMembers={teamMembers}
                    projectId={projectId}
                    project={project}
                    allowAnyTarget={isVariableWorkflow}
                    linearOnly={isStateWorkflow}
                    onChange={(nextSteps) =>
                      setWorkflowSteps(
                        isStateWorkflow ? normalizeStateWorkflowSteps(nextSteps) : nextSteps,
                      )
                    }
                    onSaveView={(nextSteps) => handleSaveWorkflowView(nextSteps)}
                  />
                </div>
              )}

              <div className="space-y-3">
                {workflowSteps.map((step, index) => (
                  <div
                    key={`workflow-step-${index}`}
                    className="p-4 border border-slate-200 rounded-xl bg-slate-50/60"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                        {index + 1}
                      </div>
                      <div className="flex shrink-0 flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => moveStep(index, -1)}
                          disabled={index === 0 || (index === 1 && Boolean(step.isQualityGate))}
                          className="flex h-4 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-400 transition-colors hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-30"
                          title="Mover paso arriba"
                          aria-label={`Mover paso ${index + 1} arriba`}
                        >
                          <ArrowUp size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveStep(index, 1)}
                          disabled={index === workflowSteps.length - 1 || (index === 0 && Boolean(workflowSteps[1]?.isQualityGate))}
                          className="flex h-4 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-400 transition-colors hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-30"
                          title="Mover paso abajo"
                          aria-label={`Mover paso ${index + 1} abajo`}
                        >
                          <ArrowDown size={12} />
                        </button>
                      </div>
                      <input
                        type="text"
                        value={step.label}
                        onChange={(event) => updateStep(index, { label: event.target.value })}
                        className="flex-1 h-9 px-3 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                        placeholder="Nombre del paso"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setCurrentStepIndexForForm(index);
                          setIsFormBuilderOpen(true);
                        }}
                        className={`p-2 rounded-lg transition-colors ${
                          step.form
                            ? "text-indigo-600 bg-indigo-50 hover:bg-indigo-100"
                            : "text-slate-400 hover:text-indigo-600 hover:bg-white"
                        }`}
                        title={step.form ? "Editar formulario" : "Agregar formulario"}
                      >
                        <ClipboardList size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeStep(index)}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Eliminar paso"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 pl-10">
                      <div className="md:col-span-2 grid grid-cols-1 gap-2 rounded-lg border border-indigo-100 bg-indigo-50/60 p-3 md:grid-cols-[minmax(0,1fr)_140px] md:items-center">
                        <div>
                          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-indigo-600">
                            Duracion planificada
                          </label>
                          <p className="text-[10px] text-indigo-500">
                            {workflowDayCountingEnabled
                              ? "Se usa para calcular el inicio y fin automatico de este paso dentro del workflow."
                              : "Referencia estadistica: no modifica el periodo total mientras el conteo este inactivo."}
                          </p>
                        </div>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={step.plannedDurationDays ?? 1}
                          onChange={(event) => updateStep(index, { plannedDurationDays: Number(event.target.value) })}
                          className="h-9 w-full rounded-lg border border-indigo-100 bg-white px-3 text-sm font-semibold text-slate-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
                          aria-label={`Duracion del paso ${index + 1} en dias`}
                        />
                      </div>

                      <div>
                        <label className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          Responsable
                        </label>
                        <select
                          value={step.assignedTo || ""}
                          onChange={(event) => updateStep(index, { assignedTo: event.target.value })}
                          className="h-9 w-full px-3 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                        >
                          <option value="">Sin responsable fijo</option>
                          <option value="DYNAMIC">Asignacion dinamica</option>
                          {teamMembers.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.name || member.email}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          <CreditCard size={12} />
                          Rate Card del paso
                        </label>
                        <select
                          value={
                            step.dynamicRateCard
                              ? "__dynamic__"
                              : step.rateCardMode === "static" || getEditableStepRateCards(step).length > 0
                                ? "__static__"
                                : ""
                          }
                          onChange={(event) => updateStepRateCard(index, event.target.value)}
                          className="h-9 w-full px-3 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                        >
                          <option value="">Sin Rate Card</option>
                          <option value="__static__">Rate Cards fijos</option>
                          <option value="__dynamic__">Rate Card dinámico</option>
                        </select>
                      </div>

                      {step.dynamicRateCard && (
                        <div className="md:col-span-2 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                          <label className="flex items-center gap-2 text-xs font-medium text-emerald-700">
                            <input
                              type="checkbox"
                              checked={step.autoAddUnits !== false}
                              onChange={(event) => {
                                const autoAddUnits = event.target.checked;
                                updateStep(index, {
                                  autoAddUnits,
                                  dynamicRateCardConfig: step.dynamicRateCard
                                    ? {
                                        defaultUnits: normalizeRateCardUnits(step.unitsToAdd),
                                        requirePerson: true,
                                        requireRateCard: true,
                                        promptForUnits: !autoAddUnits,
                                      }
                                    : null,
                                });
                              }}
                              className="rounded border-emerald-200 text-emerald-600 focus:ring-emerald-500"
                            />
                            Sumar auto.
                          </label>
                          {step.autoAddUnits !== false && (
                            <input
                              type="text"
                              inputMode="decimal"
                              pattern="[0-9]*[.,]?[0-9]*"
                              value={step.unitsToAdd ?? 1}
                              onChange={(event) => {
                                const unitsToAdd = event.target.value;
                                updateStep(index, {
                                  unitsToAdd,
                                  dynamicRateCardConfig: step.dynamicRateCard
                                    ? {
                                        defaultUnits: normalizeRateCardUnits(unitsToAdd),
                                        requirePerson: true,
                                        requireRateCard: true,
                                        promptForUnits: step.autoAddUnits === false,
                                      }
                                    : null,
                                });
                              }}
                              className="h-8 w-24 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                              placeholder="Ej. 0,051"
                              title="Puedes usar coma o punto decimal. Ejemplo: 0,051 o 0.051"
                            />
                          )}
                          <span className="min-w-0 flex-1 text-[10px] text-slate-500">
                            {step.autoAddUnits === false
                              ? "Pedirá persona, perfil y unidades al aprobar."
                              : "Pedirá persona y perfil; sumará estas unidades."}
                          </span>
                          <span className="basis-full text-[10px] font-bold text-emerald-700">
                            Decimales: escribe 0,051 o 0.051; Pixel normaliza al guardar.
                          </span>
                        </div>
                      )}

                      {!step.dynamicRateCard && (step.rateCardMode === "static" || getEditableStepRateCards(step).length > 0) && (
                        <div className="md:col-span-2 space-y-2 rounded-lg border border-slate-200 bg-white px-3 py-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                              Indicadores del paso
                            </p>
                            <p className="text-[10px] font-bold text-slate-400">
                              Decimales: 0,051 o 0.051.
                            </p>
                            <button
                              type="button"
                              onClick={() => updateStepStaticRateCards(index, (currentCards) => [...currentCards, createStepRateCardItem()])}
                              className="inline-flex h-8 items-center gap-1 rounded-lg border border-indigo-100 bg-indigo-50 px-2 text-xs font-bold text-indigo-600 hover:bg-indigo-100"
                            >
                              <Plus size={13} />
                              Agregar
                            </button>
                          </div>

                          {getEditableStepRateCards(step).map((rateCardItem) => (
                            <div key={rateCardItem.id} className="space-y-2 rounded-lg border border-slate-100 bg-slate-50 p-2">
                              <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto_auto] md:items-center">
                                <select
                                  value={rateCardItem.rateCardId}
                                  onChange={(event) =>
                                    updateStepStaticRateCards(index, (currentCards) =>
                                      currentCards.map((item) =>
                                        item.id === rateCardItem.id ? { ...item, rateCardId: event.target.value } : item
                                      )
                                    )
                                  }
                                  className="h-9 min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                                >
                                  <option value="">Selecciona Rate Card</option>
                                  {rateCards.map((rateCard) => (
                                    <option key={rateCard.id} value={rateCard.id}>
                                      {rateCard.name}
                                    </option>
                                  ))}
                                </select>
                                <label
                                  className="flex h-9 items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 text-xs font-medium text-emerald-700"
                                  title="Si se desmarca, se le preguntará al usuario las unidades al completar el paso."
                                >
                                  <input
                                    type="checkbox"
                                    checked={rateCardItem.autoAddUnits !== false}
                                    onChange={(event) =>
                                      updateStepStaticRateCards(index, (currentCards) =>
                                        currentCards.map((item) =>
                                          item.id === rateCardItem.id
                                            ? { ...item, autoAddUnits: event.target.checked }
                                            : item
                                        )
                                      )
                                    }
                                    className="rounded border-emerald-200 text-emerald-600 focus:ring-emerald-500"
                                  />
                                  Sumar auto.
                                </label>
                                {rateCardItem.autoAddUnits !== false ? (
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    pattern="[0-9]*[.,]?[0-9]*"
                                    value={rateCardItem.unitsToAdd ?? 1}
                                    onChange={(event) =>
                                      updateStepStaticRateCards(index, (currentCards) =>
                                        currentCards.map((item) =>
                                          item.id === rateCardItem.id
                                            ? { ...item, unitsToAdd: event.target.value }
                                            : item
                                        )
                                      )
                                    }
                                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 md:w-24"
                                    placeholder="Ej. 0,051"
                                    title="Puedes usar coma o punto decimal. Ejemplo: 0,051 o 0.051"
                                  />
                                ) : (
                                  <span className="text-xs font-medium text-slate-400">
                                    Manual
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateStepStaticRateCards(index, (currentCards) =>
                                      currentCards.filter((item) => item.id !== rateCardItem.id)
                                    )
                                  }
                                  className="flex h-9 w-full items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 md:w-9"
                                  title="Quitar Rate Card"
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                              <div className="grid grid-cols-1 gap-2 md:grid-cols-[auto_minmax(0,1fr)] md:items-center">
                                <select
                                  value={rateCardItem.assigneeMode || (rateCardItem.assignToProfessional ? "fixed" : "default")}
                                  onChange={(event) => {
                                    const mode = event.target.value as "default" | "fixed" | "runtime";
                                    updateStepStaticRateCards(index, (currentCards) =>
                                      currentCards.map((item) =>
                                        item.id === rateCardItem.id
                                          ? {
                                              ...item,
                                              assigneeMode: mode,
                                              assignToProfessional: mode !== "default",
                                              assignedTo: mode === "fixed" ? item.assignedTo || "" : "",
                                            }
                                          : item
                                      )
                                    );
                                  }}
                                  className="h-9 rounded-lg border border-indigo-100 bg-indigo-50 px-3 text-xs font-medium text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                                >
                                  <option value="default">Responsable del paso</option>
                                  <option value="fixed">Profesional fijo</option>
                                  <option value="runtime">Pedir al ejecutar</option>
                                </select>
                                {(rateCardItem.assigneeMode || (rateCardItem.assignToProfessional ? "fixed" : "default")) === "fixed" && (
                                  <select
                                    value={rateCardItem.assignedTo || ""}
                                    onChange={(event) =>
                                      updateStepStaticRateCards(index, (currentCards) =>
                                        currentCards.map((item) =>
                                          item.id === rateCardItem.id ? { ...item, assignedTo: event.target.value } : item
                                        )
                                      )
                                    }
                                    className="h-9 min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                                  >
                                    <option value="">Selecciona profesional</option>
                                    {teamMembers.map((member) => (
                                      <option key={member.id} value={member.id}>
                                        {member.name || member.email}
                                      </option>
                                    ))}
                                  </select>
                                )}
                                {(rateCardItem.assigneeMode || (rateCardItem.assignToProfessional ? "fixed" : "default")) === "runtime" && (
                                  <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                                    Se solicitará el profesional al aprobar este paso.
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                          <p className="text-[10px] text-slate-500">
                            Al aprobar el paso se sumarán todos los indicadores configurados.
                          </p>
                        </div>
                      )}

                      {index < workflowSteps.length - 1 ? (
                        <label className="h-9 px-3 flex items-center gap-2 text-xs text-slate-600 border border-slate-200 rounded-lg bg-white cursor-pointer">
                          <input
                            type="checkbox"
                            checked={Boolean(step.assignsNextStep)}
                            onChange={(event) => {
                              updateStep(index, { assignsNextStep: event.target.checked });
                              if (event.target.checked) {
                                updateStep(index + 1, { assignedTo: "DYNAMIC" });
                              }
                            }}
                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          Este paso decide el responsable siguiente
                        </label>
                      ) : (
                        <div className="h-9 px-3 flex items-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-lg bg-white">
                          Ultimo paso del workflow
                        </div>
                      )}

                      <label className={`md:col-span-2 h-9 px-3 flex items-center gap-2 text-xs border rounded-lg ${
                        index === 0
                          ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
                          : "cursor-pointer border-amber-100 bg-amber-50 text-amber-800"
                      }`}>
                        <input
                          type="checkbox"
                          checked={index === 0 ? false : Boolean(step.isQualityGate)}
                          disabled={index === 0}
                          onChange={(event) => {
                            if (index === 0) return;
                            updateStep(index, { isQualityGate: event.target.checked });
                          }}
                          className="rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                        />
                        {index === 0 ? "El primer paso no puede ser control de calidad" : "Paso de control de calidad"}
                      </label>
                    </div>

                    {step.form && (
                      <div className="mt-3 ml-10 text-xs text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
                        Formulario: {step.form.title || "Sin titulo"} - {step.form.fields?.length || 0} campos
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : canManageSubtasks ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">Subtareas</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Crea y revisa entregables secundarios bajo esta tarea por estado.
                  </p>
                </div>
                <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-600 border border-indigo-100">
                  {subtasks.length} subtareas
                </span>
              </div>

              {subtasks.length > 0 ? (
                <div className="space-y-2">
                  {subtasks.map((subtask) => {
                    const assignee = teamMembers.find((member) => member.id === subtask.assignedTo);
                    return (
                      <div
                        key={subtask.id}
                        className="flex items-center gap-3 rounded-xl border border-indigo-100 bg-indigo-50/30 px-3 py-2"
                      >
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-indigo-500 border border-indigo-100">
                          <CornerDownRight size={14} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-700">
                            {getTaskTitle(subtask)}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {assignee?.name || "Sin responsable"} · {getStatusLabel(subtask.status)}
                          </p>
                          {subtask.type === "quantitative" && (
                            <p className="mt-1 truncate text-[10px] font-semibold text-emerald-600">
                              Incremental · meta {Number(subtask.indicatorValue || 0)} {subtask.indicator || "unidades"} · {getIncrementalRateBinding(subtask) ? "Rate Card" : "Manual"}
                            </p>
                          )}
                          <p className={`mt-1 truncate text-[10px] font-semibold ${
                            subtask.completionForm ? "text-indigo-600" : "text-slate-400"
                          }`}>
                            {getSubtaskCompletionFormSummary(subtask.completionForm)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSubtaskFormTarget({ mode: "existing", subtask })}
                          className={`rounded-lg p-2 transition-colors ${
                            subtask.completionForm
                              ? "bg-indigo-100 text-indigo-700 hover:bg-indigo-200"
                              : "bg-white text-slate-400 hover:bg-indigo-50 hover:text-indigo-600"
                          }`}
                          title={subtask.completionForm ? "Editar formulario de cierre" : "Agregar formulario de cierre"}
                          disabled={!onUpdateSubtaskCompletionForm}
                        >
                          <ClipboardList size={15} />
                        </button>
                        <span className="rounded bg-white px-2 py-1 text-[10px] font-bold uppercase text-indigo-500 border border-indigo-100">
                          Subtarea
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                  Esta tarea todavía no tiene subtareas.
                </div>
              )}

              <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-800">Nueva subtarea</h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                      {task.type === "quantitative"
                        ? "Puede tener su propia meta incremental y su propio Rate Card."
                        : "Se guardará como tarea por estado dependiente de esta tarea."}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSubtaskFormTarget({ mode: "draft" })}
                    className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${
                      subtaskDraft.completionForm
                        ? "border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                        : "border-slate-200 bg-white text-slate-500 hover:border-indigo-200 hover:text-indigo-600"
                    }`}
                  >
                    <ClipboardList size={14} />
                    Formulario de cierre
                  </button>
                </div>

                <input
                  type="text"
                  value={subtaskDraft.title}
                  onChange={(event) => updateSubtaskDraft({ title: event.target.value })}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                  placeholder="Nombre de la subtarea"
                />

                <textarea
                  value={subtaskDraft.description}
                  onChange={(event) => updateSubtaskDraft({ description: event.target.value })}
                  className="w-full min-h-[68px] p-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-xs resize-none"
                  placeholder="Descripción opcional"
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <select
                    value={subtaskDraft.assignedTo}
                    onChange={(event) => updateSubtaskDraft({ assignedTo: event.target.value })}
                    className="h-9 px-3 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-xs"
                  >
                    <option value="">Sin responsable</option>
                    {teamMembers.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name || member.email}
                      </option>
                    ))}
                  </select>

                  <select
                    value={subtaskDraft.priority}
                    onChange={(event) => updateSubtaskDraft({ priority: event.target.value })}
                    className="h-9 px-3 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-xs"
                  >
                    <option value="high">Prioridad alta</option>
                    <option value="medium">Prioridad media</option>
                    <option value="low">Prioridad baja</option>
                  </select>

                  <select
                    value={subtaskDraft.status}
                    onChange={(event) => updateSubtaskDraft({ status: event.target.value })}
                    className="h-9 px-3 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-xs"
                  >
                    <option value="todo">Pendiente</option>
                    <option value="in_progress">En curso</option>
                    <option value="stuck">Estancado</option>
                    <option value="completed">Listo</option>
                  </select>

                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      value={subtaskDraft.startDate}
                      onChange={(event) => updateSubtaskDraft({ startDate: event.target.value })}
                      className="h-9 px-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-xs"
                    />
                    <input
                      type="date"
                      value={subtaskDraft.endDate}
                      onChange={(event) => updateSubtaskDraft({ endDate: event.target.value })}
                      className="h-9 px-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-xs"
                    />
                  </div>
                </div>

                {task.type === "quantitative" && (
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 space-y-3">
                    <label className="flex items-center justify-between gap-3 text-xs font-bold text-emerald-800">
                      <span className="flex items-center gap-2">
                        <CreditCard size={14} />
                        Incremento individual de esta subtarea
                      </span>
                      <input
                        type="checkbox"
                        checked={Boolean(subtaskDraft.isIncremental)}
                        onChange={(event) => updateSubtaskDraft({ isIncremental: event.target.checked })}
                        className="h-4 w-4 rounded border-emerald-200 text-emerald-600 focus:ring-emerald-500"
                      />
                    </label>

                    {subtaskDraft.isIncremental && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                          <input
                            type="text"
                            value={subtaskDraft.incrementIndicator || ""}
                            onChange={(event) => updateSubtaskDraft({ incrementIndicator: event.target.value })}
                            className="h-9 px-3 rounded-lg border border-emerald-100 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-xs"
                            placeholder="Indicador ej. Predios"
                          />
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={subtaskDraft.incrementTarget ?? 1}
                            onChange={(event) => updateSubtaskDraft({ incrementTarget: Number(event.target.value) })}
                            className="h-9 px-3 rounded-lg border border-emerald-100 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-xs"
                            placeholder="Meta"
                          />
                          <select
                            value={subtaskDraft.incrementMode || "manual"}
                            onChange={(event) => updateSubtaskDraft({ incrementMode: event.target.value as "manual" | "rate_card" })}
                            className="h-9 px-3 rounded-lg border border-emerald-100 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-xs"
                          >
                            <option value="manual">Incremento manual</option>
                            <option value="rate_card">Auto por Rate Card</option>
                          </select>
                        </div>

                        {subtaskDraft.incrementMode === "rate_card" && (
                          <div className="space-y-2 rounded-lg border border-emerald-100 bg-white p-3">
                            <select
                              value={subtaskDraft.incrementRateCardId || ""}
                              onChange={(event) => updateSubtaskDraft({ incrementRateCardId: event.target.value })}
                              className="h-9 w-full px-3 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-xs"
                            >
                              <option value="">Selecciona Rate Card</option>
                              {rateCards.map((rateCard) => (
                                <option key={rateCard.id} value={rateCard.id}>
                                  {rateCard.name}
                                </option>
                              ))}
                            </select>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              <label className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-600">
                                <input
                                  type="checkbox"
                                  checked={Boolean(subtaskDraft.incrementFilterByAssignee)}
                                  onChange={(event) => updateSubtaskDraft({ incrementFilterByAssignee: event.target.checked })}
                                  className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                                />
                                Filtrar por persona
                              </label>
                              <label className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-600">
                                <input
                                  type="checkbox"
                                  checked={Boolean(subtaskDraft.incrementFilterByDate)}
                                  onChange={(event) => updateSubtaskDraft({ incrementFilterByDate: event.target.checked })}
                                  className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                                />
                                Filtrar por fechas
                              </label>
                            </div>
                            {subtaskDraft.incrementFilterByAssignee && (
                              <select
                                value={subtaskDraft.incrementAssigneeId || ""}
                                onChange={(event) => updateSubtaskDraft({ incrementAssigneeId: event.target.value })}
                                className="h-9 w-full px-3 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-xs"
                              >
                                <option value="">Selecciona persona</option>
                                {teamMembers.map((member) => (
                                  <option key={member.id} value={member.id}>
                                    {member.name || member.email}
                                  </option>
                                ))}
                              </select>
                            )}
                            {subtaskDraft.incrementFilterByDate && (
                              <div className="grid grid-cols-2 gap-2">
                                <input
                                  type="date"
                                  value={subtaskDraft.incrementStartDate || ""}
                                  onChange={(event) => updateSubtaskDraft({ incrementStartDate: event.target.value })}
                                  className="h-9 px-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-xs"
                                />
                                <input
                                  type="date"
                                  value={subtaskDraft.incrementEndDate || ""}
                                  onChange={(event) => updateSubtaskDraft({ incrementEndDate: event.target.value })}
                                  className="h-9 px-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-xs"
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className={`rounded-lg border px-3 py-2 text-[11px] font-semibold ${
                  subtaskDraft.completionForm
                    ? "border-indigo-100 bg-indigo-50 text-indigo-700"
                    : "border-slate-100 bg-slate-50 text-slate-400"
                }`}>
                  {getSubtaskCompletionFormSummary(subtaskDraft.completionForm)}
                </div>

                <div className="flex justify-end">
                  <Button
                    type="button"
                    onClick={handleCreateSubtask}
                    disabled={isCreatingSubtask}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white"
                  >
                    {isCreatingSubtask ? (
                      <>
                        <Loader2 size={16} className="mr-2 animate-spin" />
                        Creando...
                      </>
                    ) : (
                      <>
                        <Plus size={16} className="mr-2" />
                        Crear subtarea
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
              Esta tarea no tiene pasos de workflow.
            </div>
          )}
        </div>

        <div className="p-6 border-t border-slate-100 flex justify-end gap-3 bg-slate-50 rounded-b-2xl">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            {canEditTaskStructure ? "Cancelar" : "Cerrar"}
          </Button>
          {canEditTaskStructure && (
            <Button
              onClick={handleSave}
              disabled={isSaving}
              className="bg-indigo-600 hover:bg-indigo-700 text-white min-w-[150px]"
            >
              {isSaving ? (
                <>
                  <Loader2 size={16} className="mr-2 animate-spin" />
                  Guardando...
                </>
              ) : (
                "Guardar cambios"
              )}
            </Button>
          )}
        </div>
      </div>

      {isFormBuilderOpen && currentStepIndexForForm !== null && (
        <WorkflowStepFormBuilderModal
          isOpen={isFormBuilderOpen}
          onClose={() => {
            setIsFormBuilderOpen(false);
            setCurrentStepIndexForForm(null);
          }}
          stepName={workflowSteps[currentStepIndexForForm]?.label || `Paso ${currentStepIndexForForm + 1}`}
          initialForm={workflowSteps[currentStepIndexForForm]?.form}
          rateCards={rateCards}
          teamMembers={teamMembers}
          projectId={projectId}
          project={project}
          onSave={(form) => {
            if (currentStepIndexForForm === null) return;
            updateStep(currentStepIndexForForm, { form });
          }}
        />
      )}

      {subtaskFormTarget && (
        <WorkflowStepFormBuilderModal
          isOpen={Boolean(subtaskFormTarget)}
          onClose={() => {
            if (isUpdatingSubtaskForm) return;
            setSubtaskFormTarget(null);
          }}
          stepName={
            subtaskFormTarget.mode === "existing"
              ? getTaskTitle(subtaskFormTarget.subtask)
              : subtaskDraft.title || "Nueva subtarea"
          }
          initialForm={
            subtaskFormTarget.mode === "existing"
              ? subtaskFormTarget.subtask?.completionForm
              : subtaskDraft.completionForm
          }
          rateCards={rateCards}
          teamMembers={teamMembers}
          projectId={projectId}
          project={project}
          onSave={handleSaveSubtaskCompletionForm}
        />
      )}

      {showTemplateModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <ClipboardList className="text-indigo-600" size={24} />
                Guardar Workflow
              </h2>
              <button
                onClick={() => setShowTemplateModal(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
                disabled={isSavingTemplate}
              >
                <X size={24} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-sm font-bold text-slate-700 mb-1 block">
                  Nombre de la plantilla
                </label>
                <input
                  type="text"
                  value={templateName}
                  onChange={(event) => setTemplateName(event.target.value)}
                  placeholder="Ej. Flujo de aprobación estándar"
                  className="w-full h-11 px-4 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                  autoFocus
                />
              </div>
              <p className="text-xs text-slate-500">
                Si usas el nombre de una plantilla existente, se pedirá confirmación para reescribirla.
              </p>
              {canManageWorkflowTemplates && currentProjectWorkflowTemplates.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                    Plantillas del proyecto
                  </p>
                  <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
                    {currentProjectWorkflowTemplates.map((template) => (
                      <div key={template.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                        <button
                          type="button"
                          onClick={() => setTemplateName(template.name || "")}
                          className="min-w-0 truncate text-left text-sm font-medium text-slate-700 hover:text-indigo-700"
                          title={template.name || "Plantilla"}
                        >
                          {template.name || "Plantilla sin nombre"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteTemplate(template.id, template.name || "Plantilla")}
                          className="shrink-0 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                          aria-label={`Eliminar plantilla ${template.name || ""}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowTemplateModal(false)}
                className="text-slate-600 hover:bg-slate-200 rounded-xl"
                disabled={isSavingTemplate}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={handleSaveTemplate}
                disabled={isSavingTemplate || !templateName.trim()}
                className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-md shadow-indigo-200"
              >
                {isSavingTemplate ? (
                  <>
                    <Loader2 size={16} className="animate-spin mr-2" />
                    Guardando...
                  </>
                ) : (
                  "Guardar"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
