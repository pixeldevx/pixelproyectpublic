"use client";

/* eslint-disable @next/next/no-img-element */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Database,
  Eraser,
  Eye,
  Layers,
  Loader2,
  MapPin,
  MousePointer2,
  Palette,
  Pause,
  PenLine,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Save,
  Search,
  Settings2,
  SkipBack,
  SkipForward,
  Trash2,
  Type,
  Undo2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ref, uploadBytesToSupabase, getDownloadURL, deleteObject } from "@/lib/supabase/storage-shim";
import { storage, supabase } from "@/lib/backend";
import { collection, deleteDoc, doc, getDocs, serverTimestamp, setDoc } from "@/lib/supabase/document-store";
import { getTaskDateValue, isCompletedTaskStatus } from "@/lib/taskProgress";
import { toast } from "sonner";
import {
  getTaskDepartment,
  getTaskMunicipality,
  getTaskMunicipalityCode,
  getTaskMunicipalityDepartmentKey,
} from "@/lib/colombia-locations";

type GeoJsonGeometry = {
  type: string;
  coordinates?: any;
};

type GeoJsonFeature = {
  type: "Feature";
  geometry: GeoJsonGeometry | null;
  properties?: Record<string, any>;
};

type GeoJsonFeatureCollection = {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
};

type SpatialLayerManifest = {
  kind: "pixel-spatial-layer-manifest";
  version: 1;
  featureCount: number;
  chunks: Array<{
    storagePath: string;
    downloadUrl: string;
    featureCount: number;
    size: number;
  }>;
};

type GeoJsonBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

type LayerThemeMode = "task_status" | "attribute" | "unique";

type SpatialStyleKey = "unlinked" | "pending" | "not_started" | "in_progress" | "completed" | "completed_late" | "stuck";
type SpatialViewMode = "current" | "simulation" | "audit";
type SpatialTaskViewScope = "all" | "task" | "group";
type TemporalStateKey = "unlinked" | "not_started" | "active" | "completed" | "overdue" | "stuck";
type PlanAuditRiskLevel = "ok" | "watch" | "risk" | "critical";

type LayerStateStyleConfig = {
  fillColor?: string;
  strokeColor?: string;
};

type LayerStyleConfig = {
  fillColor?: string;
  strokeColor?: string;
  fillOpacity?: number;
  strokeOpacity?: number;
  strokeWidth?: number;
  labelAttribute?: string;
  labelsVisible?: boolean;
  themeMode?: LayerThemeMode;
  themeAttribute?: string;
  attributeStyles?: Record<string, LayerStateStyleConfig>;
  statusStyles?: Partial<Record<SpatialStyleKey, LayerStateStyleConfig>>;
};

type NormalizedLayerStyleConfig = Required<Omit<LayerStyleConfig, "statusStyles" | "attributeStyles">> & {
  statusStyles: Record<SpatialStyleKey, Required<LayerStateStyleConfig>>;
  attributeStyles: Record<string, Required<LayerStateStyleConfig>>;
};

type SpatialLayer = {
  id: string;
  name?: string;
  fileName?: string;
  sourceType?: "geojson" | "shapefile";
  geojson?: GeoJsonFeatureCollection;
  storagePath?: string;
  downloadUrl?: string;
  bounds?: GeoJsonBounds | null;
  featureCount?: number;
  attributes?: string[];
  visible?: boolean;
  styleConfig?: LayerStyleConfig;
  joinConfig?: {
    joinMode?: "single" | "municipality_department";
    layerAttribute?: string;
    taskAttribute?: string;
    layerMunicipalityAttribute?: string;
    layerDepartmentAttribute?: string;
  };
  createdAt?: any;
  updatedAt?: any;
};

type SpatialAnnotationType = "polygon" | "label";
type SpatialAnnotationTool = SpatialAnnotationType | null;

type SpatialAnnotationStyle = {
  fillColor?: string;
  strokeColor?: string;
  textColor?: string;
  fillOpacity?: number;
  strokeOpacity?: number;
  strokeWidth?: number;
  fontSize?: number;
  showHalo?: boolean;
  scaleWithZoom?: boolean;
  zoomReference?: number;
};

type NormalizedAnnotationStyle = Required<SpatialAnnotationStyle>;

type SpatialAnnotationGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "Point"; coordinates: number[] };

type SpatialAnnotation = {
  id: string;
  projectId?: string;
  annotationType: SpatialAnnotationType;
  title: string;
  body?: string;
  geometry: SpatialAnnotationGeometry;
  styleConfig?: SpatialAnnotationStyle;
  visible?: boolean;
  rotation?: number;
  createdBy?: string | null;
  createdAt?: any;
  updatedAt?: any;
};

type SpatialTaskView = {
  id: string;
  projectId?: string;
  name: string;
  scope: SpatialTaskViewScope;
  taskIds?: string[];
  groupIds?: string[];
  includeSubtasks?: boolean;
  createdAt?: any;
  updatedAt?: any;
};

type TaskAttributeOption = {
  value: string;
  label: string;
  getValue: (task: any) => any;
};

type ProjectSpatialMapProps = {
  projectId: string;
  project: any;
  tasks: any[];
  teamMembers: any[];
  taskGroups?: any[];
  currentUser: any;
  canManage: boolean;
};

type ProjectedPoint = {
  x: number;
  y: number;
};

type FeatureJoin = {
  feature: GeoJsonFeature;
  key: string;
  tasks: any[];
  sourceIndex: number;
};

type LayerFeatureJoin = FeatureJoin & {
  featureId: string;
  layerId: string;
  layerName: string;
  layer: SpatialLayer;
  bounds: GeoJsonBounds;
  label: string;
  labelAttribute: string;
  layerAttribute: string;
  taskAttribute: string;
  style: NormalizedLayerStyleConfig;
};

type SpatialPlanIssue = {
  id: string;
  level: PlanAuditRiskLevel;
  title: string;
  detail: string;
  metric?: string;
  featureId?: string;
  taskId?: string;
  day?: string;
};

type FeatureWithBounds = {
  feature: GeoJsonFeature;
  bounds: GeoJsonBounds;
  sourceIndex: number;
};

type CanvasHitRegion = {
  featureId: string;
  layerId: string;
  path: Path2D;
  strokeWidth: number;
  points: Array<{ x: number; y: number; radius: number }>;
  screenArea: number;
  labelPoint?: ProjectedPoint | null;
  labelRect?: ScreenRect | null;
  drawOrder: number;
};

type AnnotationHitRegion = {
  annotationId: string;
  path?: Path2D;
  rect?: ScreenRect;
  strokeWidth: number;
};

type ScreenSelectionRect = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
};

type ScreenRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type SpatialPanelTab = "summary" | "views" | "simulation" | "analysis" | "style" | "search";

type SpatialLayerRow = {
  id: string;
  project_id: string;
  name: string;
  file_name?: string | null;
  source_type?: string | null;
  storage_path?: string | null;
  download_url?: string | null;
  bounds?: GeoJsonBounds | null;
  feature_count?: number | null;
  attributes?: string[] | null;
  visible?: boolean | null;
  style_config?: LayerStyleConfig | null;
  join_config?: SpatialLayer["joinConfig"] | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type SpatialAnnotationRow = {
  id: string;
  project_id: string;
  annotation_type: SpatialAnnotationType;
  title?: string | null;
  body?: string | null;
  geometry: SpatialAnnotationGeometry;
  style_config?: SpatialAnnotationStyle | null;
  visible?: boolean | null;
  rotation?: number | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

const makeFeatureId = (layerId: string, sourceIndex: number) => `${layerId}:${sourceIndex}`;

const OSM_TILE_URL = "https://tile.openstreetmap.org";
const SHP_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/shpjs@6.1.0/dist/shp.min.js";
const SPATIAL_LAYERS_TABLE = "project_spatial_layers";
const SPATIAL_ANNOTATIONS_TABLE = "project_spatial_annotations";
const SPATIAL_VIEWS_COLLECTION = "spatialViews";
const DEFAULT_SPATIAL_VIEW_ID = "__all__";
const DEFAULT_TASK_GROUP_ID = "__ungrouped__";
const DEFAULT_TASK_GROUP_NAME = "Sin grupo";
const TILE_SIZE = 256;
const MIN_ZOOM = 3;
const MAX_ZOOM = 22;
const MAX_TILE_ZOOM = 19;
const MAX_RENDER_FEATURES = 20000;
const SPATIAL_LAYER_CHUNK_TARGET_BYTES = 4 * 1024 * 1024;
const SPATIAL_LAYER_MAX_SINGLE_FEATURE_BYTES = 45 * 1024 * 1024;
const VIEWPORT_BOUNDS_PADDING_RATIO = 0.18;
const LABEL_HEIGHT = 20;
const LABEL_PADDING_X = 7;
const LABEL_COLLISION_PADDING = 4;
const DEFAULT_STATUS_STYLES: Record<SpatialStyleKey, Required<LayerStateStyleConfig>> = {
  unlinked: { fillColor: "#64748b", strokeColor: "#475569" },
  pending: { fillColor: "#94a3b8", strokeColor: "#64748b" },
  not_started: { fillColor: "#cbd5e1", strokeColor: "#94a3b8" },
  in_progress: { fillColor: "#f97316", strokeColor: "#ea580c" },
  completed: { fillColor: "#10b981", strokeColor: "#059669" },
  completed_late: { fillColor: "#c2410c", strokeColor: "#9a3412" },
  stuck: { fillColor: "#ef4444", strokeColor: "#dc2626" },
};
const ATTRIBUTE_STYLE_PALETTE = [
  "#2563eb",
  "#10b981",
  "#f97316",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
  "#f59e0b",
  "#ef4444",
  "#14b8a6",
  "#6366f1",
  "#0f172a",
];
const DEFAULT_LAYER_STYLE: NormalizedLayerStyleConfig = {
  fillColor: "#64748b",
  strokeColor: "#475569",
  fillOpacity: 0.18,
  strokeOpacity: 0.74,
  strokeWidth: 1.2,
  labelAttribute: "",
  labelsVisible: false,
  themeMode: "task_status",
  themeAttribute: "",
  attributeStyles: {},
  statusStyles: DEFAULT_STATUS_STYLES,
};
const DEFAULT_ANNOTATION_STYLE: NormalizedAnnotationStyle = {
  fillColor: "#8b5cf6",
  strokeColor: "#4f46e5",
  textColor: "#111827",
  fillOpacity: 0.2,
  strokeOpacity: 0.95,
  strokeWidth: 2,
  fontSize: 14,
  showHalo: true,
  scaleWithZoom: false,
  zoomReference: 16,
};
const TEMPORAL_STATUS_STYLES: Record<TemporalStateKey, Required<LayerStateStyleConfig>> = {
  unlinked: { fillColor: "#94a3b8", strokeColor: "#64748b" },
  not_started: { fillColor: "#cbd5e1", strokeColor: "#94a3b8" },
  active: { fillColor: "#2563eb", strokeColor: "#1d4ed8" },
  completed: { fillColor: "#10b981", strokeColor: "#059669" },
  overdue: { fillColor: "#ef4444", strokeColor: "#dc2626" },
  stuck: { fillColor: "#7c3aed", strokeColor: "#6d28d9" },
};
const TEMPORAL_STATUS_OPTIONS: Array<{ key: TemporalStateKey; label: string; helper: string }> = [
  { key: "unlinked", label: "Sin tarea", helper: "Geometrías sin tarea vinculada." },
  { key: "not_started", label: "Aún no inicia", helper: "La fecha simulada está antes del inicio planificado." },
  { key: "active", label: "Trabajando según plan", helper: "La tarea debería estar ejecutándose en la fecha simulada." },
  { key: "completed", label: "Cumplida en plan", helper: "La tarea ya debería estar cerrada según su cronograma." },
  { key: "overdue", label: "Atrasada", helper: "Escenario futuro para simulaciones con incumplimientos reales." },
  { key: "stuck", label: "Pausada", helper: "Escenario futuro para simulaciones con pausas reales." },
];
const PLAN_AUDIT_STYLES: Record<PlanAuditRiskLevel, Required<LayerStateStyleConfig>> = {
  ok: { fillColor: "#10b981", strokeColor: "#059669" },
  watch: { fillColor: "#f59e0b", strokeColor: "#d97706" },
  risk: { fillColor: "#f97316", strokeColor: "#ea580c" },
  critical: { fillColor: "#ef4444", strokeColor: "#dc2626" },
};
const PLAN_AUDIT_OPTIONS: Array<{ key: PlanAuditRiskLevel; label: string; helper: string }> = [
  { key: "ok", label: "Plan consistente", helper: "Geometrías con tarea, fecha y carga razonable." },
  { key: "watch", label: "Vigilancia", helper: "Hay un punto que conviene revisar antes de ejecutar." },
  { key: "risk", label: "Riesgo operativo", helper: "El plan muestra sobrecarga, dispersión o datos incompletos." },
  { key: "critical", label: "Crítico", helper: "La planificación puede fallar si no se ajusta." },
];
const planAuditMeta = Object.fromEntries(
  PLAN_AUDIT_OPTIONS.map((option) => [
    option.key,
    {
      label: option.label,
      color: PLAN_AUDIT_STYLES[option.key].fillColor,
      fill: PLAN_AUDIT_STYLES[option.key].fillColor,
      border: PLAN_AUDIT_STYLES[option.key].strokeColor,
    },
  ])
) as Record<PlanAuditRiskLevel, { label: string; color: string; fill: string; border: string }>;
const temporalStatusMeta = Object.fromEntries(
  TEMPORAL_STATUS_OPTIONS.map((option) => [
    option.key,
    {
      label: option.label,
      color: TEMPORAL_STATUS_STYLES[option.key].fillColor,
      fill: TEMPORAL_STATUS_STYLES[option.key].fillColor,
      border: TEMPORAL_STATUS_STYLES[option.key].strokeColor,
    },
  ])
) as Record<TemporalStateKey, { label: string; color: string; fill: string; border: string }>;
const SPATIAL_STATUS_STYLE_OPTIONS: Array<{ key: SpatialStyleKey; label: string; helper: string }> = [
  { key: "unlinked", label: "Sin tarea", helper: "Predios sin tarea vinculada." },
  { key: "pending", label: "Pendiente", helper: "Tareas pendientes o por gestionar." },
  { key: "not_started", label: "No iniciado", helper: "Subtareas o flujos aún sin iniciar." },
  { key: "in_progress", label: "Trabajando", helper: "Tareas activas en ejecución." },
  { key: "completed", label: "Finalizada", helper: "Predios o tareas cerradas a tiempo." },
  { key: "completed_late", label: "Finalizada con retraso", helper: "Cierres posteriores al cronograma." },
  { key: "stuck", label: "Estancada", helper: "Tareas pausadas o bloqueadas." },
];

const statusMeta: Record<string, { label: string; color: string; fill: string; border: string }> = {
  todo: { label: "Pendiente", color: "#64748b", fill: "rgba(100,116,139,.18)", border: "#64748b" },
  pending: { label: "Pendiente", color: "#64748b", fill: "rgba(100,116,139,.18)", border: "#64748b" },
  not_started: { label: "No iniciado", color: "#94a3b8", fill: "rgba(148,163,184,.16)", border: "#94a3b8" },
  in_progress: { label: "Trabajando", color: "#f97316", fill: "rgba(249,115,22,.24)", border: "#f97316" },
  trabajando: { label: "Trabajando", color: "#f97316", fill: "rgba(249,115,22,.24)", border: "#f97316" },
  completed: { label: "Finalizada", color: "#10b981", fill: "rgba(16,185,129,.24)", border: "#10b981" },
  completed_late: { label: "Finalizada con retraso", color: "#c2410c", fill: "rgba(194,65,12,.24)", border: "#c2410c" },
  listo: { label: "Finalizada", color: "#10b981", fill: "rgba(16,185,129,.24)", border: "#10b981" },
  stuck: { label: "Estancada", color: "#ef4444", fill: "rgba(239,68,68,.28)", border: "#ef4444" },
  estancada: { label: "Estancada", color: "#ef4444", fill: "rgba(239,68,68,.28)", border: "#ef4444" },
};

const normalizeKey = (value: any) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const clampNumber = (value: any, min: number, max: number, fallback: number) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.min(max, Math.max(min, numericValue));
};

const getAttributeCategory = (value: any) => {
  const text = String(value ?? "").trim();
  return text || "Sin valor";
};

const getTaskGroupId = (task: any) => task?.groupId || DEFAULT_TASK_GROUP_ID;

const getTaskParentId = (task: any) =>
  task?.parentTaskId || task?.parentId || task?.workflowParentId || task?.matrixTaskId || task?.rootTaskId || "";

const normalizeSpatialTaskView = (id: string, data: any): SpatialTaskView => ({
  id,
  projectId: data?.projectId,
  name: String(data?.name || "Vista sin nombre").trim() || "Vista sin nombre",
  scope: data?.scope === "task" || data?.scope === "group" ? data.scope : "all",
  taskIds: Array.isArray(data?.taskIds) ? data.taskIds.filter(Boolean) : [],
  groupIds: Array.isArray(data?.groupIds) ? data.groupIds.filter(Boolean) : [],
  includeSubtasks: data?.includeSubtasks !== false,
  createdAt: data?.createdAt,
  updatedAt: data?.updatedAt,
});

const createSpatialViewId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `view_${Date.now()}_${Math.random().toString(36).slice(2)}`;
};

const hashString = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const getGeneratedAttributeStyle = (category: string): Required<LayerStateStyleConfig> => {
  const color = ATTRIBUTE_STYLE_PALETTE[hashString(category) % ATTRIBUTE_STYLE_PALETTE.length];
  return { fillColor: color, strokeColor: color };
};

const normalizeLayerStyle = (style?: LayerStyleConfig | null): NormalizedLayerStyleConfig => {
  const fillColor = style?.fillColor || DEFAULT_LAYER_STYLE.fillColor;
  const strokeColor = style?.strokeColor || style?.fillColor || DEFAULT_LAYER_STYLE.strokeColor;
  const themeMode: LayerThemeMode =
    style?.themeMode === "attribute" ? "attribute" : style?.themeMode === "unique" ? "unique" : "task_status";

  const statusStyles = SPATIAL_STATUS_STYLE_OPTIONS.reduce<Record<SpatialStyleKey, Required<LayerStateStyleConfig>>>(
    (styles, option) => {
      const savedStyle = style?.statusStyles?.[option.key];
      const defaultStyle = DEFAULT_LAYER_STYLE.statusStyles[option.key];
      styles[option.key] = {
        fillColor: savedStyle?.fillColor || (option.key === "unlinked" ? fillColor : defaultStyle.fillColor),
        strokeColor: savedStyle?.strokeColor || savedStyle?.fillColor || (option.key === "unlinked" ? strokeColor : defaultStyle.strokeColor),
      };
      return styles;
    },
    {} as Record<SpatialStyleKey, Required<LayerStateStyleConfig>>
  );
  const attributeStyles = Object.entries(style?.attributeStyles || {}).reduce<Record<string, Required<LayerStateStyleConfig>>>(
    (styles, [category, savedStyle]) => {
      const fallbackStyle = getGeneratedAttributeStyle(category);
      styles[category] = {
        fillColor: savedStyle?.fillColor || fallbackStyle.fillColor,
        strokeColor: savedStyle?.strokeColor || savedStyle?.fillColor || fallbackStyle.strokeColor,
      };
      return styles;
    },
    {}
  );

  return {
    fillColor,
    strokeColor,
    fillOpacity: clampNumber(style?.fillOpacity, 0.04, 0.8, DEFAULT_LAYER_STYLE.fillOpacity),
    strokeOpacity: clampNumber(style?.strokeOpacity, 0.1, 1, DEFAULT_LAYER_STYLE.strokeOpacity),
    strokeWidth: clampNumber(style?.strokeWidth, 0.5, 6, DEFAULT_LAYER_STYLE.strokeWidth),
    labelAttribute: style?.labelAttribute || "",
    labelsVisible: style?.labelsVisible === true,
    themeMode,
    themeAttribute: style?.themeAttribute || "",
    attributeStyles,
    statusStyles,
  };
};

const normalizeAnnotationStyle = (style?: SpatialAnnotationStyle | null): NormalizedAnnotationStyle => ({
  fillColor: style?.fillColor || DEFAULT_ANNOTATION_STYLE.fillColor,
  strokeColor: style?.strokeColor || style?.fillColor || DEFAULT_ANNOTATION_STYLE.strokeColor,
  textColor: style?.textColor || DEFAULT_ANNOTATION_STYLE.textColor,
  fillOpacity: clampNumber(style?.fillOpacity, 0, 0.85, DEFAULT_ANNOTATION_STYLE.fillOpacity),
  strokeOpacity: clampNumber(style?.strokeOpacity, 0.1, 1, DEFAULT_ANNOTATION_STYLE.strokeOpacity),
  strokeWidth: clampNumber(style?.strokeWidth, 0.5, 10, DEFAULT_ANNOTATION_STYLE.strokeWidth),
  fontSize: clampNumber(style?.fontSize, 10, 34, DEFAULT_ANNOTATION_STYLE.fontSize),
  showHalo: style?.showHalo !== false,
  scaleWithZoom: style?.scaleWithZoom === true,
  zoomReference: clampNumber(style?.zoomReference, MIN_ZOOM, MAX_ZOOM, DEFAULT_ANNOTATION_STYLE.zoomReference),
});

const getZoomAwareAnnotationStyle = (
  style: NormalizedAnnotationStyle,
  zoom: number
): NormalizedAnnotationStyle => {
  if (!style.scaleWithZoom) return style;
  const zoomDelta = zoom - style.zoomReference;
  const scale = Math.pow(2, zoomDelta * 0.35);
  return {
    ...style,
    fontSize: clampNumber(style.fontSize * scale, 8, 72, style.fontSize),
    strokeWidth: clampNumber(style.strokeWidth * Math.pow(scale, 0.25), 0.5, 12, style.strokeWidth),
  };
};

const getFeatureVisualStyle = (
  join: LayerFeatureJoin,
  temporalContext?: { enabled: boolean; date: Date | null },
  auditContext?: { enabled: boolean; riskByFeatureId: Map<string, PlanAuditRiskLevel> }
): Required<LayerStateStyleConfig> => {
  if (auditContext?.enabled) {
    return PLAN_AUDIT_STYLES[auditContext.riskByFeatureId.get(join.featureId) || "watch"];
  }

  if (temporalContext?.enabled && temporalContext.date) {
    return TEMPORAL_STATUS_STYLES[getTemporalStateForJoin(join, temporalContext.date)];
  }

  if (join.style.themeMode === "attribute" && join.style.themeAttribute) {
    const category = getAttributeCategory(join.feature.properties?.[join.style.themeAttribute]);
    return join.style.attributeStyles[category] || getGeneratedAttributeStyle(category);
  }

  if (join.style.themeMode === "unique") {
    return { fillColor: join.style.fillColor, strokeColor: join.style.strokeColor };
  }

  return join.style.statusStyles[getSpatialStyleKeyForTask(join.tasks[0])];
};

const colorToRgba = (color: string, opacity: number) => {
  const normalized = color.replace("#", "");
  const fullHex = normalized.length === 3
    ? normalized.split("").map((char) => `${char}${char}`).join("")
    : normalized;
  const value = Number.parseInt(fullHex, 16);
  if (!Number.isFinite(value)) return `rgba(100,116,139,${opacity})`;
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red},${green},${blue},${opacity})`;
};

const safeFilePart = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .toLowerCase() || "layer";

const makeSpatialLayerStoragePath = (projectId: string, fileName: string) => {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `projects/${projectId}/spatial-layers/${suffix}-${safeFilePart(fileName.replace(/\.[^.]+$/, ""))}.geojson`;
};

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 1 : 2)} MB`;
};

const makeSpatialLayerChunks = (geojson: GeoJsonFeatureCollection, fileName: string) => {
  const prefix = '{"type":"FeatureCollection","features":[';
  const suffix = "]}";
  const baseName = safeFilePart(fileName.replace(/\.[^.]+$/, ""));
  const chunks: Array<{ file: File; featureCount: number }> = [];
  let serializedFeatures: string[] = [];
  let currentBytes = new Blob([prefix, suffix]).size;

  const flush = () => {
    if (serializedFeatures.length === 0) return;
    const featureCount = serializedFeatures.length;
    const partNumber = String(chunks.length + 1).padStart(4, "0");
    chunks.push({
      file: new File(
        [prefix, serializedFeatures.join(","), suffix],
        `${baseName}.part-${partNumber}.geojson`,
        { type: "application/geo+json" }
      ),
      featureCount,
    });
    serializedFeatures = [];
    currentBytes = new Blob([prefix, suffix]).size;
  };

  geojson.features.forEach((feature) => {
    const serialized = JSON.stringify(feature);
    const featureBytes = new Blob([serialized]).size;
    if (featureBytes > SPATIAL_LAYER_MAX_SINGLE_FEATURE_BYTES) {
      throw new Error(
        `Una geometría individual pesa ${formatBytes(featureBytes)}. Simplifica esa geometría a menos de ${formatBytes(SPATIAL_LAYER_MAX_SINGLE_FEATURE_BYTES)} antes de cargarla.`
      );
    }

    const separatorBytes = serializedFeatures.length > 0 ? 1 : 0;
    if (
      serializedFeatures.length > 0 &&
      currentBytes + separatorBytes + featureBytes > SPATIAL_LAYER_CHUNK_TARGET_BYTES
    ) {
      flush();
    }

    serializedFeatures.push(serialized);
    currentBytes += (serializedFeatures.length > 1 ? 1 : 0) + featureBytes;
  });

  flush();
  return chunks;
};

const isSpatialLayerManifest = (value: any): value is SpatialLayerManifest =>
  value?.kind === "pixel-spatial-layer-manifest" &&
  value?.version === 1 &&
  Array.isArray(value?.chunks);

const loadSpatialLayerGeoJson = async (downloadUrl: string, layerLabel: string) => {
  const response = await fetch(downloadUrl);
  if (!response.ok) throw new Error(`No se pudo descargar la geometría de ${layerLabel}.`);
  const parsed = await response.json();
  if (!isSpatialLayerManifest(parsed)) return normalizeGeoJson(parsed);

  const features: GeoJsonFeature[] = [];
  for (const chunk of parsed.chunks) {
    const chunkUrl = chunk.downloadUrl || await getDownloadURL(ref(storage, chunk.storagePath));
    const chunkResponse = await fetch(chunkUrl);
    if (!chunkResponse.ok) throw new Error(`No se pudo descargar un fragmento de ${layerLabel}.`);
    const collection = normalizeGeoJson(await chunkResponse.json());
    features.push(...collection.features);
  }

  return { type: "FeatureCollection", features } satisfies GeoJsonFeatureCollection;
};

const getSpatialLayerObjectPaths = async (layer: SpatialLayer) => {
  const objectPaths = new Set<string>();
  if (layer.storagePath) objectPaths.add(layer.storagePath);
  if (!layer.downloadUrl) return Array.from(objectPaths);

  try {
    const response = await fetch(layer.downloadUrl);
    if (!response.ok) return Array.from(objectPaths);
    const parsed = await response.json();
    if (isSpatialLayerManifest(parsed)) {
      parsed.chunks.forEach((chunk) => {
        if (chunk.storagePath) objectPaths.add(chunk.storagePath);
      });
    }
  } catch (error) {
    console.warn("Spatial layer manifest could not be read during cleanup:", error);
  }

  return Array.from(objectPaths);
};

const mapSpatialLayerRow = (row: SpatialLayerRow): SpatialLayer => ({
  id: row.id,
  name: row.name,
  fileName: row.file_name || undefined,
  sourceType: row.source_type === "shapefile" ? "shapefile" : "geojson",
  storagePath: row.storage_path || undefined,
  downloadUrl: row.download_url || undefined,
  bounds: row.bounds || null,
  featureCount: Number(row.feature_count || 0),
  attributes: Array.isArray(row.attributes) ? row.attributes : [],
  visible: row.visible !== false,
  styleConfig: normalizeLayerStyle(row.style_config),
  joinConfig: row.join_config || undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const isValidAnnotationGeometry = (geometry: any): geometry is SpatialAnnotationGeometry => {
  if (!geometry || typeof geometry !== "object") return false;
  if (geometry.type === "Point") {
    return Array.isArray(geometry.coordinates) && typeof geometry.coordinates[0] === "number" && typeof geometry.coordinates[1] === "number";
  }
  if (geometry.type === "Polygon") {
    return Array.isArray(geometry.coordinates?.[0]) && geometry.coordinates[0].length >= 4;
  }
  return false;
};

const mapSpatialAnnotationRow = (row: SpatialAnnotationRow): SpatialAnnotation | null => {
  if (!isValidAnnotationGeometry(row.geometry)) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    annotationType: row.annotation_type === "label" ? "label" : "polygon",
    title: row.title || (row.annotation_type === "label" ? "Etiqueta" : "Figura"),
    body: row.body || "",
    geometry: row.geometry,
    styleConfig: normalizeAnnotationStyle(row.style_config),
    visible: row.visible !== false,
    rotation: Number(row.rotation || 0),
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const getTaskTitle = (task: any) => task?.title || task?.name || task?.externalWorkflowId || "Tarea";

const getTaskStatus = (task: any) => String(task?.status || "todo").toLowerCase();

const getStatusMeta = (task: any) => statusMeta[getTaskStatus(task)] || statusMeta.todo;

const getSpatialStyleKeyForTask = (task?: any): SpatialStyleKey => {
  if (!task) return "unlinked";
  const status = getTaskStatus(task);
  if (status.includes("retraso") || status === "completed_late" || status === "late_completed") return "completed_late";
  if (["completed", "listo", "finalizada", "finalizado", "done"].includes(status)) return "completed";
  if (["in_progress", "trabajando", "en_curso", "working"].includes(status)) return "in_progress";
  if (["not_started", "no_iniciado", "sin_iniciar"].includes(status)) return "not_started";
  if (["stuck", "estancada", "estancado", "blocked", "bloqueada", "bloqueado"].includes(status)) return "stuck";
  return "pending";
};

const DAY_IN_MS = 86400000;

const startOfDay = (date: Date) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  next.setHours(0, 0, 0, 0);
  return next;
};

const formatDateInputValue = (date: Date) => {
  const safeDate = startOfDay(date);
  const year = safeDate.getFullYear();
  const month = String(safeDate.getMonth() + 1).padStart(2, "0");
  const day = String(safeDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseDateInputValue = (value: string) => {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : startOfDay(parsed);
};

const getDayOffset = (date: Date, startDate: Date) =>
  Math.max(0, Math.round((startOfDay(date).getTime() - startOfDay(startDate).getTime()) / DAY_IN_MS));

const getTaskPlanStartDate = (task: any) => getTaskDateValue(task?.startDate || task?.start || task?.plannedStartDate);

const getTaskPlanEndDate = (task: any) => getTaskDateValue(task?.endDate || task?.end || task?.dueDate || task?.plannedEndDate);

const getBoundsCenter = (bounds: GeoJsonBounds) => ({
  lon: (bounds.west + bounds.east) / 2,
  lat: (bounds.south + bounds.north) / 2,
});

const getDistanceKm = (left: { lon: number; lat: number }, right: { lon: number; lat: number }) => {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const deltaLat = toRadians(right.lat - left.lat);
  const deltaLon = toRadians(right.lon - left.lon);
  const leftLat = toRadians(left.lat);
  const rightLat = toRadians(right.lat);
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(leftLat) * Math.cos(rightLat) * Math.sin(deltaLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(haversine)));
};

const formatDistanceKm = (value: number) =>
  `${new Intl.NumberFormat("es-CO", { maximumFractionDigits: value >= 10 ? 0 : 1 }).format(value)} km`;

const riskRank: Record<PlanAuditRiskLevel, number> = {
  ok: 0,
  watch: 1,
  risk: 2,
  critical: 3,
};

const getHigherRisk = (current: PlanAuditRiskLevel, next: PlanAuditRiskLevel) =>
  riskRank[next] > riskRank[current] ? next : current;

const getTaskDateSpan = (task: any) => {
  const startDate = getTaskPlanStartDate(task);
  const endDate = getTaskPlanEndDate(task);
  if (!startDate && !endDate) return null;
  const start = startOfDay(startDate || endDate || new Date());
  const end = startOfDay(endDate || startDate || start);
  return start.getTime() <= end.getTime() ? { start, end } : { start: end, end: start };
};

const enumerateTaskPlanDays = (task: any, maxDays = 180) => {
  const span = getTaskDateSpan(task);
  if (!span) return [];
  const totalDays = Math.min(maxDays, getDayOffset(span.end, span.start) + 1);
  return Array.from({ length: Math.max(1, totalDays) }, (_, index) => formatDateInputValue(addDays(span.start, index)));
};

const getTemporalStateForTask = (task: any, simulationDate: Date): TemporalStateKey => {
  if (!task) return "unlinked";

  const status = getTaskStatus(task);
  const simulatedDay = startOfDay(simulationDate);
  const startDate = getTaskDateValue(task?.startDate || task?.start || task?.plannedStartDate);
  const endDate = getTaskDateValue(task?.endDate || task?.end || task?.dueDate || task?.plannedEndDate);
  const isCompleted = isCompletedTaskStatus(status);

  if (startDate && simulatedDay < startOfDay(startDate)) return "not_started";
  if (endDate && simulatedDay > startOfDay(endDate)) return "completed";
  if (startDate && endDate && simulatedDay >= startOfDay(startDate) && simulatedDay <= startOfDay(endDate)) return "active";
  if (startDate && !endDate && simulatedDay >= startOfDay(startDate)) return isCompleted ? "completed" : "active";
  if (!startDate && endDate && simulatedDay <= startOfDay(endDate)) return "active";
  return isCompleted ? "completed" : "not_started";
};

const getTemporalStateForJoin = (join: LayerFeatureJoin, simulationDate: Date): TemporalStateKey => {
  if (join.tasks.length === 0) return "unlinked";

  const states = join.tasks.map((task) => getTemporalStateForTask(task, simulationDate));
  if (states.includes("overdue")) return "overdue";
  if (states.includes("stuck")) return "stuck";
  if (states.includes("active")) return "active";
  if (states.every((state) => state === "completed")) return "completed";
  if (states.some((state) => state === "completed")) return "active";
  return "not_started";
};

const getMemberName = (memberById: Map<string, any>, memberId?: string) => {
  if (!memberId) return "Sin responsable";
  const member = memberById.get(memberId);
  return member?.name || member?.displayName || member?.email || "Sin responsable";
};

const formatDate = (value: any) => {
  const date = getTaskDateValue(value);
  if (!date) return "Sin fecha";
  return new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "short" }).format(date);
};

const formatMetricNumber = (value: number, fractionDigits = 0) =>
  new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  }).format(value);

const parseNumericAttribute = (value: any) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value ?? "").trim();
  if (!text) return null;
  const cleaned = text.replace(/[^\d,.-]/g, "");
  if (!cleaned) return null;
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  const normalized =
    lastComma > lastDot
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/,/g, "");
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizeScreenRect = (rect: ScreenSelectionRect) => ({
  left: Math.min(rect.startX, rect.endX),
  top: Math.min(rect.startY, rect.endY),
  width: Math.abs(rect.endX - rect.startX),
  height: Math.abs(rect.endY - rect.startY),
});

const makeScreenRect = (left: number, top: number, width: number, height: number): ScreenRect => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

const rectsIntersect = (left: ScreenRect, right: ScreenRect, padding = 0) =>
  left.left < right.right + padding &&
  left.right > right.left - padding &&
  left.top < right.bottom + padding &&
  left.bottom > right.top - padding;

const clampRectInside = (rect: ScreenRect, container: ScreenRect, padding = 2) => {
  const minLeft = container.left + padding;
  const maxLeft = container.right - rect.width - padding;
  const minTop = container.top + padding;
  const maxTop = container.bottom - rect.height - padding;

  if (maxLeft < minLeft || maxTop < minTop) return null;

  return makeScreenRect(
    clampNumber(rect.left, minLeft, maxLeft, rect.left),
    clampNumber(rect.top, minTop, maxTop, rect.top),
    rect.width,
    rect.height
  );
};

const getScheduleState = (task: any) => {
  if (isCompletedTaskStatus(task?.status)) return { label: "Cerrada", className: "bg-emerald-50 text-emerald-700" };
  const dueDate = getTaskDateValue(task?.endDate || task?.end);
  if (!dueDate) return { label: "Sin fecha", className: "bg-slate-100 text-slate-600" };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  const remainingDays = Math.ceil((due.getTime() - today.getTime()) / 86400000);

  if (remainingDays < 0) return { label: "Atrasada", className: "bg-red-50 text-red-700" };
  if (remainingDays <= 3) return { label: "Por vencer", className: "bg-orange-50 text-orange-700" };
  return { label: "A tiempo", className: "bg-emerald-50 text-emerald-700" };
};

const taskAttributeOptions: TaskAttributeOption[] = [
  { value: "externalWorkflowId", label: "ID de workflow / iteración", getValue: (task) => task.externalWorkflowId },
  { value: "id", label: "ID interno de tarea", getValue: (task) => task.id },
  { value: "title", label: "Nombre de la tarea", getValue: (task) => task.title || task.name },
  { value: "municipality", label: "Municipio", getValue: getTaskMunicipality },
  { value: "department", label: "Departamento", getValue: getTaskDepartment },
  { value: "municipalityCode", label: "Código oficial del municipio", getValue: getTaskMunicipalityCode },
  {
    value: "municipalityDepartment",
    label: "Municipio + departamento",
    getValue: getTaskMunicipalityDepartmentKey,
  },
  { value: "observation", label: "Observación", getValue: (task) => task.observation || task.observacion },
  { value: "spatialKey", label: "Clave espacial personalizada", getValue: (task) => task.spatialKey },
];

const getTaskAttributeValue = (task: any, attribute: string) => {
  const option = taskAttributeOptions.find((item) => item.value === attribute);
  if (option) return option.getValue(task);
  return attribute.split(".").reduce((current: any, key) => (current == null ? undefined : current[key]), task);
};

const normalizeGeoJson = (input: any): GeoJsonFeatureCollection => {
  if (!input) throw new Error("El archivo no contiene geometría.");

  if (input.type === "FeatureCollection" && Array.isArray(input.features)) {
    return {
      type: "FeatureCollection",
      features: input.features.filter((feature: any) => feature?.type === "Feature" && feature.geometry),
    };
  }

  if (input.type === "Feature") {
    return { type: "FeatureCollection", features: [input] };
  }

  if (typeof input === "object") {
    const mergedFeatures = Object.entries(input).flatMap(([sourceLayerName, value]: [string, any]) => {
      const collection = normalizeGeoJson(value);
      return collection.features.map((feature) => ({
        ...feature,
        properties: {
          ...(feature.properties || {}),
          _sourceLayer: sourceLayerName,
        },
      }));
    });

    if (mergedFeatures.length > 0) {
      return { type: "FeatureCollection", features: mergedFeatures };
    }
  }

  throw new Error("No pude leer el formato espacial del archivo.");
};

const extractAttributes = (geojson?: GeoJsonFeatureCollection) => {
  const attributes = new Set<string>();
  (geojson?.features || []).slice(0, 500).forEach((feature) => {
    Object.keys(feature.properties || {}).forEach((key) => attributes.add(key));
  });
  return Array.from(attributes).sort((left, right) => left.localeCompare(right));
};

const getGeoJsonBounds = (geojson?: GeoJsonFeatureCollection): GeoJsonBounds | null => {
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;

  const includeCoordinate = (value: any) => {
    if (!Array.isArray(value) || typeof value[0] !== "number" || typeof value[1] !== "number") return false;
    const lon = value[0];
    const lat = value[1];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return true;
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    return true;
  };

  (geojson?.features || []).forEach((feature) => {
    const coordinates = feature.geometry?.coordinates;
    if (!Array.isArray(coordinates)) return;

    const stack = [coordinates];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!Array.isArray(current) || includeCoordinate(current)) continue;
      for (let index = 0; index < current.length; index += 1) {
        stack.push(current[index]);
      }
    }
  });

  if (!Number.isFinite(west) || !Number.isFinite(south) || !Number.isFinite(east) || !Number.isFinite(north)) {
    return null;
  }

  return { west, south, east, north };
};

const expandBounds = (bounds: GeoJsonBounds, ratio = VIEWPORT_BOUNDS_PADDING_RATIO): GeoJsonBounds => {
  const lonPadding = Math.max((bounds.east - bounds.west) * ratio, 0.0005);
  const latPadding = Math.max((bounds.north - bounds.south) * ratio, 0.0005);
  return {
    west: Math.max(-180, bounds.west - lonPadding),
    south: Math.max(-85.05112878, bounds.south - latPadding),
    east: Math.min(180, bounds.east + lonPadding),
    north: Math.min(85.05112878, bounds.north + latPadding),
  };
};

const boundsIntersect = (left: GeoJsonBounds, right: GeoJsonBounds) =>
  left.west <= right.east &&
  left.east >= right.west &&
  left.south <= right.north &&
  left.north >= right.south;

const projectLonLat = (lon: number, lat: number, zoom: number): ProjectedPoint => {
  const scale = TILE_SIZE * Math.pow(2, zoom);
  const safeLat = Math.max(Math.min(lat, 85.05112878), -85.05112878);
  const sin = Math.sin((safeLat * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
};

const unprojectPoint = (point: ProjectedPoint, zoom: number) => {
  const scale = TILE_SIZE * Math.pow(2, zoom);
  const lon = (point.x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * point.y) / scale;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lon, lat };
};

const getFittedView = (bounds: ReturnType<typeof getGeoJsonBounds>, width: number, height: number) => {
  if (!bounds || width <= 0 || height <= 0) {
    return { center: { lon: -74.2973, lat: 4.5709 }, zoom: 5 };
  }

  const center = {
    lon: (bounds.west + bounds.east) / 2,
    lat: (bounds.south + bounds.north) / 2,
  };

  let zoom = 5;
  for (let candidateZoom = MAX_ZOOM; candidateZoom >= MIN_ZOOM; candidateZoom -= 1) {
    const nw = projectLonLat(bounds.west, bounds.north, candidateZoom);
    const se = projectLonLat(bounds.east, bounds.south, candidateZoom);
    const projectedWidth = Math.abs(se.x - nw.x);
    const projectedHeight = Math.abs(se.y - nw.y);
    if (projectedWidth <= width * 0.82 && projectedHeight <= height * 0.82) {
      zoom = candidateZoom;
      break;
    }
  }

  return { center, zoom };
};

const getPointCoordinates = (geometry: GeoJsonGeometry | null) => {
  if (!geometry?.coordinates) return [];
  if (geometry.type === "Point") return [geometry.coordinates];
  if (geometry.type === "MultiPoint") return geometry.coordinates;
  return [];
};

const getRingCentroid = (ring: number[][]) => {
  if (!Array.isArray(ring) || ring.length === 0) return null;

  let twiceArea = 0;
  let centroidLon = 0;
  let centroidLat = 0;
  const fallback = ring.reduce(
    (acc: { lon: number; lat: number; count: number }, coord: number[]) => {
      if (!Array.isArray(coord) || typeof coord[0] !== "number" || typeof coord[1] !== "number") return acc;
      return { lon: acc.lon + coord[0], lat: acc.lat + coord[1], count: acc.count + 1 };
    },
    { lon: 0, lat: 0, count: 0 }
  );

  for (let index = 0; index < ring.length - 1; index += 1) {
    const current = ring[index];
    const next = ring[index + 1];
    if (
      !Array.isArray(current) ||
      !Array.isArray(next) ||
      typeof current[0] !== "number" ||
      typeof current[1] !== "number" ||
      typeof next[0] !== "number" ||
      typeof next[1] !== "number"
    ) {
      continue;
    }

    const cross = current[0] * next[1] - next[0] * current[1];
    twiceArea += cross;
    centroidLon += (current[0] + next[0]) * cross;
    centroidLat += (current[1] + next[1]) * cross;
  }

  if (Math.abs(twiceArea) < 1e-12) {
    return fallback.count > 0
      ? { coordinate: [fallback.lon / fallback.count, fallback.lat / fallback.count], area: 0 }
      : null;
  }

  return {
    coordinate: [centroidLon / (3 * twiceArea), centroidLat / (3 * twiceArea)],
    area: Math.abs(twiceArea / 2),
  };
};

const getLabelCoordinate = (geometry: GeoJsonGeometry | null): number[] | null => {
  if (!geometry?.coordinates) return null;
  if (geometry.type === "Point") return geometry.coordinates;
  if (geometry.type === "MultiPoint") return geometry.coordinates[0] || null;
  if (geometry.type === "LineString") return geometry.coordinates[Math.floor(geometry.coordinates.length / 2)] || null;
  if (geometry.type === "MultiLineString") {
    const longestLine = [...geometry.coordinates].sort((left: number[][], right: number[][]) => right.length - left.length)[0];
    return longestLine?.[Math.floor(longestLine.length / 2)] || null;
  }
  if (geometry.type === "Polygon") {
    const ring = geometry.coordinates?.[0] || [];
    return getRingCentroid(ring)?.coordinate || null;
  }
  if (geometry.type === "MultiPolygon") {
    const largestPolygon = (geometry.coordinates || [])
      .map((polygon: number[][][]) => ({
        polygon,
        centroid: getRingCentroid(polygon?.[0] || []),
      }))
      .sort((left: { centroid: ReturnType<typeof getRingCentroid> }, right: { centroid: ReturnType<typeof getRingCentroid> }) =>
        (right.centroid?.area || 0) - (left.centroid?.area || 0)
      )[0];
    return largestPolygon?.centroid?.coordinate || null;
  }
  return null;
};

const getCanvasSimplificationTolerance = (zoom: number) => {
  if (zoom <= 10) return 6;
  if (zoom <= 12) return 3.5;
  if (zoom <= 14) return 1.8;
  if (zoom <= 16) return 0.9;
  return 0.35;
};

const getMinimumLabelZoom = (featureCount: number) => {
  if (featureCount > 8000) return 20;
  if (featureCount > 3000) return 18;
  if (featureCount > 1200) return 17;
  if (featureCount > 450) return 16;
  if (featureCount > 160) return 15;
  return 14;
};

const getProjectedBoundsRect = (bounds: GeoJsonBounds, zoom: number, topLeft: ProjectedPoint) => {
  const northWest = projectLonLat(bounds.west, bounds.north, zoom);
  const southEast = projectLonLat(bounds.east, bounds.south, zoom);
  const left = Math.min(northWest.x, southEast.x) - topLeft.x;
  const top = Math.min(northWest.y, southEast.y) - topLeft.y;
  const width = Math.abs(southEast.x - northWest.x);
  const height = Math.abs(southEast.y - northWest.y);
  return makeScreenRect(left, top, width, height);
};

const isPolygonalGeometry = (geometry: GeoJsonGeometry | null) =>
  geometry?.type === "Polygon" || geometry?.type === "MultiPolygon";

const fitCanvasLabelText = (context: CanvasRenderingContext2D, label: string, maxWidth: number) => {
  const cleanLabel = label.trim().replace(/\s+/g, " ");
  const maxTextWidth = Math.floor(maxWidth - LABEL_PADDING_X * 2);
  if (!cleanLabel || maxTextWidth < 18) return null;

  const maxSourceLength = 60;
  const source = cleanLabel.length > maxSourceLength ? cleanLabel.slice(0, maxSourceLength) : cleanLabel;
  if (context.measureText(source).width <= maxTextWidth) return source;

  let low = 1;
  let high = source.length;
  let best = "";
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = `${source.slice(0, mid).trim()}...`;
    if (context.measureText(candidate).width <= maxTextWidth) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best || null;
};

const buildCanvasLabel = (
  context: CanvasRenderingContext2D,
  label: string,
  point: ProjectedPoint,
  options: {
    maxWidth: number;
    placement: "above" | "inside";
    containerRect?: ScreenRect;
    viewportRect: ScreenRect;
  }
) => {
  context.font = "700 11px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  const text = fitCanvasLabelText(context, label, Math.max(0, options.maxWidth));
  if (!text) return null;

  const width = Math.ceil(context.measureText(text).width + LABEL_PADDING_X * 2);
  const initialRect =
    options.placement === "inside"
      ? makeScreenRect(Math.round(point.x - width / 2), Math.round(point.y - LABEL_HEIGHT / 2), width, LABEL_HEIGHT)
      : makeScreenRect(Math.round(point.x - width / 2), Math.round(point.y - 28), width, LABEL_HEIGHT);
  const rect = options.containerRect ? clampRectInside(initialRect, options.containerRect, 3) : initialRect;
  if (!rect || !rectsIntersect(rect, options.viewportRect)) return null;

  return { text, rect };
};

const drawCanvasLabel = (
  context: CanvasRenderingContext2D,
  text: string,
  rect: ScreenRect,
  color: string
) => {
  context.font = "700 11px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  context.fillStyle = "rgba(255,255,255,0.9)";
  context.strokeStyle = colorToRgba(color, 0.55);
  context.lineWidth = 1;
  context.fillRect(rect.left, rect.top, rect.width, rect.height);
  context.strokeRect(rect.left, rect.top, rect.width, rect.height);
  context.fillStyle = color;
  context.fillText(text, rect.left + LABEL_PADDING_X, rect.top + 14);
};

const getAnnotationCoordinate = (annotation: SpatialAnnotation) => {
  if (annotation.annotationType === "label" && annotation.geometry.type === "Point") {
    return annotation.geometry.coordinates;
  }
  if (annotation.geometry.type === "Polygon") {
    return getRingCentroid(annotation.geometry.coordinates?.[0] || [])?.coordinate || annotation.geometry.coordinates?.[0]?.[0] || null;
  }
  return null;
};

const makeAnnotationPolygonPath = (
  annotation: SpatialAnnotation,
  project: (coord: number[]) => ProjectedPoint
) => {
  const path = new Path2D();
  if (annotation.geometry.type !== "Polygon") return { path, hasPath: false };
  const ring = annotation.geometry.coordinates?.[0] || [];
  const hasPath = appendLineToCanvasPath(path, ring, project, 0.1, true);
  return { path, hasPath };
};

const drawAnnotationLabel = (
  context: CanvasRenderingContext2D,
  text: string,
  point: ProjectedPoint,
  style: NormalizedAnnotationStyle,
  rotation = 0
): ScreenRect | null => {
  const cleanText = text.trim();
  if (!cleanText) return null;
  const fontSize = style.fontSize;
  context.save();
  context.font = `800 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
  const textWidth = Math.ceil(context.measureText(cleanText).width);
  const width = textWidth + 18;
  const height = Math.ceil(fontSize + 12);
  const angle = (rotation * Math.PI) / 180;
  context.translate(point.x, point.y);
  context.rotate(angle);
  if (style.showHalo) {
    context.fillStyle = "rgba(255,255,255,0.9)";
    context.strokeStyle = colorToRgba(style.textColor, 0.24);
    context.lineWidth = 1;
    context.beginPath();
    context.roundRect(-width / 2, -height / 2, width, height, 8);
    context.fill();
    context.stroke();
  }
  context.fillStyle = style.textColor;
  context.fillText(cleanText, -textWidth / 2, Math.round(fontSize / 2) - 1);
  context.restore();

  const radius = Math.sqrt(width * width + height * height) / 2;
  return makeScreenRect(point.x - radius, point.y - radius, radius * 2, radius * 2);
};

const drawAnnotationPointHandle = (
  context: CanvasRenderingContext2D,
  point: ProjectedPoint,
  color: string
) => {
  context.beginPath();
  context.arc(point.x, point.y, 4.5, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = "#fff";
  context.stroke();
};

const appendLineToCanvasPath = (
  path: Path2D,
  line: number[][],
  project: (coord: number[]) => ProjectedPoint,
  tolerance: number,
  closePath = false
) => {
  if (!Array.isArray(line) || line.length === 0) return false;

  let started = false;
  let lastX = Number.NaN;
  let lastY = Number.NaN;
  let firstX = Number.NaN;
  let firstY = Number.NaN;
  let pointCount = 0;

  line.forEach((coord, index) => {
    if (!Array.isArray(coord) || typeof coord[0] !== "number" || typeof coord[1] !== "number") return;
    const point = project(coord);
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;

    const isLast = index === line.length - 1;
    const hasLastPoint = Number.isFinite(lastX) && Number.isFinite(lastY);
    const shouldKeep =
      !hasLastPoint ||
      isLast ||
      Math.hypot(point.x - lastX, point.y - lastY) >= tolerance;

    if (!shouldKeep) return;

    if (!started) {
      path.moveTo(point.x, point.y);
      firstX = point.x;
      firstY = point.y;
      started = true;
    } else {
      path.lineTo(point.x, point.y);
    }

    lastX = point.x;
    lastY = point.y;
    pointCount += 1;
  });

  if (closePath && started) {
    if (
      Number.isFinite(firstX) &&
      Number.isFinite(firstY) &&
      Number.isFinite(lastX) &&
      Number.isFinite(lastY) &&
      Math.hypot(firstX - lastX, firstY - lastY) >= 0.25
    ) {
      path.lineTo(firstX, firstY);
    }
    path.closePath();
  }

  return pointCount > 1;
};

const appendGeometryToCanvasPath = (
  path: Path2D,
  geometry: GeoJsonGeometry | null,
  project: (coord: number[]) => ProjectedPoint,
  tolerance: number
) => {
  if (!geometry?.coordinates) return { hasFill: false, hasStroke: false };

  if (geometry.type === "Polygon") {
    const hasPath = geometry.coordinates.some((ring: number[][]) => appendLineToCanvasPath(path, ring, project, tolerance, true));
    return { hasFill: hasPath, hasStroke: hasPath };
  }

  if (geometry.type === "MultiPolygon") {
    let hasPath = false;
    geometry.coordinates.forEach((polygon: any) => {
      polygon.forEach((ring: number[][]) => {
        if (appendLineToCanvasPath(path, ring, project, tolerance, true)) hasPath = true;
      });
    });
    return { hasFill: hasPath, hasStroke: hasPath };
  }

  if (geometry.type === "LineString") {
    const hasPath = appendLineToCanvasPath(path, geometry.coordinates, project, tolerance, false);
    return { hasFill: false, hasStroke: hasPath };
  }

  if (geometry.type === "MultiLineString") {
    const hasPath = geometry.coordinates.some((line: number[][]) => appendLineToCanvasPath(path, line, project, tolerance, false));
    return { hasFill: false, hasStroke: hasPath };
  }

  return { hasFill: false, hasStroke: false };
};

const loadShapefileParser = () =>
  new Promise<any>((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("El parser espacial solo se carga en navegador."));
      return;
    }

    const currentParser = (window as any).shp;
    if (currentParser) {
      resolve(currentParser);
      return;
    }

    const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${SHP_SCRIPT_URL}"]`);
    if (existingScript) {
      existingScript.addEventListener("load", () => resolve((window as any).shp), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("No se pudo cargar el parser de shapefile.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = SHP_SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      const parser = (window as any).shp;
      if (parser) resolve(parser);
      else reject(new Error("El parser de shapefile no quedó disponible."));
    };
    script.onerror = () => reject(new Error("No se pudo cargar el parser de shapefile."));
    document.head.appendChild(script);
  });

const statusCountsFromTasks = (tasks: any[]) => {
  return tasks.reduce(
    (summary, task) => {
      const status = getTaskStatus(task);
      if (isCompletedTaskStatus(status)) summary.completed += 1;
      else if (status === "stuck" || status === "estancada") summary.stuck += 1;
      else if (status === "in_progress" || status === "trabajando") summary.inProgress += 1;
      else summary.pending += 1;
      return summary;
    },
    { pending: 0, inProgress: 0, completed: 0, stuck: 0 }
  );
};

export function ProjectSpatialMap({
  projectId,
  project,
  tasks,
  teamMembers,
  taskGroups = [],
  currentUser,
  canManage,
}: ProjectSpatialMapProps) {
  const [layers, setLayers] = useState<SpatialLayer[]>([]);
  const [annotations, setAnnotations] = useState<SpatialAnnotation[]>([]);
  const [spatialTaskViews, setSpatialTaskViews] = useState<SpatialTaskView[]>([]);
  const [activeSpatialTaskViewId, setActiveSpatialTaskViewId] = useState(DEFAULT_SPATIAL_VIEW_ID);
  const [savingSpatialTaskView, setSavingSpatialTaskView] = useState(false);
  const [viewDraftName, setViewDraftName] = useState("");
  const [viewDraftScope, setViewDraftScope] = useState<Exclude<SpatialTaskViewScope, "all">>("task");
  const [viewDraftTaskId, setViewDraftTaskId] = useState("");
  const [viewDraftGroupId, setViewDraftGroupId] = useState(DEFAULT_TASK_GROUP_ID);
  const [viewDraftIncludeSubtasks, setViewDraftIncludeSubtasks] = useState(true);
  const [loading, setLoading] = useState(true);
  const [spatialStoreError, setSpatialStoreError] = useState("");
  const [annotationStoreError, setAnnotationStoreError] = useState("");
  const [selectedLayerId, setSelectedLayerId] = useState("");
  const [layerGeojsons, setLayerGeojsons] = useState<Record<string, GeoJsonFeatureCollection>>({});
  const [loadingLayerData, setLoadingLayerData] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadDraftFile, setUploadDraftFile] = useState<File | null>(null);
  const [uploadDraftName, setUploadDraftName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgressText, setUploadProgressText] = useState("");
  const [layerEditName, setLayerEditName] = useState("");
  const [layerEditStyle, setLayerEditStyle] = useState<NormalizedLayerStyleConfig>(DEFAULT_LAYER_STYLE);
  const [layerEditVisible, setLayerEditVisible] = useState(true);
  const [savingLayerSettings, setSavingLayerSettings] = useState(false);
  const [layerAttribute, setLayerAttribute] = useState("");
  const [taskAttribute, setTaskAttribute] = useState("externalWorkflowId");
  const [customTaskAttribute, setCustomTaskAttribute] = useState("");
  const [joinMode, setJoinMode] = useState<"single" | "municipality_department">("single");
  const [layerMunicipalityAttribute, setLayerMunicipalityAttribute] = useState("");
  const [layerDepartmentAttribute, setLayerDepartmentAttribute] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [analysisAttribute, setAnalysisAttribute] = useState("");
  const [analysisBounds, setAnalysisBounds] = useState<GeoJsonBounds | null>(null);
  const [analysisDraftRect, setAnalysisDraftRect] = useState<ScreenSelectionRect | null>(null);
  const [isDrawingAnalysis, setIsDrawingAnalysis] = useState(false);
  const [isAreaAnalysisOpen, setIsAreaAnalysisOpen] = useState(false);
  const [isLayerManagerOpen, setIsLayerManagerOpen] = useState(false);
  const [spatialViewMode, setSpatialViewMode] = useState<SpatialViewMode>("current");
  const [annotationTool, setAnnotationTool] = useState<SpatialAnnotationTool>(null);
  const [polygonDraftPoints, setPolygonDraftPoints] = useState<number[][]>([]);
  const [labelDraftPoint, setLabelDraftPoint] = useState<number[] | null>(null);
  const [annotationTitle, setAnnotationTitle] = useState("");
  const [annotationBody, setAnnotationBody] = useState("");
  const [annotationRotation, setAnnotationRotation] = useState(0);
  const [annotationStyle, setAnnotationStyle] = useState<NormalizedAnnotationStyle>(DEFAULT_ANNOTATION_STYLE);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [savingAnnotation, setSavingAnnotation] = useState(false);
  const [simulationDateValue, setSimulationDateValue] = useState(() => formatDateInputValue(new Date()));
  const [isSimulationPlaying, setIsSimulationPlaying] = useState(false);
  const [simulationSpeedDays, setSimulationSpeedDays] = useState(1);
  const [planAuditLoadLimit, setPlanAuditLoadLimit] = useState(35);
  const [planAuditDistanceKm, setPlanAuditDistanceKm] = useState(6);
  const [spatialPanelTab, setSpatialPanelTab] = useState<SpatialPanelTab>("summary");
  const [layerPendingDelete, setLayerPendingDelete] = useState<SpatialLayer | null>(null);
  const [mapSize, setMapSize] = useState({ width: 960, height: 560 });
  const [mapView, setMapView] = useState({ center: { lon: -74.2973, lat: 4.5709 }, zoom: 5 });
  const [isDragging, setIsDragging] = useState(false);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hitRegionsRef = useRef<CanvasHitRegion[]>([]);
  const annotationHitRegionsRef = useRef<AnnotationHitRegion[]>([]);
  const dragRef = useRef<{ x: number; y: number; center: { lon: number; lat: number } } | null>(null);
  const pendingPanCenterRef = useRef<{ lon: number; lat: number } | null>(null);
  const panFrameRef = useRef<number | null>(null);

  const spatialViewsCollectionRef = useMemo(
    () => collection(null, "projects", projectId, SPATIAL_VIEWS_COLLECTION),
    [projectId]
  );

  useEffect(() => {
    if (!projectId) return;

    let active = true;

    const loadLayers = async () => {
      const { data, error } = await supabase
        .from(SPATIAL_LAYERS_TABLE)
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (!active) return;

      if (error) {
        console.error("Error loading spatial layers:", error);
        setSpatialStoreError(
          error.code === "42P01"
            ? "Falta aplicar la migración espacial con PostGIS."
            : "No se pudieron cargar las capas espaciales."
        );
        setLayers([]);
        setLoading(false);
        return;
      }

      const nextLayers = ((data || []) as SpatialLayerRow[]).map(mapSpatialLayerRow);
      const nextLayerIds = new Set(nextLayers.map((layer) => layer.id));
      setLayerGeojsons((current) => Object.fromEntries(Object.entries(current).filter(([layerId]) => nextLayerIds.has(layerId))));
      setLayers(nextLayers);
      setSelectedLayerId((current) => {
        if (current && nextLayers.some((layer) => layer.id === current)) return current;
        return nextLayers[0]?.id || "";
      });
      setSpatialStoreError("");
      setLoading(false);
    };

    void loadLayers();

    const channel = supabase
      .channel(`project_spatial_layers_${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: SPATIAL_LAYERS_TABLE,
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          void loadLayers();
        }
      )
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [projectId]);

  const loadSpatialTaskViews = useCallback(async () => {
    if (!projectId) return;
    try {
      const snapshot = await getDocs(spatialViewsCollectionRef);
      const nextViews = snapshot.docs
        .map((viewDoc) => normalizeSpatialTaskView(viewDoc.id, viewDoc.data()))
        .filter((view) => view.projectId === projectId || !view.projectId)
        .sort((left, right) => left.name.localeCompare(right.name));
      setSpatialTaskViews(nextViews);
    } catch (error) {
      console.error("Error loading spatial task views:", error);
      toast.error("No se pudieron cargar las vistas del mapa.");
    }
  }, [projectId, spatialViewsCollectionRef]);

  useEffect(() => {
    void loadSpatialTaskViews();
  }, [loadSpatialTaskViews]);

  useEffect(() => {
    if (!projectId) return;

    let active = true;

    const loadAnnotations = async () => {
      const { data, error } = await supabase
        .from(SPATIAL_ANNOTATIONS_TABLE)
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (!active) return;

      if (error) {
        console.error("Error loading spatial annotations:", error);
        setAnnotationStoreError(
          error.code === "42P01"
            ? "Falta aplicar la migración de anotaciones espaciales."
            : "No se pudieron cargar las anotaciones del mapa."
        );
        setAnnotations([]);
        return;
      }

      const nextAnnotations = ((data || []) as SpatialAnnotationRow[])
        .map(mapSpatialAnnotationRow)
        .filter((annotation): annotation is SpatialAnnotation => Boolean(annotation));
      setAnnotations(nextAnnotations);
      setAnnotationStoreError("");
    };

    void loadAnnotations();

    const channel = supabase
      .channel(`project_spatial_annotations_${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: SPATIAL_ANNOTATIONS_TABLE,
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          void loadAnnotations();
        }
      )
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [projectId]);

  useEffect(() => {
    const element = mapRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setMapSize({
        width: Math.max(320, Math.round(entry.contentRect.width)),
        height: Math.max(360, Math.round(entry.contentRect.height)),
      });
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (panFrameRef.current != null) cancelAnimationFrame(panFrameRef.current);
    };
  }, []);

  const selectedLayer = useMemo(
    () => layers.find((layer) => layer.id === selectedLayerId) || null,
    [layers, selectedLayerId]
  );
  const selectedAnnotation = useMemo(
    () => annotations.find((annotation) => annotation.id === selectedAnnotationId) || null,
    [annotations, selectedAnnotationId]
  );
  const visibleLayers = useMemo(() => layers.filter((layer) => layer.visible !== false), [layers]);
  const visibleAnnotations = useMemo(() => annotations.filter((annotation) => annotation.visible !== false), [annotations]);
  const activeRenderLayers = useMemo(() => {
    const layerMap = new Map<string, SpatialLayer>();
    visibleLayers.forEach((layer) => layerMap.set(layer.id, layer));
    if (selectedLayer) layerMap.set(selectedLayer.id, selectedLayer);
    return Array.from(layerMap.values());
  }, [selectedLayer, visibleLayers]);
  const selectedLayerGeojson = selectedLayer ? layerGeojsons[selectedLayer.id] : undefined;

  useEffect(() => {
    if (!selectedAnnotation) return;
    setAnnotationTool(null);
    setPolygonDraftPoints([]);
    setLabelDraftPoint(null);
    setAnnotationTitle(selectedAnnotation.title || "");
    setAnnotationBody(selectedAnnotation.body || "");
    setAnnotationRotation(Number(selectedAnnotation.rotation || 0));
    setAnnotationStyle(normalizeAnnotationStyle(selectedAnnotation.styleConfig));
  }, [selectedAnnotation]);

  useEffect(() => {
    const layersToLoad = activeRenderLayers.filter((layer) => layer.downloadUrl && !layerGeojsons[layer.id]);
    if (layersToLoad.length === 0) return;

    let active = true;
    setLoadingLayerData(true);

    void (async () => {
      try {
        const loadedEntries = await Promise.all(
          layersToLoad.map(async (layer) => {
            const layerLabel = layer.name || layer.fileName || "la capa";
            const geojson = await loadSpatialLayerGeoJson(layer.downloadUrl as string, layerLabel);
            return [layer.id, geojson] as const;
          })
        );
        if (!active) return;
        setLayerGeojsons((current) => ({
          ...current,
          ...Object.fromEntries(loadedEntries),
        }));
      } catch (error: any) {
        console.error("Error loading layer geojson:", error);
        if (active) toast.error(error?.message || "No se pudo cargar la geometría de la capa.");
      } finally {
        if (active) setLoadingLayerData(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [activeRenderLayers, layerGeojsons]);

  useEffect(() => {
    if (!selectedLayer) {
      setLayerAttribute("");
      setTaskAttribute("externalWorkflowId");
      setCustomTaskAttribute("");
      setJoinMode("single");
      setLayerMunicipalityAttribute("");
      setLayerDepartmentAttribute("");
      setLayerEditName("");
      setLayerEditStyle(DEFAULT_LAYER_STYLE);
      setLayerEditVisible(true);
      setSelectedFeatureId(null);
      setAnalysisAttribute("");
      setAnalysisBounds(null);
      setAnalysisDraftRect(null);
      setIsDrawingAnalysis(false);
      return;
    }

    const firstAttribute = selectedLayer.attributes?.[0] || "";
    const detectedMunicipalityAttribute =
      selectedLayer.attributes?.find((attribute) =>
        ["mpnombre", "municipio", "municipality"].includes(normalizeKey(attribute).replace(/[^a-z]/g, ""))
      ) || "";
    const detectedDepartmentAttribute =
      selectedLayer.attributes?.find((attribute) =>
        ["depto", "departamento", "department"].includes(normalizeKey(attribute).replace(/[^a-z]/g, ""))
      ) || "";
    setLayerEditName(selectedLayer.name || selectedLayer.fileName || "");
    setLayerEditStyle(normalizeLayerStyle(selectedLayer.styleConfig));
    setLayerEditVisible(selectedLayer.visible !== false);
    setLayerAttribute(selectedLayer.joinConfig?.layerAttribute || firstAttribute);
    setJoinMode(selectedLayer.joinConfig?.joinMode || "single");
    setLayerMunicipalityAttribute(
      selectedLayer.joinConfig?.layerMunicipalityAttribute || detectedMunicipalityAttribute
    );
    setLayerDepartmentAttribute(
      selectedLayer.joinConfig?.layerDepartmentAttribute || detectedDepartmentAttribute
    );
    setAnalysisAttribute(selectedLayer.joinConfig?.layerAttribute || firstAttribute);
    setAnalysisBounds(null);
    setAnalysisDraftRect(null);
    setIsDrawingAnalysis(false);
    setTaskAttribute(selectedLayer.joinConfig?.taskAttribute || "externalWorkflowId");
    setCustomTaskAttribute(
      selectedLayer.joinConfig?.taskAttribute &&
        !taskAttributeOptions.some((option) => option.value === selectedLayer.joinConfig?.taskAttribute)
        ? selectedLayer.joinConfig.taskAttribute
        : ""
    );
  }, [selectedLayer]);

  useEffect(() => {
    const bounds = getGeoJsonBounds(selectedLayerGeojson) || selectedLayer?.bounds || null;
    setMapView(getFittedView(bounds, mapSize.width, mapSize.height));
  }, [mapSize.height, mapSize.width, selectedLayer?.bounds, selectedLayer?.id, selectedLayerGeojson]);

  const memberById = useMemo(() => {
    const map = new Map<string, any>();
    teamMembers.forEach((member) => {
      if (member.id) map.set(member.id, member);
      if (member.authUserId) map.set(member.authUserId, member);
      if (member.uid) map.set(member.uid, member);
    });
    return map;
  }, [teamMembers]);

  const normalizedTaskGroups = useMemo(() => {
    const groups = new Map<string, { id: string; name: string; color?: string; order?: number; taskCount: number }>();
    groups.set(DEFAULT_TASK_GROUP_ID, {
      id: DEFAULT_TASK_GROUP_ID,
      name: taskGroups.find((group) => group?.id === DEFAULT_TASK_GROUP_ID)?.name || DEFAULT_TASK_GROUP_NAME,
      color: taskGroups.find((group) => group?.id === DEFAULT_TASK_GROUP_ID)?.color || "#94a3b8",
      order: -1,
      taskCount: 0,
    });

    taskGroups.forEach((group) => {
      if (!group?.id) return;
      groups.set(group.id, {
        id: group.id,
        name: group.name || DEFAULT_TASK_GROUP_NAME,
        color: group.color,
        order: group.order ?? 0,
        taskCount: 0,
      });
    });

    tasks.forEach((task) => {
      const groupId = getTaskGroupId(task);
      const existing = groups.get(groupId);
      if (existing) {
        existing.taskCount += 1;
        return;
      }
      groups.set(groupId, {
        id: groupId,
        name: String(task.groupName || groupId || DEFAULT_TASK_GROUP_NAME),
        color: "#94a3b8",
        order: 0,
        taskCount: 1,
      });
    });

    return Array.from(groups.values())
      .filter((group) => group.taskCount > 0 || group.id !== DEFAULT_TASK_GROUP_ID)
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.name.localeCompare(right.name));
  }, [taskGroups, tasks]);

  const rootTaskOptions = useMemo(
    () =>
      tasks
        .filter((task) => !getTaskParentId(task))
        .sort((left, right) => String(getTaskTitle(left)).localeCompare(String(getTaskTitle(right)))),
    [tasks]
  );

  const defaultSpatialTaskView = useMemo<SpatialTaskView>(
    () => ({
      id: DEFAULT_SPATIAL_VIEW_ID,
      projectId,
      name: "Todo el proyecto",
      scope: "all",
      taskIds: [],
      groupIds: [],
      includeSubtasks: true,
    }),
    [projectId]
  );

  const activeSpatialTaskView = useMemo(
    () => spatialTaskViews.find((view) => view.id === activeSpatialTaskViewId) || defaultSpatialTaskView,
    [activeSpatialTaskViewId, defaultSpatialTaskView, spatialTaskViews]
  );

  const spatialScopeTasks = useMemo(() => {
    if (activeSpatialTaskView.scope === "all") return tasks;

    if (activeSpatialTaskView.scope === "group") {
      const groupIds = new Set(activeSpatialTaskView.groupIds?.length ? activeSpatialTaskView.groupIds : [DEFAULT_TASK_GROUP_ID]);
      return tasks.filter((task) => groupIds.has(getTaskGroupId(task)));
    }

    const selectedTaskIds = new Set(activeSpatialTaskView.taskIds || []);
    if (selectedTaskIds.size === 0) return tasks;
    if (activeSpatialTaskView.includeSubtasks === false) {
      return tasks.filter((task) => selectedTaskIds.has(task.id));
    }

    const childrenByParent = new Map<string, any[]>();
    tasks.forEach((task) => {
      const parentId = getTaskParentId(task);
      if (!parentId) return;
      const children = childrenByParent.get(parentId) || [];
      children.push(task);
      childrenByParent.set(parentId, children);
    });

    const scopedIds = new Set<string>(selectedTaskIds);
    const queue = Array.from(selectedTaskIds);
    while (queue.length > 0) {
      const parentId = queue.shift()!;
      (childrenByParent.get(parentId) || []).forEach((child) => {
        if (!child?.id || scopedIds.has(child.id)) return;
        scopedIds.add(child.id);
        queue.push(child.id);
      });
    }

    return tasks.filter((task) => scopedIds.has(task.id));
  }, [activeSpatialTaskView, tasks]);

  const activeSpatialTaskViewSummary = useMemo(() => {
    if (activeSpatialTaskView.scope === "all") return "Todas las tareas del proyecto participan en la unión.";
    if (activeSpatialTaskView.scope === "group") {
      const selectedNames = (activeSpatialTaskView.groupIds || [])
        .map((groupId) => normalizedTaskGroups.find((group) => group.id === groupId)?.name || groupId)
        .join(", ");
      return `Grupo visual: ${selectedNames || DEFAULT_TASK_GROUP_NAME}.`;
    }
    const selectedNames = (activeSpatialTaskView.taskIds || [])
      .map((taskId) => getTaskTitle(tasks.find((task) => task.id === taskId)))
      .filter(Boolean)
      .join(", ");
    return `Tarea base: ${selectedNames || "sin selección"}${activeSpatialTaskView.includeSubtasks !== false ? " con subtareas." : "."}`;
  }, [activeSpatialTaskView, normalizedTaskGroups, tasks]);

  const effectiveTaskAttribute = taskAttribute === "__custom__" ? customTaskAttribute.trim() : taskAttribute;
  const effectiveJoinTaskAttribute = joinMode === "municipality_department" ? "municipalityDepartment" : effectiveTaskAttribute;
  const canSaveSpatialJoin =
    joinMode === "municipality_department"
      ? Boolean(selectedLayer && layerMunicipalityAttribute && layerDepartmentAttribute)
      : Boolean(selectedLayer && layerAttribute && effectiveTaskAttribute);

  const taskAttributesForJoins = useMemo(() => {
    const attributes = new Set<string>();
    layers.forEach((layer) =>
      attributes.add(
        layer.joinConfig?.joinMode === "municipality_department"
          ? "municipalityDepartment"
          : layer.joinConfig?.taskAttribute || "externalWorkflowId"
      )
    );
    if (effectiveJoinTaskAttribute) attributes.add(effectiveJoinTaskAttribute);
    return Array.from(attributes);
  }, [effectiveJoinTaskAttribute, layers]);

  const taskJoinMaps = useMemo(() => {
    const maps = new Map<string, Map<string, any[]>>();
    taskAttributesForJoins.forEach((attribute) => {
      const map = new Map<string, any[]>();
      spatialScopeTasks.forEach((task) => {
        const rawValue = getTaskAttributeValue(task, attribute);
        const key = normalizeKey(rawValue);
        if (!key) return;
        const current = map.get(key) || [];
        current.push(task);
        map.set(key, current);
      });
      maps.set(attribute, map);
    });
    return maps;
  }, [spatialScopeTasks, taskAttributesForJoins]);

  const boundedFeaturesByLayerId = useMemo(() => {
    const map = new Map<string, FeatureWithBounds[]>();
    Object.entries(layerGeojsons).forEach(([layerId, geojson]) => {
      map.set(
        layerId,
        (geojson?.features || []).reduce<FeatureWithBounds[]>((features, feature, sourceIndex) => {
          const bounds = getGeoJsonBounds({ type: "FeatureCollection", features: [feature] });
          if (bounds) features.push({ feature, bounds, sourceIndex });
          return features;
        }, [])
      );
    });
    return map;
  }, [layerGeojsons]);

  const selectedLayerThemeCategories = useMemo(() => {
    if (!selectedLayer || !layerEditStyle.themeAttribute) return [];
    const counts = new Map<string, number>();
    (boundedFeaturesByLayerId.get(selectedLayer.id) || []).forEach(({ feature }) => {
      const category = getAttributeCategory(feature.properties?.[layerEditStyle.themeAttribute]);
      counts.set(category, (counts.get(category) || 0) + 1);
    });

    return Array.from(counts.entries())
      .map(([category, count]) => ({
        category,
        count,
        style: layerEditStyle.attributeStyles[category] || getGeneratedAttributeStyle(category),
      }))
      .sort((left, right) => right.count - left.count || left.category.localeCompare(right.category));
  }, [boundedFeaturesByLayerId, layerEditStyle.attributeStyles, layerEditStyle.themeAttribute, selectedLayer]);

  const mapViewportBounds = useMemo(() => {
    if (mapSize.width <= 0 || mapSize.height <= 0) return null;
    const viewportCenterPx = projectLonLat(mapView.center.lon, mapView.center.lat, mapView.zoom);
    const viewportTopLeft = {
      x: viewportCenterPx.x - mapSize.width / 2,
      y: viewportCenterPx.y - mapSize.height / 2,
    };
    const northWest = unprojectPoint(viewportTopLeft, mapView.zoom);
    const southEast = unprojectPoint(
      {
        x: viewportTopLeft.x + mapSize.width,
        y: viewportTopLeft.y + mapSize.height,
      },
      mapView.zoom
    );

    return expandBounds({
      west: Math.min(northWest.lon, southEast.lon),
      south: Math.min(northWest.lat, southEast.lat),
      east: Math.max(northWest.lon, southEast.lon),
      north: Math.max(northWest.lat, southEast.lat),
    });
  }, [mapSize.height, mapSize.width, mapView.center.lat, mapView.center.lon, mapView.zoom]);

  const renderedFeatureJoins = useMemo<LayerFeatureJoin[]>(() => {
    const joins: LayerFeatureJoin[] = [];
    let renderedCount = 0;

    visibleLayers.forEach((layer) => {
      if (renderedCount >= MAX_RENDER_FEATURES) return;
      const boundedFeatures = boundedFeaturesByLayerId.get(layer.id) || [];
      const style = normalizeLayerStyle(layer.styleConfig);
      const effectiveLayerJoinMode =
        layer.id === selectedLayer?.id ? joinMode : layer.joinConfig?.joinMode || "single";
      const effectiveLayerAttribute =
        layer.id === selectedLayer?.id ? layerAttribute : layer.joinConfig?.layerAttribute || layer.attributes?.[0] || "";
      const effectiveLayerTaskAttribute =
        effectiveLayerJoinMode === "municipality_department"
          ? "municipalityDepartment"
          : layer.id === selectedLayer?.id
            ? effectiveTaskAttribute
            : layer.joinConfig?.taskAttribute || "externalWorkflowId";
      const effectiveLayerMunicipalityAttribute =
        layer.id === selectedLayer?.id
          ? layerMunicipalityAttribute
          : layer.joinConfig?.layerMunicipalityAttribute || "";
      const effectiveLayerDepartmentAttribute =
        layer.id === selectedLayer?.id
          ? layerDepartmentAttribute
          : layer.joinConfig?.layerDepartmentAttribute || "";
      const taskMap = taskJoinMaps.get(effectiveLayerTaskAttribute) || new Map<string, any[]>();

      boundedFeatures.forEach(({ feature, sourceIndex, bounds }) => {
        if (renderedCount >= MAX_RENDER_FEATURES) return;
        if (mapViewportBounds && !boundsIntersect(bounds, mapViewportBounds)) return;
        const rawKey =
          effectiveLayerJoinMode === "municipality_department"
            ? `${feature.properties?.[effectiveLayerMunicipalityAttribute] ?? ""}|${
                feature.properties?.[effectiveLayerDepartmentAttribute] ?? ""
              }`
            : feature.properties?.[effectiveLayerAttribute];
        const key = normalizeKey(rawKey);
        const rawLabel = style.labelAttribute ? feature.properties?.[style.labelAttribute] : "";
        joins.push({
          featureId: makeFeatureId(layer.id, sourceIndex),
          layerId: layer.id,
          layerName: layer.name || layer.fileName || "Capa sin nombre",
          layer,
          bounds,
          feature,
          key: String(rawKey ?? ""),
          tasks: key ? taskMap.get(key) || [] : [],
          sourceIndex,
          label: String(rawLabel ?? "").trim(),
          labelAttribute: style.labelAttribute,
          layerAttribute:
            effectiveLayerJoinMode === "municipality_department"
              ? `${effectiveLayerMunicipalityAttribute} + ${effectiveLayerDepartmentAttribute}`
              : effectiveLayerAttribute,
          taskAttribute: effectiveLayerTaskAttribute,
          style,
        });
        renderedCount += 1;
      });
    });

    return joins;
  }, [
    boundedFeaturesByLayerId,
    effectiveTaskAttribute,
    joinMode,
    layerAttribute,
    layerDepartmentAttribute,
    layerMunicipalityAttribute,
    mapViewportBounds,
    selectedLayer?.id,
    taskJoinMaps,
    visibleLayers,
  ]);

  const featureJoins = useMemo(
    () => renderedFeatureJoins.filter((join) => join.layerId === selectedLayer?.id),
    [renderedFeatureJoins, selectedLayer?.id]
  );

  const filteredFeatureJoins = useMemo(() => {
    const search = normalizeKey(searchTerm);
    const source = renderedFeatureJoins;
    if (!search) return source;
    return source.filter((item) => {
      const taskMatch = item.tasks.some((task) =>
        [
          getTaskTitle(task),
          task.externalWorkflowId,
          task.municipality,
          task.workflowMunicipality,
          task.department,
          task.workflowDepartment,
          task.status,
        ]
          .some((value) => normalizeKey(value).includes(search))
      );
      const propertyMatch = Object.values(item.feature.properties || {}).some((value) => normalizeKey(value).includes(search));
      return taskMatch || propertyMatch || normalizeKey(item.layerName).includes(search) || normalizeKey(item.label).includes(search);
    });
  }, [renderedFeatureJoins, searchTerm]);

  const spatializedTasks = useMemo(() => {
    const map = new Map<string, any>();
    featureJoins.forEach((join) => {
      join.tasks.forEach((task) => map.set(task.id, task));
    });
    return Array.from(map.values());
  }, [featureJoins]);

  const renderedSpatializedTasks = useMemo(() => {
    const map = new Map<string, any>();
    renderedFeatureJoins.forEach((join) => {
      join.tasks.forEach((task) => map.set(task.id, task));
    });
    return Array.from(map.values());
  }, [renderedFeatureJoins]);

  const simulationDate = useMemo(
    () => parseDateInputValue(simulationDateValue) || startOfDay(new Date()),
    [simulationDateValue]
  );

  const simulationRange = useMemo(() => {
    const dateValues = renderedSpatializedTasks.flatMap((task) =>
      [
        getTaskDateValue(task.startDate || task.start || task.plannedStartDate),
        getTaskDateValue(task.endDate || task.end || task.dueDate || task.plannedEndDate),
        getTaskDateValue(task.completedAt || task.finishedAt),
      ].filter((date): date is Date => Boolean(date))
    );

    const today = startOfDay(new Date());
    if (dateValues.length === 0) {
      const start = today;
      const end = addDays(today, 30);
      return {
        start,
        end,
        startInput: formatDateInputValue(start),
        endInput: formatDateInputValue(end),
        totalDays: 30,
      };
    }

    const minTime = Math.min(...dateValues.map((date) => startOfDay(date).getTime()), today.getTime());
    const maxTime = Math.max(...dateValues.map((date) => startOfDay(date).getTime()), addDays(today, 7).getTime());
    const start = new Date(minTime);
    const end = new Date(maxTime);
    const totalDays = Math.max(1, getDayOffset(end, start));

    return {
      start,
      end,
      startInput: formatDateInputValue(start),
      endInput: formatDateInputValue(end),
      totalDays,
    };
  }, [renderedSpatializedTasks]);

  const simulationDayOffset = useMemo(
    () => Math.min(simulationRange.totalDays, getDayOffset(simulationDate, simulationRange.start)),
    [simulationDate, simulationRange.start, simulationRange.totalDays]
  );

  const temporalFeatureStats = useMemo(() => {
    const counts = TEMPORAL_STATUS_OPTIONS.reduce<Record<TemporalStateKey, number>>((summary, option) => {
      summary[option.key] = 0;
      return summary;
    }, {} as Record<TemporalStateKey, number>);

    renderedFeatureJoins.forEach((join) => {
      counts[getTemporalStateForJoin(join, simulationDate)] += 1;
    });

    const linked = renderedFeatureJoins.filter((join) => join.tasks.length > 0).length;
    const completed = counts.completed;
    const active = counts.active;
    const overdue = counts.overdue;
    return {
      counts,
      linked,
      completed,
      active,
      overdue,
      progress: linked > 0 ? Math.round((completed / linked) * 100) : 0,
    };
  }, [renderedFeatureJoins, simulationDate]);

  const planAudit = useMemo(() => {
    const riskByFeatureId = new Map<string, PlanAuditRiskLevel>();
    const issues: SpatialPlanIssue[] = [];
    const linkedTaskIds = new Set<string>();
    const visibleLayerKeys = new Set<string>();
    const dayGroups = new Map<string, Array<{ join: LayerFeatureJoin; task: any; center: { lon: number; lat: number } }>>();
    const responsibleDayGroups = new Map<string, Array<{ join: LayerFeatureJoin; task: any; center: { lon: number; lat: number } }>>();
    const openTasks = tasks.filter((task) => !isCompletedTaskStatus(task?.status));

    const setFeatureRisk = (featureId: string, level: PlanAuditRiskLevel) => {
      riskByFeatureId.set(featureId, getHigherRisk(riskByFeatureId.get(featureId) || "ok", level));
    };

    renderedFeatureJoins.forEach((join) => {
      visibleLayerKeys.add(normalizeKey(join.key));

      if (join.tasks.length === 0) {
        setFeatureRisk(join.featureId, "watch");
        return;
      }

      const center = getBoundsCenter(join.bounds);
      join.tasks.forEach((task) => {
        if (task?.id) linkedTaskIds.add(task.id);
        const span = getTaskDateSpan(task);
        if (!span) {
          setFeatureRisk(join.featureId, "risk");
          issues.push({
            id: `task-no-dates-${join.featureId}-${task?.id || join.sourceIndex}`,
            level: "risk",
            title: "Tarea espacializada sin cronograma",
            detail: `${getTaskTitle(task)} no tiene fechas suficientes para auditar su ventana de ejecución.`,
            featureId: join.featureId,
            taskId: task?.id,
          });
          return;
        }

        enumerateTaskPlanDays(task).forEach((day) => {
          const event = { join, task, center };
          const currentDayGroup = dayGroups.get(day) || [];
          currentDayGroup.push(event);
          dayGroups.set(day, currentDayGroup);

          const responsibleKey = `${day}:${task?.assignedTo || "sin-responsable"}`;
          const currentResponsibleGroup = responsibleDayGroups.get(responsibleKey) || [];
          currentResponsibleGroup.push(event);
          responsibleDayGroups.set(responsibleKey, currentResponsibleGroup);
        });
      });
    });

    const unlinkedFeatures = renderedFeatureJoins.filter((join) => join.tasks.length === 0).length;
    if (unlinkedFeatures > 0) {
      issues.push({
        id: "unlinked-visible-features",
        level: unlinkedFeatures > Math.max(25, renderedFeatureJoins.length * 0.25) ? "risk" : "watch",
        title: "Geometrías sin tarea visible",
        detail: `${unlinkedFeatures.toLocaleString("es-CO")} entidades visibles no tienen una tarea asociada con la unión actual.`,
        metric: `${unlinkedFeatures.toLocaleString("es-CO")} entidades`,
      });
    }

    const tasksWithoutVisibleGeometry = openTasks.filter((task) => {
      const key = normalizeKey(getTaskAttributeValue(task, effectiveTaskAttribute));
      return key && !visibleLayerKeys.has(key) && !linkedTaskIds.has(task.id);
    });
    if (tasksWithoutVisibleGeometry.length > 0) {
      issues.push({
        id: "tasks-without-visible-geometry",
        level: tasksWithoutVisibleGeometry.length > Math.max(10, openTasks.length * 0.18) ? "risk" : "watch",
        title: "Tareas sin geometría visible",
        detail: `${tasksWithoutVisibleGeometry.length.toLocaleString("es-CO")} tareas abiertas tienen clave espacial, pero no aparecen unidas en la vista actual.`,
        metric: `${tasksWithoutVisibleGeometry.length.toLocaleString("es-CO")} tareas`,
      });
    }

    Array.from(dayGroups.entries()).forEach(([day, events]) => {
      if (events.length <= planAuditLoadLimit) return;
      const level: PlanAuditRiskLevel = events.length >= planAuditLoadLimit * 2 ? "critical" : "risk";
      events.forEach((event) => setFeatureRisk(event.join.featureId, level));
      issues.push({
        id: `day-overload-${day}`,
        level,
        title: "Jornada sobrecargada",
        detail: `El ${formatDate(day)} concentra ${events.length.toLocaleString("es-CO")} entidades planificadas. El umbral actual es ${planAuditLoadLimit}.`,
        metric: `${events.length.toLocaleString("es-CO")} entidades`,
        day,
      });
    });

    Array.from(responsibleDayGroups.entries()).forEach(([key, events]) => {
      const responsibleLimit = Math.max(8, Math.ceil(planAuditLoadLimit / 2));
      if (events.length <= responsibleLimit) return;
      const [day, responsibleId] = key.split(":");
      const level: PlanAuditRiskLevel = events.length >= responsibleLimit * 2 ? "critical" : "risk";
      events.forEach((event) => setFeatureRisk(event.join.featureId, level));
      issues.push({
        id: `responsible-overload-${key}`,
        level,
        title: "Responsable con carga concentrada",
        detail: `${getMemberName(memberById, responsibleId)} tiene ${events.length.toLocaleString("es-CO")} entidades programadas el ${formatDate(day)}.`,
        metric: `${events.length.toLocaleString("es-CO")} entidades`,
        day,
      });
    });

    Array.from(responsibleDayGroups.entries()).forEach(([key, events]) => {
      if (events.length < 3) return;
      const center = events.reduce(
        (summary, event) => ({
          lon: summary.lon + event.center.lon / events.length,
          lat: summary.lat + event.center.lat / events.length,
        }),
        { lon: 0, lat: 0 }
      );
      const distances = events.map((event) => getDistanceKm(center, event.center));
      const maxDistance = Math.max(...distances);
      const averageDistance = distances.reduce((total, value) => total + value, 0) / distances.length;
      if (maxDistance <= planAuditDistanceKm && averageDistance <= planAuditDistanceKm * 0.55) return;

      const [day, responsibleId] = key.split(":");
      const level: PlanAuditRiskLevel = maxDistance > planAuditDistanceKm * 2.5 ? "critical" : "risk";
      events.forEach((event) => setFeatureRisk(event.join.featureId, level));
      issues.push({
        id: `spatial-dispersion-${key}`,
        level,
        title: "Ruta espacial dispersa",
        detail: `${getMemberName(memberById, responsibleId)} tiene geometrías separadas hasta ${formatDistanceKm(maxDistance)} el ${formatDate(day)}.`,
        metric: `Máx. ${formatDistanceKm(maxDistance)} · prom. ${formatDistanceKm(averageDistance)}`,
        day,
      });
    });

    const counts = PLAN_AUDIT_OPTIONS.reduce<Record<PlanAuditRiskLevel, number>>((summary, option) => {
      summary[option.key] = 0;
      return summary;
    }, {} as Record<PlanAuditRiskLevel, number>);

    renderedFeatureJoins.forEach((join) => {
      counts[riskByFeatureId.get(join.featureId) || "ok"] += 1;
    });

    const total = Math.max(1, renderedFeatureJoins.length);
    const score = Math.max(
      0,
      Math.round(100 - (counts.critical / total) * 85 - (counts.risk / total) * 50 - (counts.watch / total) * 18)
    );

    const sortedIssues = issues
      .sort((left, right) => riskRank[right.level] - riskRank[left.level] || String(left.day || "").localeCompare(String(right.day || "")))
      .slice(0, 12);

    return {
      riskByFeatureId,
      counts,
      issues: sortedIssues,
      score,
      unlinkedFeatures,
      tasksWithoutVisibleGeometry: tasksWithoutVisibleGeometry.length,
      overloadedDays: Array.from(dayGroups.values()).filter((events) => events.length > planAuditLoadLimit).length,
      dispersedGroups: issues.filter((issue) => issue.id.startsWith("spatial-dispersion")).length,
      auditedFeatures: renderedFeatureJoins.length,
    };
  }, [
    effectiveTaskAttribute,
    memberById,
    planAuditDistanceKm,
    planAuditLoadLimit,
    renderedFeatureJoins,
    tasks,
  ]);

  useEffect(() => {
    const currentDate = parseDateInputValue(simulationDateValue);
    if (!currentDate) {
      setSimulationDateValue(simulationRange.startInput);
      return;
    }

    if (currentDate < simulationRange.start) {
      setSimulationDateValue(simulationRange.startInput);
      return;
    }

    if (currentDate > simulationRange.end) {
      setSimulationDateValue(simulationRange.endInput);
    }
  }, [simulationDateValue, simulationRange.end, simulationRange.endInput, simulationRange.start, simulationRange.startInput]);

  useEffect(() => {
    if (spatialViewMode !== "simulation" || !isSimulationPlaying) return;

    const timer = window.setInterval(() => {
      setSimulationDateValue((currentValue) => {
        const currentDate = parseDateInputValue(currentValue) || simulationRange.start;
        const nextDate = addDays(currentDate, simulationSpeedDays);
        if (nextDate > simulationRange.end) {
          setIsSimulationPlaying(false);
          return simulationRange.endInput;
        }
        return formatDateInputValue(nextDate);
      });
    }, 850);

    return () => window.clearInterval(timer);
  }, [isSimulationPlaying, simulationRange.end, simulationRange.endInput, simulationRange.start, simulationSpeedDays, spatialViewMode]);

  const stats = useMemo(() => {
    const linkedFeatures = featureJoins.filter((join) => join.tasks.length > 0);
    const taskStatusCounts = statusCountsFromTasks(spatializedTasks);
    return {
      features: selectedLayer?.featureCount || featureJoins.length,
      visibleFeatures: featureJoins.length,
      viewportFeatures: featureJoins.length,
      linkedFeatures: linkedFeatures.length,
      linkedTasks: spatializedTasks.length,
      coverage: featureJoins.length > 0 ? Math.round((linkedFeatures.length / featureJoins.length) * 100) : 0,
      ...taskStatusCounts,
    };
  }, [featureJoins, selectedLayer?.featureCount, spatializedTasks]);

  const selectedFeatureJoin = selectedFeatureId
    ? renderedFeatureJoins.find((join) => join.featureId === selectedFeatureId) || null
    : null;

  const selectedLayerLegend = useMemo(() => {
    if (!selectedLayer) return [];
    const style = normalizeLayerStyle(selectedLayer.styleConfig);

    if (style.themeMode === "unique") {
      return [
        {
          key: "unique",
          label: "Simbología única",
          count: featureJoins.length,
          color: style.fillColor,
        },
      ];
    }

    if (style.themeMode === "attribute" && style.themeAttribute) {
      const counts = new Map<string, number>();
      (boundedFeaturesByLayerId.get(selectedLayer.id) || []).forEach(({ feature }) => {
        const category = getAttributeCategory(feature.properties?.[style.themeAttribute]);
        counts.set(category, (counts.get(category) || 0) + 1);
      });

      return Array.from(counts.entries())
        .map(([category, count]) => ({
          key: category,
          label: category,
          count,
          color: (style.attributeStyles[category] || getGeneratedAttributeStyle(category)).fillColor,
        }))
        .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
    }

    return SPATIAL_STATUS_STYLE_OPTIONS.map((option) => ({
      key: option.key,
      label: option.label,
      count: featureJoins.filter((join) => getSpatialStyleKeyForTask(join.tasks[0]) === option.key).length,
      color: style.statusStyles[option.key].fillColor,
    })).filter((item) => item.count > 0 || item.key === "unlinked");
  }, [boundedFeaturesByLayerId, featureJoins, selectedLayer]);

  const temporalLegend = useMemo(
    () =>
      TEMPORAL_STATUS_OPTIONS.map((option) => ({
        key: option.key,
        label: option.label,
        count: temporalFeatureStats.counts[option.key],
        color: TEMPORAL_STATUS_STYLES[option.key].fillColor,
      })).filter((item) => item.count > 0 || item.key === "unlinked"),
    [temporalFeatureStats.counts]
  );

  const auditLegend = useMemo(
    () =>
      PLAN_AUDIT_OPTIONS.map((option) => ({
        key: option.key,
        label: option.label,
        count: planAudit.counts[option.key],
        color: PLAN_AUDIT_STYLES[option.key].fillColor,
      })).filter((item) => item.count > 0 || item.key === "ok"),
    [planAudit.counts]
  );

  const activeLegend = spatialViewMode === "audit" ? auditLegend : spatialViewMode === "simulation" ? temporalLegend : selectedLayerLegend;
  const activeLegendTotal = activeLegend.reduce((total, item) => total + item.count, 0);

  const analysisFeatures = useMemo(() => {
    if (!analysisBounds || !selectedLayer) return [];
    return (boundedFeaturesByLayerId.get(selectedLayer.id) || []).filter(({ bounds }) => boundsIntersect(bounds, analysisBounds));
  }, [analysisBounds, boundedFeaturesByLayerId, selectedLayer]);

  const analysisStats = useMemo(() => {
    const counts = new Map<string, number>();
    const numericValues: number[] = [];

    analysisFeatures.forEach(({ feature }) => {
      const value = feature.properties?.[analysisAttribute];
      const category = getAttributeCategory(value);
      counts.set(category, (counts.get(category) || 0) + 1);

      const numeric = parseNumericAttribute(value);
      if (numeric != null) numericValues.push(numeric);
    });

    const categories = Array.from(counts.entries())
      .map(([category, count]) => ({
        category,
        count,
        percent: analysisFeatures.length > 0 ? Math.round((count / analysisFeatures.length) * 100) : 0,
        color: getGeneratedAttributeStyle(category).fillColor,
      }))
      .sort((left, right) => right.count - left.count || left.category.localeCompare(right.category));

    const sum = numericValues.reduce((total, value) => total + value, 0);
    return {
      total: analysisFeatures.length,
      distinct: categories.length,
      numericCount: numericValues.length,
      sum,
      average: numericValues.length ? sum / numericValues.length : 0,
      min: numericValues.length ? Math.min(...numericValues) : 0,
      max: numericValues.length ? Math.max(...numericValues) : 0,
      categories,
    };
  }, [analysisAttribute, analysisFeatures]);

  const centerPx = useMemo(
    () => projectLonLat(mapView.center.lon, mapView.center.lat, mapView.zoom),
    [mapView.center.lat, mapView.center.lon, mapView.zoom]
  );
  const topLeft = useMemo(
    () => ({
      x: centerPx.x - mapSize.width / 2,
      y: centerPx.y - mapSize.height / 2,
    }),
    [centerPx.x, centerPx.y, mapSize.height, mapSize.width]
  );

  const projectCoordinate = useCallback((coord: number[]) => {
    const projected = projectLonLat(Number(coord[0]), Number(coord[1]), mapView.zoom);
    return {
      x: projected.x - topLeft.x,
      y: projected.y - topLeft.y,
    };
  }, [mapView.zoom, topLeft.x, topLeft.y]);

  const analysisOverlayRect = useMemo(() => {
    if (!analysisBounds) return null;
    const northWest = projectLonLat(analysisBounds.west, analysisBounds.north, mapView.zoom);
    const southEast = projectLonLat(analysisBounds.east, analysisBounds.south, mapView.zoom);
    return normalizeScreenRect({
      startX: northWest.x - topLeft.x,
      startY: northWest.y - topLeft.y,
      endX: southEast.x - topLeft.x,
      endY: southEast.y - topLeft.y,
    });
  }, [analysisBounds, mapView.zoom, topLeft.x, topLeft.y]);
  const visibleAnalysisRect = analysisDraftRect ? normalizeScreenRect(analysisDraftRect) : analysisOverlayRect;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const frame = requestAnimationFrame(() => {
      const pixelRatio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const width = Math.max(1, mapSize.width);
      const height = Math.max(1, mapSize.height);

      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.lineJoin = "round";
      context.lineCap = "round";

      const tolerance = getCanvasSimplificationTolerance(mapView.zoom);
      const hitRegions: CanvasHitRegion[] = [];
      const hitRegionByFeatureId = new Map<string, CanvasHitRegion>();
      const annotationHitRegions: AnnotationHitRegion[] = [];

      const temporalContext = { enabled: spatialViewMode === "simulation", date: simulationDate };
      const auditContext = { enabled: spatialViewMode === "audit", riskByFeatureId: planAudit.riskByFeatureId };

      renderedFeatureJoins.forEach((join, drawOrder) => {
        const baseStyle = join.style;
        const stateStyle = getFeatureVisualStyle(join, temporalContext, auditContext);
        const isSelected = selectedFeatureId === join.featureId;
        const fillStyle = colorToRgba(stateStyle.fillColor, baseStyle.fillOpacity);
        const strokeStyle = colorToRgba(stateStyle.strokeColor, baseStyle.strokeOpacity);
        const strokeWidth = isSelected ? Math.max(baseStyle.strokeWidth + 1.8, 3) : baseStyle.strokeWidth;
        const path = new Path2D();
        const drawState = appendGeometryToCanvasPath(path, join.feature.geometry, projectCoordinate, tolerance);
        const points: CanvasHitRegion["points"] = getPointCoordinates(join.feature.geometry)
          .map((coord: number[]) => {
            const point = projectCoordinate(coord);
            return {
              x: point.x,
              y: point.y,
              radius: isSelected ? 7 : 4.5,
            };
          })
          .filter((point: CanvasHitRegion["points"][number]) => Number.isFinite(point.x) && Number.isFinite(point.y));

        context.globalAlpha = 1;
        if (drawState.hasFill) {
          context.fillStyle = fillStyle;
          context.fill(path, "evenodd");
        }

        if (drawState.hasStroke) {
          context.strokeStyle = isSelected ? "#1d4ed8" : strokeStyle;
          context.lineWidth = strokeWidth;
          context.stroke(path);
        }

        points.forEach((point) => {
          context.beginPath();
          context.arc(point.x, point.y, point.radius, 0, Math.PI * 2);
          context.fillStyle = stateStyle.strokeColor;
          context.fill();
          context.lineWidth = isSelected ? 2.5 : 1.5;
          context.strokeStyle = "#fff";
          context.stroke();
        });

        if (drawState.hasFill || drawState.hasStroke || points.length > 0) {
          const hitBoundsRect = getProjectedBoundsRect(join.bounds, mapView.zoom, topLeft);
          const labelCoordinate = getLabelCoordinate(join.feature.geometry);
          const labelPoint = labelCoordinate ? projectCoordinate(labelCoordinate) : null;
          const hitRegion: CanvasHitRegion = {
            featureId: join.featureId,
            layerId: join.layerId,
            path,
            strokeWidth: Math.max(strokeWidth + 5, 8),
            points,
            screenArea: Math.max(1, hitBoundsRect.width * hitBoundsRect.height),
            labelPoint: labelPoint && Number.isFinite(labelPoint.x) && Number.isFinite(labelPoint.y) ? labelPoint : null,
            labelRect: null,
            drawOrder,
          };
          hitRegions.push(hitRegion);
          hitRegionByFeatureId.set(join.featureId, hitRegion);
        }
      });

      visibleAnnotations.forEach((annotation) => {
        const style = normalizeAnnotationStyle(annotation.styleConfig);
        const isSelected = selectedAnnotationId === annotation.id;
        context.globalAlpha = 1;

        if (annotation.annotationType === "polygon" && annotation.geometry.type === "Polygon") {
          const { path, hasPath } = makeAnnotationPolygonPath(annotation, projectCoordinate);
          if (!hasPath) return;

          context.fillStyle = colorToRgba(style.fillColor, isSelected ? Math.min(0.7, style.fillOpacity + 0.15) : style.fillOpacity);
          context.strokeStyle = isSelected ? "#111827" : colorToRgba(style.strokeColor, style.strokeOpacity);
          context.lineWidth = isSelected ? Math.max(style.strokeWidth + 1.5, 3) : style.strokeWidth;
          context.setLineDash(isSelected ? [8, 5] : []);
          context.fill(path, "evenodd");
          context.stroke(path);
          context.setLineDash([]);

          const ring = annotation.geometry.coordinates?.[0] || [];
          ring.slice(0, -1).forEach((coordinate) => {
            const point = projectCoordinate(coordinate);
            if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
              drawAnnotationPointHandle(context, point, style.strokeColor);
            }
          });

          const labelCoordinate = getAnnotationCoordinate(annotation);
          if (labelCoordinate && annotation.title && mapView.zoom >= 12) {
            const labelPoint = projectCoordinate(labelCoordinate);
            if (Number.isFinite(labelPoint.x) && Number.isFinite(labelPoint.y)) {
              drawAnnotationLabel(context, annotation.title, labelPoint, {
                ...style,
                textColor: style.strokeColor,
                fontSize: Math.max(11, Math.min(16, style.fontSize - 1)),
              }, 0);
            }
          }

          annotationHitRegions.push({
            annotationId: annotation.id,
            path,
            strokeWidth: Math.max(style.strokeWidth + 8, 12),
          });
          return;
        }

        if (annotation.annotationType === "label" && annotation.geometry.type === "Point") {
          const point = projectCoordinate(annotation.geometry.coordinates);
          if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
          const renderStyle = getZoomAwareAnnotationStyle(style, mapView.zoom);
          const rect = drawAnnotationLabel(context, annotation.body || annotation.title, point, renderStyle, Number(annotation.rotation || 0));
          if (rect) {
            if (isSelected) {
              context.save();
              context.strokeStyle = "#4f46e5";
              context.lineWidth = 2;
              context.setLineDash([5, 4]);
              context.strokeRect(rect.left, rect.top, rect.width, rect.height);
              context.restore();
            }
            annotationHitRegions.push({
              annotationId: annotation.id,
              rect,
              strokeWidth: 10,
            });
          }
        }
      });

      if (polygonDraftPoints.length > 0) {
        const style = annotationStyle;
        const path = new Path2D();
        polygonDraftPoints.forEach((coordinate, index) => {
          const point = projectCoordinate(coordinate);
          if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
          if (index === 0) path.moveTo(point.x, point.y);
          else path.lineTo(point.x, point.y);
        });
        context.strokeStyle = colorToRgba(style.strokeColor, 0.95);
        context.lineWidth = Math.max(2, style.strokeWidth);
        context.setLineDash([7, 5]);
        context.stroke(path);
        context.setLineDash([]);
        if (polygonDraftPoints.length >= 3) {
          const closedPath = new Path2D(path);
          closedPath.closePath();
          context.fillStyle = colorToRgba(style.fillColor, Math.min(0.35, style.fillOpacity));
          context.fill(closedPath, "evenodd");
        }
        polygonDraftPoints.forEach((coordinate) => {
          const point = projectCoordinate(coordinate);
          if (Number.isFinite(point.x) && Number.isFinite(point.y)) drawAnnotationPointHandle(context, point, style.strokeColor);
        });
      }

      if (labelDraftPoint) {
        const point = projectCoordinate(labelDraftPoint);
        if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
          drawAnnotationLabel(
            context,
            annotationBody || annotationTitle || "Etiqueta",
            point,
            getZoomAwareAnnotationStyle(annotationStyle, mapView.zoom),
            annotationRotation
          );
        }
      }

      annotationHitRegionsRef.current = annotationHitRegions;

      if (mapView.zoom >= getMinimumLabelZoom(renderedFeatureJoins.length)) {
        const occupiedLabelRects: ScreenRect[] = [];
        const viewportRect = makeScreenRect(0, 0, width, height);

        renderedFeatureJoins.forEach((join) => {
          if (!join.style.labelsVisible || !join.label) return;
          const labelCoordinate = getLabelCoordinate(join.feature.geometry);
          if (!labelCoordinate) return;
          const labelPoint = projectCoordinate(labelCoordinate);
          if (!Number.isFinite(labelPoint.x) || !Number.isFinite(labelPoint.y)) return;

          const isPolygonal = isPolygonalGeometry(join.feature.geometry);
          const featureRect = getProjectedBoundsRect(join.bounds, mapView.zoom, topLeft);
          if (isPolygonal && (featureRect.width < 36 || featureRect.height < LABEL_HEIGHT + 6)) return;

          const label = buildCanvasLabel(context, join.label, labelPoint, {
            maxWidth: isPolygonal ? Math.min(180, featureRect.width - 8) : 180,
            placement: isPolygonal ? "inside" : "above",
            containerRect: isPolygonal ? featureRect : undefined,
            viewportRect,
          });
          if (!label) return;
          if (occupiedLabelRects.some((rect) => rectsIntersect(label.rect, rect, LABEL_COLLISION_PADDING))) return;

          const stateStyle = getFeatureVisualStyle(join, temporalContext, auditContext);
          drawCanvasLabel(context, label.text, label.rect, stateStyle.strokeColor);
          occupiedLabelRects.push(label.rect);

          const region = hitRegionByFeatureId.get(join.featureId);
          if (region) {
            region.labelRect = label.rect;
            region.labelPoint = {
              x: label.rect.left + label.rect.width / 2,
              y: label.rect.top + label.rect.height / 2,
            };
          }
        });
      }

      hitRegionsRef.current = hitRegions;
    });

    return () => cancelAnimationFrame(frame);
  }, [
    mapSize.height,
    mapSize.width,
    mapView.zoom,
    annotationBody,
    annotationRotation,
    annotationStyle,
    annotationTitle,
    labelDraftPoint,
    planAudit.riskByFeatureId,
    polygonDraftPoints,
    projectCoordinate,
    renderedFeatureJoins,
    selectedAnnotationId,
    selectedFeatureId,
    simulationDate,
    spatialViewMode,
    topLeft,
    visibleAnnotations,
  ]);

  const tiles = useMemo(() => {
    const tileZoom = Math.min(mapView.zoom, MAX_TILE_ZOOM);
    const tileScale = Math.pow(2, mapView.zoom - tileZoom);
    const maxTile = Math.pow(2, tileZoom);
    const tileTopLeft = {
      x: topLeft.x / tileScale,
      y: topLeft.y / tileScale,
    };
    const startX = Math.floor(tileTopLeft.x / TILE_SIZE);
    const endX = Math.floor((tileTopLeft.x + mapSize.width / tileScale) / TILE_SIZE);
    const startY = Math.max(0, Math.floor(tileTopLeft.y / TILE_SIZE));
    const endY = Math.min(maxTile - 1, Math.floor((tileTopLeft.y + mapSize.height / tileScale) / TILE_SIZE));
    const nextTiles: Array<{ key: string; url: string; left: number; top: number; size: number }> = [];

    for (let tileX = startX; tileX <= endX; tileX += 1) {
      for (let tileY = startY; tileY <= endY; tileY += 1) {
        const wrappedX = ((tileX % maxTile) + maxTile) % maxTile;
        nextTiles.push({
          key: `${mapView.zoom}-${tileZoom}-${tileX}-${tileY}`,
          url: `${OSM_TILE_URL}/${tileZoom}/${wrappedX}/${tileY}.png`,
          left: tileX * TILE_SIZE * tileScale - topLeft.x,
          top: tileY * TILE_SIZE * tileScale - topLeft.y,
          size: TILE_SIZE * tileScale,
        });
      }
    }

    return nextTiles;
  }, [mapSize.height, mapSize.width, mapView.zoom, topLeft.x, topLeft.y]);

  const handleUploadFile = async (file: File | null, explicitName?: string) => {
    if (!file || !canManage) return false;

    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    const sourceType = extension === "zip" ? "shapefile" : "geojson";

    if (!["zip", "geojson", "json"].includes(extension)) {
      toast.warning("Sube un shapefile comprimido .zip o un archivo .geojson.");
      return false;
    }

    const name = (explicitName || file.name.replace(/\.[^.]+$/, "")).trim();
    if (!name) {
      toast.warning("Escribe un nombre para identificar la capa.");
      return false;
    }

    setUploading(true);
    setUploadProgressText(sourceType === "shapefile" ? "Leyendo y convirtiendo el shapefile…" : "Leyendo GeoJSON…");
    const uploadedStoragePaths: string[] = [];
    try {
      let parsed: any;
      if (sourceType === "shapefile") {
        const parser = await loadShapefileParser();
        parsed = await parser(await file.arrayBuffer());
      } else {
        parsed = JSON.parse(await file.text());
      }

      const geojson = normalizeGeoJson(parsed);
      if (geojson.features.length === 0) {
        throw new Error("La capa no contiene entidades espaciales.");
      }

      const attributes = extractAttributes(geojson);
      const firstAttribute = attributes[0] || "";
      const bounds = getGeoJsonBounds(geojson);
      const initialStoragePath = makeSpatialLayerStoragePath(projectId, file.name);
      const styleConfig = normalizeLayerStyle(DEFAULT_LAYER_STYLE);
      const chunks = makeSpatialLayerChunks(geojson, file.name);
      let storagePath = initialStoragePath;
      let downloadUrl = "";

      if (chunks.length === 1) {
        setUploadProgressText(`Guardando geometría en Supabase (${formatBytes(chunks[0].file.size)})…`);
        const geoJsonRef = ref(storage, storagePath);
        await uploadBytesToSupabase(geoJsonRef, chunks[0].file);
        storagePath = geoJsonRef.fullPath;
        uploadedStoragePaths.push(storagePath);
        downloadUrl = await getDownloadURL(geoJsonRef);
      } else {
        const baseStoragePath = initialStoragePath.replace(/\.geojson$/i, "");
        const manifestChunks: SpatialLayerManifest["chunks"] = [];

        for (let index = 0; index < chunks.length; index += 1) {
          const chunk = chunks[index];
          const partNumber = String(index + 1).padStart(4, "0");
          const chunkStoragePath = `${baseStoragePath}.part-${partNumber}.geojson`;
          const chunkRef = ref(storage, chunkStoragePath);
          setUploadProgressText(
            `Guardando fragmento ${index + 1} de ${chunks.length} en Supabase (${formatBytes(chunk.file.size)})…`
          );
          await uploadBytesToSupabase(chunkRef, chunk.file);
          uploadedStoragePaths.push(chunkRef.fullPath);
          manifestChunks.push({
            storagePath: chunkRef.fullPath,
            downloadUrl: await getDownloadURL(chunkRef),
            featureCount: chunk.featureCount,
            size: chunk.file.size,
          });
        }

        const manifest: SpatialLayerManifest = {
          kind: "pixel-spatial-layer-manifest",
          version: 1,
          featureCount: geojson.features.length,
          chunks: manifestChunks,
        };
        storagePath = `${baseStoragePath}.manifest.json`;
        const manifestRef = ref(storage, storagePath);
        const manifestFile = new File(
          [JSON.stringify(manifest)],
          `${safeFilePart(file.name.replace(/\.[^.]+$/, ""))}.manifest.json`,
          { type: "application/json" }
        );
        setUploadProgressText("Finalizando el índice de la capa…");
        await uploadBytesToSupabase(manifestRef, manifestFile);
        storagePath = manifestRef.fullPath;
        uploadedStoragePaths.push(storagePath);
        downloadUrl = await getDownloadURL(manifestRef);
      }

      setUploadProgressText("Guardando los metadatos de la capa…");

      const { data, error } = await supabase
        .from(SPATIAL_LAYERS_TABLE)
        .insert({
          project_id: projectId,
          name,
          file_name: file.name,
          source_type: sourceType,
          storage_path: storagePath,
          download_url: downloadUrl,
          attributes,
          bounds,
          visible: true,
          style_config: styleConfig,
          join_config: {
            layerAttribute: firstAttribute,
            taskAttribute: "externalWorkflowId",
          },
          feature_count: geojson.features.length,
          created_by: currentUser?.uid || null,
          updated_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (error) {
        throw error;
      }

      uploadedStoragePaths.length = 0;

      const layerId = data?.id;
      if (layerId) {
        setLayerGeojsons((current) => ({ ...current, [layerId]: geojson }));
      }

      setLayers((current) => [
        {
          id: layerId || storagePath,
          name,
          fileName: file.name,
          sourceType,
          storagePath,
          downloadUrl,
          attributes,
          bounds,
          visible: true,
          styleConfig,
          joinConfig: {
            layerAttribute: firstAttribute,
            taskAttribute: "externalWorkflowId",
          },
          featureCount: geojson.features.length,
        },
        ...current,
      ]);

      setSelectedLayerId(layerId || storagePath);
      setIsUploadModalOpen(false);
      setUploadDraftFile(null);
      setUploadDraftName("");
      toast.success(`Capa "${name}" cargada con ${geojson.features.length} entidades.`);
      return true;
    } catch (error: any) {
      console.error("Error uploading spatial layer:", error);
      if (uploadedStoragePaths.length > 0) {
        await Promise.all(
          uploadedStoragePaths.map((storagePath) =>
            deleteObject(ref(storage, storagePath)).catch((storageError) => {
              console.warn("Spatial layer storage cleanup failed:", storageError);
            })
          )
        );
      }
      toast.error(error?.message || "No se pudo procesar la capa espacial.");
      return false;
    } finally {
      setUploading(false);
      setUploadProgressText("");
    }
  };

  const handleSaveJoin = async () => {
    if (!selectedLayer || !canManage) return;
    if (!canSaveSpatialJoin) {
      toast.warning(
        joinMode === "municipality_department"
          ? "Selecciona los atributos de municipio y departamento de la capa."
          : "Selecciona el atributo de la capa y el atributo de tarea."
      );
      return;
    }

    try {
      const joinConfig: NonNullable<SpatialLayer["joinConfig"]> =
        joinMode === "municipality_department"
          ? {
              joinMode,
              taskAttribute: "municipalityDepartment",
              layerMunicipalityAttribute,
              layerDepartmentAttribute,
            }
          : {
              joinMode,
              layerAttribute,
              taskAttribute: effectiveTaskAttribute,
            };
      const { error } = await supabase
        .from(SPATIAL_LAYERS_TABLE)
        .update({
          join_config: joinConfig,
          updated_at: new Date().toISOString(),
        })
        .eq("id", selectedLayer.id)
        .eq("project_id", projectId);

      if (error) throw error;

      setLayers((current) =>
        current.map((layer) =>
          layer.id === selectedLayer.id
            ? {
                ...layer,
                joinConfig,
              }
            : layer
        )
      );
      toast.success("Unión espacial guardada.");
    } catch (error) {
      console.error("Error saving spatial join:", error);
      toast.error("No se pudo guardar la unión espacial.");
    }
  };

  const handleSaveLayerSettings = async () => {
    if (!selectedLayer || !canManage) return;
    const nextName = layerEditName.trim();
    if (!nextName) {
      toast.warning("Escribe un nombre para la capa.");
      return;
    }

    const nextStyle = normalizeLayerStyle(layerEditStyle);
    setSavingLayerSettings(true);
    try {
      const { error } = await supabase
        .from(SPATIAL_LAYERS_TABLE)
        .update({
          name: nextName,
          visible: layerEditVisible,
          style_config: nextStyle,
          updated_at: new Date().toISOString(),
        })
        .eq("id", selectedLayer.id)
        .eq("project_id", projectId);

      if (error) throw error;

      setLayers((current) =>
        current.map((layer) =>
          layer.id === selectedLayer.id
            ? {
                ...layer,
                name: nextName,
                visible: layerEditVisible,
                styleConfig: nextStyle,
              }
            : layer
        )
      );
      toast.success("Capa actualizada.");
    } catch (error) {
      console.error("Error saving spatial layer settings:", error);
      toast.error("No se pudo guardar la configuración de la capa.");
    } finally {
      setSavingLayerSettings(false);
    }
  };

  const handleToggleLayerVisibility = async (layer: SpatialLayer, visible: boolean) => {
    if (!canManage) return;

    setLayers((current) => current.map((item) => (item.id === layer.id ? { ...item, visible } : item)));
    if (layer.id === selectedLayerId) setLayerEditVisible(visible);
    if (visible) setSelectedLayerId(layer.id);

    try {
      const { error } = await supabase
        .from(SPATIAL_LAYERS_TABLE)
        .update({
          visible,
          updated_at: new Date().toISOString(),
        })
        .eq("id", layer.id)
        .eq("project_id", projectId);

      if (error) throw error;
      toast.success(visible ? "Capa encendida en el mapa." : "Capa apagada del mapa.");
    } catch (error) {
      console.error("Error updating spatial layer visibility:", error);
      setLayers((current) => current.map((item) => (item.id === layer.id ? { ...item, visible: layer.visible !== false } : item)));
      if (layer.id === selectedLayerId) setLayerEditVisible(layer.visible !== false);
      toast.error("No se pudo actualizar la visibilidad de la capa.");
    }
  };

  const handleDeleteLayer = async () => {
    if (!layerPendingDelete || !canManage) return;

    try {
      const storagePaths = await getSpatialLayerObjectPaths(layerPendingDelete);
      const { error } = await supabase
        .from(SPATIAL_LAYERS_TABLE)
        .delete()
        .eq("id", layerPendingDelete.id)
        .eq("project_id", projectId);

      if (error) throw error;

      if (storagePaths.length > 0) {
        await Promise.all(
          storagePaths.map((storagePath) =>
            deleteObject(ref(storage, storagePath)).catch((storageError) => {
              console.warn("Spatial layer storage object was not deleted:", storageError);
            })
          )
        );
      }

      setLayerGeojsons((current) => {
        const next = { ...current };
        delete next[layerPendingDelete.id];
        return next;
      });
      setLayers((current) => current.filter((layer) => layer.id !== layerPendingDelete.id));
      setLayerPendingDelete(null);
      toast.success("Capa eliminada.");
    } catch (error) {
      console.error("Error deleting spatial layer:", error);
      toast.error("No se pudo eliminar la capa.");
    }
  };

  const resetAnnotationDraft = useCallback(() => {
    setAnnotationTool(null);
    setPolygonDraftPoints([]);
    setLabelDraftPoint(null);
    setAnnotationTitle("");
    setAnnotationBody("");
    setAnnotationRotation(0);
    setAnnotationStyle(DEFAULT_ANNOTATION_STYLE);
  }, []);

  const startAnnotationTool = (tool: SpatialAnnotationType) => {
    if (!canManage) return;
    setSelectedAnnotationId(null);
    setSelectedFeatureId(null);
    setAnnotationTool(tool);
    setPolygonDraftPoints([]);
    setLabelDraftPoint(null);
    setAnnotationTitle(tool === "polygon" ? "Nueva figura" : "Etiqueta personalizada");
    setAnnotationBody(tool === "label" ? "Nueva etiqueta" : "");
    setAnnotationRotation(0);
    setAnnotationStyle({ ...DEFAULT_ANNOTATION_STYLE, zoomReference: mapView.zoom });
    setSpatialPanelTab("style");
  };

  const getPointerLonLat = (event: React.PointerEvent<HTMLDivElement>) => {
    const mapElement = mapRef.current;
    if (!mapElement) return null;
    const rect = mapElement.getBoundingClientRect();
    return unprojectPoint(
      {
        x: topLeft.x + event.clientX - rect.left,
        y: topLeft.y + event.clientY - rect.top,
      },
      mapView.zoom
    );
  };

  const handleSaveAnnotation = async () => {
    if (!canManage) return;

    const styleConfig = normalizeAnnotationStyle(annotationStyle);
    const title = annotationTitle.trim() || (annotationTool === "label" ? "Etiqueta personalizada" : "Figura personalizada");
    const body = annotationBody.trim();
    let annotationType: SpatialAnnotationType = selectedAnnotation?.annotationType || annotationTool || "polygon";
    let geometry: SpatialAnnotationGeometry | null = selectedAnnotation?.geometry || null;

    if (!selectedAnnotation) {
      if (annotationTool === "polygon") {
        if (polygonDraftPoints.length < 3) {
          toast.warning("Dibuja al menos tres puntos para guardar el polígono.");
          return;
        }
        const ring = [...polygonDraftPoints, polygonDraftPoints[0]];
        annotationType = "polygon";
        geometry = { type: "Polygon", coordinates: [ring] };
      } else if (annotationTool === "label") {
        if (!labelDraftPoint) {
          toast.warning("Haz clic sobre el mapa para ubicar la etiqueta.");
          return;
        }
        if (!body && !title) {
          toast.warning("Escribe el texto de la etiqueta.");
          return;
        }
        annotationType = "label";
        geometry = { type: "Point", coordinates: labelDraftPoint };
      }
    }

    if (!geometry) return;

    setSavingAnnotation(true);
    try {
      if (selectedAnnotation) {
        const { error } = await supabase
          .from(SPATIAL_ANNOTATIONS_TABLE)
          .update({
            title,
            body,
            style_config: styleConfig,
            rotation: annotationType === "label" ? annotationRotation : 0,
            updated_at: new Date().toISOString(),
          })
          .eq("id", selectedAnnotation.id)
          .eq("project_id", projectId);

        if (error) throw error;
        setAnnotations((current) =>
          current.map((annotation) =>
            annotation.id === selectedAnnotation.id
              ? {
                  ...annotation,
                  title,
                  body,
                  styleConfig,
                  rotation: annotationType === "label" ? annotationRotation : 0,
                }
              : annotation
          )
        );
        toast.success("Anotación actualizada.");
        return;
      }

      const { data, error } = await supabase
        .from(SPATIAL_ANNOTATIONS_TABLE)
        .insert({
          project_id: projectId,
          annotation_type: annotationType,
          title,
          body,
          geometry,
          style_config: styleConfig,
          visible: true,
          rotation: annotationType === "label" ? annotationRotation : 0,
          created_by: currentUser?.uid || currentUser?.id || null,
          updated_at: new Date().toISOString(),
        })
        .select("*")
        .single();

      if (error) throw error;

      const created = mapSpatialAnnotationRow(data as SpatialAnnotationRow);
      if (created) {
        setAnnotations((current) => [created, ...current]);
        setSelectedAnnotationId(created.id);
      }
      resetAnnotationDraft();
      toast.success(annotationType === "label" ? "Etiqueta creada." : "Figura creada.");
    } catch (error) {
      console.error("Error saving spatial annotation:", error);
      toast.error("No se pudo guardar la anotación espacial.");
    } finally {
      setSavingAnnotation(false);
    }
  };

  const handleToggleAnnotationVisibility = async (annotation: SpatialAnnotation, visible: boolean) => {
    if (!canManage) return;
    setAnnotations((current) => current.map((item) => (item.id === annotation.id ? { ...item, visible } : item)));
    try {
      const { error } = await supabase
        .from(SPATIAL_ANNOTATIONS_TABLE)
        .update({ visible, updated_at: new Date().toISOString() })
        .eq("id", annotation.id)
        .eq("project_id", projectId);
      if (error) throw error;
    } catch (error) {
      console.error("Error toggling spatial annotation:", error);
      setAnnotations((current) => current.map((item) => (item.id === annotation.id ? { ...item, visible: annotation.visible !== false } : item)));
      toast.error("No se pudo cambiar la visibilidad de la anotación.");
    }
  };

  const handleDeleteAnnotation = async (annotation: SpatialAnnotation) => {
    if (!canManage) return;
    try {
      const { error } = await supabase
        .from(SPATIAL_ANNOTATIONS_TABLE)
        .delete()
        .eq("id", annotation.id)
        .eq("project_id", projectId);
      if (error) throw error;
      setAnnotations((current) => current.filter((item) => item.id !== annotation.id));
      if (selectedAnnotationId === annotation.id) {
        setSelectedAnnotationId(null);
        resetAnnotationDraft();
      }
      toast.success("Anotación eliminada.");
    } catch (error) {
      console.error("Error deleting spatial annotation:", error);
      toast.error("No se pudo eliminar la anotación.");
    }
  };

  const setZoom = useCallback(
    (nextZoom: number | ((currentZoom: number) => number), anchorPoint?: ProjectedPoint) => {
      setMapView((current) => {
        const requestedZoom = typeof nextZoom === "function" ? nextZoom(current.zoom) : nextZoom;
        const zoom = Math.round(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, requestedZoom)));
        if (zoom === current.zoom) return current;
        if (!anchorPoint || mapSize.width <= 0 || mapSize.height <= 0) return { ...current, zoom };

        const currentCenterPx = projectLonLat(current.center.lon, current.center.lat, current.zoom);
        const currentTopLeft = {
          x: currentCenterPx.x - mapSize.width / 2,
          y: currentCenterPx.y - mapSize.height / 2,
        };
        const anchorWorldAtCurrentZoom = {
          x: currentTopLeft.x + anchorPoint.x,
          y: currentTopLeft.y + anchorPoint.y,
        };
        const zoomScale = Math.pow(2, zoom - current.zoom);
        const anchorWorldAtNextZoom = {
          x: anchorWorldAtCurrentZoom.x * zoomScale,
          y: anchorWorldAtCurrentZoom.y * zoomScale,
        };
        const nextTopLeft = {
          x: anchorWorldAtNextZoom.x - anchorPoint.x,
          y: anchorWorldAtNextZoom.y - anchorPoint.y,
        };
        const nextCenter = unprojectPoint(
          {
            x: nextTopLeft.x + mapSize.width / 2,
            y: nextTopLeft.y + mapSize.height / 2,
          },
          zoom
        );

        return { center: nextCenter, zoom };
      });
    },
    [mapSize.height, mapSize.width]
  );

  useEffect(() => {
    const mapElement = mapRef.current;
    if (!mapElement) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const rect = mapElement.getBoundingClientRect();
      const anchorPoint = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      const zoomDelta = event.deltaY > 0 ? -1 : 1;
      setZoom((currentZoom) => currentZoom + zoomDelta, anchorPoint);
    };

    mapElement.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      mapElement.removeEventListener("wheel", handleWheel);
    };
  }, [setZoom]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (annotationTool) {
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    if (isDrawingAnalysis) {
      const mapElement = mapRef.current;
      if (!mapElement) return;
      const rect = mapElement.getBoundingClientRect();
      event.currentTarget.setPointerCapture(event.pointerId);
      setAnalysisDraftRect({
        startX: event.clientX - rect.left,
        startY: event.clientY - rect.top,
        endX: event.clientX - rect.left,
        endY: event.clientY - rect.top,
      });
      setSelectedFeatureId(null);
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, center: mapView.center };
    setIsDragging(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (analysisDraftRect) {
      const mapElement = mapRef.current;
      if (!mapElement) return;
      const rect = mapElement.getBoundingClientRect();
      setAnalysisDraftRect((current) =>
        current
          ? {
              ...current,
              endX: event.clientX - rect.left,
              endY: event.clientY - rect.top,
            }
          : current
      );
      return;
    }

    if (!dragRef.current) return;
    const startCenterPx = projectLonLat(dragRef.current.center.lon, dragRef.current.center.lat, mapView.zoom);
    const dx = event.clientX - dragRef.current.x;
    const dy = event.clientY - dragRef.current.y;
    const nextCenter = unprojectPoint({ x: startCenterPx.x - dx, y: startCenterPx.y - dy }, mapView.zoom);
    pendingPanCenterRef.current = nextCenter;
    if (panFrameRef.current != null) return;
    panFrameRef.current = requestAnimationFrame(() => {
      const pendingCenter = pendingPanCenterRef.current;
      if (pendingCenter) {
        setMapView((current) => ({ ...current, center: pendingCenter }));
      }
      panFrameRef.current = null;
    });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (annotationTool) {
      const coordinate = getPointerLonLat(event);
      if (!coordinate) return;
      if (annotationTool === "polygon") {
        setPolygonDraftPoints((current) => [...current, [coordinate.lon, coordinate.lat]]);
      } else {
        setLabelDraftPoint([coordinate.lon, coordinate.lat]);
        toast.success("Etiqueta ubicada. Ajusta texto, color o rotación y guarda.");
      }
      return;
    }

    if (analysisDraftRect) {
      const mapElement = mapRef.current;
      if (!mapElement) return;
      const rect = mapElement.getBoundingClientRect();
      const completedRect = normalizeScreenRect({
        ...analysisDraftRect,
        endX: event.clientX - rect.left,
        endY: event.clientY - rect.top,
      });

      setAnalysisDraftRect(null);
      setIsDrawingAnalysis(false);

      if (completedRect.width < 14 || completedRect.height < 14) {
        toast.warning("Dibuja un área más amplia para calcular estadísticas.");
        return;
      }

      const northWest = unprojectPoint(
        {
          x: topLeft.x + completedRect.left,
          y: topLeft.y + completedRect.top,
        },
        mapView.zoom
      );
      const southEast = unprojectPoint(
        {
          x: topLeft.x + completedRect.left + completedRect.width,
          y: topLeft.y + completedRect.top + completedRect.height,
        },
        mapView.zoom
      );

      setAnalysisBounds({
        west: Math.min(northWest.lon, southEast.lon),
        south: Math.min(northWest.lat, southEast.lat),
        east: Math.max(northWest.lon, southEast.lon),
        north: Math.max(northWest.lat, southEast.lat),
      });
      return;
    }

    const dragState = dragRef.current;
    if (pendingPanCenterRef.current) {
      const pendingCenter = pendingPanCenterRef.current;
      setMapView((current) => ({ ...current, center: pendingCenter }));
      pendingPanCenterRef.current = null;
    }
    if (panFrameRef.current != null) {
      cancelAnimationFrame(panFrameRef.current);
      panFrameRef.current = null;
    }
    dragRef.current = null;
    setIsDragging(false);

    if (!dragState) return;
    const movedDistance = Math.hypot(event.clientX - dragState.x, event.clientY - dragState.y);
    if (movedDistance > 6) return;

    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    const mapElement = mapRef.current;
    if (!canvas || !context || !mapElement) return;

    const rect = mapElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hitRegions = hitRegionsRef.current;
    const annotationHitRegions = annotationHitRegionsRef.current;

    for (let index = annotationHitRegions.length - 1; index >= 0; index -= 1) {
      const region = annotationHitRegions[index];
      if (region.rect && x >= region.rect.left && x <= region.rect.right && y >= region.rect.top && y <= region.rect.bottom) {
        setSelectedAnnotationId(region.annotationId);
        setSelectedFeatureId(null);
        setSpatialPanelTab("style");
        return;
      }
      if (region.path) {
        context.lineWidth = region.strokeWidth;
        if (context.isPointInPath(region.path, x, y, "evenodd") || context.isPointInStroke(region.path, x, y)) {
          setSelectedAnnotationId(region.annotationId);
          setSelectedFeatureId(null);
          setSpatialPanelTab("style");
          return;
        }
      }
    }

    const featureCandidates: Array<{
      region: CanvasHitRegion;
      hitRank: number;
      labelDistance: number;
    }> = [];

    for (let index = hitRegions.length - 1; index >= 0; index -= 1) {
      const region = hitRegions[index];
      const labelHit = region.labelRect
        ? x >= region.labelRect.left - 2 &&
          x <= region.labelRect.right + 2 &&
          y >= region.labelRect.top - 2 &&
          y <= region.labelRect.bottom + 2
        : false;
      const pointHit = region.points.some((point) => Math.hypot(point.x - x, point.y - y) <= point.radius + 5);
      context.lineWidth = region.strokeWidth;
      const fillHit = context.isPointInPath(region.path, x, y, "evenodd");
      const strokeHit = context.isPointInStroke(region.path, x, y);
      if (!labelHit && !pointHit && !fillHit && !strokeHit) continue;

      featureCandidates.push({
        region,
        hitRank: labelHit ? 0 : pointHit ? 1 : fillHit ? 2 : 3,
        labelDistance: region.labelPoint ? Math.hypot(region.labelPoint.x - x, region.labelPoint.y - y) : Number.MAX_SAFE_INTEGER,
      });
    }

    if (featureCandidates.length > 0) {
      const bestCandidate = featureCandidates.sort((left, right) => {
        if (left.hitRank !== right.hitRank) return left.hitRank - right.hitRank;
        if (left.region.screenArea !== right.region.screenArea) return left.region.screenArea - right.region.screenArea;
        if (left.labelDistance !== right.labelDistance) return left.labelDistance - right.labelDistance;
        return right.region.drawOrder - left.region.drawOrder;
      })[0];

      setSelectedAnnotationId(null);
      setSelectedLayerId(bestCandidate.region.layerId);
      setSelectedFeatureId(bestCandidate.region.featureId);
      return;
    }

    setSelectedFeatureId(null);
    setSelectedAnnotationId(null);
  };

  const recenterLayer = () => {
    const bounds = getGeoJsonBounds(selectedLayerGeojson) || selectedLayer?.bounds || null;
    setMapView(getFittedView(bounds, mapSize.width, mapSize.height));
  };

  const handleSaveSpatialTaskView = async () => {
    if (!canManage) return;
    const name = viewDraftName.trim();
    if (!name) {
      toast.error("Ponle un nombre a la vista.");
      return;
    }
    if (viewDraftScope === "task" && !viewDraftTaskId) {
      toast.error("Selecciona la tarea base de la vista.");
      return;
    }
    if (viewDraftScope === "group" && !viewDraftGroupId) {
      toast.error("Selecciona el grupo visual de la vista.");
      return;
    }

    setSavingSpatialTaskView(true);
    try {
      const viewId = createSpatialViewId();
      const viewRef = doc(spatialViewsCollectionRef, viewId);
      const payload: SpatialTaskView = {
        id: viewId,
        projectId,
        name,
        scope: viewDraftScope,
        taskIds: viewDraftScope === "task" ? [viewDraftTaskId] : [],
        groupIds: viewDraftScope === "group" ? [viewDraftGroupId] : [],
        includeSubtasks: viewDraftScope === "task" ? viewDraftIncludeSubtasks : true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(viewRef, payload);
      await loadSpatialTaskViews();
      setActiveSpatialTaskViewId(viewId);
      setViewDraftName("");
      toast.success("Vista espacial guardada.");
    } catch (error) {
      console.error("Error saving spatial task view:", error);
      toast.error("No se pudo guardar la vista espacial.");
    } finally {
      setSavingSpatialTaskView(false);
    }
  };

  const handleDeleteSpatialTaskView = async (view: SpatialTaskView) => {
    if (!canManage || view.id === DEFAULT_SPATIAL_VIEW_ID) return;
    setSavingSpatialTaskView(true);
    try {
      await deleteDoc(doc(spatialViewsCollectionRef, view.id));
      if (activeSpatialTaskViewId === view.id) setActiveSpatialTaskViewId(DEFAULT_SPATIAL_VIEW_ID);
      await loadSpatialTaskViews();
      toast.success("Vista espacial eliminada.");
    } catch (error) {
      console.error("Error deleting spatial task view:", error);
      toast.error("No se pudo eliminar la vista espacial.");
    } finally {
      setSavingSpatialTaskView(false);
    }
  };

  const updateLayerStatusColor = (statusKey: SpatialStyleKey, color: string) => {
    setLayerEditStyle((current) => ({
      ...current,
      fillColor: statusKey === "unlinked" ? color : current.fillColor,
      strokeColor: statusKey === "unlinked" ? color : current.strokeColor,
      statusStyles: {
        ...current.statusStyles,
        [statusKey]: {
          fillColor: color,
          strokeColor: color,
        },
      },
    }));
  };

  const updateLayerUniqueColor = (color: string) => {
    setLayerEditStyle((current) => ({
      ...current,
      fillColor: color,
      strokeColor: color,
    }));
  };

  const setSimulationOffset = (offset: number) => {
    const safeOffset = Math.min(simulationRange.totalDays, Math.max(0, Math.round(offset)));
    setSimulationDateValue(formatDateInputValue(addDays(simulationRange.start, safeOffset)));
  };

  const shiftSimulationDate = (days: number) => {
    setSimulationOffset(simulationDayOffset + days);
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-emerald-600" />
            <h2 className="text-xl font-black tracking-tight text-slate-900">Mapa operativo</h2>
          </div>
          <p className="mt-1 max-w-3xl text-sm font-medium leading-6 text-slate-500">
            Espacializa tareas del proyecto uniendo capas geográficas con atributos como ID de workflow, municipio o una clave personalizada.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
            {[
              { key: "current", label: "Estado actual" },
              { key: "simulation", label: "Simulación" },
              { key: "audit", label: "Auditoría" },
            ].map((option) => {
              const isActive = spatialViewMode === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => {
                    setSpatialViewMode(option.key as SpatialViewMode);
                    if (option.key === "simulation") setSpatialPanelTab("simulation");
                    if (option.key === "audit") setSpatialPanelTab("analysis");
                  }}
                  className={`rounded-lg px-3 py-2 text-xs font-black transition ${
                    isActive ? "bg-slate-950 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={() => setSpatialPanelTab("views")}
            className={activeSpatialTaskView.id !== DEFAULT_SPATIAL_VIEW_ID ? "border-indigo-200 bg-indigo-50 text-indigo-700" : ""}
          >
            <Eye size={16} className="mr-2" />
            {activeSpatialTaskView.name}
          </Button>

          <Button type="button" variant="outline" onClick={() => setIsLayerManagerOpen(true)} disabled={layers.length === 0}>
            <Settings2 size={16} className="mr-2" />
            Configuración
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setSpatialPanelTab("style");
              setAnnotationTool((current) => current || "polygon");
            }}
          >
            <PenLine size={16} className="mr-2" />
            Anotar mapa
          </Button>

          {canManage && (
            <Button
              type="button"
              onClick={() => {
                setUploadDraftFile(null);
                setUploadDraftName("");
                setIsUploadModalOpen(true);
              }}
              disabled={uploading}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {uploading ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Upload size={16} className="mr-2" />}
              Subir capa
            </Button>
          )}
        </div>
      </div>

      {spatialStoreError && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-900">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <p className="font-black">La base espacial todavía no está lista</p>
              <p className="mt-1">
                {spatialStoreError} Aplica la migración de PostGIS antes de cargar nuevas capas. Mientras tanto, no se guardarán shapefiles dentro de documentos pesados.
              </p>
            </div>
          </div>
        </div>
      )}

      {annotationStoreError && (
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-sm font-semibold leading-6 text-indigo-900">
          <div className="flex gap-3">
            <PenLine className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600" />
            <div>
              <p className="font-black">Anotaciones del mapa pendientes</p>
              <p className="mt-1">
                {annotationStoreError} Las capas cargadas siguen funcionando, pero las figuras y etiquetas personalizadas no se guardarán hasta aplicar la migración.
              </p>
            </div>
          </div>
        </div>
      )}

      {selectedLayer && !selectedLayer.downloadUrl && !selectedLayerGeojson && (
        <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm font-semibold leading-6 text-orange-900">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-orange-600" />
            <div>
              <p className="font-black">Capa antigua sin archivo liviano</p>
              <p className="mt-1">
                Esta capa parece venir del almacenamiento anterior. Elimínala y vuelve a cargarla para que quede en Storage y no en la base de datos.
              </p>
            </div>
          </div>
        </div>
      )}

      {selectedLayer && (selectedLayer.featureCount || 0) > MAX_RENDER_FEATURES && (
        <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4 text-sm font-semibold leading-6 text-cyan-900">
          <div className="flex gap-3">
            <Database className="mt-0.5 h-5 w-5 shrink-0 text-cyan-700" />
            <div>
              <p className="font-black">Capa pesada protegida</p>
              <p className="mt-1">
                Esta capa tiene {selectedLayer.featureCount?.toLocaleString("es-CO")} entidades. El mapa muestra hasta {MAX_RENDER_FEATURES.toLocaleString("es-CO")} entidades que intersectan la ventana visible actual y se recalcula al mover o acercar el mapa. Ahora ves {stats.visibleFeatures.toLocaleString("es-CO")} de {stats.viewportFeatures.toLocaleString("es-CO")} entidades dentro de esta vista.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="self-start overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/70 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="grid flex-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs font-black uppercase tracking-[0.18em] text-slate-400">Capa a configurar</label>
                <select
                  value={selectedLayerId}
                  onChange={(event) => {
                    setSelectedLayerId(event.target.value);
                    setSelectedFeatureId(null);
                  }}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                >
                  {layers.length === 0 ? (
                    <option value="">Sin capas cargadas</option>
                  ) : (
                    layers.map((layer) => (
                      <option key={layer.id} value={layer.id}>
                        {layer.name || layer.fileName || "Capa sin nombre"}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-black uppercase tracking-[0.18em] text-slate-400">Modo de unión</label>
                <select
                  value={joinMode}
                  onChange={(event) => setJoinMode(event.target.value as "single" | "municipality_department")}
                  disabled={!selectedLayer || !canManage}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:bg-slate-100"
                >
                  <option value="single">Una llave</option>
                  <option value="municipality_department">Municipio + departamento</option>
                </select>
              </div>

              {joinMode === "single" ? (
                <>
                  <div>
                    <label className="mb-1 block text-xs font-black uppercase tracking-[0.18em] text-slate-400">Atributo capa</label>
                    <select
                      value={layerAttribute}
                      onChange={(event) => setLayerAttribute(event.target.value)}
                      disabled={!selectedLayer || !canManage}
                      className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:bg-slate-100"
                    >
                      {(selectedLayer?.attributes || []).length === 0 && <option value="">Sin atributos</option>}
                      {(selectedLayer?.attributes || []).map((attribute) => (
                        <option key={attribute} value={attribute}>{attribute}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-black uppercase tracking-[0.18em] text-slate-400">Atributo tarea</label>
                    <select
                      value={taskAttributeOptions.some((option) => option.value === taskAttribute) ? taskAttribute : "__custom__"}
                      onChange={(event) => {
                        setTaskAttribute(event.target.value);
                        if (event.target.value !== "__custom__") setCustomTaskAttribute("");
                      }}
                      disabled={!selectedLayer || !canManage}
                      className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:bg-slate-100"
                    >
                      {taskAttributeOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                      <option value="__custom__">Campo personalizado</option>
                    </select>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="mb-1 block text-xs font-black uppercase tracking-[0.18em] text-slate-400">Municipio en capa</label>
                    <select
                      value={layerMunicipalityAttribute}
                      onChange={(event) => setLayerMunicipalityAttribute(event.target.value)}
                      disabled={!selectedLayer || !canManage}
                      className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:bg-slate-100"
                    >
                      <option value="">Selecciona atributo</option>
                      {(selectedLayer?.attributes || []).map((attribute) => (
                        <option key={attribute} value={attribute}>{attribute}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-black uppercase tracking-[0.18em] text-slate-400">Departamento en capa</label>
                    <select
                      value={layerDepartmentAttribute}
                      onChange={(event) => setLayerDepartmentAttribute(event.target.value)}
                      disabled={!selectedLayer || !canManage}
                      className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:bg-slate-100"
                    >
                      <option value="">Selecciona atributo</option>
                      {(selectedLayer?.attributes || []).map((attribute) => (
                        <option key={attribute} value={attribute}>{attribute}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={recenterLayer} disabled={!selectedLayer}>
                <RefreshCw size={15} className="mr-2" />
                Centrar
              </Button>
              {canManage && (
                <Button type="button" onClick={handleSaveJoin} disabled={!canSaveSpatialJoin} className="bg-slate-950 text-white hover:bg-slate-800">
                  <Save size={15} className="mr-2" />
                  Guardar unión
                </Button>
              )}
            </div>
          </div>

          {joinMode === "single" && taskAttribute === "__custom__" && (
            <div className="border-b border-slate-100 bg-white px-4 py-3">
              <label className="mb-1 block text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                Campo personalizado de tarea
              </label>
              <input
                value={customTaskAttribute}
                onChange={(event) => setCustomTaskAttribute(event.target.value)}
                placeholder="Ej: spatialKey, metadata.codigo_predio"
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
          )}

          <div className="relative min-h-[560px] bg-slate-100" style={{ height: "min(72vh, 760px)" }}>
            <div
              ref={mapRef}
              className={`absolute inset-0 touch-none overflow-hidden overscroll-contain ${
                isDrawingAnalysis || annotationTool ? "cursor-crosshair" : isDragging ? "cursor-grabbing" : "cursor-grab"
              }`}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              {tiles.map((tile) => (
                <img
                  key={tile.key}
                  src={tile.url}
                  alt=""
                  draggable={false}
                  className="pointer-events-none absolute select-none"
                  style={{ left: tile.left, top: tile.top, width: tile.size, height: tile.size }}
                />
              ))}

              <canvas
                ref={canvasRef}
                className="pointer-events-none absolute inset-0 h-full w-full"
                aria-label="Capa espacial renderizada"
              />

              {!selectedLayer && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/80 p-6 text-center backdrop-blur-sm">
                  <div className="max-w-md rounded-2xl border border-dashed border-emerald-200 bg-emerald-50 p-6">
                    <Layers className="mx-auto h-10 w-10 text-emerald-600" />
                    <h3 className="mt-3 text-xl font-black text-slate-900">Carga tu primera capa espacial</h3>
                    <p className="mt-2 text-sm font-medium leading-6 text-slate-600">
                      Puedes subir un shapefile comprimido en .zip o un GeoJSON. Luego eliges el atributo para unirlo con tareas.
                    </p>
                  </div>
                </div>
              )}

              {loadingLayerData && selectedLayer && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/70 p-6 text-center backdrop-blur-sm">
                  <div className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 shadow-sm">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin text-emerald-600" />
                    Cargando geometría desde Storage...
                  </div>
                </div>
              )}
            </div>

            {visibleAnalysisRect && (
              <div
                className="pointer-events-none absolute z-10 rounded-xl border-2 border-dashed border-cyan-600 bg-cyan-400/15 shadow-[0_0_0_9999px_rgba(15,23,42,0.04)]"
                style={{
                  left: visibleAnalysisRect.left,
                  top: visibleAnalysisRect.top,
                  width: visibleAnalysisRect.width,
                  height: visibleAnalysisRect.height,
                }}
              />
            )}

            {selectedFeatureJoin && (
              <div className={`absolute right-4 z-10 w-[min(380px,calc(100%-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-xl backdrop-blur ${spatialViewMode === "simulation" ? "bottom-32" : "bottom-14"}`}>
                <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-indigo-700">
                        {selectedFeatureJoin.layerName}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-slate-600">
                        {selectedFeatureJoin.tasks.length} tareas
                      </span>
                      {spatialViewMode === "audit" && (
                        <span
                          className="rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-white"
                          style={{ backgroundColor: planAuditMeta[planAudit.riskByFeatureId.get(selectedFeatureJoin.featureId) || "ok"].color }}
                        >
                          {planAuditMeta[planAudit.riskByFeatureId.get(selectedFeatureJoin.featureId) || "ok"].label}
                        </span>
                      )}
                    </div>
                    <h4 className="mt-2 truncate text-lg font-black text-slate-900">
                      {selectedFeatureJoin.label || selectedFeatureJoin.key || "Entidad sin etiqueta"}
                    </h4>
                    <p className="mt-1 truncate text-xs font-bold text-slate-500">
                      {selectedFeatureJoin.layerAttribute || "Sin unión"} → {selectedFeatureJoin.taskAttribute || "Sin atributo"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedFeatureId(null)}
                    className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                    aria-label="Cerrar detalle de entidad"
                  >
                    <X size={16} />
                  </button>
                </div>
                <div className="grid max-h-52 gap-2 overflow-y-auto p-3">
                  {Object.entries(selectedFeatureJoin.feature.properties || {})
                    .slice(0, 6)
                    .map(([key, value]) => (
                      <div key={key} className="rounded-xl bg-slate-50 px-3 py-2">
                        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{key}</p>
                        <p className="mt-0.5 break-words text-xs font-bold text-slate-700">{String(value ?? "")}</p>
                      </div>
                    ))}
                </div>
              </div>
            )}

            <div className="absolute left-4 top-4 flex overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <button type="button" onClick={() => setZoom(mapView.zoom + 1)} className="p-2 text-slate-700 hover:bg-slate-50" aria-label="Acercar">
                <ZoomIn size={18} />
              </button>
              <button type="button" onClick={() => setZoom(mapView.zoom - 1)} className="border-l border-slate-100 p-2 text-slate-700 hover:bg-slate-50" aria-label="Alejar">
                <ZoomOut size={18} />
              </button>
            </div>

            {canManage && (annotationTool || polygonDraftPoints.length > 0 || labelDraftPoint) && (
              <div className="absolute left-28 top-4 z-20 flex max-w-[calc(100%-9rem)] flex-wrap items-center gap-2 rounded-2xl border border-indigo-100 bg-white/95 p-2 shadow-xl backdrop-blur">
                <span className="inline-flex items-center rounded-xl bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-700">
                  {annotationTool === "label" ? <Type size={14} className="mr-1.5" /> : <PenLine size={14} className="mr-1.5" />}
                  {annotationTool === "label" ? "Ubica etiqueta" : `Figura: ${polygonDraftPoints.length} puntos`}
                </span>
                {annotationTool === "polygon" && (
                  <button
                    type="button"
                    onClick={() => setPolygonDraftPoints((current) => current.slice(0, -1))}
                    disabled={polygonDraftPoints.length === 0}
                    className="inline-flex h-9 items-center rounded-xl border border-slate-200 px-3 text-xs font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                  >
                    <Undo2 size={14} className="mr-1.5" />
                    Deshacer
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleSaveAnnotation()}
                  disabled={savingAnnotation || (annotationTool === "polygon" && polygonDraftPoints.length < 3) || (annotationTool === "label" && !labelDraftPoint)}
                  className="inline-flex h-9 items-center rounded-xl bg-slate-950 px-3 text-xs font-black text-white transition hover:bg-slate-800 disabled:opacity-50"
                >
                  {savingAnnotation ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Save size={14} className="mr-1.5" />}
                  Guardar
                </button>
                <button
                  type="button"
                  onClick={resetAnnotationDraft}
                  className="inline-flex h-9 items-center rounded-xl border border-slate-200 px-3 text-xs font-black text-slate-600 transition hover:bg-slate-50"
                >
                  <X size={14} className="mr-1.5" />
                  Cancelar
                </button>
              </div>
            )}

            <div className="absolute left-4 top-16 z-20">
              <button
                type="button"
                onClick={() => {
                  if (!selectedLayer) return;
                  setIsAreaAnalysisOpen(true);
                }}
                disabled={!selectedLayer}
                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-black shadow-sm transition ${
                  isAreaAnalysisOpen || isDrawingAnalysis
                    ? "border-cyan-500 bg-cyan-600 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                } disabled:cursor-not-allowed disabled:opacity-50`}
                aria-label="Abrir análisis por área"
              >
                <MousePointer2 size={15} />
                Analizar área
                {analysisBounds && (
                  <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px]">
                    {analysisStats.total}
                  </span>
                )}
              </button>
            </div>

            {isAreaAnalysisOpen && selectedLayer && (
              <div className="absolute left-4 top-28 z-30 w-[min(420px,calc(100%-2rem))] overflow-hidden rounded-2xl border border-cyan-200 bg-white/95 shadow-2xl backdrop-blur">
                <div className="flex items-start justify-between gap-3 border-b border-cyan-100 bg-cyan-50/80 p-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <BarChart3 size={16} className="text-cyan-700" />
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-700">Análisis por área</p>
                    </div>
                    <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">
                      Dibuja un rectángulo y resume cualquier atributo sin abandonar el mapa.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAreaAnalysisOpen(false);
                      setIsDrawingAnalysis(false);
                      setAnalysisDraftRect(null);
                    }}
                    className="rounded-full p-1.5 text-slate-400 transition hover:bg-white hover:text-slate-700"
                    aria-label="Cerrar análisis por área"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="max-h-[min(70vh,620px)] overflow-y-auto p-4">
                  <div className="flex items-center justify-between gap-3">
                    <label className="min-w-0 flex-1">
                      <span className="block text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                        Atributo estadístico
                      </span>
                      <select
                        value={analysisAttribute}
                        onChange={(event) => setAnalysisAttribute(event.target.value)}
                        className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
                      >
                        {(selectedLayer.attributes || []).length === 0 && <option value="">Sin atributos</option>}
                        {(selectedLayer.attributes || []).map((attribute) => (
                          <option key={attribute} value={attribute}>
                            {attribute}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="mt-6 shrink-0 rounded-full bg-cyan-50 px-3 py-1 text-xs font-black text-cyan-700">
                      {analysisStats.total} entidades
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant={isDrawingAnalysis ? "default" : "outline"}
                      onClick={() => {
                        setIsDrawingAnalysis((current) => !current);
                        setAnalysisDraftRect(null);
                      }}
                      className={isDrawingAnalysis ? "bg-cyan-600 text-white hover:bg-cyan-700" : ""}
                    >
                      <MousePointer2 size={15} className="mr-2" />
                      {isDrawingAnalysis ? "Dibujando" : "Dibujar"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setAnalysisBounds(null);
                        setAnalysisDraftRect(null);
                        setIsDrawingAnalysis(false);
                      }}
                      disabled={!analysisBounds && !analysisDraftRect}
                    >
                      <Eraser size={15} className="mr-2" />
                      Limpiar
                    </Button>
                  </div>

                  {!analysisBounds ? (
                    <div className="mt-4 rounded-xl border border-dashed border-cyan-200 bg-cyan-50 p-4 text-sm font-semibold leading-6 text-cyan-900">
                      Activa “Dibujar” y arrastra sobre el mapa para crear el área de análisis.
                    </div>
                  ) : (
                    <div className="mt-4 space-y-3">
                      <div className="grid grid-cols-3 gap-2">
                        <div className="rounded-xl bg-slate-50 p-3">
                          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Categorías</p>
                          <p className="mt-1 text-2xl font-black text-slate-900">{analysisStats.distinct}</p>
                        </div>
                        <div className="rounded-xl bg-emerald-50 p-3">
                          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-700">Num.</p>
                          <p className="mt-1 text-2xl font-black text-emerald-800">{analysisStats.numericCount}</p>
                        </div>
                        <div className="rounded-xl bg-cyan-50 p-3">
                          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-cyan-700">Área</p>
                          <p className="mt-1 text-2xl font-black text-cyan-800">{analysisStats.total}</p>
                        </div>
                      </div>

                      {analysisStats.numericCount > 0 && (
                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-xl bg-indigo-50 p-3">
                            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-indigo-700">Promedio</p>
                            <p className="mt-1 text-lg font-black text-indigo-900">{formatMetricNumber(analysisStats.average, 2)}</p>
                          </div>
                          <div className="rounded-xl bg-orange-50 p-3">
                            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-orange-700">Suma</p>
                            <p className="mt-1 text-lg font-black text-orange-900">{formatMetricNumber(analysisStats.sum, 2)}</p>
                          </div>
                        </div>
                      )}

                      <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                        {analysisStats.categories.length === 0 ? (
                          <div className="rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-500">
                            El área no contiene entidades de la capa seleccionada.
                          </div>
                        ) : (
                          analysisStats.categories.slice(0, 50).map((item) => (
                            <div key={item.category} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate text-xs font-black text-slate-900">{item.category}</p>
                                  <p className="mt-0.5 text-[11px] font-semibold text-slate-500">{item.percent}% del área</p>
                                </div>
                                <span className="rounded-full bg-white px-2 py-1 text-xs font-black text-slate-700">{item.count}</span>
                              </div>
                              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
                                <div className="h-full rounded-full" style={{ width: `${Math.max(3, item.percent)}%`, backgroundColor: item.color }} />
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {spatialViewMode === "simulation" && (
              <div className="absolute bottom-4 left-20 right-4 z-20 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-xl backdrop-blur">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                  <div className="flex min-w-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSimulationOffset(0)}
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-50"
                      aria-label="Volver al inicio de la simulación"
                    >
                      <SkipBack size={17} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsSimulationPlaying((current) => !current)}
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white shadow-sm transition hover:bg-slate-800"
                      aria-label={isSimulationPlaying ? "Pausar simulación" : "Reproducir simulación"}
                    >
                      {isSimulationPlaying ? <Pause size={17} /> : <Play size={17} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => shiftSimulationDate(simulationSpeedDays)}
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-50"
                      aria-label="Avanzar simulación"
                    >
                      <SkipForward size={17} />
                    </button>
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-indigo-600">Simulación temporal</p>
                      <p className="truncate text-sm font-black text-slate-900">
                        {new Intl.DateTimeFormat("es-CO", { weekday: "short", day: "2-digit", month: "long", year: "numeric" }).format(simulationDate)}
                      </p>
                    </div>
                  </div>

                  <div className="grid flex-1 gap-2 sm:grid-cols-[1fr_140px_110px] sm:items-center">
                    <input
                      type="range"
                      min={0}
                      max={simulationRange.totalDays}
                      value={simulationDayOffset}
                      onChange={(event) => setSimulationOffset(Number(event.target.value))}
                      className="w-full accent-indigo-600"
                    />
                    <input
                      type="date"
                      value={simulationDateValue}
                      min={simulationRange.startInput}
                      max={simulationRange.endInput}
                      onChange={(event) => {
                        setIsSimulationPlaying(false);
                        setSimulationDateValue(event.target.value);
                      }}
                      className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                    />
                    <select
                      value={simulationSpeedDays}
                      onChange={(event) => setSimulationSpeedDays(Number(event.target.value))}
                      className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                    >
                      <option value={1}>1 dia</option>
                      <option value={3}>3 dias</option>
                      <option value={7}>1 semana</option>
                      <option value={15}>15 dias</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            <div className="absolute bottom-3 left-3 rounded-lg bg-white/90 px-2 py-1 text-[10px] font-semibold text-slate-500 shadow-sm">
              © OpenStreetMap contributors
            </div>
          </div>
        </div>

        <aside className="space-y-3 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto xl:pr-1">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 bg-slate-950 p-4 text-white">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-300">Panel operativo</p>
                  <h3 className="mt-1 truncate text-lg font-black">{selectedLayer?.name || "Sin capa activa"}</h3>
                  <p className="mt-1 text-xs font-semibold text-slate-300">
                    Herramientas, análisis y simbología sin perder el mapa de vista.
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-white/10 px-3 py-1 text-xs font-black text-cyan-100">
                  {stats.coverage}% unión
                </span>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-1 rounded-xl bg-white/10 p-1 2xl:grid-cols-6">
                {[
                  { key: "summary", label: "Resumen", icon: Layers },
                  { key: "views", label: "Vistas", icon: Eye },
                  { key: "simulation", label: "Tiempo", icon: Play },
                  { key: "analysis", label: "Análisis", icon: BarChart3 },
                  { key: "style", label: "Anotar", icon: PenLine },
                  { key: "search", label: "Buscar", icon: Search },
                ].map((tab) => {
                  const Icon = tab.icon;
                  const isActive = spatialPanelTab === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setSpatialPanelTab(tab.key as SpatialPanelTab)}
                      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[11px] font-black transition ${
                        isActive ? "bg-white text-slate-950 shadow-sm" : "text-slate-300 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      <Icon size={13} />
                      <span className="hidden sm:inline xl:hidden 2xl:inline">{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="p-4">
              {spatialPanelTab === "summary" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      ["En mapa", stats.visibleFeatures, "bg-cyan-50 text-cyan-700"],
                      ["Vinculadas", stats.linkedFeatures, "bg-emerald-50 text-emerald-700"],
                      ["Tareas", stats.linkedTasks, "bg-indigo-50 text-indigo-700"],
                    ].map(([label, value, className]) => (
                      <div key={String(label)} className={`rounded-xl p-3 ${className}`}>
                        <p className="text-[9px] font-black uppercase tracking-[0.14em] opacity-70">{label}</p>
                        <p className="mt-1 text-xl font-black">{value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button type="button" variant="outline" onClick={recenterLayer} disabled={!selectedLayer}>
                      <RefreshCw size={15} className="mr-2" />
                      Centrar
                    </Button>
                    {canManage ? (
                      <Button type="button" onClick={handleSaveJoin} disabled={!canSaveSpatialJoin} className="bg-slate-950 text-white hover:bg-slate-800">
                        <Save size={15} className="mr-2" />
                        Unión
                      </Button>
                    ) : (
                      <Button type="button" variant="outline" disabled>
                        <Save size={15} className="mr-2" />
                        Unión
                      </Button>
                    )}
                  </div>
                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs font-semibold leading-5 text-slate-600">
                    {joinMode === "municipality_department" ? (
                      <>
                        <span className="font-black text-slate-900">
                          {layerMunicipalityAttribute || "municipio"} + {layerDepartmentAttribute || "departamento"}
                        </span>
                        <span> se compara con la ubicación oficial de cada tarea.</span>
                      </>
                    ) : (
                      <>
                        <span className="font-black text-slate-900">{layerAttribute || "atributo capa"}</span>
                        <span> se compara con </span>
                        <span className="font-black text-slate-900">{effectiveTaskAttribute || "atributo tarea"}</span>
                      </>
                    )}
                  </div>
                  <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-xs font-semibold leading-5 text-indigo-800">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-indigo-600">Vista activa</p>
                    <p className="mt-1 text-sm font-black text-slate-950">{activeSpatialTaskView.name}</p>
                    <p className="mt-1">{activeSpatialTaskViewSummary}</p>
                    <p className="mt-1 font-black">{spatialScopeTasks.length.toLocaleString("es-CO")} tareas en alcance</p>
                  </div>
                </div>
              )}

              {spatialPanelTab === "views" && (
                <div className="space-y-3">
                  <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-indigo-700">Vistas espaciales</p>
                    <p className="mt-1 text-xs font-semibold leading-5 text-indigo-800">
                      Filtra las tareas que participan en la unión sin cambiar el atributo configurado de la capa.
                    </p>
                  </div>

                  <div className="space-y-2">
                    {[defaultSpatialTaskView, ...spatialTaskViews].map((view) => {
                      const isActive = activeSpatialTaskView.id === view.id;
                      return (
                        <div
                          key={view.id}
                          className={`rounded-xl border p-3 transition ${
                            isActive ? "border-indigo-300 bg-indigo-50 shadow-sm" : "border-slate-200 bg-white"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <button type="button" onClick={() => setActiveSpatialTaskViewId(view.id)} className="min-w-0 flex-1 text-left">
                              <p className="truncate text-sm font-black text-slate-950">{view.name}</p>
                              <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
                                {view.scope === "all" ? "Todo el proyecto" : view.scope === "group" ? "Grupo visual" : "Tarea especial"}
                              </p>
                            </button>
                            {canManage && view.id !== DEFAULT_SPATIAL_VIEW_ID && (
                              <button
                                type="button"
                                onClick={() => handleDeleteSpatialTaskView(view)}
                                disabled={savingSpatialTaskView}
                                className="rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                                title="Eliminar vista"
                              >
                                <Trash2 size={15} />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {canManage && (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Crear nueva vista</p>
                      <div className="mt-3 space-y-2">
                        <input
                          value={viewDraftName}
                          onChange={(event) => setViewDraftName(event.target.value)}
                          placeholder="Ej: Solo ruta crítica, Entregas del proyecto, Grupo campo"
                          className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                        />
                        <select
                          value={viewDraftScope}
                          onChange={(event) => setViewDraftScope(event.target.value as Exclude<SpatialTaskViewScope, "all">)}
                          className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                        >
                          <option value="task">Una tarea o workflow</option>
                          <option value="group">Un grupo visual</option>
                        </select>

                        {viewDraftScope === "task" ? (
                          <>
                            <select
                              value={viewDraftTaskId}
                              onChange={(event) => setViewDraftTaskId(event.target.value)}
                              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                            >
                              <option value="">Selecciona tarea matriz</option>
                              {rootTaskOptions.map((task) => (
                                <option key={task.id} value={task.id}>
                                  {getTaskTitle(task)}
                                </option>
                              ))}
                            </select>
                            <label className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs font-semibold text-slate-600">
                              <input
                                type="checkbox"
                                checked={viewDraftIncludeSubtasks}
                                onChange={(event) => setViewDraftIncludeSubtasks(event.target.checked)}
                                className="mt-0.5"
                              />
                              Incluir subtareas, iteraciones y pasos dependientes de la tarea seleccionada.
                            </label>
                          </>
                        ) : (
                          <select
                            value={viewDraftGroupId}
                            onChange={(event) => setViewDraftGroupId(event.target.value)}
                            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                          >
                            {normalizedTaskGroups.map((group) => (
                              <option key={group.id} value={group.id}>
                                {group.name} ({group.taskCount})
                              </option>
                            ))}
                          </select>
                        )}

                        <Button
                          type="button"
                          onClick={handleSaveSpatialTaskView}
                          disabled={savingSpatialTaskView}
                          className="w-full bg-indigo-600 text-white hover:bg-indigo-700"
                        >
                          {savingSpatialTaskView ? <Loader2 size={15} className="mr-2 animate-spin" /> : <Save size={15} className="mr-2" />}
                          Guardar vista
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {spatialPanelTab === "simulation" && (
                <div className="space-y-3">
                  <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-indigo-700">Modo temporal</p>
                        <p className="mt-1 text-sm font-black text-slate-900">
                          {spatialViewMode === "simulation" ? "Simulación activa" : "Simulación apagada"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSpatialViewMode((current) => (current === "simulation" ? "current" : "simulation"))}
                        className={`rounded-full px-3 py-1.5 text-xs font-black transition ${
                          spatialViewMode === "simulation" ? "bg-indigo-600 text-white" : "bg-white text-indigo-700"
                        }`}
                      >
                        {spatialViewMode === "simulation" ? "Ver estado" : "Simular"}
                      </button>
                    </div>
                    <p className="mt-2 text-xs font-semibold leading-5 text-indigo-800">
                      Usa las fechas ya programadas en tareas y workflows vinculados a la capa. Pixel no reparte ni crea cronograma nuevo.
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <label className="block text-xs font-black uppercase tracking-[0.16em] text-slate-400">Fecha simulada</label>
                    <input
                      type="date"
                      value={simulationDateValue}
                      min={simulationRange.startInput}
                      max={simulationRange.endInput}
                      onChange={(event) => {
                        setIsSimulationPlaying(false);
                        setSimulationDateValue(event.target.value);
                        setSpatialViewMode("simulation");
                      }}
                      className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                    />
                    <input
                      type="range"
                      min={0}
                      max={simulationRange.totalDays}
                      value={simulationDayOffset}
                      onChange={(event) => {
                        setSpatialViewMode("simulation");
                        setSimulationOffset(Number(event.target.value));
                      }}
                      className="mt-3 w-full accent-indigo-600"
                    />
                    <div className="mt-2 flex items-center justify-between text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">
                      <span>{formatDate(simulationRange.start)}</span>
                      <span>{formatDate(simulationRange.end)}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setSimulationOffset(0)}
                      className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-50"
                    >
                      <SkipBack size={14} className="mr-1" />
                      Inicio
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSpatialViewMode("simulation");
                        setIsSimulationPlaying((current) => !current);
                      }}
                      className="inline-flex items-center justify-center rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white transition hover:bg-slate-800"
                    >
                      {isSimulationPlaying ? <Pause size={14} className="mr-1" /> : <Play size={14} className="mr-1" />}
                      {isSimulationPlaying ? "Pausa" : "Play"}
                    </button>
                    <button
                      type="button"
                      onClick={() => shiftSimulationDate(simulationSpeedDays)}
                      className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-50"
                    >
                      <SkipForward size={14} className="mr-1" />
                      Avanzar
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-emerald-50 p-3 text-emerald-800">
                      <p className="text-[9px] font-black uppercase tracking-[0.14em]">Avance</p>
                      <p className="mt-1 text-2xl font-black">{temporalFeatureStats.progress}%</p>
                    </div>
                    <div className="rounded-xl bg-emerald-50 p-3 text-emerald-800">
                      <p className="text-[9px] font-black uppercase tracking-[0.14em]">Cumplidas</p>
                      <p className="mt-1 text-2xl font-black">{temporalFeatureStats.completed}</p>
                    </div>
                    <div className="rounded-xl bg-blue-50 p-3 text-blue-800">
                      <p className="text-[9px] font-black uppercase tracking-[0.14em]">Trabajando</p>
                      <p className="mt-1 text-2xl font-black">{temporalFeatureStats.active}</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3 text-slate-700">
                      <p className="text-[9px] font-black uppercase tracking-[0.14em]">Vinculadas</p>
                      <p className="mt-1 text-2xl font-black">{temporalFeatureStats.linked}</p>
                    </div>
                  </div>
                </div>
              )}

              {spatialPanelTab === "analysis" && (
                <div className="space-y-4">
                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 text-white">
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-300">Auditoría del plan</p>
                          <h4 className="mt-1 text-lg font-black">Salud espacial {planAudit.score}%</h4>
                          <p className="mt-1 text-xs font-semibold leading-5 text-slate-300">
                            Revisa carga diaria, dispersión y entidades sin unión en la vista visible.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSpatialViewMode((current) => (current === "audit" ? "current" : "audit"))}
                          className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-black transition ${
                            spatialViewMode === "audit" ? "bg-cyan-300 text-slate-950" : "bg-white/10 text-white hover:bg-white/20"
                          }`}
                        >
                          {spatialViewMode === "audit" ? "Ver mapa normal" : "Pintar riesgo"}
                        </button>
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <div className="rounded-xl bg-white/10 p-3">
                          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-300">Auditadas</p>
                          <p className="mt-1 text-2xl font-black">{planAudit.auditedFeatures.toLocaleString("es-CO")}</p>
                        </div>
                        <div className="rounded-xl bg-red-400/15 p-3 text-red-100">
                          <p className="text-[9px] font-black uppercase tracking-[0.16em]">Riesgo</p>
                          <p className="mt-1 text-2xl font-black">{(planAudit.counts.risk + planAudit.counts.critical).toLocaleString("es-CO")}</p>
                        </div>
                        <div className="rounded-xl bg-amber-400/15 p-3 text-amber-100">
                          <p className="text-[9px] font-black uppercase tracking-[0.16em]">Sin unión</p>
                          <p className="mt-1 text-2xl font-black">{planAudit.unlinkedFeatures.toLocaleString("es-CO")}</p>
                        </div>
                        <div className="rounded-xl bg-cyan-400/15 p-3 text-cyan-100">
                          <p className="text-[9px] font-black uppercase tracking-[0.16em]">Sin geometría</p>
                          <p className="mt-1 text-2xl font-black">{planAudit.tasksWithoutVisibleGeometry.toLocaleString("es-CO")}</p>
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-white/10 bg-white/[0.03] p-4">
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                        <label className="block">
                          <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-300">Carga diaria</span>
                          <input
                            type="number"
                            min={5}
                            max={500}
                            value={planAuditLoadLimit}
                            onChange={(event) => setPlanAuditLoadLimit(clampNumber(event.target.value, 5, 500, 35))}
                            className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-white/10 px-3 text-sm font-black text-white outline-none focus:border-cyan-300"
                          />
                        </label>
                        <label className="block">
                          <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-300">Distancia km</span>
                          <input
                            type="number"
                            min={1}
                            max={200}
                            value={planAuditDistanceKm}
                            onChange={(event) => setPlanAuditDistanceKm(clampNumber(event.target.value, 1, 200, 6))}
                            className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-white/10 px-3 text-sm font-black text-white outline-none focus:border-cyan-300"
                          />
                        </label>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Hallazgos</p>
                        <p className="mt-1 text-xs font-semibold text-slate-500">
                          {planAudit.overloadedDays} días sobrecargados · {planAudit.dispersedGroups} rutas dispersas
                        </p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">
                        {planAudit.issues.length}
                      </span>
                    </div>
                    <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
                      {planAudit.issues.length === 0 ? (
                        <div className="rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800">
                          No se detectaron riesgos fuertes con los umbrales actuales.
                        </div>
                      ) : (
                        planAudit.issues.map((issue) => {
                          const meta = planAuditMeta[issue.level];
                          return (
                            <button
                              key={issue.id}
                              type="button"
                              onClick={() => {
                                if (!issue.featureId) return;
                                setSpatialViewMode("audit");
                                setSelectedFeatureId(issue.featureId);
                              }}
                              className="block w-full rounded-xl border border-slate-100 bg-slate-50 p-3 text-left transition hover:border-slate-200 hover:bg-white"
                            >
                              <div className="flex items-start gap-2">
                                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} />
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-xs font-black text-slate-900">{issue.title}</p>
                                    {issue.metric && (
                                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-slate-600">
                                        {issue.metric}
                                      </span>
                                    )}
                                  </div>
                                  <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">{issue.detail}</p>
                                </div>
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>

                </div>
              )}

              {spatialPanelTab === "style" && (
                <div className="space-y-3">
                  {!canManage || !selectedLayer ? (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-500">
                      Selecciona una capa administrable para configurar su simbología.
                    </div>
                  ) : (
                    <>
                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                        <div>
                          <label className="block text-xs font-black uppercase tracking-[0.16em] text-slate-400">Simbología</label>
                          <select
                            value={layerEditStyle.themeMode}
                            onChange={(event) =>
                              setLayerEditStyle((current) => ({
                                ...current,
                                themeMode: event.target.value as LayerThemeMode,
                                themeAttribute: event.target.value === "attribute" ? current.themeAttribute || selectedLayer.attributes?.[0] || "" : current.themeAttribute,
                              }))
                            }
                            className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                          >
                            <option value="task_status">Estado tarea</option>
                            <option value="attribute">Atributo capa</option>
                            <option value="unique">Simbología única</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-black uppercase tracking-[0.16em] text-slate-400">Categoría</label>
                          <select
                            value={layerEditStyle.themeAttribute}
                            disabled={layerEditStyle.themeMode !== "attribute"}
                            onChange={(event) =>
                              setLayerEditStyle((current) => ({
                                ...current,
                                themeAttribute: event.target.value,
                              }))
                            }
                            className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:bg-slate-100"
                          >
                            <option value="">Sin atributo</option>
                            {(selectedLayer.attributes || []).map((attribute) => (
                              <option key={attribute} value={attribute}>
                                {attribute}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
                        {layerEditStyle.themeMode === "attribute" ? (
                          selectedLayerThemeCategories.slice(0, 24).map((item) => (
                            <div key={item.category} className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                              <input
                                type="color"
                                value={item.style.fillColor}
                                onChange={(event) => {
                                  const color = event.target.value;
                                  setLayerEditStyle((current) => ({
                                    ...current,
                                    attributeStyles: {
                                      ...current.attributeStyles,
                                      [item.category]: { fillColor: color, strokeColor: color },
                                    },
                                  }));
                                }}
                                className="h-8 w-9 shrink-0 cursor-pointer rounded-lg border border-slate-200 bg-white p-1"
                                aria-label={`Color para ${item.category}`}
                              />
                              <p className="min-w-0 flex-1 truncate text-xs font-black text-slate-800">{item.category}</p>
                              <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-slate-600">{item.count}</span>
                            </div>
                          ))
                        ) : layerEditStyle.themeMode === "unique" ? (
                          <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-xs font-black uppercase tracking-[0.14em] text-indigo-700">Color único</p>
                                <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                                  Toda la capa se dibuja con este mismo color.
                                </p>
                              </div>
                              <input
                                type="color"
                                value={layerEditStyle.fillColor}
                                onChange={(event) => updateLayerUniqueColor(event.target.value)}
                                className="h-9 w-12 shrink-0 cursor-pointer rounded-lg border border-indigo-100 bg-white p-1"
                                aria-label="Color único de la capa"
                              />
                            </div>
                          </div>
                        ) : (
                          SPATIAL_STATUS_STYLE_OPTIONS.map((option) => {
                            const stateStyle = layerEditStyle.statusStyles[option.key];
                            return (
                              <div key={option.key} className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                                <input
                                  type="color"
                                  value={stateStyle.fillColor}
                                  onChange={(event) => updateLayerStatusColor(option.key, event.target.value)}
                                  className="h-8 w-9 shrink-0 cursor-pointer rounded-lg border border-slate-200 bg-white p-1"
                                  aria-label={`Color para ${option.label}`}
                                />
                                <p className="min-w-0 flex-1 truncate text-xs font-black text-slate-800">{option.label}</p>
                              </div>
                            );
                          })
                        )}
                      </div>

                      <div className="grid gap-2">
                        <label className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                          Opacidad {Math.round(layerEditStyle.fillOpacity * 100)}%
                        </label>
                        <input
                          type="range"
                          min={0.04}
                          max={0.8}
                          step={0.02}
                          value={layerEditStyle.fillOpacity}
                          onChange={(event) =>
                            setLayerEditStyle((current) => ({
                              ...current,
                              fillOpacity: Number(event.target.value),
                              strokeOpacity: Math.min(1, Math.max(0.35, Number(event.target.value) + 0.45)),
                            }))
                          }
                          className="w-full accent-emerald-600"
                        />
                        <Button
                          type="button"
                          onClick={handleSaveLayerSettings}
                          disabled={savingLayerSettings}
                          className="bg-slate-950 text-white hover:bg-slate-800"
                        >
                          {savingLayerSettings ? <Loader2 size={15} className="mr-2 animate-spin" /> : <Save size={15} className="mr-2" />}
                          Guardar estilo
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {spatialPanelTab === "style" && (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-indigo-700">Anotaciones</p>
                        <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">
                          Dibuja figuras y etiquetas libres sobre el mapa sin alterar las capas originales.
                        </p>
                      </div>
                      <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-indigo-700">
                        {annotations.length}
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => startAnnotationTool("polygon")}
                        disabled={!canManage}
                        className={`inline-flex items-center justify-center rounded-xl px-3 py-2 text-xs font-black transition disabled:opacity-50 ${
                          annotationTool === "polygon" ? "bg-indigo-600 text-white shadow-sm" : "bg-white text-indigo-700 hover:bg-indigo-50"
                        }`}
                      >
                        <PenLine size={15} className="mr-1.5" />
                        Figura
                      </button>
                      <button
                        type="button"
                        onClick={() => startAnnotationTool("label")}
                        disabled={!canManage}
                        className={`inline-flex items-center justify-center rounded-xl px-3 py-2 text-xs font-black transition disabled:opacity-50 ${
                          annotationTool === "label" ? "bg-indigo-600 text-white shadow-sm" : "bg-white text-indigo-700 hover:bg-indigo-50"
                        }`}
                      >
                        <Type size={15} className="mr-1.5" />
                        Label
                      </button>
                    </div>

                    {annotationTool && (
                      <div className="mt-3 rounded-xl border border-dashed border-indigo-200 bg-white/80 p-3 text-xs font-semibold leading-5 text-indigo-900">
                        {annotationTool === "polygon"
                          ? "Haz clic sobre el mapa para agregar puntos. Con tres puntos ya puedes guardar el polígono."
                          : "Haz clic en el mapa para ubicar la etiqueta. Luego ajusta texto, rotación y color."}
                      </div>
                    )}
                  </div>

                  {(canManage || selectedAnnotation) && (
                    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                          {selectedAnnotation ? "Editar anotación" : "Nueva anotación"}
                        </p>
                        {selectedAnnotation && (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedAnnotationId(null);
                              resetAnnotationDraft();
                            }}
                            className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                            aria-label="Limpiar selección"
                          >
                            <X size={15} />
                          </button>
                        )}
                      </div>

                      <label className="block">
                        <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Nombre</span>
                        <input
                          value={annotationTitle}
                          onChange={(event) => setAnnotationTitle(event.target.value)}
                          placeholder="Ej: Zona crítica, frente 1, restricción"
                          disabled={!canManage}
                          className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:bg-slate-100"
                        />
                      </label>

                      <label className="block">
                        <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                          {selectedAnnotation?.annotationType === "polygon" || annotationTool === "polygon" ? "Nota" : "Texto visible"}
                        </span>
                        <textarea
                          value={annotationBody}
                          onChange={(event) => setAnnotationBody(event.target.value)}
                          placeholder="Escribe la nota o el texto del label"
                          disabled={!canManage}
                          rows={3}
                          className="mt-1 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:bg-slate-100"
                        />
                      </label>

                      <div className="grid grid-cols-3 gap-2">
                        <label className="rounded-xl border border-slate-100 bg-slate-50 p-2">
                          <span className="block text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Relleno</span>
                          <input
                            type="color"
                            value={annotationStyle.fillColor}
                            onChange={(event) =>
                              setAnnotationStyle((current) => ({
                                ...current,
                                fillColor: event.target.value,
                              }))
                            }
                            disabled={!canManage}
                            className="mt-2 h-9 w-full cursor-pointer rounded-lg border border-slate-200 bg-white p-1 disabled:opacity-50"
                          />
                        </label>
                        <label className="rounded-xl border border-slate-100 bg-slate-50 p-2">
                          <span className="block text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Borde</span>
                          <input
                            type="color"
                            value={annotationStyle.strokeColor}
                            onChange={(event) =>
                              setAnnotationStyle((current) => ({
                                ...current,
                                strokeColor: event.target.value,
                              }))
                            }
                            disabled={!canManage}
                            className="mt-2 h-9 w-full cursor-pointer rounded-lg border border-slate-200 bg-white p-1 disabled:opacity-50"
                          />
                        </label>
                        <label className="rounded-xl border border-slate-100 bg-slate-50 p-2">
                          <span className="block text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Texto</span>
                          <input
                            type="color"
                            value={annotationStyle.textColor}
                            onChange={(event) =>
                              setAnnotationStyle((current) => ({
                                ...current,
                                textColor: event.target.value,
                              }))
                            }
                            disabled={!canManage}
                            className="mt-2 h-9 w-full cursor-pointer rounded-lg border border-slate-200 bg-white p-1 disabled:opacity-50"
                          />
                        </label>
                      </div>

                      <div className="grid gap-3">
                        <label>
                          <span className="flex items-center justify-between text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                            Opacidad {Math.round(annotationStyle.fillOpacity * 100)}%
                          </span>
                          <input
                            type="range"
                            min={0}
                            max={0.85}
                            step={0.05}
                            value={annotationStyle.fillOpacity}
                            disabled={!canManage}
                            onChange={(event) =>
                              setAnnotationStyle((current) => ({
                                ...current,
                                fillOpacity: Number(event.target.value),
                              }))
                            }
                            className="mt-1 w-full accent-indigo-600 disabled:opacity-50"
                          />
                        </label>
                        <label>
                          <span className="flex items-center justify-between text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                            Borde {annotationStyle.strokeWidth.toFixed(1)} px
                          </span>
                          <input
                            type="range"
                            min={0.5}
                            max={10}
                            step={0.5}
                            value={annotationStyle.strokeWidth}
                            disabled={!canManage}
                            onChange={(event) =>
                              setAnnotationStyle((current) => ({
                                ...current,
                                strokeWidth: Number(event.target.value),
                              }))
                            }
                            className="mt-1 w-full accent-indigo-600 disabled:opacity-50"
                          />
                        </label>
                        {(selectedAnnotation?.annotationType === "label" || annotationTool === "label") && (
                          <>
                            <label>
                              <span className="flex items-center justify-between text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                                Tamaño {annotationStyle.fontSize}px
                              </span>
                              <input
                                type="range"
                                min={10}
                                max={34}
                                step={1}
                                value={annotationStyle.fontSize}
                                disabled={!canManage}
                                onChange={(event) =>
                                  setAnnotationStyle((current) => ({
                                    ...current,
                                    fontSize: Number(event.target.value),
                                  }))
                                }
                                className="mt-1 w-full accent-indigo-600 disabled:opacity-50"
                              />
                            </label>
                            <label className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
                              <input
                                type="checkbox"
                                checked={annotationStyle.scaleWithZoom}
                                disabled={!canManage}
                                onChange={(event) =>
                                  setAnnotationStyle((current) => ({
                                    ...current,
                                    scaleWithZoom: event.target.checked,
                                    zoomReference: event.target.checked ? mapView.zoom : current.zoomReference,
                                  }))
                                }
                                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50"
                              />
                              <span className="min-w-0">
                                <span className="block text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                                  Escalar con zoom
                                </span>
                                <span className="mt-1 block text-xs font-semibold leading-5 text-slate-500">
                                  {annotationStyle.scaleWithZoom
                                    ? `El label crece o se reduce tomando como referencia el zoom ${annotationStyle.zoomReference}.`
                                    : "El label conserva su tamaño visual aunque acerques o alejes el mapa."}
                                </span>
                              </span>
                            </label>
                            <label>
                              <span className="flex items-center justify-between text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                                <span className="inline-flex items-center gap-1"><RotateCw size={12} /> Rotación</span>
                                {annotationRotation}°
                              </span>
                              <input
                                type="range"
                                min={-180}
                                max={180}
                                step={5}
                                value={annotationRotation}
                                disabled={!canManage}
                                onChange={(event) => setAnnotationRotation(Number(event.target.value))}
                                className="mt-1 w-full accent-indigo-600 disabled:opacity-50"
                              />
                            </label>
                          </>
                        )}
                      </div>

                      {canManage && (
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            type="button"
                            onClick={() => void handleSaveAnnotation()}
                            disabled={savingAnnotation || (!selectedAnnotation && !annotationTool)}
                            className="bg-slate-950 text-white hover:bg-slate-800"
                          >
                            {savingAnnotation ? <Loader2 size={15} className="mr-2 animate-spin" /> : <Save size={15} className="mr-2" />}
                            Guardar
                          </Button>
                          <Button type="button" variant="outline" onClick={resetAnnotationDraft}>
                            <X size={15} className="mr-2" />
                            Cancelar
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="rounded-2xl border border-slate-200 bg-white">
                    <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-3">
                      <div>
                        <p className="text-xs font-black text-slate-900">Capas de anotación</p>
                        <p className="text-[11px] font-semibold text-slate-500">Figuras y labels guardados en este proyecto.</p>
                      </div>
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => startAnnotationTool("polygon")}
                          className="inline-flex h-8 items-center rounded-lg bg-indigo-600 px-2.5 text-xs font-black text-white hover:bg-indigo-700"
                        >
                          <Plus size={13} className="mr-1" />
                          Nueva
                        </button>
                      )}
                    </div>
                    <div className="max-h-72 overflow-y-auto p-2">
                      {annotations.length === 0 ? (
                        <div className="rounded-xl bg-slate-50 p-4 text-center text-sm font-semibold text-slate-500">
                          Aún no hay anotaciones sobre este mapa.
                        </div>
                      ) : (
                        annotations.map((annotation) => {
                          const style = normalizeAnnotationStyle(annotation.styleConfig);
                          const isActive = selectedAnnotationId === annotation.id;
                          return (
                            <div
                              key={annotation.id}
                              className={`mb-2 rounded-xl border p-2 transition last:mb-0 ${
                                isActive ? "border-indigo-300 bg-indigo-50" : "border-slate-100 bg-slate-50 hover:border-slate-200"
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedAnnotationId(annotation.id);
                                  setSelectedFeatureId(null);
                                  const coordinate = getAnnotationCoordinate(annotation);
                                  if (coordinate) {
                                    setMapView((current) => ({ ...current, center: { lon: coordinate[0], lat: coordinate[1] } }));
                                  }
                                }}
                                className="flex w-full items-center gap-2 text-left"
                              >
                                <span className="h-4 w-4 shrink-0 rounded-full border border-white shadow-sm" style={{ backgroundColor: annotation.annotationType === "label" ? style.textColor : style.fillColor }} />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-xs font-black text-slate-900">{annotation.title || annotation.body || "Anotación"}</p>
                                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                                    {annotation.annotationType === "label" ? "Label" : "Figura"}
                                  </p>
                                </div>
                              </button>
                              {canManage && (
                                <div className="mt-2 flex items-center justify-end gap-1">
                                  <button
                                    type="button"
                                    onClick={() => void handleToggleAnnotationVisibility(annotation, annotation.visible === false)}
                                    className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white px-2 text-xs font-black text-slate-600 hover:bg-slate-50"
                                  >
                                    <Eye size={13} className="mr-1" />
                                    {annotation.visible === false ? "Mostrar" : "Ocultar"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteAnnotation(annotation)}
                                    className="inline-flex h-8 items-center rounded-lg border border-red-100 bg-white px-2 text-xs font-black text-red-600 hover:bg-red-50"
                                  >
                                    <Trash2 size={13} className="mr-1" />
                                    Borrar
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              )}

              {spatialPanelTab === "search" && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3">
                    <Search size={16} className="text-slate-400" />
                    <input
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      placeholder="Buscar predio, municipio, tarea..."
                      className="h-10 flex-1 bg-transparent text-sm font-semibold text-slate-700 outline-none placeholder:text-slate-400"
                    />
                    {searchTerm && (
                      <button type="button" onClick={() => setSearchTerm("")} className="text-slate-400 hover:text-slate-600">
                        <X size={16} />
                      </button>
                    )}
                  </div>
                  <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-100">
                    {filteredFeatureJoins.length === 0 ? (
                      <div className="p-4 text-center text-sm font-semibold text-slate-500">
                        {visibleLayers.length > 0 ? "Sin coincidencias visibles." : "No hay capas encendidas."}
                      </div>
                    ) : (
                      filteredFeatureJoins.slice(0, 8).map((join) => {
                        const primaryTask = join.tasks[0];
                        const temporalMeta = temporalStatusMeta[getTemporalStateForJoin(join, simulationDate)];
                        const auditMeta = planAuditMeta[planAudit.riskByFeatureId.get(join.featureId) || "ok"];
                        const meta = spatialViewMode === "audit" ? auditMeta : spatialViewMode === "simulation" ? temporalMeta : primaryTask ? getStatusMeta(primaryTask) : statusMeta.todo;
                        return (
                          <button
                            type="button"
                            key={`quick-${join.featureId}`}
                            onClick={() => {
                              setSelectedLayerId(join.layerId);
                              setSelectedFeatureId(join.featureId);
                            }}
                            className="block w-full border-b border-slate-100 px-3 py-2 text-left transition last:border-b-0 hover:bg-slate-50"
                          >
                            <p className="truncate text-[10px] font-black uppercase tracking-[0.14em] text-indigo-600">{join.layerName}</p>
                            <div className="mt-1 flex items-center gap-2">
                              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.color }} />
                              <p className="min-w-0 flex-1 truncate text-xs font-black text-slate-900">
                                {join.label || join.key || "Sin clave"}
                              </p>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {selectedLayer && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Palette size={16} className="text-indigo-600" />
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Leyenda activa</p>
                  </div>
                  <p className="mt-1 text-xs font-semibold text-slate-500">
                    {spatialViewMode === "audit"
                      ? "Riesgo operativo de la planificación"
                      : spatialViewMode === "simulation"
                      ? "Estados temporales de la simulación"
                      : normalizeLayerStyle(selectedLayer.styleConfig).themeMode === "attribute"
                      ? `Categorías por ${normalizeLayerStyle(selectedLayer.styleConfig).themeAttribute || "atributo"}`
                      : normalizeLayerStyle(selectedLayer.styleConfig).themeMode === "unique"
                      ? "Simbología única de la capa"
                      : "Estados de tareas vinculadas"}
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">
                  {activeLegend.length}
                </span>
              </div>

              <div className="mt-4 max-h-64 space-y-2 overflow-y-auto pr-1">
                {activeLegend.length === 0 ? (
                  <div className="rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-500">
                    No hay elementos de leyenda para la capa seleccionada.
                  </div>
                ) : (
                  activeLegend.slice(0, 80).map((item) => (
                    <div key={item.key} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                      <span className="h-4 w-4 shrink-0 rounded-full border border-white shadow-sm" style={{ backgroundColor: item.color }} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-black text-slate-800">{item.label}</p>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${activeLegendTotal ? Math.max(4, Math.round((item.count / activeLegendTotal) * 100)) : 0}%`,
                              backgroundColor: item.color,
                            }}
                          />
                        </div>
                      </div>
                      <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[10px] font-black text-slate-600">
                        {item.count}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {selectedLayer ? false && (
            <div className="hidden rounded-2xl border border-cyan-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <BarChart3 size={16} className="text-cyan-700" />
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-700">Análisis por área</p>
                  </div>
                  <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                    Dibuja un rectángulo y resume cualquier atributo de la capa.
                  </p>
                </div>
                <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-black text-cyan-700">
                  {analysisStats.total} entidades
                </span>
              </div>

              <label className="mt-4 block text-xs font-black uppercase tracking-[0.16em] text-slate-400">Atributo estadístico</label>
              <select
                value={analysisAttribute}
                onChange={(event) => setAnalysisAttribute(event.target.value)}
                className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
              >
                {(selectedLayer!.attributes || []).length === 0 && <option value="">Sin atributos</option>}
                {(selectedLayer!.attributes || []).map((attribute) => (
                  <option key={attribute} value={attribute}>
                    {attribute}
                  </option>
                ))}
              </select>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={isDrawingAnalysis ? "default" : "outline"}
                  onClick={() => {
                    setIsDrawingAnalysis((current) => !current);
                    setAnalysisDraftRect(null);
                  }}
                  className={isDrawingAnalysis ? "bg-cyan-600 text-white hover:bg-cyan-700" : ""}
                >
                  <MousePointer2 size={15} className="mr-2" />
                  Dibujar
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setAnalysisBounds(null);
                    setAnalysisDraftRect(null);
                    setIsDrawingAnalysis(false);
                  }}
                  disabled={!analysisBounds && !analysisDraftRect}
                >
                  <Eraser size={15} className="mr-2" />
                  Limpiar
                </Button>
              </div>

              {!analysisBounds ? (
                <div className="mt-4 rounded-xl border border-dashed border-cyan-200 bg-cyan-50 p-4 text-sm font-semibold leading-6 text-cyan-900">
                  Activa “Dibujar” y arrastra sobre el mapa para crear el área de análisis.
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-slate-50 p-3">
                      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Categorías</p>
                      <p className="mt-1 text-2xl font-black text-slate-900">{analysisStats.distinct}</p>
                    </div>
                    <div className="rounded-xl bg-emerald-50 p-3">
                      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-700">Numéricos</p>
                      <p className="mt-1 text-2xl font-black text-emerald-800">{analysisStats.numericCount}</p>
                    </div>
                  </div>

                  {analysisStats.numericCount > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-xl bg-indigo-50 p-3">
                        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-indigo-700">Promedio</p>
                        <p className="mt-1 text-lg font-black text-indigo-900">{formatMetricNumber(analysisStats.average, 2)}</p>
                      </div>
                      <div className="rounded-xl bg-orange-50 p-3">
                        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-orange-700">Suma</p>
                        <p className="mt-1 text-lg font-black text-orange-900">{formatMetricNumber(analysisStats.sum, 2)}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Mínimo</p>
                        <p className="mt-1 text-lg font-black text-slate-900">{formatMetricNumber(analysisStats.min, 2)}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Máximo</p>
                        <p className="mt-1 text-lg font-black text-slate-900">{formatMetricNumber(analysisStats.max, 2)}</p>
                      </div>
                    </div>
                  )}

                  <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                    {analysisStats.categories.length === 0 ? (
                      <div className="rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-500">
                        El área no contiene entidades de la capa seleccionada.
                      </div>
                    ) : (
                      analysisStats.categories.slice(0, 50).map((item) => (
                        <div key={item.category} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-xs font-black text-slate-900">{item.category}</p>
                              <p className="mt-0.5 text-[11px] font-semibold text-slate-500">{item.percent}% del área</p>
                            </div>
                            <span className="rounded-full bg-white px-2 py-1 text-xs font-black text-slate-700">{item.count}</span>
                          </div>
                          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
                            <div className="h-full rounded-full" style={{ width: `${Math.max(3, item.percent)}%`, backgroundColor: item.color }} />
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {canManage && selectedLayer ? false && (
            <div className="hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2">
                <Settings2 size={16} className="text-indigo-600" />
                <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Gestionar capa</p>
              </div>

              <label className="mt-4 block text-xs font-black uppercase tracking-[0.16em] text-slate-400">Nombre</label>
              <input
                value={layerEditName}
                onChange={(event) => setLayerEditName(event.target.value)}
                placeholder="Ej: Predios operativos"
                className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
              />

              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <label className="block text-xs font-black uppercase tracking-[0.16em] text-slate-400">Etiqueta visible</label>
                <select
                  value={layerEditStyle.labelAttribute}
                  onChange={(event) =>
                    setLayerEditStyle((current) => ({
                      ...current,
                      labelAttribute: event.target.value,
                      labelsVisible: event.target.value ? current.labelsVisible : false,
                    }))
                  }
                  className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                >
                  <option value="">Sin etiqueta</option>
                  {(selectedLayer!.attributes || []).map((attribute) => (
                    <option key={attribute} value={attribute}>
                      {attribute}
                    </option>
                  ))}
                </select>
                <label className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-sm font-bold text-slate-700">
                  Mostrar etiquetas en el mapa
                  <input
                    type="checkbox"
                    checked={layerEditStyle.labelsVisible}
                    disabled={!layerEditStyle.labelAttribute}
                    onChange={(event) =>
                      setLayerEditStyle((current) => ({
                        ...current,
                        labelsVisible: event.target.checked,
                      }))
                    }
                    className="h-5 w-5 accent-emerald-600 disabled:opacity-50"
                  />
                </label>
                <p className="mt-2 text-xs font-semibold leading-5 text-slate-500">
                  Las etiquetas se dibujan con el atributo elegido y aparecen cuando el zoom permite leerlas sin saturar el mapa.
                </p>
              </div>

              <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3">
                <label className="block text-xs font-black uppercase tracking-[0.16em] text-indigo-700">Modo de simbología</label>
                <select
                  value={layerEditStyle.themeMode}
                  onChange={(event) =>
                    setLayerEditStyle((current) => ({
                      ...current,
                      themeMode: event.target.value as LayerThemeMode,
                      themeAttribute: event.target.value === "attribute" ? current.themeAttribute || selectedLayer!.attributes?.[0] || "" : current.themeAttribute,
                    }))
                  }
                  className="mt-2 h-10 w-full rounded-xl border border-indigo-100 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                >
                  <option value="task_status">Por estado de tarea</option>
                  <option value="attribute">Por atributo de capa</option>
                  <option value="unique">Simbología única</option>
                </select>

                {layerEditStyle.themeMode === "attribute" && (
                  <div className="mt-3">
                    <label className="block text-xs font-black uppercase tracking-[0.16em] text-indigo-700">Atributo de categorías</label>
                    <select
                      value={layerEditStyle.themeAttribute}
                      onChange={(event) =>
                        setLayerEditStyle((current) => ({
                          ...current,
                          themeAttribute: event.target.value,
                        }))
                      }
                      className="mt-2 h-10 w-full rounded-xl border border-indigo-100 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                    >
                      <option value="">Selecciona atributo</option>
                      {(selectedLayer!.attributes || []).map((attribute) => (
                        <option key={attribute} value={attribute}>
                          {attribute}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="mt-4">
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                  <Palette size={14} />
                  {layerEditStyle.themeMode === "attribute"
                    ? "Visualización por atributo"
                    : layerEditStyle.themeMode === "unique"
                    ? "Simbología única"
                    : "Visualización por estado"}
                </div>
                <div className="mt-3 space-y-2">
                  {layerEditStyle.themeMode === "attribute" ? (
                    !layerEditStyle.themeAttribute ? (
                      <div className="rounded-xl border border-dashed border-indigo-200 bg-indigo-50 p-3 text-sm font-semibold text-indigo-800">
                        Selecciona un atributo para generar sus categorías.
                      </div>
                    ) : selectedLayerThemeCategories.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-500">
                        Cargando categorías de la capa seleccionada...
                      </div>
                    ) : (
                      selectedLayerThemeCategories.slice(0, 80).map((item) => (
                        <div key={item.category} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="h-5 w-5 shrink-0 rounded-full border border-white shadow-sm" style={{ backgroundColor: item.style.fillColor }} />
                            <div className="min-w-0">
                              <p className="truncate text-xs font-black uppercase tracking-[0.12em] text-slate-700">{item.category}</p>
                              <p className="text-[11px] font-semibold text-slate-400">{item.count.toLocaleString("es-CO")} entidades</p>
                            </div>
                          </div>
                          <input
                            type="color"
                            value={item.style.fillColor}
                            onChange={(event) => {
                              const color = event.target.value;
                              setLayerEditStyle((current) => ({
                                ...current,
                                attributeStyles: {
                                  ...current.attributeStyles,
                                  [item.category]: {
                                    fillColor: color,
                                    strokeColor: color,
                                  },
                                },
                              }));
                            }}
                            className="h-8 w-10 shrink-0 cursor-pointer rounded-lg border border-slate-200 bg-white p-1"
                            aria-label={`Color para ${item.category}`}
                          />
                        </div>
                      ))
                    )
                  ) : layerEditStyle.themeMode === "unique" ? (
                    <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-black text-slate-900">Color único de capa</p>
                          <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                            Se aplica a todas las entidades visibles.
                          </p>
                        </div>
                        <input
                          type="color"
                          value={layerEditStyle.fillColor}
                          onChange={(event) => updateLayerUniqueColor(event.target.value)}
                          className="h-8 w-10 shrink-0 cursor-pointer rounded-lg border border-slate-200 bg-white p-1"
                          aria-label="Color único de la capa"
                        />
                      </div>
                    </div>
                  ) : (
                    SPATIAL_STATUS_STYLE_OPTIONS.map((option) => {
                      const stateStyle = layerEditStyle.statusStyles[option.key];
                      return (
                        <div key={option.key} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="h-5 w-5 shrink-0 rounded-full border border-white shadow-sm" style={{ backgroundColor: stateStyle.fillColor }} />
                            <div className="min-w-0">
                              <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-700">{option.label}</p>
                              <p className="truncate text-[11px] font-semibold text-slate-400">{option.helper}</p>
                            </div>
                          </div>
                          <input
                            type="color"
                            value={stateStyle.fillColor}
                            onChange={(event) => updateLayerStatusColor(option.key, event.target.value)}
                            className="h-8 w-10 shrink-0 cursor-pointer rounded-lg border border-slate-200 bg-white p-1"
                            aria-label={`Color para ${option.label}`}
                          />
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <label className="mt-4 block text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                Opacidad {Math.round(layerEditStyle.fillOpacity * 100)}%
              </label>
              <input
                type="range"
                min={0.04}
                max={0.8}
                step={0.02}
                value={layerEditStyle.fillOpacity}
                onChange={(event) =>
                  setLayerEditStyle((current) => ({
                    ...current,
                    fillOpacity: Number(event.target.value),
                    strokeOpacity: Math.min(1, Math.max(0.35, Number(event.target.value) + 0.45)),
                  }))
                }
                className="mt-2 w-full accent-emerald-600"
              />

              <label className="mt-4 block text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                Borde {layerEditStyle.strokeWidth.toFixed(1)} px
              </label>
              <input
                type="range"
                min={0.5}
                max={6}
                step={0.1}
                value={layerEditStyle.strokeWidth}
                onChange={(event) =>
                  setLayerEditStyle((current) => ({
                    ...current,
                    strokeWidth: Number(event.target.value),
                  }))
                }
                className="mt-2 w-full accent-indigo-600"
              />

              <label className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
                Mostrar capa en el mapa
                <input
                  type="checkbox"
                  checked={layerEditVisible}
                  onChange={(event) => setLayerEditVisible(event.target.checked)}
                  className="h-5 w-5 accent-emerald-600"
                />
              </label>

              <div className="mt-4 grid gap-2">
                <Button
                  type="button"
                  onClick={handleSaveLayerSettings}
                  disabled={savingLayerSettings}
                  className="bg-slate-950 text-white hover:bg-slate-800"
                >
                  {savingLayerSettings ? <Loader2 size={15} className="mr-2 animate-spin" /> : <Save size={15} className="mr-2" />}
                  Guardar estilo
                </Button>
                <Button type="button" variant="outline" onClick={() => setLayerPendingDelete(selectedLayer)} className="border-red-100 text-red-700 hover:bg-red-50">
                  <Trash2 size={15} className="mr-2" />
                  Eliminar capa
                </Button>
              </div>
            </div>
          ) : null}

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 p-4">
              <div className="flex items-center gap-2">
                <Search size={16} className="text-slate-400" />
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Buscar predio, municipio, tarea..."
                  className="h-9 flex-1 bg-transparent text-sm font-semibold text-slate-700 outline-none placeholder:text-slate-400"
                />
                {searchTerm && (
                  <button type="button" onClick={() => setSearchTerm("")} className="text-slate-400 hover:text-slate-600">
                    <X size={16} />
                  </button>
                )}
              </div>
            </div>
            <div className="max-h-[420px] overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center p-8 text-sm font-semibold text-slate-500">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Cargando capas...
                </div>
              ) : filteredFeatureJoins.length === 0 ? (
                <div className="p-6 text-center text-sm font-semibold text-slate-500">
                  {visibleLayers.length > 0 ? "No hay entidades visibles que coincidan con la búsqueda." : "No hay capas encendidas en el mapa."}
                </div>
              ) : (
                filteredFeatureJoins.slice(0, 80).map((join) => {
                  const primaryTask = join.tasks[0];
                  const temporalMeta = temporalStatusMeta[getTemporalStateForJoin(join, simulationDate)];
                  const auditMeta = planAuditMeta[planAudit.riskByFeatureId.get(join.featureId) || "ok"];
                  const meta = spatialViewMode === "audit" ? auditMeta : spatialViewMode === "simulation" ? temporalMeta : primaryTask ? getStatusMeta(primaryTask) : statusMeta.todo;
                  const schedule = primaryTask ? getScheduleState(primaryTask) : null;
                  const isSelected = selectedFeatureId === join.featureId;

                  return (
                    <button
                      type="button"
                      key={join.featureId}
                      onClick={() => {
                        setSelectedLayerId(join.layerId);
                        setSelectedFeatureId(join.featureId);
                      }}
                      className={`block w-full border-b border-slate-100 p-3 text-left transition hover:bg-slate-50 ${
                        isSelected ? "bg-emerald-50" : "bg-white"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[10px] font-black uppercase tracking-[0.14em] text-indigo-600">
                            {join.layerName}
                          </p>
                          <p className="truncate text-xs font-black uppercase tracking-[0.14em]" style={{ color: meta.color }}>
                            {join.label || join.key || "Sin clave"}
                          </p>
                          <p className="mt-1 truncate text-sm font-black text-slate-900">
                            {primaryTask ? getTaskTitle(primaryTask) : "Sin tarea vinculada"}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full px-2 py-1 text-[10px] font-black text-white" style={{ backgroundColor: meta.color }}>
                          {primaryTask ? meta.label : "Libre"}
                        </span>
                      </div>
                      {primaryTask && (
                        <div className="mt-2 flex flex-wrap items-center gap-1 text-[10px] font-black uppercase tracking-[0.12em]">
                          {schedule && <span className={`rounded-full px-2 py-1 ${schedule.className}`}>{schedule.label}</span>}
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">
                            {getMemberName(memberById, primaryTask.assignedTo)}
                          </span>
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">
                            Cierre {formatDate(primaryTask.endDate || primaryTask.end)}
                          </span>
                        </div>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </aside>
      </div>

      {selectedFeatureJoin && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-600">Entidad seleccionada</p>
              <h3 className="mt-1 text-xl font-black text-slate-900">
                {selectedFeatureJoin.label || selectedFeatureJoin.key || "Sin clave"}
              </h3>
              <p className="mt-1 text-sm font-semibold text-slate-500">
                {selectedFeatureJoin.layerName}
                {selectedFeatureJoin.labelAttribute ? ` · etiqueta ${selectedFeatureJoin.labelAttribute}` : ""}
                {selectedFeatureJoin.key ? ` · clave ${selectedFeatureJoin.key}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs font-black uppercase tracking-[0.12em]">
              <span className="rounded-full bg-indigo-50 px-3 py-1 text-indigo-700">
                {selectedFeatureJoin.layerAttribute || "Sin atributo"} → {selectedFeatureJoin.taskAttribute || "Sin atributo"}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">
                {selectedFeatureJoin.tasks.length} tareas vinculadas
              </span>
              {spatialViewMode === "audit" && (
                <span
                  className="rounded-full px-3 py-1 text-white"
                  style={{ backgroundColor: planAuditMeta[planAudit.riskByFeatureId.get(selectedFeatureJoin.featureId) || "ok"].color }}
                >
                  {planAuditMeta[planAudit.riskByFeatureId.get(selectedFeatureJoin.featureId) || "ok"].label}
                </span>
              )}
              {selectedFeatureJoin.tasks.length === 0 && (
                <span className="inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-amber-700">
                  <AlertTriangle size={13} className="mr-1" />
                  Sin coincidencia
                </span>
              )}
            </div>
          </div>

          <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-3">
              {selectedFeatureJoin.tasks.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm font-semibold text-slate-500">
                  Esta geometría no encontró tarea con la unión actual. Revisa que el valor de la capa y el atributo de tarea sean equivalentes.
                </div>
              ) : (
                selectedFeatureJoin.tasks.map((task) => {
                  const meta = spatialViewMode === "audit"
                    ? planAuditMeta[planAudit.riskByFeatureId.get(selectedFeatureJoin.featureId) || "ok"]
                    : spatialViewMode === "simulation"
                    ? temporalStatusMeta[getTemporalStateForTask(task, simulationDate)]
                    : getStatusMeta(task);
                  const schedule = getScheduleState(task);
                  return (
                    <div key={task.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap gap-2">
                            <span className="rounded-full px-2.5 py-1 text-xs font-black text-white" style={{ backgroundColor: meta.color }}>
                              {meta.label}
                            </span>
                            <span className={`rounded-full px-2.5 py-1 text-xs font-black ${schedule.className}`}>{schedule.label}</span>
                          </div>
                          <h4 className="mt-2 text-lg font-black text-slate-900">{getTaskTitle(task)}</h4>
                          <p className="mt-1 text-sm font-semibold text-slate-500">
                            {task.externalWorkflowId ? `${task.externalWorkflowId} · ` : ""}
                            {[
                              task.workflowMunicipality || task.municipality,
                              task.workflowDepartment || task.department,
                            ].filter(Boolean).join(", ") || project?.name || "Proyecto"}
                          </p>
                        </div>
                        <a
                          href={`/projects/${projectId}?tab=tasks&taskId=${encodeURIComponent(task.id)}&focus=comments`}
                          className="inline-flex shrink-0 items-center justify-center rounded-lg border border-indigo-100 px-3 py-2 text-sm font-bold text-indigo-700 transition hover:bg-indigo-50"
                        >
                          <Eye size={15} className="mr-2" />
                          Ver tarea
                        </a>
                      </div>
                      <div className="mt-3 grid gap-2 text-xs font-semibold text-slate-500 sm:grid-cols-3">
                        <span>Responsable: {getMemberName(memberById, task.assignedTo)}</span>
                        <span>Inicio: {formatDate(task.startDate || task.start)}</span>
                        <span>Cierre: {formatDate(task.endDate || task.end)}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                <MousePointer2 size={14} />
                Atributos de capa
              </div>
              <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                {Object.entries(selectedFeatureJoin.feature.properties || {}).map(([key, value]) => (
                  <div key={key} className="rounded-lg bg-white p-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{key}</p>
                    <p className="mt-1 break-words text-xs font-bold text-slate-700">{String(value ?? "")}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
        <div className="flex gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          <div>
            <h3 className="text-sm font-black text-emerald-900">Cómo usar el mapa operativo</h3>
            <p className="mt-1 text-sm font-semibold leading-6 text-emerald-800">
              Sube una capa y elige si quieres unirla por una llave única —por ejemplo MpCodigo— o por la combinación municipio + departamento. Las geometrías se pintan con el estado de las tareas vinculadas.
            </p>
          </div>
        </div>
      </div>

      {isLayerManagerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-indigo-700">
                  <Settings2 size={14} />
                  Configuración espacial
                </div>
                <h3 className="text-xl font-black text-slate-900">Capas, etiquetas y simbología</h3>
                <p className="mt-1 text-sm font-medium leading-6 text-slate-500">
                  Administra capas sin ocupar el panel lateral. Enciende varias capas y configura la capa activa en un solo lugar.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsLayerManagerOpen(false)}
                className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                aria-label="Cerrar configuración de capas"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto bg-slate-50 p-5 lg:grid-cols-[340px_minmax(0,1fr)]">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Layers size={16} className="text-indigo-600" />
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Capas del mapa</p>
                    </div>
                    <p className="mt-1 text-xs font-semibold text-slate-500">
                      Selecciona cuál configurar y cuáles se mantienen visibles.
                    </p>
                  </div>
                  <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-black text-indigo-700">
                    {visibleLayers.length}/{layers.length}
                  </span>
                </div>

                <div className="mt-4 max-h-[58vh] space-y-2 overflow-y-auto pr-1">
                  {layers.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-sm font-semibold text-slate-500">
                      No hay capas cargadas todavía.
                    </div>
                  ) : (
                    layers.map((layer) => {
                      const style = normalizeLayerStyle(layer.styleConfig);
                      const isVisible = layer.visible !== false;
                      const isActive = layer.id === selectedLayerId;
                      return (
                        <div
                          key={layer.id}
                          className={`rounded-xl border p-2 transition ${
                            isActive ? "border-indigo-300 bg-indigo-50/70" : "border-slate-200 bg-white hover:bg-slate-50"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <label className="relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center">
                              <input
                                type="checkbox"
                                checked={isVisible}
                                disabled={!canManage}
                                onChange={(event) => void handleToggleLayerVisibility(layer, event.target.checked)}
                                className="peer sr-only"
                                aria-label={isVisible ? `Apagar ${layer.name}` : `Encender ${layer.name}`}
                              />
                              <span className="absolute inset-0 rounded-full bg-slate-200 transition peer-checked:bg-emerald-500 peer-disabled:opacity-50" />
                              <span className="absolute left-1 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
                            </label>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedLayerId(layer.id);
                                setSelectedFeatureId(null);
                              }}
                              className="min-w-0 flex-1 text-left"
                            >
                              <div className="flex items-center gap-2">
                                <span
                                  className="h-3 w-3 shrink-0 rounded-full"
                                  style={{
                                    backgroundColor:
                                      style.themeMode === "unique" ? style.fillColor : style.statusStyles.unlinked.fillColor,
                                  }}
                                />
                                <p className="truncate text-sm font-black text-slate-900">{layer.name || layer.fileName || "Capa sin nombre"}</p>
                              </div>
                              <p className="mt-1 truncate text-[11px] font-semibold text-slate-500">
                                {(layer.featureCount || 0).toLocaleString("es-CO")} entidades
                                {style.labelsVisible && style.labelAttribute ? ` · etiqueta: ${style.labelAttribute}` : ""}
                              </p>
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                {!selectedLayer ? (
                  <div className="flex min-h-72 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
                    <div>
                      <Layers className="mx-auto h-10 w-10 text-slate-300" />
                      <p className="mt-3 text-sm font-black text-slate-700">Selecciona una capa para configurarla.</p>
                    </div>
                  </div>
                ) : !canManage ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm font-semibold leading-6 text-slate-500">
                    Puedes consultar la configuración de la capa, pero solo los administradores pueden editar nombres, estilos o visibilidad.
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
                      <label className="block">
                        <span className="block text-xs font-black uppercase tracking-[0.16em] text-slate-400">Nombre</span>
                        <input
                          value={layerEditName}
                          onChange={(event) => setLayerEditName(event.target.value)}
                          placeholder="Ej: Predios operativos"
                          className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                        />
                      </label>
                      <label className="mt-6 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700 md:mt-auto">
                        Mostrar capa
                        <input
                          type="checkbox"
                          checked={layerEditVisible}
                          onChange={(event) => setLayerEditVisible(event.target.checked)}
                          className="h-5 w-5 accent-emerald-600"
                        />
                      </label>
                    </div>

                    <div className="grid gap-3 lg:grid-cols-2">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <label className="block text-xs font-black uppercase tracking-[0.16em] text-slate-400">Etiqueta visible</label>
                        <select
                          value={layerEditStyle.labelAttribute}
                          onChange={(event) =>
                            setLayerEditStyle((current) => ({
                              ...current,
                              labelAttribute: event.target.value,
                              labelsVisible: event.target.value ? current.labelsVisible : false,
                            }))
                          }
                          className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                        >
                          <option value="">Sin etiqueta</option>
                          {(selectedLayer.attributes || []).map((attribute) => (
                            <option key={attribute} value={attribute}>
                              {attribute}
                            </option>
                          ))}
                        </select>
                        <label className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-sm font-bold text-slate-700">
                          Mostrar etiquetas en el mapa
                          <input
                            type="checkbox"
                            checked={layerEditStyle.labelsVisible}
                            disabled={!layerEditStyle.labelAttribute}
                            onChange={(event) =>
                              setLayerEditStyle((current) => ({
                                ...current,
                                labelsVisible: event.target.checked,
                              }))
                            }
                            className="h-5 w-5 accent-emerald-600 disabled:opacity-50"
                          />
                        </label>
                      </div>

                      <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3">
                        <label className="block text-xs font-black uppercase tracking-[0.16em] text-indigo-700">Modo de simbología</label>
                        <select
                          value={layerEditStyle.themeMode}
                          onChange={(event) =>
                            setLayerEditStyle((current) => ({
                              ...current,
                              themeMode: event.target.value as LayerThemeMode,
                              themeAttribute: event.target.value === "attribute" ? current.themeAttribute || selectedLayer.attributes?.[0] || "" : current.themeAttribute,
                            }))
                          }
                          className="mt-2 h-10 w-full rounded-xl border border-indigo-100 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                        >
                          <option value="task_status">Por estado de tarea</option>
                          <option value="attribute">Por atributo de capa</option>
                          <option value="unique">Simbología única</option>
                        </select>

                        {layerEditStyle.themeMode === "attribute" && (
                          <label className="mt-3 block">
                            <span className="block text-xs font-black uppercase tracking-[0.16em] text-indigo-700">Atributo de categorías</span>
                            <select
                              value={layerEditStyle.themeAttribute}
                              onChange={(event) =>
                                setLayerEditStyle((current) => ({
                                  ...current,
                                  themeAttribute: event.target.value,
                                }))
                              }
                              className="mt-2 h-10 w-full rounded-xl border border-indigo-100 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                            >
                              <option value="">Selecciona atributo</option>
                              {(selectedLayer.attributes || []).map((attribute) => (
                                <option key={attribute} value={attribute}>
                                  {attribute}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                        <Palette size={14} />
                        {layerEditStyle.themeMode === "attribute"
                          ? "Colores por atributo"
                          : layerEditStyle.themeMode === "unique"
                          ? "Simbología única"
                          : "Colores por estado"}
                      </div>
                      <div className="mt-3 grid max-h-72 gap-2 overflow-y-auto pr-1 lg:grid-cols-2">
                        {layerEditStyle.themeMode === "attribute" ? (
                          !layerEditStyle.themeAttribute ? (
                            <div className="rounded-xl border border-dashed border-indigo-200 bg-indigo-50 p-3 text-sm font-semibold text-indigo-800">
                              Selecciona un atributo para generar sus categorías.
                            </div>
                          ) : selectedLayerThemeCategories.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-500">
                              Cargando categorías de la capa seleccionada...
                            </div>
                          ) : (
                            selectedLayerThemeCategories.slice(0, 80).map((item) => (
                              <div key={item.category} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                                <div className="flex min-w-0 items-center gap-3">
                                  <span className="h-5 w-5 shrink-0 rounded-full border border-white shadow-sm" style={{ backgroundColor: item.style.fillColor }} />
                                  <div className="min-w-0">
                                    <p className="truncate text-xs font-black uppercase tracking-[0.12em] text-slate-700">{item.category}</p>
                                    <p className="text-[11px] font-semibold text-slate-400">{item.count.toLocaleString("es-CO")} entidades</p>
                                  </div>
                                </div>
                                <input
                                  type="color"
                                  value={item.style.fillColor}
                                  onChange={(event) => {
                                    const color = event.target.value;
                                    setLayerEditStyle((current) => ({
                                      ...current,
                                      attributeStyles: {
                                        ...current.attributeStyles,
                                        [item.category]: {
                                          fillColor: color,
                                          strokeColor: color,
                                        },
                                      },
                                    }));
                                  }}
                                  className="h-8 w-10 shrink-0 cursor-pointer rounded-lg border border-slate-200 bg-white p-1"
                                  aria-label={`Color para ${item.category}`}
                                />
                              </div>
                            ))
                          )
                        ) : layerEditStyle.themeMode === "unique" ? (
                          <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-4 lg:col-span-2">
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                              <div className="min-w-0">
                                <p className="text-sm font-black text-slate-900">Una sola simbología para toda la capa</p>
                                <p className="mt-1 text-sm font-semibold leading-6 text-slate-500">
                                  Usa este color cuando quieras revisar la capa completa sin clasificar por tarea o atributo.
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-3 rounded-xl border border-indigo-100 bg-white px-3 py-2">
                                <span className="h-7 w-7 rounded-full border border-white shadow-sm" style={{ backgroundColor: layerEditStyle.fillColor }} />
                                <input
                                  type="color"
                                  value={layerEditStyle.fillColor}
                                  onChange={(event) => updateLayerUniqueColor(event.target.value)}
                                  className="h-8 w-12 cursor-pointer rounded-lg border border-slate-200 bg-white p-1"
                                  aria-label="Color único de la capa"
                                />
                              </div>
                            </div>
                          </div>
                        ) : (
                          SPATIAL_STATUS_STYLE_OPTIONS.map((option) => {
                            const stateStyle = layerEditStyle.statusStyles[option.key];
                            return (
                              <div key={option.key} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                                <div className="flex min-w-0 items-center gap-3">
                                  <span className="h-5 w-5 shrink-0 rounded-full border border-white shadow-sm" style={{ backgroundColor: stateStyle.fillColor }} />
                                  <div className="min-w-0">
                                    <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-700">{option.label}</p>
                                    <p className="truncate text-[11px] font-semibold text-slate-400">{option.helper}</p>
                                  </div>
                                </div>
                                <input
                                  type="color"
                                  value={stateStyle.fillColor}
                                  onChange={(event) => updateLayerStatusColor(option.key, event.target.value)}
                                  className="h-8 w-10 shrink-0 cursor-pointer rounded-lg border border-slate-200 bg-white p-1"
                                  aria-label={`Color para ${option.label}`}
                                />
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="block text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                        Opacidad {Math.round(layerEditStyle.fillOpacity * 100)}%
                        <input
                          type="range"
                          min={0.04}
                          max={0.8}
                          step={0.02}
                          value={layerEditStyle.fillOpacity}
                          onChange={(event) =>
                            setLayerEditStyle((current) => ({
                              ...current,
                              fillOpacity: Number(event.target.value),
                              strokeOpacity: Math.min(1, Math.max(0.35, Number(event.target.value) + 0.45)),
                            }))
                          }
                          className="mt-2 w-full accent-emerald-600"
                        />
                      </label>
                      <label className="block text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                        Borde {layerEditStyle.strokeWidth.toFixed(1)} px
                        <input
                          type="range"
                          min={0.5}
                          max={6}
                          step={0.1}
                          value={layerEditStyle.strokeWidth}
                          onChange={(event) =>
                            setLayerEditStyle((current) => ({
                              ...current,
                              strokeWidth: Number(event.target.value),
                            }))
                          }
                          className="mt-2 w-full accent-indigo-600"
                        />
                      </label>
                    </div>

                    <div className="flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-between">
                      <Button type="button" variant="outline" onClick={() => setLayerPendingDelete(selectedLayer)} className="border-red-100 text-red-700 hover:bg-red-50">
                        <Trash2 size={15} className="mr-2" />
                        Eliminar capa
                      </Button>
                      <Button
                        type="button"
                        onClick={handleSaveLayerSettings}
                        disabled={savingLayerSettings}
                        className="bg-slate-950 text-white hover:bg-slate-800"
                      >
                        {savingLayerSettings ? <Loader2 size={15} className="mr-2 animate-spin" /> : <Save size={15} className="mr-2" />}
                        Guardar configuración
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {isUploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <form
            className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl"
            onSubmit={(event) => {
              event.preventDefault();
              void handleUploadFile(uploadDraftFile, uploadDraftName);
            }}
          >
            <div className="border-b border-slate-100 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-emerald-700">
                    <Upload size={14} />
                    Nueva capa espacial
                  </div>
                  <h3 className="text-xl font-black text-slate-900">Subir capa al mapa</h3>
                  <p className="mt-1 text-sm font-medium leading-6 text-slate-500">
                    Dale un nombre operativo antes de cargarla. Ese nombre aparecerá en el selector y en los reportes espaciales.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (uploading) return;
                    setIsUploadModalOpen(false);
                    setUploadDraftFile(null);
                    setUploadDraftName("");
                  }}
                  className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Cerrar"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="space-y-4 bg-slate-50 p-5">
              <div>
                <label className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-slate-400">Nombre de la capa</label>
                <input
                  value={uploadDraftName}
                  onChange={(event) => setUploadDraftName(event.target.value)}
                  placeholder="Ej: Predios operativos, Barrios, Manzanas"
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                  autoFocus
                />
              </div>

              <div>
                <label className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-slate-400">Archivo espacial</label>
                <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-emerald-300 bg-white px-5 py-6 text-center transition hover:border-emerald-500 hover:bg-emerald-50/40">
                  <Upload className="h-8 w-8 text-emerald-600" />
                  <span className="mt-3 text-sm font-black text-slate-900">
                    {uploadDraftFile ? uploadDraftFile.name : "Seleccionar shapefile .zip o GeoJSON"}
                  </span>
                  {uploadDraftFile && (
                    <span className="mt-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-600">
                      {formatBytes(uploadDraftFile.size)}
                    </span>
                  )}
                  <span className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                    Para shapefile sube un .zip con .shp, .shx, .dbf y, si existe, .prj.
                  </span>
                  <input
                    type="file"
                    accept=".zip,.geojson,.json,application/geo+json,application/json"
                    className="hidden"
                    disabled={uploading}
                    onChange={(event) => {
                      const file = event.target.files?.[0] || null;
                      setUploadDraftFile(file);
                      if (file && !uploadDraftName.trim()) setUploadDraftName(file.name.replace(/\.[^.]+$/, ""));
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
              </div>

              <div className="rounded-xl border border-cyan-100 bg-cyan-50 p-3 text-xs font-semibold leading-5 text-cyan-800">
                La geometría se guarda directamente en Supabase Storage. Si la capa es grande, Pixel la divide automáticamente en fragmentos seguros sin eliminar entidades.
              </div>

              {uploading && uploadProgressText && (
                <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-800">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                  <span>{uploadProgressText}</span>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-100 p-5">
              <Button
                type="button"
                variant="outline"
                disabled={uploading}
                onClick={() => {
                  setIsUploadModalOpen(false);
                  setUploadDraftFile(null);
                  setUploadDraftName("");
                }}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={uploading || !uploadDraftFile || !uploadDraftName.trim()} className="bg-emerald-600 text-white hover:bg-emerald-700">
                {uploading ? <Loader2 size={15} className="mr-2 animate-spin" /> : <Upload size={15} className="mr-2" />}
                Subir capa
              </Button>
            </div>
          </form>
        </div>
      )}

      {layerPendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-slate-100 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-red-50 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-red-700">
                    <Trash2 size={14} />
                    Eliminar capa
                  </div>
                  <h3 className="text-xl font-black text-slate-900">{layerPendingDelete.name || "Capa espacial"}</h3>
                  <p className="mt-1 text-sm font-medium leading-6 text-slate-500">
                    Esta acción quitará la capa del proyecto y sus uniones espaciales guardadas.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setLayerPendingDelete(null)}
                  className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Cerrar"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="bg-slate-50 p-5">
              <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm font-semibold leading-6 text-red-800">
                Si necesitas conservar la capa para análisis histórico, cancela y deja la capa cargada. No se eliminarán tareas del proyecto.
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-100 p-5">
              <Button type="button" variant="outline" onClick={() => setLayerPendingDelete(null)}>
                Cancelar
              </Button>
              <Button type="button" onClick={handleDeleteLayer} className="bg-red-600 text-white hover:bg-red-700">
                Eliminar capa
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
