"use client"

import React, { useState, useEffect } from 'react';
import { collection, query, onSnapshot, doc, updateDoc, addDoc, serverTimestamp, orderBy, where, getDocs, writeBatch, arrayUnion } from '@/lib/supabase/document-store';
import { ref, deleteObject } from '@/lib/supabase/storage-shim';
import { db, auth, storage } from '@/lib/backend';
import { ProjectGantt } from '@/components/projects/ProjectGantt';
import { IncrementTaskValueModal } from '@/components/projects/modals/IncrementTaskValueModal';
import { WorkflowStepFormBuilderModal, CustomForm } from '@/components/projects/WorkflowStepFormBuilderModal';
import { Button } from '@/components/ui/button';
import { Plus, Calendar, Users, ListTodo, AlertCircle, X, Loader2, Search, ClipboardList } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { belongsToAnyOrganization } from '@/lib/organizations';
import { getCompletionStatusForTask, getProgressForTaskStatus } from '@/lib/taskProgress';
import { normalizeRateCardUnits } from '@/lib/rate-card-config';
import { addTraceableRateCardMovementToBatch } from '@/lib/rate-card-trace';
import {
  getIncrementalRateBinding,
  isRateDrivenIncrementalTask,
  syncRateDrivenIncrementalTasksForRate,
} from '@/lib/incremental-rate-tasks';
import {
  getWorkflowTaskTypeLabel,
  isStateWorkflowTaskType,
  isVariableWorkflowTaskType,
  isWorkflowTaskType,
  normalizeStateWorkflowSteps,
} from '@/lib/workflow-routing';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface DataStoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleDataError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: DataStoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Supabase Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export const GanttOverview: React.FC = () => {
  const { user, userRole, userOrganizationId, userOrganizationIds } = useAuth();
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [tasks, setTasks] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [rateCards, setRateCards] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [projectData, setProjectData] = useState<any>(null);

  // Task creation modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDesc, setNewTaskDesc] = useState('');
  const [newTaskStart, setNewTaskStart] = useState('');
  const [newTaskEnd, setNewTaskEnd] = useState('');
  const [newTaskAssignedTo, setNewTaskAssignedTo] = useState('');
  const [newTaskType, setNewTaskType] = useState<'quantitative' | 'state' | 'state_workflow' | 'workflow' | 'workflow_variable'>('workflow');
  const [workflowSteps, setWorkflowSteps] = useState<{assignedTo: string, label: string, assignsNextStep?: boolean}[]>([]);
  const [newTaskIndicator, setNewTaskIndicator] = useState('');
  const [newTaskIndicatorValue, setNewTaskIndicatorValue] = useState(0);
  const [incrementForm, setIncrementForm] = useState<CustomForm | undefined>(undefined);
  const [isIncrementFormBuilderOpen, setIsIncrementFormBuilderOpen] = useState(false);
  const [newTaskStatus, setNewTaskStatus] = useState('todo');
  const [newTaskPriority, setNewTaskPriority] = useState('medium');
  const [newTaskRequiresDoc, setNewTaskRequiresDoc] = useState(false);
  const [newTaskIsRateCard, setNewTaskIsRateCard] = useState(false);
  const [newTaskRateCardId, setNewTaskRateCardId] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<{id: string, title: string} | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedTaskForIncrement, setSelectedTaskForIncrement] = useState<any>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const managedOrganizationIds = React.useMemo(
    () => (userOrganizationIds.length > 0 ? userOrganizationIds : userOrganizationId ? [userOrganizationId] : []),
    [userOrganizationId, userOrganizationIds]
  );

  // Fetch all projects
  useEffect(() => {
    if (!user || !userRole) return;
    
    let q;
    if (userRole === 'admin' || userRole === 'org_admin') {
      q = query(collection(db, 'projects'), orderBy('createdAt', 'desc'));
    } else {
      q = query(collection(db, 'projects'), where('assignedTeamMembers', 'array-contains', user.uid));
    }
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      let data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      if (userRole === 'org_admin') {
        data = data.filter((project) => belongsToAnyOrganization(project, managedOrganizationIds));
      }
      // Sort in memory if 'where' was used (Firebase limitation)
      if (userRole !== 'admin') {
        data.sort((a: any, b: any) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
      }
      setProjects(data);
    }, (error) => {
      handleDataError(error, OperationType.LIST, 'projects');
    });
    return () => unsubscribe();
  }, [user, userRole, managedOrganizationIds]);

  // Fetch team members
  useEffect(() => {
    if (!user) return;
    let q = query(collection(db, 'team_members'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      let data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      if (userRole !== 'admin') {
        data = data.filter((member) => belongsToAnyOrganization(member, managedOrganizationIds));
      }
      setTeamMembers(data);
    }, (error) => {
      handleDataError(error, OperationType.LIST, 'team_members');
    });
    return () => unsubscribe();
  }, [user, userRole, managedOrganizationIds]);

  // Fetch tasks and project details when a project is selected
  useEffect(() => {
    if (!user || !selectedProjectId) {
      setTasks([]);
      setProjectData(null);
      return;
    }

    setLoading(true);

    // Project details
    const projectRef = doc(db, 'projects', selectedProjectId);
    const unsubscribeProject = onSnapshot(projectRef, (docSnap) => {
      if (docSnap.exists()) {
        setProjectData({ id: docSnap.id, ...docSnap.data() });
      }
    }, (error) => {
      handleDataError(error, OperationType.GET, `projects/${selectedProjectId}`);
    });

    // Tasks
    const qTasks = query(collection(db, 'projects', selectedProjectId, 'tasks'), orderBy('displayOrder', 'asc'));
    const unsubscribeTasks = onSnapshot(qTasks, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTasks(data);
      setLoading(false);
    }, (error) => {
      handleDataError(error, OperationType.LIST, `projects/${selectedProjectId}/tasks`);
    });

    // Rate Cards
    const qRateCards = query(collection(db, 'projects', selectedProjectId, 'rateCards'));
    const unsubscribeRateCards = onSnapshot(qRateCards, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setRateCards(data);
    }, (error) => {
      handleDataError(error, OperationType.LIST, `projects/${selectedProjectId}/rateCards`);
    });

    return () => {
      unsubscribeProject();
      unsubscribeTasks();
      unsubscribeRateCards();
    };
  }, [user, selectedProjectId]);

  const filteredTasks = tasks.filter(t => 
    t.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleUpdateTaskProgress = async (taskId: string, progress: number, task: any) => {
    try {
      let status = 'in_progress';
      if (progress === 0) status = 'todo';
      if (progress === 100) status = 'completed';

      await updateDoc(doc(db, 'projects', selectedProjectId, 'tasks', taskId), {
        progress,
        status,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Error updating task progress:", error);
    }
  };

  const handleUpdateTaskValue = async (taskId: string, value: number, task: any) => {
    try {
      const delegatesIncrementToSubtasks =
        task?.type === 'quantitative' &&
        (task?.incrementDelegatedToSubtasks || task?.isParentTask || Number(task?.totalSubtasks || 0) > 0);
      if (delegatesIncrementToSubtasks) {
        toast.info('Esta tarea incremental delega su avance en sus subtareas.');
        return;
      }

      if (isRateDrivenIncrementalTask(task)) {
        const binding = getIncrementalRateBinding(task);
        toast.info('Esta tarea incremental se actualiza únicamente con el Rate Card configurado.');
        if (binding?.rateCardId) {
          await syncRateDrivenIncrementalTasksForRate({
            projectId: selectedProjectId,
            rateCardId: binding.rateCardId,
            tasks,
          });
        }
        return;
      }

      const targetValue = Number(task.indicatorValue || 0);
      if (targetValue <= 0) {
        toast.warning('Esta tarea no tiene una meta válida configurada.');
        return;
      }

      const safeValue = Math.min(Math.max(Number(value) || 0, 0), targetValue);
      const progress = Math.min(100, Math.round((safeValue / targetValue) * 100));
      const requiresCompletionDocument = progress === 100 && task.requiresDocument && !task.linkedDocumentId;
      let status = 'in_progress';
      if (progress === 0) status = 'todo';
      if (progress === 100) status = requiresCompletionDocument ? 'in_progress' : 'completed';

      await updateDoc(doc(db, 'projects', selectedProjectId, 'tasks', taskId), {
        currentValue: safeValue,
        progress,
        status,
        updatedAt: serverTimestamp()
      });

      if (task.parentTaskId) {
        const { updateParentTaskStatus } = await import('@/lib/taskUtils');
        await updateParentTaskStatus(selectedProjectId, task.parentTaskId);
      }

      if (requiresCompletionDocument) {
        toast.info('La tarea llegó a la meta. Adjunta el documento requerido desde el detalle del proyecto.');
      }
    } catch (error) {
      console.error("Error updating task value:", error);
    }
  };

  const handleIncrementTaskValue = async (
    task: any,
    amount: number,
    formData: Record<string, any>,
    comment: string
  ) => {
    const delegatesIncrementToSubtasks =
      task?.type === 'quantitative' &&
      (task?.incrementDelegatedToSubtasks || task?.isParentTask || Number(task?.totalSubtasks || 0) > 0);
    if (delegatesIncrementToSubtasks) {
      toast.info('Esta tarea incremental delega su avance en sus subtareas.');
      return;
    }

    if (isRateDrivenIncrementalTask(task)) {
      const binding = getIncrementalRateBinding(task);
      toast.info('Esta tarea incremental solo puede avanzar con movimientos del Rate Card configurado.');
      if (binding?.rateCardId) {
        await syncRateDrivenIncrementalTasksForRate({
          projectId: selectedProjectId,
          rateCardId: binding.rateCardId,
          tasks,
        });
      }
      return;
    }

    const incrementAmount = Number(amount);
    const targetValue = Number(task?.indicatorValue || 0);
    const currentValue = Number(task?.currentValue || 0);

    if (!incrementAmount || incrementAmount <= 0) {
      toast.warning('Ingresa un incremento mayor a cero.');
      return;
    }

    if (!targetValue || targetValue <= 0) {
      toast.warning('Esta tarea no tiene una meta válida configurada.');
      return;
    }

    const nextValue = Math.min(targetValue, currentValue + incrementAmount);
    const appliedAmount = nextValue - currentValue;

    if (appliedAmount <= 0) {
      toast.info('La tarea ya alcanzó la meta.');
      return;
    }

    try {
      const progress = Math.min(100, Math.round((nextValue / targetValue) * 100));
      const requiresCompletionDocument = progress === 100 && task.requiresDocument && !task.linkedDocumentId;
      let status = 'in_progress';
      if (progress === 0) status = 'todo';
      if (progress === 100) status = requiresCompletionDocument ? 'in_progress' : 'completed';

      const batch = writeBatch(db);
      const taskRef = doc(db, 'projects', selectedProjectId, 'tasks', task.id);

      if (!isWorkflowTaskType(task.type) && task.isRateCardTask && task.rateCardId && task.unitsToAdd) {
        const oldProgress = task.progress || 0;
        const deltaProgress = progress - oldProgress;
        const unitsDelta = (deltaProgress / 100) * normalizeRateCardUnits(task.unitsToAdd, 0);

        if (unitsDelta !== 0) {
          addTraceableRateCardMovementToBatch(batch, {
            projectId: selectedProjectId,
            task,
            rateCardId: task.rateCardId,
            assignedTo: task.assignedTo || null,
            units: Math.abs(unitsDelta),
            source: 'gantt_incremental_task_progress_update',
            rateCardSourceKey: `gantt_incremental_task_progress:${oldProgress}->${progress}`,
            comment: `Avance incremental actualizado desde Gantt de ${oldProgress}% a ${progress}%.`,
            occurredAt: new Date(),
            actor: {
              id: user?.uid || null,
              email: user?.email || null,
              name: user?.displayName || user?.email || null,
            },
            reversal: unitsDelta < 0,
            completionMode: 'gantt_incremental_task_progress_update',
          });
        }
      }

      if (task.incrementForm?.rateCardId) {
        const units = normalizeRateCardUnits(task.incrementForm.unitsToAdd);
        addTraceableRateCardMovementToBatch(batch, {
          projectId: selectedProjectId,
          task,
          rateCardId: task.incrementForm.rateCardId,
          assignedTo: task.assignedTo || null,
          units,
          source: 'gantt_increment_form_update',
          rateCardSourceKey: `gantt_increment_form:${task.currentValue || 0}->${nextValue}`,
          comment: 'Movimiento registrado desde incremento de Gantt.',
          occurredAt: new Date(),
          actor: {
            id: user?.uid || null,
            email: user?.email || null,
            name: user?.displayName || user?.email || null,
          },
          completionMode: 'gantt_increment_form_update',
        });
      }

      batch.update(taskRef, {
        currentValue: nextValue,
        progress,
        status,
        updatedAt: serverTimestamp(),
        incrementHistory: arrayUnion({
          id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
          amount: appliedAmount,
          requestedAmount: incrementAmount,
          previousValue: currentValue,
          nextValue,
          indicator: task.indicator || '',
          formData: Object.keys(formData || {}).length > 0 ? formData : null,
          comment: comment.trim() || null,
          createdAt: new Date().toISOString(),
          createdBy: user?.uid || 'unknown',
        }),
      });

      await batch.commit();

      if (task.parentTaskId) {
        const { updateParentTaskStatus } = await import('@/lib/taskUtils');
        await updateParentTaskStatus(selectedProjectId, task.parentTaskId);
      }

      if (requiresCompletionDocument) {
        toast.info('La tarea llegó a la meta. Adjunta el documento requerido desde el detalle del proyecto.');
      } else {
        toast.success(`Incremento registrado: ${nextValue}/${targetValue} ${task.indicator || ''}`.trim());
      }
    } catch (error) {
      console.error("Error incrementing task value:", error);
      throw error;
    }
  };

  const handleUpdateTaskStatus = async (taskId: string, status: string, task: any) => {
    try {
      if (task.isParentTask) {
        toast.info("El estado de esta tarea madre se actualiza automáticamente según sus subtareas.");
        return;
      }

      const finalStatus = getCompletionStatusForTask(status, task);

      const progress = getProgressForTaskStatus(finalStatus, task.progress);

      await updateDoc(doc(db, 'projects', selectedProjectId, 'tasks', taskId), {
        status: finalStatus,
        progress,
        priority: task.priority || 'medium',
        updatedAt: serverTimestamp()
      });

      if (task.parentTaskId) {
        const { updateParentTaskStatus } = await import('@/lib/taskUtils');
        await updateParentTaskStatus(selectedProjectId, task.parentTaskId);
      }
    } catch (error) {
      console.error("Error updating task status:", error);
    }
  };

  const handleUpdateTaskDates = async (taskId: string, start: Date, end: Date, task: any) => {
    try {
      await updateDoc(doc(db, 'projects', selectedProjectId, 'tasks', taskId), {
        startDate: start,
        endDate: end,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Error updating task dates:", error);
    }
  };

  const handleDeleteTask = (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (task) {
      setTaskToDelete({ id: taskId, title: task.title });
    }
  };

  const executeDeleteTask = async () => {
    if (!taskToDelete) return;
    setIsDeleting(true);
    try {
      const task = tasks.find(t => t.id === taskToDelete.id);
      if (!task) {
        setTaskToDelete(null);
        return;
      }

      const storageDeletionPromises: Promise<void>[] = [];

      const collectTaskTreeFromDatabase = async (rootTask: any) => {
        const taskMap = new Map<string, any>([[rootTask.id, rootTask]]);
        const taskRefs = new Map<string, ReturnType<typeof doc>>([
          [rootTask.id, doc(db, 'projects', selectedProjectId, 'tasks', rootTask.id)],
        ]);
        const pendingIds = [rootTask.id];
        const visitedParents = new Set<string>();

        while (pendingIds.length > 0) {
          const parentId = pendingIds.shift();
          if (!parentId || visitedParents.has(parentId)) continue;
          visitedParents.add(parentId);

          const childrenSnapshot = await getDocs(query(
            collection(db, 'projects', selectedProjectId, 'tasks'),
            where('parentTaskId', '==', parentId)
          ));

          childrenSnapshot.docs.forEach((docSnap) => {
            if (taskMap.has(docSnap.id)) return;
            taskMap.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
            taskRefs.set(docSnap.id, docSnap.ref);
            pendingIds.push(docSnap.id);
          });
        }

        return { taskMap, taskRefs };
      };

      const deleteTaskLinkedData = async (batch: ReturnType<typeof writeBatch>, taskId: string) => {
        const [qualitySnapshot, commentsSnapshot, documentsSnapshot] = await Promise.all([
          getDocs(query(collection(db, 'projects', selectedProjectId, 'qualityEvents'), where('taskId', '==', taskId))),
          getDocs(query(collection(db, 'projects', selectedProjectId, 'tasks', taskId, 'comments'))),
          getDocs(query(collection(db, 'projects', selectedProjectId, 'documents'), where('taskId', '==', taskId))),
        ]);

        qualitySnapshot.docs.forEach((docSnap) => batch.delete(docSnap.ref));
        commentsSnapshot.docs.forEach((docSnap) => batch.delete(docSnap.ref));
        documentsSnapshot.docs.forEach((docSnap) => {
          const data = docSnap.data();
          if (data?.storagePath) {
            storageDeletionPromises.push(
              deleteObject(ref(storage, data.storagePath)).catch((storageError) => {
                console.warn('No se pudo eliminar el archivo asociado a la tarea:', storageError);
              })
            );
          }
          batch.delete(docSnap.ref);
        });
      };

      const cleanLogbookTaskLinks = async (batch: ReturnType<typeof writeBatch>, deletedTaskIds: Set<string>) => {
        const logbookSnapshot = await getDocs(collection(db, 'projects', selectedProjectId, 'logbookEntries'));

        logbookSnapshot.docs.forEach((docSnap) => {
          const data = docSnap.data();
          let hasChanges = false;

          const derivedLinks = Array.isArray(data.derivedLinks)
            ? data.derivedLinks.filter((link: any) => !deletedTaskIds.has(link?.taskId))
            : data.derivedLinks;

          if (Array.isArray(data.derivedLinks) && derivedLinks.length !== data.derivedLinks.length) {
            hasChanges = true;
          }

          const actionCandidates = Array.isArray(data.actionCandidates)
            ? data.actionCandidates.map((candidate: any) => {
                if (!candidate?.linkedTaskId || !deletedTaskIds.has(candidate.linkedTaskId)) return candidate;
                hasChanges = true;
                return {
                  ...candidate,
                  status: 'open',
                  linkedTaskId: null,
                  linkedTaskTitle: null,
                  relationType: null,
                };
              })
            : data.actionCandidates;

          if (!hasChanges) return;

          batch.update(docSnap.ref, {
            derivedLinks,
            actionCandidates,
            updatedAt: serverTimestamp(),
          });
        });
      };

      const batch = writeBatch(db);
      const { taskMap, taskRefs } = await collectTaskTreeFromDatabase(task);
      const taskIdsToDelete = new Set(taskMap.keys());

      taskIdsToDelete.forEach((taskId) => {
        batch.delete(taskRefs.get(taskId) || doc(db, 'projects', selectedProjectId, 'tasks', taskId));
      });

      await Promise.all(Array.from(taskIdsToDelete).map((taskId) => deleteTaskLinkedData(batch, taskId)));
      await cleanLogbookTaskLinks(batch, taskIdsToDelete);
      await Promise.all(storageDeletionPromises);
      await batch.commit();

      if (task?.parentTaskId && !taskIdsToDelete.has(task.parentTaskId)) {
        const { updateParentTaskStatus } = await import('@/lib/taskUtils');
        await updateParentTaskStatus(selectedProjectId, task.parentTaskId);
      }

      setTaskToDelete(null);
    } catch (error) {
      console.error("Error deleting task:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleReorderTasks = async (newTasks: any[]) => {
    try {
      const promises = newTasks.map((task, index) => {
        return updateDoc(doc(db, 'projects', selectedProjectId, 'tasks', task.id), {
          displayOrder: index,
          updatedAt: serverTimestamp()
        });
      });
      await Promise.all(promises);
    } catch (error) {
      console.error("Error reordering tasks:", error);
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newTaskTitle.trim() || !newTaskStart || !newTaskEnd || !newTaskAssignedTo) {
      toast.warning("Por favor completa todos los campos obligatorios.");
      return;
    }

    if (newTaskType === 'quantitative' && Number(newTaskIndicatorValue) <= 0) {
      toast.warning("Define una meta mayor a cero para la tarea cuantitativa.");
      return;
    }

    if (isWorkflowTaskType(newTaskType) && workflowSteps.length === 0) {
      toast.warning("Agrega al menos un paso al procedimiento.");
      return;
    }

    setIsCreating(true);
    try {
      const taskData: any = {
        projectId: selectedProjectId,
        title: newTaskTitle,
        description: newTaskDesc,
        startDate: new Date(newTaskStart + 'T00:00:00'),
        endDate: new Date(newTaskEnd + 'T00:00:00'),
        assignedTo: newTaskAssignedTo,
        indicator: newTaskType === 'quantitative' ? newTaskIndicator : null,
        indicatorValue: newTaskType === 'quantitative' ? Number(newTaskIndicatorValue) : null,
        status: isStateWorkflowTaskType(newTaskType) ? 'todo' : newTaskStatus,
        progress: isStateWorkflowTaskType(newTaskType)
          ? 0
          : newTaskStatus === 'completed'
            ? 100
            : newTaskStatus === 'in_progress'
              ? 10
              : 0,
        priority: newTaskPriority,
        type: newTaskType,
        requiresDocument: newTaskRequiresDoc,
        linkedDocumentId: null,
        isRateCardTask: newTaskIsRateCard,
        rateCardId: newTaskIsRateCard ? newTaskRateCardId : null,
        syncExternal: newTaskIsRateCard ? (rateCards.find(rc => rc.id === newTaskRateCardId)?.syncExternal || false) : false,
        currentValue: 0,
        incrementForm: newTaskType === 'quantitative' ? incrementForm || null : null,
        incrementHistory: newTaskType === 'quantitative' ? [] : null,
        displayOrder: tasks.length,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: user.uid
      };

      if (isWorkflowTaskType(newTaskType)) {
        const configuredSteps = workflowSteps.map(step => ({
          ...step,
          status: 'not_started'
        }));
        taskData.workflowSteps = isStateWorkflowTaskType(newTaskType)
          ? normalizeStateWorkflowSteps(configuredSteps)
          : configuredSteps;
        taskData.currentStepIndex = 0;
        taskData.workflowHistory = [];
        taskData.progress = 0; // Workflows start at 0%
        taskData.workflowCycles = 1;
        taskData.currentCycle = 1;
        taskData.workflowMode = isStateWorkflowTaskType(newTaskType)
          ? 'state_linear'
          : isVariableWorkflowTaskType(newTaskType)
            ? 'variable'
            : 'linear';
        taskData.isVariableWorkflow = isVariableWorkflowTaskType(newTaskType);
        taskData.stateWorkflow = isStateWorkflowTaskType(newTaskType);
        taskData.singleExecution = isStateWorkflowTaskType(newTaskType);
      }

      await addDoc(collection(db, 'projects', selectedProjectId, 'tasks'), taskData);
      
      setIsModalOpen(false);
      // Reset form
      setNewTaskTitle('');
      setNewTaskDesc('');
      setNewTaskStart('');
      setNewTaskEnd('');
      setNewTaskAssignedTo('');
      setNewTaskIndicator('');
      setNewTaskIndicatorValue(0);
      setIncrementForm(undefined);
      setIsIncrementFormBuilderOpen(false);
      setNewTaskStatus('todo');
      setNewTaskPriority('medium');
      setNewTaskType('quantitative');
      setNewTaskRequiresDoc(false);
      setNewTaskIsRateCard(false);
      setNewTaskRateCardId('');
      setWorkflowSteps([]);
    } catch (error: any) {
      console.error("Error creating task:", error);
      toast.error(`Error al crear la tarea: ${error.message}`);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-bold text-slate-900">Vista de Cronograma</h2>
          <p className="text-xs text-slate-500">Selecciona un proyecto para visualizar y gestionar su diagrama de Gantt.</p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input 
              type="text"
              placeholder="Buscar tarea..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-10 pl-9 pr-4 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 w-48"
            />
          </div>

          <select 
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className="h-10 px-4 rounded-lg border border-slate-200 bg-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 min-w-[240px]"
          >
            <option value="">Seleccionar Proyecto...</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          {selectedProjectId && (
            <Button 
              onClick={() => setIsModalOpen(true)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white h-10 px-4"
            >
              <Plus size={18} className="mr-2" /> Nueva Tarea
            </Button>
          )}
        </div>
      </div>

      {!selectedProjectId ? (
        <div className="flex flex-col items-center justify-center py-24 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
          <Calendar size={48} className="text-slate-300 mb-4" />
          <h3 className="text-slate-900 font-bold">Ningún proyecto seleccionado</h3>
          <p className="text-slate-500 text-sm mt-1">Elige un proyecto del menú superior para ver su cronograma.</p>
        </div>
      ) : loading ? (
        <div className="flex flex-col items-center justify-center py-24">
          <Loader2 size={32} className="text-indigo-600 animate-spin mb-4" />
          <p className="text-slate-500 text-sm">Cargando cronograma...</p>
        </div>
      ) : (
        <div className="h-[calc(100vh-320px)] min-h-[500px]">
          <ProjectGantt 
            tasks={filteredTasks}
            teamMembers={teamMembers}
            onUpdateTaskProgress={handleUpdateTaskProgress}
            onUpdateTaskValue={handleUpdateTaskValue}
            onUpdateTaskStatus={handleUpdateTaskStatus}
            onDeleteTask={handleDeleteTask}
            onSyncTask={() => {}} // Not used in this view for now
            onReorderTasks={handleReorderTasks}
            onUpdateTaskDates={handleUpdateTaskDates}
            onOpenIncrementTask={setSelectedTaskForIncrement}
            onCreateTask={() => setIsModalOpen(true)}
          />
        </div>
      )}

      {/* Task Creation Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-6 border-b border-slate-100 sticky top-0 bg-white z-10">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">
                  <ListTodo size={20} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Nueva Tarea</h3>
                  <p className="text-xs text-slate-500">Proyecto: {projectData?.name}</p>
                </div>
              </div>
              <button 
                onClick={() => {
                  setIsModalOpen(false);
                  setIncrementForm(undefined);
                  setIsIncrementFormBuilderOpen(false);
                }}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateTask} className="p-6 space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">Título de la Tarea</label>
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
                  <label className="text-sm font-bold text-slate-700">Descripción (Opcional)</label>
                  <textarea 
                    value={newTaskDesc}
                    onChange={(e) => setNewTaskDesc(e.target.value)}
                    className="w-full min-h-[80px] p-4 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm resize-none"
                    placeholder="Detalles de la tarea..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700">Fecha Inicio</label>
                    <input 
                      type="date" 
                      value={newTaskStart}
                      onChange={(e) => setNewTaskStart(e.target.value)}
                      className="w-full h-11 px-4 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700">Fecha Fin</label>
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
                    <label className="text-sm font-bold text-slate-700">Asignar a</label>
                    <select 
                      value={newTaskAssignedTo}
                      onChange={(e) => setNewTaskAssignedTo(e.target.value)}
                      className="w-full h-11 px-4 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                      required
                    >
                      <option value="">Seleccionar miembro...</option>
                      {projectData?.assignedTeamMembers?.map((memberId: string) => {
                        const member = teamMembers.find(m => m.id === memberId);
                        if (!member) return null;
                        return <option key={member.id} value={member.id}>{member.name}</option>;
                      })}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700">Prioridad</label>
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
                    <label className="text-sm font-bold text-slate-700">Estado Inicial</label>
                    <select 
                      value={newTaskStatus}
                      onChange={(e) => setNewTaskStatus(e.target.value)}
                      disabled={isStateWorkflowTaskType(newTaskType)}
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
                      <label className="text-sm font-bold text-slate-700">Tipo de Tarea</label>
                      <span className="text-[9px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100 uppercase tracking-tighter">
                        {isWorkflowTaskType(newTaskType) ? getWorkflowTaskTypeLabel(newTaskType) : newTaskType === 'state' ? 'Estado simple' : 'Tarea'}
                      </span>
                    </div>
                    <select 
                      value={newTaskType}
                      onChange={(e) => {
                        const nextType = e.target.value as 'quantitative' | 'state' | 'state_workflow' | 'workflow' | 'workflow_variable';
                        setNewTaskType(nextType);
                        if (isStateWorkflowTaskType(nextType)) setNewTaskStatus('todo');
                      }}
                      className="w-full h-11 px-4 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                    >
                      <option value="workflow">Workflow (Flujo)</option>
                      <option value="workflow_variable">Workflow variable</option>
                      <option value="state_workflow">Por estado procedimental</option>
                      <option value="quantitative">Cuantitativa</option>
                      <option value="state">Estado simple</option>
                    </select>
                  </div>
                </div>

                {isWorkflowTaskType(newTaskType) && (
                  <div className="space-y-4 p-4 bg-indigo-50/50 rounded-xl border border-indigo-100">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-indigo-600 uppercase tracking-wider">
                        {isStateWorkflowTaskType(newTaskType) ? 'Estados consecutivos del procedimiento' : 'Pasos del Workflow'}
                      </label>
                      <Button 
                        type="button" 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => setWorkflowSteps([...workflowSteps, { assignedTo: '', label: '' }])}
                        className="h-7 text-[10px] font-bold text-indigo-600 hover:bg-indigo-100"
                      >
                        <Plus size={12} className="mr-1" /> AGREGAR PASO
                      </Button>
                    </div>
                    
                    {workflowSteps.length === 0 ? (
                      <p className="text-[10px] text-slate-400 text-center py-2 italic">No hay pasos definidos. Agrega al menos uno.</p>
                    ) : (
                      <div className="space-y-3">
                        {workflowSteps.map((step, idx) => (
                          <div key={idx} className="flex flex-col gap-2 bg-white p-2 rounded-lg border border-indigo-100 shadow-sm">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                                {idx + 1}
                              </div>
                              <input 
                                type="text"
                                placeholder="Nombre del paso"
                                value={step.label}
                                onChange={(e) => {
                                  const newSteps = [...workflowSteps];
                                  newSteps[idx].label = e.target.value;
                                  setWorkflowSteps(newSteps);
                                }}
                                className="flex-1 h-8 px-2 text-xs border-none focus:ring-0"
                                required
                              />
                              <select
                                value={step.assignedTo}
                                onChange={(e) => {
                                  const newSteps = [...workflowSteps];
                                  newSteps[idx].assignedTo = e.target.value;
                                  setWorkflowSteps(newSteps);
                                }}
                                className="w-32 h-8 px-2 text-[10px] border-none focus:ring-0 bg-slate-50 rounded"
                                required
                              >
                                <option value="">Asignar a...</option>
                                <option value="DYNAMIC">Asignación dinámica</option>
                                {projectData?.assignedTeamMembers?.map((memberId: string) => {
                                  const member = teamMembers.find(m => m.id === memberId);
                                  if (!member) return null;
                                  return <option key={member.id} value={member.id}>{member.name}</option>;
                                })}
                              </select>
                              <button 
                                type="button"
                                onClick={() => setWorkflowSteps(workflowSteps.filter((_, i) => i !== idx))}
                                className="p-1 text-slate-300 hover:text-red-500"
                              >
                                <X size={14} />
                              </button>
                            </div>
                            {idx < workflowSteps.length - 1 && (
                              <div className="flex items-center gap-2 pl-8">
                                <label className="flex items-center gap-2 text-[10px] text-slate-500 cursor-pointer">
                                  <input 
                                    type="checkbox"
                                    checked={step.assignsNextStep || false}
                                    onChange={(e) => {
                                      const newSteps = [...workflowSteps];
                                      newSteps[idx].assignsNextStep = e.target.checked;
                                      if (e.target.checked) {
                                        newSteps[idx + 1].assignedTo = 'DYNAMIC';
                                      } else if (newSteps[idx + 1].assignedTo === 'DYNAMIC') {
                                        newSteps[idx + 1].assignedTo = '';
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

                {newTaskType === 'quantitative' && (
                  <div className="space-y-4 p-4 bg-slate-50 rounded-xl border border-slate-100">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Indicador</label>
                        <input
                          type="text"
                          value={newTaskIndicator}
                          onChange={(e) => setNewTaskIndicator(e.target.value)}
                          className="w-full h-10 px-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                          placeholder="Ej. Horas"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Meta</label>
                        <input
                          type="number"
                          value={newTaskIndicatorValue}
                          onChange={(e) => setNewTaskIndicatorValue(Number(e.target.value))}
                          className="w-full h-10 px-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                        />
                      </div>
                    </div>

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
                  </div>
                )}

                <div className="flex items-center gap-3 pt-4 border-t border-slate-100">
                  <input 
                    type="checkbox" 
                    id="isRateCardModal"
                    checked={newTaskIsRateCard}
                    onChange={(e) => setNewTaskIsRateCard(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <label htmlFor="isRateCardModal" className="text-sm font-medium text-slate-700 cursor-pointer">
                    Vincular a un perfil de Rate Card
                  </label>
                </div>

                {newTaskIsRateCard && (
                  <div className="space-y-2 animate-in slide-in-from-top-2 duration-200">
                    <label className="text-sm font-bold text-slate-700">Seleccionar Perfil</label>
                    <select 
                      value={newTaskRateCardId}
                      onChange={(e) => {
                        setNewTaskRateCardId(e.target.value);
                        const rc = rateCards.find(r => r.id === e.target.value);
                        if (rc) setNewTaskIndicator(rc.indicator);
                      }}
                      className="w-full h-11 px-4 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                    >
                      <option value="">Seleccionar...</option>
                      {rateCards.map(rc => (
                        <option key={rc.id} value={rc.id}>{rc.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-4">
                <Button 
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsModalOpen(false);
                    setWorkflowSteps([]);
                    setIncrementForm(undefined);
                    setIsIncrementFormBuilderOpen(false);
                  }}
                  className="flex-1 h-12 rounded-xl border-slate-200 text-slate-600 hover:bg-slate-50"
                >
                  Cancelar
                </Button>
                <Button 
                  type="submit" 
                  disabled={isCreating}
                  className="flex-1 h-12 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold"
                >
                  {isCreating ? <Loader2 className="animate-spin" size={20} /> : 'Crear Tarea'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
      {isIncrementFormBuilderOpen && (
        <WorkflowStepFormBuilderModal
          isOpen={isIncrementFormBuilderOpen}
          onClose={() => setIsIncrementFormBuilderOpen(false)}
          stepName={newTaskTitle || "Incremento de contador"}
          initialForm={incrementForm}
          rateCards={rateCards}
          teamMembers={teamMembers}
          projectId={selectedProjectId}
          project={projectData}
          allowDynamicRateCard={false}
          onSave={(form) => setIncrementForm(form)}
        />
      )}
      {/* Delete Task Modal */}
      {taskToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 m-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 text-red-600 mb-4">
              <div className="p-2 bg-red-100 rounded-full">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900">Eliminar Tarea</h3>
            </div>
            
            <p className="text-slate-600 mb-6">
              ¿Estás seguro de que deseas eliminar la tarea <strong className="text-slate-900">&quot;{taskToDelete.title}&quot;</strong>? 
              Esta acción no se puede deshacer.
            </p>
            
            <div className="flex justify-end gap-3">
              <Button 
                variant="outline" 
                onClick={() => setTaskToDelete(null)}
                disabled={isDeleting}
                className="border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </Button>
              <Button 
                onClick={executeDeleteTask}
                disabled={isDeleting}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {isDeleting ? 'Eliminando...' : 'Sí, eliminar tarea'}
              </Button>
            </div>
          </div>
        </div>
      )}
      <IncrementTaskValueModal
        isOpen={!!selectedTaskForIncrement}
        onClose={() => setSelectedTaskForIncrement(null)}
        task={selectedTaskForIncrement}
        onSubmit={handleIncrementTaskValue}
      />
    </div>
  );
};
