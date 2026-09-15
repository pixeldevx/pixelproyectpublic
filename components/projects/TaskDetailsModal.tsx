import React, { useState, useEffect, useMemo } from 'react';
import { X, Save, CheckCircle2, Circle, RotateCcw, BookOpen, CalendarDays, Download, ExternalLink, MapPin, Paperclip, Users } from 'lucide-react';
import { doc, serverTimestamp, collection, writeBatch, arrayUnion, Timestamp } from '@/lib/supabase/document-store';
import { auth, db } from '@/lib/backend';
import { toast } from 'sonner';
import {
  getStaticRateCardAssignee,
  getStaticRateCardSources,
  isInvalidRateCardUnits,
  normalizeRateCardUnits,
} from '@/lib/rate-card-config';
import { getTaskDisplayTitle, getTaskTitle } from '@/lib/task-title';
import { getCompletionStatusForTask, isCompletedTaskStatus } from '@/lib/taskProgress';
import { addTraceableRateCardMovementToBatch, parseRateCardTraceDate } from '@/lib/rate-card-trace';
import { syncRateDrivenIncrementalTasksForRate } from '@/lib/incremental-rate-tasks';
import { notifyTaskAssignment } from '@/lib/notifications';
import {
  createGoogleCalendarUrl,
  downloadMeetingIcs,
  getMeetingAgenda,
  getMeetingDescription,
  getMeetingLocation,
  getMeetingRecurrenceLabel,
  getMeetingScheduleLabel,
  isMeetingLocationUrl,
  isMeetingTask,
} from '@/lib/calendar-utils';
import {
  isDynamicWorkflowAssignee,
  isActiveWorkflowStepStatus,
  isVariableWorkflowTaskType,
  isWorkflowTaskType,
  normalizeWorkflowParallelRoutes,
  resolveWorkflowActiveStepIndex,
  resolveWorkflowNextStepIndexes,
} from '@/lib/workflow-routing';
import { TaskDocumentsViewer } from '@/components/projects/TaskDocumentsViewer';

const normalizeEmail = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

interface TaskDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: any;
  projectId: string;
  project?: any;
  tasks?: any[];
  currentUser?: any;
  teamMembers?: any[];
  canViewDocuments?: boolean;
  canUploadDocuments?: boolean;
  canManageDocumentAccess?: boolean;
  canDeleteDocuments?: boolean;
  onResetWorkflowTask?: (task: any) => void | Promise<void>;
}

export const TaskDetailsModal: React.FC<TaskDetailsModalProps> = ({
  isOpen,
  onClose,
  task,
  projectId,
  project,
  tasks = [],
  currentUser,
  teamMembers = [],
  canViewDocuments = false,
  canUploadDocuments = false,
  canManageDocumentAccess = false,
  canDeleteDocuments = false,
  onResetWorkflowTask,
}) => {
  const [documentation, setDocumentation] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [workflowSteps, setWorkflowSteps] = useState<any[]>([]);
  const [stepUnitPrompt, setStepUnitPrompt] = useState<{
    index: number;
    unitsByKey: Record<string, string>;
    assigneesByKey: Record<string, string>;
    requiresNextAssignee?: boolean;
    nextAssignee?: string;
  } | null>(null);
  const [pendingNextStepNotifications, setPendingNextStepNotifications] = useState<Array<{
    sourceStepIndex: number;
    stepIndex: number;
    assigneeId: string;
  }>>([]);
  const [additionalCycles, setAdditionalCycles] = useState(1);
  const [isAddingCycles, setIsAddingCycles] = useState(false);
  const [isAttachmentsOpen, setIsAttachmentsOpen] = useState(false);
  const documentTask = useMemo(
    () => task ? { ...task, projectId: task.projectId || projectId } : null,
    [projectId, task],
  );

  useEffect(() => {
    if (task) {
      setDocumentation(task.documentation || "");
      setWorkflowSteps(task.workflowSteps || []);
      setAdditionalCycles(1);
      setStepUnitPrompt(null);
      setPendingNextStepNotifications([]);
      setIsAttachmentsOpen(false);
    }
  }, [task]);

  const getCurrentActorName = () => {
    const currentUser = auth.currentUser;
    const currentEmail = normalizeEmail(currentUser?.email);
    const currentId = currentUser?.uid;
    const actor = teamMembers.find((member) => {
      if (!member) return false;
      if (currentEmail && normalizeEmail(member.email) === currentEmail) return true;
      return currentId && [member.id, member.uid, member.authUserId].includes(currentId);
    });

    return (
      actor?.name ||
      actor?.displayName ||
      currentUser?.email ||
      currentUser?.displayName ||
      "Usuario"
    );
  };

  if (!isOpen || !task) return null;

  const canResetWorkflow = Boolean(
    onResetWorkflowTask &&
    isWorkflowTaskType(task.type) &&
    !task.isParentTask &&
    (task.status !== "todo" || (task.progress || 0) > 0 || task.externalWorkflowId)
  );

  const handleAddCycles = async () => {
    if (additionalCycles <= 0) return;
    setIsAddingCycles(true);
    try {
      const batch = writeBatch(db);
      const parentRef = doc(db, "projects", projectId, "tasks", task.id);

      let currentTotalCycles = task.totalCycles || 1;
      const newTotalCycles = currentTotalCycles + additionalCycles;
      const baseTaskTitle = getTaskTitle(task);

      const { id, ...taskWithoutId } = task;

      // If it wasn't a parent task before, we need to convert it and create the first cycle subtask
      if (!task.isParentTask) {
        batch.update(parentRef, {
          isParentTask: true,
          totalCycles: newTotalCycles,
          workflowCycles: newTotalCycles,
          updatedAt: serverTimestamp(),
        });

        // Create Ciclo 1 with the current task's progress and status
        const cycle1Ref = doc(collection(db, "projects", projectId, "tasks"));
        const cycle1Data = {
          ...taskWithoutId,
          title: baseTaskTitle,
          name: baseTaskTitle,
          isParentTask: false,
          parentTaskId: task.id,
          cycleNumber: 1,
          displayOrder: (task.displayOrder || 0) + 1,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        batch.set(cycle1Ref, cycle1Data);
      } else {
        batch.update(parentRef, {
          totalCycles: newTotalCycles,
          workflowCycles: newTotalCycles,
          updatedAt: serverTimestamp(),
        });
      }

      // Add new subtasks for the additional cycles
      for (let i = 1; i <= additionalCycles; i++) {
        const cycleNumber = currentTotalCycles + i;
        const subTaskRef = doc(collection(db, "projects", projectId, "tasks"));

        const subTaskData = {
          ...taskWithoutId,
          title: baseTaskTitle.replace(/ \(Ciclo \d+\)$/, ""),
          name: baseTaskTitle.replace(/ \(Ciclo \d+\)$/, ""),
          isParentTask: false,
          parentTaskId: task.id,
          cycleNumber: cycleNumber,
          displayOrder: (task.displayOrder || 0) + cycleNumber,
          status: "todo",
          progress: 0,
          currentStepIndex: 0,
          workflowHistory: [],
          workflowSteps:
            task.workflowSteps?.map((step: any) => {
              const { formData, ...cleanStep } = step;
              return { ...cleanStep, completed: false, status: "not_started" };
            }) || [],
          startDocumentId: null,
          linkedDocumentId: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        batch.set(subTaskRef, subTaskData);
      }

      await batch.commit();

      // Update parent task status and progress based on the new subtasks
      const { updateParentTaskStatus } = await import("@/lib/taskUtils");
      await updateParentTaskStatus(projectId, task.id);

      toast.success(
        `Se agregaron ${additionalCycles} repeticiones exitosamente.`,
      );
      setAdditionalCycles(1);
      onClose();
    } catch (error) {
      console.error("Error adding cycles:", error);
      toast.error("Error al agregar repeticiones.");
    } finally {
      setIsAddingCycles(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const batch = writeBatch(db);
      const taskRef = doc(db, "projects", projectId, "tasks", task.id);
      const actionAt = new Date();
      const currentActor = {
        id: auth.currentUser?.uid || null,
        email: auth.currentUser?.email || null,
        name: getCurrentActorName(),
      };
      const affectedRateCardIds = new Set<string>();

      // Calculate progress and status for workflow tasks
      let newProgress = task.progress;
      let newStatus = task.status;
      let newCurrentStepIndex = task.currentStepIndex || 0;

      if (isWorkflowTaskType(task.type) && workflowSteps.length > 0) {
        const approvedCount = workflowSteps.filter(
          (s) => s.status === "listo",
        ).length;
        newProgress = Math.round((approvedCount / workflowSteps.length) * 100);
        newCurrentStepIndex = resolveWorkflowActiveStepIndex({
          steps: workflowSteps,
          currentIndex: task.currentStepIndex || 0,
        });

        if (newProgress === 100) {
          newStatus = getCompletionStatusForTask("completed", task);
        } else if (newProgress > 0) {
          newStatus = "in_progress";
        } else {
          // If the task was already in progress or stuck, don't revert to todo
          if (task.status === "in_progress" || task.status === "stuck") {
            newStatus = task.status;
          } else {
            newStatus = "todo";
          }
        }
      }

      // Handle Rate Card updates
      // 1. Check step-level rate card changes
      const oldSteps = task.workflowSteps || [];
      workflowSteps.forEach((step, idx) => {
        const oldStep = oldSteps[idx];
        const wasApproved = oldStep?.status === "listo";
        const isApproved = step.status === "listo";

        const rateCardSources = getStaticRateCardSources(step);

        if (wasApproved !== isApproved && rateCardSources.length > 0) {
          rateCardSources.forEach((rateCardSource) => {
            const units = normalizeRateCardUnits(rateCardSource.unitsToAdd);
            const stepAssignee = getStaticRateCardAssignee(rateCardSource, step.assignedTo);
            const movement = addTraceableRateCardMovementToBatch(batch, {
              projectId,
              task,
              rateCardId: rateCardSource.rateCardId,
              assignedTo: stepAssignee,
              units,
              source: isApproved
                ? "workflow_step_manual_approval"
                : "workflow_step_manual_reversal",
              rateCardSourceKey: rateCardSource.key,
              stepIndex: idx,
              stepName: step?.name || step?.title || `Paso ${idx + 1}`,
              comment: isApproved
                ? "Rate Card registrado al aprobar manualmente el paso desde detalles de la tarea."
                : "Reversión del Rate Card al devolver manualmente el paso desde detalles de la tarea.",
              occurredAt: isApproved
                ? parseRateCardTraceDate(step?.completedAt) || actionAt
                : actionAt,
              actor: currentActor,
              reversal: !isApproved,
              completionMode: "manual_workflow_step",
            });
            if (movement) affectedRateCardIds.add(rateCardSource.rateCardId);
          });
        }
      });

      // 2. Check task-level rate card changes (when whole workflow completes)
      if (isWorkflowTaskType(task.type) && task.isRateCardTask && task.rateCardId) {
        const wasAllApproved =
          oldSteps.length > 0 &&
          oldSteps.every((s: any) => s.status === "listo");
        const isAllApproved =
          workflowSteps.length > 0 &&
          workflowSteps.every((s: any) => s.status === "listo");

        if (wasAllApproved !== isAllApproved) {
          const units = normalizeRateCardUnits(task.unitsToAdd);
          const movement = addTraceableRateCardMovementToBatch(batch, {
            projectId,
            task,
            rateCardId: task.rateCardId,
            assignedTo: task.assignedTo || null,
            units,
            source: isAllApproved
              ? "workflow_task_manual_completion"
              : "workflow_task_manual_reversal",
            rateCardSourceKey: "task:workflow-completion",
            comment: isAllApproved
              ? "Rate Card registrado al finalizar manualmente todos los pasos del workflow."
              : "Reversión del Rate Card al reabrir manualmente el workflow.",
            occurredAt: actionAt,
            actor: currentActor,
            reversal: !isAllApproved,
            completionMode: "manual_workflow_task",
          });
          if (movement) affectedRateCardIds.add(task.rateCardId);
        }
      }

      const taskUpdate: any = {
        documentation,
        workflowSteps,
        progress: newProgress,
        status: newStatus,
        updatedAt: serverTimestamp(),
        updatedBy: currentActor.id,
        updatedByEmail: currentActor.email,
      };

      const wasCompleted = isCompletedTaskStatus(task.status);
      const isCompleted = isCompletedTaskStatus(newStatus);
      if (!wasCompleted && isCompleted) {
        taskUpdate.completedAt = Timestamp.fromDate(actionAt);
        taskUpdate.completedBy = currentActor.id;
        taskUpdate.completedByEmail = currentActor.email;
      } else if (wasCompleted && !isCompleted) {
        taskUpdate.completedAt = null;
        taskUpdate.completedBy = null;
        taskUpdate.completedByEmail = null;
      }

      if (isWorkflowTaskType(task.type)) {
        taskUpdate.currentStepIndex = newCurrentStepIndex;

        if (pendingNextStepNotifications.length > 0) {
          taskUpdate.workflowHistory = arrayUnion(
            ...pendingNextStepNotifications.map((notification) => ({
              stepIndex: notification.sourceStepIndex,
              userId: auth.currentUser?.uid || null,
              userEmail: auth.currentUser?.email || null,
              userName: getCurrentActorName(),
              action: "approve",
              comment:
                "Avance manual desde detalles de la tarea. Se asignó una rama del workflow.",
              nextStepAssignee: notification.assigneeId,
              nextStepIndex: notification.stepIndex,
              timestamp: Timestamp.now(),
            }))
          );
        }
      }

      batch.update(taskRef, taskUpdate);

      await batch.commit();

      await Promise.all(
        Array.from(affectedRateCardIds).map((rateCardId) =>
          syncRateDrivenIncrementalTasksForRate({ projectId, rateCardId })
        ),
      );

      if (pendingNextStepNotifications.length > 0) {
        pendingNextStepNotifications.forEach((notification) => {
          void notifyTaskAssignment({
            projectId,
            taskId: task.id,
            assigneeId: notification.assigneeId,
            stepIndex: notification.stepIndex,
            eventType: "workflow_step_assigned",
            source: "task_details_manual_advance",
          });
        });
        setPendingNextStepNotifications([]);
      }

      if (task.parentTaskId) {
        const { updateParentTaskStatus } = await import("@/lib/taskUtils");
        await updateParentTaskStatus(projectId, task.parentTaskId);
      }

      onClose();
      toast.success("Tarea actualizada correctamente");
    } catch (error) {
      console.error("Error saving task details:", error);
      toast.error("Error al guardar los detalles de la tarea.");
    } finally {
      setIsSaving(false);
    }
  };

  const toggleStep = (index: number) => {
    if (task.isParentTask) {
      toast.info(
        "No puedes modificar los pasos de una tarea madre. Modifica las subtareas.",
      );
      return;
    }
    const newSteps = [...workflowSteps];
    const currentStatus = newSteps[index].status || "not_started";
    const step = newSteps[index];

    const manualRateCardSources = getStaticRateCardSources(step).filter(
      (source) => source.autoAddUnits === false
    );
    const runtimeRateCardSources = getStaticRateCardSources(step).filter(
      (source) => source.assigneeMode === "runtime"
    );
    const plannedNextIndexes = resolveWorkflowNextStepIndexes({
      steps: newSteps,
      currentIndex: index,
      formData: step?.formData || {},
    });
    const plannedNextStepRequiresDynamicAssignee = plannedNextIndexes.some(
      (nextIndex) => isDynamicWorkflowAssignee(newSteps[nextIndex]?.assignedTo)
    );
    const requiresNextAssignee = Boolean(
      plannedNextIndexes.length > 0 && (step.assignsNextStep || plannedNextStepRequiresDynamicAssignee)
    );

    if (
      currentStatus !== "listo" &&
      (manualRateCardSources.length > 0 ||
        runtimeRateCardSources.length > 0 ||
        requiresNextAssignee)
    ) {
      setStepUnitPrompt({
        index,
        unitsByKey: Object.fromEntries(
          manualRateCardSources.map((source) => [source.key, String(normalizeRateCardUnits(source.unitsToAdd))])
        ),
        assigneesByKey: Object.fromEntries(
          runtimeRateCardSources.map((source) => [source.key, source.assignedTo || ""])
        ),
        requiresNextAssignee,
        nextAssignee: "",
      });
      return;
    }

    const nextStatus = currentStatus === "listo" ? "not_started" : "listo";
    newSteps[index] = {
      ...newSteps[index],
      status: nextStatus,
      ...(nextStatus === "listo"
        ? {
            completedAt: new Date(),
            completedBy: auth.currentUser?.uid || null,
          }
        : {}),
    };

    const resolvedNextIndexes =
      nextStatus === "listo"
        ? resolveWorkflowNextStepIndexes({
            steps: newSteps,
            currentIndex: index,
            formData: newSteps[index]?.formData || {},
          })
        : [];

    if (nextStatus === "listo") {
      resolvedNextIndexes.forEach((nextIndex) => {
        const nextStepWasCompleted = newSteps[nextIndex]?.status === "listo";
        const shouldReopenCompletedStep = Boolean(isVariableWorkflowTaskType(task.type) && nextStepWasCompleted);
        const nextStepAlreadyActive = isActiveWorkflowStepStatus(newSteps[nextIndex]?.status);
        newSteps[nextIndex] = {
          ...newSteps[nextIndex],
          status: shouldReopenCompletedStep
            ? "reproceso"
            : nextStepWasCompleted
              ? "listo"
              : nextStepAlreadyActive
                ? newSteps[nextIndex]?.status
                : "en_curso",
          completedAt: shouldReopenCompletedStep ? null : newSteps[nextIndex]?.completedAt,
          completedBy: shouldReopenCompletedStep ? null : newSteps[nextIndex]?.completedBy,
          completedByMemberId: shouldReopenCompletedStep ? null : newSteps[nextIndex]?.completedByMemberId,
          completedByIds: shouldReopenCompletedStep ? [] : newSteps[nextIndex]?.completedByIds,
          restartedAt: shouldReopenCompletedStep ? new Date() : newSteps[nextIndex]?.restartedAt,
          startedAt: shouldReopenCompletedStep ? new Date() : newSteps[nextIndex]?.startedAt || new Date(),
          assignedAt: new Date(),
        };
      });
    }

    if (nextStatus !== "listo") {
      setPendingNextStepNotifications((current) =>
        current.filter((notification) => notification.sourceStepIndex !== index)
      );
    }

    setWorkflowSteps(newSteps);
  };

  const confirmStepUnitToggle = () => {
    if (!stepUnitPrompt) return;
    const newSteps = [...workflowSteps];
    const currentStep = newSteps[stepUnitPrompt.index];
    const sources = getStaticRateCardSources(currentStep);
    const manualSources = sources.filter((source) => source.autoAddUnits === false);
    const runtimeSources = sources.filter((source) => source.assigneeMode === "runtime");
    if (manualSources.some((source) => isInvalidRateCardUnits(stepUnitPrompt.unitsByKey[source.key]))) {
      toast.warning("Define unidades de Rate Card en cero o mayores para cada indicador manual.");
      return;
    }
    if (runtimeSources.some((source) => !stepUnitPrompt.assigneesByKey[source.key])) {
      toast.warning("Selecciona el profesional para cada Rate Card que se asigna al ejecutar.");
      return;
    }
    if (stepUnitPrompt.requiresNextAssignee && !stepUnitPrompt.nextAssignee) {
      toast.warning("Selecciona el responsable del siguiente paso.");
      return;
    }
    let updatedStep = { ...currentStep };

    sources.forEach((source) => {
      const units = normalizeRateCardUnits(stepUnitPrompt.unitsByKey[source.key], 0);
      const assignedTo = stepUnitPrompt.assigneesByKey[source.key] || "";
      const updates: any = {};
      if (source.autoAddUnits === false) updates.unitsToAdd = units;
      if (source.assigneeMode === "runtime" && assignedTo) updates.assignedTo = assignedTo;
      if (Object.keys(updates).length === 0) return;

      if (source.source === "form") {
        if (typeof source.itemIndex === "number" && Array.isArray(updatedStep.form?.rateCards)) {
          updatedStep = {
            ...updatedStep,
            form: {
              ...updatedStep.form,
              rateCards: updatedStep.form.rateCards.map((item: any, itemIndex: number) =>
                itemIndex === source.itemIndex ? { ...item, ...updates } : item
              ),
            },
          };
        } else {
          updatedStep = {
            ...updatedStep,
            form: {
              ...updatedStep.form,
              ...updates,
            },
          };
        }
        return;
      }

      if (typeof source.itemIndex === "number" && Array.isArray(updatedStep.rateCards)) {
        updatedStep = {
          ...updatedStep,
          rateCards: updatedStep.rateCards.map((item: any, itemIndex: number) =>
            itemIndex === source.itemIndex ? { ...item, ...updates } : item
          ),
        };
      } else {
        updatedStep = {
          ...updatedStep,
          ...updates,
        };
      }
    });

    newSteps[stepUnitPrompt.index] = {
      ...updatedStep,
      status: "listo",
      completedAt: new Date(),
      completedBy: auth.currentUser?.uid || null,
    };

    const nextIndexes = resolveWorkflowNextStepIndexes({
      steps: newSteps,
      currentIndex: stepUnitPrompt.index,
      formData: newSteps[stepUnitPrompt.index]?.formData || {},
    });

    if (nextIndexes.length > 0) {
      const pendingNotifications: Array<{ sourceStepIndex: number; stepIndex: number; assigneeId: string }> = [];

      nextIndexes.forEach((nextIndex) => {
        const shouldAssignRuntimeOwner = Boolean(
          stepUnitPrompt.requiresNextAssignee &&
          stepUnitPrompt.nextAssignee &&
          (currentStep.assignsNextStep || isDynamicWorkflowAssignee(newSteps[nextIndex]?.assignedTo))
        );
        const nextStepWasCompleted = newSteps[nextIndex]?.status === "listo";
        const shouldReopenCompletedStep = Boolean(isVariableWorkflowTaskType(task.type) && nextStepWasCompleted);
        const nextStepAlreadyActive = isActiveWorkflowStepStatus(newSteps[nextIndex]?.status);

        newSteps[nextIndex] = {
          ...newSteps[nextIndex],
          status: shouldReopenCompletedStep
            ? "reproceso"
            : nextStepWasCompleted
              ? "listo"
              : nextStepAlreadyActive
                ? newSteps[nextIndex]?.status
                : "en_curso",
          completedAt: shouldReopenCompletedStep ? null : newSteps[nextIndex]?.completedAt,
          completedBy: shouldReopenCompletedStep ? null : newSteps[nextIndex]?.completedBy,
          completedByMemberId: shouldReopenCompletedStep ? null : newSteps[nextIndex]?.completedByMemberId,
          completedByIds: shouldReopenCompletedStep ? [] : newSteps[nextIndex]?.completedByIds,
          restartedAt: shouldReopenCompletedStep ? new Date() : newSteps[nextIndex]?.restartedAt,
          startedAt: shouldReopenCompletedStep ? new Date() : newSteps[nextIndex]?.startedAt || new Date(),
          assignedAt: new Date(),
          ...(shouldAssignRuntimeOwner
            ? { assignedTo: stepUnitPrompt.nextAssignee }
            : {}),
        };

        if (shouldAssignRuntimeOwner && stepUnitPrompt.nextAssignee) {
          pendingNotifications.push({
            sourceStepIndex: stepUnitPrompt.index,
            stepIndex: nextIndex,
            assigneeId: stepUnitPrompt.nextAssignee,
          });
        }
      });

      setPendingNextStepNotifications(pendingNotifications);
    } else {
      setPendingNextStepNotifications((current) =>
        current.filter((notification) => notification.sourceStepIndex !== stepUnitPrompt.index)
      );
    }

    setWorkflowSteps(newSteps);
    setStepUnitPrompt(null);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 p-6 border-b border-slate-100">
          <div>
            <h2 className="text-xl font-bold text-slate-800">
              {getTaskDisplayTitle(task)}
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Detalles y Documentación
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {canViewDocuments && (
              <button
                type="button"
                onClick={() => setIsAttachmentsOpen(true)}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-indigo-100 bg-indigo-50 px-3 text-sm font-bold text-indigo-700 transition-colors hover:border-indigo-200 hover:bg-indigo-100"
              >
                <Paperclip size={15} className="mr-2" />
                Adjuntos
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {isMeetingTask(task) && (
            <div className="rounded-xl border border-cyan-100 bg-cyan-50 p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="rounded-lg bg-white p-2 text-cyan-700 shadow-sm">
                      <CalendarDays size={18} />
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-cyan-700">
                        Reunión programada
                      </p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">
                        {getMeetingScheduleLabel(task)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                    <span className="inline-flex min-w-0 items-center gap-2 rounded-lg bg-white/70 px-3 py-2">
                      <CalendarDays size={14} className="shrink-0 text-cyan-700" />
                      {getMeetingRecurrenceLabel(task)}
                    </span>
                    {getMeetingLocation(task) && (
                      <span className="inline-flex min-w-0 items-center gap-2 rounded-lg bg-white/70 px-3 py-2">
                        <MapPin size={14} className="shrink-0 text-cyan-700" />
                        {isMeetingLocationUrl(task) ? (
                          <a
                            href={getMeetingLocation(task)}
                            target="_blank"
                            rel="noreferrer"
                            className="min-w-0 truncate font-bold text-cyan-800 underline decoration-cyan-300 underline-offset-2"
                          >
                            {getMeetingLocation(task)}
                          </a>
                        ) : (
                          <span className="min-w-0 truncate">{getMeetingLocation(task)}</span>
                        )}
                      </span>
                    )}
                    {Array.isArray(task.meeting?.attendees) && task.meeting.attendees.length > 0 && (
                      <span className="inline-flex min-w-0 items-center gap-2 rounded-lg bg-white/70 px-3 py-2 sm:col-span-2">
                        <Users size={14} className="shrink-0 text-cyan-700" />
                        <span className="truncate">
                          {task.meeting.attendees.map((attendee: any) => attendee.name || attendee.email).join(", ")}
                        </span>
                      </span>
                    )}
                  </div>
                  {getMeetingDescription(task) && (
                    <div className="mt-3 rounded-lg border border-cyan-100 bg-white/70 p-3">
                      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-cyan-700">Descripción</p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700 [overflow-wrap:anywhere]">
                        {getMeetingDescription(task)}
                      </p>
                    </div>
                  )}
                  {getMeetingAgenda(task) && (
                    <div className="mt-3 rounded-lg border border-cyan-100 bg-white/70 p-3">
                      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-cyan-700">Agenda</p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700 [overflow-wrap:anywhere]">
                        {getMeetingAgenda(task)}
                      </p>
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => downloadMeetingIcs(task)}
                    className="inline-flex h-9 items-center justify-center rounded-lg border border-cyan-200 bg-white px-3 text-xs font-bold text-cyan-700 transition-colors hover:bg-cyan-50"
                  >
                    <Download size={14} className="mr-2" />
                    .ics
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const url = createGoogleCalendarUrl(task);
                      if (url) window.open(url, "_blank", "noopener,noreferrer");
                    }}
                    className="inline-flex h-9 items-center justify-center rounded-lg bg-cyan-700 px-3 text-xs font-bold text-white transition-colors hover:bg-cyan-800"
                  >
                    <ExternalLink size={14} className="mr-2" />
                    Google Calendar
                  </button>
                </div>
              </div>
            </div>
          )}

          {task.originLogbook && (
            <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-white p-2 text-indigo-600">
                  <BookOpen size={18} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wider text-indigo-600">
                    Origen en bitácora
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-800">
                    {task.originLogbook.entryTitle || "Entrada de bitácora"}
                  </p>
                  {task.originLogbook.candidateText && (
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                      {task.originLogbook.candidateText}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Workflow Steps */}
          {workflowSteps.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-800 mb-4 uppercase tracking-wider">
                Pasos del Flujo de Trabajo
              </h3>
              <div className="space-y-2">
                {workflowSteps.map((step, index) => {
                  const isApproved = step.status === "listo";
                  const parallelRoutes = normalizeWorkflowParallelRoutes(step.parallelRoutes || step.parallelNextStepIndexes || []);
                  const statusLabel =
                    step.status === "en_curso"
                      ? "En curso"
                      : step.status === "listo"
                        ? "Listo"
                        : "Pendiente";
                  return (
                    <div
                      key={index}
                      onClick={() => toggleStep(index)}
                      className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                        task.isParentTask
                          ? "cursor-not-allowed opacity-70"
                          : "cursor-pointer"
                      } ${
                        isApproved
                          ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                          : "bg-white border-slate-200 hover:border-indigo-300"
                      }`}
                    >
                      {isApproved ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                      ) : (
                        <Circle className="w-5 h-5 text-slate-300 shrink-0" />
                      )}
                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p
                            className={`font-medium ${isApproved ? "line-through opacity-70" : "text-slate-700"}`}
                          >
                            {step.label}
                          </p>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                            isApproved
                              ? "bg-emerald-100 text-emerald-700"
                              : step.status === "en_curso"
                                ? "bg-indigo-100 text-indigo-700"
                                : "bg-slate-100 text-slate-500"
                          }`}>
                            {statusLabel}
                          </span>
                          {parallelRoutes.length > 0 && (
                            <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-cyan-700">
                              Abre {parallelRoutes.length} paralelo{parallelRoutes.length === 1 ? "" : "s"}
                            </span>
                          )}
                          {step.finishWorkflowOnComplete && (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-700">
                              Finaliza flujo
                            </span>
                          )}
                        </div>
                        {step.assignedTo && (
                          <p className="text-xs opacity-70 mt-0.5">
                            Asignado a: {step.assignedTo}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {canResetWorkflow && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-amber-900">
                    Reiniciar flujo
                  </h3>
                  <p className="mt-1 text-xs text-amber-700">
                    Devuelve esta tarea a pendiente y limpia el radicado, avance y pasos iniciados.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void onResetWorkflowTask?.(task);
                  }}
                  className="inline-flex h-9 items-center justify-center rounded-lg bg-amber-600 px-3 text-sm font-medium text-white transition-colors hover:bg-amber-700"
                >
                  <RotateCcw size={15} className="mr-2" />
                  Reiniciar
                </button>
              </div>
            </div>
          )}

          {/* Documentation */}
          <div>
            <h3 className="text-sm font-semibold text-slate-800 mb-4 uppercase tracking-wider">
              Documentación
            </h3>
            <textarea
              value={documentation}
              onChange={(e) => setDocumentation(e.target.value)}
              placeholder="Escribe aquí la documentación, notas o resultados de esta tarea..."
              className="w-full h-64 p-4 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none text-slate-700"
            />
          </div>

          {/* Add Cycles for Workflow Tasks */}
          {(task.isParentTask ||
            (isWorkflowTaskType(task.type) && !task.parentTaskId)) && (
            <div className="pt-6 border-t border-slate-100">
              <h3 className="text-sm font-semibold text-slate-800 mb-4 uppercase tracking-wider">
                Agregar Repeticiones (Sub-tareas)
              </h3>
              <div className="flex items-center gap-4 bg-indigo-50/50 p-4 rounded-xl border border-indigo-100">
                <div className="flex-1">
                  <p className="text-sm text-slate-700 mb-2">
                    Esta tarea tiene actualmente{" "}
                    <strong>{task.totalCycles || 1}</strong> repeticiones.
                    ¿Deseas agregar más?
                  </p>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      min="1"
                      value={additionalCycles}
                      onChange={(e) =>
                        setAdditionalCycles(Number(e.target.value))
                      }
                      className="w-24 h-10 px-3 rounded-lg border border-indigo-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                    />
                    <button
                      onClick={handleAddCycles}
                      disabled={isAddingCycles || additionalCycles <= 0}
                      className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                    >
                      {isAddingCycles ? "Agregando..." : "Agregar Repeticiones"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-200 rounded-lg transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-6 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
          >
            <Save size={16} />
            {isSaving ? "Guardando..." : "Guardar Cambios"}
          </button>
        </div>
      </div>

      {stepUnitPrompt && (
        <div className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold text-slate-800 mb-2">
              Completar paso
            </h3>
            <p className="text-sm text-slate-500 mb-4">
              Completa los datos requeridos antes de adelantar el workflow.
            </p>
            <div className="mb-6 space-y-3">
              {getStaticRateCardSources(workflowSteps[stepUnitPrompt.index]).filter((source) => source.autoAddUnits === false).map((source, sourceIndex) => (
                <label key={source.key} className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">
                    Unidades acumuladas {sourceIndex + 1}
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    pattern="[0-9]*[.,]?[0-9]*"
                    value={stepUnitPrompt.unitsByKey[source.key] || ''}
                    onChange={(e) =>
                      setStepUnitPrompt({
                        ...stepUnitPrompt,
                        unitsByKey: {
                          ...stepUnitPrompt.unitsByKey,
                          [source.key]: e.target.value,
                        },
                      })
                    }
                    className="w-full text-center text-lg h-10 px-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    placeholder="Ej. 0,051"
                    title="Puedes usar coma o punto decimal. Ejemplo: 0,051 o 0.051"
                    autoFocus={sourceIndex === 0}
                  />
                  <span className="mt-1 block text-[10px] font-bold text-indigo-600">
                    Puedes usar coma o punto decimal; Pixel guarda el decimal normalizado.
                  </span>
                </label>
              ))}
              {getStaticRateCardSources(workflowSteps[stepUnitPrompt.index]).filter((source) => source.assigneeMode === "runtime").map((source) => (
                <label key={source.key} className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">
                    Profesional asignado
                  </span>
                  <select
                    value={stepUnitPrompt.assigneesByKey[source.key] || ""}
                    onChange={(e) =>
                      setStepUnitPrompt({
                        ...stepUnitPrompt,
                        assigneesByKey: {
                          ...stepUnitPrompt.assigneesByKey,
                          [source.key]: e.target.value,
                        },
                      })
                    }
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  >
                    <option value="">Selecciona profesional</option>
                    {teamMembers.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name || member.email || "Profesional"}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              {stepUnitPrompt.requiresNextAssignee && (
                <label className="block rounded-lg border border-indigo-100 bg-indigo-50 p-3">
                  <span className="mb-1 flex items-center gap-2 text-sm font-medium text-indigo-800">
                    <Users size={15} />
                    Responsable del siguiente paso
                  </span>
                  <select
                    value={stepUnitPrompt.nextAssignee || ""}
                    onChange={(e) =>
                      setStepUnitPrompt({
                        ...stepUnitPrompt,
                        nextAssignee: e.target.value,
                      })
                    }
                    className="h-10 w-full rounded-lg border border-indigo-100 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    required
                  >
                    <option value="">Selecciona quién recibe el siguiente paso</option>
                    {teamMembers.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name || member.email || "Profesional"}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-xs text-indigo-700">
                    Al guardar, el siguiente paso quedará en curso y llegará a su bandeja.
                  </p>
                </label>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setStepUnitPrompt(null)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={confirmStepUnitToggle}
                disabled={
                  getStaticRateCardSources(workflowSteps[stepUnitPrompt.index]).filter((source) => source.autoAddUnits === false).some((source) => isInvalidRateCardUnits(stepUnitPrompt.unitsByKey[source.key])) ||
                  getStaticRateCardSources(workflowSteps[stepUnitPrompt.index]).filter((source) => source.assigneeMode === "runtime").some((source) => !stepUnitPrompt.assigneesByKey[source.key]) ||
                  Boolean(stepUnitPrompt.requiresNextAssignee && !stepUnitPrompt.nextAssignee)
                }
                className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50"
              >
                Confirmar y Completar
              </button>
            </div>
          </div>
        </div>
      )}
      <TaskDocumentsViewer
        isOpen={isAttachmentsOpen && Boolean(documentTask)}
        onClose={() => setIsAttachmentsOpen(false)}
        task={documentTask}
        userId={currentUser?.uid || currentUser?.id || auth.currentUser?.uid || ''}
        currentUser={currentUser || auth.currentUser}
        project={project}
        tasks={tasks}
        teamMembers={teamMembers}
        canUploadDocuments={canUploadDocuments}
        canManageAccess={canManageDocumentAccess}
        canDeleteDocuments={canDeleteDocuments}
      />
    </div>
  );
};
