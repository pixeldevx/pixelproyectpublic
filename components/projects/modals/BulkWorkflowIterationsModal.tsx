import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ClipboardList, Hash, Loader2, MapPin, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { collection, doc, getDocs, query, serverTimestamp, where, writeBatch } from "@/lib/supabase/document-store";
import { db } from "@/lib/backend";
import { toast } from "sonner";
import { notifyTaskAssignment, TaskAssignmentNotificationPayload } from "@/lib/notifications";
import {
  applyWorkflowStepReferenceDurations,
  applyWorkflowStepSchedule,
  getWorkflowTotalPlannedDays,
  normalizeWorkflowDayCountingEnabled,
  normalizeWorkflowScheduleMode,
} from "@/lib/workflow-schedule";
import { isStateWorkflowTaskType, isVariableWorkflowTaskType, isWorkflowTaskType } from "@/lib/workflow-routing";
import {
  loadColombiaLocationCatalog,
  resolveColombiaLocation,
  type ColombiaLocationCatalog,
} from "@/lib/colombia-locations";

type BulkWorkflowIterationsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  task: any;
  user: any;
  teamMembers: any[];
  tasks: any[];
};

type ParsedIteration = {
  lineNumber: number;
  raw: string;
  externalWorkflowId: string;
  observation: string;
  department: string;
  municipality: string;
  departmentCode?: string;
  municipalityCode?: string;
  locationKey?: string;
  startDate?: string;
  endDate?: string;
  usesCustomDates?: boolean;
  existing?: boolean;
  warning?: string;
  error?: string;
};

const foldText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const normalizeEmail = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const getTaskTitle = (task: any) => task?.title || task?.name || "Workflow";

const getTaskDate = (value: any) => {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toDateInputValue = (value: any) => {
  const date = getTaskDate(value) || new Date();
  return date.toISOString().slice(0, 10);
};

const startOfDate = (date: Date) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

const endOfDate = (date: Date) => {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
};

const padDatePart = (value: number) => String(value).padStart(2, "0");

const normalizeDateParts = (year: number, month: number, day: number) => {
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return "";
  }

  return `${year}-${padDatePart(month)}-${padDatePart(day)}`;
};

const normalizeDateInputText = (value: string) => {
  const cleanValue = value.trim();
  if (!cleanValue) return "";

  const ymdMatch = cleanValue.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (ymdMatch) {
    return normalizeDateParts(
      Number(ymdMatch[1]),
      Number(ymdMatch[2]),
      Number(ymdMatch[3])
    );
  }

  const dmyMatch = cleanValue.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (dmyMatch) {
    const year = dmyMatch[3].length === 2 ? Number(`20${dmyMatch[3]}`) : Number(dmyMatch[3]);
    return normalizeDateParts(year, Number(dmyMatch[2]), Number(dmyMatch[1]));
  }

  return "";
};

const looksLikeDateText = (value: string) =>
  /^(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})$/.test(value.trim());

const dateFromInputValue = (value: string) => {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const stripWorkflowStepRuntime = (step: any = {}) => {
  const nextStep = { ...step };
  [
    "status",
    "completed",
    "completedAt",
    "completedBy",
    "startedAt",
    "startedBy",
    "formData",
    "returnedAt",
    "returnedBy",
    "stoppedAt",
    "stoppedBy",
    "resumedAt",
    "resumedBy",
  ].forEach((key) => {
    delete nextStep[key];
  });
  return nextStep;
};

const parseIterationLine = (rawLine: string, lineNumber: number): ParsedIteration | null => {
  const raw = rawLine.trim();
  if (!raw) return null;

  const normalized = foldText(raw);
  if (
    lineNumber === 1 &&
    (normalized === "id,observacion" ||
      normalized === "id;observacion" ||
      normalized === "id\tobservacion" ||
      (normalized.includes("id") && normalized.includes("observ")))
  ) {
    return null;
  }

  const parseDelimitedParts = (parts: string[]): ParsedIteration => {
    const externalWorkflowId = parts[0] || "";
    let bodyParts = parts.slice(1).map((part) => part.trim());
    let startDate = "";
    let endDate = "";
    let usesCustomDates = false;

    const lastPart = bodyParts[bodyParts.length - 1] || "";
    const penultimatePart = bodyParts[bodyParts.length - 2] || "";
    const hasDateColumns = bodyParts.length >= 3 && (looksLikeDateText(lastPart) || looksLikeDateText(penultimatePart));

    if (hasDateColumns) {
      usesCustomDates = true;
      startDate = normalizeDateInputText(bodyParts[bodyParts.length - 2] || "");
      endDate = normalizeDateInputText(bodyParts[bodyParts.length - 1] || "");
      bodyParts = bodyParts.slice(0, -2);
    }

    const municipality = bodyParts[bodyParts.length - 1]?.trim() || "";
    const department = bodyParts.length >= 2 ? bodyParts[bodyParts.length - 2].trim() : "";
    const observation = bodyParts.length >= 3 ? bodyParts.slice(0, -2).join(", ").trim() : "";

    let error: string | undefined;
    if (!externalWorkflowId) {
      error = "Falta el ID";
    } else if (!department) {
      error = "Falta el departamento";
    } else if (!municipality) {
      error = "Falta el municipio";
    } else if (usesCustomDates && (!startDate || !endDate)) {
      error = "Completa fecha inicio y fecha fin válidas";
    }

    return {
      lineNumber,
      raw,
      externalWorkflowId,
      observation,
      department,
      municipality,
      startDate,
      endDate,
      usesCustomDates,
      error,
    };
  };

  const commaParts = raw.split(",").map((part) => part.trim());
  if (commaParts.length > 1) {
    return parseDelimitedParts(commaParts);
  }

  const separators = ["\t", ";", "|"];
  const separator = separators.find((candidate) => raw.includes(candidate)) || "";
  if (separator) {
    return parseDelimitedParts(raw.split(separator).map((part) => part.trim()));
  }

  const externalWorkflowId = raw.trim();
  return {
    lineNumber,
    raw,
    externalWorkflowId,
    observation: "",
    department: "",
    municipality: "",
    error: externalWorkflowId ? "Faltan departamento y municipio" : "Falta el ID",
  };
};

const validateIterationSchedule = (
  item: ParsedIteration,
  options: {
    fallbackStartDate: string;
    fallbackEndDate: string;
    parentStartDate: Date | null;
    parentEndDate: Date | null;
    workflowSteps?: any[];
    workflowScheduleMode?: string;
    workflowDayCountingEnabled?: boolean;
  }
) => {
  if (item.error) return item;

  const iterationStartDate = dateFromInputValue(item.startDate || options.fallbackStartDate);
  const scheduledWorkflow =
    options.workflowDayCountingEnabled && iterationStartDate && options.workflowSteps?.length
      ? applyWorkflowStepSchedule(options.workflowSteps, iterationStartDate, options.workflowScheduleMode)
      : null;
  const iterationEndDate = scheduledWorkflow?.workflowEndDate || dateFromInputValue(item.endDate || options.fallbackEndDate);

  if (!iterationStartDate || !iterationEndDate) {
    return { ...item, error: "Define fechas válidas para la iteración" };
  }

  if (iterationStartDate.getTime() > iterationEndDate.getTime()) {
    return { ...item, error: "La fecha inicio supera la fecha fin" };
  }

  if (
    options.parentStartDate &&
    startOfDate(iterationStartDate).getTime() < startOfDate(options.parentStartDate).getTime()
  ) {
    return { ...item, error: "Inicia antes que la tarea principal" };
  }

  if (
    options.parentEndDate &&
    endOfDate(iterationEndDate).getTime() > endOfDate(options.parentEndDate).getTime()
  ) {
    return { ...item, error: "Termina después que la tarea principal" };
  }

  return item;
};

const parseIterations = (
  value: string,
  existingIds: Set<string>,
  options: {
    fallbackStartDate: string;
    fallbackEndDate: string;
    parentStartDate: Date | null;
    parentEndDate: Date | null;
    workflowSteps?: any[];
    workflowScheduleMode?: string;
    workflowDayCountingEnabled?: boolean;
    locationCatalog?: ColombiaLocationCatalog | null;
  }
) => {
  const seenIds = new Set<string>();

  return value
    .split(/\r?\n/)
    .map((line, index) => parseIterationLine(line, index + 1))
    .filter((item): item is ParsedIteration => Boolean(item))
    .map((item) => {
      if (!item.error) {
        const location = resolveColombiaLocation(options.locationCatalog, item.department, item.municipality);
        if (!location) {
          return { ...item, error: "Departamento y municipio no corresponden al catálogo oficial" };
        }
        item = {
          ...item,
          department: location.department,
          municipality: location.municipality,
          departmentCode: location.departmentCode,
          municipalityCode: location.municipalityCode,
          locationKey: location.locationKey,
        };
      }
      const normalizedId = foldText(item.externalWorkflowId);
      if (!normalizedId) return item;

      if (existingIds.has(normalizedId)) {
        return { ...item, existing: true, warning: "ID existente en la carga masiva" };
      }

      if (seenIds.has(normalizedId)) {
        return { ...item, error: item.error || "ID duplicado en el lote" };
      }

      seenIds.add(normalizedId);

      return validateIterationSchedule(item, options);
    });
};

const getWorkflowIdCandidates = (task: any) => {
  const values = [
    task?.externalWorkflowId,
    task?.workflowId,
    task?.title,
    task?.name,
  ].filter(Boolean);
  const candidates = new Set<string>();

  values.forEach((value) => {
    const cleanValue = String(value).trim();
    if (!cleanValue) return;
    candidates.add(cleanValue);

    const bracketMatch = cleanValue.match(/^\[([^\]]+)\]/);
    if (bracketMatch?.[1]) {
      candidates.add(bracketMatch[1].trim());
    }
  });

  return Array.from(candidates);
};

const getExistingWorkflowIdsForTask = (tasks: any[], task: any) =>
  new Set(
    tasks
      .filter((candidate) => candidate.parentTaskId === task?.id)
      .flatMap(getWorkflowIdCandidates)
      .filter(Boolean)
      .map((value) => foldText(value))
  );

const BULK_ITERATION_CHUNK_SIZE = 75;
const NOTIFICATION_CHUNK_SIZE = 25;

type CreationProgress = {
  total: number;
  completed: number;
  stage: string;
  skipped: number;
};

const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0));

const sendNotificationsInChunks = async (notifications: TaskAssignmentNotificationPayload[]) => {
  for (let index = 0; index < notifications.length; index += NOTIFICATION_CHUNK_SIZE) {
    const chunk = notifications.slice(index, index + NOTIFICATION_CHUNK_SIZE);
    await Promise.allSettled(chunk.map((notification) => notifyTaskAssignment(notification)));
  }
};

export function BulkWorkflowIterationsModal({
  isOpen,
  onClose,
  projectId,
  task,
  user,
  teamMembers,
  tasks,
}: BulkWorkflowIterationsModalProps) {
  const [rawItems, setRawItems] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [firstStepAssignee, setFirstStepAssignee] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [creationProgress, setCreationProgress] = useState<CreationProgress | null>(null);
  const [locationCatalog, setLocationCatalog] = useState<ColombiaLocationCatalog | null>(null);
  const [locationsLoading, setLocationsLoading] = useState(false);

  const resolveActorName = () => {
    const currentEmail = normalizeEmail(user?.email);
    const currentId = user?.uid;
    const actor = teamMembers.find((member) => {
      if (!member) return false;
      if (currentEmail && normalizeEmail(member.email) === currentEmail) return true;
      return currentId && [member.id, member.uid, member.authUserId].includes(currentId);
    });

    return (
      actor?.name ||
      actor?.displayName ||
      user?.email ||
      user?.displayName ||
      "Usuario"
    );
  };

  useEffect(() => {
    if (!isOpen || !task) return;

    setRawItems("");
    setStartDate(toDateInputValue(task.startDate || task.start));
    setEndDate(toDateInputValue(task.endDate || task.end));
    setFirstStepAssignee("");
    setCreationProgress(null);
  }, [isOpen, task]);

  useEffect(() => {
    if (!isOpen || locationCatalog || locationsLoading) return;
    setLocationsLoading(true);
    loadColombiaLocationCatalog()
      .then(setLocationCatalog)
      .catch((error) => {
        console.error("Error loading Colombia location catalog:", error);
        toast.error("No se pudo cargar el catálogo oficial de ubicaciones.");
      })
      .finally(() => setLocationsLoading(false));
  }, [isOpen, locationCatalog, locationsLoading]);

  const firstStepIsDynamic = task?.workflowSteps?.[0]?.assignedTo === "DYNAMIC";
  const parentStartDate = getTaskDate(task?.startDate || task?.start);
  const parentEndDate = getTaskDate(task?.endDate || task?.end);
  const parentStartValue = parentStartDate ? parentStartDate.toISOString().slice(0, 10) : "";
  const parentEndValue = parentEndDate ? parentEndDate.toISOString().slice(0, 10) : "";
  const workflowScheduleMode = normalizeWorkflowScheduleMode(task?.workflowScheduleMode);
  const workflowDayCountingEnabled = normalizeWorkflowDayCountingEnabled(task?.workflowDayCountingEnabled);
  const existingIds = useMemo(() => getExistingWorkflowIdsForTask(tasks, task), [tasks, task]);
  const parsedIterations = useMemo(
    () =>
      parseIterations(rawItems, existingIds, {
        fallbackStartDate: startDate,
        fallbackEndDate: endDate,
        parentStartDate,
        parentEndDate,
        workflowSteps: task?.workflowSteps || [],
        workflowScheduleMode,
        workflowDayCountingEnabled,
        locationCatalog,
      }),
    [rawItems, existingIds, startDate, endDate, parentStartDate, parentEndDate, task?.workflowSteps, workflowScheduleMode, workflowDayCountingEnabled, locationCatalog]
  );
  const validIterations = parsedIterations.filter((item) => !item.error && !item.existing);
  const invalidIterations = parsedIterations.filter((item) => item.error);
  const existingIterations = parsedIterations.filter((item) => item.existing);
  const childTaskCount = useMemo(
    () => tasks.filter((candidate) => candidate.parentTaskId === task?.id).length,
    [task?.id, tasks]
  );
  const getIterationPreviewEndDate = (item: ParsedIteration) => {
    const iterationStartDate = dateFromInputValue(item.startDate || startDate);
    if (workflowDayCountingEnabled && iterationStartDate && task?.workflowSteps?.length) {
      return applyWorkflowStepSchedule(task.workflowSteps, iterationStartDate, workflowScheduleMode)
        .workflowEndDate.toISOString()
        .slice(0, 10);
    }

    return item.endDate || endDate || "";
  };

  if (!isOpen || !task) return null;

  const handleClose = () => {
    if (isCreating) return;
    onClose();
  };

  const handleCreateIterations = async () => {
    if (!user?.uid) {
      toast.error("No encontramos la sesión activa.");
      return;
    }

    if (!isWorkflowTaskType(task?.type) || !Array.isArray(task.workflowSteps) || task.workflowSteps.length === 0) {
      toast.warning("Selecciona un workflow con pasos definidos.");
      return;
    }

    if (isStateWorkflowTaskType(task.type)) {
      toast.warning("Las tareas por estado procedimental tienen una sola ejecución y no admiten iteraciones masivas.");
      return;
    }

    if (validIterations.length === 0) {
      toast.warning(
        existingIterations.length > 0
          ? "Todos los IDs de esta carga ya existen. Agrega IDs nuevos para complementar la carga masiva."
          : "Agrega al menos un ID válido para crear iteraciones."
      );
      return;
    }

    if (invalidIterations.length > 0) {
      toast.warning("Corrige los IDs, ubicaciones, fechas o rangos antes de crear las iteraciones.");
      return;
    }

    if (firstStepIsDynamic && !firstStepAssignee) {
      toast.warning("Selecciona el responsable del primer paso para iniciar el lote.");
      return;
    }

    const parsedStartDate = new Date(`${startDate}T00:00:00`);
    const parsedEndDate = new Date(`${endDate}T00:00:00`);
    if (Number.isNaN(parsedStartDate.getTime()) || Number.isNaN(parsedEndDate.getTime())) {
      toast.warning("Define fechas válidas para las iteraciones.");
      return;
    }

    if (parsedStartDate.getTime() > parsedEndDate.getTime()) {
      toast.warning("La fecha de inicio no puede ser posterior a la fecha fin.");
      return;
    }

    if (parentStartDate && startOfDate(parsedStartDate).getTime() < startOfDate(parentStartDate).getTime()) {
      toast.warning("Las iteraciones no pueden iniciar antes que la tarea principal.");
      return;
    }

    if (parentEndDate && endOfDate(parsedEndDate).getTime() > endOfDate(parentEndDate).getTime()) {
      toast.warning("Las iteraciones no pueden terminar después que la tarea principal.");
      return;
    }

    setIsCreating(true);
    setCreationProgress({
      total: validIterations.length,
      completed: 0,
      stage: "Revisando IDs existentes",
      skipped: existingIterations.length,
    });

    try {
      const currentChildrenSnapshot = await getDocs(
        query(collection(db, "projects", projectId, "tasks"), where("parentTaskId", "==", task.id))
      );
      const currentChildTasks = currentChildrenSnapshot.docs.map((taskDoc) => ({ id: taskDoc.id, ...taskDoc.data() }));
      const latestExistingIds = getExistingWorkflowIdsForTask(currentChildTasks, { id: task.id });
      const iterationsToCreate = validIterations.filter(
        (iteration) => !latestExistingIds.has(foldText(iteration.externalWorkflowId))
      );
      const skippedExistingCount = validIterations.length - iterationsToCreate.length + existingIterations.length;

      if (iterationsToCreate.length === 0) {
        toast.warning("No se creó ninguna iteración porque todos los IDs ya existen en este workflow.");
        return;
      }

      if (skippedExistingCount > 0) {
        toast.warning(`${skippedExistingCount} ID(s) ya existían y no se reescribieron.`);
      }

      const now = new Date();
      const sourceTitle = task.originalTitle || getTaskTitle(task);
      const existingChildCount = currentChildTasks.length;
      const nextTotalSubtasks =
        Math.max(Number(task.totalSubtasks || 0), Number(task.totalCycles || 0), existingChildCount) +
        iterationsToCreate.length;
      const displayOrderBase = Math.max(
        tasks.length,
        ...currentChildTasks.map((childTask: any) => Number(childTask.displayOrder || 0)),
        0
      );
      const notifications: TaskAssignmentNotificationPayload[] = [];
      const workflowTaskType = isWorkflowTaskType(task.type) ? task.type : "workflow";
      const isVariableWorkflow = isVariableWorkflowTaskType(workflowTaskType);
      const actorName = resolveActorName();
      const actorEmail = user.email || null;

      for (let chunkStart = 0; chunkStart < iterationsToCreate.length; chunkStart += BULK_ITERATION_CHUNK_SIZE) {
        const chunk = iterationsToCreate.slice(chunkStart, chunkStart + BULK_ITERATION_CHUNK_SIZE);
        const batch = writeBatch(db);

        setCreationProgress({
          total: iterationsToCreate.length,
          completed: chunkStart,
          stage: `Creando iteraciones ${chunkStart + 1}-${chunkStart + chunk.length}`,
          skipped: skippedExistingCount,
        });

        chunk.forEach((iteration, chunkIndex) => {
          const index = chunkStart + chunkIndex;
          const iterationRef = doc(collection(db, "projects", projectId, "tasks"));
          const cleanWorkflowId = iteration.externalWorkflowId.trim();
          const cleanObservation = iteration.observation.trim();
          const cleanDepartment = iteration.department.trim();
          const cleanMunicipality = iteration.municipality.trim();
          const iterationStartDate = dateFromInputValue(iteration.startDate || startDate) || parsedStartDate;
          const scheduledWorkflow = workflowDayCountingEnabled
            ? applyWorkflowStepSchedule(task.workflowSteps || [], iterationStartDate, workflowScheduleMode)
            : null;
          const iterationEndDate =
            scheduledWorkflow?.workflowEndDate || dateFromInputValue(iteration.endDate || endDate) || parsedEndDate;
          const workflowBaseSteps = scheduledWorkflow?.steps || applyWorkflowStepReferenceDurations(task.workflowSteps || []);
          const workflowSteps = workflowBaseSteps.map((step: any, stepIndex: number) => {
            const cleanStep: any = {
              ...stripWorkflowStepRuntime(step),
              status: stepIndex === 0 ? "en_curso" : "not_started",
              completed: false,
            };

            if (stepIndex === 0) {
              cleanStep.startedAt = now.toISOString();
              cleanStep.startedBy = user.uid;
              if (cleanStep.assignedTo === "DYNAMIC" && firstStepAssignee) {
                cleanStep.assignedTo = firstStepAssignee;
              }
            }

            Object.keys(cleanStep).forEach((key) => {
              if (cleanStep[key] === undefined) cleanStep[key] = null;
            });

            return cleanStep;
          });
          const resolvedFirstStepAssignee = workflowSteps[0]?.assignedTo;
          const iterationAssignee =
            firstStepIsDynamic && resolvedFirstStepAssignee && resolvedFirstStepAssignee !== "DYNAMIC"
              ? resolvedFirstStepAssignee
              : task.assignedTo || "";
          notifications.push({
            projectId,
            taskId: iterationRef.id,
            assigneeId: workflowSteps[0]?.assignedTo,
            stepIndex: 0,
            eventType: "workflow_step_assigned",
            source: "bulk_iteration",
          });

          batch.set(iterationRef, {
            projectId,
            title: cleanWorkflowId,
            name: cleanWorkflowId,
            originalTitle: sourceTitle,
            description: task.description || "",
            startDate: iterationStartDate,
            endDate: iterationEndDate,
            start: iterationStartDate,
            end: iterationEndDate,
            department: cleanDepartment,
            workflowDepartment: cleanDepartment,
            departmentCode: iteration.departmentCode,
            workflowDepartmentCode: iteration.departmentCode,
            municipality: cleanMunicipality,
            workflowMunicipality: cleanMunicipality,
            municipalityCode: iteration.municipalityCode,
            workflowMunicipalityCode: iteration.municipalityCode,
            locationKey: iteration.locationKey,
            workflowLocationKey: iteration.locationKey,
            assignedTo: iterationAssignee,
            indicator: null,
            indicatorValue: null,
            status: "in_progress",
            progress: 10,
            type: workflowTaskType,
            workflowMode: isVariableWorkflow ? "variable" : "linear",
            isVariableWorkflow,
            requiresDocument: Boolean(task.requiresDocument),
            linkedDocumentId: null,
            isRateCardTask: Boolean(task.isRateCardTask),
            rateCardMode: task.rateCardMode || null,
            dynamicRateCard: Boolean(task.dynamicRateCard),
            dynamicRateCardConfig: task.dynamicRateCardConfig || null,
            rateCardId: task.rateCardId || null,
            unitsToAdd: task.unitsToAdd || null,
            autoAddUnits: task.autoAddUnits !== false,
            syncExternal: Boolean(task.syncExternal),
            priority: task.priority || "medium",
            groupId: task.groupId || null,
            currentValue: 0,
            parentTaskId: task.id,
            cycleNumber: existingChildCount + index + 1,
            displayOrder: displayOrderBase + index + 1,
            workflowSteps,
            workflowScheduleMode,
            workflowDayCountingEnabled,
            workflowTotalPlannedDays: scheduledWorkflow?.workflowTotalPlannedDays || getWorkflowTotalPlannedDays(workflowBaseSteps),
            currentStepIndex: 0,
            workflowHistory: [
              {
                stepIndex: 0,
                userId: user.uid,
                userEmail: actorEmail,
                userName: actorName,
                action: "start",
                comment: cleanObservation || "Workflow iniciado por carga masiva",
                timestamp: now.toISOString(),
                workflowId: cleanWorkflowId,
                department: cleanDepartment,
                departmentCode: iteration.departmentCode,
                municipality: cleanMunicipality,
                municipalityCode: iteration.municipalityCode,
                locationKey: iteration.locationKey,
                plannedStartDate: iterationStartDate.toISOString(),
                plannedEndDate: iterationEndDate.toISOString(),
                source: "bulk_iteration",
              },
            ],
            workflowCycles: 1,
            currentCycle: 1,
            externalWorkflowId: cleanWorkflowId,
            initialObservation: cleanObservation,
            startDocumentId: null,
            bulkCreated: true,
            bulkCreatedAt: now.toISOString(),
            bulkSourceTaskId: task.id,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            createdBy: user.uid,
          });
        });

        await batch.commit();

        setCreationProgress({
          total: iterationsToCreate.length,
          completed: Math.min(chunkStart + chunk.length, iterationsToCreate.length),
          stage: "Guardando interacciones iniciales",
          skipped: skippedExistingCount,
        });
        await yieldToBrowser();
      }

      setCreationProgress({
        total: iterationsToCreate.length,
        completed: iterationsToCreate.length,
        stage: "Actualizando tarea matriz",
        skipped: skippedExistingCount,
      });

      const parentBatch = writeBatch(db);
      parentBatch.update(doc(db, "projects", projectId, "tasks", task.id), {
        isParentTask: true,
        status: "in_progress",
        totalSubtasks: nextTotalSubtasks,
        totalCycles: Math.max(Number(task.totalCycles || 0), nextTotalSubtasks),
        updatedAt: serverTimestamp(),
      });
      await parentBatch.commit();

      const { updateParentTaskStatus } = await import("@/lib/taskUtils");
      await updateParentTaskStatus(projectId, task.id);

      setCreationProgress({
        total: iterationsToCreate.length,
        completed: iterationsToCreate.length,
        stage: "Programando notificaciones",
        skipped: skippedExistingCount,
      });
      void sendNotificationsInChunks(notifications);

      toast.success(`${iterationsToCreate.length} iteraciones iniciadas correctamente.`);
      if (skippedExistingCount > 0) {
        toast.info("La carga se complementó sin reescribir las iteraciones existentes.");
      }
      onClose();
    } catch (error: any) {
      console.error("Error creating bulk workflow iterations:", error);
      toast.error(error?.message || "No se pudieron crear las iteraciones.");
    } finally {
      setIsCreating(false);
      setCreationProgress(null);
    }
  };

  const progressPercent = creationProgress?.total
    ? Math.min(100, Math.round((creationProgress.completed / creationProgress.total) * 100))
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 p-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-indigo-50 p-2 text-indigo-600">
                <ClipboardList size={18} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Crear iteraciones masivas</h3>
                <p className="mt-0.5 truncate text-sm text-slate-500">{getTaskTitle(task)}</p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto bg-slate-50 p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-700">
                <Hash size={15} className="text-slate-400" />
                Fecha inicio general
              </label>
              <input
                type="date"
                value={startDate}
                min={parentStartValue || undefined}
                max={parentEndValue || undefined}
                onChange={(event) => setStartDate(event.target.value)}
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            <div>
              <label className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-700">
                <Hash size={15} className="text-slate-400" />
                Fecha fin general
              </label>
              <input
                type="date"
                value={endDate}
                min={startDate || parentStartValue || undefined}
                max={parentEndValue || undefined}
                onChange={(event) => setEndDate(event.target.value)}
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
          </div>

          {parentStartValue && parentEndValue && (
            <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
              Las iteraciones deben quedar dentro del cronograma de la tarea principal: {parentStartValue} a {parentEndValue}.
            </div>
          )}

          {firstStepIsDynamic && (
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">Responsable del primer paso</label>
              <select
                value={firstStepAssignee}
                onChange={(event) => setFirstStepAssignee(event.target.value)}
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="">Seleccionar responsable...</option>
                {teamMembers.map((member) => (
                  <option key={member.id} value={member.id}>{member.name || member.email}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <MapPin size={15} className="text-slate-400" />
              IDs, observaciones y ubicaciones
            </label>
            <textarea
              value={rawItems}
              onChange={(event) => setRawItems(event.target.value)}
              placeholder={
                "ID-001, Observación de la iteración, Antioquia, Medellín, 2026-06-01, 2026-06-05\n" +
                "ID-002, Segunda observación, Valle del Cauca, Cali, 01/06/2026, 05/06/2026\n" +
                "ID-003; Sin fechas propias usa el cronograma general; Bogotá, D.C.; Bogotá, D.C."
              }
              className="min-h-44 w-full resize-y rounded-lg border border-slate-200 bg-white p-3 font-mono text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            />
            <p className="mt-1 text-xs text-slate-500">
              Usa una línea por iteración. Formato: ID, observación, departamento, municipio, fecha inicio, fecha fin. Las fechas son opcionales;
              si no las agregas, se usará el cronograma general. También puedes separar las columnas con punto y coma o tabulación.
            </p>
          </div>

          {parsedIterations.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Vista previa</span>
                <div className="flex gap-2 text-xs">
                  <span className="rounded-full bg-emerald-50 px-2 py-1 font-bold text-emerald-700">
                    {validIterations.length} válidas
                  </span>
                  {invalidIterations.length > 0 && (
                    <span className="rounded-full bg-red-50 px-2 py-1 font-bold text-red-700">
                      {invalidIterations.length} por corregir
                    </span>
                  )}
                  {existingIterations.length > 0 && (
                    <span className="rounded-full bg-amber-50 px-2 py-1 font-bold text-amber-700">
                      {existingIterations.length} existentes
                    </span>
                  )}
                </div>
              </div>
              {existingIterations.length > 0 && (
                <div className="flex gap-2 border-b border-amber-100 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                  <span>
                    Los IDs marcados como existentes no se crearán ni se reescribirán. La carga agregará únicamente las iteraciones nuevas.
                  </span>
                </div>
              )}
              <div className="max-h-48 overflow-y-auto">
                {parsedIterations.map((item) => (
                  <div
                    key={`${item.lineNumber}-${item.raw}`}
                    className={`grid gap-3 border-b px-3 py-2 last:border-b-0 sm:grid-cols-[88px_minmax(0,1fr)_180px_156px] ${
                      item.existing ? "border-amber-100 bg-amber-50/70" : "border-slate-100"
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-slate-700">{item.externalWorkflowId || "Sin ID"}</p>
                      <p className="text-[10px] text-slate-400">Línea {item.lineNumber}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs text-slate-600">{item.observation || "Sin observación"}</p>
                      {item.error && <p className="mt-0.5 text-[10px] font-semibold text-red-600">{item.error}</p>}
                      {item.warning && (
                        <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-amber-700">{item.warning}</p>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-indigo-700">
                        {item.municipality && item.department
                          ? `${item.municipality}, ${item.department}`
                          : "Sin ubicación completa"}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {item.municipalityCode ? `Código ${item.municipalityCode}` : "Municipio y departamento"}
                      </p>
                    </div>
                    <div className="min-w-0 text-left sm:text-right">
                      <p className="truncate text-[10px] font-semibold text-slate-500">
                        {item.startDate || startDate || "Sin inicio"} - {getIterationPreviewEndDate(item) || "Sin fin"}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {task?.workflowSteps?.length && workflowDayCountingEnabled
                          ? `Calculado por pasos · ${workflowScheduleMode === "business" ? "laborales" : "calendario"}`
                          : task?.workflowSteps?.length
                            ? "Periodo de iteracion · dias como estadistica"
                          : item.usesCustomDates
                            ? "Fechas individuales"
                            : "Cronograma general"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-100 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1 text-xs text-slate-500">
            {creationProgress ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 font-semibold text-slate-700">
                  <Loader2 size={14} className="animate-spin text-indigo-600" />
                  <span>{creationProgress.stage}</span>
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
                    {creationProgress.completed}/{creationProgress.total}
                  </span>
                  {creationProgress.skipped > 0 && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                      {creationProgress.skipped} existentes omitidas
                    </span>
                  )}
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-indigo-600 transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            ) : (
              "Se crearán como subtareas en curso y entrarán al primer paso del workflow."
            )}
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={handleClose} disabled={isCreating}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleCreateIterations}
              disabled={isCreating || validIterations.length === 0 || invalidIterations.length > 0}
              className="bg-indigo-600 text-white hover:bg-indigo-700"
            >
              {isCreating ? (
                <>
                  <Loader2 size={16} className="mr-2 animate-spin" />
                  Creando {creationProgress ? `${creationProgress.completed}/${creationProgress.total}` : "..."}
                </>
              ) : (
                <>
                  <Play size={16} className="mr-2" />
                  Crear e iniciar
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
