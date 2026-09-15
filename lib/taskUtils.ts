import { collection, query, where, getDoc, getDocs, doc, updateDoc, serverTimestamp } from '@/lib/supabase/document-store';
import { db } from './backend';

const COMPLETED_STATUSES = new Set(['completed', 'completed_late', 'listo']);
const ACTIVE_STATUSES = new Set(['in_progress', 'en_curso', 'trabajando', 'reproceso']);

export const updateParentTaskStatus = async (projectId: string, parentTaskId: string) => {
  try {
    // Get all subtasks for this parent
    const subtasksQuery = query(
      collection(db, 'projects', projectId, 'tasks'),
      where('parentTaskId', '==', parentTaskId)
    );
    const snapshot = await getDocs(subtasksQuery);
    
    if (snapshot.empty) return;

    const subtasks = snapshot.docs.map(doc => doc.data());
    const parentRef = doc(db, 'projects', projectId, 'tasks', parentTaskId);
    const parentSnapshot = await getDoc(parentRef);
    const parentTask = parentSnapshot.exists() ? parentSnapshot.data() : null;
    const parentIsDelegatedIncremental =
      parentTask?.type === 'quantitative' &&
      (parentTask.incrementDelegatedToSubtasks || parentTask.isParentTask || Number(parentTask.totalSubtasks || 0) > 0);
    
    // Determine parent status
    let allDone = true;
    let anyStarted = false;
    let totalProgress = 0;

    subtasks.forEach(task => {
      const status = task.status || 'todo';
      if (!COMPLETED_STATUSES.has(status)) allDone = false;
      if (ACTIVE_STATUSES.has(status) || COMPLETED_STATUSES.has(status)) anyStarted = true;
      
      totalProgress += Math.min(100, Math.max(0, Number(task.progress || 0)));
    });

    let newStatus = 'todo';
    if (allDone) {
      newStatus = subtasks.some((task) => task.status === 'completed_late') ? 'completed_late' : 'completed';
    } else if (anyStarted) {
      newStatus = 'in_progress';
    }

    const avgProgress = Math.round(totalProgress / subtasks.length);

    const updateData: Record<string, any> = {
      status: newStatus,
      progress: avgProgress,
      updatedAt: serverTimestamp()
    };

    if (parentIsDelegatedIncremental) {
      updateData.currentValue = avgProgress;
      updateData.indicator = parentTask?.indicator || 'avance subtareas';
      updateData.indicatorValue = 100;
      updateData.incrementDelegatedToSubtasks = true;
      updateData.totalSubtasks = subtasks.length;
      updateData.incrementSource = 'subtasks';
      updateData.incrementalRateBinding = null;
      updateData.incrementForm = null;
    }

    // Update parent task
    await updateDoc(parentRef, updateData);

  } catch (error) {
    console.error("Error updating parent task status:", error);
  }
};
