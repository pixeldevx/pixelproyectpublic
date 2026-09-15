"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Boxes,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleDot,
  ClipboardList,
  Code2,
  Flag,
  Inbox,
  Layers3,
  ListTodo,
  Loader2,
  Network,
  PackageOpen,
  Paperclip,
  Pencil,
  PlayCircle,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "@/lib/supabase/document-store";
import { db } from "@/lib/backend";
import { toast } from "sonner";
import { ProjectGitHubPanel } from "@/components/projects/ProjectGitHubPanel";
import { ProjectScrumControlCenter } from "@/components/projects/ProjectScrumControlCenter";
import {
  ProjectScrumMap,
  type ScrumMapLayout,
  type ScrumMapLayoutInput,
} from "@/components/projects/ProjectScrumMap";
import { ProjectUserStories } from "@/components/projects/ProjectUserStories";
import {
  ScrumStoryCatalogSelect,
  useScrumStoryCatalogCollection,
} from "@/components/projects/ScrumStoryCatalogSelect";
import { TaskDocumentsViewer } from "@/components/projects/TaskDocumentsViewer";
import { notifyTaskAssignment } from "@/lib/notifications";
import {
  normalizeScrumStoryCatalogLabel,
  setScrumStoryCatalogEntryActive,
  setScrumStoryCatalogEntrySortOrder,
  type ScrumStoryCatalogEntry,
} from "@/lib/scrum-story-catalogs";
import {
  SCRUM_EXECUTION_MODES,
  SCRUM_POINT_SCALE,
  SCRUM_WORK_STATUSES,
  getScrumExecutionMode,
  getScrumProgress,
  getScrumScopeMetrics,
  getScrumStatusLabel,
  getScrumTaskTypeLabel,
  getSprintMetrics,
  getSprintStatus,
  isScrumTask,
  mapScrumStatusToTaskStatus,
  normalizeScrumStatus,
  sortSprintsNewestFirst,
  toDateValue,
  type ScrumItemKind,
  type ScrumExecutionMode,
  type ScrumWorkStatus,
} from "@/lib/scrum";

type ScrumView = "structure" | "stories" | "backlog" | "overview" | "board" | "sprints" | "github" | "settings";

type ProjectScrumProps = {
  projectId: string;
  project: any;
  tasks: any[];
  teamMembers: any[];
  currentUser: any;
  canCreateItems?: boolean;
  canManage?: boolean;
  canMoveItems?: boolean;
  canManageLifecycle?: boolean;
  canViewDocuments?: boolean;
  canUploadDocuments?: boolean;
  canManageDocumentAccess?: boolean;
  canDeleteDocuments?: boolean;
};

type WorkItemDraft = {
  title: string;
  description: string;
  acceptanceCriteria: string;
  kind: ScrumItemKind;
  taskTypeId: string;
  taskTypeLabel: string;
  priority: string;
  storyPoints: string;
  module: string;
  releaseId: string;
  epicId: string;
  groupId: string;
  sprintId: string;
  assigneeIds: string[];
  executionMode: ScrumExecutionMode;
  refinementStatus: "pending" | "refined";
};

const EMPTY_ITEM_DRAFT: WorkItemDraft = {
  title: "",
  description: "",
  acceptanceCriteria: "",
  kind: "story",
  taskTypeId: "",
  taskTypeLabel: "Historia de usuario",
  priority: "medium",
  storyPoints: "3",
  module: "",
  releaseId: "",
  epicId: "",
  groupId: "",
  sprintId: "",
  assigneeIds: [],
  executionMode: "manual",
  refinementStatus: "pending",
};

type ReleaseDraft = {
  name: string;
  objective: string;
  startDate: string;
  targetDate: string;
};

type GroupDraft = {
  name: string;
  description: string;
  epicId: string;
};

const EMPTY_RELEASE_DRAFT: ReleaseDraft = {
  name: "",
  objective: "",
  startDate: "",
  targetDate: "",
};

const EMPTY_GROUP_DRAFT: GroupDraft = {
  name: "",
  description: "",
  epicId: "",
};

const STATUS_STYLE: Record<ScrumWorkStatus, string> = {
  backlog: "border-slate-200 bg-slate-50 text-slate-700",
  ready: "border-blue-200 bg-blue-50 text-blue-700",
  in_progress: "border-amber-200 bg-amber-50 text-amber-800",
  review: "border-violet-200 bg-violet-50 text-violet-700",
  validation: "border-cyan-200 bg-cyan-50 text-cyan-800",
  done: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

const KIND_STYLE: Record<ScrumItemKind, string> = {
  epic: "bg-violet-100 text-violet-700",
  story: "bg-blue-100 text-blue-700",
  bug: "bg-red-100 text-red-700",
  technical_task: "bg-slate-200 text-slate-700",
  spike: "bg-amber-100 text-amber-800",
};

const DEFAULT_TASK_TYPE_LABELS: Record<Exclude<ScrumItemKind, "epic">, string> = {
  story: "Historia de usuario",
  bug: "Error",
  technical_task: "Tarea técnica",
  spike: "Investigación",
};

const getScrumItemKind = (item: any): ScrumItemKind => (item?.scrumKind || "story") as ScrumItemKind;

const isNonEpicScrumItemKind = (value: unknown): value is Exclude<ScrumItemKind, "epic"> =>
  ["story", "bug", "technical_task", "spike"].includes(String(value));

const getCatalogTaskKind = (entry: ScrumStoryCatalogEntry | undefined): Exclude<ScrumItemKind, "epic"> => {
  const configuredKind = entry?.template?.scrumKind;
  return isNonEpicScrumItemKind(configuredKind) ? configuredKind : "technical_task";
};

const getTaskTypeFilterValue = (item: any) =>
  getScrumItemKind(item) === "epic"
    ? "__epic__"
    : normalizeScrumStoryCatalogLabel(getScrumTaskTypeLabel(item));

const PRIORITY_WEIGHT: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const getItemTitle = (item: any) => item?.title || item?.name || "Trabajo sin título";

const getItemSprintLabel = (item: any, sprint: any) => {
  if (sprint?.name) return sprint.name;
  if (
    item?.previousSprintName &&
    item?.previousSprintStatus === "completed" &&
    normalizeScrumStatus(item?.scrumStatus || item?.status) === "done"
  ) {
    return `${item.previousSprintName} (eliminado)`;
  }
  return "Backlog";
};

const getSubmoduleCode = (item: any) =>
  String(item?.submoduleCode || item?.groupCode || "SUB").replace(/^GRP-/i, "SUB-");

const getRefinementStatus = (item: any): "pending" | "refined" => {
  if (item?.scrumRefinementStatus) return item.scrumRefinementStatus === "refined" ? "refined" : "pending";
  if (item?.scrumKind === "epic") return "refined";
  return item?.sprintId || item?.scrumEpicId ? "refined" : "pending";
};

const isRefined = (item: any) => getRefinementStatus(item) === "refined";

const getMemberLabel = (member: any) =>
  member?.name || member?.displayName || member?.email || "Miembro";

const formatDate = (value: any) => {
  const date = toDateValue(value);
  if (!date) return "Sin fecha";
  return new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", year: "numeric" }).format(date);
};

const formatSprintCountdown = (value: any, now: Date) => {
  const endDate = toDateValue(value);
  if (!endDate) return "Sin fecha final";
  const difference = endDate.getTime() - now.getTime();
  const overdue = difference < 0;
  const absolute = Math.abs(difference);
  const days = Math.floor(absolute / 86400000);
  const hours = Math.floor((absolute % 86400000) / 3600000);
  const minutes = Math.max(0, Math.floor((absolute % 3600000) / 60000));
  const duration = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  return overdue ? `Vencido hace ${duration}` : `Quedan ${duration}`;
};

const toInputDate = (value: any) => {
  const date = toDateValue(value);
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const priorityLabel = (priority: string) =>
  ({ urgent: "Urgente", high: "Alta", medium: "Media", low: "Baja" })[priority] || "Media";

function ModalShell({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-2 backdrop-blur-sm sm:p-4">
      <div className="max-h-[94vh] w-full min-w-0 max-w-3xl overflow-y-auto rounded-2xl border border-white/20 bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex min-w-0 items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-4 sm:gap-4 sm:px-6 sm:py-5">
          <div className="min-w-0 flex-1">
            <h3 className="break-words text-base font-black tracking-tight text-slate-950 sm:text-xl">{title}</h3>
            <p className="mt-1 break-words text-xs leading-5 text-slate-500 sm:text-sm">{description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function MemberAvatar({ member }: { member: any }) {
  const name = getMemberLabel(member);
  return (
    <div
      title={name}
      className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-black text-indigo-700 ring-2 ring-white"
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

export function ProjectScrum({
  projectId,
  project,
  tasks,
  teamMembers,
  currentUser,
  canCreateItems = false,
  canManage = false,
  canMoveItems = false,
  canManageLifecycle = false,
  canViewDocuments = false,
  canUploadDocuments = false,
  canManageDocumentAccess = false,
  canDeleteDocuments = false,
}: ProjectScrumProps) {
  const searchParams = useSearchParams();
  const scrumCatalog = useScrumStoryCatalogCollection({ projectId });
  const taskTypeEntries = scrumCatalog.entriesByType.task_type;
  const activeTaskTypeEntries = scrumCatalog.activeEntriesByType.task_type;
  const [view, setView] = useState<ScrumView>("structure");
  const [releases, setReleases] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [sprints, setSprints] = useState<any[]>([]);
  const [scrumMapLayout, setScrumMapLayout] = useState<ScrumMapLayout | null>(null);
  const [sprintsLoading, setSprintsLoading] = useState(true);
  const [architectureLoading, setArchitectureLoading] = useState(true);
  const [clock, setClock] = useState(() => new Date());
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [itemDraft, setItemDraft] = useState<WorkItemDraft>(EMPTY_ITEM_DRAFT);
  const [isSavingItem, setIsSavingItem] = useState(false);
  const [isSprintModalOpen, setIsSprintModalOpen] = useState(false);
  const [editingSprint, setEditingSprint] = useState<any | null>(null);
  const [isSavingSprint, setIsSavingSprint] = useState(false);
  const [sprintName, setSprintName] = useState("");
  const [sprintGoal, setSprintGoal] = useState("");
  const [sprintStart, setSprintStart] = useState("");
  const [sprintEnd, setSprintEnd] = useState("");
  const [sprintGroupId, setSprintGroupId] = useState("");
  const [isReleaseModalOpen, setIsReleaseModalOpen] = useState(false);
  const [editingRelease, setEditingRelease] = useState<any | null>(null);
  const [releaseDraft, setReleaseDraft] = useState<ReleaseDraft>(EMPTY_RELEASE_DRAFT);
  const [isSavingRelease, setIsSavingRelease] = useState(false);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<any | null>(null);
  const [groupDraft, setGroupDraft] = useState<GroupDraft>(EMPTY_GROUP_DRAFT);
  const [isSavingGroup, setIsSavingGroup] = useState(false);
  const [isDeletingGroup, setIsDeletingGroup] = useState(false);
  const [selectedSprintId, setSelectedSprintId] = useState("");
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState("all");
  const [productGoal, setProductGoal] = useState(project?.scrumSettings?.productGoal || "");
  const [sprintLengthWeeks, setSprintLengthWeeks] = useState(
    String(project?.scrumSettings?.sprintLengthWeeks || 2),
  );
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [documentsItem, setDocumentsItem] = useState<any | null>(null);
  const [focusedStoryId, setFocusedStoryId] = useState("");
  const [sprintCandidateById, setSprintCandidateById] = useState<Record<string, string>>({});
  const [updatingTaskTypeEntryId, setUpdatingTaskTypeEntryId] = useState("");
  const [settingsTaskTypeValue, setSettingsTaskTypeValue] = useState("");

  useEffect(() => {
    const interval = window.setInterval(() => setClock(new Date()), 60000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let loadedCollections = 0;
    const markLoaded = () => {
      loadedCollections += 1;
      if (loadedCollections >= 2) setArchitectureLoading(false);
    };
    const unsubscribeReleases = onSnapshot(
      collection(db, "projects", projectId, "scrumReleases"),
      (snapshot) => {
        setReleases(
          snapshot.docs
            .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }))
            .sort((left: any, right: any) => {
              const leftDate = toDateValue(left.targetDate || left.createdAt)?.getTime() || 0;
              const rightDate = toDateValue(right.targetDate || right.createdAt)?.getTime() || 0;
              return leftDate - rightDate;
            }),
        );
        markLoaded();
      },
      (error) => {
        console.error("Error loading Scrum releases:", error);
        toast.error("No se pudieron cargar los Releases del proyecto.");
        markLoaded();
      },
    );
    const unsubscribeGroups = onSnapshot(
      collection(db, "projects", projectId, "scrumGroups"),
      (snapshot) => {
        setGroups(
          snapshot.docs
            .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }))
            .filter((group: any) => !group.deletedAt)
            .sort((left: any, right: any) => String(left.name || "").localeCompare(String(right.name || ""), "es")),
        );
        markLoaded();
      },
      (error) => {
        console.error("Error loading Scrum submodules:", error);
        toast.error("No se pudieron cargar los submódulos Scrum.");
        markLoaded();
      },
    );

    return () => {
      unsubscribeReleases();
      unsubscribeGroups();
    };
  }, [projectId]);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "projects", projectId, "sprints"),
      (snapshot) => {
        const nextSprints = snapshot.docs
          .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }))
          .filter((sprint: any) => !sprint.deletedAt)
          .sort(sortSprintsNewestFirst);
        setSprints(nextSprints);
        setSprintsLoading(false);
      },
      (error) => {
        console.error("Error loading sprints:", error);
        toast.error("No se pudieron cargar los sprints del proyecto.");
        setSprintsLoading(false);
      },
    );

    return () => unsubscribe();
  }, [projectId]);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, "projects", projectId, "scrumMapLayouts", "main"),
      (snapshot) => {
        setScrumMapLayout(snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as ScrumMapLayout) : null);
      },
      (error) => {
        console.error("Error loading Scrum map layout:", error);
        setScrumMapLayout(null);
      },
    );

    return () => unsubscribe();
  }, [projectId]);

  useEffect(() => {
    const requestedView = searchParams.get("scrumView") as ScrumView | null;
    const requestedItemId = searchParams.get("workItem");
    if (requestedView && ["structure", "stories", "backlog", "overview", "board", "sprints", "github", "settings"].includes(requestedView)) {
      setView(requestedView);
    }
    if (requestedItemId) setSelectedItemId(requestedItemId);
  }, [searchParams]);

  const scrumItems = useMemo(
    () =>
      tasks
        .filter(isScrumTask)
        .map((task) => ({ ...task, scrumStatus: normalizeScrumStatus(task.scrumStatus || task.status) })),
    [tasks],
  );

  const taskTypeFilterOptions = useMemo(() => {
    const options = new Map<string, { value: string; label: string; sortOrder: number }>();
    activeTaskTypeEntries.forEach((entry) => {
      options.set(entry.normalizedLabel, {
        value: entry.normalizedLabel,
        label: entry.label,
        sortOrder: Number(entry.sortOrder ?? 10_000),
      });
    });
    scrumItems
      .filter((item) => getScrumItemKind(item) !== "epic")
      .forEach((item) => {
        const label = getScrumTaskTypeLabel(item);
        const value = normalizeScrumStoryCatalogLabel(label);
        if (!value || options.has(value)) return;
        const domainEntry = taskTypeEntries.find((entry) => entry.id === item.scrumTaskTypeId);
        options.set(value, {
          value,
          label,
          sortOrder: Number(domainEntry?.sortOrder ?? 10_000),
        });
      });
    return Array.from(options.values()).sort((left, right) => {
      const orderDifference = left.sortOrder - right.sortOrder;
      return orderDifference || left.label.localeCompare(right.label, "es", { sensitivity: "base" });
    });
  }, [activeTaskTypeEntries, scrumItems, taskTypeEntries]);

  const configurableTaskTypeEntries = useMemo(
    () => taskTypeEntries.filter((entry) => entry.source === "project" && !entry.isDefault),
    [taskTypeEntries],
  );

  const epics = useMemo(
    () => scrumItems.filter((item) => item.scrumKind === "epic"),
    [scrumItems],
  );

  const refinedEpics = useMemo(() => epics.filter(isRefined), [epics]);

  const userStories = useMemo(
    () => scrumItems.filter((item) => item.scrumKind === "story" && isRefined(item)),
    [scrumItems],
  );

  const selectedWorkItem = useMemo(
    () => scrumItems.find((item) => item.id === selectedItemId) || null,
    [scrumItems, selectedItemId],
  );

  const unplannedItems = useMemo(
    () => scrumItems
      .filter((item) => item.scrumKind !== "epic" && !item.sprintId && isRefined(item))
      .filter((item) => normalizeScrumStatus(item.scrumStatus || item.status) !== "done")
      .sort((left, right) => {
        const priorityDifference = (PRIORITY_WEIGHT[left.priority] ?? 9) - (PRIORITY_WEIGHT[right.priority] ?? 9);
        if (priorityDifference !== 0) return priorityDifference;
        return Number(left.scrumRank || left.displayOrder || 0) - Number(right.scrumRank || right.displayOrder || 0);
      }),
    [scrumItems],
  );

  const releaseById = useMemo(
    () => new Map(releases.map((release) => [release.id, release])),
    [releases],
  );

  const epicById = useMemo(
    () => new Map(epics.map((epic) => [epic.id, epic])),
    [epics],
  );

  const groupById = useMemo(
    () => new Map(groups.map((group) => [group.id, group])),
    [groups],
  );

  const activeSprints = useMemo(
    () => sprints.filter((sprint) => getSprintStatus(sprint) === "active"),
    [sprints],
  );

  const activeSprint = activeSprints[0] || null;

  const planningSprint = useMemo(
    () => sprints.find((sprint) => getSprintStatus(sprint) === "planning") || null,
    [sprints],
  );

  const selectedSprint = useMemo(() => {
    if (selectedSprintId) return sprints.find((sprint) => sprint.id === selectedSprintId) || null;
    return activeSprint || planningSprint || sprints[0] || null;
  }, [activeSprint, planningSprint, selectedSprintId, sprints]);

  const backlogItems = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return scrumItems
      .filter((item) => !item.sprintId && item.scrumKind !== "epic" && item.scrumKind !== "story")
      .filter(isRefined)
      .filter((item) => normalizeScrumStatus(item.scrumStatus || item.status) !== "done")
      .filter((item) => kindFilter === "all" || getTaskTypeFilterValue(item) === kindFilter)
      .filter((item) => {
        if (!normalizedSearch) return true;
        return [item.scrumCode, getItemTitle(item), item.description, item.module, getScrumTaskTypeLabel(item)]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedSearch));
      })
      .sort((left, right) => {
        const priorityDifference =
          (PRIORITY_WEIGHT[left.priority] ?? 9) - (PRIORITY_WEIGHT[right.priority] ?? 9);
        if (priorityDifference !== 0) return priorityDifference;
        return Number(left.scrumRank || left.displayOrder || 0) - Number(right.scrumRank || right.displayOrder || 0);
      });
  }, [kindFilter, scrumItems, search]);

  const groomingItems = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return scrumItems
      .filter((item) => !item.sprintId && !isRefined(item))
      .filter((item) => kindFilter === "all" || getTaskTypeFilterValue(item) === kindFilter)
      .filter((item) => {
        if (!normalizedSearch) return true;
        return [item.scrumCode, getItemTitle(item), item.description, item.module, getScrumTaskTypeLabel(item)]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedSearch));
      })
      .sort((left, right) => {
        const priorityDifference = (PRIORITY_WEIGHT[left.priority] ?? 9) - (PRIORITY_WEIGHT[right.priority] ?? 9);
        if (priorityDifference !== 0) return priorityDifference;
        return Number(left.scrumRank || left.displayOrder || 0) - Number(right.scrumRank || right.displayOrder || 0);
      });
  }, [kindFilter, scrumItems, search]);

  const selectedSprintItems = useMemo(
    () =>
      selectedSprint
        ? scrumItems
            .filter((item) => item.sprintId === selectedSprint.id && item.scrumKind !== "epic")
            .sort((left, right) => {
              const priorityDifference = (PRIORITY_WEIGHT[left.priority] ?? 9) - (PRIORITY_WEIGHT[right.priority] ?? 9);
              if (priorityDifference !== 0) return priorityDifference;
              return Number(left.scrumRank || left.displayOrder || 0) - Number(right.scrumRank || right.displayOrder || 0);
            })
        : [],
    [scrumItems, selectedSprint],
  );

  const storiesWithoutSubmodule = useMemo(() => {
    const sprintById = new Map(sprints.map((sprint) => [sprint.id, sprint]));
    return scrumItems.filter((item) => {
      if (item.scrumKind !== "story" || !isRefined(item)) return false;
      const effectiveGroupId = item.scrumGroupId || sprintById.get(item.sprintId)?.scrumGroupId;
      return !effectiveGroupId || !groupById.has(effectiveGroupId);
    });
  }, [groupById, scrumItems, sprints]);

  const getMember = (id: string) => teamMembers.find((member) => member.id === id);

  const getItemAssigneeIds = (item: any) => {
    const ids = Array.isArray(item?.scrumAssigneeIds) ? [...item.scrumAssigneeIds] : [];
    if (item?.assignedTo && !ids.includes(item.assignedTo)) ids.unshift(item.assignedTo);
    return ids.filter(Boolean);
  };

  const myWorkItems = useMemo(() => {
    const userId = currentUser?.uid || currentUser?.id;
    if (!userId) return [];
    return scrumItems
      .filter((item) => item.scrumKind !== "epic")
      .filter(isRefined)
      .filter((item) => {
        const ids = Array.isArray(item?.scrumAssigneeIds) ? [...item.scrumAssigneeIds] : [];
        if (item?.assignedTo && !ids.includes(item.assignedTo)) ids.unshift(item.assignedTo);
        return ids.includes(userId);
      })
      .sort((left, right) => {
        const leftSprint = sprints.find((sprint) => sprint.id === left.sprintId);
        const rightSprint = sprints.find((sprint) => sprint.id === right.sprintId);
        const sprintDifference = (getSprintStatus(leftSprint) === "active" ? 0 : left.sprintId ? 1 : 2) -
          (getSprintStatus(rightSprint) === "active" ? 0 : right.sprintId ? 1 : 2);
        if (sprintDifference !== 0) return sprintDifference;
        const priorityDifference = (PRIORITY_WEIGHT[left.priority] ?? 9) - (PRIORITY_WEIGHT[right.priority] ?? 9);
        if (priorityDifference !== 0) return priorityDifference;
        return Number(left.scrumRank || left.displayOrder || 0) - Number(right.scrumRank || right.displayOrder || 0);
      });
  }, [currentUser?.id, currentUser?.uid, scrumItems, sprints]);

  const selectedItemStatus = selectedWorkItem ? normalizeScrumStatus(selectedWorkItem.scrumStatus || selectedWorkItem.status) : "backlog";
  const selectedItemStatusIndex = SCRUM_WORK_STATUSES.findIndex((status) => status.value === selectedItemStatus);
  const selectedItemSprint = selectedWorkItem ? sprints.find((sprint) => sprint.id === selectedWorkItem.sprintId) : null;
  const selectedItemGroup = selectedWorkItem
    ? groupById.get(selectedWorkItem.scrumGroupId || selectedItemSprint?.scrumGroupId)
    : null;
  const selectedItemEpic = selectedWorkItem
    ? epicById.get(selectedWorkItem.scrumEpicId || selectedItemSprint?.scrumEpicId || selectedItemGroup?.scrumEpicId)
    : null;
  const selectedItemRelease = selectedWorkItem?.scrumKind === "epic"
    ? releaseById.get(selectedWorkItem.scrumReleaseId)
    : releaseById.get(selectedWorkItem?.scrumReleaseId || selectedItemGroup?.scrumReleaseId || selectedItemEpic?.scrumReleaseId || selectedItemSprint?.scrumReleaseId);
  const selectedItemExecutionMode = selectedWorkItem ? getScrumExecutionMode(selectedWorkItem) : "manual";
  const resetItemModal = () => {
    setEditingItem(null);
    setItemDraft(EMPTY_ITEM_DRAFT);
    setIsItemModalOpen(false);
  };

  const openCreateItem = (defaults: Partial<WorkItemDraft> = {}) => {
    const defaultKind = defaults.kind || EMPTY_ITEM_DRAFT.kind;
    const defaultTaskTypeLabel = defaultKind === "epic"
      ? ""
      : defaults.taskTypeLabel || DEFAULT_TASK_TYPE_LABELS[defaultKind];
    const defaultTaskTypeEntry = taskTypeEntries.find(
      (entry) => entry.normalizedLabel === normalizeScrumStoryCatalogLabel(defaultTaskTypeLabel),
    );
    const defaultSprintId = defaults.sprintId !== undefined ? defaults.sprintId : activeSprint?.id || "";
    const defaultSprint = sprints.find((sprint) => sprint.id === defaultSprintId);
    const defaultGroupId = defaults.groupId !== undefined ? defaults.groupId : defaultSprint?.scrumGroupId || "";
    const defaultGroup = groupById.get(defaultGroupId);
    const defaultEpicId = defaults.epicId !== undefined
      ? defaults.epicId
      : defaultSprint?.scrumEpicId || defaultGroup?.scrumEpicId || "";
    const defaultEpic = epicById.get(defaultEpicId);
    setEditingItem(null);
    setItemDraft({
      ...EMPTY_ITEM_DRAFT,
      releaseId: defaultEpic?.scrumReleaseId || defaultSprint?.scrumReleaseId || "",
      epicId: defaultEpicId,
      groupId: defaultGroupId,
      sprintId: defaultSprintId,
      ...defaults,
      kind: defaultKind,
      taskTypeId: defaults.taskTypeId || defaultTaskTypeEntry?.id || "",
      taskTypeLabel: defaultTaskTypeLabel,
    });
    setIsItemModalOpen(true);
  };

  const openEditItem = (item: any) => {
    const itemSprint = sprints.find((sprint) => sprint.id === item.sprintId);
    const itemGroupId = item.scrumGroupId || itemSprint?.scrumGroupId || "";
    const itemGroup = groupById.get(itemGroupId);
    const itemEpicId = item.scrumEpicId || itemSprint?.scrumEpicId || itemGroup?.scrumEpicId || "";
    const itemEpic = epicById.get(itemEpicId);
    setEditingItem(item);
    setItemDraft({
      title: getItemTitle(item),
      description: item.description || "",
      acceptanceCriteria: item.acceptanceCriteria || "",
      kind: item.scrumKind || "story",
      taskTypeId: item.scrumTaskTypeId || "",
      taskTypeLabel: getScrumTaskTypeLabel(item),
      priority: item.priority || "medium",
      storyPoints: String(item.storyPoints || 0),
      module: item.module || "",
      releaseId: item.scrumReleaseId || itemSprint?.scrumReleaseId || itemGroup?.scrumReleaseId || itemEpic?.scrumReleaseId || "",
      epicId: itemEpicId,
      groupId: itemGroupId,
      sprintId: item.sprintId || "",
      assigneeIds: getItemAssigneeIds(item),
      executionMode: getScrumExecutionMode(item),
      refinementStatus: getRefinementStatus(item),
    });
    setIsItemModalOpen(true);
  };

  const toggleDraftAssignee = (memberId: string) => {
    setItemDraft((current) => ({
      ...current,
      assigneeIds: current.assigneeIds.includes(memberId)
        ? current.assigneeIds.filter((id) => id !== memberId)
        : [...current.assigneeIds, memberId],
    }));
  };

  const applyDraftTaskType = (entry: ScrumStoryCatalogEntry) => {
    setItemDraft((current) => ({
      ...current,
      kind: getCatalogTaskKind(entry),
      taskTypeId: entry.id,
      taskTypeLabel: entry.label,
    }));
  };

  const saveWorkItem = async () => {
    const selectedSprintForItem = sprints.find((sprint) => sprint.id === itemDraft.sprintId);
    const selectedSubmoduleId = selectedSprintForItem?.scrumGroupId || itemDraft.groupId;
    const selectedTaskTypeEntry = itemDraft.kind === "epic"
      ? undefined
      : taskTypeEntries.find((entry) => (
        entry.id === itemDraft.taskTypeId ||
        entry.normalizedLabel === normalizeScrumStoryCatalogLabel(itemDraft.taskTypeLabel)
      ));
    if (!itemDraft.title.trim()) {
      toast.warning("Escribe el nombre del trabajo.");
      return;
    }
    if (itemDraft.kind !== "epic" && !itemDraft.taskTypeLabel.trim()) {
      toast.warning("Selecciona un tipo de tarea.");
      return;
    }
    if (itemDraft.kind !== "epic" && Number(itemDraft.storyPoints || 0) < 0) {
      toast.warning("La estimación no puede ser negativa.");
      return;
    }
    if (itemDraft.kind !== "epic" && itemDraft.refinementStatus === "refined" && !itemDraft.epicId) {
      toast.warning("Para completar el grooming debes vincular el trabajo a una épica.");
      return;
    }
    if (itemDraft.kind !== "epic" && itemDraft.refinementStatus === "refined" && (!selectedSubmoduleId || !groupById.has(selectedSubmoduleId))) {
      toast.warning("Para completar el grooming debes vincular la historia a un submódulo.");
      return;
    }
    if (itemDraft.kind === "epic" && itemDraft.refinementStatus === "refined" && !itemDraft.releaseId) {
      toast.warning("Para promover una épica debes vincularla a un Release.");
      return;
    }

    setIsSavingItem(true);
    try {
      const itemRef = editingItem
        ? doc(db, "projects", projectId, "tasks", editingItem.id)
        : doc(collection(db, "projects", projectId, "tasks"));
      const selectedGroupForItem = groupById.get(selectedSubmoduleId);
      const selectedEpicId = itemDraft.kind === "epic"
        ? ""
        : selectedSprintForItem?.scrumEpicId || selectedGroupForItem?.scrumEpicId || itemDraft.epicId;
      const selectedEpic = epicById.get(selectedEpicId);
      const selectedReleaseId = itemDraft.kind === "epic"
        ? itemDraft.releaseId
        : selectedSprintForItem?.scrumReleaseId || selectedGroupForItem?.scrumReleaseId || selectedEpic?.scrumReleaseId || "";
      const retainedImpactedSubmoduleIds = (Array.isArray(editingItem?.scrumSubmoduleIds)
        ? editingItem.scrumSubmoduleIds
        : []
      ).filter((groupId: string) => {
        const group = groupById.get(groupId);
        return groupId !== editingItem?.scrumGroupId && group?.scrumEpicId === selectedEpicId;
      });
      const scrumSubmoduleIds = itemDraft.kind === "epic" || !selectedGroupForItem?.id
        ? []
        : Array.from(new Set([selectedGroupForItem.id, ...retainedImpactedSubmoduleIds]));
      const now = new Date();
      const startDate = toDateValue(selectedSprintForItem?.startDate) || now;
      const endDate = toDateValue(selectedSprintForItem?.endDate) || new Date(now.getTime() + 7 * 86400000);
      const primaryAssignee = itemDraft.assigneeIds[0] || "";
      const assignmentMode =
        itemDraft.assigneeIds.length <= 1 ? "individual" : itemDraft.assigneeIds.length === 2 ? "pair" : "team";
      const projectKey = String(project?.scrumSettings?.key || project?.name || "PIX")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]/g, "")
        .slice(0, 4)
        .toUpperCase() || "PIX";
      const highestProjectSequence = tasks.reduce((highest, task) => {
        const match = String(task?.scrumCode || "").toUpperCase().match(new RegExp(`^${projectKey}-(\\d+)$`));
        return match ? Math.max(highest, Number(match[1])) : highest;
      }, Number(project?.scrumSettings?.lastSequence || 0));
      const scrumCode = editingItem?.scrumCode || `${projectKey}-${String(highestProjectSequence + 1).padStart(3, "0")}`;
      const scrumStatus = editingItem
        ? normalizeScrumStatus(editingItem.scrumStatus || editingItem.status)
        : itemDraft.kind === "epic"
          ? "backlog"
          : itemDraft.sprintId
            ? "ready"
            : "backlog";
      const refinementStatus = itemDraft.sprintId ? "refined" : itemDraft.refinementStatus;
      const executionMode = itemDraft.kind === "epic" ? null : itemDraft.executionMode;
      const payload: any = {
        projectId,
        title: itemDraft.title.trim(),
        name: itemDraft.title.trim(),
        description: itemDraft.description.trim(),
        acceptanceCriteria: itemDraft.acceptanceCriteria.trim(),
        type: "state",
        scrumItem: true,
        scrumCode,
        scrumKind: itemDraft.kind,
        scrumTaskTypeId: itemDraft.kind === "epic" ? null : selectedTaskTypeEntry?.id || itemDraft.taskTypeId || null,
        scrumTaskTypeLabel: itemDraft.kind === "epic" ? null : itemDraft.taskTypeLabel.trim(),
        scrumExecutionMode: executionMode,
        workflowControl: executionMode === "manual" ? "inbox_manual" : executionMode === "github" ? "github_evidence" : null,
        githubAutomationEnabled: executionMode === "github",
        scrumRefinementStatus: refinementStatus,
        scrumRefinedAt: refinementStatus === "refined" ? (editingItem?.scrumRefinedAt || serverTimestamp()) : null,
        scrumRefinedBy: refinementStatus === "refined" ? (editingItem?.scrumRefinedBy || currentUser?.uid || null) : null,
        scrumStatus,
        scrumReleaseId: selectedReleaseId || null,
        scrumGroupId: itemDraft.kind === "epic" ? null : selectedGroupForItem?.id || null,
        scrumSubmoduleIds,
        scrumEpicId: itemDraft.kind === "epic" ? null : selectedEpicId || null,
        sprintId: itemDraft.kind === "epic" ? null : itemDraft.sprintId || null,
        storyPoints: itemDraft.kind === "epic" ? 0 : Number(itemDraft.storyPoints || 0),
        module: itemDraft.module.trim() || null,
        priority: itemDraft.priority,
        assignedTo: primaryAssignee,
        scrumAssigneeIds: itemDraft.assigneeIds,
        assignedUsers: itemDraft.assigneeIds,
        assignedTeamMembers: itemDraft.assigneeIds,
        assignmentMode,
        status: mapScrumStatusToTaskStatus(scrumStatus),
        progress: getScrumProgress(scrumStatus, editingItem?.progress || 0),
        startDate,
        endDate,
        start: startDate,
        end: endDate,
        updatedAt: serverTimestamp(),
      };

      if (editingItem) {
        await updateDoc(itemRef, payload);
        toast.success("Trabajo actualizado.");
      } else {
        payload.createdAt = serverTimestamp();
        payload.createdBy = currentUser?.uid || null;
        payload.displayOrder = tasks.length;
        payload.scrumRank = Date.now();
        await setDoc(itemRef, payload);
        await updateDoc(doc(db, "projects", projectId), {
          "scrumSettings.lastSequence": highestProjectSequence + 1,
          updatedAt: serverTimestamp(),
        });
        toast.success(`${itemDraft.kind === "epic" ? "Épica" : itemDraft.taskTypeLabel.trim()} creada en Pixel.`);
      }

      if (itemDraft.kind === "epic" && editingItem && editingItem.scrumReleaseId !== selectedReleaseId) {
        const childGroups = groups.filter((group) => group.scrumEpicId === editingItem.id);
        const childGroupIds = new Set(childGroups.map((group) => group.id));
        const childSprints = sprints.filter(
          (sprint) => sprint.scrumEpicId === editingItem.id || childGroupIds.has(sprint.scrumGroupId),
        );
        const childSprintIds = new Set(childSprints.map((sprint) => sprint.id));
        await Promise.all([
          ...childGroups.map((group) => updateDoc(doc(db, "projects", projectId, "scrumGroups", group.id), {
            scrumReleaseId: selectedReleaseId || null,
            updatedAt: serverTimestamp(),
          })),
          ...childSprints.map((sprint) => updateDoc(doc(db, "projects", projectId, "sprints", sprint.id), {
            scrumReleaseId: selectedReleaseId || null,
            scrumEpicId: editingItem.id,
            ...(sprint.snapshot ? {
              snapshot: {
                ...sprint.snapshot,
                scrumReleaseId: selectedReleaseId || null,
                scrumEpicId: editingItem.id,
              },
            } : {}),
            updatedAt: serverTimestamp(),
          })),
          ...scrumItems
            .filter((item) => item.scrumEpicId === editingItem.id || childSprintIds.has(item.sprintId))
            .map((item) => updateDoc(doc(db, "projects", projectId, "tasks", item.id), {
              scrumReleaseId: selectedReleaseId || null,
              scrumEpicId: editingItem.id,
              updatedAt: serverTimestamp(),
            })),
        ]);
      }

      if (executionMode === "manual" && itemDraft.sprintId && itemDraft.assigneeIds.length > 0) {
        const previousAssigneeIds = new Set(editingItem ? getItemAssigneeIds(editingItem) : []);
        const previousMode = editingItem ? getScrumExecutionMode(editingItem) : null;
        const assigneesToNotify = previousMode === "manual"
          ? itemDraft.assigneeIds.filter((assigneeId) => !previousAssigneeIds.has(assigneeId))
          : itemDraft.assigneeIds;
        void Promise.allSettled(
          assigneesToNotify.map((assigneeId) => notifyTaskAssignment({
            projectId,
            taskId: itemRef.id,
            assigneeId,
            eventType: "task_assigned",
            source: editingItem ? "scrum_manual_reassigned" : "scrum_manual_created",
          })),
        );
      }
      if (itemDraft.kind === "story" && refinementStatus === "refined") {
        setFocusedStoryId(itemRef.id);
      }
      resetItemModal();
      if (itemDraft.kind === "story" && refinementStatus === "refined") {
        setView("stories");
      }
    } catch (error) {
      console.error("Error saving scrum item:", error);
      toast.error("No se pudo guardar el trabajo.");
    } finally {
      setIsSavingItem(false);
    }
  };

  const updateWorkStatus = async (item: any, scrumStatus: ScrumWorkStatus) => {
    if (!canMoveItems || item.scrumKind === "epic") return;
    const currentStatus = normalizeScrumStatus(item.scrumStatus || item.status);
    const executionMode = getScrumExecutionMode(item);
    const isFunctionalApproval = executionMode === "github" && currentStatus === "validation" && scrumStatus === "done";
    if (!isFunctionalApproval) {
      toast.info(executionMode === "manual"
        ? "Esta tarea se controla desde la Bandeja de entrada."
        : "Esta tarea avanza con evidencia GitHub. Para operarla manualmente, cambia su modo de control.");
      return;
    }
    try {
      await updateDoc(doc(db, "projects", projectId, "tasks", item.id), {
        scrumStatus,
        status: mapScrumStatusToTaskStatus(scrumStatus),
        progress: getScrumProgress(scrumStatus, item.progress || 0),
        statusHistory: arrayUnion({
          id: `${item.id}-scrum-${scrumStatus}-${Date.now()}`,
          previousStatus: item.status || null,
          status: mapScrumStatusToTaskStatus(scrumStatus),
          previousScrumStatus: currentStatus,
          scrumStatus,
          action: "scrum_status",
          source: isFunctionalApproval ? "functional_validation" : "scrum_board_manual",
          changedBy: currentUser?.uid || null,
          changedByEmail: currentUser?.email || null,
          timestamp: new Date(),
        }),
        scrumStatusUpdatedAt: serverTimestamp(),
        scrumStatusUpdatedBy: currentUser?.uid || null,
        completedAt: scrumStatus === "done" ? serverTimestamp() : null,
        completedBy: scrumStatus === "done" ? currentUser?.uid || null : null,
        updatedAt: serverTimestamp(),
      });
      toast.success(`${item.scrumCode || getItemTitle(item)} pasó a ${getScrumStatusLabel(scrumStatus)}.`);
    } catch (error) {
      console.error("Error updating scrum status:", error);
      toast.error("No se pudo mover el trabajo.");
    }
  };

  const assignItemToSprint = async (item: any, sprintId: string | null) => {
    if (!canManage) return;
    const sprint = sprints.find((candidate) => candidate.id === sprintId);
    const sprintGroup = groupById.get(sprint?.scrumGroupId);
    const retainedGroup = groupById.get(item.scrumGroupId);
    const destinationEpicId = sprintId
      ? sprint?.scrumEpicId || sprintGroup?.scrumEpicId || item.scrumEpicId || null
      : retainedGroup?.scrumEpicId || item.scrumEpicId || null;
    const impactedSubmoduleIds = (Array.isArray(item.scrumSubmoduleIds) ? item.scrumSubmoduleIds : [])
      .filter((groupId: string) => groupById.get(groupId)?.scrumEpicId === destinationEpicId);
    const primarySubmoduleId = sprintId ? sprint?.scrumGroupId : retainedGroup?.id;
    try {
      const updates: any = {
        sprintId,
        scrumGroupId: primarySubmoduleId || null,
        scrumSubmoduleIds: primarySubmoduleId
          ? Array.from(new Set([primarySubmoduleId, ...impactedSubmoduleIds]))
          : impactedSubmoduleIds,
        scrumEpicId: destinationEpicId,
        scrumReleaseId: sprintId
          ? sprint?.scrumReleaseId || sprintGroup?.scrumReleaseId || epicById.get(sprint?.scrumEpicId || sprintGroup?.scrumEpicId)?.scrumReleaseId || null
          : retainedGroup?.scrumReleaseId || item.scrumReleaseId || epicById.get(retainedGroup?.scrumEpicId || item.scrumEpicId)?.scrumReleaseId || null,
        scrumStatus: sprintId ? "ready" : "backlog",
        scrumRefinementStatus: "refined",
        status: "todo",
        progress: 0,
        updatedAt: serverTimestamp(),
      };
      if (sprint) {
        const startDate = toDateValue(sprint.startDate);
        const endDate = toDateValue(sprint.endDate);
        if (startDate) {
          updates.startDate = startDate;
          updates.start = startDate;
        }
        if (endDate) {
          updates.endDate = endDate;
          updates.end = endDate;
        }
      }
      await updateDoc(doc(db, "projects", projectId, "tasks", item.id), updates);
      if (sprintId && getScrumExecutionMode(item) === "manual") {
        void Promise.allSettled(
          getItemAssigneeIds(item).map((assigneeId) => notifyTaskAssignment({
            projectId,
            taskId: item.id,
            assigneeId,
            eventType: "task_assigned",
            source: "scrum_manual_sprint_assignment",
          })),
        );
      }
      toast.success(sprintId ? "Trabajo agregado al sprint." : "Trabajo devuelto al backlog.");
    } catch (error) {
      console.error("Error assigning sprint:", error);
      toast.error("No se pudo actualizar el sprint del trabajo.");
    }
  };

  const promoteFromGrooming = async (item: any) => {
    if (!canManage) return;
    const parentSprint = sprints.find((sprint) => sprint.id === item.sprintId);
    const effectiveGroupId = item.scrumGroupId || parentSprint?.scrumGroupId;
    const parentSubmodule = groupById.get(effectiveGroupId);
    const effectiveEpicId = item.scrumEpicId || parentSubmodule?.scrumEpicId;
    if (item.scrumKind === "epic" && !item.scrumReleaseId) {
      toast.warning("Asigna esta épica a un Release antes de promoverla.");
      openEditItem(item);
      return;
    }
    if (item.scrumKind !== "epic" && !effectiveEpicId) {
      toast.warning("Primero vincula este trabajo a una épica durante el grooming.");
      openEditItem(item);
      return;
    }
    if (item.scrumKind !== "epic" && !parentSubmodule) {
      toast.warning("Primero vincula esta historia a un submódulo durante el grooming.");
      openEditItem(item);
      return;
    }
    const parentEpic = item.scrumKind !== "epic" ? epicById.get(effectiveEpicId) : null;
    if (item.scrumKind !== "epic" && !parentEpic?.scrumReleaseId) {
      toast.warning("La épica seleccionada debe pertenecer a un Release antes de completar el grooming.");
      return;
    }
    try {
      await updateDoc(doc(db, "projects", projectId, "tasks", item.id), {
        scrumReleaseId: item.scrumKind === "epic" ? item.scrumReleaseId : parentSubmodule?.scrumReleaseId || parentEpic?.scrumReleaseId || null,
        scrumEpicId: item.scrumKind === "epic" ? null : effectiveEpicId || null,
        scrumGroupId: item.scrumKind === "epic" ? null : effectiveGroupId || null,
        scrumSubmoduleIds: item.scrumKind === "epic" || !effectiveGroupId
          ? []
          : Array.from(new Set([
              effectiveGroupId,
              ...(Array.isArray(item.scrumSubmoduleIds) ? item.scrumSubmoduleIds : [])
                .filter((groupId: string) => groupById.get(groupId)?.scrumEpicId === effectiveEpicId),
            ])),
        scrumRefinementStatus: "refined",
        scrumRefinedAt: serverTimestamp(),
        scrumRefinedBy: currentUser?.uid || null,
        updatedAt: serverTimestamp(),
      });
      toast.success(
        item.scrumKind === "epic"
          ? "Épica promovida al flujo principal."
          : item.scrumKind === "story"
            ? "Grooming completado. La historia ya tiene su propio expediente."
            : "Grooming completado. El trabajo ya forma parte de su submódulo.",
      );
      if (item.scrumKind === "story") {
        setFocusedStoryId(item.id);
        setView("stories");
      }
    } catch (error) {
      console.error("Error promoting backlog item:", error);
      toast.error("No se pudo completar el grooming.");
    }
  };

  const deleteWorkItem = async (item: any) => {
    if (!canManage || !window.confirm(`¿Eliminar ${getItemTitle(item)}?`)) return;
    try {
      await deleteDoc(doc(db, "projects", projectId, "tasks", item.id));
      toast.success("Trabajo eliminado.");
    } catch (error) {
      console.error("Error deleting scrum item:", error);
      toast.error("No se pudo eliminar el trabajo.");
    }
  };

  const deleteSprint = async (sprint: any) => {
    if (!canManage) return;
    const status = getSprintStatus(sprint);
    const isCompletedSprint = status === "completed";
    const assignedItems = scrumItems.filter((item) => item.sprintId === sprint.id && item.scrumKind !== "epic");
    const confirmed = window.confirm(
      isCompletedSprint
        ? `¿Eliminar el sprint terminado ${sprint.name}? Sus ${assignedItems.length} elemento(s) conservarán el estado alcanzado y Pixel guardará la trazabilidad de esta eliminación.`
        : `¿Eliminar ${sprint.name}? ${assignedItems.length} elemento(s) volverán al backlog de su submódulo. Esta acción no elimina las historias.`,
    );
    if (!confirmed) return;
    try {
      const deletedAt = new Date();
      const actorId = currentUser?.uid || currentUser?.id || null;
      const actorEmail = currentUser?.email || null;
      const actorName = getMemberLabel(currentUser);
      const batch = writeBatch(db);

      assignedItems.forEach((item) => {
        const taskUpdates: Record<string, any> = {
          sprintId: null,
          scrumGroupId: sprint.scrumGroupId || item.scrumGroupId || null,
          scrumEpicId: sprint.scrumEpicId || item.scrumEpicId || null,
          scrumReleaseId: sprint.scrumReleaseId || item.scrumReleaseId || null,
          scrumRefinementStatus: "refined",
          previousSprintId: sprint.id,
          previousSprintName: sprint.name || "Sprint",
          previousSprintStatus: status,
          sprintRemovedAt: deletedAt,
          sprintRemovedBy: actorId,
          statusHistory: arrayUnion({
            id: `${item.id}-sprint-removed-${deletedAt.getTime()}`,
            action: "sprint_deleted",
            source: "scrum_sprint_deletion",
            sprintId: sprint.id,
            sprintName: sprint.name || "Sprint",
            sprintStatus: status,
            preservedWorkStatus: isCompletedSprint,
            changedBy: actorId,
            changedByEmail: actorEmail,
            timestamp: deletedAt,
          }),
          updatedAt: deletedAt,
        };

        if (!isCompletedSprint) {
          taskUpdates.scrumStatus = "backlog";
          taskUpdates.status = "todo";
          taskUpdates.progress = 0;
        }

        batch.update(doc(db, "projects", projectId, "tasks", item.id), taskUpdates);
      });

      batch.update(doc(db, "projects", projectId, "sprints", sprint.id), {
        deletedAt,
        deletedBy: actorId,
        deletedByEmail: actorEmail,
        deletedByName: actorName,
        deletionSnapshot: {
          status,
          itemIds: assignedItems.map((item) => item.id),
          itemCount: assignedItems.length,
          scrumReleaseId: sprint.scrumReleaseId || null,
          scrumEpicId: sprint.scrumEpicId || null,
          scrumGroupId: sprint.scrumGroupId || null,
          closureSnapshot: sprint.snapshot || null,
        },
        lifecycleHistory: arrayUnion({
          action: "deleted",
          at: deletedAt,
          actorId,
          actorEmail,
          actorName,
          sprintStatus: status,
          preservedWorkStatus: isCompletedSprint,
          itemCount: assignedItems.length,
        }),
        updatedAt: deletedAt,
      });

      await batch.commit();
      if (selectedSprintId === sprint.id) setSelectedSprintId("");
      toast.success(
        isCompletedSprint
          ? "Sprint terminado eliminado. Las historias conservaron su estado y quedó trazabilidad."
          : "Sprint eliminado. Su trabajo volvió al backlog del submódulo.",
      );
    } catch (error) {
      console.error("Error deleting sprint:", error);
      toast.error("No se pudo eliminar el sprint.");
    }
  };

  const downloadMyWorkReport = () => {
    const escapeCsv = (value: any) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const headers = ["Orden", "Código", "Trabajo", "Tipo", "Control", "Release", "Épica", "Submódulo", "Sprint", "Estado", "Prioridad", "Puntos", "Criterios de aceptación"];
    const rows = myWorkItems.map((item, index) => {
      const sprint = sprints.find((candidate) => candidate.id === item.sprintId);
      const group = groupById.get(item.scrumGroupId || sprint?.scrumGroupId);
      const epic = epicById.get(item.scrumEpicId || sprint?.scrumEpicId || group?.scrumEpicId);
      const release = releaseById.get(item.scrumReleaseId || group?.scrumReleaseId || epic?.scrumReleaseId || sprint?.scrumReleaseId);
      return [
        index + 1,
        item.scrumCode,
        getItemTitle(item),
        getScrumTaskTypeLabel(item),
        getScrumExecutionMode(item) === "manual" ? "Manual · Bandeja" : "GitHub · Automático",
        release?.name || "Sin Release",
        epic ? getItemTitle(epic) : "Sin épica",
        group?.name || "Sin submódulo",
        getItemSprintLabel(item, sprint),
        getScrumStatusLabel(item.scrumStatus),
        priorityLabel(item.priority),
        Number(item.storyPoints || 0),
        item.acceptanceCriteria || "Sin criterios definidos",
      ];
    });
    const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
    const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `mi-plan-${String(project?.name || "proyecto").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const openReleaseModal = (release: any | null = null) => {
    setEditingRelease(release);
    setReleaseDraft(release ? {
      name: release.name || "",
      objective: release.objective || release.goal || "",
      startDate: toInputDate(release.startDate),
      targetDate: toInputDate(release.targetDate || release.endDate),
    } : EMPTY_RELEASE_DRAFT);
    setIsReleaseModalOpen(true);
  };

  const resetReleaseModal = () => {
    setEditingRelease(null);
    setReleaseDraft(EMPTY_RELEASE_DRAFT);
    setIsReleaseModalOpen(false);
  };

  const saveRelease = async () => {
    if (!canManage) return;
    if (!releaseDraft.name.trim() || !releaseDraft.startDate || !releaseDraft.targetDate) {
      toast.warning("Completa el nombre y las fechas del Release.");
      return;
    }
    const startDate = new Date(`${releaseDraft.startDate}T00:00:00`);
    const targetDate = new Date(`${releaseDraft.targetDate}T23:59:59`);
    if (targetDate.getTime() < startDate.getTime()) {
      toast.warning("La fecha objetivo debe ser posterior a la fecha inicial.");
      return;
    }

    setIsSavingRelease(true);
    try {
      const releaseRef = editingRelease
        ? doc(db, "projects", projectId, "scrumReleases", editingRelease.id)
        : doc(collection(db, "projects", projectId, "scrumReleases"));
      const highestSequence = releases.reduce((highest, release) => {
        const match = String(release.releaseCode || "").match(/^REL-(\d+)$/i);
        return match ? Math.max(highest, Number(match[1])) : highest;
      }, 0);
      const payload: any = {
        name: releaseDraft.name.trim(),
        objective: releaseDraft.objective.trim(),
        startDate,
        targetDate,
        releaseCode: editingRelease?.releaseCode || `REL-${String(highestSequence + 1).padStart(3, "0")}`,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser?.uid || null,
      };
      if (editingRelease) {
        await updateDoc(releaseRef, payload);
      } else {
        payload.createdAt = serverTimestamp();
        payload.createdBy = currentUser?.uid || null;
        await setDoc(releaseRef, payload);
      }
      resetReleaseModal();
      toast.success(editingRelease ? "Release actualizado." : "Release creado. Ya puedes conectarle épicas.");
    } catch (error) {
      console.error("Error saving Scrum release:", error);
      toast.error("No se pudo guardar el Release.");
    } finally {
      setIsSavingRelease(false);
    }
  };

  const openGroupModal = (group: any | null = null, epicId = "") => {
    setEditingGroup(group);
    setGroupDraft(group ? {
      name: group.name || "",
      description: group.description || "",
      epicId: group.scrumEpicId || "",
    } : {
      ...EMPTY_GROUP_DRAFT,
      epicId: epicId || refinedEpics.find((epic) => epic.scrumReleaseId)?.id || "",
    });
    setIsGroupModalOpen(true);
  };

  const resetGroupModal = () => {
    setEditingGroup(null);
    setGroupDraft(EMPTY_GROUP_DRAFT);
    setIsGroupModalOpen(false);
  };

  const saveGroup = async () => {
    if (!canManage) return;
    if (!groupDraft.name.trim() || !groupDraft.epicId) {
      toast.warning("Completa el nombre y selecciona la épica del submódulo.");
      return;
    }
    const parentEpic = epicById.get(groupDraft.epicId);
    if (!parentEpic?.scrumReleaseId) {
      toast.warning("La épica debe pertenecer a un Release antes de crear el submódulo.");
      return;
    }

    setIsSavingGroup(true);
    try {
      const groupRef = editingGroup
        ? doc(db, "projects", projectId, "scrumGroups", editingGroup.id)
        : doc(collection(db, "projects", projectId, "scrumGroups"));
      const highestSequence = groups.reduce((highest, group) => {
        const match = String(group.submoduleCode || group.groupCode || "").match(/^(?:SUB|GRP)-(\d+)$/i);
        return match ? Math.max(highest, Number(match[1])) : highest;
      }, 0);
      const submoduleCode = editingGroup
        ? getSubmoduleCode(editingGroup)
        : `SUB-${String(highestSequence + 1).padStart(3, "0")}`;
      const payload: any = {
        name: groupDraft.name.trim(),
        description: groupDraft.description.trim(),
        scrumEpicId: parentEpic.id,
        scrumReleaseId: parentEpic.scrumReleaseId,
        groupCode: submoduleCode,
        submoduleCode,
        entityType: "scrum_submodule",
        updatedAt: serverTimestamp(),
        updatedBy: currentUser?.uid || null,
      };
      if (editingGroup) {
        await updateDoc(groupRef, payload);
        const affectedSprints = sprints.filter((sprint) => sprint.scrumGroupId === editingGroup.id);
        const affectedSprintIds = new Set(affectedSprints.map((sprint) => sprint.id));
        await Promise.all([
          ...affectedSprints.map((sprint) => updateDoc(doc(db, "projects", projectId, "sprints", sprint.id), {
            scrumEpicId: parentEpic.id,
            scrumReleaseId: parentEpic.scrumReleaseId,
            ...(sprint.snapshot ? {
              snapshot: {
                ...sprint.snapshot,
                scrumEpicId: parentEpic.id,
                scrumReleaseId: parentEpic.scrumReleaseId,
              },
            } : {}),
            updatedAt: serverTimestamp(),
          })),
          ...scrumItems
            .filter((item) => item.scrumGroupId === editingGroup.id || affectedSprintIds.has(item.sprintId))
            .map((item) => updateDoc(doc(db, "projects", projectId, "tasks", item.id), {
              scrumGroupId: editingGroup.id,
              scrumEpicId: parentEpic.id,
              scrumReleaseId: parentEpic.scrumReleaseId,
              updatedAt: serverTimestamp(),
            })),
        ]);
      } else {
        payload.createdAt = serverTimestamp();
        payload.createdBy = currentUser?.uid || null;
        await setDoc(groupRef, payload);
      }
      resetGroupModal();
      toast.success(editingGroup ? "Submódulo actualizado." : "Submódulo creado. Ya puedes agregarle historias y planificar sprints.");
    } catch (error) {
      console.error("Error saving Scrum submodule:", error);
      toast.error("No se pudo guardar el submódulo.");
    } finally {
      setIsSavingGroup(false);
    }
  };

  const deleteGroup = async (group: any) => {
    if (!canManage || !group?.id || isDeletingGroup) return;

    setIsDeletingGroup(true);
    try {
      // Read the current documents immediately before deleting so a stale screen
      // cannot hide a recently assigned story, task or sprint.
      const [taskSnapshot, sprintSnapshot, storySpecSnapshot] = await Promise.all([
        getDocs(collection(db, "projects", projectId, "tasks")),
        getDocs(collection(db, "projects", projectId, "sprints")),
        getDocs(collection(db, "projects", projectId, "userStories")),
      ]);
      const currentSprints = sprintSnapshot.docs
        .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }))
        .filter((sprint: any) => !sprint.deletedAt && sprint.scrumGroupId === group.id);
      const linkedSprintIds = new Set(currentSprints.map((sprint: any) => sprint.id));
      const currentItems = taskSnapshot.docs
        .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }))
        .filter((item: any) => {
          if (!isScrumTask(item) || item.deletedAt || item.scrumKind === "epic") return false;
          const submoduleIds = Array.isArray(item.scrumSubmoduleIds) ? item.scrumSubmoduleIds : [];
          return item.scrumGroupId === group.id || submoduleIds.includes(group.id) || linkedSprintIds.has(item.sprintId);
        });
      const currentItemIds = new Set(currentItems.map((item: any) => item.id));
      const unmirroredStorySpecs = storySpecSnapshot.docs
        .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }))
        .filter((spec: any) => {
          if (currentItemIds.has(spec.id)) return false;
          const impactedSubmoduleIds = Array.isArray(spec.impactedSubmoduleIds) ? spec.impactedSubmoduleIds : [];
          const legacySubmoduleIds = Array.isArray(spec.submoduleIds) ? spec.submoduleIds : [];
          return spec.primarySubmoduleId === group.id
            || impactedSubmoduleIds.includes(group.id)
            || legacySubmoduleIds.includes(group.id);
        });

      if (currentItems.length > 0 || currentSprints.length > 0 || unmirroredStorySpecs.length > 0) {
        const storyCount = currentItems.filter((item: any) => item.scrumKind === "story").length;
        const otherItemCount = currentItems.length - storyCount;
        const blockers = [
          storyCount ? `${storyCount} historia${storyCount === 1 ? "" : "s"}` : "",
          otherItemCount ? `${otherItemCount} tarea${otherItemCount === 1 ? "" : "s"}` : "",
          unmirroredStorySpecs.length ? `${unmirroredStorySpecs.length} expediente${unmirroredStorySpecs.length === 1 ? "" : "s"} de historia` : "",
          currentSprints.length ? `${currentSprints.length} sprint${currentSprints.length === 1 ? "" : "s"}` : "",
        ].filter(Boolean).join(", ");
        toast.error(`No se puede eliminar ${group.name || "el submódulo"}: todavía tiene ${blockers} vinculados. Reasigna esos elementos desde su edición y vuelve a intentarlo.`);
        return;
      }

      const confirmed = window.confirm(
        `¿Eliminar el submódulo ${group.name || getSubmoduleCode(group)}?\n\nNo tiene historias, tareas ni sprints activos vinculados. Se ocultará de la arquitectura y Pixel conservará la trazabilidad de quién lo eliminó.`,
      );
      if (!confirmed) return;

      const deletedAt = new Date();
      const actorId = currentUser?.uid || currentUser?.id || null;
      const actorEmail = currentUser?.email || null;
      const actorName = getMemberLabel(currentUser);
      const groupRef = doc(db, "projects", projectId, "scrumGroups", group.id);
      const batch = writeBatch(db);

      batch.update(groupRef, {
        deletedAt,
        deletedBy: actorId,
        deletedByEmail: actorEmail,
        deletedByName: actorName,
        deletionSnapshot: {
          name: group.name || null,
          description: group.description || null,
          submoduleCode: getSubmoduleCode(group),
          scrumEpicId: group.scrumEpicId || null,
          scrumReleaseId: group.scrumReleaseId || null,
        },
        lifecycleHistory: arrayUnion({
          action: "deleted",
          at: deletedAt,
          actorId,
          actorEmail,
          actorName,
          source: "scrum_submodule_deletion",
        }),
        updatedAt: deletedAt,
        updatedBy: actorId,
      });

      if (scrumMapLayout) {
        const removedNodeId = `group-${group.id}`;
        const nextPositions = Object.fromEntries(
          Object.entries(scrumMapLayout.positions || {}).filter(([nodeId]) => nodeId !== removedNodeId),
        );
        batch.update(doc(db, "projects", projectId, "scrumMapLayouts", "main"), {
          positions: nextPositions,
          updatedAt: deletedAt,
          updatedBy: actorId,
        });
      }

      await batch.commit();
      if (editingGroup?.id === group.id) resetGroupModal();
      toast.success("Submódulo eliminado. La trazabilidad quedó conservada.");
    } catch (error) {
      console.error("Error deleting Scrum submodule:", error);
      toast.error("No se pudo eliminar el submódulo.");
    } finally {
      setIsDeletingGroup(false);
    }
  };

  const openSprintModal = (sprint: any | null = null, groupId = "") => {
    const weeks = Math.max(1, Number(sprintLengthWeeks || 2));
    const start = new Date();
    const end = new Date(start.getTime() + weeks * 7 * 86400000 - 86400000);
    setEditingSprint(sprint);
    setSprintName(sprint?.name || `Sprint ${sprints.length + 1}`);
    setSprintGoal(sprint?.goal || "");
    setSprintStart(toInputDate(sprint?.startDate || start));
    setSprintEnd(toInputDate(sprint?.endDate || end));
    setSprintGroupId(sprint?.scrumGroupId || groupId || groups[0]?.id || "");
    setIsSprintModalOpen(true);
  };

  const resetSprintModal = () => {
    setEditingSprint(null);
    setSprintGroupId("");
    setIsSprintModalOpen(false);
  };

  const saveSprint = async () => {
    if (!canManage) return;
    if (!sprintName.trim() || !sprintStart || !sprintEnd || !sprintGroupId) {
      toast.warning("Completa el nombre, las fechas y el submódulo del sprint.");
      return;
    }
    const parentGroup = groupById.get(sprintGroupId);
    const parentEpic = epicById.get(parentGroup?.scrumEpicId);
    if (!parentGroup || !parentEpic?.scrumReleaseId) {
      toast.warning("El submódulo seleccionado debe estar conectado a una épica y a un Release.");
      return;
    }
    const startDate = new Date(`${sprintStart}T00:00:00`);
    const endDate = new Date(`${sprintEnd}T23:59:59`);
    if (endDate.getTime() < startDate.getTime()) {
      toast.warning("La fecha final debe ser posterior a la inicial.");
      return;
    }

    setIsSavingSprint(true);
    try {
      const sprintRef = editingSprint
        ? doc(db, "projects", projectId, "sprints", editingSprint.id)
        : doc(collection(db, "projects", projectId, "sprints"));
      const payload: any = {
        name: sprintName.trim(),
        goal: sprintGoal.trim(),
        startDate,
        endDate,
        scrumGroupId: parentGroup.id,
        scrumEpicId: parentEpic.id,
        scrumReleaseId: parentEpic.scrumReleaseId,
        status: editingSprint?.status || "planning",
        ...(editingSprint?.snapshot ? {
          snapshot: {
            ...editingSprint.snapshot,
            scrumReleaseId: parentEpic.scrumReleaseId,
            scrumEpicId: parentEpic.id,
            scrumGroupId: parentGroup.id,
          },
        } : {}),
        updatedAt: serverTimestamp(),
        updatedBy: currentUser?.uid || null,
      };
      if (editingSprint) {
        await updateDoc(sprintRef, payload);
        const sprintItems = scrumItems.filter((item) => item.sprintId === editingSprint.id);
        await Promise.all(sprintItems.map((item) => updateDoc(doc(db, "projects", projectId, "tasks", item.id), {
          scrumGroupId: parentGroup.id,
          scrumEpicId: parentEpic.id,
          scrumReleaseId: parentEpic.scrumReleaseId,
          updatedAt: serverTimestamp(),
        })));
      } else {
        payload.createdAt = serverTimestamp();
        payload.createdBy = currentUser?.uid || null;
        await setDoc(sprintRef, payload);
      }
      setSelectedSprintId(sprintRef.id);
      resetSprintModal();
      toast.success(editingSprint ? "Sprint actualizado." : "Sprint creado y listo para planificar.");
    } catch (error) {
      console.error("Error creating sprint:", error);
      toast.error("No se pudo crear el sprint.");
    } finally {
      setIsSavingSprint(false);
    }
  };

  const startSprint = async (sprint: any) => {
    if (!canManageLifecycle) return;
    if (getSprintStatus(sprint) !== "planning") {
      toast.info("Solo los sprints en planificación se pueden iniciar.");
      return;
    }
    if (!sprint.scrumGroupId) {
      toast.warning("Asigna este sprint a un submódulo antes de iniciarlo.");
      openSprintModal(sprint);
      return;
    }
    try {
      await updateDoc(doc(db, "projects", projectId, "sprints", sprint.id), {
        status: "active",
        startedAt: serverTimestamp(),
        startedBy: currentUser?.uid || null,
        lifecycleHistory: arrayUnion({
          action: "started",
          at: new Date(),
          actorId: currentUser?.uid || null,
          actorEmail: currentUser?.email || null,
        }),
        updatedAt: serverTimestamp(),
      });
      setSelectedSprintId(sprint.id);
      toast.success("Sprint iniciado.");
    } catch (error) {
      console.error("Error starting sprint:", error);
      toast.error("No se pudo iniciar el sprint.");
    }
  };

  const closeSprint = async (sprint: any) => {
    if (!canManageLifecycle) return;
    if (getSprintStatus(sprint) !== "active") {
      toast.info("Únicamente se pueden cerrar sprints que estén activos.");
      return;
    }
    const sprintItems = scrumItems.filter((item) => item.sprintId === sprint.id && item.scrumKind !== "epic");
    const doneItems = sprintItems.filter((item) => normalizeScrumStatus(item.scrumStatus) === "done");
    const incompleteItems = sprintItems.filter((item) => normalizeScrumStatus(item.scrumStatus) !== "done");
    const confirmed = window.confirm(
      `Se cerrará ${sprint.name}. ${doneItems.length} elementos quedarán terminados y ${incompleteItems.length} regresarán al backlog.`,
    );
    if (!confirmed) return;

    try {
      await Promise.all(
        incompleteItems.map((item) =>
          updateDoc(doc(db, "projects", projectId, "tasks", item.id), {
            sprintId: null,
            scrumGroupId: sprint.scrumGroupId || item.scrumGroupId || null,
            scrumStatus: "backlog",
            scrumRefinementStatus: "refined",
            status: "todo",
            progress: 0,
            updatedAt: serverTimestamp(),
          }),
        ),
      );
      const committedPoints = sprintItems.reduce((sum, item) => sum + Number(item.storyPoints || 0), 0);
      const completedPoints = doneItems.reduce((sum, item) => sum + Number(item.storyPoints || 0), 0);
      await updateDoc(doc(db, "projects", projectId, "sprints", sprint.id), {
        status: "completed",
        completedAt: serverTimestamp(),
        completedBy: currentUser?.uid || null,
        lifecycleHistory: arrayUnion({
          action: "completed",
          at: new Date(),
          actorId: currentUser?.uid || null,
          actorEmail: currentUser?.email || null,
          committedItems: sprintItems.length,
          completedItems: doneItems.length,
        }),
        snapshot: {
          itemIds: sprintItems.map((item) => item.id),
          completedItemIds: doneItems.map((item) => item.id),
          incompleteItemIds: incompleteItems.map((item) => item.id),
          committedPoints,
          completedPoints,
          itemCount: sprintItems.length,
          completedCount: doneItems.length,
          scrumReleaseId: sprint.scrumReleaseId || null,
          scrumEpicId: sprint.scrumEpicId || null,
          scrumGroupId: sprint.scrumGroupId || null,
        },
        updatedAt: serverTimestamp(),
      });
      toast.success("Sprint cerrado con fotografía histórica.");
    } catch (error) {
      console.error("Error closing sprint:", error);
      toast.error("No se pudo cerrar el sprint.");
    }
  };

  const saveSettings = async () => {
    if (!canManage) return;
    setIsSavingSettings(true);
    try {
      await updateDoc(doc(db, "projects", projectId), {
        projectMode: "software_scrum",
        scrumSettings: {
          ...(project?.scrumSettings || {}),
          productGoal: productGoal.trim(),
          sprintLengthWeeks: Math.max(1, Math.min(8, Number(sprintLengthWeeks || 2))),
          pointScale: SCRUM_POINT_SCALE,
          updatedAt: new Date().toISOString(),
        },
        updatedAt: serverTimestamp(),
      });
      toast.success("Configuración Scrum actualizada.");
    } catch (error) {
      console.error("Error saving scrum settings:", error);
      toast.error("No se pudo guardar la configuración.");
    } finally {
      setIsSavingSettings(false);
    }
  };

  const toggleTaskTypeEntry = async (entry: ScrumStoryCatalogEntry) => {
    if (!canManage || updatingTaskTypeEntryId) return;
    setUpdatingTaskTypeEntryId(entry.id);
    try {
      await setScrumStoryCatalogEntryActive({ projectId, entry, active: !entry.active, actor: currentUser });
      toast.success(entry.active ? "Tipo de tarea desactivado." : "Tipo de tarea activado.");
    } catch (error: any) {
      console.error("Error updating task type domain:", error);
      toast.error(error?.message || "No se pudo actualizar el tipo de tarea.");
    } finally {
      setUpdatingTaskTypeEntryId("");
    }
  };

  const moveTaskTypeEntry = async (entry: ScrumStoryCatalogEntry, direction: -1 | 1) => {
    if (!canManage || updatingTaskTypeEntryId) return;
    const currentIndex = configurableTaskTypeEntries.findIndex((candidate) => candidate.id === entry.id);
    const target = configurableTaskTypeEntries[currentIndex + direction];
    if (currentIndex < 0 || !target) return;
    setUpdatingTaskTypeEntryId(entry.id);
    try {
      await Promise.all([
        setScrumStoryCatalogEntrySortOrder({ projectId, entry, sortOrder: Number(target.sortOrder ?? (currentIndex + direction + 1) * 100), actor: currentUser }),
        setScrumStoryCatalogEntrySortOrder({ projectId, entry: target, sortOrder: Number(entry.sortOrder ?? (currentIndex + 1) * 100), actor: currentUser }),
      ]);
      toast.success("Orden de tipos actualizado.");
    } catch (error: any) {
      console.error("Error reordering task type domains:", error);
      toast.error(error?.message || "No se pudo cambiar el orden de los tipos.");
    } finally {
      setUpdatingTaskTypeEntryId("");
    }
  };

  const saveScrumMapLayout = async (layout: ScrumMapLayoutInput) => {
    if (!canManage) return;
    try {
      await setDoc(doc(db, "projects", projectId, "scrumMapLayouts", "main"), {
        ...layout,
        schemaVersion: 1,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser?.uid || currentUser?.id || null,
        updatedByEmail: currentUser?.email || null,
      }, { merge: true });
      toast.success("Vista del mapa guardada para el equipo.");
    } catch (error) {
      console.error("Error saving Scrum map layout:", error);
      toast.error("No se pudo guardar la vista del mapa.");
      throw error;
    }
  };

  const navItems: Array<{ id: ScrumView; label: string; icon: React.ReactNode }> = [
    { id: "structure", label: "Mapa de control", icon: <Network size={15} /> },
    { id: "stories", label: "Historias de usuario", icon: <BookOpen size={15} /> },
    { id: "backlog", label: "Backlog", icon: <ListTodo size={15} /> },
    { id: "overview", label: "Indicadores", icon: <Activity size={15} /> },
    { id: "sprints", label: "Sprints", icon: <CalendarDays size={15} /> },
    { id: "board", label: "Tablero", icon: <Layers3 size={15} /> },
    { id: "github", label: "GitHub", icon: <Code2 size={15} /> },
    { id: "settings", label: "Configuración", icon: <Settings2 size={15} /> },
  ];

  const renderWorkCard = (
    item: any,
    options: { compact?: boolean; showSprintAction?: boolean; showGroomingAction?: boolean } = {},
  ) => {
    const assigneeIds = getItemAssigneeIds(item);
    const itemKind = (item.scrumKind || "story") as ScrumItemKind;
    const status = normalizeScrumStatus(item.scrumStatus);
    const executionMode = getScrumExecutionMode(item);
    return (
      <article
        key={item.id}
        onClick={() => setSelectedItemId(item.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") setSelectedItemId(item.id);
        }}
        role="button"
        tabIndex={0}
        className={`group min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:border-indigo-200 hover:shadow-md ${
          options.compact ? "cursor-pointer p-3" : "cursor-pointer p-4"
        }`}
      >
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`max-w-full truncate rounded px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.1em] ${KIND_STYLE[itemKind]}`}>
                {getScrumTaskTypeLabel(item)}
              </span>
              <span className="max-w-full truncate text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">
                {item.scrumCode || item.id.slice(0, 8)}
              </span>
              {itemKind !== "epic" && (
                <span className={`inline-flex max-w-full items-center gap-1 rounded px-2 py-0.5 text-[10px] font-black ${executionMode === "manual" ? "bg-cyan-50 text-cyan-800" : "bg-slate-950 text-white"}`}>
                  {executionMode === "manual" ? <Inbox size={11} className="shrink-0" /> : <Code2 size={11} className="shrink-0" />}
                  <span className="truncate">{executionMode === "manual" ? "Manual · Bandeja" : "GitHub · Automático"}</span>
                </span>
              )}
              {item.module && (
                <span title={item.module} className="max-w-full truncate rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                  {item.module}
                </span>
              )}
              {item.githubLastEvidenceKind && (
                <span className="max-w-full truncate rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                  GitHub · {item.githubLastEvidenceKind === "pull_request" ? "PR" : item.githubLastEvidenceKind}
                </span>
              )}
              {item.githubMainPullRequest?.number && (
                <a
                  href={item.githubMainPullRequest.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => event.stopPropagation()}
                  className="max-w-full truncate rounded bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700 hover:bg-violet-100"
                >
                  PR #{item.githubMainPullRequest.number}{item.githubMainPullRequest.merged ? " · integrado" : ""}
                </a>
              )}
            </div>
            <h4 className="mt-2 line-clamp-2 break-words text-sm font-black leading-5 text-slate-950">{getItemTitle(item)}</h4>
            {status === "validation" && (
              <p className="mt-2 rounded-lg border border-cyan-200 bg-cyan-50 px-2 py-1.5 text-[10px] font-black text-cyan-800">
                Abre esta tarjeta para revisar los criterios de aceptación.
              </p>
            )}
            {!options.compact && item.description && (
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{item.description}</p>
            )}
          </div>
          {itemKind !== "epic" && (
            <span className="flex h-8 min-w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 px-2 text-xs font-black text-indigo-700 ring-1 ring-indigo-100">
              {Number(item.storyPoints || 0)} pts
            </span>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex -space-x-2">
              {assigneeIds.slice(0, 3).map((memberId) => {
                const member = getMember(memberId);
                return member ? <MemberAvatar key={memberId} member={member} /> : null;
              })}
              {assigneeIds.length === 0 && (
                <div className="flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-slate-300 bg-slate-50 text-slate-400">
                  <Users size={12} />
                </div>
              )}
            </div>
            <span className="truncate text-[11px] font-bold text-slate-500">
              {assigneeIds.length === 0
                ? "Sin responsable"
                : assigneeIds.length === 1
                  ? getMemberLabel(getMember(assigneeIds[0]))
                  : `${assigneeIds.length} responsables`}
            </span>
          </div>
          {!options.compact && (
            <span className={`rounded-md border px-2 py-1 text-[10px] font-black ${STATUS_STYLE[status]}`}>
              {getScrumStatusLabel(status)}
            </span>
          )}
        </div>

        {!options.compact && (
          <div className="mt-3 flex min-w-0 flex-col items-stretch gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-2 text-[11px] font-bold text-slate-400">
              <Flag size={13} />
              {priorityLabel(item.priority)}
              {item.scrumEpicId && epics.find((epic) => epic.id === item.scrumEpicId) && (
                <span className="max-w-48 truncate text-violet-600">
                  · {getItemTitle(epics.find((epic) => epic.id === item.scrumEpicId))}
                </span>
              )}
              {item.scrumGroupId && groupById.get(item.scrumGroupId) && (
                <span className="max-w-40 truncate text-cyan-700">
                  · {groupById.get(item.scrumGroupId)?.name}
                </span>
              )}
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-1 sm:justify-end">
              {options.showGroomingAction && canManage && (
                <Button
                  type="button"
                  size="sm"
                  onClick={(event) => {
                    event.stopPropagation();
                    promoteFromGrooming(item);
                  }}
                  className="h-8 bg-amber-500 text-xs font-black text-white hover:bg-amber-600"
                >
                  <Sparkles size={13} className="mr-1.5" />
                  {item.scrumKind === "epic" ? "Promover épica" : item.scrumEpicId ? "Completar grooming" : "Asignar épica"}
                </Button>
              )}
              {options.showSprintAction && selectedSprint && canManage && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={(event) => {
                    event.stopPropagation();
                    assignItemToSprint(item, selectedSprint.id);
                  }}
                  title={`Agregar a ${selectedSprint.name}`}
                  className="h-8 max-w-full min-w-0 border-indigo-100 text-xs text-indigo-700 hover:bg-indigo-50"
                >
                  <span className="truncate">Agregar a {selectedSprint.name}</span>
                </Button>
              )}
              {canManage && (
                <>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      openEditItem(item);
                    }}
                    className="rounded-md p-2 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-700"
                    title="Editar"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      deleteWorkItem(item);
                    }}
                    className="rounded-md p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                    title="Eliminar"
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </article>
    );
  };

  return (
    <div className="min-w-0 max-w-full space-y-5">
      <section className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
        <div className="flex min-w-0 flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <nav aria-label="Secciones de Scrum" className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setView(item.id)}
                className={`inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 text-xs font-black transition ${
                  view === item.id
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>

          <div className="flex min-w-0 flex-wrap gap-2 border-t border-slate-100 pt-2 xl:shrink-0 xl:border-l xl:border-t-0 xl:pl-2 xl:pt-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={downloadMyWorkReport}
              disabled={myWorkItems.length === 0}
              className="min-w-0 flex-1 font-bold text-slate-700 sm:flex-none"
            >
              <ClipboardList size={15} className="mr-2" /> Mi plan
            </Button>
            {canCreateItems && (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setView("backlog");
                  openCreateItem({ sprintId: "" });
                }}
                className="min-w-0 flex-1 bg-indigo-600 font-bold text-white hover:bg-indigo-700 sm:flex-none"
              >
                <Plus size={15} className="mr-2" /> Crear en backlog
              </Button>
            )}
            {canManage && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => openSprintModal()}
                disabled={groups.length === 0}
                className="min-w-0 flex-1 border-cyan-200 font-bold text-cyan-800 hover:bg-cyan-50 sm:flex-none"
              >
                <CalendarDays size={15} className="mr-2" /> Planificar sprint
              </Button>
            )}
          </div>
        </div>
      </section>

      {view === "overview" && (
        <ProjectScrumControlCenter
          project={project}
          releases={releases}
          groups={groups}
          epics={epics}
          sprints={sprints}
          items={scrumItems}
          now={clock}
          canManageLifecycle={canManageLifecycle}
          onOpenSprint={(sprint) => {
            setSelectedSprintId(sprint.id);
            setView("board");
          }}
          onStartSprint={startSprint}
          onCloseSprint={closeSprint}
          onOpenArchitecture={() => setView("structure")}
        />
      )}

      {view === "stories" && (
        <ProjectUserStories
          projectId={projectId}
          project={project}
          stories={userStories}
          releases={releases}
          epics={refinedEpics}
          groups={groups}
          sprints={sprints}
          members={teamMembers}
          currentUser={currentUser}
          canManage={canManage}
          canCreateItems={canCreateItems}
          canViewDocuments={canViewDocuments}
          canUploadDocuments={canUploadDocuments}
          canManageDocumentAccess={canManageDocumentAccess}
          canDeleteDocuments={canDeleteDocuments}
          focusedStoryId={focusedStoryId}
          onCreateStory={() => openCreateItem({
            kind: "story",
            sprintId: "",
            refinementStatus: "refined",
          })}
          onOpenCore={openEditItem}
        />
      )}

      {view === "backlog" && (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <h3 className="text-xl font-black text-slate-950">Backlog de producto</h3>
                <p className="mt-1 text-sm text-slate-500">Las ideas esperan grooming aquí. Al completarlo, las historias pasan a su expediente independiente y los demás ítems quedan listos para planificar.</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {canCreateItems && (
                  <>
                    <Button type="button" variant="outline" onClick={() => openCreateItem({ kind: "epic", sprintId: "", storyPoints: "0" })} className="border-violet-200 font-bold text-violet-700 hover:bg-violet-50">
                      <Layers3 size={15} className="mr-2" /> Nueva épica
                    </Button>
                    <Button type="button" onClick={() => openCreateItem({ kind: "story", sprintId: "" })} className="bg-indigo-600 font-bold text-white hover:bg-indigo-700">
                      <Plus size={15} className="mr-2" /> Nuevo trabajo
                    </Button>
                  </>
                )}
                <div className="relative min-w-64">
                  <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Buscar código, módulo o trabajo..."
                    className="h-10 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                  />
                </div>
                <select
                  value={kindFilter}
                  onChange={(event) => setKindFilter(event.target.value)}
                  className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 outline-none focus:border-indigo-500"
                >
                  <option value="all">Todos los tipos</option>
                  <option value="__epic__">Épicas</option>
                  {taskTypeFilterOptions.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <div className="grid gap-5 p-5 xl:grid-cols-2">
            <div className="overflow-hidden rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50/70">
              <div className="flex items-center justify-between gap-3 border-b border-amber-200 px-4 py-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-amber-700">Estacionamiento</p>
                  <h4 className="mt-0.5 font-black text-slate-950">En grooming</h4>
                  <p className="mt-0.5 text-xs text-amber-800">Épicas e historias que todavía necesitan contexto, criterios o relación.</p>
                </div>
                <span className="rounded-full bg-amber-500 px-2.5 py-1 text-xs font-black text-white">{groomingItems.length}</span>
              </div>
              <div className="space-y-3 p-4">
                {groomingItems.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-amber-200 bg-white/70 py-10 text-center">
                    <Sparkles className="mx-auto text-amber-300" size={32} />
                    <h4 className="mt-3 font-black text-slate-900">Nada espera grooming</h4>
                    <p className="mt-1 text-xs text-slate-500">Todo el trabajo está organizado o listo para planificar.</p>
                  </div>
                ) : (
                  groomingItems.map((item) => renderWorkCard(item, { showGroomingAction: true }))
                )}
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50/40">
              <div className="flex items-center justify-between gap-3 border-b border-emerald-200 px-4 py-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-700">Preparado</p>
                  <h4 className="mt-0.5 font-black text-slate-950">Backlog refinado</h4>
                  <p className="mt-0.5 text-xs text-emerald-800">Bugs, tareas técnicas e investigaciones ya refinadas y disponibles para un sprint.</p>
                </div>
                <span className="rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-black text-white">{backlogItems.length}</span>
              </div>
              <div className="space-y-3 p-4">
                {backlogItems.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-emerald-200 bg-white/70 py-10 text-center">
                    <BookOpen className="mx-auto text-emerald-300" size={32} />
                    <h4 className="mt-3 font-black text-slate-900">Sin otros ítems refinados</h4>
                    <p className="mt-1 text-xs text-slate-500">Las historias refinadas se consultan y especifican en la pestaña Historias.</p>
                    <Button type="button" size="sm" variant="outline" onClick={() => setView("stories")} className="mt-3 border-emerald-200 font-bold text-emerald-700 hover:bg-emerald-50">
                      <BookOpen size={13} className="mr-1.5" /> Ver historias
                    </Button>
                  </div>
                ) : (
                  backlogItems.map((item) => renderWorkCard(item, { showSprintAction: true }))
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {view === "structure" && (
        <ProjectScrumMap
          project={project}
          items={scrumItems}
          releases={releases}
          groups={groups}
          epics={epics}
          sprints={sprints}
          members={teamMembers}
          canManage={canManage}
          canCreateItems={canCreateItems}
          canManageLifecycle={canManageLifecycle}
          layout={scrumMapLayout}
          onSaveLayout={saveScrumMapLayout}
          onOpenBacklog={() => setView("backlog")}
          onCreateRelease={() => openReleaseModal()}
          onEditRelease={(release) => openReleaseModal(release)}
          onCreateEpic={(releaseId) => openCreateItem({ kind: "epic", releaseId, sprintId: "", storyPoints: "0" })}
          onCreateGroup={(epicId) => openGroupModal(null, epicId)}
          onEditGroup={(group) => openGroupModal(group)}
          onDeleteGroup={deleteGroup}
          onCreateStory={({ releaseId, epicId, groupId }) => openCreateItem({
            kind: "story",
            releaseId,
            epicId,
            groupId,
            sprintId: "",
            refinementStatus: "refined",
          })}
          onCreateSprint={(groupId) => openSprintModal(null, groupId)}
          onEditSprint={(sprint) => openSprintModal(sprint)}
          onStartSprint={startSprint}
          onCloseSprint={closeSprint}
          onDeleteSprint={deleteSprint}
          onOpenItem={(item) => {
            if (item.scrumKind === "story" && isRefined(item)) {
              setFocusedStoryId(item.id);
              setView("stories");
            } else {
              setSelectedItemId(item.id);
            }
          }}
          onOpenSprint={(sprint) => {
            setSelectedSprintId(sprint.id);
            setView("board");
          }}
        />
      )}

      {view === "board" && (
        <section className="min-w-0 max-w-full space-y-4">
          <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-indigo-600">Tablero del sprint</p>
              <h3 className="mt-1 break-words text-xl font-black text-slate-950">{selectedSprint?.name || "Sin sprint seleccionado"}</h3>
              <p className="mt-1 break-words text-sm text-slate-500">{selectedSprint?.goal || "Selecciona o crea un sprint."}</p>
              {selectedSprint && (
                <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-bold">
                  <span className="rounded bg-indigo-50 px-2 py-1 text-indigo-700">{releaseById.get(selectedSprint.scrumReleaseId)?.name || "Release pendiente"}</span>
                  <span className="rounded bg-violet-50 px-2 py-1 text-violet-700">{epicById.get(selectedSprint.scrumEpicId)?.title || epicById.get(selectedSprint.scrumEpicId)?.name || "Épica pendiente"}</span>
                  <span className="rounded bg-cyan-50 px-2 py-1 text-cyan-800">{groupById.get(selectedSprint.scrumGroupId)?.name || "Submódulo pendiente"}</span>
                </div>
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <select
                value={selectedSprint?.id || ""}
                onChange={(event) => setSelectedSprintId(event.target.value)}
                className="h-10 min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-indigo-500 sm:min-w-60"
              >
                <option value="">Seleccionar sprint</option>
                {sprints.map((sprint) => (
                  <option key={sprint.id} value={sprint.id}>{sprint.name} · {getSprintStatus(sprint) === "active" ? "Activo" : getSprintStatus(sprint) === "completed" ? "Cerrado" : "Planificación"}</option>
                ))}
              </select>
              {selectedSprint && canCreateItems && getSprintStatus(selectedSprint) !== "completed" && (
                <Button type="button" variant="outline" onClick={() => openCreateItem({ kind: "story", sprintId: selectedSprint.id })} className="font-bold"><Plus size={14} className="mr-1" /> Nueva tarea</Button>
              )}
              {selectedSprint && canManageLifecycle && getSprintStatus(selectedSprint) === "planning" && (
                <Button type="button" onClick={() => startSprint(selectedSprint)} className="bg-emerald-600 font-bold text-white hover:bg-emerald-700"><PlayCircle size={14} className="mr-1" /> Iniciar</Button>
              )}
              {selectedSprint && canManageLifecycle && getSprintStatus(selectedSprint) === "active" && (
                <Button type="button" onClick={() => closeSprint(selectedSprint)} className="bg-slate-950 font-bold text-white hover:bg-slate-800">Cerrar sprint</Button>
              )}
            </div>
          </div>
          <div className="max-w-full snap-x snap-mandatory overflow-x-auto pb-3">
            <div className="grid min-w-max grid-flow-col auto-cols-[minmax(260px,290px)] gap-3 pr-1">
            {SCRUM_WORK_STATUSES.map((column) => {
              const columnItems = selectedSprintItems.filter(
                (item) => normalizeScrumStatus(item.scrumStatus) === column.value,
              );
              return (
                <div
                  key={column.value}
                  className="min-w-0 snap-start rounded-2xl border border-slate-200 bg-slate-50/80 p-3"
                >
                  <div className="mb-3 flex items-center justify-between gap-2 px-1">
                    <div className="flex items-center gap-2">
                      <CircleDot size={13} className="text-indigo-500" />
                      <span className="text-xs font-black uppercase tracking-[0.1em] text-slate-600">{column.label}</span>
                    </div>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-slate-500 ring-1 ring-slate-200">
                      {columnItems.length}
                    </span>
                  </div>
                  <div className="min-h-32 space-y-2">
                    {columnItems.map((item) => renderWorkCard(item, { compact: true }))}
                    {columnItems.length === 0 && (
                      <div className="flex min-h-24 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white/60 px-3 text-center text-xs text-slate-400">
                        Sin tareas en esta etapa
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            </div>
          </div>
        </section>
      )}

      {view === "sprints" && (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-5">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xl font-black text-slate-950">Ciclos de entrega</h3>
                <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-emerald-700">
                  Ejecución paralela habilitada
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-500">Planifica e inicia varios sprints simultáneamente y conserva el histórico independiente de cada uno.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canCreateItems && (
                <Button type="button" variant="outline" onClick={() => openCreateItem({ kind: "story", sprintId: "" })} className="font-bold">
                  <ListTodo size={15} className="mr-2" /> Crear en backlog
                </Button>
              )}
              {canManage && (
                <Button type="button" onClick={() => openSprintModal()} disabled={groups.length === 0} className="bg-indigo-600 font-bold text-white hover:bg-indigo-700">
                  <Plus size={16} className="mr-2" /> Crear sprint
                </Button>
              )}
            </div>
          </div>
          <div className="space-y-3 p-5">
            {sprintsLoading ? (
              <div className="flex min-h-32 items-center justify-center gap-2 text-sm font-semibold text-slate-500">
                <Loader2 size={18} className="animate-spin text-indigo-500" /> Cargando sprints...
              </div>
            ) : sprints.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-500">
                Crea el primer sprint para comenzar la planificación.
              </div>
            ) : (
              sprints.map((sprint) => {
                const sprintItems = scrumItems
                  .filter((item) => item.sprintId === sprint.id && item.scrumKind !== "epic")
                  .sort((left, right) => {
                    const priorityDifference = (PRIORITY_WEIGHT[left.priority] ?? 9) - (PRIORITY_WEIGHT[right.priority] ?? 9);
                    if (priorityDifference !== 0) return priorityDifference;
                    return Number(left.scrumRank || left.displayOrder || 0) - Number(right.scrumRank || right.displayOrder || 0);
                  });
                const done = sprintItems.filter((item) => normalizeScrumStatus(item.scrumStatus) === "done");
                const committed = sprint.snapshot?.committedPoints ?? sprintItems.reduce((sum, item) => sum + Number(item.storyPoints || 0), 0);
                const completed = sprint.snapshot?.completedPoints ?? done.reduce((sum, item) => sum + Number(item.storyPoints || 0), 0);
                const status = getSprintStatus(sprint);
                const sprintMetrics = getSprintMetrics(sprint, sprintItems);
                const parentGroup = groupById.get(sprint.scrumGroupId);
                const parentEpic = epicById.get(sprint.scrumEpicId || parentGroup?.scrumEpicId);
                const parentRelease = releaseById.get(sprint.scrumReleaseId || parentGroup?.scrumReleaseId || parentEpic?.scrumReleaseId);
                const compatibleUnplannedItems = unplannedItems.filter((item) => item.scrumEpicId === parentEpic?.id);
                return (
                  <article key={sprint.id} className="min-w-0 overflow-hidden rounded-xl border border-slate-200 p-4 transition hover:border-indigo-200">
                    <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${
                            status === "active"
                              ? "bg-emerald-100 text-emerald-700"
                              : status === "completed"
                                ? "bg-slate-200 text-slate-700"
                                : "bg-indigo-100 text-indigo-700"
                          }`}>
                            {status === "active" ? "Activo" : status === "completed" ? "Cerrado" : "Planificación"}
                          </span>
                          <h4 className="break-words text-lg font-black text-slate-950">{sprint.name}</h4>
                          {status === "active" && (
                            <span className={`rounded px-2 py-1 text-[10px] font-black ${formatSprintCountdown(sprint.endDate, clock).startsWith("Vencido") ? "bg-rose-100 text-rose-700" : "bg-cyan-100 text-cyan-800"}`}>
                              {formatSprintCountdown(sprint.endDate, clock)}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 line-clamp-1 text-sm text-slate-500">{sprint.goal || "Sin objetivo definido"}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5 text-[9px] font-bold">
                          <span className="rounded bg-indigo-50 px-2 py-1 text-indigo-700">{parentRelease?.name || "Release pendiente"}</span>
                          <span className="rounded bg-violet-50 px-2 py-1 text-violet-700">{parentEpic ? getItemTitle(parentEpic) : "Épica pendiente"}</span>
                          <span className="rounded bg-cyan-50 px-2 py-1 text-cyan-800">{parentGroup?.name || "Submódulo pendiente"}</span>
                        </div>
                        <p className="mt-2 text-xs font-bold text-slate-400">
                          {formatDate(sprint.startDate)} — {formatDate(sprint.endDate)}
                        </p>
                      </div>
                      <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4">
                        <div className="rounded-lg bg-slate-50 px-3 py-2 text-center">
                          <p className="text-[9px] font-black uppercase tracking-[0.1em] text-slate-400">Elementos</p>
                          <p className="text-lg font-black text-slate-900">{sprint.snapshot?.itemCount ?? sprintItems.length}</p>
                        </div>
                        <div className="rounded-lg bg-indigo-50 px-3 py-2 text-center">
                          <p className="text-[9px] font-black uppercase tracking-[0.1em] text-indigo-400">Puntos</p>
                          <p className="text-lg font-black text-indigo-700">{committed}</p>
                        </div>
                        <div className="rounded-lg bg-emerald-50 px-3 py-2 text-center">
                          <p className="text-[9px] font-black uppercase tracking-[0.1em] text-emerald-500">Hechos</p>
                          <p className="text-lg font-black text-emerald-700">{completed}</p>
                        </div>
                        <div className="rounded-lg bg-cyan-50 px-3 py-2 text-center">
                          <p className="text-[9px] font-black uppercase tracking-[0.1em] text-cyan-600">Avance</p>
                          <p className="font-mono text-lg font-black text-cyan-800">{sprintMetrics.progress}%</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedSprintId(sprint.id);
                            setView("board");
                          }}
                        >
                          Ver tablero <ChevronRight size={14} className="ml-1" />
                        </Button>
                        {canManageLifecycle && status === "planning" && (
                          <Button type="button" size="sm" onClick={() => startSprint(sprint)} className="bg-emerald-600 text-white hover:bg-emerald-700">
                            Iniciar
                          </Button>
                        )}
                        {canManageLifecycle && status === "active" && (
                          <Button type="button" size="sm" onClick={() => closeSprint(sprint)} className="bg-slate-950 text-white hover:bg-slate-800">
                            Cerrar
                          </Button>
                        )}
                        {canManage && (
                          <>
                            {status !== "completed" && (
                              <button type="button" onClick={() => openSprintModal(sprint)} className="rounded-lg border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50 hover:text-indigo-700" title="Editar sprint"><Pencil size={15} /></button>
                            )}
                            <button type="button" onClick={() => deleteSprint(sprint)} className="rounded-lg border border-red-200 p-2 text-red-600 transition hover:bg-red-50" title={status === "completed" ? "Eliminar sprint terminado" : "Eliminar sprint"}><Trash2 size={15} /></button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="mt-4 border-t border-slate-100 pt-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-indigo-600">Alcance comprometido</p>
                          <p className="mt-1 text-xs text-slate-500">El orden combina prioridad y posición dentro del sprint.</p>
                        </div>
                        {canCreateItems && status !== "completed" && (
                          <Button type="button" size="sm" variant="outline" onClick={() => openCreateItem({ kind: "story", sprintId: sprint.id })} className="font-bold">
                            <Plus size={14} className="mr-1" /> Crear trabajo en este sprint
                          </Button>
                        )}
                      </div>

                      {canManage && status !== "completed" && compatibleUnplannedItems.length > 0 && (
                        <div className="mt-3 flex flex-col gap-2 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 sm:flex-row sm:items-center">
                          <select
                            value={sprintCandidateById[sprint.id] || ""}
                            onChange={(event) => setSprintCandidateById((current) => ({ ...current, [sprint.id]: event.target.value }))}
                            className="h-10 min-w-0 flex-1 rounded-lg border border-indigo-200 bg-white px-3 text-xs font-semibold outline-none focus:border-indigo-500"
                          >
                            <option value="">Selecciona trabajo existente del backlog...</option>
                            {compatibleUnplannedItems.map((item) => <option key={item.id} value={item.id}>{item.scrumCode} · {getItemTitle(item)} · {priorityLabel(item.priority)}</option>)}
                          </select>
                          <Button
                            type="button"
                            size="sm"
                            disabled={!sprintCandidateById[sprint.id]}
                            onClick={() => {
                              const item = compatibleUnplannedItems.find((candidate) => candidate.id === sprintCandidateById[sprint.id]);
                              if (item) assignItemToSprint(item, sprint.id);
                              setSprintCandidateById((current) => ({ ...current, [sprint.id]: "" }));
                            }}
                            className="h-10 bg-indigo-600 font-bold text-white hover:bg-indigo-700"
                          >
                            Agregar del backlog
                          </Button>
                        </div>
                      )}

                      <div className="mt-3 space-y-2">
                        {sprintItems.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-slate-200 p-5 text-center text-xs text-slate-500">Este sprint todavía no tiene trabajo. Créalo aquí o agrégalo desde el backlog.</div>
                        ) : sprintItems.map((item, itemIndex) => (
                          <div key={item.id} className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3 sm:flex-row sm:items-center">
                            <button type="button" onClick={() => setSelectedItemId(item.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-950 text-xs font-black text-white">{itemIndex + 1}</span>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2 text-[9px] font-black uppercase tracking-wide">
                                  <span className="text-indigo-600">{item.scrumCode}</span>
                                  <span className={getScrumExecutionMode(item) === "manual" ? "text-cyan-700" : "text-violet-700"}>
                                    {getScrumExecutionMode(item) === "manual" ? "Bandeja" : "GitHub"}
                                  </span>
                                  <span className="text-amber-600">{priorityLabel(item.priority)}</span>
                                  <span className="text-slate-400">{Number(item.storyPoints || 0)} pts</span>
                                </div>
                                <p title={getItemTitle(item)} className="mt-1 line-clamp-2 break-words text-xs font-black text-slate-900">{getItemTitle(item)}</p>
                              </div>
                            </button>
                            <div className="flex items-center justify-between gap-2 sm:justify-end">
                              <span className={`rounded-md border px-2 py-1 text-[9px] font-black ${STATUS_STYLE[normalizeScrumStatus(item.scrumStatus)]}`}>{getScrumStatusLabel(item.scrumStatus)}</span>
                              {canManage && status !== "completed" && (
                                <button type="button" onClick={() => assignItemToSprint(item, null)} className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-red-600" title="Devolver al backlog">
                                  <X size={14} />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>
      )}

      {view === "settings" && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="max-w-3xl">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-indigo-600">Configuración del producto</p>
            <h3 className="mt-1 text-2xl font-black text-slate-950">Ritmo y objetivo compartido</h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Esta configuración aplica solo al espacio Scrum. Los demás módulos del proyecto conservan su comportamiento.
            </p>
            <div className="mt-6 space-y-5">
              <div>
                <label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Objetivo del producto</label>
                <textarea
                  value={productGoal}
                  onChange={(event) => setProductGoal(event.target.value)}
                  disabled={!canManage}
                  rows={4}
                  placeholder="Ej. Entregar una plataforma confiable que centralice la operación administrativa y técnica."
                  className="mt-2 w-full rounded-xl border border-slate-200 p-3 text-sm leading-6 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 disabled:bg-slate-50"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Duración sugerida del sprint</label>
                  <select
                    value={sprintLengthWeeks}
                    onChange={(event) => setSprintLengthWeeks(event.target.value)}
                    disabled={!canManage}
                    className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:border-indigo-500 disabled:bg-slate-50"
                  >
                    {[1, 2, 3, 4].map((weeks) => (
                      <option key={weeks} value={weeks}>{weeks} {weeks === 1 ? "semana" : "semanas"}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Escala de estimación</label>
                  <div className="mt-2 flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3">
                    {SCRUM_POINT_SCALE.map((point) => (
                      <span key={point} className="flex h-6 min-w-6 items-center justify-center rounded bg-white px-1 text-[10px] font-black text-indigo-700 ring-1 ring-slate-200">
                        {point}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.12em] text-indigo-700">Dominio de tipos de tarea</p>
                  <p className="mt-1 text-xs leading-5 text-slate-600">El nombre visible es configurable, mientras Pixel conserva internamente el comportamiento técnico.</p>
                </div>
                {canManage && (
                  <div className="mt-4 rounded-xl border border-indigo-100 bg-white p-3">
                    <ScrumStoryCatalogSelect
                      projectId={projectId}
                      catalogType="task_type"
                      label="Agregar o seleccionar tipo"
                      value={settingsTaskTypeValue}
                      onChange={setSettingsTaskTypeValue}
                      currentUser={currentUser}
                      catalogEntries={activeTaskTypeEntries}
                      catalogLoading={scrumCatalog.loading}
                      catalogError={scrumCatalog.error}
                      canCreate
                      createPlaceholder="Ej. Diseño UX, Datos o DevOps"
                      createTemplate={{ scrumKind: "technical_task" }}
                    />
                  </div>
                )}
                <div className="mt-4 space-y-2">
                  {taskTypeEntries.map((entry) => {
                    const isBase = entry.source === "system" || entry.isDefault;
                    const customIndex = configurableTaskTypeEntries.findIndex((candidate) => candidate.id === entry.id);
                    const isUpdating = updatingTaskTypeEntryId === entry.id;
                    return (
                      <div key={entry.id} className={`flex min-w-0 flex-col gap-3 rounded-xl border bg-white p-3 sm:flex-row sm:items-center sm:justify-between ${entry.active ? "border-slate-200" : "border-slate-200 opacity-60"}`}>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="break-words text-sm font-black text-slate-900">{entry.label}</p>
                            <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${isBase ? "bg-indigo-50 text-indigo-700" : entry.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{isBase ? "Base" : entry.active ? "Activo" : "Inactivo"}</span>
                          </div>
                          <p className="mt-1 text-xs leading-5 text-slate-500">{entry.description || "Tipo personalizado con comportamiento de tarea técnica."}</p>
                        </div>
                        {!isBase && canManage && (
                          <div className="flex shrink-0 items-center gap-1.5">
                            <button type="button" onClick={() => void moveTaskTypeEntry(entry, -1)} disabled={isUpdating || customIndex <= 0} className="rounded-lg border border-slate-200 p-2 text-slate-500 disabled:opacity-35" aria-label={`Subir ${entry.label}`}><ChevronUp size={15} /></button>
                            <button type="button" onClick={() => void moveTaskTypeEntry(entry, 1)} disabled={isUpdating || customIndex < 0 || customIndex >= configurableTaskTypeEntries.length - 1} className="rounded-lg border border-slate-200 p-2 text-slate-500 disabled:opacity-35" aria-label={`Bajar ${entry.label}`}><ChevronDown size={15} /></button>
                            <button type="button" onClick={() => void toggleTaskTypeEntry(entry)} disabled={isUpdating} className={`min-w-24 rounded-lg px-3 py-2 text-xs font-black disabled:opacity-50 ${entry.active ? "border border-rose-200 text-rose-700" : "bg-emerald-600 text-white"}`}>
                              {isUpdating ? <Loader2 size={14} className="mx-auto animate-spin" /> : entry.active ? "Desactivar" : "Activar"}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
              <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-4">
                <p className="text-xs font-black uppercase tracking-[0.12em] text-cyan-800">Operación híbrida del piloto</p>
                <p className="mt-1 text-sm leading-6 text-cyan-900">
                  Cada historia define su propio control. En modo Manual, el responsable la mueve desde su Bandeja de entrada sin usar códigos Git. En modo GitHub, ramas, commits y pull requests actualizan la evidencia técnica; las tareas antiguas conservan este modo para no alterar el piloto.
                </p>
              </div>
              {canManage && (
                <Button type="button" onClick={saveSettings} disabled={isSavingSettings} className="bg-indigo-600 font-bold text-white hover:bg-indigo-700">
                  {isSavingSettings ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Settings2 size={16} className="mr-2" />}
                  Guardar configuración
                </Button>
              )}
            </div>
          </div>
        </section>
      )}

      {view === "github" && (
        <ProjectGitHubPanel projectId={projectId} canManage={canManage} />
      )}

      {selectedWorkItem && (
        <ModalShell
          title={`${selectedWorkItem.scrumCode || selectedWorkItem.id.slice(0, 8)} · ${getItemTitle(selectedWorkItem)}`}
          description={`${getScrumTaskTypeLabel(selectedWorkItem)} · ${getScrumStatusLabel(selectedItemStatus)}`}
          onClose={() => setSelectedItemId("")}
        >
          <div className="space-y-5 p-4 sm:p-6">
            {!isRefined(selectedWorkItem) && (
              <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
                <Sparkles size={20} className="mt-0.5 shrink-0 text-amber-600" />
                <div>
                  <p className="text-sm font-black">Este elemento está estacionado en el backlog</p>
                  <p className="mt-1 text-xs leading-5">Todavía no forma parte del flujo principal. Completa su contexto y, si es una historia o tarea, relaciónala con una épica antes de promoverla.</p>
                </div>
              </div>
            )}

            {selectedWorkItem.scrumKind !== "epic" && isRefined(selectedWorkItem) && (
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex min-w-[680px] items-center">
                  {SCRUM_WORK_STATUSES.map((status, index) => {
                    const reached = index <= selectedItemStatusIndex;
                    const current = index === selectedItemStatusIndex;
                    return (
                      <React.Fragment key={status.value}>
                        <div className="flex min-w-20 flex-col items-center text-center">
                          <span className={`flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-black ${current ? "bg-indigo-600 text-white ring-4 ring-indigo-100" : reached ? "bg-emerald-500 text-white" : "bg-white text-slate-400 ring-1 ring-slate-200"}`}>
                            {reached && !current ? <CheckCircle2 size={15} /> : index + 1}
                          </span>
                          <span className={`mt-2 text-[9px] font-black uppercase tracking-wide ${current ? "text-indigo-700" : reached ? "text-emerald-700" : "text-slate-400"}`}>{status.label}</span>
                        </div>
                        {index < SCRUM_WORK_STATUSES.length - 1 && <div className={`mb-5 h-0.5 min-w-8 flex-1 ${index < selectedItemStatusIndex ? "bg-emerald-400" : "bg-slate-200"}`} />}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            )}

            {selectedWorkItem.scrumKind !== "epic" && (
              <section className={`rounded-xl border p-4 ${selectedItemExecutionMode === "manual" ? "border-cyan-200 bg-cyan-50" : "border-slate-800 bg-slate-950 text-white"}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className={`text-[10px] font-black uppercase tracking-[0.14em] ${selectedItemExecutionMode === "manual" ? "text-cyan-700" : "text-violet-200"}`}>Control de avance</p>
                    <p className={`mt-1 break-words text-sm font-black ${selectedItemExecutionMode === "manual" ? "text-cyan-950" : "text-white"}`}>
                      {selectedItemExecutionMode === "manual" ? "Manual desde la Bandeja de entrada" : "Automático con evidencia GitHub"}
                    </p>
                    <p className={`mt-1 text-xs leading-5 ${selectedItemExecutionMode === "manual" ? "text-cyan-800" : "text-slate-300"}`}>
                      {selectedItemExecutionMode === "manual"
                        ? "El responsable cambia cada etapa directamente en Pixel. Esta tarea no será movida por ramas, commits ni pull requests."
                        : `Usa ${selectedWorkItem.scrumCode || "el código Pixel"} en la rama o el pull request. La aprobación funcional sigue siendo humana.`}
                    </p>
                  </div>
                  {selectedItemExecutionMode === "manual" ? (
                    <Link
                      href={`/workflows?projectId=${encodeURIComponent(projectId)}&taskId=${encodeURIComponent(selectedWorkItem.id)}`}
                      className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-cyan-700 px-4 text-xs font-black text-white shadow-sm transition hover:bg-cyan-800"
                    >
                      <Inbox size={15} /> Abrir en Bandeja
                    </Link>
                  ) : (
                    <Button type="button" onClick={() => {
                      setSelectedItemId("");
                      setView("github");
                    }} className="shrink-0 bg-violet-500 font-black text-white hover:bg-violet-400">
                      <Code2 size={15} className="mr-2" /> Ver evidencia
                    </Button>
                  )}
                </div>
              </section>
            )}

            {selectedItemStatus === "validation" && (
              <div className="flex gap-3 rounded-xl border border-cyan-200 bg-cyan-50 p-4 text-cyan-950">
                <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-cyan-700" />
                <div>
                  <p className="text-sm font-black">Validación funcional pendiente</p>
                  <p className="mt-1 text-xs leading-5">Compara el resultado entregado con cada criterio de aceptación. {selectedItemExecutionMode === "github" ? "GitHub demuestra la entrega técnica, pero una persona confirma que el resultado funciona." : "La evidencia y el avance se registran manualmente en Pixel antes de terminar la tarea."}</p>
                </div>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {[
                ["Release", selectedItemRelease?.name || "Sin Release"],
                ["Épica", selectedWorkItem.scrumKind === "epic" ? getItemTitle(selectedWorkItem) : selectedItemEpic ? getItemTitle(selectedItemEpic) : "Sin épica"],
                ["Submódulo", selectedWorkItem.scrumKind === "epic" ? "No aplica" : selectedItemGroup?.name || "Sin submódulo"],
                ["Sprint", selectedWorkItem.scrumKind === "epic" ? "No aplica" : getItemSprintLabel(selectedWorkItem, selectedItemSprint)],
                ["Prioridad", priorityLabel(selectedWorkItem.priority)],
                ["Estimación", selectedWorkItem.scrumKind === "epic" ? "No aplica" : `${Number(selectedWorkItem.storyPoints || 0)} puntos`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">{label}</p>
                  <p className="mt-1 line-clamp-2 break-words text-xs font-black text-slate-900">{value}</p>
                </div>
              ))}
            </div>

            <section className="rounded-xl border border-slate-200 p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Descripción</p>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700 [overflow-wrap:anywhere]">{selectedWorkItem.description || "No se registró una descripción."}</p>
            </section>

            {selectedWorkItem.scrumKind !== "epic" && (
              <section className={`rounded-xl border p-4 ${selectedItemStatus === "validation" ? "border-cyan-300 bg-cyan-50/60" : "border-slate-200"}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-cyan-700">Criterios de aceptación</p>
                  <span className="rounded-full bg-white px-2 py-1 text-[9px] font-black text-slate-500 ring-1 ring-slate-200">Obligatorios para validar</span>
                </div>
                <p className="mt-3 whitespace-pre-wrap break-words text-sm font-semibold leading-6 text-slate-800 [overflow-wrap:anywhere]">{selectedWorkItem.acceptanceCriteria || "Esta historia no tiene criterios definidos. Edítala antes de aprobar su validación."}</p>
              </section>
            )}

            <section className="rounded-xl border border-slate-200 p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Responsables</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {getItemAssigneeIds(selectedWorkItem).length === 0 ? (
                  <span className="text-sm text-slate-500">Sin responsable asignado.</span>
                ) : getItemAssigneeIds(selectedWorkItem).map((memberId) => {
                  const member = getMember(memberId);
                  return member ? (
                    <div key={memberId} className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 py-1 pl-1 pr-3">
                      <MemberAvatar member={member} />
                      <span className="min-w-0 break-words text-xs font-bold text-slate-700">{getMemberLabel(member)}</span>
                    </div>
                  ) : null;
                })}
              </div>
            </section>

            {(selectedWorkItem.githubLastEvidenceKind || selectedWorkItem.githubMainPullRequest) && (
              <section className="rounded-xl border border-violet-200 bg-violet-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-violet-700">Evidencia técnica</p>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm font-bold text-violet-950">
                    Última evidencia: {selectedWorkItem.githubLastEvidenceKind === "pull_request" ? "Pull request" : selectedWorkItem.githubLastEvidenceKind}
                    {selectedWorkItem.githubMainPullRequest?.number ? ` · PR #${selectedWorkItem.githubMainPullRequest.number}` : ""}
                  </p>
                  {selectedWorkItem.githubMainPullRequest?.url && (
                    <a href={selectedWorkItem.githubMainPullRequest.url} target="_blank" rel="noreferrer" className="text-xs font-black text-violet-700 hover:underline">Abrir pull request</a>
                  )}
                </div>
              </section>
            )}

            <div className="flex flex-col gap-2 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                {canViewDocuments && selectedWorkItem.scrumKind !== "epic" && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setDocumentsItem({ ...selectedWorkItem, projectId })}
                    className="font-bold"
                  >
                    <Paperclip size={15} className="mr-2" /> Adjuntos
                  </Button>
                )}
                {selectedWorkItem.scrumKind === "story" && isRefined(selectedWorkItem) && (
                  <Button type="button" onClick={() => {
                    setFocusedStoryId(selectedWorkItem.id);
                    setSelectedItemId("");
                    setView("stories");
                  }} className="bg-indigo-600 font-black text-white hover:bg-indigo-700">
                    <BookOpen size={15} className="mr-2" /> Abrir expediente de la HU
                  </Button>
                )}
                {canManage && (
                  <Button type="button" variant="outline" onClick={() => {
                    setSelectedItemId("");
                    openEditItem(selectedWorkItem);
                  }} className="font-bold">
                    <Pencil size={15} className="mr-2" /> Editar información
                  </Button>
                )}
                {canManage && !isRefined(selectedWorkItem) && (
                  <Button type="button" onClick={() => {
                    setSelectedItemId("");
                    promoteFromGrooming(selectedWorkItem);
                  }} className="bg-amber-500 font-black text-white hover:bg-amber-600">
                    <Sparkles size={15} className="mr-2" />
                    {selectedWorkItem.scrumKind === "epic" ? "Promover épica" : selectedWorkItem.scrumEpicId ? "Completar grooming" : "Asignar épica"}
                  </Button>
                )}
              </div>
              {canMoveItems && selectedWorkItem.scrumKind !== "epic" && isRefined(selectedWorkItem) && selectedItemExecutionMode === "github" && selectedItemStatus === "validation" && (
                <div className="flex flex-wrap gap-2 sm:justify-end">
                  {selectedItemStatusIndex < SCRUM_WORK_STATUSES.length - 1 && (
                    <Button type="button" onClick={() => updateWorkStatus(selectedWorkItem, SCRUM_WORK_STATUSES[selectedItemStatusIndex + 1].value)} className={`${selectedItemStatus === "validation" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-indigo-600 hover:bg-indigo-700"} font-bold text-white`}>
                      {selectedItemStatus === "validation" ? "Aprobar criterios y terminar" : `Mover a ${SCRUM_WORK_STATUSES[selectedItemStatusIndex + 1].label}`}
                      <ChevronRight size={15} className="ml-1" />
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        </ModalShell>
      )}

      {isItemModalOpen && (
        <ModalShell
          title={editingItem ? "Editar trabajo" : "Nuevo trabajo del backlog"}
          description="Registra una unidad concreta que pueda planificarse, ejecutarse y validarse."
          onClose={resetItemModal}
        >
          <div className="space-y-5 p-4 sm:p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                {itemDraft.kind === "epic" ? (
                  <>
                    <label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Tipo</label>
                    <div className="mt-2 flex h-11 items-center rounded-xl border border-violet-200 bg-violet-50 px-3 text-sm font-black text-violet-800">Épica</div>
                  </>
                ) : (
                  <ScrumStoryCatalogSelect
                    projectId={projectId}
                    catalogType="task_type"
                    label="Tipo de tarea"
                    value={itemDraft.taskTypeLabel}
                    currentUser={currentUser}
                    catalogEntries={activeTaskTypeEntries}
                    catalogLoading={scrumCatalog.loading}
                    catalogError={scrumCatalog.error}
                    canCreate={canManage}
                    required
                    createPlaceholder="Nuevo tipo de tarea"
                    createTemplate={{ scrumKind: "technical_task" }}
                    onChange={(taskTypeLabel) => {
                      const selectedEntry = taskTypeEntries.find((entry) => entry.normalizedLabel === normalizeScrumStoryCatalogLabel(taskTypeLabel));
                      setItemDraft((current) => ({ ...current, taskTypeLabel, taskTypeId: selectedEntry?.id || "", kind: selectedEntry ? getCatalogTaskKind(selectedEntry) : current.kind }));
                    }}
                    onEntrySelected={applyDraftTaskType}
                  />
                )}
                {itemDraft.kind !== "epic" && <p className="mt-2 text-[11px] font-semibold text-slate-500">Los nuevos tipos se comportan como tareas técnicas.</p>}
              </div>
              <div>
                <label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Prioridad</label>
                <select
                  value={itemDraft.priority}
                  onChange={(event) => setItemDraft((current) => ({ ...current, priority: event.target.value }))}
                  className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:border-indigo-500"
                >
                  <option value="urgent">Urgente</option>
                  <option value="high">Alta</option>
                  <option value="medium">Media</option>
                  <option value="low">Baja</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Nombre</label>
              <input
                value={itemDraft.title}
                onChange={(event) => setItemDraft((current) => ({ ...current, title: event.target.value }))}
                placeholder="Describe el resultado esperado"
                className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
              />
            </div>
            <div>
              <label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Descripción</label>
              <textarea
                value={itemDraft.description}
                onChange={(event) => setItemDraft((current) => ({ ...current, description: event.target.value }))}
                rows={3}
                placeholder="Contexto, alcance y necesidad que se debe resolver."
                className="mt-2 w-full rounded-xl border border-slate-200 p-3 text-sm leading-6 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
              />
            </div>
            {itemDraft.kind === "epic" && (
              <div className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4">
                <label className="text-xs font-black uppercase tracking-[0.12em] text-indigo-700">Release superior</label>
                <select
                  value={itemDraft.releaseId}
                  onChange={(event) => setItemDraft((current) => ({ ...current, releaseId: event.target.value }))}
                  className="mt-2 h-11 w-full min-w-0 rounded-xl border border-indigo-200 bg-white px-3 text-sm font-semibold outline-none focus:border-indigo-500"
                >
                  <option value="">Pendiente de asignar</option>
                  {releases.map((release) => <option key={release.id} value={release.id}>{release.releaseCode || "REL"} · {release.name}</option>)}
                </select>
                <p className="mt-2 text-xs leading-5 text-indigo-700">Una épica debe pertenecer a un Release antes de salir del grooming.</p>
              </div>
            )}
            {itemDraft.kind !== "epic" && (
              <div>
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Control de avance</label>
                  <span className="text-[11px] font-semibold text-slate-400">Se puede cambiar por cada tarea</span>
                </div>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  {SCRUM_EXECUTION_MODES.map((mode) => {
                    const active = itemDraft.executionMode === mode.value;
                    const Icon = mode.value === "manual" ? Inbox : Code2;
                    return (
                      <button
                        key={mode.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setItemDraft((current) => ({ ...current, executionMode: mode.value }))}
                        className={`min-w-0 rounded-xl border p-4 text-left transition ${active ? mode.value === "manual" ? "border-cyan-400 bg-cyan-50 ring-2 ring-cyan-100" : "border-slate-700 bg-slate-950 text-white ring-2 ring-violet-100" : "border-slate-200 bg-white hover:border-indigo-200 hover:bg-slate-50"}`}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${active ? mode.value === "manual" ? "bg-cyan-700 text-white" : "bg-violet-500 text-white" : "bg-slate-100 text-slate-500"}`}>
                            <Icon size={16} />
                          </span>
                          <span className="min-w-0 break-words text-sm font-black">{mode.label}</span>
                        </span>
                        <span className={`mt-2 block break-words text-xs leading-5 ${active && mode.value === "github" ? "text-slate-300" : "text-slate-500"}`}>{mode.description}</span>
                      </button>
                    );
                  })}
                </div>
                {editingItem && getScrumExecutionMode(editingItem) !== itemDraft.executionMode && (
                  <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-800">
                    El historial y la evidencia existentes se conservan; solo cambia quién controla los próximos avances.
                  </p>
                )}
              </div>
            )}
            {!itemDraft.sprintId && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.14em] text-amber-700">Estado del grooming</p>
                    <p className="mt-1 text-sm font-black text-slate-900">
                      {itemDraft.refinementStatus === "pending" ? "Estacionado en el backlog" : "Refinado y listo para planificar"}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-amber-800">Lo pendiente no aparece conectado al proyecto en el mapa principal.</p>
                  </div>
                  <select
                    value={itemDraft.refinementStatus}
                    onChange={(event) => setItemDraft((current) => ({ ...current, refinementStatus: event.target.value as "pending" | "refined" }))}
                    className="h-10 rounded-xl border border-amber-300 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-amber-500"
                  >
                    <option value="pending">Pendiente de grooming</option>
                    <option value="refined">Grooming completado</option>
                  </select>
                </div>
              </div>
            )}
            {itemDraft.kind !== "epic" && (
              <div>
                <label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Criterios de aceptación</label>
                <textarea
                  value={itemDraft.acceptanceCriteria}
                  onChange={(event) => setItemDraft((current) => ({ ...current, acceptanceCriteria: event.target.value }))}
                  rows={3}
                  placeholder="Indica cómo se comprobará que el trabajo quedó correctamente terminado."
                  className="mt-2 w-full rounded-xl border border-slate-200 p-3 text-sm leading-6 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
                />
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Componente técnico (opcional)</label>
                <input
                  value={itemDraft.module}
                  onChange={(event) => setItemDraft((current) => ({ ...current, module: event.target.value }))}
                  placeholder="Ej. API, interfaz o base de datos"
                  className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-indigo-500"
                />
              </div>
              {itemDraft.kind !== "epic" && (
                <div>
                  <label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Estimación</label>
                  <select
                    value={itemDraft.storyPoints}
                    onChange={(event) => setItemDraft((current) => ({ ...current, storyPoints: event.target.value }))}
                    className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:border-indigo-500"
                  >
                    <option value="0">Sin estimar</option>
                    {SCRUM_POINT_SCALE.map((point) => <option key={point} value={point}>{point} puntos</option>)}
                  </select>
                </div>
              )}
            </div>
            {itemDraft.kind !== "epic" && (
              <div className="grid gap-4 lg:grid-cols-3">
                <div>
                  <label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Épica</label>
                  <select
                    value={itemDraft.epicId}
                    onChange={(event) => setItemDraft((current) => {
                      const epicId = event.target.value;
                      const selectedEpic = epicById.get(epicId);
                      const currentGroup = groupById.get(current.groupId);
                      const currentSprint = sprints.find((sprint) => sprint.id === current.sprintId);
                      const currentSprintGroup = groupById.get(currentSprint?.scrumGroupId);
                      const groupMatchesEpic = !currentGroup || currentGroup.scrumEpicId === epicId;
                      const sprintMatchesEpic = !currentSprint || (currentSprint.scrumEpicId || currentSprintGroup?.scrumEpicId) === epicId;
                      return {
                        ...current,
                        epicId,
                        releaseId: selectedEpic?.scrumReleaseId || "",
                        groupId: epicId && groupMatchesEpic ? current.groupId : "",
                        sprintId: sprintMatchesEpic ? current.sprintId : "",
                      };
                    })}
                    className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-500"
                  >
                    <option value="">Sin épica</option>
                    {epics.map((epic) => <option key={epic.id} value={epic.id}>{releaseById.get(epic.scrumReleaseId)?.name || "Sin Release"} · {epic.scrumCode} · {getItemTitle(epic)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Submódulo</label>
                  <select
                    value={itemDraft.groupId}
                    onChange={(event) => setItemDraft((current) => {
                      const groupId = event.target.value;
                      const selectedSubmodule = groupById.get(groupId);
                      const epicId = selectedSubmodule?.scrumEpicId || current.epicId;
                      const selectedEpic = epicById.get(epicId);
                      const currentSprint = sprints.find((sprint) => sprint.id === current.sprintId);
                      const sprintMatchesSubmodule = Boolean(groupId && (!currentSprint || currentSprint.scrumGroupId === groupId));
                      return {
                        ...current,
                        groupId,
                        epicId,
                        releaseId: selectedSubmodule?.scrumReleaseId || selectedEpic?.scrumReleaseId || current.releaseId,
                        sprintId: sprintMatchesSubmodule ? current.sprintId : "",
                      };
                    })}
                    className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-cyan-500"
                  >
                    <option value="">Sin submódulo</option>
                    {groups
                      .filter((group) => !itemDraft.epicId || group.scrumEpicId === itemDraft.epicId)
                      .map((group) => (
                        <option key={group.id} value={group.id}>
                          {getSubmoduleCode(group)} · {group.name}
                        </option>
                      ))}
                  </select>
                  {itemDraft.epicId && groups.filter((group) => group.scrumEpicId === itemDraft.epicId).length === 0 && (
                    <p className="mt-2 text-[11px] font-semibold text-amber-700">Esta épica todavía no tiene submódulos.</p>
                  )}
                </div>
                <div>
                  <label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Sprint</label>
                  <select
                    value={itemDraft.sprintId}
                    onChange={(event) => setItemDraft((current) => {
                      const sprintId = event.target.value;
                      const selectedItemSprint = sprints.find((sprint) => sprint.id === sprintId);
                      const selectedGroup = groupById.get(selectedItemSprint?.scrumGroupId);
                      const epicId = selectedItemSprint?.scrumEpicId || selectedGroup?.scrumEpicId || current.epicId;
                      const selectedEpic = epicById.get(epicId);
                      return {
                        ...current,
                        sprintId,
                        groupId: selectedGroup?.id || current.groupId,
                        epicId,
                        releaseId: selectedItemSprint?.scrumReleaseId || selectedGroup?.scrumReleaseId || selectedEpic?.scrumReleaseId || current.releaseId,
                        refinementStatus: sprintId ? "refined" : current.refinementStatus,
                      };
                    })}
                    className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-500"
                  >
                    <option value="">Sin sprint</option>
                    {sprints
                      .filter((sprint) => getSprintStatus(sprint) !== "completed")
                      .filter((sprint) => !itemDraft.groupId || sprint.scrumGroupId === itemDraft.groupId)
                      .filter((sprint) => !itemDraft.epicId || (sprint.scrumEpicId || groupById.get(sprint.scrumGroupId)?.scrumEpicId) === itemDraft.epicId)
                      .map((sprint) => (
                      <option key={sprint.id} value={sprint.id}>{groupById.get(sprint.scrumGroupId)?.name || "Sin submódulo"} · {sprint.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
            {itemDraft.kind !== "epic" && (
              <div>
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Responsables</label>
                  <span className="text-[11px] font-semibold text-slate-400">
                    {itemDraft.assigneeIds.length === 0
                      ? "Sin asignar"
                      : itemDraft.assigneeIds.length === 1
                        ? "Individual"
                        : itemDraft.assigneeIds.length === 2
                          ? "Dupla"
                          : "Equipo"}
                  </span>
                </div>
                <div className="mt-2 grid max-h-48 gap-2 overflow-y-auto rounded-xl border border-slate-200 p-3 sm:grid-cols-2">
                  {teamMembers.map((member) => (
                    <label key={member.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-transparent p-2 transition hover:border-indigo-100 hover:bg-indigo-50/50">
                      <input
                        type="checkbox"
                        checked={itemDraft.assigneeIds.includes(member.id)}
                        onChange={() => toggleDraftAssignee(member.id)}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <MemberAvatar member={member} />
                      <span className="min-w-0 truncate text-sm font-semibold text-slate-700">{getMemberLabel(member)}</span>
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-xs text-slate-400">La primera persona seleccionada queda como responsable principal.</p>
              </div>
            )}
            <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={resetItemModal} className="w-full sm:w-auto">Cancelar</Button>
              <Button type="button" onClick={saveWorkItem} disabled={isSavingItem} className="w-full bg-indigo-600 font-bold text-white hover:bg-indigo-700 sm:w-auto">
                {isSavingItem && <Loader2 size={16} className="mr-2 animate-spin" />}
                {editingItem ? "Guardar cambios" : "Crear trabajo"}
              </Button>
            </div>
          </div>
        </ModalShell>
      )}

      {isReleaseModalOpen && (
        <ModalShell
          title={editingRelease ? "Editar Release" : "Nuevo Release"}
          description="Agrupa varias épicas bajo una entrega de producto con objetivo y horizonte compartidos."
          onClose={resetReleaseModal}
        >
          <div className="space-y-5 p-4 sm:p-6">
            <div>
              <label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Nombre del Release</label>
              <input
                value={releaseDraft.name}
                onChange={(event) => setReleaseDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder="Ej. Lanzamiento operativo 2026.3"
                className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10"
              />
            </div>
            <div>
              <label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Objetivo de la entrega</label>
              <textarea
                value={releaseDraft.objective}
                onChange={(event) => setReleaseDraft((current) => ({ ...current, objective: event.target.value }))}
                rows={3}
                placeholder="Describe el resultado de negocio o producto que debe quedar disponible."
                className="mt-2 w-full rounded-xl border border-slate-200 p-3 text-sm leading-6 outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Inicio planeado</label>
                <input
                  type="date"
                  value={releaseDraft.startDate}
                  onChange={(event) => setReleaseDraft((current) => ({ ...current, startDate: event.target.value }))}
                  className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-cyan-500"
                />
              </div>
              <div>
                <label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Fecha objetivo</label>
                <input
                  type="date"
                  value={releaseDraft.targetDate}
                  onChange={(event) => setReleaseDraft((current) => ({ ...current, targetDate: event.target.value }))}
                  className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-cyan-500"
                />
              </div>
            </div>
            <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-4 text-xs leading-5 text-cyan-900">
              El avance del Release se calculará con todas las tareas de sus épicas, ponderado por puntos y etapa actual.
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={resetReleaseModal} className="w-full sm:w-auto">Cancelar</Button>
              <Button type="button" onClick={saveRelease} disabled={isSavingRelease} className="w-full bg-cyan-600 font-bold text-slate-950 hover:bg-cyan-500 sm:w-auto">
                {isSavingRelease && <Loader2 size={16} className="mr-2 animate-spin" />}
                {editingRelease ? "Guardar cambios" : "Crear Release"}
              </Button>
            </div>
          </div>
        </ModalShell>
      )}

      {isGroupModalOpen && (
        <ModalShell
          title={editingGroup ? "Editar submódulo" : "Nuevo submódulo"}
          description="Organiza una o varias historias de usuario dentro de una épica. Cada submódulo también puede planificar uno o varios sprints."
          onClose={resetGroupModal}
        >
          <div className="space-y-5 p-4 sm:p-6">
            <div>
              <label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Épica superior</label>
              <select
                value={groupDraft.epicId}
                onChange={(event) => setGroupDraft((current) => ({ ...current, epicId: event.target.value }))}
                className="mt-2 h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:border-cyan-500"
              >
                <option value="">Selecciona una épica</option>
                {refinedEpics.filter((epic) => epic.scrumReleaseId).map((epic) => (
                  <option key={epic.id} value={epic.id}>
                    {releaseById.get(epic.scrumReleaseId)?.name || "Release"} · {epic.scrumCode || "ÉPICA"} · {getItemTitle(epic)}
                  </option>
                ))}
              </select>
              {refinedEpics.filter((epic) => epic.scrumReleaseId).length === 0 && (
                <p className="mt-2 text-xs font-semibold text-amber-700">Primero crea un Release y vincula una épica refinada.</p>
              )}
            </div>
            <div>
              <label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Nombre del submódulo</label>
              <input
                value={groupDraft.name}
                onChange={(event) => setGroupDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder="Ej. Autenticación, Reportes o Integraciones"
                className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10"
              />
            </div>
            <div>
              <label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Alcance del submódulo</label>
              <textarea
                value={groupDraft.description}
                onChange={(event) => setGroupDraft((current) => ({ ...current, description: event.target.value }))}
                rows={3}
                placeholder="Describe qué historias o capacidad funcional reúne este submódulo."
                className="mt-2 w-full rounded-xl border border-slate-200 p-3 text-sm leading-6 outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10"
              />
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end">
              {editingGroup && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => deleteGroup(editingGroup)}
                  disabled={isDeletingGroup || isSavingGroup}
                  className="w-full border-red-200 font-bold text-red-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700 sm:mr-auto sm:w-auto"
                >
                  {isDeletingGroup ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Trash2 size={16} className="mr-2" />}
                  Eliminar submódulo
                </Button>
              )}
              <Button type="button" variant="outline" onClick={resetGroupModal} className="w-full sm:w-auto">Cancelar</Button>
              <Button type="button" onClick={saveGroup} disabled={isSavingGroup || !groupDraft.epicId} className="w-full bg-cyan-700 font-bold text-white hover:bg-cyan-800 sm:w-auto">
                {isSavingGroup && <Loader2 size={16} className="mr-2 animate-spin" />}
                {editingGroup ? "Guardar cambios" : "Crear submódulo"}
              </Button>
            </div>
          </div>
        </ModalShell>
      )}

      {isSprintModalOpen && (
        <ModalShell
          title={editingSprint ? "Editar sprint" : "Crear sprint"}
          description="Planifica el sprint dentro de un submódulo. Los submódulos pueden ejecutar sprints en paralelo."
          onClose={resetSprintModal}
        >
          <div className="space-y-5 p-4 sm:p-6">
            <div>
              <label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Submódulo de ejecución</label>
              <select
                value={sprintGroupId}
                onChange={(event) => setSprintGroupId(event.target.value)}
                className="mt-2 h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:border-indigo-500"
              >
                <option value="">Selecciona un submódulo</option>
                {groups.map((group) => {
                  const epic = epicById.get(group.scrumEpicId);
                  const release = releaseById.get(group.scrumReleaseId || epic?.scrumReleaseId);
                  return (
                    <option key={group.id} value={group.id}>
                      {release?.name || "Release"} · {epic ? getItemTitle(epic) : "Épica"} · {group.name}
                    </option>
                  );
                })}
              </select>
              {groups.length === 0 && (
                <p className="mt-2 text-xs font-semibold text-amber-700">Primero crea un submódulo dentro de una épica para habilitar la planificación.</p>
              )}
            </div>
            <div>
              <label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Nombre</label>
              <input
                value={sprintName}
                onChange={(event) => setSprintName(event.target.value)}
                className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Objetivo del sprint</label>
              <textarea
                value={sprintGoal}
                onChange={(event) => setSprintGoal(event.target.value)}
                rows={3}
                placeholder="Ej. Dejar lista la auditoría contable para el piloto administrativo."
                className="mt-2 w-full rounded-xl border border-slate-200 p-3 text-sm leading-6 outline-none focus:border-indigo-500"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Inicio</label>
                <input
                  type="date"
                  value={sprintStart}
                  onChange={(event) => setSprintStart(event.target.value)}
                  className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Fin</label>
                <input
                  type="date"
                  value={sprintEnd}
                  onChange={(event) => setSprintEnd(event.target.value)}
                  className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-indigo-500"
                />
              </div>
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={resetSprintModal} className="w-full sm:w-auto">Cancelar</Button>
              <Button type="button" onClick={saveSprint} disabled={isSavingSprint || !sprintGroupId} className="w-full bg-indigo-600 font-bold text-white hover:bg-indigo-700 sm:w-auto">
                {isSavingSprint && <Loader2 size={16} className="mr-2 animate-spin" />}
                {editingSprint ? "Guardar cambios" : "Crear sprint"}
              </Button>
            </div>
          </div>
        </ModalShell>
      )}

      <TaskDocumentsViewer
        isOpen={Boolean(documentsItem)}
        onClose={() => setDocumentsItem(null)}
        task={documentsItem}
        userId={currentUser?.uid || currentUser?.id || ""}
        currentUser={currentUser}
        project={project}
        tasks={tasks}
        teamMembers={teamMembers}
        canUploadDocuments={canUploadDocuments}
        canManageAccess={canManageDocumentAccess}
        canDeleteDocuments={canDeleteDocuments}
      />
    </div>
  );
}
