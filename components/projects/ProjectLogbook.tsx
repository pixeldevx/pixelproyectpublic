"use client"

import React, { useEffect, useMemo, useRef, useState } from "react";
import { addDoc, collection, deleteDoc, doc, increment, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc } from "@/lib/supabase/document-store";
import { db } from "@/lib/backend";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bold, BookOpen, Calendar, CheckCircle2, Clock, Italic, List, ListOrdered, MessageSquare, Quote, RemoveFormatting, Sparkles, Trash2, Underline, UserRound, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import {
  ACTION_VERBS,
  ActionCandidate,
  detectActionCandidates,
  mergeActionCandidates,
} from "@/lib/project-logbook/action-detection";

type ProjectLogbookProps = {
  projectId: string;
  project: any;
  tasks: any[];
  teamMembers: any[];
  currentUser: any;
  canCreateTasks: boolean;
  canAddSubtasks: boolean;
  canDeleteEntries: boolean;
};

type LogbookEntry = {
  id: string;
  title: string;
  content: string;
  contentHtml?: string;
  type: string;
  systemType?: string;
  source?: string;
  systemGenerated?: boolean;
  actionCandidates?: ActionCandidate[];
  derivedLinks?: any[];
  createdAt?: any;
  createdBy?: string | null;
  createdByEmail?: string | null;
};

type ActionForm = {
  relationType: "task" | "subtask" | "workflow" | "comment";
  title: string;
  assignedTo: string;
  parentTaskId: string;
  targetTaskId: string;
  startDate: string;
  endDate: string;
  priority: "low" | "medium" | "high";
  comment: string;
};

const ENTRY_TYPES = [
  { value: "project_start", label: "Inicio" },
  { value: "meeting", label: "Reunión" },
  { value: "decision", label: "Decisión" },
  { value: "problem", label: "Problema" },
  { value: "quality", label: "Calidad" },
  { value: "client", label: "Cliente" },
  { value: "internal", label: "Interno" },
];

const ACTION_VERB_EXAMPLES = ACTION_VERBS.slice(0, 8).join(", ");

const ALLOWED_RICH_TEXT_TAGS = new Set([
  "A",
  "B",
  "BLOCKQUOTE",
  "BR",
  "DIV",
  "EM",
  "H1",
  "H2",
  "H3",
  "H4",
  "I",
  "LI",
  "OL",
  "P",
  "SPAN",
  "STRONG",
  "U",
  "UL",
]);

const ALLOWED_RICH_TEXT_STYLES = new Set([
  "background-color",
  "color",
  "font-style",
  "font-weight",
  "text-align",
  "text-decoration",
]);

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const sanitizeStyleValue = (value: string) => {
  const cleanValue = value.trim();
  if (/url\s*\(/i.test(cleanValue)) return "";
  if (/expression\s*\(/i.test(cleanValue)) return "";
  return cleanValue;
};

const sanitizeRichText = (html: string) => {
  if (!html.trim()) return "";
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    return escapeHtml(html).replace(/\n/g, "<br>");
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, "text/html");

  const cleanNode = (node: Node): Node | null => {
    if (node.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(node.textContent || "");
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    const element = node as HTMLElement;
    const tagName = element.tagName.toUpperCase();

    if (!ALLOWED_RICH_TEXT_TAGS.has(tagName)) {
      const fragment = document.createDocumentFragment();
      Array.from(element.childNodes).forEach((child) => {
        const cleanChild = cleanNode(child);
        if (cleanChild) fragment.appendChild(cleanChild);
      });
      return fragment;
    }

    const cleanElement = document.createElement(tagName.toLowerCase());

    if (tagName === "A") {
      const href = element.getAttribute("href") || "";
      if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) {
        cleanElement.setAttribute("href", href);
        cleanElement.setAttribute("target", "_blank");
        cleanElement.setAttribute("rel", "noopener noreferrer");
      }
    }

    const cleanStyles: string[] = [];
    Array.from(element.style).forEach((styleName) => {
      const property = styleName.toLowerCase();
      if (!ALLOWED_RICH_TEXT_STYLES.has(property)) return;
      const styleValue = sanitizeStyleValue(element.style.getPropertyValue(styleName));
      if (styleValue) cleanStyles.push(`${property}: ${styleValue}`);
    });
    if (cleanStyles.length > 0) {
      cleanElement.setAttribute("style", cleanStyles.join("; "));
    }

    Array.from(element.childNodes).forEach((child) => {
      const cleanChild = cleanNode(child);
      if (cleanChild) cleanElement.appendChild(cleanChild);
    });

    return cleanElement;
  };

  const container = document.createElement("div");
  Array.from(doc.body.firstElementChild?.childNodes || []).forEach((child) => {
    const cleanChild = cleanNode(child);
    if (cleanChild) container.appendChild(cleanChild);
  });

  return container.innerHTML;
};

const richTextToPlainText = (html: string) => {
  if (!html.trim()) return "";
  if (typeof document === "undefined") {
    return html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }

  const container = document.createElement("div");
  container.innerHTML = sanitizeRichText(html);
  return (container.innerText || container.textContent || "").trim();
};

const hasMeaningfulRichText = (html?: string) =>
  Boolean(html && richTextToPlainText(html).length > 0);

const getDateValue = (value: any) => {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDate = (value: any) => {
  const date = getDateValue(value);
  if (!date) return "Sin fecha";
  return date.toLocaleString("es-CO", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatProjectDate = (value: any) => {
  const date = getDateValue(value);
  if (!date) return "Sin fecha registrada";
  return date.toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
};

const getProjectOrganizationLabel = (project: any) =>
  project?.organizationName ||
  project?.clientName ||
  project?.companyName ||
  project?.organizationId ||
  "";

const buildInitialLogbookContent = (project: any) => {
  const projectName = project?.name || "este proyecto";
  const description = project?.description?.trim() || "Sin descripción inicial registrada.";
  const organization = getProjectOrganizationLabel(project);
  const startDate = formatProjectDate(project?.startDate || project?.start || project?.createdAt);
  const endDate = formatProjectDate(project?.endDate || project?.end);

  return [
    `El proyecto "${projectName}" inicia con esta entrada base de bitácora.`,
    `Descripción inicial: ${description}`,
    `Fecha de inicio registrada: ${startDate}.`,
    endDate !== "Sin fecha registrada" ? `Fecha de cierre registrada: ${endDate}.` : null,
    organization ? `Organización o cliente: ${organization}.` : null,
    "Esta entrada conserva el punto de partida para entender cómo evolucionan las decisiones, tareas y compromisos del proyecto.",
  ]
    .filter(Boolean)
    .join("\n");
};

const toDateInputValue = (date: Date) => date.toISOString().slice(0, 10);

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const getTaskTitle = (task: any) => task?.title || task?.name || "Tarea";

const getTaskDate = (value: any) => {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatShortDate = (value: any) => {
  const date = getTaskDate(value);
  if (!date) return "Sin fecha";
  return date.toLocaleDateString("es-CO", {
    day: "numeric",
    month: "short",
  });
};

const getDueState = (task: any) => {
  const status = task?.status || "todo";
  if (status === "completed" || status === "completed_late" || status === "listo") return "closed";
  if (status === "stuck" || status === "detenido") return "paused";

  const endDate = getTaskDate(task?.endDate || task?.end);
  if (!endDate) return "none";

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const endOfDay = new Date(endDate);
  endOfDay.setHours(23, 59, 59, 999);

  if (endOfDay.getTime() < today.getTime()) return "overdue";
  return endOfDay.getTime() - Date.now() <= 2 * 24 * 60 * 60 * 1000 ? "due_soon" : "ok";
};

const getDueLabel = (dueState: string) => {
  if (dueState === "overdue") return "Vencida";
  if (dueState === "due_soon") return "Por vencer";
  if (dueState === "paused") return "Pausada";
  if (dueState === "closed") return "Cerrada";
  if (dueState === "none") return "Sin fecha";
  return "A tiempo";
};

const getInboxUrgencyStyles = (dueState: string) => {
  switch (dueState) {
    case "overdue":
      return {
        row: "border-red-200 bg-red-50",
        rail: "bg-red-600",
        due: "bg-red-600 text-white",
        text: "text-red-700",
        progress: "bg-red-600",
      };
    case "due_soon":
      return {
        row: "border-orange-200 bg-orange-50",
        rail: "bg-orange-500",
        due: "bg-orange-500 text-white",
        text: "text-orange-700",
        progress: "bg-orange-500",
      };
    case "ok":
      return {
        row: "border-emerald-200 bg-emerald-50/70",
        rail: "bg-emerald-500",
        due: "bg-emerald-100 text-emerald-700",
        text: "text-emerald-700",
        progress: "bg-emerald-500",
      };
    case "paused":
      return {
        row: "border-red-200 bg-red-50/70",
        rail: "bg-red-600",
        due: "bg-red-100 text-red-700",
        text: "text-red-700",
        progress: "bg-red-600",
      };
    default:
      return {
        row: "border-slate-200 bg-white",
        rail: "bg-slate-300",
        due: "bg-slate-100 text-slate-600",
        text: "text-slate-500",
        progress: "bg-indigo-600",
      };
  }
};

const getPriorityLabel = (priority: string) => {
  if (priority === "high") return "Alta";
  if (priority === "low") return "Baja";
  return "Media";
};

const getPriorityClass = (priority: string) => {
  if (priority === "high") return "bg-red-600 text-white shadow-sm ring-1 ring-red-700/20";
  if (priority === "low") return "bg-slate-100 text-slate-600";
  return "bg-amber-100 text-amber-800";
};

const getStatusLabel = (status: string) => {
  switch (status) {
    case "completed":
      return "Finalizada";
    case "completed_late":
      return "Finalizada con retraso";
    case "in_progress":
      return "Trabajando";
    case "stuck":
      return "Estancada";
    case "pending":
    case "todo":
      return "Pendiente";
    default:
      return status || "Pendiente";
  }
};

const getStatusClass = (status: string) => {
  switch (status) {
    case "completed":
      return "bg-emerald-50 text-emerald-700 border-emerald-100";
    case "completed_late":
      return "bg-orange-50 text-orange-700 border-orange-100";
    case "in_progress":
      return "bg-amber-50 text-amber-700 border-amber-100";
    case "stuck":
      return "bg-red-50 text-red-700 border-red-100";
    default:
      return "bg-slate-50 text-slate-600 border-slate-200";
  }
};

const getRelationLabel = (relationType: string) => {
  if (relationType === "workflow") return "Workflow";
  if (relationType === "subtask") return "Subtarea";
  if (relationType === "comment") return "Comentario";
  return "Tarea";
};

const emptyActionForm = (defaultAssignee = ""): ActionForm => ({
  relationType: "task",
  title: "",
  assignedTo: defaultAssignee,
  parentTaskId: "",
  targetTaskId: "",
  startDate: toDateInputValue(new Date()),
  endDate: toDateInputValue(addDays(new Date(), 7)),
  priority: "medium",
  comment: "",
});

export function ProjectLogbook({
  projectId,
  project,
  tasks,
  teamMembers,
  currentUser,
  canCreateTasks,
  canAddSubtasks,
  canDeleteEntries,
}: ProjectLogbookProps) {
  const [entries, setEntries] = useState<LogbookEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [contentHtml, setContentHtml] = useState("");
  const [type, setType] = useState("meeting");
  const [savingEntry, setSavingEntry] = useState(false);
  const [selectedAction, setSelectedAction] = useState<{ entry: LogbookEntry; candidate: ActionCandidate } | null>(null);
  const [actionForm, setActionForm] = useState<ActionForm>(emptyActionForm());
  const [savingAction, setSavingAction] = useState(false);
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);
  const [editorResetKey, setEditorResetKey] = useState(0);
  const richEditorRef = useRef<HTMLDivElement | null>(null);
  const initialEntrySeedRef = React.useRef<Set<string>>(new Set());

  const projectMembers = useMemo(
    () => teamMembers.filter((member) => member?.id),
    [teamMembers]
  );

  const viewerMember = useMemo(() => {
    const email = currentUser?.email?.toLowerCase();
    return teamMembers.find((member) =>
      member.id === currentUser?.uid ||
      member.authUserId === currentUser?.uid ||
      (email && member.email?.toLowerCase() === email)
    );
  }, [currentUser?.email, currentUser?.uid, teamMembers]);

  const defaultAssignee = viewerMember?.id || projectMembers[0]?.id || "";
  const parentTaskOptions = tasks.filter((task) => !task.parentTaskId);
  const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const liveCandidates = useMemo(() => detectActionCandidates(content), [content]);

  const syncEditorState = () => {
    const rawHtml = richEditorRef.current?.innerHTML || "";
    setContentHtml(rawHtml);
    setContent(richTextToPlainText(rawHtml));
  };

  const runEditorCommand = (command: string, value?: string) => {
    richEditorRef.current?.focus();
    document.execCommand(command, false, value);
    syncEditorState();
  };

  const getEntryCandidates = (entry: LogbookEntry) =>
    mergeActionCandidates(entry.actionCandidates || [], entry.content || "");

  const getMemberName = (memberId: string) => {
    if (!memberId) return "Sin responsable";
    const normalizedMemberId = memberId.toLowerCase();
    const member = teamMembers.find((item) =>
      item.id === memberId ||
      item.authUserId === memberId ||
      item.email?.toLowerCase() === normalizedMemberId
    );
    return member?.name || member?.email || "Responsable no encontrado";
  };

  useEffect(() => {
    if (!projectId) return;

    const entriesQuery = query(
      collection(db, "projects", projectId, "logbookEntries"),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(
      entriesQuery,
      (snapshot) => {
        setEntries(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as LogbookEntry)));
        setLoading(false);
      },
      (error) => {
        console.error("Error loading project logbook:", error);
        toast.error("No se pudo cargar la bitácora.");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !project || loading || project?.logbookInitialEntrySuppressed) return;

    const hasInitialEntry = entries.some((entry) =>
      entry.type === "project_start" ||
      entry.systemType === "project_start" ||
      entry.source === "project_start" ||
      entry.id === "project-start"
    );

    if (hasInitialEntry) {
      initialEntrySeedRef.current.add(projectId);
      return;
    }

    if (initialEntrySeedRef.current.has(projectId)) return;
    initialEntrySeedRef.current.add(projectId);

    const projectCreatedAt = getDateValue(project?.createdAt);

    setDoc(doc(db, "projects", projectId, "logbookEntries", "project-start"), {
      projectId,
      title: `Inicio del proyecto: ${project?.name || "Proyecto"}`,
      content: buildInitialLogbookContent(project),
      type: "project_start",
      systemType: "project_start",
      source: "project_start",
      systemGenerated: true,
      actionCandidates: [],
      derivedLinks: [],
      createdAt: projectCreatedAt || serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: project?.ownerId || currentUser?.uid || null,
      createdByEmail: currentUser?.email || null,
    }).catch((error) => {
      initialEntrySeedRef.current.delete(projectId);
      console.error("Error seeding initial project logbook entry:", error);
    });
  }, [currentUser?.email, currentUser?.uid, entries, loading, project, projectId]);

  const resetEntryForm = () => {
    setTitle("");
    setContent("");
    setContentHtml("");
    setType("meeting");
    setEditorResetKey((current) => current + 1);
  };

  const handleCreateEntry = async (event: React.FormEvent) => {
    event.preventDefault();

    const cleanTitle = title.trim();
    const cleanContentHtml = sanitizeRichText(contentHtml || richEditorRef.current?.innerHTML || "");
    const cleanContent = richTextToPlainText(cleanContentHtml);
    if (!cleanTitle || !cleanContent) {
      toast.warning("Agrega título y contenido para la bitácora.");
      return;
    }

    setSavingEntry(true);
    try {
      await addDoc(collection(db, "projects", projectId, "logbookEntries"), {
        projectId,
        title: cleanTitle,
        content: cleanContent,
        contentHtml: cleanContentHtml,
        type,
        actionCandidates: detectActionCandidates(cleanContent),
        derivedLinks: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: currentUser?.uid || null,
        createdByEmail: currentUser?.email || null,
      });
      resetEntryForm();
      toast.success("Entrada de bitácora creada.");
    } catch (error: any) {
      console.error("Error creating logbook entry:", error);
      toast.error(error?.message || "No se pudo guardar la bitácora.");
    } finally {
      setSavingEntry(false);
    }
  };

  const handleDeleteEntry = async (entry: LogbookEntry) => {
    if (!canDeleteEntries || deletingEntryId) return;

    const confirmed = window.confirm(
      `¿Eliminar la entrada "${entry.title || "Sin título"}"? Esta acción no se puede deshacer.`
    );
    if (!confirmed) return;

    setDeletingEntryId(entry.id);
    try {
      const isInitialEntry =
        entry.id === "project-start" ||
        entry.type === "project_start" ||
        entry.systemType === "project_start" ||
        entry.source === "project_start";

      if (isInitialEntry) {
        await updateDoc(doc(db, "projects", projectId), {
          logbookInitialEntrySuppressed: true,
          updatedAt: serverTimestamp(),
        });
      }

      await deleteDoc(doc(db, "projects", projectId, "logbookEntries", entry.id));
      toast.success("Entrada de bitácora eliminada.");
    } catch (error: any) {
      console.error("Error deleting logbook entry:", error);
      toast.error(error?.message || "No se pudo eliminar la entrada de bitácora.");
    } finally {
      setDeletingEntryId(null);
    }
  };

  const openActionModal = (entry: LogbookEntry, candidate: ActionCandidate) => {
    if (candidate.status === "ignored") return;
    setSelectedAction({ entry, candidate });
    setActionForm({
      ...emptyActionForm(defaultAssignee),
      title: candidate.text,
      comment: `Acción detectada en bitácora: ${candidate.text}`,
    });
  };

  const updateCandidateLink = async (entry: LogbookEntry, candidate: ActionCandidate, link: any) => {
    const currentCandidates = mergeActionCandidates(entry.actionCandidates || [], entry.content || "");
    const nextCandidates = currentCandidates.map((item) =>
      item.id === candidate.id
        ? {
            ...item,
            status: link.relationType === "ignored" ? "ignored" : "linked",
            linkedTaskId: link.taskId || null,
            linkedTaskTitle: link.taskTitle || null,
            relationType: link.relationType,
          }
        : item
    );

    const nextLinks = link.relationType === "ignored"
      ? entry.derivedLinks || []
      : [...(entry.derivedLinks || []), link];

    await updateDoc(doc(db, "projects", projectId, "logbookEntries", entry.id), {
      actionCandidates: nextCandidates,
      derivedLinks: nextLinks,
      updatedAt: serverTimestamp(),
    });
  };

  const handleIgnoreCandidate = async (entry: LogbookEntry, candidate: ActionCandidate) => {
    try {
      await updateCandidateLink(entry, candidate, {
        relationType: "ignored",
        candidateId: candidate.id,
      });
      toast.success("Acción ignorada.");
    } catch (error: any) {
      console.error("Error ignoring logbook candidate:", error);
      toast.error(error?.message || "No se pudo actualizar la bitácora.");
    }
  };

  const handleMaterializeAction = async () => {
    if (!selectedAction) return;

    const cleanTitle = actionForm.title.trim();
    if (!cleanTitle) {
      toast.warning("Define el nombre de la tarea o comentario.");
      return;
    }

    if ((actionForm.relationType === "task" || actionForm.relationType === "workflow") && !canCreateTasks) {
      toast.error("No tienes permisos para crear tareas.");
      return;
    }

    if (actionForm.relationType === "subtask") {
      if (!canAddSubtasks) {
        toast.error("No tienes permisos para crear subtareas.");
        return;
      }
      if (!actionForm.parentTaskId) {
        toast.warning("Selecciona la tarea padre.");
        return;
      }
    }

    if (actionForm.relationType === "comment" && !actionForm.targetTaskId) {
      toast.warning("Selecciona la tarea donde se agregará el comentario.");
      return;
    }

    const startDate = new Date(`${actionForm.startDate}T00:00:00`);
    const endDate = new Date(`${actionForm.endDate}T00:00:00`);
    if (actionForm.relationType !== "comment" && (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()))) {
      toast.warning("Define fechas válidas.");
      return;
    }

    setSavingAction(true);
    try {
      const { entry, candidate } = selectedAction;
      let link: any = {
        candidateId: candidate.id,
        candidateText: candidate.text,
        relationType: actionForm.relationType,
        createdAt: new Date().toISOString(),
        createdBy: currentUser?.uid || null,
      };

      if (actionForm.relationType === "comment") {
        const targetTask = tasksById.get(actionForm.targetTaskId);
        const cleanComment = actionForm.comment.trim() || cleanTitle;
        await addDoc(collection(db, "projects", projectId, "tasks", actionForm.targetTaskId, "comments"), {
          projectId,
          taskId: actionForm.targetTaskId,
          text: cleanComment,
          source: "logbook",
          logbookEntryId: entry.id,
          logbookEntryTitle: entry.title,
          logbookCandidateId: candidate.id,
          logbookCandidateText: candidate.text,
          createdAt: serverTimestamp(),
          createdBy: currentUser?.uid || null,
          createdByEmail: currentUser?.email || null,
        });
        await updateDoc(doc(db, "projects", projectId, "tasks", actionForm.targetTaskId), {
          commentCount: increment(1),
          updatedAt: serverTimestamp(),
        });
        link = {
          ...link,
          taskId: actionForm.targetTaskId,
          taskTitle: getTaskTitle(targetTask),
          commentText: cleanComment,
        };
      } else {
        const isWorkflow = actionForm.relationType === "workflow";
        const parentTask = actionForm.parentTaskId ? tasksById.get(actionForm.parentTaskId) : null;
        const taskData: any = {
          projectId,
          title: cleanTitle,
          name: cleanTitle,
          description: `Derivada de bitácora: ${candidate.text}`,
          startDate,
          endDate,
          start: startDate,
          end: endDate,
          assignedTo: actionForm.assignedTo || parentTask?.assignedTo || "",
          indicator: null,
          indicatorValue: null,
          status: actionForm.relationType === "subtask" ? "todo" : "pending",
          progress: 0,
          type: isWorkflow ? "workflow" : "state",
          requiresDocument: false,
          linkedDocumentId: null,
          isRateCardTask: false,
          rateCardId: null,
          unitsToAdd: null,
          syncExternal: false,
          priority: actionForm.priority,
          groupId: parentTask?.groupId || null,
          currentValue: 0,
          parentTaskId: actionForm.relationType === "subtask" ? actionForm.parentTaskId : null,
          originLogbook: {
            entryId: entry.id,
            entryTitle: entry.title,
            entryType: entry.type,
            candidateId: candidate.id,
            candidateText: candidate.text,
          },
          displayOrder: tasks.length + 1,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: currentUser?.uid || null,
        };

        if (isWorkflow) {
          taskData.workflowSteps = [
            {
              label: "Ejecutar acción",
              assignedTo: actionForm.assignedTo || "",
              status: "not_started",
            },
            {
              label: "Verificar resultado",
              assignedTo: actionForm.assignedTo || "",
              status: "not_started",
            },
          ];
          taskData.currentStepIndex = 0;
          taskData.workflowHistory = [];
        }

        const taskRef = await addDoc(collection(db, "projects", projectId, "tasks"), taskData);
        link = {
          ...link,
          taskId: taskRef.id,
          taskTitle: cleanTitle,
        };
      }

      await updateCandidateLink(entry, candidate, link);
      setSelectedAction(null);
      toast.success("Bitácora conectada con la planificación.");
    } catch (error: any) {
      console.error("Error materializing logbook action:", error);
      toast.error(error?.message || "No se pudo crear la acción desde bitácora.");
    } finally {
      setSavingAction(false);
    }
  };

  const renderAnnotatedContent = (entry: LogbookEntry) => {
    const entryContent = entry.content || "";
    const candidates = mergeActionCandidates(entry.actionCandidates || [], entryContent)
      .filter((candidate) => candidate.status !== "ignored")
      .map((candidate) => ({
        ...candidate,
        index: typeof candidate.startIndex === "number" ? candidate.startIndex : entryContent.indexOf(candidate.text),
        endIndex: typeof candidate.endIndex === "number"
          ? candidate.endIndex
          : entryContent.indexOf(candidate.text) + candidate.text.length,
      }))
      .filter((candidate) => candidate.index >= 0 && candidate.endIndex > candidate.index)
      .sort((left, right) => left.index - right.index);

    if (candidates.length === 0) return entryContent;

    const nodes: React.ReactNode[] = [];
    let cursor = 0;

    candidates.forEach((candidate) => {
      if (candidate.index < cursor) return;
      if (candidate.index > cursor) {
        nodes.push(entryContent.slice(cursor, candidate.index));
      }
      const highlightedText = entryContent.slice(candidate.index, candidate.endIndex) || candidate.text;
      nodes.push(
        <button
          key={candidate.id}
          type="button"
          onClick={() => openActionModal(entry, candidate)}
          className={`inline rounded px-0.5 text-left underline decoration-2 underline-offset-4 transition-colors ${
            candidate.status === "linked"
              ? "decoration-emerald-400 hover:bg-emerald-50"
              : "decoration-indigo-400 hover:bg-indigo-50"
          }`}
          title={candidate.status === "linked" ? "Acción vinculada" : "Convertir en tarea"}
        >
          {highlightedText}
        </button>
      );
      cursor = candidate.endIndex;
    });

    if (cursor < entryContent.length) nodes.push(entryContent.slice(cursor));
    return nodes;
  };

  const renderLogbookContent = (entry: LogbookEntry) => {
    if (hasMeaningfulRichText(entry.contentHtml)) {
      return (
        <div
          className="logbook-rich-content"
          dangerouslySetInnerHTML={{ __html: sanitizeRichText(entry.contentHtml || "") }}
        />
      );
    }

    return renderAnnotatedContent(entry);
  };

  const renderLinkedTaskCard = (entry: LogbookEntry, link: any, index: number) => {
    const linkedTask = tasksById.get(link.taskId);
    const relationLabel = getRelationLabel(link.relationType);

    if (!linkedTask) {
      return (
        <div key={`${entry.id}-link-${index}`} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-800">{link.taskTitle || "Tarea vinculada"}</p>
              <p className="mt-0.5 text-xs text-slate-500">{relationLabel}</p>
            </div>
            <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-600">
              Sin tarea
            </span>
          </div>
        </div>
      );
    }

    const status = linkedTask.status || "todo";
    const dueState = getDueState(linkedTask);
    const urgencyStyles = getInboxUrgencyStyles(dueState);
    const progress = Math.min(100, Math.max(0, Number(linkedTask.progress || 0)));
    const priority = linkedTask.priority || "medium";
    const assigneeName = getMemberName(linkedTask.assignedTo || linkedTask.assignedTeamMembers?.[0] || linkedTask.assignedUsers?.[0] || "");
    const description = linkedTask.initialObservation || linkedTask.description || link.candidateText || "Sin descripción";
    const commentText = link.commentText || link.candidateText;

    return (
      <article
        key={`${entry.id}-link-${index}`}
        className={`relative overflow-hidden rounded-xl border px-4 py-3 shadow-sm ${urgencyStyles.row}`}
      >
        <span className={`absolute bottom-0 left-0 top-0 w-1.5 ${urgencyStyles.rail}`} />
        <div className="min-w-0 pl-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sky-700">
              {linkedTask.parentTaskId ? "Subtarea" : relationLabel}
            </span>
            {link.relationType === "comment" && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-700">
                <MessageSquare size={11} />
                Comentario vinculado
              </span>
            )}
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${getStatusClass(status)}`}>
              {getStatusLabel(status)}
            </span>
            <span className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${urgencyStyles.due}`}>
              <Clock size={11} />
              {getDueLabel(dueState)}
            </span>
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${getPriorityClass(priority)}`}>
              {getPriorityLabel(priority)}
            </span>
          </div>

          <div className="mt-2 grid gap-3 lg:grid-cols-[minmax(0,1fr)_240px]">
            <div className="min-w-0">
              <h4 className="truncate text-base font-black text-slate-900">{getTaskTitle(linkedTask)}</h4>
              <p className="mt-0.5 line-clamp-2 text-sm text-slate-600">
                {project?.name ? `${project.name} · ` : ""}{description}
              </p>
            </div>

            <div className="grid gap-2 text-xs text-slate-600 sm:grid-cols-2 lg:grid-cols-1">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <UserRound size={13} className="shrink-0 text-slate-400" />
                <span className="truncate font-semibold">{assigneeName}</span>
              </span>
              <span className={`inline-flex min-w-0 items-center gap-1.5 font-semibold ${urgencyStyles.text}`}>
                <Calendar size={13} className="shrink-0" />
                <span className="truncate">
                  {formatShortDate(linkedTask.startDate || linkedTask.start)} - {formatShortDate(linkedTask.endDate || linkedTask.end)}
                </span>
              </span>
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center">
            <div className="flex min-w-[180px] flex-1 items-center gap-2">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/80">
                <div className={`h-full ${status === "stuck" ? "bg-red-600" : status === "in_progress" ? "bg-orange-500" : urgencyStyles.progress}`} style={{ width: `${progress}%` }} />
              </div>
              <span className="w-10 text-right text-xs font-black text-slate-600">{progress}%</span>
            </div>
            {linkedTask.type === "quantitative" && (
              <span className="shrink-0 rounded bg-white/80 px-2 py-1 text-xs font-bold text-slate-600">
                {linkedTask.currentValue || 0}/{linkedTask.indicatorValue || 0} {linkedTask.indicator || ""}
              </span>
            )}
          </div>

          {commentText && (
            <div className="mt-3 rounded-lg border border-white/80 bg-white/70 px-3 py-2 text-sm text-slate-700">
              <span className="font-bold text-slate-900">Comentario desde bitácora: </span>
              {commentText}
            </div>
          )}
        </div>
      </article>
    );
  };

  const actionCandidateCount = entries.reduce(
    (total, entry) => total + getEntryCandidates(entry).filter((candidate) => candidate.status !== "ignored").length,
    0
  );
  const linkedActionCount = entries.reduce(
    (total, entry) => total + (entry.derivedLinks || []).length,
    0
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-slate-800">
            <BookOpen size={20} className="text-indigo-500" />
            Bitácora del proyecto
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Convierte reuniones, decisiones y problemas en tareas trazables.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary" className="bg-indigo-50 text-indigo-700">
            {entries.length} entradas
          </Badge>
          <Badge variant="secondary" className="bg-amber-50 text-amber-700">
            {actionCandidateCount} acciones detectadas
          </Badge>
          <Badge variant="secondary" className="bg-emerald-50 text-emerald-700">
            {linkedActionCount} vínculos
          </Badge>
        </div>
      </div>

      <form onSubmit={handleCreateEntry} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[1fr_180px]">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Título de la entrada"
            className="h-11 rounded-xl border border-slate-200 px-3 text-sm outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
          />
          <select
            value={type}
            onChange={(event) => setType(event.target.value)}
            className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
          >
            {ENTRY_TYPES.map((entryType) => (
              <option key={entryType.value} value={entryType.value}>
                {entryType.label}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/20">
          <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 bg-slate-50/80 px-2 py-2">
            <button
              type="button"
              onClick={() => runEditorCommand("bold")}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 transition hover:bg-white hover:text-indigo-600"
              title="Negrita"
            >
              <Bold size={15} />
            </button>
            <button
              type="button"
              onClick={() => runEditorCommand("italic")}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 transition hover:bg-white hover:text-indigo-600"
              title="Cursiva"
            >
              <Italic size={15} />
            </button>
            <button
              type="button"
              onClick={() => runEditorCommand("underline")}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 transition hover:bg-white hover:text-indigo-600"
              title="Subrayado"
            >
              <Underline size={15} />
            </button>
            <span className="mx-1 h-5 w-px bg-slate-200" />
            <button
              type="button"
              onClick={() => runEditorCommand("insertUnorderedList")}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 transition hover:bg-white hover:text-indigo-600"
              title="Lista"
            >
              <List size={15} />
            </button>
            <button
              type="button"
              onClick={() => runEditorCommand("insertOrderedList")}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 transition hover:bg-white hover:text-indigo-600"
              title="Lista numerada"
            >
              <ListOrdered size={15} />
            </button>
            <button
              type="button"
              onClick={() => runEditorCommand("formatBlock", "blockquote")}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 transition hover:bg-white hover:text-indigo-600"
              title="Cita o intervención destacada"
            >
              <Quote size={15} />
            </button>
            <button
              type="button"
              onClick={() => runEditorCommand("removeFormat")}
              className="ml-auto inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-bold text-slate-500 transition hover:bg-white hover:text-red-600"
              title="Limpiar formato seleccionado"
            >
              <RemoveFormatting size={14} />
              Limpiar
            </button>
          </div>
          <div className="relative">
            {!content.trim() && (
              <div className="pointer-events-none absolute left-4 top-4 max-w-[calc(100%-2rem)] text-sm leading-6 text-slate-400">
                Pega la minuta con formato o escribe lo ocurrido. Ej: acuerdos, responsables, pendientes, decisiones y observaciones de la reunión.
              </div>
            )}
            <div
              key={editorResetKey}
              ref={richEditorRef}
              contentEditable
              suppressContentEditableWarning
              onInput={syncEditorState}
              onBlur={syncEditorState}
              onPaste={() => window.setTimeout(syncEditorState, 0)}
              className="logbook-rich-editor min-h-40 w-full overflow-y-auto px-4 py-4 text-sm leading-7 text-slate-700 outline-none"
            />
          </div>
        </div>
        {content.trim() && (
          <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/70 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-indigo-900">
                <Wand2 size={16} className="text-indigo-500" />
                Detección inteligente
              </div>
              <Badge variant="secondary" className={liveCandidates.length ? "bg-indigo-600 text-white" : "bg-white text-slate-500"}>
                {liveCandidates.length} posibles acciones
              </Badge>
            </div>
            {liveCandidates.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {liveCandidates.slice(0, 6).map((candidate) => (
                  <span
                    key={candidate.id}
                    className="inline-flex max-w-full items-center gap-2 rounded-full border border-indigo-200 bg-white px-3 py-1 text-xs text-indigo-800 shadow-sm"
                    title={candidate.text}
                  >
                    <span className="rounded-full bg-indigo-100 px-2 py-0.5 font-bold uppercase tracking-wide text-indigo-700">
                      {candidate.verb}
                    </span>
                    <span className="max-w-[420px] truncate font-semibold">{candidate.text}</span>
                  </span>
                ))}
                {liveCandidates.length > 6 && (
                  <span className="rounded-full border border-indigo-200 bg-white px-3 py-1 text-xs font-bold text-indigo-700">
                    +{liveCandidates.length - 6} más
                  </span>
                )}
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-500">
                Aún no veo una acción clara. Prueba con frases como &quot;hay que validar...&quot;, &quot;queda pendiente corregir...&quot; o &quot;se debe enviar...&quot;.
              </p>
            )}
          </div>
        )}
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Sparkles size={14} className="text-indigo-500" />
            Detecta verbos como {ACTION_VERB_EXAMPLES} y señales de compromiso o calidad.
          </div>
          <Button type="submit" disabled={savingEntry || !title.trim() || !content.trim()} className="bg-indigo-600 text-white hover:bg-indigo-700">
            {savingEntry ? "Guardando..." : "Guardar entrada"}
          </Button>
        </div>
      </form>

      <div className="space-y-4">
        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            Cargando bitácora...
          </div>
        ) : entries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center">
            <BookOpen className="mx-auto mb-3 text-slate-300" size={32} />
            <p className="text-sm font-semibold text-slate-700">Aún no hay historia registrada.</p>
            <p className="mt-1 text-sm text-slate-500">La primera entrada puede salir de una reunión, decisión o problema del proyecto.</p>
          </div>
        ) : (
          entries.map((entry) => {
            const candidates = getEntryCandidates(entry).filter((candidate) => candidate.status !== "ignored");
            const links = entry.derivedLinks || [];

            return (
              <article key={entry.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="bg-slate-100 text-slate-700">
                        {ENTRY_TYPES.find((entryType) => entryType.value === entry.type)?.label || entry.type}
                      </Badge>
                      <span className="text-xs text-slate-400">{formatDate(entry.createdAt)}</span>
                    </div>
                    <h3 className="text-lg font-bold text-slate-900">{entry.title}</h3>
                    <p className="mt-1 text-xs text-slate-500">{entry.createdByEmail || "Usuario"}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-xs">
                    <span className="rounded-full bg-amber-50 px-2 py-1 font-bold text-amber-700">
                      {candidates.length} acciones
                    </span>
                    <span className="rounded-full bg-emerald-50 px-2 py-1 font-bold text-emerald-700">
                      {links.length} vinculadas
                    </span>
                    {canDeleteEntries && (
                      <button
                        type="button"
                        onClick={() => handleDeleteEntry(entry)}
                        disabled={deletingEntryId === entry.id}
                        className="inline-flex items-center gap-1 rounded-full border border-red-100 bg-red-50 px-2 py-1 font-bold text-red-600 transition hover:border-red-200 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                        title="Eliminar entrada"
                        aria-label={`Eliminar entrada ${entry.title || ""}`}
                      >
                        <Trash2 size={13} />
                        {deletingEntryId === entry.id ? "Eliminando..." : "Eliminar"}
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-4 whitespace-pre-wrap rounded-xl border border-slate-100 bg-slate-50/70 p-4 text-sm leading-7 text-slate-700 [&_.logbook-rich-content]:whitespace-normal [&_.logbook-rich-content_a]:font-semibold [&_.logbook-rich-content_a]:text-indigo-600 [&_.logbook-rich-content_blockquote]:my-3 [&_.logbook-rich-content_blockquote]:border-l-4 [&_.logbook-rich-content_blockquote]:border-indigo-300 [&_.logbook-rich-content_blockquote]:bg-white/70 [&_.logbook-rich-content_blockquote]:px-4 [&_.logbook-rich-content_blockquote]:py-2 [&_.logbook-rich-content_h1]:mb-2 [&_.logbook-rich-content_h1]:text-xl [&_.logbook-rich-content_h1]:font-black [&_.logbook-rich-content_h2]:mb-2 [&_.logbook-rich-content_h2]:text-lg [&_.logbook-rich-content_h2]:font-black [&_.logbook-rich-content_h3]:mb-1 [&_.logbook-rich-content_h3]:font-bold [&_.logbook-rich-content_li]:ml-5 [&_.logbook-rich-content_ol]:my-2 [&_.logbook-rich-content_ol]:list-decimal [&_.logbook-rich-content_p]:my-2 [&_.logbook-rich-content_ul]:my-2 [&_.logbook-rich-content_ul]:list-disc">
                  {renderLogbookContent(entry)}
                </div>

                {candidates.length > 0 && (
                  <div className="mt-4">
                    <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Acciones detectadas</p>
                    <div className="flex flex-wrap gap-2">
                      {candidates.map((candidate) => (
                        <div key={candidate.id} className="inline-flex max-w-full items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs text-indigo-700">
                          <button
                            type="button"
                            onClick={() => openActionModal(entry, candidate)}
                            className="max-w-[420px] truncate font-semibold"
                            title={candidate.text}
                          >
                            {candidate.verb}: {candidate.text}
                          </button>
                          {candidate.status === "linked" ? (
                            <CheckCircle2 size={13} className="shrink-0 text-emerald-600" />
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleIgnoreCandidate(entry, candidate)}
                              className="shrink-0 text-indigo-300 hover:text-red-500"
                              aria-label="Ignorar acción"
                            >
                              <X size={13} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {links.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {links.map((link: any, index: number) => renderLinkedTaskCard(entry, link, index))}
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>

      {selectedAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-slate-100 p-5">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Materializar acción</h3>
                <p className="mt-1 text-sm text-slate-500">Conecta esta frase con la planificación del proyecto.</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedAction(null)}
                className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto bg-slate-50 p-5">
              <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-sm text-indigo-800">
                {selectedAction.candidate.text}
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">Convertir en</label>
                <select
                  value={actionForm.relationType}
                  onChange={(event) => setActionForm((current) => ({ ...current, relationType: event.target.value as ActionForm["relationType"] }))}
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                >
                  <option value="task">Tarea</option>
                  <option value="subtask">Subtarea</option>
                  <option value="workflow">Workflow simple</option>
                  <option value="comment">Comentario en tarea existente</option>
                </select>
              </div>

              {actionForm.relationType === "comment" ? (
                <>
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">Tarea destino</label>
                    <select
                      value={actionForm.targetTaskId}
                      onChange={(event) => setActionForm((current) => ({ ...current, targetTaskId: event.target.value }))}
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                    >
                      <option value="">Seleccionar tarea...</option>
                      {tasks.map((task) => (
                        <option key={task.id} value={task.id}>{getTaskTitle(task)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">Comentario</label>
                    <textarea
                      value={actionForm.comment}
                      onChange={(event) => setActionForm((current) => ({ ...current, comment: event.target.value }))}
                      className="min-h-24 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">Nombre</label>
                    <input
                      value={actionForm.title}
                      onChange={(event) => setActionForm((current) => ({ ...current, title: event.target.value }))}
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </div>
                  {actionForm.relationType === "subtask" && (
                    <div>
                      <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">Tarea padre</label>
                      <select
                        value={actionForm.parentTaskId}
                        onChange={(event) => setActionForm((current) => ({ ...current, parentTaskId: event.target.value }))}
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                      >
                        <option value="">Seleccionar tarea padre...</option>
                        {parentTaskOptions.map((task) => (
                          <option key={task.id} value={task.id}>{getTaskTitle(task)}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">Responsable</label>
                      <select
                        value={actionForm.assignedTo}
                        onChange={(event) => setActionForm((current) => ({ ...current, assignedTo: event.target.value }))}
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                      >
                        <option value="">Sin asignar</option>
                        {projectMembers.map((member) => (
                          <option key={member.id} value={member.id}>{member.name || member.email}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">Prioridad</label>
                      <select
                        value={actionForm.priority}
                        onChange={(event) => setActionForm((current) => ({ ...current, priority: event.target.value as ActionForm["priority"] }))}
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                      >
                        <option value="low">Baja</option>
                        <option value="medium">Media</option>
                        <option value="high">Alta</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">Inicio</label>
                      <input
                        type="date"
                        value={actionForm.startDate}
                        onChange={(event) => setActionForm((current) => ({ ...current, startDate: event.target.value }))}
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">Fin</label>
                      <input
                        type="date"
                        value={actionForm.endDate}
                        onChange={(event) => setActionForm((current) => ({ ...current, endDate: event.target.value }))}
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                      />
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-100 p-5">
              <Button type="button" variant="outline" onClick={() => setSelectedAction(null)}>
                Cancelar
              </Button>
              <Button type="button" onClick={handleMaterializeAction} disabled={savingAction} className="bg-indigo-600 text-white hover:bg-indigo-700">
                {savingAction ? "Guardando..." : "Crear vínculo"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
