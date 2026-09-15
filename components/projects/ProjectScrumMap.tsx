"use client";

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Archive,
  BookOpen,
  Boxes,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  CircleDot,
  Eye,
  EyeOff,
  Layers3,
  Maximize2,
  PackageOpen,
  Pencil,
  PlayCircle,
  Plus,
  RotateCcw,
  Save,
  Target,
  Trash2,
  WandSparkles,
} from "lucide-react";
import {
  getScrumProgress,
  getScrumScopeMetrics,
  getScrumStatusLabel,
  getScrumTaskTypeLabel,
  getSprintMetrics,
  getSprintStatus,
  normalizeScrumStatus,
} from "@/lib/scrum";

type MapPosition = { x: number; y: number };

export type ScrumMapLayout = {
  schemaVersion?: number;
  positions?: Record<string, MapPosition>;
  viewport?: Viewport | null;
  showCompletedSprints?: boolean;
};

export type ScrumMapLayoutInput = {
  schemaVersion: 1;
  positions: Record<string, MapPosition>;
  viewport: Viewport;
  showCompletedSprints: boolean;
};

type CreateStoryDefaults = {
  releaseId: string;
  epicId: string;
  groupId: string;
};

type ProjectScrumMapProps = {
  project: any;
  items: any[];
  releases: any[];
  groups: any[];
  epics: any[];
  sprints: any[];
  members: any[];
  onOpenItem: (item: any) => void;
  onOpenSprint?: (sprint: any) => void;
  canManage?: boolean;
  canCreateItems?: boolean;
  canManageLifecycle?: boolean;
  layout?: ScrumMapLayout | null;
  onSaveLayout?: (layout: ScrumMapLayoutInput) => Promise<void>;
  onOpenBacklog?: () => void;
  onCreateRelease?: () => void;
  onEditRelease?: (release: any) => void;
  onCreateEpic?: (releaseId: string) => void;
  onCreateGroup?: (epicId: string) => void;
  onEditGroup?: (group: any) => void;
  onDeleteGroup?: (group: any) => void;
  onCreateStory?: (defaults: CreateStoryDefaults) => void;
  onCreateSprint?: (groupId: string) => void;
  onEditSprint?: (sprint: any) => void;
  onStartSprint?: (sprint: any) => void;
  onCloseSprint?: (sprint: any) => void;
  onDeleteSprint?: (sprint: any) => void;
};

type MapEntityType = "project" | "backlog" | "backlogItem" | "release" | "epic" | "group" | "story" | "sprint";

type MapNodeData = {
  entityType: MapEntityType;
  entity?: any;
  item?: any;
  release?: any;
  group?: any;
  sprint?: any;
  title: string;
  subtitle?: string;
  code?: string;
  status?: string;
  assignee?: string;
  count?: number;
  progress?: number;
  specCompleteness?: number | null;
  activeCount?: number;
  impactedCount?: number;
  kindLabel?: string;
  parkingReason?: string;
};

type MapNode = Node<MapNodeData>;

const EMPTY_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

const isRefined = (item: any) => {
  if (item?.scrumRefinementStatus) return item.scrumRefinementStatus === "refined";
  if (item?.scrumKind === "epic") return true;
  return Boolean(item?.sprintId || item?.scrumEpicId);
};

const getMapScrumKind = (item: any) => String(item?.scrumKind || "story");

const getSubmoduleCode = (item: any) =>
  String(item?.submoduleCode || item?.groupCode || "SUB").replace(/^GRP-/i, "SUB-");

const clampPercentage = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const getStorySpecCompleteness = (item: any): number | null => {
  const raw = item?.storySpecCompleteness;
  if (typeof raw === "number" && Number.isFinite(raw)) return clampPercentage(raw);
  if (!raw || typeof raw !== "object") return null;

  const directValue = raw.percentage ?? raw.percent ?? raw.progress ?? raw.score;
  if (typeof directValue === "number" && Number.isFinite(directValue)) {
    return clampPercentage(directValue <= 1 ? directValue * 100 : directValue);
  }

  const completed = Number(raw.completed ?? raw.completedFields ?? raw.present ?? NaN);
  const total = Number(raw.total ?? raw.totalFields ?? raw.required ?? NaN);
  if (Number.isFinite(completed) && Number.isFinite(total) && total > 0) {
    return clampPercentage((completed / total) * 100);
  }
  return null;
};

const getStorySubmoduleIds = (item: any) => {
  const ids = Array.isArray(item?.scrumSubmoduleIds) ? item.scrumSubmoduleIds : [];
  return [...new Set(ids.filter((id: unknown): id is string => typeof id === "string" && Boolean(id)))];
};

const ProgressBar = ({ value, tone }: { value: number; tone: string }) => (
  <div className="mt-2 flex items-center gap-2">
    <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-200">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${clampPercentage(value)}%` }} />
    </div>
    <span className="shrink-0 font-mono text-[10px] font-black tabular-nums text-slate-700">{clampPercentage(value)}%</span>
  </div>
);

const RootNode = memo(({ data, selected }: NodeProps<MapNode>) => (
  <div className={`w-80 rounded-2xl border-2 bg-slate-950 px-5 py-4 text-white shadow-xl transition ${selected ? "border-cyan-300 ring-4 ring-cyan-200/50" : "border-slate-900"}`}>
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500"><Target size={19} /></div>
      <div className="min-w-0">
        <p className="text-[9px] font-black uppercase tracking-[0.18em] text-indigo-200">Iniciativa / proyecto</p>
        <p className="truncate text-base font-black">{data.title}</p>
        {data.subtitle && <p className="mt-0.5 truncate text-[11px] text-slate-300">{data.subtitle}</p>}
      </div>
    </div>
    <Handle type="source" position={Position.Bottom} className="!h-2.5 !w-2.5 !border-2 !border-white !bg-indigo-500" />
  </div>
));
RootNode.displayName = "RootNode";

const ReleaseNode = memo(({ data, selected }: NodeProps<MapNode>) => (
  <div className={`w-72 rounded-2xl border-2 bg-indigo-50 px-4 py-3 text-slate-950 shadow-lg transition ${selected ? "border-indigo-600 ring-4 ring-indigo-100" : "border-indigo-300"}`}>
    <Handle type="target" position={Position.Top} className="!h-2.5 !w-2.5 !border-2 !border-white !bg-indigo-600" />
    <div className="flex items-start gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white"><PackageOpen size={17} /></div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[9px] font-black uppercase tracking-[0.16em] text-indigo-600">Release · {data.code || "Sin código"}</p>
        <p className="mt-0.5 line-clamp-2 break-words text-sm font-black leading-5">{data.title}</p>
        {data.subtitle && <p className="mt-1 truncate text-[10px] font-bold text-slate-500">{data.subtitle}</p>}
        <ProgressBar value={data.progress || 0} tone="bg-indigo-600" />
      </div>
    </div>
    <Handle type="source" position={Position.Bottom} className="!h-2.5 !w-2.5 !border-2 !border-white !bg-indigo-600" />
  </div>
));
ReleaseNode.displayName = "ReleaseNode";

const EpicNode = memo(({ data, selected }: NodeProps<MapNode>) => (
  <div className={`w-72 rounded-2xl border-2 bg-violet-50 px-4 py-3 text-slate-950 shadow-lg transition ${selected ? "border-violet-600 ring-4 ring-violet-100" : "border-violet-300"}`}>
    <Handle type="target" position={Position.Top} className="!h-2.5 !w-2.5 !border-2 !border-white !bg-violet-500" />
    <div className="flex items-start gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white"><Layers3 size={17} /></div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[9px] font-black uppercase tracking-[0.16em] text-violet-600">Épica · {data.code || "Sin código"}</p>
        <p className="mt-0.5 line-clamp-2 break-words text-sm font-black leading-5">{data.title}</p>
        {data.subtitle && <p className="mt-1 truncate text-[10px] font-bold text-slate-500">{data.subtitle}</p>}
        <ProgressBar value={data.progress || 0} tone="bg-violet-600" />
      </div>
    </div>
    <Handle type="source" position={Position.Bottom} className="!h-2.5 !w-2.5 !border-2 !border-white !bg-violet-500" />
  </div>
));
EpicNode.displayName = "EpicNode";

const GroupNode = memo(({ data, selected }: NodeProps<MapNode>) => (
  <div className={`w-64 rounded-2xl border-2 bg-cyan-50 px-4 py-3 text-slate-950 shadow-md transition ${selected ? "border-cyan-700 ring-4 ring-cyan-100" : "border-cyan-300"}`}>
    <Handle type="target" position={Position.Top} className="!h-2.5 !w-2.5 !border-2 !border-white !bg-cyan-600" />
    <div className="flex items-start gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-700 text-white"><Boxes size={15} /></div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[9px] font-black uppercase tracking-[0.15em] text-cyan-700">Submódulo · {data.code || "SUB"}</p>
        <p className="mt-0.5 line-clamp-2 break-words text-xs font-black leading-4">{data.title}</p>
        <p className="mt-1 text-[9px] font-semibold text-cyan-800">{data.subtitle}</p>
        <ProgressBar value={data.progress || 0} tone="bg-cyan-600" />
      </div>
    </div>
    <Handle type="source" position={Position.Bottom} className="!h-2.5 !w-2.5 !border-2 !border-white !bg-cyan-600" />
  </div>
));
GroupNode.displayName = "GroupNode";

const StoryNode = memo(({ data, selected }: NodeProps<MapNode>) => {
  const status = normalizeScrumStatus(data.status);
  const completeness = data.specCompleteness;
  return (
    <div className={`w-60 rounded-xl border-2 bg-white px-3.5 py-3 shadow-md transition ${selected ? "border-blue-600 ring-4 ring-blue-100" : "border-blue-200"}`}>
      <Handle type="target" position={Position.Top} className="!h-2.5 !w-2.5 !border-2 !border-white !bg-blue-500" />
      <div className="flex min-w-0 items-start gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white"><BookOpen size={15} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="truncate text-[9px] font-black uppercase tracking-[0.13em] text-blue-700">Historia · {data.code || "HU"}</span>
            {completeness !== null && completeness !== undefined && (
              <span className={`rounded px-1.5 py-0.5 text-[8px] font-black ${completeness >= 100 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
                Ficha {completeness}%
              </span>
            )}
          </div>
          <p className="mt-1 line-clamp-2 break-words text-xs font-black leading-4 text-slate-950">{data.title}</p>
          <div className="mt-2 flex min-w-0 items-center justify-between gap-2 text-[9px] font-bold">
            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-1 text-slate-600">{getScrumStatusLabel(status)}</span>
            <span className="min-w-0 truncate text-slate-400">{data.assignee || "Sin responsable"}</span>
          </div>
          {Boolean(data.impactedCount) && (
            <p className="mt-1.5 text-[8px] font-black uppercase tracking-wide text-cyan-700">Impacta {data.impactedCount} submódulo(s) adicional(es)</p>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!h-2.5 !w-2.5 !border-2 !border-white !bg-blue-500" />
    </div>
  );
});
StoryNode.displayName = "StoryNode";

const SprintNode = memo(({ data, selected }: NodeProps<MapNode>) => {
  const status = data.status || "planning";
  const active = status === "active";
  const completed = status === "completed";
  return (
    <div className={`w-64 rounded-2xl border-2 bg-white px-4 py-3 shadow-md transition ${selected ? "ring-4 ring-blue-100" : ""} ${active ? "border-emerald-400" : completed ? "border-slate-300" : "border-blue-300"}`}>
      <Handle type="target" position={Position.Top} className={`!h-2.5 !w-2.5 !border-2 !border-white ${active ? "!bg-emerald-500" : completed ? "!bg-slate-500" : "!bg-blue-500"}`} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[8px] font-black uppercase tracking-wide ${active ? "bg-emerald-100 text-emerald-700" : completed ? "bg-slate-100 text-slate-600" : "bg-blue-50 text-blue-700"}`}>
              {active ? <PlayCircle size={9} /> : completed ? <CheckCircle2 size={9} /> : <CircleDot size={9} />}
              {active ? "Activo" : completed ? "Cerrado" : "Planificación"}
            </span>
            <span className="text-[8px] font-black uppercase tracking-wide text-slate-400">Eje temporal</span>
          </div>
          <p className="mt-1.5 line-clamp-2 break-words text-xs font-black leading-4 text-slate-950">{data.title}</p>
          <p className="mt-1 text-[9px] font-semibold text-slate-500">{data.subtitle}</p>
          <ProgressBar value={data.progress || 0} tone={active ? "bg-emerald-500" : completed ? "bg-slate-500" : "bg-blue-500"} />
        </div>
        <CalendarClock size={16} className={active ? "shrink-0 text-emerald-600" : "shrink-0 text-slate-400"} />
      </div>
    </div>
  );
});
SprintNode.displayName = "SprintNode";

const BacklogNode = memo(({ data, selected }: NodeProps<MapNode>) => (
  <div className={`w-72 rounded-2xl border-2 border-dashed bg-amber-50 px-4 py-3 shadow-lg transition ${selected ? "border-amber-600 ring-4 ring-amber-100" : "border-amber-300"}`}>
    <div className="flex items-start gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white"><Archive size={19} /></div>
      <div className="min-w-0 flex-1">
        <p className="text-[9px] font-black uppercase tracking-[0.18em] text-amber-700">Estacionamiento</p>
        <p className="text-sm font-black text-slate-950">Backlog · {data.count || 0} por organizar</p>
        <p className="mt-1 line-clamp-2 text-[10px] font-semibold leading-4 text-amber-800">Doble clic para abrir grooming y planificación.</p>
      </div>
    </div>
    <Handle type="source" position={Position.Bottom} className="!h-2.5 !w-2.5 !border-2 !border-white !bg-amber-500" />
  </div>
));
BacklogNode.displayName = "BacklogNode";

const BacklogItemNode = memo(({ data, selected }: NodeProps<MapNode>) => (
  <div className={`w-64 rounded-xl border-2 border-dashed bg-white px-3.5 py-3 shadow-md transition ${selected ? "border-amber-600 ring-4 ring-amber-100" : "border-amber-200"}`}>
    <Handle type="target" position={Position.Top} className="!h-2.5 !w-2.5 !border-2 !border-white !bg-amber-500" />
    <div className="flex min-w-0 items-start gap-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700"><Archive size={15} /></div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[9px] font-black uppercase tracking-[0.13em] text-amber-700">
          {data.kindLabel || "Trabajo"} · {data.code || "Sin código"}
        </p>
        <p className="mt-1 line-clamp-2 break-words text-xs font-black leading-4 text-slate-950">{data.title}</p>
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 text-[8px] font-black">
          <span className="rounded bg-amber-50 px-1.5 py-1 text-amber-800">{data.parkingReason || "Pendiente de organizar"}</span>
          {data.status && <span className="rounded bg-slate-100 px-1.5 py-1 text-slate-600">{getScrumStatusLabel(data.status)}</span>}
        </div>
      </div>
    </div>
  </div>
));
BacklogItemNode.displayName = "BacklogItemNode";

const nodeTypes = {
  project: RootNode,
  release: ReleaseNode,
  epic: EpicNode,
  group: GroupNode,
  story: StoryNode,
  sprint: SprintNode,
  backlog: BacklogNode,
  backlogItem: BacklogItemNode,
};

const toolbarButtonClass = "nodrag nopan inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[10px] font-black text-slate-700 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-50";

export function ProjectScrumMap({
  project,
  items,
  releases,
  groups,
  epics,
  sprints,
  members,
  onOpenItem,
  onOpenSprint,
  canManage = false,
  canCreateItems = false,
  canManageLifecycle = false,
  layout = null,
  onSaveLayout,
  onOpenBacklog,
  onCreateRelease,
  onEditRelease,
  onCreateEpic,
  onCreateGroup,
  onEditGroup,
  onDeleteGroup,
  onCreateStory,
  onCreateSprint,
  onEditSprint,
  onStartSprint,
  onCloseSprint,
  onDeleteSprint,
}: ProjectScrumMapProps) {
  const [showCompletedSprints, setShowCompletedSprints] = useState(layout?.showCompletedSprints ?? true);
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [isSavingLayout, setIsSavingLayout] = useState(false);
  const flowInstanceRef = useRef<ReactFlowInstance<MapNode, Edge> | null>(null);
  const viewportRef = useRef<Viewport>(layout?.viewport || EMPTY_VIEWPORT);
  const pendingViewportRef = useRef<Viewport | null>(layout?.viewport || null);
  const suppressViewportDirtyRef = useRef(false);
  const appliedLayoutSignatureRef = useRef<string | null>(null);
  const appliedGraphSignatureRef = useRef<string | null>(null);

  const { nodes: autoNodes, edges } = useMemo(() => {
    const releaseById = new Map(releases.map((release) => [release.id, release]));
    const epicById = new Map(epics.map((epic) => [epic.id, epic]));
    const groupById = new Map(groups.map((group) => [group.id, group]));
    const sprintById = new Map(sprints.map((sprint) => [sprint.id, sprint]));
    const validEpics = epics.filter((epic) => isRefined(epic) && releaseById.has(epic.scrumReleaseId));
    const validEpicIds = new Set(validEpics.map((epic) => epic.id));
    const validGroups = groups.filter((group) => {
      const epic = epicById.get(group.scrumEpicId);
      return Boolean(epic && validEpicIds.has(epic.id) && releaseById.has(group.scrumReleaseId || epic.scrumReleaseId));
    });
    const validGroupIds = new Set(validGroups.map((group) => group.id));
    const allValidSprints = sprints.filter((sprint) => validGroupIds.has(sprint.scrumGroupId));
    const allValidSprintIds = new Set(allValidSprints.map((sprint) => sprint.id));
    const validSprints = allValidSprints.filter((sprint) => showCompletedSprints || getSprintStatus(sprint) !== "completed");
    const sprintByVisibleId = new Map(validSprints.map((sprint) => [sprint.id, sprint]));

    const getPrimaryGroupId = (item: any) => item.scrumGroupId || sprintById.get(item.sprintId)?.scrumGroupId || "";
    const validStories = items
      .filter((item) => getMapScrumKind(item) === "story" && isRefined(item))
      .filter((item) => validGroupIds.has(getPrimaryGroupId(item)))
      .filter((item) => !item.sprintId || allValidSprintIds.has(item.sprintId))
      .sort((left, right) => Number(left.scrumRank || left.displayOrder || 0) - Number(right.scrumRank || right.displayOrder || 0));
    const validStoryIds = new Set(validStories.map((story) => story.id));

    const parkingItems = items
      .filter((item) => {
        const kind = getMapScrumKind(item);
        if (!isRefined(item)) return true;
        if (kind === "epic") return !validEpicIds.has(item.id);
        if (kind === "story") return !validStoryIds.has(item.id);
        if (!validGroupIds.has(getPrimaryGroupId(item))) return true;
        if (item.sprintId) return !allValidSprintIds.has(item.sprintId);
        return true;
      })
      .sort((left, right) => {
        const rankDifference = Number(left.scrumRank || left.displayOrder || 0) - Number(right.scrumRank || right.displayOrder || 0);
        if (rankDifference !== 0) return rankDifference;
        return String(left.title || left.name || "").localeCompare(String(right.title || right.name || ""), "es");
      });
    const legacySprints = sprints.filter((sprint) => !validGroupIds.has(sprint.scrumGroupId));

    const getParkingReason = (item: any) => {
      const kind = getMapScrumKind(item);
      if (!isRefined(item)) return "Pendiente de grooming";
      if (kind === "epic") return "Falta asignar Release";
      if (item.sprintId && !allValidSprintIds.has(item.sprintId)) return "Sprint por reorganizar";
      if (!validGroupIds.has(getPrimaryGroupId(item))) return "Falta organizar su arquitectura";
      if (normalizeScrumStatus(item.scrumStatus || item.status) === "done") return "Terminado sin sprint asociado";
      return "Listo para planificar";
    };

    type Lane = { release: any; epic?: any; group?: any };
    const lanes: Lane[] = [];
    releases.forEach((release) => {
      const releaseEpics = validEpics.filter((epic) => epic.scrumReleaseId === release.id);
      if (releaseEpics.length === 0) {
        lanes.push({ release });
        return;
      }
      releaseEpics.forEach((epic) => {
        const epicGroups = validGroups.filter((group) => group.scrumEpicId === epic.id);
        if (epicGroups.length === 0) lanes.push({ release, epic });
        else epicGroups.forEach((group) => lanes.push({ release, epic, group }));
      });
    });

    const showBacklog = parkingItems.length > 0 || legacySprints.length > 0;
    const laneWidth = 570;
    const backlogColumns = parkingItems.length > 5 ? 2 : 1;
    const backlogWidth = showBacklog ? backlogColumns * 280 + 20 : 0;
    const mainOffset = showBacklog ? backlogWidth + 70 : 0;
    const laneCount = Math.max(1, lanes.length);
    const totalWidth = laneCount * laneWidth;
    const laneCenterX = (index: number, nodeWidth: number) => mainOffset + index * laneWidth + laneWidth / 2 - nodeWidth / 2;
    const laneStartX = (index: number) => mainOffset + index * laneWidth;
    const rangeCenterX = (indices: number[], nodeWidth: number) => {
      const first = Math.min(...indices);
      const last = Math.max(...indices);
      return mainOffset + ((first + last + 1) * laneWidth) / 2 - nodeWidth / 2;
    };

    const nextNodes: MapNode[] = [
      {
        id: "project-root",
        type: "project",
        position: { x: mainOffset + totalWidth / 2 - 160, y: 20 },
        data: {
          entityType: "project",
          entity: project,
          title: project?.name || "Proyecto",
          subtitle: project?.scrumSettings?.productGoal || "Objetivo general del producto",
        },
      },
    ];
    const nextEdges: Edge[] = [];

    if (showBacklog) {
      const backlogNodeX = Math.max(0, (backlogWidth - 288) / 2);
      nextNodes.push({
        id: "product-backlog",
        type: "backlog",
        position: { x: backlogNodeX, y: 20 },
        data: {
          entityType: "backlog",
          title: "Backlog",
          count: parkingItems.length + legacySprints.length,
          subtitle: `${parkingItems.length} elemento(s) · ${legacySprints.length} sprint(s) por organizar`,
        },
      });

      parkingItems.forEach((item, index) => {
        const backlogItemNodeId = `backlog-item-${item.id}`;
        const column = index % backlogColumns;
        const row = Math.floor(index / backlogColumns);
        nextNodes.push({
          id: backlogItemNodeId,
          type: "backlogItem",
          position: { x: 10 + column * 280, y: 155 + row * 125 },
          data: {
            entityType: "backlogItem",
            entity: item,
            item,
            title: item.title || item.name || "Trabajo sin título",
            code: item.scrumCode || item.code,
            status: normalizeScrumStatus(item.scrumStatus || item.status),
            kindLabel: getScrumTaskTypeLabel(item),
            parkingReason: getParkingReason(item),
          },
        });
        nextEdges.push({
          id: `product-backlog-${backlogItemNodeId}`,
          source: "product-backlog",
          target: backlogItemNodeId,
          type: "smoothstep",
          style: { stroke: "#f59e0b", strokeWidth: 1.6, strokeDasharray: "6 5" },
        });
      });
    }

    releases.forEach((release) => {
      const laneIndices = lanes
        .map((lane, index) => lane.release.id === release.id ? index : -1)
        .filter((index) => index >= 0);
      if (laneIndices.length === 0) return;
      const releaseEpics = validEpics.filter((epic) => epic.scrumReleaseId === release.id);
      const releaseItems = items.filter((item) => getMapScrumKind(item) !== "epic" && (item.scrumReleaseId === release.id || releaseEpics.some((epic) => epic.id === item.scrumEpicId)));
      const releaseSprints = allValidSprints.filter((sprint) => sprint.scrumReleaseId === release.id || releaseEpics.some((epic) => epic.id === sprint.scrumEpicId));
      const metrics = getScrumScopeMetrics(releaseItems);
      const releaseNodeId = `release-${release.id}`;
      nextNodes.push({
        id: releaseNodeId,
        type: "release",
        position: { x: rangeCenterX(laneIndices, 288), y: 175 },
        data: {
          entityType: "release",
          entity: release,
          release,
          title: release.name || "Release",
          code: release.releaseCode,
          subtitle: `${releaseEpics.length} épica(s) · ${releaseSprints.length} sprint(s)`,
          progress: metrics.progress,
        },
      });
      nextEdges.push({ id: `project-${releaseNodeId}`, source: "project-root", target: releaseNodeId, type: "smoothstep", style: { stroke: "#4f46e5", strokeWidth: 2 } });

      releaseEpics.forEach((epic) => {
        const epicLaneIndices = lanes
          .map((lane, index) => lane.epic?.id === epic.id ? index : -1)
          .filter((index) => index >= 0);
        if (epicLaneIndices.length === 0) return;
        const epicGroups = validGroups.filter((group) => group.scrumEpicId === epic.id);
        const epicItems = items.filter((item) => getMapScrumKind(item) !== "epic" && item.scrumEpicId === epic.id);
        const epicMetrics = getScrumScopeMetrics(epicItems);
        const epicNodeId = `epic-${epic.id}`;
        nextNodes.push({
          id: epicNodeId,
          type: "epic",
          position: { x: rangeCenterX(epicLaneIndices, 288), y: 335 },
          data: {
            entityType: "epic",
            entity: epic,
            item: epic,
            title: epic.title || epic.name || "Épica",
            code: epic.scrumCode,
            subtitle: `${epicGroups.length} submódulo(s) · ${epicItems.filter((item) => getMapScrumKind(item) === "story").length} historia(s)`,
            progress: epicMetrics.progress,
          },
        });
        nextEdges.push({ id: `${releaseNodeId}-${epicNodeId}`, source: releaseNodeId, target: epicNodeId, type: "smoothstep", style: { stroke: "#8b5cf6", strokeWidth: 2 } });

        epicGroups.forEach((group) => {
          const laneIndex = lanes.findIndex((lane) => lane.group?.id === group.id);
          if (laneIndex < 0) return;
          const groupSprints = validSprints.filter((sprint) => sprint.scrumGroupId === group.id);
          const allGroupSprints = allValidSprints.filter((sprint) => sprint.scrumGroupId === group.id);
          const groupSprintIds = new Set(allGroupSprints.map((sprint) => sprint.id));
          const groupItems = items.filter((item) => getMapScrumKind(item) !== "epic" && (getPrimaryGroupId(item) === group.id || groupSprintIds.has(item.sprintId)));
          const groupStories = validStories.filter((story) => getPrimaryGroupId(story) === group.id);
          const groupMetrics = getScrumScopeMetrics(groupItems);
          const activeCount = allGroupSprints.filter((sprint) => getSprintStatus(sprint) === "active").length;
          const groupNodeId = `group-${group.id}`;
          nextNodes.push({
            id: groupNodeId,
            type: "group",
            position: { x: laneCenterX(laneIndex, 256), y: 495 },
            data: {
              entityType: "group",
              entity: group,
              group,
              title: group.name || "Submódulo",
              code: getSubmoduleCode(group),
              subtitle: `${groupStories.length} historia(s) · ${allGroupSprints.length} sprint(s) · ${activeCount} activo(s)`,
              progress: groupMetrics.progress,
              activeCount,
            },
          });
          nextEdges.push({ id: `${epicNodeId}-${groupNodeId}`, source: epicNodeId, target: groupNodeId, type: "smoothstep", style: { stroke: "#0891b2", strokeWidth: 2 } });

          const storyColumns = 2;
          const storyRows = Math.ceil(groupStories.length / storyColumns);
          groupStories.forEach((story, storyIndex) => {
            const memberIds = Array.isArray(story.scrumAssigneeIds) && story.scrumAssigneeIds.length > 0
              ? story.scrumAssigneeIds
              : [story.assignedTo].filter(Boolean);
            const assignees = memberIds
              .map((memberId: string) => members.find((member) => member.id === memberId))
              .filter(Boolean)
              .map((member: any) => member.name || member.displayName || member.email)
              .join(", ");
            const impactedGroupIds = getStorySubmoduleIds(story)
              .filter((groupId) => groupId !== group.id && validGroupIds.has(groupId));
            const storyNodeId = `story-${story.id}`;
            const column = storyIndex % storyColumns;
            const row = Math.floor(storyIndex / storyColumns);
            nextNodes.push({
              id: storyNodeId,
              type: "story",
              position: { x: laneStartX(laneIndex) + 25 + column * 270, y: 650 + row * 135 },
              data: {
                entityType: "story",
                entity: story,
                item: story,
                title: story.title || story.name || "Historia sin título",
                code: story.scrumCode,
                status: normalizeScrumStatus(story.scrumStatus || story.status),
                assignee: assignees,
                progress: getScrumProgress(normalizeScrumStatus(story.scrumStatus || story.status), story.progress || 0),
                specCompleteness: getStorySpecCompleteness(story),
                impactedCount: impactedGroupIds.length,
              },
            });
            nextEdges.push({
              id: `${groupNodeId}-${storyNodeId}`,
              source: groupNodeId,
              target: storyNodeId,
              type: "smoothstep",
              style: { stroke: "#0891b2", strokeWidth: 1.8 },
            });
            impactedGroupIds.forEach((impactedGroupId) => {
              nextEdges.push({
                id: `impact-group-${impactedGroupId}-${storyNodeId}`,
                source: `group-${impactedGroupId}`,
                target: storyNodeId,
                type: "smoothstep",
                style: { stroke: "#06b6d4", strokeWidth: 1.5, strokeDasharray: "7 6", opacity: 0.8 },
              });
            });
          });

          const sprintStartY = 650 + Math.max(1, storyRows) * 135 + 70;
          groupSprints.forEach((sprint, sprintIndex) => {
            const sprintItems = items.filter((item) => getMapScrumKind(item) !== "epic" && item.sprintId === sprint.id);
            const sprintMetrics = getSprintMetrics(sprint, sprintItems);
            const status = getSprintStatus(sprint);
            const sprintNodeId = `sprint-${sprint.id}`;
            const column = sprintIndex % 2;
            const row = Math.floor(sprintIndex / 2);
            nextNodes.push({
              id: sprintNodeId,
              type: "sprint",
              position: { x: laneStartX(laneIndex) + 19 + column * 278, y: sprintStartY + row * 145 },
              data: {
                entityType: "sprint",
                entity: sprint,
                sprint,
                title: sprint.name || "Sprint",
                subtitle: `${sprintMetrics.completedItems}/${sprintMetrics.totalItems} tareas · ${sprintMetrics.completedPoints}/${sprintMetrics.totalPoints} pts`,
                status,
                progress: sprintMetrics.progress,
              },
            });

            validStories
              .filter((story) => story.sprintId === sprint.id && sprintByVisibleId.has(story.sprintId))
              .forEach((story) => {
                nextEdges.push({
                  id: `timeline-story-${story.id}-${sprintNodeId}`,
                  source: `story-${story.id}`,
                  target: sprintNodeId,
                  type: "smoothstep",
                  animated: status === "active",
                  style: {
                    stroke: status === "active" ? "#10b981" : status === "completed" ? "#64748b" : "#3b82f6",
                    strokeWidth: status === "active" ? 2 : 1.5,
                    strokeDasharray: "5 6",
                  },
                });
              });
          });
        });
      });
    });

    return { nodes: nextNodes, edges: nextEdges };
  }, [epics, groups, items, members, project, releases, showCompletedSprints, sprints]);

  const layoutSignature = useMemo(() => JSON.stringify({
    schemaVersion: layout?.schemaVersion || 1,
    positions: layout?.positions || {},
    viewport: layout?.viewport || null,
    showCompletedSprints: layout?.showCompletedSprints ?? true,
  }), [layout]);

  const graphSignature = useMemo(
    () => autoNodes.map((node) => node.id).sort().join("|"),
    [autoNodes],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<MapNode>([]);

  const moveViewport = useCallback((viewport?: Viewport | null) => {
    const instance = flowInstanceRef.current;
    if (!instance) {
      pendingViewportRef.current = viewport || null;
      return;
    }
    suppressViewportDirtyRef.current = true;
    const operation = viewport
      ? instance.setViewport(viewport, { duration: 240 })
      : instance.fitView({ padding: 0.12, maxZoom: 0.9, minZoom: 0.1, duration: 240 });
    void Promise.resolve(operation).finally(() => {
      window.setTimeout(() => {
        suppressViewportDirtyRef.current = false;
      }, 40);
    });
  }, []);

  useEffect(() => {
    const layoutChanged = appliedLayoutSignatureRef.current !== layoutSignature;
    const graphChanged = appliedGraphSignatureRef.current !== graphSignature;
    const savedPositions = layout?.positions || {};
    setNodes((currentNodes) => {
      const currentById = new Map(currentNodes.map((node) => [node.id, node]));
      return autoNodes.map((node) => {
        const currentNode = currentById.get(node.id);
        return {
          ...node,
          position: layoutChanged
            ? savedPositions[node.id] || node.position
            : currentNode?.position || savedPositions[node.id] || node.position,
          selected: node.id === selectedNodeId,
          draggable: canManage,
        };
      });
    });

    if (layoutChanged) {
      appliedLayoutSignatureRef.current = layoutSignature;
      const restoredShowCompleted = layout?.showCompletedSprints ?? true;
      if (restoredShowCompleted !== showCompletedSprints) setShowCompletedSprints(restoredShowCompleted);
      viewportRef.current = layout?.viewport || EMPTY_VIEWPORT;
      pendingViewportRef.current = layout?.viewport || null;
      window.requestAnimationFrame(() => moveViewport(layout?.viewport || null));
      setIsDirty(false);
    } else if (graphChanged && !layout && !isDirty) {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => moveViewport(null));
      });
    }
    appliedGraphSignatureRef.current = graphSignature;
  }, [autoNodes, canManage, graphSignature, isDirty, layout, layoutSignature, moveViewport, selectedNodeId, setNodes, showCompletedSprints]);

  useEffect(() => {
    if (selectedNodeId && !nodes.some((node) => node.id === selectedNodeId)) setSelectedNodeId("");
  }, [nodes, selectedNodeId]);

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || null;

  const handleAutoArrange = () => {
    setNodes(autoNodes.map((node) => ({ ...node, selected: node.id === selectedNodeId, draggable: canManage })));
    setIsDirty(true);
    window.requestAnimationFrame(() => moveViewport(null));
  };

  const handleRestoreLayout = () => {
    const savedPositions = layout?.positions || {};
    const restoredShowCompleted = layout?.showCompletedSprints ?? true;
    setShowCompletedSprints(restoredShowCompleted);
    setNodes(autoNodes.map((node) => ({
      ...node,
      position: savedPositions[node.id] || node.position,
      selected: node.id === selectedNodeId,
      draggable: canManage,
    })));
    viewportRef.current = layout?.viewport || EMPTY_VIEWPORT;
    setIsDirty(false);
    window.requestAnimationFrame(() => moveViewport(layout?.viewport || null));
  };

  const handleSaveLayout = async () => {
    if (!canManage || !onSaveLayout || isSavingLayout) return;
    setIsSavingLayout(true);
    try {
      const currentNodes = flowInstanceRef.current?.getNodes() || nodes;
      const currentViewport = flowInstanceRef.current?.getViewport() || viewportRef.current;
      await onSaveLayout({
        schemaVersion: 1,
        positions: Object.fromEntries(currentNodes.map((node) => [node.id, { x: node.position.x, y: node.position.y }])),
        viewport: currentViewport,
        showCompletedSprints,
      });
      setIsDirty(false);
    } finally {
      setIsSavingLayout(false);
    }
  };

  const openNode = useCallback((node: MapNode) => {
    const { entityType, entity } = node.data;
    if (entityType === "backlog") onOpenBacklog?.();
    if ((entityType === "backlogItem" || entityType === "epic" || entityType === "story") && entity) onOpenItem(entity);
    if (entityType === "sprint" && entity) onOpenSprint?.(entity);
    if (entityType === "release" && entity && canManage) onEditRelease?.(entity);
    if (entityType === "group" && entity && canManage) onEditGroup?.(entity);
  }, [canManage, onEditGroup, onEditRelease, onOpenBacklog, onOpenItem, onOpenSprint]);

  const renderSelectedActions = () => {
    if (!selectedNode) return null;
    const { entityType, entity } = selectedNode.data;
    const sprintStatus = entityType === "sprint" ? getSprintStatus(entity) : null;
    return (
      <div className="nodrag nopan w-[min(360px,calc(100vw-32px))] rounded-xl border border-slate-200 bg-white/95 p-3 shadow-xl backdrop-blur">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[9px] font-black uppercase tracking-[0.14em] text-indigo-600">{selectedNode.data.entityType === "group" ? "Submódulo" : selectedNode.data.entityType}</p>
            <p className="mt-0.5 line-clamp-2 break-words text-xs font-black text-slate-950">{selectedNode.data.title}</p>
          </div>
          <span className="shrink-0 rounded bg-slate-100 px-2 py-1 text-[8px] font-black uppercase text-slate-500">Seleccionado</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {entityType === "project" && canManage && onCreateRelease && (
            <button type="button" onClick={onCreateRelease} className={toolbarButtonClass}><Plus size={12} /> Release</button>
          )}
          {entityType === "backlog" && onOpenBacklog && (
            <button type="button" onClick={onOpenBacklog} className={toolbarButtonClass}><Archive size={12} /> Abrir backlog</button>
          )}
          {entityType === "backlogItem" && entity && (
            <button type="button" onClick={() => onOpenItem(entity)} className={toolbarButtonClass}><BookOpen size={12} /> Abrir trabajo</button>
          )}
          {entityType === "release" && entity && (
            <>
              {canManage && onEditRelease && <button type="button" onClick={() => onEditRelease(entity)} className={toolbarButtonClass}><Pencil size={12} /> Editar</button>}
              {canCreateItems && onCreateEpic && <button type="button" onClick={() => onCreateEpic(entity.id)} className={toolbarButtonClass}><Plus size={12} /> Épica</button>}
            </>
          )}
          {entityType === "epic" && entity && (
            <>
              <button type="button" onClick={() => onOpenItem(entity)} className={toolbarButtonClass}><BookOpen size={12} /> Abrir</button>
              {canManage && onCreateGroup && <button type="button" onClick={() => onCreateGroup(entity.id)} className={toolbarButtonClass}><Plus size={12} /> Submódulo</button>}
            </>
          )}
          {entityType === "group" && entity && (
            <>
              {canManage && onEditGroup && <button type="button" onClick={() => onEditGroup(entity)} className={toolbarButtonClass}><Pencil size={12} /> Editar</button>}
              {canCreateItems && onCreateStory && (
                <button type="button" onClick={() => onCreateStory({ releaseId: entity.scrumReleaseId || "", epicId: entity.scrumEpicId || "", groupId: entity.id })} className={toolbarButtonClass}><Plus size={12} /> Historia</button>
              )}
              {canManage && onCreateSprint && <button type="button" onClick={() => onCreateSprint(entity.id)} className={toolbarButtonClass}><CalendarDays size={12} /> Sprint</button>}
              {canManage && onDeleteGroup && <button type="button" onClick={() => onDeleteGroup(entity)} className={`${toolbarButtonClass} !border-red-200 !text-red-600 hover:!bg-red-50`}><Trash2 size={12} /> Eliminar</button>}
            </>
          )}
          {entityType === "story" && entity && (
            <button type="button" onClick={() => onOpenItem(entity)} className={toolbarButtonClass}><BookOpen size={12} /> Abrir historia</button>
          )}
          {entityType === "sprint" && entity && (
            <>
              {onOpenSprint && <button type="button" onClick={() => onOpenSprint(entity)} className={toolbarButtonClass}><CalendarDays size={12} /> Abrir tablero</button>}
              {canManage && onEditSprint && <button type="button" onClick={() => onEditSprint(entity)} className={toolbarButtonClass}><Pencil size={12} /> Editar</button>}
              {canManageLifecycle && sprintStatus === "planning" && onStartSprint && <button type="button" onClick={() => onStartSprint(entity)} className={toolbarButtonClass}><PlayCircle size={12} /> Iniciar</button>}
              {canManageLifecycle && sprintStatus === "active" && onCloseSprint && <button type="button" onClick={() => onCloseSprint(entity)} className={toolbarButtonClass}><CheckCircle2 size={12} /> Cerrar</button>}
              {canManage && onDeleteSprint && <button type="button" onClick={() => onDeleteSprint(entity)} className={`${toolbarButtonClass} !border-red-200 !text-red-600 hover:!bg-red-50`}><Trash2 size={12} /> Eliminar</button>}
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex min-w-0 flex-col gap-2 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-indigo-600">Mapa de control del producto</p>
          <h3 className="mt-0.5 truncate text-base font-black text-slate-950">Release → Épica → Submódulo → Historias · Sprints como eje temporal</h3>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5 text-[9px] font-black">
          <span className="rounded bg-indigo-50 px-2 py-1 text-indigo-700">{releases.length} Releases</span>
          <span className="rounded bg-violet-50 px-2 py-1 text-violet-700">{epics.length} épicas</span>
          <span className="rounded bg-cyan-50 px-2 py-1 text-cyan-800">{groups.length} submódulos</span>
          <span className="rounded bg-blue-50 px-2 py-1 text-blue-700">{items.filter((item) => getMapScrumKind(item) === "story" && isRefined(item)).length} historias</span>
        </div>
      </div>

      <div className="relative min-h-[560px] w-full bg-slate-50" style={{ height: "min(780px, calc(100dvh - 190px))" }}>
        <ReactFlow<MapNode, Edge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          fitView
          fitViewOptions={{ padding: 0.12, minZoom: 0.1, maxZoom: 0.9 }}
          minZoom={0.08}
          maxZoom={1.6}
          nodesDraggable={canManage}
          nodesConnectable={false}
          elementsSelectable
          selectNodesOnDrag={false}
          onInit={(instance) => {
            flowInstanceRef.current = instance;
            const pendingViewport = pendingViewportRef.current;
            pendingViewportRef.current = null;
            window.requestAnimationFrame(() => moveViewport(pendingViewport));
          }}
          onNodeClick={(_, node) => setSelectedNodeId(node.id)}
          onNodeDoubleClick={(_, node) => openNode(node)}
          onNodeDragStop={() => setIsDirty(true)}
          onPaneClick={() => setSelectedNodeId("")}
          onMoveEnd={(_, viewport) => {
            viewportRef.current = viewport;
            if (!suppressViewportDirtyRef.current) setIsDirty(true);
          }}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={22} size={1} color="#cbd5e1" />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            nodeStrokeWidth={3}
            nodeColor={(node) => {
              if (node.type === "release") return "#4f46e5";
              if (node.type === "epic") return "#8b5cf6";
              if (node.type === "group") return "#0891b2";
              if (node.type === "story") return "#2563eb";
              if (node.type === "sprint") return "#10b981";
              if (node.type === "backlogItem") return "#fbbf24";
              if (node.type === "backlog") return "#f59e0b";
              return "#0f172a";
            }}
            className="!border !border-slate-200 !bg-white/90 !shadow-lg"
          />

          <Panel position="top-left" className="m-3 flex max-w-[calc(100vw-40px)] flex-wrap gap-1.5 rounded-xl border border-slate-200 bg-white/95 p-2 shadow-lg backdrop-blur">
            {canManage && onSaveLayout && (
              <button type="button" onClick={handleSaveLayout} disabled={isSavingLayout || !isDirty} className={toolbarButtonClass} title="Guardar posiciones, zoom y filtros">
                <Save size={12} /> {isSavingLayout ? "Guardando..." : isDirty ? "Guardar vista" : "Vista guardada"}
              </button>
            )}
            {canManage && (
              <button type="button" onClick={handleAutoArrange} className={toolbarButtonClass} title="Volver a calcular la distribución"><WandSparkles size={12} /> Autoorganizar</button>
            )}
            <button type="button" onClick={() => moveViewport(null)} className={toolbarButtonClass} title="Centrar todos los elementos"><Maximize2 size={12} /> Centrar</button>
            <button type="button" onClick={handleRestoreLayout} className={toolbarButtonClass} title="Restaurar la última vista guardada"><RotateCcw size={12} /> Restaurar</button>
            <button
              type="button"
              onClick={() => {
                setShowCompletedSprints((current) => !current);
                setIsDirty(true);
              }}
              className={toolbarButtonClass}
            >
              {showCompletedSprints ? <EyeOff size={12} /> : <Eye size={12} />}
              {showCompletedSprints ? "Ocultar cerrados" : "Ver cerrados"}
            </button>
            {canManage && onCreateRelease && <button type="button" onClick={onCreateRelease} className={toolbarButtonClass}><Plus size={12} /> Release</button>}
          </Panel>

          {selectedNode && <Panel position="top-right" className="m-3">{renderSelectedActions()}</Panel>}
        </ReactFlow>
      </div>
    </section>
  );
}
