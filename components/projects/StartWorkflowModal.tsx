import React, { useEffect, useMemo, useState } from 'react';
import { X, Upload, Save, FileText, MessageSquare, Hash, Calendar, MapPin } from 'lucide-react';
import { doc, updateDoc, serverTimestamp } from '@/lib/supabase/document-store';
import { db } from '@/lib/backend';
import { toast } from 'sonner';
import { notifyTaskAssignment } from '@/lib/notifications';
import { getTaskDisplayTitle, getTaskTitle } from '@/lib/task-title';
import { uploadWorkflowFormDocument, type WorkflowDocumentValue } from '@/lib/workflow-form-documents';
import {
  applyWorkflowStepReferenceDurations,
  applyWorkflowStepSchedule,
  getWorkflowTotalPlannedDays,
  normalizeWorkflowDayCountingEnabled,
  normalizeWorkflowScheduleMode,
} from '@/lib/workflow-schedule';
import {
  inferUniqueColombiaLocation,
  loadColombiaLocationCatalog,
  resolveColombiaLocation,
  type ColombiaLocationCatalog,
} from '@/lib/colombia-locations';

interface StartWorkflowModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: any;
  parentTask?: any | null;
  projectId: string;
  userId: string;
  user?: any;
  teamMembers: any[];
}

const getTaskDate = (value: any) => {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const toDateInputValue = (value: any) => {
  const date = getTaskDate(value);
  return date ? date.toISOString().slice(0, 10) : '';
};
const parseDateInput = (value: string) => {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const endOfDate = (date: Date) => {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
};
const normalizeEmail = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

export const StartWorkflowModal: React.FC<StartWorkflowModalProps> = ({
  isOpen,
  onClose,
  task,
  parentTask,
  projectId,
  userId,
  user,
  teamMembers
}) => {
  const [workflowId, setWorkflowId] = useState('');
  const [department, setDepartment] = useState('');
  const [municipality, setMunicipality] = useState('');
  const [locationCatalog, setLocationCatalog] = useState<ColombiaLocationCatalog | null>(null);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [observation, setObservation] = useState('');
  const [workflowStartDate, setWorkflowStartDate] = useState('');
  const [workflowEndDate, setWorkflowEndDate] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [isStarting, setIsStarting] = useState(false);
  const [firstStepAssignee, setFirstStepAssignee] = useState<string>('');

  useEffect(() => {
    if (!isOpen || !task) return;
    setWorkflowId(task.externalWorkflowId || '');
    setDepartment(
      task.workflowDepartment ||
        task.department ||
        parentTask?.workflowDepartment ||
        parentTask?.department ||
        ''
    );
    setMunicipality(task.municipality || task.workflowMunicipality || parentTask?.municipality || parentTask?.workflowMunicipality || '');
    setObservation('');
    setWorkflowStartDate(toDateInputValue(task.startDate || task.start));
    setWorkflowEndDate(toDateInputValue(task.endDate || task.end));
    setFiles([]);
    setFirstStepAssignee('');
  }, [isOpen, task, parentTask]);

  useEffect(() => {
    if (!isOpen || locationCatalog || locationsLoading) return;
    setLocationsLoading(true);
    loadColombiaLocationCatalog()
      .then(setLocationCatalog)
      .catch((error) => {
        console.error('Error loading Colombia location catalog:', error);
        toast.error('No se pudo cargar el catálogo oficial de departamentos y municipios.');
      })
      .finally(() => setLocationsLoading(false));
  }, [isOpen, locationCatalog, locationsLoading]);

  useEffect(() => {
    if (!isOpen || !locationCatalog || !municipality) return;
    const resolved = department
      ? resolveColombiaLocation(locationCatalog, department, municipality)
      : inferUniqueColombiaLocation(locationCatalog, municipality);
    if (!resolved) return;
    if (department !== resolved.department) setDepartment(resolved.department);
    if (municipality !== resolved.municipality) setMunicipality(resolved.municipality);
  }, [department, isOpen, locationCatalog, municipality]);

  const selectedDepartment = useMemo(
    () => locationCatalog?.departments.find((option) => option.name === department) || null,
    [department, locationCatalog]
  );

  const workflowScheduleMode = normalizeWorkflowScheduleMode(task?.workflowScheduleMode || parentTask?.workflowScheduleMode);
  const workflowDayCountingEnabled = normalizeWorkflowDayCountingEnabled(
    task?.workflowDayCountingEnabled ?? parentTask?.workflowDayCountingEnabled
  );
  const workflowSchedulePreview = useMemo(() => {
    if (
      !workflowDayCountingEnabled ||
      !isOpen ||
      !task ||
      !workflowStartDate ||
      !Array.isArray(task.workflowSteps) ||
      task.workflowSteps.length === 0
    ) {
      return null;
    }

    const parsedWorkflowStart = parseDateInput(workflowStartDate);
    if (!parsedWorkflowStart) return null;

    return applyWorkflowStepSchedule(task.workflowSteps, parsedWorkflowStart, workflowScheduleMode);
  }, [isOpen, task, workflowDayCountingEnabled, workflowStartDate, workflowScheduleMode]);
  const computedWorkflowEndValue = workflowSchedulePreview
    ? toDateInputValue(workflowSchedulePreview.workflowEndDate)
    : workflowEndDate;

  const resolveActorName = () => {
    const currentEmail = normalizeEmail(user?.email);
    const actor = teamMembers.find((member) => {
      if (!member) return false;
      if (currentEmail && normalizeEmail(member.email) === currentEmail) return true;
      return userId && [member.id, member.uid, member.authUserId].includes(userId);
    });

    return (
      actor?.name ||
      actor?.displayName ||
      user?.email ||
      user?.displayName ||
      'Usuario'
    );
  };

  if (!isOpen || !task) return null;

  const parentStartValue = parentTask ? toDateInputValue(parentTask.startDate || parentTask.start) : '';
  const parentEndValue = parentTask ? toDateInputValue(parentTask.endDate || parentTask.end) : '';

  const handleStart = async () => {
    const cleanWorkflowId = workflowId.trim();
    const resolvedLocation = resolveColombiaLocation(locationCatalog, department, municipality);

    if (!cleanWorkflowId) {
      toast.warning("Por favor ingrese un ID de Workflow.");
      return;
    }

    if (!department.trim()) {
      toast.warning("Por favor seleccione el departamento del workflow.");
      return;
    }

    if (!resolvedLocation) {
      toast.warning("Seleccione un municipio válido del departamento elegido.");
      return;
    }

    const cleanMunicipality = resolvedLocation.municipality;

    if (task.workflowSteps?.[0]?.assignedTo === 'DYNAMIC' && !firstStepAssignee) {
      toast.warning("Por favor asigne el primer paso a un miembro del equipo.");
      return;
    }

    const parsedWorkflowStart = parseDateInput(workflowStartDate);
    const workflowSchedule =
      workflowDayCountingEnabled &&
      parsedWorkflowStart &&
      Array.isArray(task.workflowSteps) &&
      task.workflowSteps.length > 0
        ? applyWorkflowStepSchedule(task.workflowSteps, parsedWorkflowStart, workflowScheduleMode)
        : null;
    const parsedWorkflowEnd = workflowSchedule?.workflowEndDate || parseDateInput(workflowEndDate);
    if (!parsedWorkflowStart || !parsedWorkflowEnd) {
      toast.warning("Define fecha de inicio y fecha fin para este workflow.");
      return;
    }

    if (parsedWorkflowStart.getTime() > parsedWorkflowEnd.getTime()) {
      toast.warning("La fecha de inicio no puede ser posterior a la fecha fin.");
      return;
    }

    const parentStartDate = getTaskDate(parentTask?.startDate || parentTask?.start);
    const parentEndDate = getTaskDate(parentTask?.endDate || parentTask?.end);
    if (parentTask && parentStartDate && parsedWorkflowStart.getTime() < parentStartDate.getTime()) {
      toast.warning("El workflow no puede iniciar antes que la tarea principal.");
      return;
    }

    if (parentTask && parentEndDate && endOfDate(parsedWorkflowEnd).getTime() > endOfDate(parentEndDate).getTime()) {
      toast.warning("El workflow no puede terminar después que la tarea principal.");
      return;
    }

    setIsStarting(true);
    try {
      const hierarchyTasks = parentTask ? [parentTask, task] : [task];
      const startDocuments: WorkflowDocumentValue[] = [];

      // 1. Upload initial documents if any. They are also stored in workflow history
      // so the workflow evidence panel and task documents viewer stay in sync.
      for (const selectedFile of files) {
        startDocuments.push(await uploadWorkflowFormDocument({
          file: selectedFile,
          projectId,
          projectName: task?.projectName || parentTask?.projectName,
          task,
          tasks: hierarchyTasks,
          user: user ? { ...user, uid: userId || user.uid } : { uid: userId },
          field: {
            id: 'workflowStartDocuments',
            label: 'Documentos iniciales',
            documentName: selectedFile.name,
            documentDestinationMode: 'task',
            documentVersioning: false,
          },
          stepIndex: 0,
          stepLabel: 'Inicio del workflow',
        }));
      }
      const documentId = startDocuments[0]?.documentId || null;

      // 2. Prepare history entry
      const historyEntry = {
        stepIndex: 0,
        userId: userId,
        userEmail: user?.email || null,
        userName: resolveActorName(),
        action: 'start',
        comment: observation || 'Workflow iniciado',
        timestamp: new Date(),
        workflowId: cleanWorkflowId,
        department: resolvedLocation.department,
        departmentCode: resolvedLocation.departmentCode,
        municipality: cleanMunicipality,
        municipalityCode: resolvedLocation.municipalityCode,
        locationKey: resolvedLocation.locationKey,
        plannedStartDate: parsedWorkflowStart.toISOString(),
        plannedEndDate: parsedWorkflowEnd.toISOString(),
        formData: startDocuments.length > 0
          ? {
              workflowStartDocuments:
                startDocuments.length === 1 ? startDocuments[0] : startDocuments,
            }
          : {},
      };

      // 3. Update task
      const updatedSteps = [
        ...(workflowSchedule?.steps || applyWorkflowStepReferenceDurations(task.workflowSteps || [])),
      ];
      if (updatedSteps.length > 0) {
        updatedSteps[0] = {
          ...updatedSteps[0],
          status: 'en_curso',
          startedAt: new Date()
        };
        if (updatedSteps[0].assignedTo === 'DYNAMIC' && firstStepAssignee) {
          updatedSteps[0].assignedTo = firstStepAssignee;
        }
      }

      const resolvedFirstStepAssignee = updatedSteps[0]?.assignedTo;
      const shouldAssignTaskToFirstStep =
        task.workflowSteps?.[0]?.assignedTo === 'DYNAMIC' &&
        resolvedFirstStepAssignee &&
        resolvedFirstStepAssignee !== 'DYNAMIC';

      await updateDoc(doc(db, 'projects', projectId, 'tasks', task.id), {
        title: cleanWorkflowId,
        name: cleanWorkflowId,
        originalTitle: task.originalTitle || getTaskTitle(task),
        status: 'in_progress',
        progress: 10,
        startDate: workflowSchedule?.workflowStartDate || parsedWorkflowStart,
        endDate: parsedWorkflowEnd,
        start: workflowSchedule?.workflowStartDate || parsedWorkflowStart,
        end: parsedWorkflowEnd,
        assignedTo: shouldAssignTaskToFirstStep ? resolvedFirstStepAssignee : task.assignedTo || '',
        externalWorkflowId: cleanWorkflowId,
        department: resolvedLocation.department,
        workflowDepartment: resolvedLocation.department,
        departmentCode: resolvedLocation.departmentCode,
        workflowDepartmentCode: resolvedLocation.departmentCode,
        municipality: cleanMunicipality,
        workflowMunicipality: cleanMunicipality,
        municipalityCode: resolvedLocation.municipalityCode,
        workflowMunicipalityCode: resolvedLocation.municipalityCode,
        locationKey: resolvedLocation.locationKey,
        workflowLocationKey: resolvedLocation.locationKey,
        initialObservation: observation,
        startDocumentId: documentId,
        startDocumentIds: startDocuments.map((documentValue) => documentValue.documentId),
        startDocuments,
        currentStepIndex: 0,
        workflowSteps: updatedSteps,
        workflowScheduleMode: workflowScheduleMode,
        workflowDayCountingEnabled,
        workflowTotalPlannedDays: workflowSchedule?.workflowTotalPlannedDays || getWorkflowTotalPlannedDays(updatedSteps),
        workflowHistory: [historyEntry, ...(task.workflowHistory || [])],
        updatedAt: serverTimestamp()
      });

      void notifyTaskAssignment({
        projectId,
        taskId: task.id,
        assigneeId: updatedSteps[0]?.assignedTo,
        stepIndex: 0,
        eventType: 'workflow_step_assigned',
        source: 'workflow_start',
      });

      if (task.parentTaskId) {
        const { updateParentTaskStatus } = await import('@/lib/taskUtils');
        await updateParentTaskStatus(projectId, task.parentTaskId);
      }

      toast.success("Workflow iniciado correctamente.");
      onClose();
    } catch (error: any) {
      console.error("Error starting workflow:", error);
      toast.error(`Error al iniciar el workflow: ${error.message}`);
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Iniciar Workflow</h2>
            <p className="text-sm text-slate-500 mt-1">
              {getTaskDisplayTitle(task)}
            </p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto">
          {/* Workflow ID */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
              <Hash size={16} className="text-slate-400" />
              ID del Workflow / Radicado
            </label>
            <input
              type="text"
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
              placeholder="Ej: WKF-2024-001"
              className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <label className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <MapPin size={16} className="text-indigo-500" />
              Ubicación oficial del workflow
            </label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <span className="mb-1 block text-xs font-medium text-slate-600">Departamento</span>
                <select
                  value={department}
                  onChange={(event) => {
                    setDepartment(event.target.value);
                    setMunicipality('');
                  }}
                  disabled={locationsLoading || !locationCatalog}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-100"
                >
                  <option value="">
                    {locationsLoading ? 'Cargando departamentos...' : 'Selecciona departamento'}
                  </option>
                  {(locationCatalog?.departments || []).map((option) => (
                    <option key={option.code} value={option.name}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <span className="mb-1 block text-xs font-medium text-slate-600">Municipio</span>
                <select
                  value={municipality}
                  onChange={(event) => setMunicipality(event.target.value)}
                  disabled={locationsLoading || !selectedDepartment}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-100"
                >
                  <option value="">
                    {selectedDepartment ? 'Selecciona municipio' : 'Primero elige departamento'}
                  </option>
                  {(selectedDepartment?.municipalities || []).map((option) => (
                    <option key={option.code} value={option.name}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Pixel guardará también los códigos territoriales para evitar cruces ambiguos en el mapa.
            </p>
          </div>

          <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4">
            <label className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Calendar size={16} className="text-indigo-500" />
              Cronograma del workflow
            </label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <span className="mb-1 block text-xs font-medium text-slate-600">Fecha inicio</span>
                <input
                  type="date"
                  value={workflowStartDate}
                  min={parentStartValue || undefined}
                  max={parentEndValue || undefined}
                  onChange={(e) => setWorkflowStartDate(e.target.value)}
                  className="w-full rounded-lg border border-indigo-100 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
              <div>
                <span className="mb-1 block text-xs font-medium text-slate-600">
                  {workflowDayCountingEnabled ? "Fecha fin calculada" : "Fecha fin del workflow"}
                </span>
                <input
                  type="date"
                  value={computedWorkflowEndValue}
                  min={workflowStartDate || parentStartValue || undefined}
                  max={parentEndValue || undefined}
                  onChange={(e) => setWorkflowEndDate(e.target.value)}
                  readOnly={Boolean(workflowSchedulePreview)}
                  className="w-full rounded-lg border border-indigo-100 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 read-only:bg-slate-50"
                />
              </div>
            </div>
            <div className="mt-3 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-xs text-slate-600">
              <span className="font-bold text-indigo-700">
                {workflowDayCountingEnabled
                  ? `Conteo por pasos activo · ${workflowScheduleMode === "business" ? "dias laborales" : "dias calendario"}`
                  : "Periodo fijo del workflow"}
              </span>
              {workflowSchedulePreview ? (
                <span>
                  {" "}· {workflowSchedulePreview.workflowTotalPlannedDays} dias distribuidos en {workflowSchedulePreview.steps.length} pasos.
                </span>
              ) : (
                <span>
                  {workflowDayCountingEnabled
                    ? " · El fin se calcula automaticamente cuando existan pasos configurados."
                    : " · Los dias de cada paso se guardan para estadisticas, no para limitar este periodo."}
                </span>
              )}
            </div>
            {parentTask && parentStartValue && parentEndValue && (
              <p className="mt-2 text-xs text-indigo-700">
                Debe quedar dentro de la tarea principal: {parentStartValue} a {parentEndValue}.
              </p>
            )}
          </div>

          {/* Initial Observation */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
              <MessageSquare size={16} className="text-slate-400" />
              Observación Inicial
            </label>
            <textarea
              value={observation}
              onChange={(e) => setObservation(e.target.value)}
              placeholder="Notas sobre el inicio de este proceso..."
              className="w-full h-24 px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
            />
          </div>

          {/* File Upload */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
              <Upload size={16} className="text-slate-400" />
              Documentos de inicio (Opcional)
            </label>
            <div className="relative group">
              <input
                type="file"
                multiple
                onChange={(e) => setFiles(Array.from(e.target.files || []))}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <div className={`w-full p-4 border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-2 transition-colors ${
                files.length > 0 ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 group-hover:border-indigo-300 group-hover:bg-slate-50'
              }`}>
                {files.length > 0 ? (
                  <>
                    <FileText className="text-emerald-500" size={24} />
                    <span className="text-sm font-medium text-emerald-700">
                      {files.length} documento{files.length === 1 ? '' : 's'} seleccionado{files.length === 1 ? '' : 's'}
                    </span>
                    <div className="w-full max-w-sm space-y-1">
                      {files.map((selectedFile) => (
                        <div
                          key={`${selectedFile.name}-${selectedFile.size}-${selectedFile.lastModified}`}
                          className="truncate rounded-lg border border-emerald-100 bg-white/80 px-3 py-1.5 text-xs font-semibold text-emerald-800"
                        >
                          {selectedFile.name}
                        </div>
                      ))}
                    </div>
                    <span className="text-xs text-emerald-600">Haga clic para cambiar los archivos</span>
                  </>
                ) : (
                  <>
                    <Upload className="text-slate-400" size={24} />
                    <span className="text-sm font-medium text-slate-600">Seleccionar documentos</span>
                    <span className="text-xs text-slate-400">Puede cargar uno o varios archivos</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Status Bar */}
          <div className="p-4 bg-indigo-50 rounded-xl border border-indigo-100">
            <p className="text-sm font-medium text-indigo-900">
              El workflow será enviado a:
            </p>
            {task.workflowSteps && task.workflowSteps.length > 0 && task.workflowSteps[0].assignedTo === 'DYNAMIC' ? (
              <div className="mt-2">
                <select
                  value={firstStepAssignee}
                  onChange={(e) => setFirstStepAssignee(e.target.value)}
                  className="w-full bg-white border border-indigo-200 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  required
                >
                  <option value="">Seleccione un responsable...</option>
                  {teamMembers.map(member => (
                    <option key={member.id} value={member.id}>{member.name}</option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="text-sm text-indigo-700 font-bold mt-1">
                {task.workflowSteps && task.workflowSteps.length > 0 
                  ? teamMembers.find(m => m.id === task.workflowSteps[0].assignedTo)?.name || 'Usuario no encontrado'
                  : 'No hay pasos definidos'}
              </p>
            )}
          </div>
        </div>

        <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-200 rounded-lg transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleStart}
            disabled={isStarting || locationsLoading || !workflowId.trim() || !department.trim() || !municipality.trim()}
            className="flex items-center gap-2 px-6 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
          >
            <Save size={16} />
            {isStarting ? 'Iniciando...' : 'Iniciar Proceso'}
          </button>
        </div>
      </div>
    </div>
  );
};
