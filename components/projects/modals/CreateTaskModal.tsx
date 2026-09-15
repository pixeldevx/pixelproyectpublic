import React, { useState } from 'react';
import { X, ListTodo, Plus, ClipboardList, CreditCard, Loader2, Trash2, CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { doc, collection, addDoc, writeBatch, serverTimestamp, updateDoc, deleteDoc } from '@/lib/supabase/document-store';
import { db } from '@/lib/backend';
import { toast } from 'sonner';
import { WorkflowStepFormBuilderModal, CustomForm, FormRateCardItem } from '@/components/projects/WorkflowStepFormBuilderModal';
import { WorkflowRoutingBuilder } from '@/components/projects/WorkflowRoutingBuilder';
import { notifyTaskAssignment, TaskAssignmentNotificationPayload } from '@/lib/notifications';
import {
  getWorkflowTemplateScopeData,
  getWorkflowTemplateScopeLabel,
  loadWorkflowTemplatesForScope,
} from '@/lib/workflow-templates';
import { getStaticRateCardAssignmentKey, isInvalidRateCardUnits, normalizeRateCardUnits } from '@/lib/rate-card-config';
import { addTraceableRateCardMovementToBatch } from '@/lib/rate-card-trace';
import { syncRateDrivenIncrementalTasksForRate } from '@/lib/incremental-rate-tasks';
import {
  applyWorkflowStepReferenceDurations,
  applyWorkflowStepSchedule,
  getWorkflowStepPlannedDuration,
  getWorkflowTotalPlannedDays,
  normalizeWorkflowDayCountingEnabled,
  normalizeWorkflowScheduleMode,
  type WorkflowScheduleMode,
} from '@/lib/workflow-schedule';
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
} from '@/lib/workflow-routing';

const DEFAULT_TASK_GROUP_ID = '__ungrouped__';
const DEFAULT_TASK_GROUP_NAME = 'Sin grupo';
type TaskType = "quantitative" | "state" | "state_workflow" | "workflow" | "workflow_variable" | "meeting";
type MeetingRecurrenceFrequency = "none" | "daily" | "weekly" | "monthly";

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

interface CreateTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  project: any;
  user: any;
  teamMembers: any[];
  rateCards: any[];
  taskGroups?: any[];
  tasksLength: number;
  canManageWorkflowTemplates?: boolean;
  userRole?: string | null;
  templateScopeOrganizationIds?: string[];
}

type DraftSubtask = {
  id: string;
  title: string;
  description: string;
  assignedTo: string;
  startDate: string;
  endDate: string;
  priority: string;
  status: string;
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

const createDraftSubtask = (
  defaults: Partial<DraftSubtask> = {},
): DraftSubtask => ({
  id: `subtask_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  title: "",
  description: "",
  assignedTo: defaults.assignedTo || "",
  startDate: defaults.startDate || "",
  endDate: defaults.endDate || "",
  priority: defaults.priority || "medium",
  status: defaults.status || "todo",
  isIncremental: defaults.isIncremental || false,
  incrementIndicator: defaults.incrementIndicator || "",
  incrementTarget: defaults.incrementTarget || 1,
  incrementMode: defaults.incrementMode || "manual",
  incrementRateCardId: defaults.incrementRateCardId || "",
  incrementFilterByAssignee: defaults.incrementFilterByAssignee || false,
  incrementAssigneeId: defaults.incrementAssigneeId || "",
  incrementFilterByDate: defaults.incrementFilterByDate || false,
  incrementStartDate: defaults.incrementStartDate || "",
  incrementEndDate: defaults.incrementEndDate || "",
  ...defaults,
});

export function CreateTaskModal({
  isOpen,
  onClose,
  projectId,
  project,
  user,
  teamMembers,
  rateCards,
  taskGroups = [],
  tasksLength,
  canManageWorkflowTemplates = false,
  userRole,
  templateScopeOrganizationIds = [],
}: CreateTaskModalProps) {
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDesc, setNewTaskDesc] = useState("");
  const [newTaskStart, setNewTaskStart] = useState("");
  const [newTaskEnd, setNewTaskEnd] = useState("");
  const [newTaskAssignedTo, setNewTaskAssignedTo] = useState("");
  const [newTaskIndicator, setNewTaskIndicator] = useState("");
  const [newTaskIndicatorValue, setNewTaskIndicatorValue] = useState(0);
  const [newTaskProgress, setNewTaskProgress] = useState(0);
  const [newTaskStatus, setNewTaskStatus] = useState("todo");
  const [newTaskType, setNewTaskType] = useState<
    TaskType
  >("workflow");
  const [meetingStartTime, setMeetingStartTime] = useState("09:00");
  const [meetingEndTime, setMeetingEndTime] = useState("10:00");
  const [meetingLocation, setMeetingLocation] = useState("");
  const [meetingAgenda, setMeetingAgenda] = useState("");
  const [meetingRecurrence, setMeetingRecurrence] =
    useState<MeetingRecurrenceFrequency>("none");
  const [meetingRecurrenceInterval, setMeetingRecurrenceInterval] = useState(1);
  const [meetingAttendeeIds, setMeetingAttendeeIds] = useState<string[]>([]);
  const [workflowSteps, setWorkflowSteps] = useState<
    {
      assignedTo: string;
      label: string;
      form?: CustomForm;
      rateCardMode?: "static" | "dynamic";
      dynamicRateCard?: boolean;
      dynamicRateCardConfig?: {
        defaultUnits: number;
        requirePerson: boolean;
        requireRateCard: boolean;
        promptForUnits?: boolean;
      } | null;
      rateCards?: FormRateCardItem[];
      rateCardId?: string;
      unitsToAdd?: number | string;
      autoAddUnits?: boolean;
      assignsNextStep?: boolean;
      isQualityGate?: boolean;
      plannedDurationDays?: number;
      conditionalRoutes?: WorkflowConditionalRoute[];
      parallelRoutes?: WorkflowParallelRoute[];
      finishWorkflowOnComplete?: boolean;
      decisionNodeEnabled?: boolean;
      parallelNodeEnabled?: boolean;
      decisionPosition?: { x: number; y: number } | null;
      parallelPosition?: { x: number; y: number } | null;
      workflowCompletePosition?: { x: number; y: number } | null;
      visualPosition?: { x: number; y: number } | null;
      disableImplicitLinearRoute?: boolean;
      defaultNextStepIndex?: WorkflowRouteTarget;
    }[]
  >([]);
  const [workflowScheduleMode, setWorkflowScheduleMode] = useState<WorkflowScheduleMode>("calendar");
  const [workflowDayCountingEnabled, setWorkflowDayCountingEnabled] = useState(true);
  const [isFormBuilderOpen, setIsFormBuilderOpen] = useState(false);
  const [currentStepIndexForForm, setCurrentStepIndexForForm] = useState<
    number | null
  >(null);
  const [workflowCycles, setWorkflowCycles] = useState<number>(1);
  const [newTaskRequiresDoc, setNewTaskRequiresDoc] = useState(false);
  const [newTaskIsRateCard, setNewTaskIsRateCard] = useState(false);
  const [newTaskRateCardMode, setNewTaskRateCardMode] = useState<
    "static" | "dynamic"
  >("static");
  const [newTaskDynamicAutoAddUnits, setNewTaskDynamicAutoAddUnits] =
    useState(true);
  const [newTaskRateCardId, setNewTaskRateCardId] = useState("");
  const [newTaskUnitsToAdd, setNewTaskUnitsToAdd] = useState("1");
  const [newTaskPriority, setNewTaskPriority] = useState("medium");
  const [newTaskGroupId, setNewTaskGroupId] = useState("");
  const [draftSubtasks, setDraftSubtasks] = useState<DraftSubtask[]>([]);
  const [isSubtaskFormBuilderOpen, setIsSubtaskFormBuilderOpen] = useState(false);
  const [currentSubtaskIndexForForm, setCurrentSubtaskIndexForForm] = useState<number | null>(null);
  const [incrementForm, setIncrementForm] = useState<CustomForm | undefined>(
    undefined,
  );
  const [isIncrementFormBuilderOpen, setIsIncrementFormBuilderOpen] =
    useState(false);
  const [incrementRateBindingEnabled, setIncrementRateBindingEnabled] =
    useState(false);
  const [incrementRateCardId, setIncrementRateCardId] = useState("");
  const [incrementRateFilterByAssignee, setIncrementRateFilterByAssignee] =
    useState(false);
  const [incrementRateAssigneeId, setIncrementRateAssigneeId] = useState("");
  const [incrementRateFilterByDate, setIncrementRateFilterByDate] =
    useState(false);
  const [incrementRateStartDate, setIncrementRateStartDate] = useState("");
  const [incrementRateEndDate, setIncrementRateEndDate] = useState("");

  const [workflowTemplates, setWorkflowTemplates] = useState<any[]>([]);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const templateScopeOrganizationKey = templateScopeOrganizationIds.join("|");
  const quantitativeDelegatesToSubtasks =
    newTaskType === "quantitative" && draftSubtasks.length > 0;

  React.useEffect(() => {
    if (isOpen) {
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
          console.error("Error fetching templates:", error);
        }
      };
      fetchTemplates();
    }
  }, [isOpen, projectId, project, userRole, templateScopeOrganizationKey]);

  const currentProjectWorkflowTemplates = React.useMemo(
    () => workflowTemplates.filter((template) => template.projectId === projectId),
    [projectId, workflowTemplates]
  );
  const sharedWorkflowTemplates = React.useMemo(
    () => workflowTemplates.filter((template) => template.projectId !== projectId),
    [projectId, workflowTemplates]
  );
  const defaultTaskGroupName =
    taskGroups.find((group) => group.id === DEFAULT_TASK_GROUP_ID)?.name || DEFAULT_TASK_GROUP_NAME;
  const assignableTaskGroups = taskGroups.filter((group) => group.id !== DEFAULT_TASK_GROUP_ID);
  const taskTypeLabel: Record<TaskType, string> = {
    workflow: "Workflow",
    workflow_variable: "Workflow variable",
    state_workflow: "Por estado procedimental",
    quantitative: "Cuantitativa",
    state: "Estado simple",
    meeting: "Reunion",
  };
  const isWorkflowTypeSelected = isWorkflowTaskType(newTaskType);
  const isVariableWorkflowSelected = isVariableWorkflowTaskType(newTaskType);
  const isStateWorkflowSelected = isStateWorkflowTaskType(newTaskType);
  const projectMembers = teamMembers.filter(Boolean);
  const toggleMeetingAttendee = (attendeeId: string) => {
    setMeetingAttendeeIds((currentIds) =>
      currentIds.includes(attendeeId)
        ? currentIds.filter((id) => id !== attendeeId)
        : [...currentIds, attendeeId],
    );
  };

  if (!isOpen) return null;

  const resetForm = () => {
    setNewTaskTitle("");
    setNewTaskDesc("");
    setNewTaskStart("");
    setNewTaskEnd("");
    setNewTaskAssignedTo("");
    setNewTaskIndicator("");
    setNewTaskIndicatorValue(0);
    setNewTaskProgress(0);
    setNewTaskStatus("todo");
    setNewTaskPriority("medium");
    setNewTaskGroupId("");
    setNewTaskType("quantitative");
    setWorkflowSteps([]);
    setWorkflowScheduleMode("calendar");
    setWorkflowDayCountingEnabled(true);
    setWorkflowCycles(1);
    setNewTaskRequiresDoc(false);
    setNewTaskIsRateCard(false);
    setNewTaskRateCardMode("static");
    setNewTaskDynamicAutoAddUnits(true);
    setNewTaskRateCardId("");
    setNewTaskUnitsToAdd("1");
    setDraftSubtasks([]);
    setIsSubtaskFormBuilderOpen(false);
    setCurrentSubtaskIndexForForm(null);
    setIncrementForm(undefined);
    setIsIncrementFormBuilderOpen(false);
    setIncrementRateBindingEnabled(false);
    setIncrementRateCardId("");
    setIncrementRateFilterByAssignee(false);
    setIncrementRateAssigneeId("");
    setIncrementRateFilterByDate(false);
    setIncrementRateStartDate("");
    setIncrementRateEndDate("");
    setMeetingStartTime("09:00");
    setMeetingEndTime("10:00");
    setMeetingLocation("");
    setMeetingAgenda("");
    setMeetingRecurrence("none");
    setMeetingRecurrenceInterval(1);
    setMeetingAttendeeIds([]);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const normalizeTemplateName = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

  const sanitizeWorkflowSteps = (steps: typeof workflowSteps) => {
    const cleanSteps = steps.map((step, index) => {
      const staticRateCards = step.dynamicRateCard ? [] : cleanStepRateCards(step);
      const firstRateCard = staticRateCards[0];

      return {
        ...step,
        isQualityGate: index === 0 ? false : step.isQualityGate,
        plannedDurationDays: getWorkflowStepPlannedDuration(step),
        rateCards: staticRateCards,
        rateCardMode: step.dynamicRateCard
          ? ("dynamic" as const)
          : staticRateCards.length > 0
            ? ("static" as const)
            : undefined,
        dynamicRateCard: Boolean(step.dynamicRateCard),
        dynamicRateCardConfig: step.dynamicRateCard
          ? {
              defaultUnits: normalizeRateCardUnits(step.unitsToAdd ?? step.dynamicRateCardConfig?.defaultUnits),
              requirePerson: true,
              requireRateCard: true,
              promptForUnits: step.autoAddUnits === false,
            }
          : null,
        rateCardId: firstRateCard?.rateCardId || undefined,
        unitsToAdd: step.dynamicRateCard
          ? normalizeRateCardUnits(step.unitsToAdd)
          : firstRateCard
            ? firstRateCard.unitsToAdd
            : undefined,
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
        parallelRoutes: normalizeWorkflowParallelRoutes(step.parallelRoutes || (step as any).parallelNextStepIndexes || []).map((route) => ({
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
          steps.length
        ) ?? null,
      };
    });

    return isStateWorkflowSelected
      ? normalizeStateWorkflowSteps(cleanSteps)
      : cleanSteps;
  };

  const validateWorkflowSteps = () => {
    if (!isWorkflowTypeSelected) return true;

    if (workflowSteps.length === 0) {
      toast.warning("Agrega al menos un paso para el workflow.");
      return false;
    }

    if (workflowSteps.some((step) => !step.label.trim())) {
      toast.warning("Todos los pasos del workflow deben tener nombre.");
      return false;
    }

    if (workflowSteps[0]?.isQualityGate) {
      toast.warning("El primer paso no puede ser control de calidad; debe existir un paso anterior que envíe a revisión.");
      return false;
    }

    const hasStaticStepWithoutRateCard = workflowSteps.some(
      (step) => step.rateCardMode === "static" && cleanStepRateCards(step).length === 0
    );
    if (hasStaticStepWithoutRateCard) {
      toast.warning("Agrega al menos un Rate Card fijo en cada paso configurado.");
      return false;
    }

    const hasInvalidStepUnits = workflowSteps.some((step) => {
      if (step.dynamicRateCard) return isInvalidRateCardUnits(step.unitsToAdd);
      return cleanStepRateCards(step).some((item) => isInvalidRateCardUnits(item.unitsToAdd));
    });
    if (hasInvalidStepUnits) {
      toast.warning("Define unidades de Rate Card en cero o mayores en los pasos.");
      return false;
    }

    const hasMissingStepRateCardAssignee = workflowSteps.some((step) =>
      cleanStepRateCards(step).some((item) => item.assigneeMode === "fixed" && !item.assignedTo)
    );
    if (hasMissingStepRateCardAssignee) {
      toast.warning("Selecciona el profesional para cada Rate Card fijo asignable.");
      return false;
    }

    const hasDuplicatedStaticRateCardAssignments = workflowSteps.some((step) => {
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

    const hasInvalidDuration = workflowSteps.some(
      (step) => !Number.isFinite(Number(step.plannedDurationDays ?? 1)) || Number(step.plannedDurationDays ?? 1) <= 0
    );
    if (hasInvalidDuration) {
      toast.warning("Cada paso del workflow debe tener una duración mayor a cero días.");
      return false;
    }

    const hasInvalidConditionalRoute = workflowSteps.some((step, stepIndex) =>
      normalizeWorkflowRoutes(step.conditionalRoutes || []).some((route) => {
        const target = normalizeWorkflowDefaultTarget(route.targetStepIndex, stepIndex, workflowSteps.length);
        if (!route.fieldId || target === undefined || target === null) return true;
        return routeOperatorNeedsValue(route.operator) && !String(route.value || "").trim();
      })
    );
    if (hasInvalidConditionalRoute) {
      toast.warning("Completa las condiciones del workflow: variable, valor y destino.");
      return false;
    }

    const hasInvalidParallelRoute = workflowSteps.some((step, stepIndex) =>
      normalizeWorkflowParallelRoutes(step.parallelRoutes || []).some((route) => {
        const target = normalizeWorkflowDefaultTarget(route.targetStepIndex, stepIndex, workflowSteps.length);
        return typeof target !== "number";
      })
    );
    if (hasInvalidParallelRoute) {
      toast.warning("Hay una rama paralela sin destino válido. Reconexiona esa rama antes de guardar.");
      return false;
    }

    return true;
  };

  const handleSaveTemplate = async () => {
    const cleanTemplateName = templateName.trim().replace(/\s+/g, " ");
    if (!cleanTemplateName || workflowSteps.length === 0) {
      toast.warning("Ingresa un nombre y asegúrate de tener pasos definidos.");
      return;
    }

    if (!validateWorkflowSteps()) return;

    setIsSavingTemplate(true);
    try {
      const existingTemplate = currentProjectWorkflowTemplates.find(
        (template) =>
          normalizeTemplateName(template.name || "") === normalizeTemplateName(cleanTemplateName)
      );
      const newTemplate = {
        name: cleanTemplateName,
        ...getWorkflowTemplateScopeData(projectId, project),
        steps: sanitizeWorkflowSteps(workflowSteps),
        workflowScheduleMode,
        workflowDayCountingEnabled,
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid || "unknown",
      };

      if (existingTemplate) {
        const confirmed = window.confirm(`Ya existe la plantilla "${existingTemplate.name}". ¿Quieres reescribirla con el workflow actual?`);
        if (!confirmed) return;

        await updateDoc(doc(db, "workflow_templates", existingTemplate.id), newTemplate);
        setWorkflowTemplates((currentTemplates) =>
          currentTemplates
            .map((template) =>
              template.id === existingTemplate.id
                ? { ...template, ...newTemplate }
                : template
            )
            .sort((left: any, right: any) => String(left.name || "").localeCompare(String(right.name || "")))
        );
        toast.success("Plantilla reescrita correctamente.");
      } else {
        const templateToCreate = {
          ...newTemplate,
          createdAt: serverTimestamp(),
          createdBy: user?.uid || "unknown",
        };
        const docRef = await addDoc(
          collection(db, "workflow_templates"),
          templateToCreate,
        );
        setWorkflowTemplates((currentTemplates) =>
          [
            ...currentTemplates,
            { id: docRef.id, ...templateToCreate },
          ].sort((left: any, right: any) => String(left.name || "").localeCompare(String(right.name || "")))
        );
        toast.success("Plantilla guardada correctamente.");
      }

      setShowTemplateModal(false);
      setTemplateName("");
    } catch (error: any) {
      console.error("Error saving template:", error);
      toast.error("Error al guardar la plantilla.");
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
    const template = workflowTemplates.find((t) => t.id === templateId);
    if (template && template.steps) {
      const loadedSteps = sanitizeWorkflowSteps(template.steps);
      setWorkflowSteps(loadedSteps);
      setWorkflowScheduleMode(normalizeWorkflowScheduleMode(template.workflowScheduleMode));
      setWorkflowDayCountingEnabled(normalizeWorkflowDayCountingEnabled(template.workflowDayCountingEnabled));
      if (template.steps[0]?.isQualityGate) {
        toast.warning("Se desmarcó calidad del primer paso porque necesita un paso anterior.");
      }
      toast.success("Plantilla cargada.");
    }
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
          rateCardMode: nextCards.length > 0 ? "static" : undefined,
          dynamicRateCard: false,
          dynamicRateCardConfig: null,
          rateCards: nextCards,
          rateCardId: firstRateCard?.rateCardId || undefined,
          unitsToAdd: firstRateCard ? firstRateCard.unitsToAdd : undefined,
          autoAddUnits: firstRateCard ? firstRateCard.autoAddUnits !== false : true,
        };
      })
    );
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const meetingParticipantIds = Array.from(new Set([newTaskAssignedTo, ...meetingAttendeeIds].filter(Boolean)));
    if (
      !user ||
      !newTaskTitle.trim() ||
      !newTaskStart ||
      !newTaskEnd ||
      (newTaskType === "meeting" ? meetingParticipantIds.length === 0 : !newTaskAssignedTo)
    ) {
      toast.warning("Por favor completa todos los campos obligatorios.");
      return;
    }

    if (draftSubtasks.some((subtask) => !subtask.title.trim())) {
      toast.warning("Completa el nombre de cada subtarea o elimínala.");
      return;
    }

    if (newTaskType === "quantitative") {
      const invalidIncrementalSubtask = draftSubtasks.find((subtask) => {
        if (!subtask.isIncremental) return false;
        if (!String(subtask.incrementIndicator || "").trim()) return true;
        if (Number(subtask.incrementTarget || 0) <= 0) return true;
        if (subtask.incrementMode === "rate_card" && !subtask.incrementRateCardId) return true;
        if (subtask.incrementMode === "rate_card" && subtask.incrementFilterByAssignee && !subtask.incrementAssigneeId) return true;
        if (subtask.incrementMode === "rate_card" && subtask.incrementFilterByDate) {
          if (!subtask.incrementStartDate || !subtask.incrementEndDate) return true;
          return new Date(`${subtask.incrementStartDate}T00:00:00`).getTime() > new Date(`${subtask.incrementEndDate}T23:59:59`).getTime();
        }
        return false;
      });

      if (invalidIncrementalSubtask) {
        toast.warning("Revisa la configuración incremental de cada subtarea: indicador, meta, Rate Card y filtros.");
        return;
      }
    }

    if (newTaskType === "quantitative" && !quantitativeDelegatesToSubtasks && Number(newTaskIndicatorValue) <= 0) {
      toast.warning("Define una meta mayor a cero para la tarea cuantitativa.");
      return;
    }

    if (newTaskType === "quantitative" && !quantitativeDelegatesToSubtasks && incrementRateBindingEnabled && !incrementRateCardId) {
      toast.warning("Selecciona el Rate Card que gobernará el avance incremental.");
      return;
    }

    if (newTaskType === "quantitative" && !quantitativeDelegatesToSubtasks && incrementRateBindingEnabled && incrementRateFilterByAssignee && !incrementRateAssigneeId) {
      toast.warning("Selecciona la persona que debe generar el Rate Card para contar el avance.");
      return;
    }

    if (newTaskType === "quantitative" && !quantitativeDelegatesToSubtasks && incrementRateBindingEnabled && incrementRateFilterByDate) {
      if (!incrementRateStartDate || !incrementRateEndDate) {
        toast.warning("Define fecha inicial y final para el filtro del Rate Card incremental.");
        return;
      }

      if (new Date(`${incrementRateStartDate}T00:00:00`).getTime() > new Date(`${incrementRateEndDate}T23:59:59`).getTime()) {
        toast.warning("La fecha inicial del filtro no puede ser posterior a la fecha final.");
        return;
      }
    }

    if (newTaskType === "meeting") {
      const meetingStart = new Date(`${newTaskStart}T${meetingStartTime || "00:00"}:00`);
      const meetingEnd = new Date(`${newTaskStart}T${meetingEndTime || "00:00"}:00`);
      const scheduleEnd = new Date(`${newTaskEnd}T23:59:59`);

      if (!meetingStartTime || !meetingEndTime) {
        toast.warning("Define hora de inicio y fin para la reunion.");
        return;
      }

      if (Number.isNaN(meetingStart.getTime()) || Number.isNaN(meetingEnd.getTime()) || meetingEnd.getTime() <= meetingStart.getTime()) {
        toast.warning("La hora de fin de la reunion debe ser posterior a la hora de inicio.");
        return;
      }

      if (meetingRecurrence !== "none" && scheduleEnd.getTime() < meetingStart.getTime()) {
        toast.warning("La fecha fin debe ser posterior o igual a la primera reunion recurrente.");
        return;
      }

      if (meetingRecurrence !== "none" && Number(meetingRecurrenceInterval) <= 0) {
        toast.warning("La repeticion debe tener un intervalo mayor a cero.");
        return;
      }
    }

    if (!quantitativeDelegatesToSubtasks && newTaskIsRateCard && newTaskRateCardMode === "static" && !newTaskRateCardId) {
      toast.warning("Selecciona el perfil de Rate Card que se va a afectar.");
      return;
    }

    if (!quantitativeDelegatesToSubtasks && newTaskIsRateCard && isInvalidRateCardUnits(newTaskUnitsToAdd)) {
      toast.warning("Define unidades de Rate Card en cero o mayores.");
      return;
    }

    if (!validateWorkflowSteps()) return;

    setIsCreatingTask(true);

    try {
      const taskTitle = newTaskTitle.trim();
      const parentStartDate = new Date(newTaskStart + "T00:00:00");
      const parentEndDate = new Date(newTaskEnd + "T00:00:00");
      const cleanWorkflowSteps = isWorkflowTypeSelected ? sanitizeWorkflowSteps(workflowSteps) : [];
      const effectiveWorkflowCycles = isStateWorkflowSelected ? 1 : workflowCycles;
      const workflowSchedule =
        isWorkflowTypeSelected && workflowDayCountingEnabled
          ? applyWorkflowStepSchedule(cleanWorkflowSteps, parentStartDate, workflowScheduleMode)
          : null;
      const workflowReferenceSteps =
        isWorkflowTypeSelected ? applyWorkflowStepReferenceDurations(cleanWorkflowSteps) : [];
      const effectiveParentStartDate = workflowSchedule?.workflowStartDate || parentStartDate;
      const effectiveParentEndDate = workflowSchedule?.workflowEndDate || parentEndDate;
      const meetingStartAt = new Date(`${newTaskStart}T${meetingStartTime || "09:00"}:00`);
      const meetingEndAt = new Date(`${newTaskStart}T${meetingEndTime || "10:00"}:00`);
      const meetingAttendees = meetingParticipantIds
        .map((memberId) => {
          const member = teamMembers.find((candidate) => candidate.id === memberId);
          return member
            ? {
                id: member.id,
                name: member.name || member.email || "Participante",
                email: member.email || "",
              }
            : null;
        })
        .filter(Boolean);
      const usesStaticRateCard =
        newTaskIsRateCard && newTaskRateCardMode === "static" && !quantitativeDelegatesToSubtasks;
      const usesDynamicRateCard =
        newTaskIsRateCard && newTaskRateCardMode === "dynamic" && !quantitativeDelegatesToSubtasks;
      const taskUsesDirectRateCard = newTaskIsRateCard && !quantitativeDelegatesToSubtasks;
      const incrementalRateBinding =
        newTaskType === "quantitative" && !quantitativeDelegatesToSubtasks && incrementRateBindingEnabled
          ? {
              enabled: true,
              rateCardId: incrementRateCardId,
              assigneeMode: incrementRateFilterByAssignee ? "fixed" : "any",
              assignedTo: incrementRateFilterByAssignee ? incrementRateAssigneeId : null,
              dateMode: incrementRateFilterByDate ? "range" : "any",
              startDate: incrementRateFilterByDate ? new Date(`${incrementRateStartDate}T00:00:00`) : null,
              endDate: incrementRateFilterByDate ? new Date(`${incrementRateEndDate}T23:59:59`) : null,
            }
          : null;
      const taskData: any = {
        projectId: projectId,
        title: taskTitle,
        name: taskTitle,
        description: newTaskDesc,
        startDate: effectiveParentStartDate,
        endDate: effectiveParentEndDate,
        start: effectiveParentStartDate,
        end: effectiveParentEndDate,
        assignedTo: newTaskAssignedTo,
        indicator: newTaskType === "quantitative"
          ? quantitativeDelegatesToSubtasks
            ? "avance subtareas"
            : newTaskIndicator
          : null,
        indicatorValue:
          newTaskType === "quantitative"
            ? quantitativeDelegatesToSubtasks
              ? 100
              : Number(newTaskIndicatorValue)
            : null,
        status: newTaskType === "state" ? "pending" : isStateWorkflowSelected ? "todo" : newTaskStatus,
        progress: newTaskType === "state" || isStateWorkflowSelected ? 0 : Number(newTaskProgress),
        type: newTaskType,
        assignedUsers: newTaskType === "meeting" ? meetingParticipantIds : [],
        assignedTeamMembers: newTaskType === "meeting" ? meetingParticipantIds : [],
        requiresDocument: newTaskRequiresDoc,
        linkedDocumentId: null,
        isRateCardTask: taskUsesDirectRateCard,
        rateCardMode: taskUsesDirectRateCard ? newTaskRateCardMode : null,
        dynamicRateCard: usesDynamicRateCard,
        dynamicRateCardConfig: usesDynamicRateCard
          ? {
              defaultUnits: normalizeRateCardUnits(newTaskUnitsToAdd),
              requirePerson: true,
              requireRateCard: true,
              promptForUnits: !newTaskDynamicAutoAddUnits,
            }
          : null,
        rateCardId: usesStaticRateCard ? newTaskRateCardId : null,
        unitsToAdd: taskUsesDirectRateCard ? normalizeRateCardUnits(newTaskUnitsToAdd, 0) : null,
        autoAddUnits: usesDynamicRateCard ? newTaskDynamicAutoAddUnits : true,
        syncExternal: usesStaticRateCard
          ? rateCards.find((rc) => rc.id === newTaskRateCardId)?.syncExternal ||
            false
          : false,
        meeting:
          newTaskType === "meeting"
            ? {
                startAt: meetingStartAt,
                endAt: meetingEndAt,
                startTime: meetingStartTime,
                endTime: meetingEndTime,
                location: meetingLocation.trim(),
                agenda: meetingAgenda.trim(),
                attendeeIds: meetingAttendees.map((attendee: any) => attendee.id),
                participantIds: meetingAttendees.map((attendee: any) => attendee.id),
                attendees: meetingAttendees,
                recurrence: {
                  frequency: meetingRecurrence,
                  interval: meetingRecurrence === "none" ? 1 : Number(meetingRecurrenceInterval),
                  until: meetingRecurrence === "none" ? null : parentEndDate,
                },
              }
            : null,
        meetingStartAt: newTaskType === "meeting" ? meetingStartAt : null,
        meetingEndAt: newTaskType === "meeting" ? meetingEndAt : null,
        meetingRecurrence: newTaskType === "meeting" ? meetingRecurrence : null,
        meetingParticipantIds: newTaskType === "meeting" ? meetingParticipantIds : [],
        meetingPendingParticipantIds: newTaskType === "meeting" ? meetingParticipantIds : [],
        meetingResponses: newTaskType === "meeting" ? [] : null,
        priority: newTaskPriority,
        groupId: newTaskGroupId || null,
        currentValue: 0,
        incrementForm:
          newTaskType === "quantitative" && !quantitativeDelegatesToSubtasks ? incrementForm || null : null,
        incrementalRateBinding,
        incrementSource: incrementalRateBinding
          ? "rate_card"
          : quantitativeDelegatesToSubtasks
            ? "subtasks"
            : "manual",
        incrementHistory: newTaskType === "quantitative" ? [] : null,
        displayOrder: tasksLength,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: user.uid,
      };

      const batch = writeBatch(db);
      const taskRef = doc(collection(db, "projects", projectId, "tasks"));
      const notifications: TaskAssignmentNotificationPayload[] = [];
      const queueTaskNotification = (taskId: string, assigneeId: string, status: string, source: string) => {
        if (!assigneeId || status === "completed" || status === "completed_late") return;
        notifications.push({
          projectId,
          taskId,
          assigneeId,
          eventType: "task_assigned",
          source,
        });
      };
      const addManualSubtasksToBatch = (
        parentTaskId: string,
        displayOrderOffset: number,
      ) => {
        draftSubtasks.forEach((subtask, index) => {
          const parentIsIncremental = newTaskType === "quantitative";
          const subtaskIsIncremental = parentIsIncremental && Boolean(subtask.isIncremental);
          const subtaskIncrementalRateBinding = subtaskIsIncremental && subtask.incrementMode === "rate_card" && subtask.incrementRateCardId
            ? {
                enabled: true,
                rateCardId: subtask.incrementRateCardId,
                assigneeMode: subtask.incrementFilterByAssignee ? "fixed" : "any",
                assignedTo: subtask.incrementFilterByAssignee ? subtask.incrementAssigneeId || null : null,
                dateMode: subtask.incrementFilterByDate ? "range" : "any",
                startDate: subtask.incrementFilterByDate && subtask.incrementStartDate
                  ? new Date(`${subtask.incrementStartDate}T00:00:00`)
                  : null,
                endDate: subtask.incrementFilterByDate && subtask.incrementEndDate
                  ? new Date(`${subtask.incrementEndDate}T23:59:59`)
                  : null,
                activatedAt: new Date(),
              }
            : null;
          const subtaskTitle = subtask.title.trim();
          const startValue = subtask.startDate || newTaskStart;
          const endValue = subtask.endDate || newTaskEnd;
          const subtaskStartDate = new Date(startValue + "T00:00:00");
          const subtaskEndDate = new Date(endValue + "T00:00:00");
          const childStatus = parentIsIncremental ? "todo" : subtask.status;
          const subtaskRef = doc(
            collection(db, "projects", projectId, "tasks"),
          );

          batch.set(subtaskRef, {
            projectId,
            title: subtaskTitle,
            name: subtaskTitle,
            description: subtask.description.trim(),
            startDate: subtaskStartDate,
            endDate: subtaskEndDate,
            start: subtaskStartDate,
            end: subtaskEndDate,
            assignedTo: subtask.assignedTo || newTaskAssignedTo,
            indicator: subtaskIsIncremental ? subtask.incrementIndicator || newTaskIndicator || "avance" : null,
            indicatorValue: subtaskIsIncremental ? Number(subtask.incrementTarget || 0) : null,
            status: childStatus,
            progress: subtaskIsIncremental ? 0 : childStatus === "completed" ? 100 : 0,
            type: subtaskIsIncremental ? "quantitative" : "state",
            requiresDocument: false,
            linkedDocumentId: null,
            isRateCardTask: false,
            rateCardMode: null,
            dynamicRateCard: false,
            dynamicRateCardConfig: null,
            completionForm: subtask.completionForm || null,
            completionFormData: null,
            completionRateCardLastCharges: [],
            rateCardId: null,
            unitsToAdd: null,
            autoAddUnits: true,
            syncExternal: false,
            priority: subtask.priority,
            groupId: newTaskGroupId || null,
            currentValue: 0,
            incrementForm: null,
            incrementalRateBinding: subtaskIncrementalRateBinding,
            incrementSource: subtaskIsIncremental ? (subtaskIncrementalRateBinding ? "rate_card" : "manual") : null,
            incrementHistory: subtaskIsIncremental ? [] : null,
            incrementDelegatedFromParentTaskId: subtaskIsIncremental ? parentTaskId : null,
            parentTaskId,
            displayOrder: displayOrderOffset + index,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            createdBy: user.uid,
          });
          queueTaskNotification(
            subtaskRef.id,
            subtask.assignedTo || newTaskAssignedTo,
            childStatus,
            "manual_subtask_created",
          );
        });
      };

      if (draftSubtasks.length > 0) {
        taskData.isParentTask = true;
        taskData.totalSubtasks = draftSubtasks.length;
        taskData.incrementDelegatedToSubtasks = newTaskType === "quantitative";
        if (newTaskType === "quantitative") {
          taskData.currentValue = 0;
          taskData.progress = 0;
          taskData.status = "todo";
        }
      }

      // Handle Rate Card update for initial progress
      if (
        taskData.isRateCardTask &&
        !taskData.incrementDelegatedToSubtasks &&
        taskData.rateCardId &&
        taskData.unitsToAdd &&
        taskData.progress > 0 &&
        !isWorkflowTaskType(taskData.type)
      ) {
        const units = (taskData.progress / 100) * normalizeRateCardUnits(taskData.unitsToAdd, 0);
        addTraceableRateCardMovementToBatch(batch, {
          projectId,
          task: { ...taskData, id: taskRef.id },
          rateCardId: taskData.rateCardId,
          assignedTo: taskData.assignedTo || null,
          units,
          source: "task_initial_progress",
          rateCardSourceKey: "task_initial_progress",
          comment: "Movimiento registrado desde el avance inicial de la tarea.",
          occurredAt: new Date(),
          actor: {
            id: user?.uid || null,
            email: user?.email || null,
            name: user?.displayName || user?.email || null,
          },
          completionMode: "task_created_with_initial_progress",
        });
      }

      if (isWorkflowTypeSelected) {
        taskData.workflowSteps = (workflowSchedule?.steps || workflowReferenceSteps).map((step) => {
          const cleanStep: any = {
            ...step,
            status: "not_started",
          };
          // Firestore doesn't support undefined values
          Object.keys(cleanStep).forEach((key) => {
            if (cleanStep[key] === undefined) {
              cleanStep[key] = null;
            }
          });
          return cleanStep;
        });
        taskData.currentStepIndex = 0;
        taskData.workflowHistory = [];
        taskData.progress = 0;
        taskData.workflowScheduleMode = workflowScheduleMode;
        taskData.workflowDayCountingEnabled = workflowDayCountingEnabled;
        taskData.workflowTotalPlannedDays = getWorkflowTotalPlannedDays(workflowReferenceSteps);
        taskData.workflowCycles = effectiveWorkflowCycles;
        taskData.currentCycle = 1;
        taskData.workflowMode = isStateWorkflowSelected
          ? "state_linear"
          : isVariableWorkflowSelected
            ? "variable"
            : "linear";
        taskData.isVariableWorkflow = isVariableWorkflowSelected;
        taskData.stateWorkflow = isStateWorkflowSelected;
        taskData.singleExecution = isStateWorkflowSelected;
        taskData.workflowExecutionTrail = [];

        if (effectiveWorkflowCycles > 1) {
          taskData.isParentTask = true;
          taskData.totalCycles = effectiveWorkflowCycles;
          const parentDocRef = await addDoc(
            collection(db, "projects", projectId, "tasks"),
            taskData,
          );

          for (let i = 1; i <= effectiveWorkflowCycles; i++) {
            const subTaskRef = doc(
              collection(db, "projects", projectId, "tasks"),
            );
            const subTaskData = {
              ...taskData,
              title: taskTitle,
              name: taskTitle,
              isParentTask: false,
              parentTaskId: parentDocRef.id,
              cycleNumber: i,
              displayOrder: tasksLength + i,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            };
            batch.set(subTaskRef, subTaskData);
          }
          addManualSubtasksToBatch(parentDocRef.id, tasksLength + effectiveWorkflowCycles + 1);
          await batch.commit();
        } else {
          batch.set(taskRef, taskData);
          addManualSubtasksToBatch(taskRef.id, tasksLength + 1);
          if (!isWorkflowTypeSelected) {
            queueTaskNotification(taskRef.id, newTaskAssignedTo, taskData.status, "task_created");
          }
          await batch.commit();
        }
      } else {
        batch.set(taskRef, taskData);
        addManualSubtasksToBatch(taskRef.id, tasksLength + 1);
        if (newTaskType === "meeting") {
          meetingParticipantIds.forEach((participantId) => {
            queueTaskNotification(taskRef.id, participantId, taskData.status, "meeting_created");
          });
        } else {
          queueTaskNotification(taskRef.id, newTaskAssignedTo, taskData.status, "task_created");
        }
        await batch.commit();
      }

      if (incrementalRateBinding?.rateCardId) {
        await syncRateDrivenIncrementalTasksForRate({
          projectId,
          rateCardId: incrementalRateBinding.rateCardId,
        });
      }

      void Promise.allSettled(notifications.map((notification) => notifyTaskAssignment(notification)));

      toast.success("Tarea creada exitosamente");
      handleClose();
    } catch (error: any) {
      console.error("Error creating task:", error);
      toast.error(`Error al crear la tarea: ${error.message}`);
    } finally {
      setIsCreatingTask(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl overflow-x-hidden overflow-y-auto rounded-2xl bg-white shadow-2xl max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-6 border-b border-slate-100 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">
              <ListTodo size={20} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">Nueva Tarea</h3>
              <p className="text-xs text-slate-500">
                Proyecto: {project?.name}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleCreateTask} className="p-6 space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700">
                Título de la Tarea
              </label>
              <input
                type="text"
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                className="w-full h-11 px-4 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                placeholder="Ej. Diseño de Interfaz"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700">
                Descripción (Opcional)
              </label>
              <textarea
                value={newTaskDesc}
                onChange={(e) => setNewTaskDesc(e.target.value)}
                className="w-full min-h-[80px] p-4 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm resize-none"
                placeholder="Detalles de la tarea..."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">
                  {newTaskType === "meeting" ? "Primera fecha" : "Fecha Inicio"}
                </label>
                <input
                  type="date"
                  value={newTaskStart}
                  onChange={(e) => {
                    setNewTaskStart(e.target.value);
                    if (newTaskType === "meeting" && !newTaskEnd) {
                      setNewTaskEnd(e.target.value);
                    }
                  }}
                  className="w-full h-11 px-4 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">
                  {newTaskType === "meeting" ? "Fin de serie" : "Fecha Fin"}
                </label>
                <input
                  type="date"
                  value={newTaskEnd}
                  onChange={(e) => setNewTaskEnd(e.target.value)}
                  className="w-full h-11 px-4 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">
                  {newTaskType === "meeting" ? "Responsable principal" : "Asignar a"}
                </label>
                <select
                  value={newTaskAssignedTo}
                  onChange={(e) => setNewTaskAssignedTo(e.target.value)}
                  className="w-full h-11 px-4 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                  required={newTaskType !== "meeting"}
                >
                  <option value="">Seleccionar miembro...</option>
                  {teamMembers.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name || member.email}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">
                  Prioridad
                </label>
                <select
                  value={newTaskPriority}
                  onChange={(e) => setNewTaskPriority(e.target.value)}
                  className="w-full h-11 px-4 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                >
                  <option value="high">Alta</option>
                  <option value="medium">Media</option>
                  <option value="low">Baja</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">
                  Estado Inicial
                </label>
                <select
                  value={newTaskStatus}
                  onChange={(e) => setNewTaskStatus(e.target.value)}
                  disabled={isStateWorkflowSelected}
                  className="w-full h-11 px-4 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                >
                  <option value="todo">Pendiente</option>
                  <option value="in_progress">Trabajando</option>
                  <option value="stuck">Estancado</option>
                  <option value="completed">Listo</option>
                </select>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-bold text-slate-700">
                    Tipo de Tarea
                  </label>
                  <span className="text-[9px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100 uppercase tracking-tighter">
                    {taskTypeLabel[newTaskType]}
                  </span>
                </div>
                <select
                  value={newTaskType}
                  onChange={(e) => {
                    const nextType = e.target.value as TaskType;
                    setNewTaskType(nextType);
                    if (isStateWorkflowTaskType(nextType)) {
                      setNewTaskStatus("todo");
                      setWorkflowCycles(1);
                      setWorkflowSteps((currentSteps) => normalizeStateWorkflowSteps(currentSteps));
                    }
                  }}
                  className="w-full h-11 px-4 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                >
                  <option value="workflow">Workflow (Flujo)</option>
                  <option value="workflow_variable">Workflow variable</option>
                  <option value="state_workflow">Por estado procedimental</option>
                  <option value="meeting">Reunión</option>
                  <option value="quantitative">Cuantitativa</option>
                  <option value="state">Estado simple</option>
                </select>
              </div>
            </div>

            {assignableTaskGroups.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">
                  Grupo visual
                </label>
                <select
                  value={newTaskGroupId}
                  onChange={(e) => setNewTaskGroupId(e.target.value)}
                  className="w-full h-11 px-4 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                >
                  <option value="">{defaultTaskGroupName}</option>
                  {assignableTaskGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {newTaskType === "meeting" && (
              <div className="space-y-4 rounded-xl border border-cyan-100 bg-cyan-50/60 p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-white p-2 text-cyan-700 shadow-sm">
                    <CalendarDays size={18} />
                  </div>
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-cyan-700">
                      Configuración de reunión
                    </label>
                    <p className="mt-1 text-xs text-cyan-700/80">
                      La tarea quedará visible en la planificación y podrá exportarse a calendario.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-cyan-700">
                      Hora inicio
                    </label>
                    <input
                      type="time"
                      value={meetingStartTime}
                      onChange={(event) => setMeetingStartTime(event.target.value)}
                      className="h-10 w-full rounded-lg border border-cyan-100 bg-white px-3 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                      required={newTaskType === "meeting"}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-cyan-700">
                      Hora fin
                    </label>
                    <input
                      type="time"
                      value={meetingEndTime}
                      onChange={(event) => setMeetingEndTime(event.target.value)}
                      className="h-10 w-full rounded-lg border border-cyan-100 bg-white px-3 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                      required={newTaskType === "meeting"}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_120px]">
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-cyan-700">
                      Recurrencia
                    </label>
                    <select
                      value={meetingRecurrence}
                      onChange={(event) => setMeetingRecurrence(event.target.value as MeetingRecurrenceFrequency)}
                      className="h-10 w-full rounded-lg border border-cyan-100 bg-white px-3 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                    >
                      <option value="none">Única</option>
                      <option value="daily">Diaria</option>
                      <option value="weekly">Semanal</option>
                      <option value="monthly">Mensual</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-cyan-700">
                      Cada
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={meetingRecurrenceInterval}
                      disabled={meetingRecurrence === "none"}
                      onChange={(event) => setMeetingRecurrenceInterval(Number(event.target.value))}
                      className="h-10 w-full rounded-lg border border-cyan-100 bg-white px-3 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 disabled:bg-slate-50 disabled:text-slate-400"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-cyan-700">
                    Lugar o enlace
                  </label>
                  <input
                    type="text"
                    value={meetingLocation}
                    onChange={(event) => setMeetingLocation(event.target.value)}
                    className="h-10 w-full rounded-lg border border-cyan-100 bg-white px-3 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                    placeholder="Ej. Google Meet, oficina, sala de juntas..."
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-cyan-700">
                    Agenda
                  </label>
                  <textarea
                    value={meetingAgenda}
                    onChange={(event) => setMeetingAgenda(event.target.value)}
                    className="min-h-[70px] w-full resize-none rounded-lg border border-cyan-100 bg-white p-3 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                    placeholder="Temas, objetivo, preparación esperada..."
                  />
                </div>

                {projectMembers.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-cyan-700">
                      Responsables de la reunión
                    </label>
                    <p className="text-[11px] font-medium text-cyan-700/80">
                      Todos los seleccionados recibirán la reunión en su bandeja y deberán cerrar su comentario.
                    </p>
                    <div className="grid max-h-36 gap-2 overflow-y-auto rounded-lg border border-cyan-100 bg-white p-2 sm:grid-cols-2">
                      {projectMembers.map((member: any) => (
                        <label
                          key={member.id}
                          className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-700 hover:bg-cyan-50"
                        >
                          <input
                            type="checkbox"
                            checked={meetingAttendeeIds.includes(member.id) || newTaskAssignedTo === member.id}
                            disabled={newTaskAssignedTo === member.id}
                            onChange={() => toggleMeetingAttendee(member.id)}
                            className="h-3.5 w-3.5 rounded border-cyan-200 text-cyan-600 focus:ring-cyan-500"
                          />
                          <span className="truncate">
                            {member.name || member.email}
                            {newTaskAssignedTo === member.id ? " · responsable" : ""}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {isWorkflowTypeSelected && (
              <div className="min-w-0 space-y-4 overflow-hidden rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
                {isStateWorkflowSelected ? (
                  <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                    <p className="text-xs font-black uppercase tracking-wider text-emerald-700">
                      Procedimiento único por estados
                    </p>
                    <p className="mt-1 text-[11px] font-medium leading-5 text-emerald-700/80">
                      Se ejecuta una sola vez, en el orden definido. Cada estado puede tener responsable,
                      formulario, documentos, aprobación, devolución, control de calidad y Rate Cards.
                    </p>
                  </div>
                ) : (
                  <div className="mb-4 space-y-2">
                    <label className="text-xs font-bold text-indigo-600 uppercase tracking-wider">
                      Cantidad de Repeticiones (Sub-tareas)
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={workflowCycles}
                      onChange={(e) => setWorkflowCycles(Number(e.target.value))}
                      className="w-full h-10 px-3 rounded-lg border border-indigo-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                    />
                    <p className="text-[10px] text-indigo-500">
                      Si es mayor a 1, se crearán múltiples subtareas para este flujo.
                    </p>
                  </div>
                )}

                <div className="mb-4 grid gap-3 rounded-xl border border-indigo-100 bg-white/80 p-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                  <div className="min-w-0">
                    <label className="text-xs font-bold uppercase tracking-wider text-indigo-600">
                      Programacion de pasos
                    </label>
                    <p className="mt-1 text-[10px] text-slate-500">
                      {workflowDayCountingEnabled
                        ? "Activo: la fecha fin del workflow se calcula con la suma de los dias de cada paso."
                        : "Inactivo: el workflow respeta el periodo definido; los dias se guardan solo como referencia estadistica."}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
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
                      className="h-9 rounded-lg border border-indigo-200 bg-white px-3 text-xs font-semibold text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                    >
                      <option value="calendar">Dias calendario</option>
                      <option value="business">Dias laborales</option>
                    </select>
                  </div>
                </div>

                <div className="flex min-w-0 flex-col gap-3 border-t border-indigo-100 pt-4 xl:flex-row xl:items-center xl:justify-between">
                  <div className="min-w-0">
                    <label className="text-xs font-bold uppercase tracking-wider text-indigo-600">
                      Pasos del {isStateWorkflowSelected ? "procedimiento por estados" : isVariableWorkflowSelected ? "Workflow variable" : "Workflow"}
                    </label>
                    <p className="mt-1 text-[10px] font-medium text-slate-500">
                      {isStateWorkflowSelected
                        ? "Cada paso representa un estado consecutivo. No admite bifurcaciones, paralelos ni repeticiones."
                        : isVariableWorkflowSelected
                        ? "Agrega pasos y abre el editor visual para crear rutas, saltos y salidas alternativas."
                        : "Agrega pasos, carga plantillas y abre el editor visual sin salir del modal."}
                    </p>
                  </div>
                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center xl:justify-end">
                    {workflowTemplates.length > 0 && (
                      <select
                        className="h-9 min-w-0 rounded-lg border border-indigo-200 bg-white px-3 text-xs font-semibold text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 sm:w-[220px] lg:w-[260px]"
                        onChange={(e) => handleLoadTemplate(e.target.value)}
                        defaultValue=""
                      >
                        <option value="" disabled>
                          Plantillas disponibles...
                        </option>
                        {currentProjectWorkflowTemplates.length > 0 && (
                          <optgroup label="Este proyecto">
                            {currentProjectWorkflowTemplates.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {sharedWorkflowTemplates.length > 0 && (
                          <optgroup label="Organizaciones asignadas">
                            {sharedWorkflowTemplates.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name} · {getWorkflowTemplateScopeLabel(t, projectId)}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    )}
                    {workflowSteps.length > 0 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setShowTemplateModal(true)}
                        className="h-9 shrink-0 rounded-lg border-indigo-200 px-3 text-xs font-bold text-indigo-600 hover:bg-indigo-50"
                      >
                        GUARDAR PLANTILLA
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setWorkflowSteps([
                          ...workflowSteps,
                          {
                            assignedTo: "",
                            label: "",
                            unitsToAdd: 1,
                            autoAddUnits: true,
                            rateCards: [],
                            plannedDurationDays: 1,
                            disableImplicitLinearRoute: isVariableWorkflowSelected,
                          },
                        ])
                      }
                      className="h-9 shrink-0 rounded-lg border border-indigo-200 bg-white px-3 text-xs font-bold text-indigo-600 hover:bg-indigo-50"
                    >
                      <Plus size={14} className="mr-1.5" /> AGREGAR PASO
                    </Button>
                  </div>
                </div>

                {workflowSteps.length > 0 && (
                  <WorkflowRoutingBuilder
                    steps={workflowSteps}
                    rateCards={rateCards}
                    teamMembers={teamMembers}
                    projectId={projectId}
                    project={project}
                    allowAnyTarget={isVariableWorkflowSelected}
                    linearOnly={isStateWorkflowSelected}
                    onChange={(nextSteps) =>
                      setWorkflowSteps(
                        isStateWorkflowSelected ? normalizeStateWorkflowSteps(nextSteps) : nextSteps,
                      )
                    }
                  />
                )}

                {workflowSteps.length === 0 ? (
                  <p className="text-[10px] text-slate-400 text-center py-2 italic">
                    No hay pasos definidos. Agrega al menos uno.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {workflowSteps.map((step, idx) => (
                        <div
                          key={idx}
                          className="flex min-w-0 flex-col gap-2 bg-white p-3 rounded-lg border border-indigo-100 shadow-sm"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                            {idx + 1}
                          </div>
                          <input
                            type="text"
                            placeholder="Nombre del paso (ej. Aprobación Técnica)"
                            value={step.label}
                            onChange={(e) => {
                              const newSteps = [...workflowSteps];
                              newSteps[idx].label = e.target.value;
                              setWorkflowSteps(newSteps);
                            }}
                              className="min-w-0 flex-1 h-8 px-2 text-xs border-none focus:ring-0 font-medium"
                            required
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setCurrentStepIndexForForm(idx);
                              setIsFormBuilderOpen(true);
                            }}
                            className={`p-1.5 rounded-md transition-colors ${step.form ? "text-indigo-600 bg-indigo-50 hover:bg-indigo-100" : "text-slate-400 hover:text-indigo-600 hover:bg-slate-100"}`}
                            title={
                              step.form
                                ? "Editar Formulario"
                                : "Agregar Formulario"
                            }
                          >
                            <ClipboardList size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const nextSteps = workflowSteps.filter((_, i) => i !== idx);
                              const oldIndexByNewIndex = workflowSteps
                                .map((_, oldIndex) => oldIndex)
                                .filter((oldIndex) => oldIndex !== idx);
                              const remappedSteps = remapWorkflowStepRouteTargets(nextSteps, oldIndexByNewIndex);
                              if (remappedSteps[0]?.isQualityGate) {
                                remappedSteps[0] = { ...remappedSteps[0], isQualityGate: false };
                                toast.warning("Se desmarcó calidad del primer paso porque necesita un paso anterior.");
                              }
                              setWorkflowSteps(remappedSteps);
                            }}
                            className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                          >
                            <X size={14} />
                          </button>
                        </div>

                          <div className="grid grid-cols-1 gap-2 pl-8 sm:grid-cols-2">
                            <div className="sm:col-span-2 grid grid-cols-1 gap-2 rounded-lg border border-indigo-50 bg-indigo-50/60 p-2 sm:grid-cols-[minmax(0,1fr)_130px] sm:items-center">
                              <div>
                                <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">
                                  Duracion planificada
                                </p>
                                <p className="text-[9px] text-indigo-500">
                                  {workflowDayCountingEnabled
                                    ? "Este paso consumira esta cantidad de dias en el cronograma del workflow."
                                    : "Referencia estadistica: no limita el fin del workflow cuando el conteo esta inactivo."}
                                </p>
                              </div>
                              <input
                                type="number"
                                min="1"
                                step="1"
                                value={step.plannedDurationDays ?? 1}
                                onChange={(e) => {
                                  const newSteps = [...workflowSteps];
                                  newSteps[idx].plannedDurationDays = Number(e.target.value);
                                  setWorkflowSteps(newSteps);
                                }}
                                className="h-8 w-full rounded border border-indigo-100 bg-white px-2 text-xs font-semibold text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                                aria-label={`Duracion del paso ${idx + 1} en dias`}
                              />
                            </div>

                            <select
                            value={step.assignedTo}
                            onChange={(e) => {
                              const newSteps = [...workflowSteps];
                              newSteps[idx].assignedTo = e.target.value;
                              setWorkflowSteps(newSteps);
                            }}
                              className="h-8 w-full min-w-0 px-2 text-[10px] border border-slate-100 focus:ring-0 bg-slate-50 rounded"
                            required
                          >
                            <option value="">Asignar a...</option>
                            <option value="DYNAMIC">
                              Asignación dinámica (por paso anterior)
                            </option>
                            {teamMembers.map((member) => (
                              <option key={member.id} value={member.id}>
                                {member.name || member.email}
                              </option>
                            ))}
                          </select>

                          <select
                            value={
                              step.dynamicRateCard
                                ? "__dynamic__"
                                : step.rateCardMode === "static" || getEditableStepRateCards(step).length > 0
                                  ? "__static__"
                                  : ""
                            }
                            onChange={(e) => {
                              const newSteps = [...workflowSteps];
                              if (e.target.value === "__dynamic__") {
                                newSteps[idx].rateCardMode = "dynamic";
                                newSteps[idx].dynamicRateCard = true;
                                newSteps[idx].dynamicRateCardConfig = {
                                  defaultUnits: normalizeRateCardUnits(newSteps[idx].unitsToAdd),
                                  requirePerson: true,
                                  requireRateCard: true,
                                  promptForUnits: false,
                                };
                                newSteps[idx].rateCardId = undefined;
                                newSteps[idx].rateCards = [];
                                newSteps[idx].autoAddUnits = true;
                              } else if (e.target.value === "__static__") {
                                const currentCards = getEditableStepRateCards(newSteps[idx]);
                                const nextCards = currentCards.length > 0 ? currentCards : [createStepRateCardItem()];
                                const firstRateCard = nextCards[0];
                                newSteps[idx].rateCardMode = "static";
                                newSteps[idx].dynamicRateCard = false;
                                newSteps[idx].dynamicRateCardConfig = null;
                                newSteps[idx].rateCards = nextCards;
                                newSteps[idx].rateCardId = firstRateCard?.rateCardId || undefined;
                                newSteps[idx].unitsToAdd = firstRateCard?.unitsToAdd ?? 1;
                                newSteps[idx].autoAddUnits = firstRateCard?.autoAddUnits !== false;
                              } else {
                                newSteps[idx].rateCardMode = undefined;
                                newSteps[idx].dynamicRateCard = false;
                                newSteps[idx].dynamicRateCardConfig = null;
                                newSteps[idx].rateCards = [];
                                newSteps[idx].rateCardId = undefined;
                                newSteps[idx].unitsToAdd = undefined;
                                newSteps[idx].autoAddUnits = true;
                              }
                              setWorkflowSteps(newSteps);
                            }}
                              className="h-8 w-full min-w-0 px-2 text-[10px] border border-slate-100 focus:ring-0 bg-slate-50 rounded"
                          >
                            <option value="">Sin Rate Card</option>
                            <option value="__static__">Rate Cards fijos</option>
                            <option value="__dynamic__">Rate Card dinámico</option>
                          </select>

                            {step.dynamicRateCard && (
                              <div className="sm:col-span-2 flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-2 py-2">
                                <label className="flex items-center gap-1 text-[10px] text-emerald-700 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={step.autoAddUnits !== false}
                                    onChange={(e) => {
                                      const newSteps = [...workflowSteps];
                                      const autoAddUnits = e.target.checked;
                                      newSteps[idx].autoAddUnits = autoAddUnits;
                                      newSteps[idx].dynamicRateCardConfig = {
                                        defaultUnits: normalizeRateCardUnits(newSteps[idx].unitsToAdd),
                                        requirePerson: true,
                                        requireRateCard: true,
                                        promptForUnits: !autoAddUnits,
                                      };
                                      setWorkflowSteps(newSteps);
                                    }}
                                    className="w-3 h-3 text-emerald-600 border-emerald-200 rounded focus:ring-emerald-500"
                                  />
                                  Sumar auto.
                                </label>
                                {step.autoAddUnits !== false && (
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    pattern="[0-9]*[.,]?[0-9]*"
                                    value={step.unitsToAdd ?? 1}
                                    onChange={(e) => {
                                      const newSteps = [...workflowSteps];
                                      const units = e.target.value;
                                      newSteps[idx].unitsToAdd = units;
                                      newSteps[idx].dynamicRateCardConfig = {
                                        defaultUnits: normalizeRateCardUnits(units),
                                        requirePerson: true,
                                        requireRateCard: true,
                                        promptForUnits: false,
                                      };
                                      setWorkflowSteps(newSteps);
                                    }}
                                    className="h-8 w-24 px-2 text-[10px] border border-emerald-100 focus:ring-0 bg-white rounded"
                                    placeholder="Ej. 0,051"
                                    title="Puedes usar coma o punto decimal. Ejemplo: 0,051 o 0.051"
                                  />
                                )}
                                <span className="min-w-0 flex-1 text-[9px] text-emerald-600">
                                  {step.autoAddUnits === false
                                    ? "Pedirá persona, perfil y unidades al aprobar."
                                    : "Pedirá persona y perfil; sumará estas unidades."}
                                </span>
                                <span className="basis-full text-[9px] font-bold text-emerald-700">
                                  Decimales: escribe 0,051 o 0.051; Pixel normaliza al guardar.
                                </span>
                              </div>
                            )}

                            {!step.dynamicRateCard && (step.rateCardMode === "static" || getEditableStepRateCards(step).length > 0) && (
                              <div className="sm:col-span-2 space-y-2 rounded-lg border border-slate-100 bg-slate-50 px-2 py-2">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                    Indicadores del paso
                                  </p>
                                  <p className="text-[9px] font-bold text-slate-400">
                                    Decimales: 0,051 o 0.051.
                                  </p>
                                  <button
                                    type="button"
                                    onClick={() => updateStepStaticRateCards(idx, (currentCards) => [...currentCards, createStepRateCardItem()])}
                                    className="inline-flex h-7 items-center gap-1 rounded border border-indigo-100 bg-white px-2 text-[10px] font-bold text-indigo-600 hover:bg-indigo-50"
                                  >
                                    <Plus size={12} />
                                    Agregar
                                  </button>
                                </div>
                                {getEditableStepRateCards(step).map((rateCardItem) => (
                                  <div key={rateCardItem.id} className="space-y-2 rounded-lg border border-slate-100 bg-white p-2">
                                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center">
                                      <select
                                        value={rateCardItem.rateCardId}
                                        onChange={(e) =>
                                          updateStepStaticRateCards(idx, (currentCards) =>
                                            currentCards.map((item) =>
                                              item.id === rateCardItem.id ? { ...item, rateCardId: e.target.value } : item
                                            )
                                          )
                                        }
                                        className="h-8 min-w-0 px-2 text-[10px] border border-slate-100 focus:ring-0 bg-slate-50 rounded"
                                      >
                                        <option value="">Selecciona Rate Card</option>
                                        {rateCards.map((rc) => (
                                          <option key={rc.id} value={rc.id}>
                                            {rc.name}
                                          </option>
                                        ))}
                                      </select>
                                      <label
                                        className="flex h-8 items-center gap-1 rounded border border-slate-100 bg-slate-50 px-2 text-[10px] text-slate-500"
                                        title="Si se desmarca, se le preguntará al usuario las unidades al completar el paso."
                                      >
                                        <input
                                          type="checkbox"
                                          checked={rateCardItem.autoAddUnits !== false}
                                          onChange={(e) =>
                                            updateStepStaticRateCards(idx, (currentCards) =>
                                              currentCards.map((item) =>
                                                item.id === rateCardItem.id
                                                  ? { ...item, autoAddUnits: e.target.checked }
                                                  : item
                                              )
                                            )
                                          }
                                          className="w-3 h-3 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
                                        />
                                        Sumar auto.
                                      </label>
                                      {rateCardItem.autoAddUnits !== false ? (
                                        <input
                                          type="text"
                                          inputMode="decimal"
                                          pattern="[0-9]*[.,]?[0-9]*"
                                          value={rateCardItem.unitsToAdd ?? 1}
                                          onChange={(e) =>
                                            updateStepStaticRateCards(idx, (currentCards) =>
                                              currentCards.map((item) =>
                                                item.id === rateCardItem.id
                                                  ? { ...item, unitsToAdd: e.target.value }
                                                  : item
                                              )
                                            )
                                          }
                                          className="h-8 w-full px-2 text-[10px] border border-slate-100 focus:ring-0 bg-white rounded sm:w-20"
                                          placeholder="Ej. 0,051"
                                          title="Puedes usar coma o punto decimal. Ejemplo: 0,051 o 0.051"
                                        />
                                      ) : (
                                        <span className="text-[9px] font-medium text-slate-400">
                                          Manual
                                        </span>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() =>
                                          updateStepStaticRateCards(idx, (currentCards) =>
                                            currentCards.filter((item) => item.id !== rateCardItem.id)
                                          )
                                        }
                                        className="flex h-8 w-full items-center justify-center rounded text-slate-300 hover:bg-red-50 hover:text-red-500 sm:w-8"
                                        title="Quitar Rate Card"
                                      >
                                        <Trash2 size={13} />
                                      </button>
                                    </div>
                                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
                                      <select
                                        value={rateCardItem.assigneeMode || (rateCardItem.assignToProfessional ? "fixed" : "default")}
                                        onChange={(e) => {
                                          const mode = e.target.value as "default" | "fixed" | "runtime";
                                          updateStepStaticRateCards(idx, (currentCards) =>
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
                                        className="h-8 rounded border border-indigo-100 bg-indigo-50 px-2 text-[10px] font-medium text-indigo-700 focus:ring-0"
                                      >
                                        <option value="default">Responsable del paso</option>
                                        <option value="fixed">Profesional fijo</option>
                                        <option value="runtime">Pedir al ejecutar</option>
                                      </select>
                                      {(rateCardItem.assigneeMode || (rateCardItem.assignToProfessional ? "fixed" : "default")) === "fixed" && (
                                        <select
                                          value={rateCardItem.assignedTo || ""}
                                          onChange={(e) =>
                                            updateStepStaticRateCards(idx, (currentCards) =>
                                              currentCards.map((item) =>
                                                item.id === rateCardItem.id ? { ...item, assignedTo: e.target.value } : item
                                              )
                                            )
                                          }
                                          className="h-8 min-w-0 rounded border border-slate-100 bg-white px-2 text-[10px] focus:ring-0"
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
                                        <div className="rounded border border-amber-100 bg-amber-50 px-2 py-1.5 text-[10px] font-medium text-amber-700">
                                          Se pedirá al aprobar.
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                                <p className="text-[9px] text-slate-500">
                                  Al aprobar el paso se sumarán todos los indicadores configurados.
                                </p>
                              </div>
                            )}

                          <label className={`sm:col-span-2 flex items-center gap-2 rounded-lg border px-2 py-2 text-[10px] font-medium ${
                            idx === 0
                              ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
                              : "cursor-pointer border-amber-100 bg-amber-50 text-amber-800"
                          }`}>
                            <input
                              type="checkbox"
                              checked={idx === 0 ? false : Boolean(step.isQualityGate)}
                              disabled={idx === 0}
                              onChange={(e) => {
                                if (idx === 0) return;
                                const newSteps = [...workflowSteps];
                                newSteps[idx].isQualityGate = e.target.checked;
                                setWorkflowSteps(newSteps);
                              }}
                              className="w-3 h-3 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                            />
                            {idx === 0
                              ? "El primer paso no puede ser control de calidad."
                              : "Paso de control de calidad: al aprobar o devolver alimenta la gestión de calidad."}
                          </label>
                        </div>

                        {idx < workflowSteps.length - 1 && (
                          <div className="flex items-center gap-2 pl-8 mt-1">
                            <label className="flex items-center gap-2 text-[10px] text-slate-500 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={step.assignsNextStep || false}
                                onChange={(e) => {
                                  const newSteps = [...workflowSteps];
                                  newSteps[idx].assignsNextStep =
                                    e.target.checked;
                                  if (e.target.checked) {
                                    newSteps[idx + 1].assignedTo = "DYNAMIC";
                                  } else if (
                                    newSteps[idx + 1].assignedTo === "DYNAMIC"
                                  ) {
                                    newSteps[idx + 1].assignedTo = "";
                                  }
                                  setWorkflowSteps(newSteps);
                                }}
                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-3 h-3"
                              />
                              Este paso decide el responsable del siguiente paso
                            </label>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {newTaskType === "quantitative" && (
              <div className="space-y-4 p-4 bg-slate-50 rounded-xl border border-slate-100">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      Indicador
                    </label>
                    <input
                      type="text"
                      value={quantitativeDelegatesToSubtasks ? "Avance de subtareas" : newTaskIndicator}
                      onChange={(e) => setNewTaskIndicator(e.target.value)}
                      disabled={quantitativeDelegatesToSubtasks}
                      className="w-full h-10 px-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm disabled:cursor-not-allowed disabled:bg-emerald-50 disabled:text-emerald-700"
                      placeholder="Ej. Horas"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      Meta
                    </label>
                    <input
                      type="number"
                      value={quantitativeDelegatesToSubtasks ? 100 : newTaskIndicatorValue}
                      onChange={(e) =>
                        setNewTaskIndicatorValue(Number(e.target.value))
                      }
                      disabled={quantitativeDelegatesToSubtasks}
                      className="w-full h-10 px-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm disabled:cursor-not-allowed disabled:bg-emerald-50 disabled:text-emerald-700"
                    />
                  </div>
                </div>

                {quantitativeDelegatesToSubtasks ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                    <p className="font-bold uppercase tracking-wider text-xs">Matriz incremental por subtareas</p>
                    <p className="mt-1 text-xs leading-relaxed">
                      La tarea madre no tendrá meta propia ni Rate Card directo. Su avance se calculará con el porcentaje promedio de las subtareas incrementales, y cada subtarea tendrá su propia meta, filtro y motor de incremento.
                    </p>
                  </div>
                ) : (
                  <>
                <div className="rounded-xl border border-dashed border-indigo-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                        Formulario de incremento
                      </label>
                      <p className="mt-1 text-xs text-slate-500">
                        Define los datos que se pedirán cada vez que se sume al contador.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setIsIncrementFormBuilderOpen(true)}
                      className="h-9 text-xs font-bold border-indigo-200 text-indigo-600 hover:bg-indigo-50"
                    >
                      <ClipboardList size={14} className="mr-1" />
                      {incrementForm ? "Editar formulario" : "Configurar"}
                    </Button>
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    {incrementForm?.fields?.length
                      ? `${incrementForm.fields.length} campo(s) configurado(s).`
                      : "Sin formulario personalizado: al incrementar solo se pedirá cantidad y comentario."}
                  </p>
                </div>

                <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <label className="text-xs font-bold text-emerald-700 uppercase tracking-wider">
                        Motor incremental por Rate Card
                      </label>
                      <p className="mt-1 text-xs text-emerald-700/80">
                        Si lo activas, la tarea solo avanzará con movimientos del Rate Card elegido.
                      </p>
                    </div>
                    <label className="flex items-center gap-2 text-xs font-bold text-emerald-800">
                      <input
                        type="checkbox"
                        checked={incrementRateBindingEnabled}
                        onChange={(event) => setIncrementRateBindingEnabled(event.target.checked)}
                        className="rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      Usar rate como contador
                    </label>
                  </div>

                  {incrementRateBindingEnabled && (
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <div className="space-y-2 md:col-span-2">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                          Rate Card que suma avance
                        </label>
                        <select
                          value={incrementRateCardId}
                          onChange={(event) => {
                            setIncrementRateCardId(event.target.value);
                            const selectedRate = rateCards.find((rateCard) => rateCard.id === event.target.value);
                            if (selectedRate?.indicator && !newTaskIndicator) setNewTaskIndicator(selectedRate.indicator);
                          }}
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

                      <label className="flex items-center gap-2 rounded-lg border border-emerald-100 bg-white px-3 py-2 text-xs font-bold text-slate-700">
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

                      <label className="flex items-center gap-2 rounded-lg border border-emerald-100 bg-white px-3 py-2 text-xs font-bold text-slate-700">
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
                  </>
                )}
              </div>
            )}

            <div className="space-y-3 p-4 bg-slate-50 rounded-xl border border-slate-100">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Subtareas
                  </label>
                  <p className="text-[10px] text-slate-500 mt-1">
                    Crea entregables secundarios bajo esta tarea.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setDraftSubtasks([
                      ...draftSubtasks,
                      createDraftSubtask({
                        assignedTo: newTaskAssignedTo,
                        startDate: newTaskStart,
                        endDate: newTaskEnd,
                        priority: newTaskPriority,
                        isIncremental: newTaskType === "quantitative",
                        incrementIndicator: newTaskType === "quantitative" ? newTaskIndicator || "avance" : "",
                        incrementTarget: newTaskType === "quantitative" ? Number(newTaskIndicatorValue || 1) : 1,
                        incrementMode: "manual",
                      }),
                    ])
                  }
                  className="h-8 text-xs font-bold border-slate-200 bg-white"
                >
                  <Plus size={14} className="mr-1" />
                  Agregar
                </Button>
              </div>

              {draftSubtasks.length === 0 ? (
                <p className="text-xs text-slate-400 italic">
                  Sin subtareas agregadas.
                </p>
              ) : (
                <div className="space-y-3">
                  {draftSubtasks.map((subtask, index) => (
                    <div
                      key={subtask.id}
                      className="rounded-xl border border-slate-200 bg-white p-3 space-y-3"
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[11px] font-bold text-indigo-600">
                          {index + 1}
                        </span>
                        <input
                          type="text"
                          value={subtask.title}
                          onChange={(e) => {
                            const next = [...draftSubtasks];
                            next[index] = { ...subtask, title: e.target.value };
                            setDraftSubtasks(next);
                          }}
                          className="flex-1 h-9 px-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                          placeholder="Nombre de la subtarea"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setCurrentSubtaskIndexForForm(index);
                            setIsSubtaskFormBuilderOpen(true);
                          }}
                          className={`p-2 rounded-lg transition-colors ${
                            subtask.completionForm
                              ? "text-indigo-600 bg-indigo-50 hover:bg-indigo-100"
                              : "text-slate-300 hover:text-indigo-600 hover:bg-indigo-50"
                          }`}
                          title={subtask.completionForm ? "Editar formulario de cierre" : "Agregar formulario de cierre"}
                        >
                          <ClipboardList size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setDraftSubtasks(
                              draftSubtasks.filter((item) => item.id !== subtask.id),
                            )
                          }
                          className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          title="Eliminar subtarea"
                        >
                          <X size={16} />
                        </button>
                      </div>

                      <textarea
                        value={subtask.description}
                        onChange={(e) => {
                          const next = [...draftSubtasks];
                          next[index] = {
                            ...subtask,
                            description: e.target.value,
                          };
                          setDraftSubtasks(next);
                        }}
                        className="w-full min-h-[64px] p-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-xs resize-none"
                        placeholder="Descripción opcional"
                      />

                      <div className="grid grid-cols-2 gap-3">
                        <select
                          value={subtask.assignedTo}
                          onChange={(e) => {
                            const next = [...draftSubtasks];
                            next[index] = {
                              ...subtask,
                              assignedTo: e.target.value,
                            };
                            setDraftSubtasks(next);
                          }}
                          className="h-9 px-3 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-xs"
                        >
                          <option value="">Mismo responsable</option>
                          {teamMembers.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.name || member.email}
                            </option>
                          ))}
                        </select>
                        <select
                          value={subtask.priority}
                          onChange={(e) => {
                            const next = [...draftSubtasks];
                            next[index] = {
                              ...subtask,
                              priority: e.target.value,
                            };
                            setDraftSubtasks(next);
                          }}
                          className="h-9 px-3 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-xs"
                        >
                          <option value="high">Alta</option>
                          <option value="medium">Media</option>
                          <option value="low">Baja</option>
                        </select>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <input
                          type="date"
                          value={subtask.startDate}
                          onChange={(e) => {
                            const next = [...draftSubtasks];
                            next[index] = {
                              ...subtask,
                              startDate: e.target.value,
                            };
                            setDraftSubtasks(next);
                          }}
                          className="h-9 px-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-xs"
                        />
                        <input
                          type="date"
                          value={subtask.endDate}
                          onChange={(e) => {
                            const next = [...draftSubtasks];
                            next[index] = { ...subtask, endDate: e.target.value };
                            setDraftSubtasks(next);
                          }}
                          className="h-9 px-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-xs"
                        />
                      </div>

                      {newTaskType === "quantitative" && (
                        <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 space-y-3">
                          <label className="flex items-center justify-between gap-3 text-xs font-bold text-emerald-800">
                            <span className="flex items-center gap-2">
                              <CreditCard size={14} />
                              Incremento individual de esta subtarea
                            </span>
                            <input
                              type="checkbox"
                              checked={Boolean(subtask.isIncremental)}
                              onChange={(e) => {
                                const next = [...draftSubtasks];
                                next[index] = { ...subtask, isIncremental: e.target.checked };
                                setDraftSubtasks(next);
                              }}
                              className="h-4 w-4 rounded border-emerald-200 text-emerald-600 focus:ring-emerald-500"
                            />
                          </label>

                          {subtask.isIncremental && (
                            <div className="space-y-3">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                <input
                                  type="text"
                                  value={subtask.incrementIndicator || ""}
                                  onChange={(e) => {
                                    const next = [...draftSubtasks];
                                    next[index] = { ...subtask, incrementIndicator: e.target.value };
                                    setDraftSubtasks(next);
                                  }}
                                  className="h-9 px-3 rounded-lg border border-emerald-100 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-xs"
                                  placeholder="Indicador ej. Predios"
                                />
                                <input
                                  type="number"
                                  min="0"
                                  step="any"
                                  value={subtask.incrementTarget ?? 1}
                                  onChange={(e) => {
                                    const next = [...draftSubtasks];
                                    next[index] = { ...subtask, incrementTarget: Number(e.target.value) };
                                    setDraftSubtasks(next);
                                  }}
                                  className="h-9 px-3 rounded-lg border border-emerald-100 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-xs"
                                  placeholder="Meta"
                                />
                                <select
                                  value={subtask.incrementMode || "manual"}
                                  onChange={(e) => {
                                    const next = [...draftSubtasks];
                                    next[index] = { ...subtask, incrementMode: e.target.value as "manual" | "rate_card" };
                                    setDraftSubtasks(next);
                                  }}
                                  className="h-9 px-3 rounded-lg border border-emerald-100 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-xs"
                                >
                                  <option value="manual">Incremento manual</option>
                                  <option value="rate_card">Auto por Rate Card</option>
                                </select>
                              </div>

                              {subtask.incrementMode === "rate_card" && (
                                <div className="space-y-2 rounded-lg border border-emerald-100 bg-white p-3">
                                  <select
                                    value={subtask.incrementRateCardId || ""}
                                    onChange={(e) => {
                                      const next = [...draftSubtasks];
                                      next[index] = { ...subtask, incrementRateCardId: e.target.value };
                                      setDraftSubtasks(next);
                                    }}
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
                                        checked={Boolean(subtask.incrementFilterByAssignee)}
                                        onChange={(e) => {
                                          const next = [...draftSubtasks];
                                          next[index] = { ...subtask, incrementFilterByAssignee: e.target.checked };
                                          setDraftSubtasks(next);
                                        }}
                                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                                      />
                                      Filtrar por persona
                                    </label>
                                    <label className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-600">
                                      <input
                                        type="checkbox"
                                        checked={Boolean(subtask.incrementFilterByDate)}
                                        onChange={(e) => {
                                          const next = [...draftSubtasks];
                                          next[index] = { ...subtask, incrementFilterByDate: e.target.checked };
                                          setDraftSubtasks(next);
                                        }}
                                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                                      />
                                      Filtrar por fechas
                                    </label>
                                  </div>
                                  {subtask.incrementFilterByAssignee && (
                                    <select
                                      value={subtask.incrementAssigneeId || ""}
                                      onChange={(e) => {
                                        const next = [...draftSubtasks];
                                        next[index] = { ...subtask, incrementAssigneeId: e.target.value };
                                        setDraftSubtasks(next);
                                      }}
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
                                  {subtask.incrementFilterByDate && (
                                    <div className="grid grid-cols-2 gap-2">
                                      <input
                                        type="date"
                                        value={subtask.incrementStartDate || ""}
                                        onChange={(e) => {
                                          const next = [...draftSubtasks];
                                          next[index] = { ...subtask, incrementStartDate: e.target.value };
                                          setDraftSubtasks(next);
                                        }}
                                        className="h-9 px-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-xs"
                                      />
                                      <input
                                        type="date"
                                        value={subtask.incrementEndDate || ""}
                                        onChange={(e) => {
                                          const next = [...draftSubtasks];
                                          next[index] = { ...subtask, incrementEndDate: e.target.value };
                                          setDraftSubtasks(next);
                                        }}
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

                      <div className={`rounded-lg border px-3 py-2 text-[11px] ${
                        subtask.completionForm
                          ? "border-indigo-100 bg-indigo-50 text-indigo-700"
                          : "border-slate-100 bg-slate-50 text-slate-400"
                      }`}>
                        {subtask.completionForm
                          ? `Formulario de cierre: ${subtask.completionForm.title || "Sin título"} · ${subtask.completionForm.fields?.length || 0} campos`
                          : "Sin formulario de cierre personalizado."}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 pt-4 border-t border-slate-100">
              <input
                type="checkbox"
                id="isRateCardModal"
                checked={newTaskIsRateCard}
                onChange={(e) => setNewTaskIsRateCard(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <label
                htmlFor="isRateCardModal"
                className="text-sm font-medium text-slate-700 cursor-pointer"
              >
                Vincular a un perfil de Rate Card
              </label>
            </div>

            {newTaskIsRateCard && (
              <div className="grid grid-cols-2 gap-4 p-4 bg-emerald-50 rounded-xl border border-emerald-100 animate-in slide-in-from-top-2 duration-200">
                <div className="col-span-2 space-y-2">
                  <label className="text-xs font-bold text-emerald-600 uppercase tracking-wider">
                    Tipo de asignación
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold ${newTaskRateCardMode === "static" ? "border-emerald-400 bg-white text-emerald-700" : "border-emerald-100 bg-emerald-50/60 text-slate-500"}`}>
                      <input
                        type="radio"
                        name="taskRateCardMode"
                        value="static"
                        checked={newTaskRateCardMode === "static"}
                        onChange={() => setNewTaskRateCardMode("static")}
                        className="h-3.5 w-3.5 text-emerald-600"
                      />
                      Rate Card fijo
                    </label>
                    <label className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold ${newTaskRateCardMode === "dynamic" ? "border-emerald-400 bg-white text-emerald-700" : "border-emerald-100 bg-emerald-50/60 text-slate-500"}`}>
                      <input
                        type="radio"
                        name="taskRateCardMode"
                        value="dynamic"
                        checked={newTaskRateCardMode === "dynamic"}
                        onChange={() => setNewTaskRateCardMode("dynamic")}
                        className="h-3.5 w-3.5 text-emerald-600"
                      />
                      Dinámico al completar
                    </label>
                  </div>
                </div>

                {newTaskRateCardMode === "static" && (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-emerald-600 uppercase tracking-wider">
                    Seleccionar Perfil
                  </label>
                  <select
                    value={newTaskRateCardId}
                    onChange={(e) => {
                      setNewTaskRateCardId(e.target.value);
                      const rc = rateCards.find((r) => r.id === e.target.value);
                      if (rc) setNewTaskIndicator(rc.indicator);
                    }}
                    className="w-full h-11 px-4 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                    required={newTaskIsRateCard && newTaskRateCardMode === "static"}
                  >
                    <option value="">Seleccionar...</option>
                    {rateCards.map((rc) => (
                      <option key={rc.id} value={rc.id}>
                        {rc.name}
                      </option>
                    ))}
                  </select>
                </div>
                )}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-emerald-600 uppercase tracking-wider">
                    {newTaskRateCardMode === "dynamic" ? "Unidades sugeridas" : "Unidades a sumar"}
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    pattern="[0-9]*[.,]?[0-9]*"
                    value={newTaskUnitsToAdd}
                    onChange={(e) =>
                      setNewTaskUnitsToAdd(e.target.value)
                    }
                    className="w-full h-10 px-3 rounded-lg border border-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-sm"
                    placeholder="Ej. 0,051"
                    title="Puedes usar coma o punto decimal. Ejemplo: 0,051 o 0.051"
                    required={newTaskIsRateCard}
                  />
                  <p className="text-[10px] font-bold text-emerald-700">
                    Puedes usar coma o punto decimal. Ejemplo: 0,051 o 0.051.
                  </p>
                </div>
                {newTaskRateCardMode === "dynamic" && (
                  <div className="col-span-2 flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-emerald-100 bg-white px-3 py-2">
                    <label className="flex items-center gap-2 text-xs font-bold text-emerald-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newTaskDynamicAutoAddUnits}
                        onChange={(e) => setNewTaskDynamicAutoAddUnits(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-emerald-200 text-emerald-600 focus:ring-emerald-500"
                      />
                      Sumar auto.
                    </label>
                    <span className="min-w-0 flex-1 text-[10px] text-emerald-600">
                      {newTaskDynamicAutoAddUnits
                        ? "Al finalizar se pedirá persona y perfil; las unidades se tomarán de este valor."
                        : "Al finalizar se pedirá persona, perfil y unidades."}
                    </span>
                  </div>
                )}
                <p className="col-span-2 text-[10px] text-emerald-600">
                  {newTaskRateCardMode === "dynamic"
                    ? "El cargo se guardará en un historial por persona, día, semana y mes para reportes."
                    : isWorkflowTypeSelected
                    ? "Las unidades se sumarán automáticamente al finalizar todo el workflow."
                    : "Las unidades se sumarán proporcionalmente al progreso de la tarea."}
                </p>
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              className="flex-1 h-12 rounded-xl border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isCreatingTask}
              className="flex-1 h-12 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold"
            >
              {isCreatingTask ? (
                <Loader2 className="animate-spin" size={20} />
              ) : (
                "Crear Tarea"
              )}
            </Button>
          </div>
        </form>
      </div>

      {isFormBuilderOpen && currentStepIndexForForm !== null && (
        <WorkflowStepFormBuilderModal
          isOpen={isFormBuilderOpen}
          onClose={() => {
            setIsFormBuilderOpen(false);
            setCurrentStepIndexForForm(null);
          }}
          stepName={
            workflowSteps[currentStepIndexForForm]?.label ||
            `Paso ${currentStepIndexForForm + 1}`
          }
          initialForm={workflowSteps[currentStepIndexForForm]?.form}
          rateCards={rateCards}
          teamMembers={teamMembers}
          projectId={projectId}
          project={project}
          onSave={(form) => {
            const newSteps = [...workflowSteps];
            newSteps[currentStepIndexForForm].form = form;
            setWorkflowSteps(newSteps);
          }}
        />
      )}

      {isIncrementFormBuilderOpen && (
        <WorkflowStepFormBuilderModal
          isOpen={isIncrementFormBuilderOpen}
          onClose={() => setIsIncrementFormBuilderOpen(false)}
          stepName={newTaskTitle || "Incremento de contador"}
          initialForm={incrementForm}
          rateCards={rateCards}
          teamMembers={teamMembers}
          projectId={projectId}
          project={project}
          allowDynamicRateCard={false}
          onSave={(form) => setIncrementForm(form)}
        />
      )}

      {isSubtaskFormBuilderOpen && currentSubtaskIndexForForm !== null && (
        <WorkflowStepFormBuilderModal
          isOpen={isSubtaskFormBuilderOpen}
          onClose={() => {
            setIsSubtaskFormBuilderOpen(false);
            setCurrentSubtaskIndexForForm(null);
          }}
          stepName={
            draftSubtasks[currentSubtaskIndexForForm]?.title ||
            `Subtarea ${currentSubtaskIndexForForm + 1}`
          }
          initialForm={draftSubtasks[currentSubtaskIndexForForm]?.completionForm}
          rateCards={rateCards}
          teamMembers={teamMembers}
          projectId={projectId}
          project={project}
          onSave={(form) => {
            if (currentSubtaskIndexForForm === null) return;
            const next = [...draftSubtasks];
            next[currentSubtaskIndexForForm] = {
              ...next[currentSubtaskIndexForForm],
              completionForm: form,
            };
            setDraftSubtasks(next);
          }}
        />
      )}

      {/* Save Template Modal */}
      {showTemplateModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <ClipboardList className="text-indigo-600" size={24} />
                Guardar Plantilla
              </h2>
              <button
                onClick={() => setShowTemplateModal(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X size={24} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-sm font-bold text-slate-700 mb-1 block">
                  Nombre de la Plantilla
                </label>
                <input
                  type="text"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="Ej. Flujo de Aprobación Estándar"
                  className="w-full h-11 px-4 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                />
                <p className="mt-2 text-xs text-slate-500">
                  Si usas el nombre de una plantilla existente, se pedirá confirmación para reescribirla.
                </p>
              </div>
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
                    <Loader2 size={16} className="animate-spin mr-2" />{" "}
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
