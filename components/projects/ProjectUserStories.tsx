"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpenCheck,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Download,
  FileText,
  FileUp,
  Filter,
  Layers3,
  Loader2,
  Paperclip,
  PencilLine,
  Plus,
  Save,
  Search,
  Trash2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/backend";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  writeBatch,
} from "@/lib/supabase/document-store";
import { cn } from "@/lib/utils";
import { TaskDocumentsViewer } from "@/components/projects/TaskDocumentsViewer";
import {
  UserStoryImportDialog,
  type UserStoryImportApplyPayload,
} from "@/components/projects/UserStoryImportDialog";
import {
  getStoryVisualEvidenceDownloadUrl,
  StoryVisualEvidenceGallery,
  type StoryVisualEvidence,
} from "@/components/projects/StoryVisualEvidenceGallery";
import {
  ScrumStoryCatalogSelect,
  useScrumStoryCatalogCollection,
} from "@/components/projects/ScrumStoryCatalogSelect";
import {
  createScrumStoryCatalogEntry,
  normalizeScrumStoryCatalogLabel,
  type ScrumStoryCatalogType,
} from "@/lib/scrum-story-catalogs";

type StorySpecStatus = "draft" | "ready" | "approved" | "needs_changes";

type StoryCriterion = {
  id: string;
  title: string;
  category: string;
  given: string;
  when: string;
  then: string;
  statement: string;
};

type StoryField = {
  id: string;
  section: string;
  name: string;
  format: string;
  origin: string;
  behavior: string;
  required: boolean;
  editable: boolean;
};

type StoryRolePermission = {
  id: string;
  role: string;
  permissions: string[];
  responsibility: string;
};

type StorySourceImport = {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  importedAt: string;
  importedBy: string | null;
  importedByLabel: string;
  model: string;
  mode: "replace" | "fill_empty";
  warnings: string[];
  documentId?: string | null;
  storagePath?: string | null;
};

type ChecklistItem = {
  id: string;
  label: string;
  done: boolean;
};

type StorySpecDraft = {
  title: string;
  status: StorySpecStatus;
  narrative: {
    actor: string;
    wantTo: string;
    soThat: string;
    context: string;
  };
  scope: {
    included: string[];
    excluded: string[];
  };
  rolesAndPermissions: string;
  rolePermissions: StoryRolePermission[];
  acceptanceCriteria: StoryCriterion[];
  fieldMatrix: StoryField[];
  businessRules: string[];
  integrations: string[];
  notifications: string[];
  dependencies: string[];
  nonFunctionalRequirements: string[];
  traceabilityReferences: string[];
  definitionOfReady: ChecklistItem[];
  definitionOfDone: ChecklistItem[];
  primarySubmoduleId: string;
  impactedSubmoduleIds: string[];
  sourceImports: StorySourceImport[];
};

export type ProjectUserStoriesProps = {
  projectId: string;
  project?: any;
  stories: any[];
  releases: any[];
  epics: any[];
  groups: any[];
  sprints: any[];
  members: any[];
  currentUser: any;
  canManage?: boolean;
  canCreateItems?: boolean;
  canViewDocuments?: boolean;
  canUploadDocuments?: boolean;
  canManageDocumentAccess?: boolean;
  canDeleteDocuments?: boolean;
  focusedStoryId?: string;
  onCreateStory: () => void;
  onOpenCore: (story: any) => void;
};

const STATUS_OPTIONS: Array<{ value: StorySpecStatus; label: string; style: string }> = [
  { value: "draft", label: "Borrador", style: "border-slate-200 bg-slate-100 text-slate-700" },
  { value: "ready", label: "Lista para desarrollo", style: "border-blue-200 bg-blue-50 text-blue-700" },
  { value: "approved", label: "Aprobada", style: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  { value: "needs_changes", label: "Requiere ajustes", style: "border-amber-200 bg-amber-50 text-amber-800" },
];

const CRITERION_CATEGORIES = [
  { value: "functional", label: "Funcional" },
  { value: "business_rule", label: "Regla de negocio" },
  { value: "validation", label: "Validación" },
  { value: "permission", label: "Permiso" },
  { value: "notification", label: "Notificación" },
  { value: "integration", label: "Integración" },
  { value: "ui", label: "Interfaz" },
  { value: "other", label: "Otro" },
];

const DEFAULT_DOR: ChecklistItem[] = [
  { id: "dor-purpose", label: "El actor, la necesidad y el beneficio están claros.", done: false },
  { id: "dor-scope", label: "El alcance y lo que queda por fuera fueron acordados.", done: false },
  { id: "dor-criteria", label: "Los criterios de aceptación son verificables.", done: false },
  { id: "dor-dependencies", label: "Las dependencias y riesgos fueron identificados o descartados.", done: false },
  { id: "dor-estimate", label: "La historia tiene prioridad y estimación definidas.", done: false },
  { id: "dor-submodules", label: "El submódulo propietario y los impactos están confirmados.", done: false },
];

const DEFAULT_DOD: ChecklistItem[] = [
  { id: "dod-criteria", label: "Todos los criterios de aceptación fueron cumplidos.", done: false },
  { id: "dod-tests", label: "Las pruebas y la validación funcional fueron completadas.", done: false },
  { id: "dod-docs", label: "La documentación y la trazabilidad están actualizadas.", done: false },
  { id: "dod-defects", label: "No quedan defectos críticos abiertos.", done: false },
  { id: "dod-approval", label: "La entrega fue aprobada por el responsable.", done: false },
];

const STATUS_BY_VALUE = Object.fromEntries(STATUS_OPTIONS.map((option) => [option.value, option]));

const makeId = (prefix: string) => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const asText = (value: unknown) => (typeof value === "string" ? value : value == null ? "" : String(value));

const asTextList = (value: unknown) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item : asText(item?.label || item?.name || item?.statement)))
      .filter(Boolean);
  }
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
};

const uniqueIds = (values: unknown[]) =>
  Array.from(new Set(values.flatMap((value) => (Array.isArray(value) ? value : [value])).map(asText).filter(Boolean)));

const normalizeStatus = (value: unknown): StorySpecStatus => {
  const normalized = asText(value);
  return STATUS_OPTIONS.some((option) => option.value === normalized)
    ? (normalized as StorySpecStatus)
    : "draft";
};

const normalizeCriteria = (value: unknown, legacyAcceptanceCriteria: string): StoryCriterion[] => {
  if (Array.isArray(value) && value.length > 0) {
    return value.map((item: any, index) => ({
      id: asText(item?.id) || makeId(`criterion-${index + 1}`),
      title: asText(item?.title),
      category: asText(item?.category || item?.type) || "functional",
      given: asText(item?.given),
      when: asText(item?.when),
      then: asText(item?.then),
      statement: asText(item?.statement || item?.description),
    }));
  }

  if (legacyAcceptanceCriteria.trim()) {
    return [{
      id: "legacy-acceptance-criterion",
      title: "Criterio heredado",
      category: "functional",
      given: "",
      when: "",
      then: "",
      statement: legacyAcceptanceCriteria.trim(),
    }];
  }

  return [];
};

const normalizeFields = (value: unknown): StoryField[] => {
  if (!Array.isArray(value)) return [];
  return value.map((item: any, index) => ({
    id: asText(item?.id) || makeId(`field-${index + 1}`),
    section: asText(item?.section),
    name: asText(item?.name || item?.fieldName),
    format: asText(item?.format),
    origin: asText(item?.origin || item?.source),
    behavior: asText(item?.behavior || item?.observation),
    required: Boolean(item?.required),
    editable: item?.editable !== false,
  }));
};

const normalizeRolePermissions = (value: unknown): StoryRolePermission[] => {
  if (!Array.isArray(value)) return [];
  return value.map((item: any, index) => ({
    id: asText(item?.id) || makeId(`role-${index + 1}`),
    role: asText(item?.role || item?.name),
    permissions: asTextList(item?.permissions),
    responsibility: asText(item?.responsibility || item?.description),
  }));
};

const normalizeSourceImports = (value: unknown): StorySourceImport[] => {
  if (!Array.isArray(value)) return [];
  return value.map((item: any, index) => ({
    id: asText(item?.id) || `import-${index + 1}`,
    fileName: asText(item?.fileName),
    fileType: asText(item?.fileType),
    fileSize: Math.max(0, Number(item?.fileSize || 0)),
    importedAt: asText(item?.importedAt),
    importedBy: asText(item?.importedBy) || null,
    importedByLabel: asText(item?.importedByLabel),
    model: asText(item?.model),
    mode: (item?.mode === "fill_empty" ? "fill_empty" : "replace") as StorySourceImport["mode"],
    warnings: asTextList(item?.warnings),
    documentId: asText(item?.documentId) || null,
    storagePath: asText(item?.storagePath) || null,
  })).filter((item) => item.fileName);
};

const normalizeChecklist = (value: unknown, defaults: ChecklistItem[]): ChecklistItem[] => {
  if (!Array.isArray(value)) return defaults.map((item) => ({ ...item }));
  return value.map((item: any, index) => ({
    id: asText(item?.id) || makeId(`check-${index + 1}`),
    label: typeof item === "string" ? item : asText(item?.label || item?.text),
    done: typeof item === "string" ? false : Boolean(item?.done || item?.checked),
  }));
};

const getStoryGroupIds = (story: any, spec?: any) =>
  uniqueIds([
    story?.scrumSubmoduleIds,
    spec?.impactedSubmoduleIds,
    spec?.submoduleIds,
    spec?.primarySubmoduleId,
    story?.scrumGroupId,
  ]);

const createDraft = (story: any, spec?: any): StorySpecDraft => {
  const legacyCriteria = asText(story?.acceptanceCriteria);
  const primarySubmoduleId = asText(spec?.primarySubmoduleId || story?.scrumGroupId);
  const impactedSubmoduleIds = uniqueIds([
    spec?.impactedSubmoduleIds,
    spec?.submoduleIds,
    story?.scrumSubmoduleIds,
    primarySubmoduleId,
  ]);

  return {
    title: asText(spec?.title || story?.title || story?.name),
    status: normalizeStatus(spec?.status || spec?.storySpecStatus || story?.storySpecStatus),
    narrative: {
      actor: asText(spec?.narrative?.actor || spec?.actor || story?.actor),
      wantTo: asText(spec?.narrative?.wantTo || spec?.wantTo || story?.wantTo),
      soThat: asText(spec?.narrative?.soThat || spec?.soThat || story?.soThat),
      context: asText(spec?.narrative?.context || spec?.context || story?.description),
    },
    scope: {
      included: asTextList(spec?.scope?.included || spec?.scope?.inScope || spec?.inScope),
      excluded: asTextList(spec?.scope?.excluded || spec?.scope?.outOfScope || spec?.outOfScope),
    },
    rolesAndPermissions: asText(spec?.rolesAndPermissions || spec?.roles),
    rolePermissions: normalizeRolePermissions(spec?.rolePermissions || spec?.structuredRoles),
    acceptanceCriteria: normalizeCriteria(spec?.acceptanceCriteria || spec?.criteria, legacyCriteria),
    fieldMatrix: normalizeFields(spec?.fieldMatrix || spec?.fields),
    businessRules: asTextList(spec?.businessRules),
    integrations: asTextList(spec?.integrations),
    notifications: asTextList(spec?.notifications),
    dependencies: asTextList(spec?.dependencies),
    nonFunctionalRequirements: asTextList(spec?.nonFunctionalRequirements || spec?.nonFunctional),
    traceabilityReferences: asTextList(spec?.traceabilityReferences || spec?.references),
    definitionOfReady: normalizeChecklist(spec?.definitionOfReady, DEFAULT_DOR),
    definitionOfDone: normalizeChecklist(spec?.definitionOfDone, DEFAULT_DOD),
    primarySubmoduleId,
    impactedSubmoduleIds,
    sourceImports: normalizeSourceImports(spec?.sourceImports || spec?.importHistory),
  };
};

const getFilledCriterion = (criterion: StoryCriterion) =>
  Boolean(
    criterion.statement.trim()
      || (criterion.given.trim() && criterion.when.trim() && criterion.then.trim()),
  );

const getCompleteness = (draft: StorySpecDraft, story: any) => {
  const checks = [
    Boolean(draft.title.trim() || asText(story?.title || story?.name).trim()),
    Boolean(draft.narrative.actor.trim()),
    Boolean(draft.narrative.wantTo.trim()),
    Boolean(draft.narrative.soThat.trim()),
    Boolean(draft.narrative.context.trim()),
    Boolean(draft.primarySubmoduleId),
    draft.scope.included.some((item) => item.trim()),
    draft.rolePermissions.some((item) => item.role.trim() && (item.permissions.length > 0 || item.responsibility.trim()))
      || draft.rolesAndPermissions.trim().length > 0,
    draft.acceptanceCriteria.some(getFilledCriterion),
    draft.definitionOfReady.length > 0 && draft.definitionOfReady.every((item) => item.done),
    draft.definitionOfDone.length > 0 && draft.definitionOfDone.every((item) => item.done),
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
};

const deriveReadableAcceptanceCriteria = (criteria: StoryCriterion[]) =>
  criteria
    .filter(getFilledCriterion)
    .map((criterion, index) => {
      const category = CRITERION_CATEGORIES.find((item) => item.value === criterion.category)?.label;
      return [
        `${index + 1}. ${criterion.title.trim() || category || "Criterio de aceptación"}`,
        criterion.statement.trim(),
        criterion.given.trim() ? `Dado: ${criterion.given.trim()}` : "",
        criterion.when.trim() ? `Cuando: ${criterion.when.trim()}` : "",
        criterion.then.trim() ? `Entonces: ${criterion.then.trim()}` : "",
      ].filter(Boolean).join("\n");
    })
    .join("\n\n");

const getStoryCatalogCandidates = (draft: StorySpecDraft) => {
  const values: Array<{
    catalogType: ScrumStoryCatalogType;
    label: string;
    template?: Record<string, any>;
  }> = [];
  draft.rolePermissions.forEach((item) => {
    values.push({ catalogType: "role", label: item.role });
    item.permissions.forEach((permission) => values.push({ catalogType: "permission", label: permission }));
  });
  draft.acceptanceCriteria.forEach((criterion) => {
    const label = criterion.statement.trim() || criterion.title.trim();
    values.push({
      catalogType: "acceptance_criterion",
      label,
      template: {
        title: criterion.title,
        category: criterion.category,
        statement: criterion.statement,
        given: criterion.given,
        when: criterion.when,
        then: criterion.then,
        testCaseSeed: {
          precondition: criterion.given,
          action: criterion.when,
          expectedResult: criterion.then || criterion.statement,
        },
      },
    });
  });
  draft.fieldMatrix.forEach((field) => {
    values.push(
      { catalogType: "section", label: field.section },
      { catalogType: "field_name", label: field.name },
      { catalogType: "format", label: field.format },
      { catalogType: "origin", label: field.origin },
    );
  });

  const unique = new Map<string, { catalogType: ScrumStoryCatalogType; label: string; template?: Record<string, any> }>();
  values.forEach((entry) => {
    const label = entry.label.replace(/\s+/g, " ").trim();
    const normalized = normalizeScrumStoryCatalogLabel(label);
    if (!normalized) return;
    unique.set(`${entry.catalogType}:${normalized}`, { ...entry, label });
  });
  return Array.from(unique.values());
};

const mergeUniqueText = (...collections: string[][]) => {
  const values = new Map<string, string>();
  collections.flat().forEach((item) => {
    const clean = asText(item).replace(/\s+/g, " ").trim();
    const key = normalizeScrumStoryCatalogLabel(clean);
    if (key && !values.has(key)) values.set(key, clean);
  });
  return Array.from(values.values());
};

const mergeImportedRoles = (current: StoryRolePermission[], imported: StoryRolePermission[]) => {
  const merged = current.map((item) => ({ ...item, permissions: [...item.permissions] }));
  imported.forEach((entry) => {
    const roleKey = normalizeScrumStoryCatalogLabel(entry.role);
    const existing = roleKey
      ? merged.find((item) => normalizeScrumStoryCatalogLabel(item.role) === roleKey)
      : null;
    if (existing) {
      existing.permissions = mergeUniqueText(existing.permissions, entry.permissions);
      if (!existing.responsibility.trim()) existing.responsibility = entry.responsibility;
      return;
    }
    merged.push({ ...entry, id: makeId("role"), permissions: [...entry.permissions] });
  });
  return merged;
};

const mergeImportedCriteria = (current: StoryCriterion[], imported: StoryCriterion[]) => {
  const merged = current.map((item) => ({ ...item }));
  imported.forEach((entry) => {
    const candidateKeys = [
      entry.title,
      entry.statement,
      [entry.given, entry.when, entry.then].join(" "),
    ].map(normalizeScrumStoryCatalogLabel).filter(Boolean);
    const existing = merged.find((item) => {
      const existingKeys = [
        item.title,
        item.statement,
        [item.given, item.when, item.then].join(" "),
      ].map(normalizeScrumStoryCatalogLabel).filter(Boolean);
      return candidateKeys.some((key) => existingKeys.includes(key));
    });
    if (existing) {
      existing.title = existing.title.trim() || entry.title;
      existing.statement = existing.statement.trim() || entry.statement;
      existing.given = existing.given.trim() || entry.given;
      existing.when = existing.when.trim() || entry.when;
      existing.then = existing.then.trim() || entry.then;
      if (!existing.category || existing.category === "other") existing.category = entry.category;
      return;
    }
    merged.push({ ...entry, id: makeId("criterion") });
  });
  return merged;
};

const mergeImportedFields = (current: StoryField[], imported: StoryField[]) => {
  const merged = current.map((item) => ({ ...item }));
  imported.forEach((entry) => {
    const key = normalizeScrumStoryCatalogLabel(`${entry.section}:${entry.name || entry.behavior}`);
    const existing = key
      ? merged.find((item) => normalizeScrumStoryCatalogLabel(`${item.section}:${item.name || item.behavior}`) === key)
      : null;
    if (existing) {
      existing.section = existing.section.trim() || entry.section;
      existing.name = existing.name.trim() || entry.name;
      existing.format = existing.format.trim() || entry.format;
      existing.origin = existing.origin.trim() || entry.origin;
      existing.behavior = existing.behavior.trim() || entry.behavior;
      return;
    }
    merged.push({ ...entry, id: makeId("field") });
  });
  return merged;
};

const mergeImportedChecklist = (current: ChecklistItem[], imported: ChecklistItem[], prefix: string) => {
  const merged = current.map((item) => ({ ...item }));
  const keys = new Set(merged.map((item) => normalizeScrumStoryCatalogLabel(item.label)).filter(Boolean));
  imported.forEach((entry) => {
    const key = normalizeScrumStoryCatalogLabel(entry.label);
    if (!key || keys.has(key)) return;
    keys.add(key);
    merged.push({ id: makeId(prefix), label: entry.label, done: false });
  });
  return merged;
};

const applyImportedStoryDraft = (
  current: StorySpecDraft,
  payload: UserStoryImportApplyPayload,
): StorySpecDraft => {
  const imported = payload.result.draft;
  const importedRoles = normalizeRolePermissions(imported.rolePermissions);
  const importedCriteria = normalizeCriteria(imported.acceptanceCriteria, "")
    .map((item) => ({ ...item, id: makeId("criterion") }));
  const importedFields = normalizeFields(imported.fieldMatrix)
    .map((item) => ({ ...item, id: makeId("field") }));
  const importedDor = normalizeChecklist(imported.definitionOfReady, DEFAULT_DOR)
    .map((item) => ({ ...item, id: makeId("dor"), done: false }));
  const importedDod = normalizeChecklist(imported.definitionOfDone, DEFAULT_DOD)
    .map((item) => ({ ...item, id: makeId("dod"), done: false }));
  const importedPrimary = asText(imported.primarySubmoduleId);
  const importedImpacted = uniqueIds([imported.impactedSubmoduleIds, importedPrimary]);

  if (payload.mode === "replace") {
    const nextPrimarySubmoduleId = importedPrimary || current.primarySubmoduleId;
    return {
      ...current,
      title: payload.result.suggestedTitle || current.title,
      status: "draft",
      narrative: { ...imported.narrative },
      scope: {
        included: [...imported.scope.included],
        excluded: [...imported.scope.excluded],
      },
      rolesAndPermissions: imported.rolesAndPermissions,
      rolePermissions: importedRoles.map((item) => ({ ...item, id: makeId("role") })),
      acceptanceCriteria: importedCriteria,
      fieldMatrix: importedFields,
      businessRules: [...imported.businessRules],
      integrations: [...imported.integrations],
      notifications: [...imported.notifications],
      dependencies: [...imported.dependencies],
      nonFunctionalRequirements: [...imported.nonFunctionalRequirements],
      traceabilityReferences: [...imported.traceabilityReferences],
      definitionOfReady: importedDor,
      definitionOfDone: importedDod,
      primarySubmoduleId: nextPrimarySubmoduleId,
      impactedSubmoduleIds: uniqueIds([
        importedImpacted.length > 0 ? importedImpacted : current.impactedSubmoduleIds,
        nextPrimarySubmoduleId,
      ]),
    };
  }

  return {
    ...current,
    title: current.title.trim() || payload.result.suggestedTitle,
    status: "draft",
    narrative: {
      actor: current.narrative.actor.trim() || imported.narrative.actor,
      wantTo: current.narrative.wantTo.trim() || imported.narrative.wantTo,
      soThat: current.narrative.soThat.trim() || imported.narrative.soThat,
      context: current.narrative.context.trim() || imported.narrative.context,
    },
    scope: {
      included: mergeUniqueText(current.scope.included, imported.scope.included),
      excluded: mergeUniqueText(current.scope.excluded, imported.scope.excluded),
    },
    rolesAndPermissions: current.rolesAndPermissions.trim() || imported.rolesAndPermissions,
    rolePermissions: mergeImportedRoles(current.rolePermissions, importedRoles),
    acceptanceCriteria: mergeImportedCriteria(current.acceptanceCriteria, importedCriteria),
    fieldMatrix: mergeImportedFields(current.fieldMatrix, importedFields),
    businessRules: mergeUniqueText(current.businessRules, imported.businessRules),
    integrations: mergeUniqueText(current.integrations, imported.integrations),
    notifications: mergeUniqueText(current.notifications, imported.notifications),
    dependencies: mergeUniqueText(current.dependencies, imported.dependencies),
    nonFunctionalRequirements: mergeUniqueText(current.nonFunctionalRequirements, imported.nonFunctionalRequirements),
    traceabilityReferences: mergeUniqueText(current.traceabilityReferences, imported.traceabilityReferences),
    definitionOfReady: mergeImportedChecklist(current.definitionOfReady, importedDor, "dor"),
    definitionOfDone: mergeImportedChecklist(current.definitionOfDone, importedDod, "dod"),
    primarySubmoduleId: current.primarySubmoduleId || importedPrimary,
    impactedSubmoduleIds: uniqueIds([
      current.impactedSubmoduleIds,
      importedImpacted,
      current.primarySubmoduleId || importedPrimary,
    ]),
  };
};

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Ocurrió un error inesperado.";

const inputClassName =
  "min-h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="mb-1.5 block text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{children}</span>;
}

function TextField({
  label,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block min-w-0">
      <FieldLabel>{label}</FieldLabel>
      <input
        className={inputClassName}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        placeholder={placeholder}
      />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  disabled,
  placeholder,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <label className="block min-w-0">
      <FieldLabel>{label}</FieldLabel>
      <textarea
        className={cn(inputClassName, "resize-y leading-6")}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        rows={rows}
      />
    </label>
  );
}

function SectionBlock({
  title,
  description,
  icon,
  open,
  onToggle,
  children,
  badge,
}: {
  title: string;
  description?: string;
  icon: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
        onClick={onToggle}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-black text-slate-950">{title}</span>
          {description && <span className="mt-0.5 block text-xs leading-5 text-slate-500">{description}</span>}
        </span>
        {badge}
        <ChevronDown size={17} className={cn("shrink-0 text-slate-400 transition", open && "rotate-180")} />
      </button>
      {open && <div className="min-w-0 border-t border-slate-100 p-4">{children}</div>}
    </section>
  );
}

function StringListEditor({
  items,
  onChange,
  disabled,
  placeholder,
  addLabel = "Agregar elemento",
}: {
  items: string[];
  onChange: (items: string[]) => void;
  disabled?: boolean;
  placeholder: string;
  addLabel?: string;
}) {
  return (
    <div className="space-y-2">
      {items.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs font-semibold text-slate-500">
          Aún no hay elementos registrados.
        </div>
      )}
      {items.map((item, index) => (
        <div key={index} className="flex min-w-0 items-start gap-2">
          <span className="mt-2.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-black text-slate-600">
            {index + 1}
          </span>
          <textarea
            rows={2}
            className={cn(inputClassName, "min-w-0 flex-1 resize-y leading-5")}
            value={item}
            placeholder={placeholder}
            disabled={disabled}
            onChange={(event) => {
              const next = [...items];
              next[index] = event.target.value;
              onChange(next);
            }}
          />
          {!disabled && (
            <button
              type="button"
              className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
              onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
              aria-label={`Eliminar elemento ${index + 1}`}
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      ))}
      {!disabled && (
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...items, ""])}>
          <Plus size={14} className="mr-1.5" />
          {addLabel}
        </Button>
      )}
    </div>
  );
}

function ChecklistEditor({
  items,
  onChange,
  disabled,
}: {
  items: ChecklistItem[];
  onChange: (items: ChecklistItem[]) => void;
  disabled?: boolean;
}) {
  const completed = items.filter((item) => item.done).length;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 text-xs font-bold text-slate-500">
        <span>{completed} de {items.length} verificaciones</span>
        <span>{items.length ? Math.round((completed / items.length) * 100) : 0}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all"
          style={{ width: `${items.length ? (completed / items.length) * 100 : 0}%` }}
        />
      </div>
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={item.id} className="flex min-w-0 items-start gap-2 rounded-xl border border-slate-100 bg-slate-50 p-2.5">
            <input
              type="checkbox"
              className="mt-2 h-4 w-4 shrink-0 accent-emerald-600"
              checked={item.done}
              disabled={disabled}
              onChange={(event) => {
                const next = [...items];
                next[index] = { ...item, done: event.target.checked };
                onChange(next);
              }}
            />
            <input
              className="min-h-8 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 text-sm font-semibold text-slate-700 outline-none focus:border-slate-200 focus:bg-white disabled:text-slate-600"
              value={item.label}
              disabled={disabled}
              onChange={(event) => {
                const next = [...items];
                next[index] = { ...item, label: event.target.value };
                onChange(next);
              }}
            />
            {!disabled && (
              <button
                type="button"
                className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
                onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
                aria-label="Eliminar verificación"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
      {!disabled && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...items, { id: makeId("check"), label: "", done: false }])}
        >
          <Plus size={14} className="mr-1.5" />
          Agregar verificación
        </Button>
      )}
    </div>
  );
}

export function ProjectUserStories({
  projectId,
  project,
  stories,
  releases,
  epics,
  groups,
  sprints,
  members,
  currentUser,
  canManage = false,
  canCreateItems = false,
  canViewDocuments = false,
  canUploadDocuments = false,
  canManageDocumentAccess = false,
  canDeleteDocuments = false,
  focusedStoryId,
  onCreateStory,
  onOpenCore,
}: ProjectUserStoriesProps) {
  const storyCatalog = useScrumStoryCatalogCollection({ projectId });
  const [specsByStoryId, setSpecsByStoryId] = useState<Record<string, any>>({});
  const [loadingSpecs, setLoadingSpecs] = useState(true);
  const [selectedStoryId, setSelectedStoryId] = useState("");
  const lastAppliedFocusedStoryIdRef = useRef("");
  const [draftStoryId, setDraftStoryId] = useState("");
  const [draft, setDraft] = useState<StorySpecDraft | null>(null);
  const [editorBaseVersion, setEditorBaseVersion] = useState(0);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isDocumentsOpen, setIsDocumentsOpen] = useState(false);
  const [visualEvidence, setVisualEvidence] = useState<StoryVisualEvidence[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [releaseFilter, setReleaseFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [sprintFilter, setSprintFilter] = useState("all");
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    identification: true,
    narrative: true,
    planning: true,
    scope: false,
    roles: false,
    criteria: true,
    fields: false,
    rules: false,
    integrations: false,
    notifications: false,
    dependencies: false,
    nonFunctional: false,
    traceability: false,
    dor: true,
    dod: false,
  });

  useEffect(() => {
    setLoadingSpecs(true);
    const unsubscribe = onSnapshot(
      collection(db, "projects", projectId, "userStories"),
      (snapshot) => {
        setSpecsByStoryId(Object.fromEntries(snapshot.docs.map((snapshotDoc) => [
          snapshotDoc.id,
          { id: snapshotDoc.id, ...snapshotDoc.data() },
        ])));
        setLoadingSpecs(false);
      },
      (error) => {
        console.error("Error loading user story specifications:", error);
        toast.error("No se pudieron cargar los expedientes de las historias.");
        setLoadingSpecs(false);
      },
    );
    return () => unsubscribe();
  }, [projectId]);

  const releaseById = useMemo(() => new Map(releases.map((release) => [release.id, release])), [releases]);
  const epicById = useMemo(() => new Map(epics.map((epic) => [epic.id, epic])), [epics]);
  const groupById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  const sprintById = useMemo(() => new Map(sprints.map((sprint) => [sprint.id, sprint])), [sprints]);
  const memberById = useMemo(
    () => new Map(members.flatMap((member) => uniqueIds([member?.id, member?.uid, member?.userId]).map((id) => [id, member]))),
    [members],
  );

  const getStoryEpicId = useCallback((story: any) => {
    const sprint = sprintById.get(asText(story?.sprintId));
    const group = groupById.get(asText(story?.scrumGroupId || sprint?.scrumGroupId));
    return asText(story?.scrumEpicId || sprint?.scrumEpicId || group?.scrumEpicId);
  }, [groupById, sprintById]);

  const getStoryReleaseId = useCallback((story: any) => {
    const sprint = sprintById.get(asText(story?.sprintId));
    const group = groupById.get(asText(story?.scrumGroupId || sprint?.scrumGroupId));
    const epic = epicById.get(getStoryEpicId(story));
    return asText(story?.scrumReleaseId || sprint?.scrumReleaseId || group?.scrumReleaseId || epic?.scrumReleaseId);
  }, [epicById, getStoryEpicId, groupById, sprintById]);

  const getStoryStatus = useCallback(
    (story: any) => normalizeStatus(specsByStoryId[story.id]?.status || story?.storySpecStatus),
    [specsByStoryId],
  );

  const filteredStories = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("es");
    return [...stories]
      .filter((story) => {
        const spec = specsByStoryId[story.id];
        const groupIds = getStoryGroupIds(story, spec);
        const searchable = [
          story?.scrumCode,
          story?.title,
          story?.name,
          spec?.title,
          story?.description,
          story?.acceptanceCriteria,
          spec?.narrative?.actor,
          spec?.narrative?.wantTo,
          spec?.narrative?.soThat,
          ...groupIds.map((id) => groupById.get(id)?.name),
        ].map(asText).join(" ").toLocaleLowerCase("es");
        if (normalizedSearch && !searchable.includes(normalizedSearch)) return false;
        if (statusFilter !== "all" && getStoryStatus(story) !== statusFilter) return false;
        if (releaseFilter !== "all" && getStoryReleaseId(story) !== releaseFilter) return false;
        if (groupFilter !== "all" && !groupIds.includes(groupFilter)) return false;
        if (sprintFilter !== "all" && asText(story?.sprintId) !== sprintFilter) return false;
        return true;
      })
      .sort((left, right) => {
        const leftCode = asText(left?.scrumCode || left?.title || left?.name);
        const rightCode = asText(right?.scrumCode || right?.title || right?.name);
        return leftCode.localeCompare(rightCode, "es", { numeric: true });
      });
  }, [
    stories,
    specsByStoryId,
    search,
    statusFilter,
    releaseFilter,
    groupFilter,
    sprintFilter,
    groupById,
    getStoryReleaseId,
    getStoryStatus,
  ]);

  useEffect(() => {
    if (!focusedStoryId) {
      lastAppliedFocusedStoryIdRef.current = "";
      return;
    }
    if (
      lastAppliedFocusedStoryIdRef.current === focusedStoryId
      || !stories.some((story) => story.id === focusedStoryId)
    ) return;
    if (isDirty && selectedStoryId && selectedStoryId !== focusedStoryId) return;
    lastAppliedFocusedStoryIdRef.current = focusedStoryId;
    setSelectedStoryId(focusedStoryId);
  }, [focusedStoryId, stories, isDirty, selectedStoryId]);

  useEffect(() => {
    if (selectedStoryId && stories.some((story) => story.id === selectedStoryId)) return;
    setSelectedStoryId(filteredStories[0]?.id || stories[0]?.id || "");
  }, [filteredStories, selectedStoryId, stories]);

  const selectedStory = useMemo(
    () => stories.find((story) => story.id === selectedStoryId) || null,
    [stories, selectedStoryId],
  );
  const selectedStoryForDocuments = useMemo(
    () => selectedStory ? { ...selectedStory, projectId } : null,
    [projectId, selectedStory],
  );
  const selectedSpec = selectedStory ? specsByStoryId[selectedStory.id] : undefined;

  useEffect(() => {
    setIsDocumentsOpen(false);
    setIsImportOpen(false);
    setVisualEvidence([]);
  }, [selectedStoryId]);

  useEffect(() => {
    if (!selectedStory || loadingSpecs) {
      setDraftStoryId("");
      setDraft(null);
      setEditorBaseVersion(0);
      setIsDirty(false);
      return;
    }
    if (draftStoryId === selectedStory.id && isDirty) return;
    const nextDraft = createDraft(selectedStory, selectedSpec);
    setDraftStoryId(selectedStory.id);
    setDraft(nextDraft);
    setEditorBaseVersion(Math.max(Number(selectedSpec?.version || 0), Number(selectedStory?.storySpecVersion || 0)));
    setIsDirty(false);
  }, [selectedStory, selectedSpec, draftStoryId, isDirty, loadingSpecs]);

  const selectedEpicId = selectedStory ? getStoryEpicId(selectedStory) : "";
  const eligibleGroups = useMemo(
    () => groups
      .filter((group) => asText(group?.scrumEpicId) === selectedEpicId)
      .sort((left, right) => asText(left?.name).localeCompare(asText(right?.name), "es")),
    [groups, selectedEpicId],
  );
  const selectedEpic = epicById.get(selectedEpicId);
  const selectedRelease = selectedStory ? releaseById.get(getStoryReleaseId(selectedStory)) : null;
  const selectedSprint = selectedStory ? sprintById.get(asText(selectedStory?.sprintId)) : null;

  const visualSectionOptions = useMemo(() => Array.from(new Set([
    "Resumen y narrativa",
    "Alcance",
    "Roles y permisos",
    "Criterios de aceptación",
    "Matriz de campos",
    "Reglas de negocio",
    "Integraciones",
    "Notificaciones",
    "Dependencias",
    "Requisitos no funcionales",
    "Trazabilidad",
    ...(draft?.fieldMatrix || []).map((field) => field.section.trim()).filter(Boolean),
  ])), [draft?.fieldMatrix]);

  const catalogSelectorData = (catalogType: ScrumStoryCatalogType) => ({
    catalogEntries: storyCatalog.activeEntriesByType[catalogType],
    catalogLoading: storyCatalog.loading,
    catalogError: storyCatalog.error,
  });

  const liveCompleteness = draft && selectedStory ? getCompleteness(draft, selectedStory) : 0;
  const selectedMemberLabels = useMemo(() => {
    if (!selectedStory) return [];
    const ids = uniqueIds([
      selectedStory?.scrumAssigneeIds,
      selectedStory?.assignedUsers,
      selectedStory?.assignedTeamMembers,
      selectedStory?.assignedTo,
    ]);
    return ids.map((id) => {
      const member = memberById.get(id);
      return asText(member?.name || member?.displayName || member?.email) || id;
    });
  }, [selectedStory, memberById]);

  const changeDraft = (updater: (current: StorySpecDraft) => StorySpecDraft) => {
    setDraft((current) => current ? updater(current) : current);
    setIsDirty(true);
  };

  const chooseStory = (storyId: string) => {
    if (storyId === selectedStoryId || isSaving) return;
    if (isDirty && typeof window !== "undefined" && !window.confirm("Tienes cambios sin guardar. ¿Quieres descartarlos y abrir otra historia?")) {
      return;
    }
    setIsDirty(false);
    setSelectedStoryId(storyId);
  };

  const saveStorySpec = async () => {
    if (!selectedStory || !draft || !canManage || isSaving) return;

    const allowedGroupIds = new Set(eligibleGroups.map((group) => group.id));
    if (draft.primarySubmoduleId && !allowedGroupIds.has(draft.primarySubmoduleId)) {
      toast.warning("El submódulo propietario debe pertenecer a la misma épica de la historia.");
      return;
    }

    const impactedSubmoduleIds = uniqueIds([
      draft.primarySubmoduleId,
      draft.impactedSubmoduleIds.filter((id) => allowedGroupIds.has(id)),
    ]);
    const readyComplete = draft.definitionOfReady.length > 0 && draft.definitionOfReady.every((item) => item.done);
    const filledCriteria = draft.acceptanceCriteria.filter(getFilledCriterion);
    if ((draft.status === "ready" || draft.status === "approved") && (
      !draft.narrative.actor.trim()
      || !draft.narrative.wantTo.trim()
      || !draft.narrative.soThat.trim()
      || !draft.primarySubmoduleId
      || filledCriteria.length === 0
      || !readyComplete
    )) {
      toast.warning("Para declarar la historia lista o aprobada completa la narrativa, el submódulo, al menos un criterio y toda la Definition of Ready.");
      return;
    }

    setIsSaving(true);
    try {
      const specRef = doc(db, "projects", projectId, "userStories", selectedStory.id);
      const currentSnapshot = await getDoc(specRef);
      const currentSpec = currentSnapshot.exists() ? currentSnapshot.data() : null;
      const remoteVersion = Math.max(
        Number(currentSpec?.version || 0),
        Number(selectedStory?.storySpecVersion || 0),
      );
      if (currentSpec && remoteVersion !== editorBaseVersion) {
        toast.error("Otra persona actualizó esta historia. Recarga el expediente antes de guardar para no sobrescribir sus cambios.");
        return;
      }

      const nextVersion = remoteVersion + 1;
      const actorId = currentUser?.uid || currentUser?.id || null;
      const actorLabel = asText(currentUser?.displayName || currentUser?.name || currentUser?.email);
      const completeness = getCompleteness({ ...draft, impactedSubmoduleIds }, selectedStory);
      const normalizedDraft = {
        ...draft,
        title: draft.title.replace(/\s+/g, " ").trim(),
        scope: {
          included: draft.scope.included.map((item) => item.trim()).filter(Boolean),
          excluded: draft.scope.excluded.map((item) => item.trim()).filter(Boolean),
        },
        acceptanceCriteria: draft.acceptanceCriteria.map((criterion) => ({
          ...criterion,
          title: criterion.title.trim(),
          statement: criterion.statement.trim(),
          given: criterion.given.trim(),
          when: criterion.when.trim(),
          then: criterion.then.trim(),
        })),
        fieldMatrix: draft.fieldMatrix.map((field) => ({
          ...field,
          section: field.section.trim(),
          name: field.name.trim(),
          format: field.format.trim(),
          origin: field.origin.trim(),
          behavior: field.behavior.trim(),
        })),
        rolePermissions: draft.rolePermissions.map((item) => ({
          ...item,
          role: item.role.trim(),
          permissions: item.permissions.map((permission) => permission.trim()).filter(Boolean),
          responsibility: item.responsibility.trim(),
        })).filter((item) => item.role || item.permissions.length > 0 || item.responsibility),
        businessRules: draft.businessRules.map((item) => item.trim()).filter(Boolean),
        integrations: draft.integrations.map((item) => item.trim()).filter(Boolean),
        notifications: draft.notifications.map((item) => item.trim()).filter(Boolean),
        dependencies: draft.dependencies.map((item) => item.trim()).filter(Boolean),
        nonFunctionalRequirements: draft.nonFunctionalRequirements.map((item) => item.trim()).filter(Boolean),
        traceabilityReferences: draft.traceabilityReferences.map((item) => item.trim()).filter(Boolean),
        sourceImports: draft.sourceImports.map((item) => ({
          ...item,
          fileName: item.fileName.trim(),
          fileType: item.fileType.trim(),
          importedByLabel: item.importedByLabel.trim(),
          model: item.model.trim(),
          warnings: item.warnings.map((warning) => warning.trim()).filter(Boolean),
        })).filter((item) => item.fileName),
        definitionOfReady: draft.definitionOfReady.filter((item) => item.label.trim()).map((item) => ({ ...item, label: item.label.trim() })),
        definitionOfDone: draft.definitionOfDone.filter((item) => item.label.trim()).map((item) => ({ ...item, label: item.label.trim() })),
        primarySubmoduleId: draft.primarySubmoduleId,
        impactedSubmoduleIds,
      };
      const readableRolesAndPermissions = normalizedDraft.rolePermissions.length > 0
        ? normalizedDraft.rolePermissions.map((item) => [
            item.role || "Rol sin nombre",
            item.permissions.length > 0 ? `Permisos: ${item.permissions.join(", ")}` : "",
            item.responsibility,
          ].filter(Boolean).join(" - ")).join("\n")
        : draft.rolesAndPermissions.trim();
      const specPayload = {
        schemaVersion: 2,
        storyId: selectedStory.id,
        projectId,
        ...normalizedDraft,
        rolesAndPermissions: readableRolesAndPermissions,
        legacyRolesAndPermissions: currentSpec?.legacyRolesAndPermissions
          || (currentSpec?.rolePermissions?.length ? null : draft.rolesAndPermissions.trim())
          || null,
        primarySubmoduleId: normalizedDraft.primarySubmoduleId || null,
        version: nextVersion,
        completeness,
        legacyAcceptanceCriteria: currentSpec?.legacyAcceptanceCriteria || asText(selectedStory?.acceptanceCriteria) || null,
        createdAt: currentSpec?.createdAt || serverTimestamp(),
        createdBy: currentSpec?.createdBy || actorId,
        updatedAt: serverTimestamp(),
        updatedBy: actorId,
        updatedByLabel: actorLabel || null,
      };
      const revisionRef = doc(collection(db, "projects", projectId, "userStories", selectedStory.id, "revisions"));
      const readableAcceptanceCriteria = deriveReadableAcceptanceCriteria(normalizedDraft.acceptanceCriteria);

      const batch = writeBatch(db);
      batch.set(specRef, specPayload, { merge: true });
      batch.set(revisionRef, {
        storyId: selectedStory.id,
        projectId,
        version: nextVersion,
        snapshot: specPayload,
        createdAt: serverTimestamp(),
        createdBy: actorId,
        createdByLabel: actorLabel || null,
      });
      batch.update(doc(db, "projects", projectId, "tasks", selectedStory.id), {
        title: normalizedDraft.title || asText(selectedStory?.title || selectedStory?.name),
        actor: normalizedDraft.narrative.actor,
        wantTo: normalizedDraft.narrative.wantTo,
        soThat: normalizedDraft.narrative.soThat,
        acceptanceCriteria: readableAcceptanceCriteria,
        storySpecCompleteness: completeness,
        storySpecStatus: normalizedDraft.status,
        storySpecVersion: nextVersion,
        storySpecUpdatedAt: serverTimestamp(),
        storySpecUpdatedBy: actorId,
        scrumSubmoduleIds: impactedSubmoduleIds,
        scrumGroupId: normalizedDraft.primarySubmoduleId,
        updatedAt: serverTimestamp(),
      });
      await batch.commit();

      const catalogResults = await Promise.allSettled(
        getStoryCatalogCandidates(normalizedDraft).map((entry) => createScrumStoryCatalogEntry({
          projectId,
          catalogType: entry.catalogType,
          label: entry.label,
          template: entry.template,
          actor: currentUser,
        })),
      );
      const failedCatalogValues = catalogResults.filter((result) => result.status === "rejected").length;

      setSpecsByStoryId((current) => ({
        ...current,
        [selectedStory.id]: {
          ...current[selectedStory.id],
          ...specPayload,
          createdAt: currentSpec?.createdAt || new Date(),
          updatedAt: new Date(),
        },
      }));
      setEditorBaseVersion(nextVersion);
      setDraft(normalizedDraft);
      setIsDirty(false);
      toast.success(`Expediente guardado como versión ${nextVersion}.`);
      if (failedCatalogValues > 0) {
        toast.warning(`El expediente quedó guardado, pero ${failedCatalogValues} valor(es) no pudieron agregarse a los catálogos reutilizables.`);
      }
    } catch (error) {
      console.error("Error saving user story specification:", error);
      toast.error(`No se pudo guardar el expediente. ${getErrorMessage(error)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const applyImportedStory = async (payload: UserStoryImportApplyPayload) => {
    if (!selectedStory || !draft) throw new Error("Selecciona una historia antes de importar el documento.");

    const actorId = asText(currentUser?.uid || currentUser?.id) || null;
    const actorLabel = asText(currentUser?.displayName || currentUser?.name || currentUser?.email) || "Usuario de Pixel";
    const importedAt = new Date().toISOString();

    const sourceImport: StorySourceImport = {
      id: makeId("import"),
      fileName: payload.result.source.fileName || payload.file.name,
      fileType: payload.result.source.fileType || payload.file.type,
      fileSize: payload.result.source.fileSize || payload.file.size,
      importedAt,
      importedBy: actorId,
      importedByLabel: actorLabel,
      model: payload.result.model,
      mode: payload.mode,
      warnings: payload.result.warnings,
      documentId: null,
      storagePath: null,
    };

    setDraft((current) => {
      if (!current) return current;
      const applied = applyImportedStoryDraft(current, payload);
      return { ...applied, sourceImports: [...current.sourceImports, sourceImport] };
    });
    setIsDirty(true);
    setOpenSections((current) => ({
      ...current,
      identification: true,
      narrative: true,
      roles: true,
      criteria: true,
      fields: true,
      traceability: true,
    }));
    toast.success("Borrador aplicado. Revisa los campos y guarda la historia para conservar la trazabilidad de la importación.");
  };

  const generateStoryReport = async () => {
    if (!selectedStory || !draft || isGeneratingReport) return;
    setIsGeneratingReport(true);
    try {
      const submoduleNames = draft.impactedSubmoduleIds
        .map((id) => groupById.get(id)?.name || groupById.get(id)?.title || "")
        .filter(Boolean);
      const images = await Promise.all(visualEvidence.map(async (item) => {
        let url = item.previewUrl || item.url || "";
        try {
          url = await getStoryVisualEvidenceDownloadUrl(item);
        } catch (imageError) {
          console.warn("No se pudo autorizar una evidencia visual para el informe:", imageError);
        }
        return {
          name: item.fileName || item.name,
          caption: [item.section, item.caption || item.altText].filter(Boolean).join(" · "),
          url,
          contentType: item.contentType || undefined,
        };
      }));
      const { downloadUserStoryPdf } = await import("@/lib/user-story-report-pdf");
      const generated = await downloadUserStoryPdf({
        projectName: asText(project?.name || project?.title) || "Proyecto",
        organizationName: asText(project?.companyName || project?.organizationName || project?.clientName) || undefined,
        code: asText(selectedStory.scrumCode || selectedStory.id) || "HU",
        title: draft.title || asText(selectedStory.title || selectedStory.name) || "Historia de usuario",
        status: isDirty ? "Borrador sin guardar" : STATUS_BY_VALUE[draft.status]?.label || draft.status,
        isDraft: isDirty,
        version: isDirty ? undefined : editorBaseVersion,
        generatedAt: new Date(),
        updatedAt: isDirty ? undefined : selectedSpec?.updatedAt?.toDate?.() || selectedSpec?.updatedAt || undefined,
        updatedBy: isDirty ? "" : asText(selectedSpec?.updatedByLabel),
        releaseName: asText(selectedRelease?.name || selectedRelease?.title),
        epicName: asText(selectedEpic?.title || selectedEpic?.name),
        submoduleNames,
        sprintName: asText(selectedSprint?.name || selectedSprint?.title),
        responsibleNames: selectedMemberLabels,
        narrative: draft.narrative,
        scope: draft.scope,
        roles: draft.rolePermissions,
        rolesAndPermissions: draft.rolesAndPermissions,
        acceptanceCriteria: draft.acceptanceCriteria,
        fieldMatrix: draft.fieldMatrix,
        businessRules: draft.businessRules,
        integrations: draft.integrations,
        notifications: draft.notifications,
        dependencies: draft.dependencies,
        nonFunctionalRequirements: draft.nonFunctionalRequirements,
        traceabilityReferences: [
          ...draft.traceabilityReferences,
          ...draft.sourceImports.map((item) => [
            `Importación IA: ${item.fileName}`,
            item.importedAt ? `fecha ${item.importedAt}` : "",
            item.importedByLabel ? `por ${item.importedByLabel}` : "",
            item.mode === "fill_empty" ? "modo completar vacíos" : "modo reemplazar borrador",
          ].filter(Boolean).join(" · ")),
        ],
        definitionOfReady: draft.definitionOfReady,
        definitionOfDone: draft.definitionOfDone,
        images,
      });
      toast.success("Informe de la historia generado.");
      if (isDirty) toast.info("El informe incluye los cambios que todavía no has guardado.");
      if (generated.warnings.length > 0) {
        toast.warning(`${generated.warnings.length} imagen(es) no pudieron incorporarse al informe.`);
      }
    } catch (error) {
      console.error("Error generating user story report:", error);
      toast.error(`No se pudo generar el informe. ${getErrorMessage(error)}`);
    } finally {
      setIsGeneratingReport(false);
    }
  };

  const toggleSection = (section: string) => {
    setOpenSections((current) => ({ ...current, [section]: !current[section] }));
  };

  const filterSelectClass = "h-10 min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100";

  return (
    <>
    <section className="min-w-0 overflow-x-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm">
      <header className="border-b border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.16em] text-violet-700">
              <BookOpenCheck size={15} />
              Producto refinado
            </div>
            <h2 className="text-xl font-black text-slate-950">Historias de usuario</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
              Expedientes funcionales completos, separados de la ejecución del tablero y vinculados a su arquitectura.
            </p>
          </div>
          {canCreateItems && (
            <Button type="button" onClick={onCreateStory} className="shrink-0 bg-violet-600 hover:bg-violet-700">
              <Plus size={16} className="mr-2" />
              Nueva historia
            </Button>
          )}
        </div>

        <div className="mt-4 grid min-w-0 gap-2 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.6fr)_repeat(4,minmax(145px,0.8fr))]">
          <label className="relative min-w-0">
            <Search size={16} className="pointer-events-none absolute left-3 top-3 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className={cn(filterSelectClass, "w-full pl-9")}
              placeholder="Buscar código, título, actor o criterio..."
              aria-label="Buscar historias"
            />
          </label>
          <select className={filterSelectClass} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filtrar por estado documental">
            <option value="all">Todos los estados</option>
            {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <select className={filterSelectClass} value={releaseFilter} onChange={(event) => setReleaseFilter(event.target.value)} aria-label="Filtrar por Release">
            <option value="all">Todos los Releases</option>
            {releases.map((release) => <option key={release.id} value={release.id}>{release.name || release.title || release.id}</option>)}
          </select>
          <select className={filterSelectClass} value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)} aria-label="Filtrar por submódulo">
            <option value="all">Todos los submódulos</option>
            {groups.map((group) => <option key={group.id} value={group.id}>{group.name || group.id}</option>)}
          </select>
          <select className={filterSelectClass} value={sprintFilter} onChange={(event) => setSprintFilter(event.target.value)} aria-label="Filtrar por sprint">
            <option value="all">Todos los sprints</option>
            {sprints.map((sprint) => <option key={sprint.id} value={sprint.id}>{sprint.name || sprint.id}</option>)}
          </select>
        </div>
      </header>

      <div className="grid min-w-0 gap-0 lg:grid-cols-[minmax(280px,0.34fr)_minmax(0,1fr)]">
        <aside className="min-w-0 border-b border-slate-200 bg-white lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-slate-600">
              <Filter size={14} />
              Catálogo
            </div>
            <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-black text-slate-600">
              {filteredStories.length}
            </span>
          </div>
          <div className="max-h-[72vh] space-y-2 overflow-y-auto p-3">
            {loadingSpecs && stories.length > 0 && (
              <div className="flex items-center justify-center gap-2 py-8 text-sm font-semibold text-slate-500">
                <Loader2 size={17} className="animate-spin" />
                Cargando expedientes...
              </div>
            )}
            {!loadingSpecs && filteredStories.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
                <FileText size={28} className="mx-auto text-slate-300" />
                <p className="mt-3 text-sm font-black text-slate-700">Sin historias para estos filtros</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">Las historias aparecen aquí después del grooming.</p>
              </div>
            )}
            {filteredStories.map((story) => {
              const spec = specsByStoryId[story.id];
              const status = getStoryStatus(story);
              const statusOption = STATUS_BY_VALUE[status];
              const completeness = Number(spec?.completeness ?? story?.storySpecCompleteness ?? 0);
              const storyGroups = getStoryGroupIds(story, spec).map((id) => groupById.get(id)).filter(Boolean);
              return (
                <button
                  key={story.id}
                  type="button"
                  disabled={isSaving}
                  onClick={() => chooseStory(story.id)}
                  className={cn(
                    "w-full min-w-0 rounded-2xl border p-3 text-left transition",
                    selectedStoryId === story.id
                      ? "border-violet-300 bg-violet-50 shadow-sm ring-1 ring-violet-100"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                  )}
                >
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <span className="rounded-md bg-slate-950 px-2 py-1 text-[10px] font-black tracking-[0.12em] text-white">
                      {story.scrumCode || "HU"}
                    </span>
                    <span className={cn("rounded-full border px-2 py-1 text-[10px] font-black", statusOption.style)}>
                      {statusOption.label}
                    </span>
                  </div>
                  <h3 className="mt-2 break-words text-sm font-black leading-5 text-slate-950">{spec?.title || story.title || story.name || "Historia sin título"}</h3>
                  <p className="mt-1 line-clamp-2 break-words text-xs leading-5 text-slate-500">
                    {spec?.narrative?.wantTo || story.description || "Sin narrativa documentada."}
                  </p>
                  <div className="mt-3 flex min-w-0 flex-wrap gap-1.5">
                    {storyGroups.slice(0, 2).map((group: any) => (
                      <span key={group.id} className="max-w-full truncate rounded-md bg-cyan-50 px-2 py-1 text-[10px] font-bold text-cyan-800">{group.name}</span>
                    ))}
                    {storyGroups.length > 2 && <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">+{storyGroups.length - 2}</span>}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.min(100, Math.max(0, completeness))}%` }} />
                    </div>
                    <span className="shrink-0 text-[10px] font-black text-slate-500">{completeness}%</span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <article className="min-w-0 overflow-x-hidden bg-slate-50">
          {!selectedStory || !draft ? (
            <div className="flex min-h-[420px] items-center justify-center p-8 text-center">
              <div>
                <BookOpenCheck size={38} className="mx-auto text-slate-300" />
                <h3 className="mt-3 text-lg font-black text-slate-800">Selecciona una historia</h3>
                <p className="mt-1 text-sm text-slate-500">Su expediente funcional aparecerá en este panel.</p>
              </div>
            </div>
          ) : (
            <div className="min-w-0">
              <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-5">
                <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="rounded-md bg-violet-600 px-2 py-1 text-[10px] font-black tracking-[0.14em] text-white">{selectedStory.scrumCode || "HU"}</span>
                      <span className={cn("rounded-full border px-2 py-1 text-[10px] font-black", STATUS_BY_VALUE[draft.status].style)}>{STATUS_BY_VALUE[draft.status].label}</span>
                      {isDirty && <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-700">Cambios sin guardar</span>}
                    </div>
                    <h3 className="mt-2 break-words text-lg font-black leading-6 text-slate-950">{draft.title || selectedStory.title || selectedStory.name}</h3>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {canManage && (
                      <Button type="button" variant="outline" onClick={() => setIsImportOpen(true)} disabled={isSaving} className="border-violet-200 text-violet-700 hover:bg-violet-50 hover:text-violet-800">
                        <FileUp size={15} className="mr-2" />
                        Importar con IA
                      </Button>
                    )}
                    <Button type="button" variant="outline" onClick={() => void generateStoryReport()} disabled={isGeneratingReport || isSaving}>
                      {isGeneratingReport ? <Loader2 size={15} className="mr-2 animate-spin" /> : <Download size={15} className="mr-2" />}
                      {isGeneratingReport ? "Generando..." : "Generar informe"}
                    </Button>
                    {canViewDocuments && (
                      <Button type="button" variant="outline" onClick={() => setIsDocumentsOpen(true)} disabled={isSaving}>
                        <Paperclip size={15} className="mr-2" />
                        Documentos
                      </Button>
                    )}
                    <Button type="button" variant="outline" onClick={() => onOpenCore(selectedStory)} disabled={!canManage || isSaving}>
                      <PencilLine size={15} className="mr-2" />
                      Editar planificación
                    </Button>
                    <Button type="button" onClick={saveStorySpec} disabled={!canManage || !isDirty || isSaving} className="bg-violet-600 hover:bg-violet-700">
                      {isSaving ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Save size={16} className="mr-2" />}
                      {isSaving ? "Guardando..." : "Guardar expediente"}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="min-w-0 space-y-3 p-3 sm:p-5">
                <div className="grid min-w-0 gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-slate-200 bg-white p-3">
                    <span className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Completitud documental</span>
                    <div className="mt-2 flex items-end justify-between gap-2">
                      <strong className="text-2xl font-black text-slate-950">{liveCompleteness}%</strong>
                      <ClipboardCheck size={21} className="text-violet-600" />
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-violet-600" style={{ width: `${liveCompleteness}%` }} /></div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-3">
                    <span className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Versión</span>
                    <div className="mt-2 text-2xl font-black text-slate-950">v{editorBaseVersion || 0}</div>
                    <p className="mt-1 text-xs text-slate-500">Cada guardado genera una revisión.</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-3">
                    <span className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Arquitectura</span>
                    <div className="mt-2 truncate text-sm font-black text-slate-950">{selectedEpic?.title || selectedEpic?.name || "Sin épica"}</div>
                    <p className="mt-1 truncate text-xs text-slate-500">{selectedRelease?.name || selectedRelease?.title || "Sin Release"}</p>
                  </div>
                </div>

                {!selectedSpec && (
                  <div className="flex min-w-0 items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                    <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                    <p className="min-w-0 leading-6">
                      Esta historia usa datos heredados de la tarea. El expediente todavía no existe y no se creará hasta que pulses <strong>Guardar expediente</strong>.
                    </p>
                  </div>
                )}

                <SectionBlock
                  title="Identificación y versión"
                  description="Estado documental y contexto de planificación actual."
                  icon={<FileText size={18} />}
                  open={openSections.identification}
                  onToggle={() => toggleSection("identification")}
                >
                  <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="min-w-0 rounded-xl bg-slate-50 p-3">
                      <FieldLabel>Código</FieldLabel>
                      <p className="break-words text-sm font-black text-slate-900">{selectedStory.scrumCode || selectedStory.id}</p>
                    </div>
                    <label className="block min-w-0">
                      <FieldLabel>Estado del expediente</FieldLabel>
                      <select
                        className={inputClassName}
                        value={draft.status}
                        disabled={!canManage}
                        onChange={(event) => changeDraft((current) => ({ ...current, status: event.target.value as StorySpecStatus }))}
                      >
                        {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <div className="min-w-0 md:col-span-2 xl:col-span-2">
                      <TextField
                        label="Título de la historia"
                        value={draft.title}
                        disabled={!canManage}
                        placeholder="Resultado funcional esperado"
                        onChange={(value) => changeDraft((current) => ({ ...current, title: value }))}
                      />
                    </div>
                    <div className="min-w-0 rounded-xl bg-slate-50 p-3">
                      <FieldLabel>Sprint</FieldLabel>
                      <p className="break-words text-sm font-black text-slate-900">{selectedSprint?.name || "Sin planificar"}</p>
                    </div>
                    <div className="min-w-0 rounded-xl bg-slate-50 p-3">
                      <FieldLabel>Responsables</FieldLabel>
                      <p className="break-words text-sm font-black text-slate-900">{selectedMemberLabels.join(", ") || "Sin asignar"}</p>
                    </div>
                  </div>
                </SectionBlock>

                <SectionBlock
                  title="Narrativa de la historia"
                  description="Quién necesita qué resultado, para qué y bajo qué contexto."
                  icon={<UserRound size={18} />}
                  open={openSections.narrative}
                  onToggle={() => toggleSection("narrative")}
                  badge={draft.narrative.actor && draft.narrative.wantTo && draft.narrative.soThat ? <CheckCircle2 size={17} className="shrink-0 text-emerald-600" /> : undefined}
                >
                  <div className="grid min-w-0 gap-3 lg:grid-cols-3">
                    <TextAreaField label="Como / actor" value={draft.narrative.actor} disabled={!canManage} rows={3} placeholder="Como responsable de..." onChange={(value) => changeDraft((current) => ({ ...current, narrative: { ...current.narrative, actor: value } }))} />
                    <TextAreaField label="Quiero" value={draft.narrative.wantTo} disabled={!canManage} rows={3} placeholder="Quiero poder..." onChange={(value) => changeDraft((current) => ({ ...current, narrative: { ...current.narrative, wantTo: value } }))} />
                    <TextAreaField label="Para qué" value={draft.narrative.soThat} disabled={!canManage} rows={3} placeholder="Para lograr..." onChange={(value) => changeDraft((current) => ({ ...current, narrative: { ...current.narrative, soThat: value } }))} />
                  </div>
                  <div className="mt-3">
                    <TextAreaField label="Contexto y función" value={draft.narrative.context} disabled={!canManage} rows={4} placeholder="Describe el problema, el entorno y la función esperada." onChange={(value) => changeDraft((current) => ({ ...current, narrative: { ...current.narrative, context: value } }))} />
                  </div>
                </SectionBlock>

                <SectionBlock
                  title="Submódulos relacionados"
                  description="Una historia tiene un propietario y puede impactar varios submódulos de la misma épica."
                  icon={<Layers3 size={18} />}
                  open={openSections.planning}
                  onToggle={() => toggleSection("planning")}
                >
                  {!selectedEpicId ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">Vincula primero la historia a una épica desde Editar planificación.</div>
                  ) : eligibleGroups.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-500">Esta épica aún no tiene submódulos.</div>
                  ) : (
                    <div className="grid min-w-0 gap-4 lg:grid-cols-2">
                      <label className="block min-w-0">
                        <FieldLabel>Submódulo propietario</FieldLabel>
                        <select
                          className={inputClassName}
                          value={draft.primarySubmoduleId}
                          disabled={!canManage}
                          onChange={(event) => {
                            const primaryId = event.target.value;
                            changeDraft((current) => ({
                              ...current,
                              primarySubmoduleId: primaryId,
                              impactedSubmoduleIds: uniqueIds([current.impactedSubmoduleIds, primaryId]),
                            }));
                          }}
                        >
                          <option value="">Selecciona un submódulo</option>
                          {eligibleGroups.map((group) => <option key={group.id} value={group.id}>{group.name || group.id}</option>)}
                        </select>
                        <p className="mt-2 text-xs leading-5 text-slate-500">Este vínculo conserva la compatibilidad con el tablero y la planificación del sprint.</p>
                      </label>
                      <div className="min-w-0">
                        <FieldLabel>Submódulos impactados</FieldLabel>
                        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                          {eligibleGroups.map((group) => {
                            const checked = draft.impactedSubmoduleIds.includes(group.id) || draft.primarySubmoduleId === group.id;
                            const isPrimary = draft.primarySubmoduleId === group.id;
                            return (
                              <label key={group.id} className="flex min-w-0 items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                                <input
                                  type="checkbox"
                                  className="mt-0.5 h-4 w-4 shrink-0 accent-violet-600"
                                  checked={checked}
                                  disabled={!canManage || isPrimary}
                                  onChange={(event) => changeDraft((current) => ({
                                    ...current,
                                    impactedSubmoduleIds: event.target.checked
                                      ? uniqueIds([current.impactedSubmoduleIds, group.id])
                                      : current.impactedSubmoduleIds.filter((id) => id !== group.id),
                                  }))}
                                />
                                <span className="min-w-0 break-words text-sm font-bold text-slate-700">
                                  {group.name || group.id}
                                  {isPrimary && <span className="ml-1 text-[10px] font-black uppercase text-violet-700">Propietario</span>}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </SectionBlock>

                <SectionBlock title="Alcance" description="Qué resuelve esta historia y qué queda expresamente por fuera." icon={<Filter size={18} />} open={openSections.scope} onToggle={() => toggleSection("scope")}>
                  <div className="grid min-w-0 gap-4 lg:grid-cols-2">
                    <div className="min-w-0"><FieldLabel>Incluido</FieldLabel><StringListEditor items={draft.scope.included} disabled={!canManage} placeholder="Resultado, caso o comportamiento incluido..." addLabel="Agregar al alcance" onChange={(items) => changeDraft((current) => ({ ...current, scope: { ...current.scope, included: items } }))} /></div>
                    <div className="min-w-0"><FieldLabel>Fuera de alcance</FieldLabel><StringListEditor items={draft.scope.excluded} disabled={!canManage} placeholder="Resultado, caso o comportamiento excluido..." addLabel="Agregar exclusión" onChange={(items) => changeDraft((current) => ({ ...current, scope: { ...current.scope, excluded: items } }))} /></div>
                  </div>
                </SectionBlock>

                <SectionBlock title="Roles y permisos" description="Roles reutilizables con sus permisos y responsabilidad concreta dentro de la historia." icon={<UserRound size={18} />} open={openSections.roles} onToggle={() => toggleSection("roles")} badge={<span className="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-black text-violet-700">{draft.rolePermissions.length}</span>}>
                  <div className="space-y-3">
                    {draft.rolePermissions.length === 0 && (
                      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-sm font-semibold text-slate-500">
                        Agrega los actores de la historia y selecciona exactamente qué puede hacer cada uno.
                      </div>
                    )}
                    {draft.rolePermissions.map((roleEntry, index) => (
                      <div key={roleEntry.id} className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <strong className="text-sm font-black text-slate-900">Rol asociado {index + 1}</strong>
                          {canManage && (
                            <button
                              type="button"
                              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
                              onClick={() => changeDraft((current) => ({
                                ...current,
                                rolePermissions: current.rolePermissions.filter((item) => item.id !== roleEntry.id),
                              }))}
                              aria-label={`Eliminar rol ${index + 1}`}
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                        <div className="grid min-w-0 gap-3 lg:grid-cols-2">
                          <ScrumStoryCatalogSelect
                            {...catalogSelectorData("role")}
                            projectId={projectId}
                            catalogType="role"
                            label="Rol"
                            value={roleEntry.role}
                            onChange={(value) => changeDraft((current) => ({
                              ...current,
                              rolePermissions: current.rolePermissions.map((item) => item.id === roleEntry.id ? { ...item, role: value } : item),
                            }))}
                            currentUser={currentUser}
                            disabled={!canManage}
                            canCreate={canManage}
                            placeholder="Selecciona o crea un rol"
                          />
                          <ScrumStoryCatalogSelect
                            {...catalogSelectorData("permission")}
                            projectId={projectId}
                            catalogType="permission"
                            label="Permisos asociados"
                            multiple
                            value={roleEntry.permissions}
                            onChange={(permissions) => changeDraft((current) => ({
                              ...current,
                              rolePermissions: current.rolePermissions.map((item) => item.id === roleEntry.id ? { ...item, permissions } : item),
                            }))}
                            currentUser={currentUser}
                            disabled={!canManage}
                            canCreate={canManage}
                            placeholder="Agregar un permiso"
                          />
                        </div>
                        <div className="mt-3">
                          <TextAreaField
                            label="Responsabilidad y límites"
                            value={roleEntry.responsibility}
                            disabled={!canManage}
                            rows={2}
                            placeholder="Qué responsabilidad tiene este rol y bajo qué condiciones actúa."
                            onChange={(value) => changeDraft((current) => ({
                              ...current,
                              rolePermissions: current.rolePermissions.map((item) => item.id === roleEntry.id ? { ...item, responsibility: value } : item),
                            }))}
                          />
                        </div>
                      </div>
                    ))}
                    {canManage && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => changeDraft((current) => ({
                          ...current,
                          rolePermissions: [...current.rolePermissions, {
                            id: makeId("role"),
                            role: "",
                            permissions: [],
                            responsibility: "",
                          }],
                        }))}
                      >
                        <Plus size={14} className="mr-1.5" />
                        Agregar rol y permisos
                      </Button>
                    )}
                    {draft.rolePermissions.length === 0 && draft.rolesAndPermissions.trim() && (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                        <p className="text-xs font-black uppercase tracking-[0.12em] text-amber-800">Información heredada conservada</p>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-amber-900">{draft.rolesAndPermissions}</p>
                        <p className="mt-2 text-xs font-semibold text-amber-700">Convierte esta información agregando arriba cada rol y sus permisos. El texto original permanecerá en la trazabilidad.</p>
                      </div>
                    )}
                  </div>
                </SectionBlock>

                <SectionBlock title="Criterios de aceptación" description="Criterios reutilizables en lenguaje libre o Given / When / Then, preparados como base de futuros casos de prueba." icon={<ClipboardCheck size={18} />} open={openSections.criteria} onToggle={() => toggleSection("criteria")} badge={<span className="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-black text-violet-700">{draft.acceptanceCriteria.length}</span>}>
                  <div className="space-y-3">
                    {canManage && (
                      <div className="rounded-2xl border border-violet-100 bg-violet-50/60 p-3">
                        <ScrumStoryCatalogSelect
                          {...catalogSelectorData("acceptance_criterion")}
                          projectId={projectId}
                          catalogType="acceptance_criterion"
                          label="Reutilizar criterio del proyecto"
                          description="Selecciona uno existente o crea una plantilla para incorporarla a esta historia."
                          value=""
                          onChange={() => undefined}
                          onEntrySelected={(entry) => changeDraft((current) => {
                            const template = entry.template || {};
                            return {
                              ...current,
                              acceptanceCriteria: [
                                ...current.acceptanceCriteria,
                                {
                                  id: makeId("criterion"),
                                  title: asText(template.title) || (entry.label.length <= 90 ? entry.label : "Criterio reutilizado"),
                                  category: CRITERION_CATEGORIES.some((item) => item.value === template.category)
                                    ? asText(template.category)
                                    : "functional",
                                  given: asText(template.given),
                                  when: asText(template.when),
                                  then: asText(template.then),
                                  statement: asText(template.statement) || entry.label,
                                },
                              ],
                            };
                          })}
                          currentUser={currentUser}
                          canCreate
                          placeholder="Selecciona un criterio reutilizable"
                          createPlaceholder="Nuevo criterio verificable"
                        />
                      </div>
                    )}
                    {draft.acceptanceCriteria.length === 0 && <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-sm font-semibold text-slate-500">Agrega el primer criterio verificable.</div>}
                    {draft.acceptanceCriteria.map((criterion, index) => (
                      <div key={criterion.id} className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <strong className="text-sm font-black text-slate-900">Criterio {index + 1}</strong>
                          {canManage && <button type="button" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => changeDraft((current) => ({ ...current, acceptanceCriteria: current.acceptanceCriteria.filter((item) => item.id !== criterion.id) }))} aria-label={`Eliminar criterio ${index + 1}`}><Trash2 size={15} /></button>}
                        </div>
                        <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(160px,0.7fr)]">
                          <TextField label="Título" value={criterion.title} disabled={!canManage} placeholder="Ej. Guardado con validación" onChange={(value) => changeDraft((current) => ({ ...current, acceptanceCriteria: current.acceptanceCriteria.map((item) => item.id === criterion.id ? { ...item, title: value } : item) }))} />
                          <label className="block min-w-0"><FieldLabel>Categoría</FieldLabel><select className={inputClassName} value={criterion.category} disabled={!canManage} onChange={(event) => changeDraft((current) => ({ ...current, acceptanceCriteria: current.acceptanceCriteria.map((item) => item.id === criterion.id ? { ...item, category: event.target.value } : item) }))}>{CRITERION_CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select></label>
                        </div>
                        <div className="mt-3"><TextAreaField label="Enunciado verificable" value={criterion.statement} disabled={!canManage} rows={2} placeholder="El sistema debe..." onChange={(value) => changeDraft((current) => ({ ...current, acceptanceCriteria: current.acceptanceCriteria.map((item) => item.id === criterion.id ? { ...item, statement: value } : item) }))} /></div>
                        <div className="mt-3 grid min-w-0 gap-3 lg:grid-cols-3">
                          <TextAreaField label="Dado / Given" value={criterion.given} disabled={!canManage} rows={2} placeholder="Dado que..." onChange={(value) => changeDraft((current) => ({ ...current, acceptanceCriteria: current.acceptanceCriteria.map((item) => item.id === criterion.id ? { ...item, given: value } : item) }))} />
                          <TextAreaField label="Cuando / When" value={criterion.when} disabled={!canManage} rows={2} placeholder="Cuando..." onChange={(value) => changeDraft((current) => ({ ...current, acceptanceCriteria: current.acceptanceCriteria.map((item) => item.id === criterion.id ? { ...item, when: value } : item) }))} />
                          <TextAreaField label="Entonces / Then" value={criterion.then} disabled={!canManage} rows={2} placeholder="Entonces..." onChange={(value) => changeDraft((current) => ({ ...current, acceptanceCriteria: current.acceptanceCriteria.map((item) => item.id === criterion.id ? { ...item, then: value } : item) }))} />
                        </div>
                      </div>
                    ))}
                    {canManage && <Button type="button" variant="outline" size="sm" onClick={() => changeDraft((current) => ({ ...current, acceptanceCriteria: [...current.acceptanceCriteria, { id: makeId("criterion"), title: "", category: "functional", given: "", when: "", then: "", statement: "" }] }))}><Plus size={14} className="mr-1.5" />Agregar criterio</Button>}
                  </div>
                </SectionBlock>

                <SectionBlock title="Matriz de campos" description="Campos, formatos, fuentes, comportamiento y permisos de edición." icon={<FileText size={18} />} open={openSections.fields} onToggle={() => toggleSection("fields")} badge={<span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-600">{draft.fieldMatrix.length}</span>}>
                  <div className="space-y-3">
                    {draft.fieldMatrix.length === 0 && <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-sm font-semibold text-slate-500">Aún no hay campos documentados.</div>}
                    {draft.fieldMatrix.map((field, index) => (
                      <div key={field.id} className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <div className="mb-3 flex items-center justify-between gap-2"><strong className="text-sm font-black text-slate-900">Campo {index + 1}</strong>{canManage && <button type="button" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => changeDraft((current) => ({ ...current, fieldMatrix: current.fieldMatrix.filter((item) => item.id !== field.id) }))} aria-label={`Eliminar campo ${index + 1}`}><Trash2 size={15} /></button>}</div>
                        <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-4">
                          <ScrumStoryCatalogSelect {...catalogSelectorData("section")} projectId={projectId} catalogType="section" label="Sección" value={field.section} disabled={!canManage} canCreate={canManage} currentUser={currentUser} placeholder="Selecciona o crea una sección" onChange={(value) => changeDraft((current) => ({ ...current, fieldMatrix: current.fieldMatrix.map((item) => item.id === field.id ? { ...item, section: value } : item) }))} />
                          <ScrumStoryCatalogSelect {...catalogSelectorData("field_name")} projectId={projectId} catalogType="field_name" label="Nombre" value={field.name} disabled={!canManage} canCreate={canManage} currentUser={currentUser} placeholder="Selecciona o crea un campo" onChange={(value) => changeDraft((current) => ({ ...current, fieldMatrix: current.fieldMatrix.map((item) => item.id === field.id ? { ...item, name: value } : item) }))} />
                          <ScrumStoryCatalogSelect {...catalogSelectorData("format")} projectId={projectId} catalogType="format" label="Formato de dato" value={field.format} disabled={!canManage} canCreate={canManage} currentUser={currentUser} placeholder="Tipo de dato o control" onChange={(value) => changeDraft((current) => ({ ...current, fieldMatrix: current.fieldMatrix.map((item) => item.id === field.id ? { ...item, format: value } : item) }))} />
                          <ScrumStoryCatalogSelect {...catalogSelectorData("origin")} projectId={projectId} catalogType="origin" label="Origen" value={field.origin} disabled={!canManage} canCreate={canManage} currentUser={currentUser} placeholder="Fuente del valor" onChange={(value) => changeDraft((current) => ({ ...current, fieldMatrix: current.fieldMatrix.map((item) => item.id === field.id ? { ...item, origin: value } : item) }))} />
                        </div>
                        <div className="mt-3"><TextAreaField label="Comportamiento / observación" value={field.behavior} disabled={!canManage} rows={2} placeholder="Validación, valor por defecto, visibilidad o comportamiento condicional." onChange={(value) => changeDraft((current) => ({ ...current, fieldMatrix: current.fieldMatrix.map((item) => item.id === field.id ? { ...item, behavior: value } : item) }))} /></div>
                        <div className="mt-3 flex flex-wrap gap-4">
                          <label className="flex items-center gap-2 text-sm font-bold text-slate-700"><input type="checkbox" className="h-4 w-4 accent-violet-600" checked={field.required} disabled={!canManage} onChange={(event) => changeDraft((current) => ({ ...current, fieldMatrix: current.fieldMatrix.map((item) => item.id === field.id ? { ...item, required: event.target.checked } : item) }))} />Requerido</label>
                          <label className="flex items-center gap-2 text-sm font-bold text-slate-700"><input type="checkbox" className="h-4 w-4 accent-violet-600" checked={field.editable} disabled={!canManage} onChange={(event) => changeDraft((current) => ({ ...current, fieldMatrix: current.fieldMatrix.map((item) => item.id === field.id ? { ...item, editable: event.target.checked } : item) }))} />Editable</label>
                        </div>
                      </div>
                    ))}
                    {canManage && <Button type="button" variant="outline" size="sm" onClick={() => changeDraft((current) => ({ ...current, fieldMatrix: [...current.fieldMatrix, { id: makeId("field"), section: "", name: "", format: "", origin: "", behavior: "", required: false, editable: true }] }))}><Plus size={14} className="mr-1.5" />Agregar campo</Button>}
                  </div>
                </SectionBlock>

                <SectionBlock title="Reglas de negocio" description="Restricciones, cálculos, condiciones y decisiones del negocio." icon={<CheckCircle2 size={18} />} open={openSections.rules} onToggle={() => toggleSection("rules")}><StringListEditor items={draft.businessRules} disabled={!canManage} placeholder="Describe una regla de negocio verificable..." addLabel="Agregar regla" onChange={(items) => changeDraft((current) => ({ ...current, businessRules: items }))} /></SectionBlock>
                <SectionBlock title="Integraciones" description="Sistemas, módulos, servicios o fuentes de datos relacionados." icon={<Layers3 size={18} />} open={openSections.integrations} onToggle={() => toggleSection("integrations")}><StringListEditor items={draft.integrations} disabled={!canManage} placeholder="Sistema origen/destino, datos y comportamiento esperado..." addLabel="Agregar integración" onChange={(items) => changeDraft((current) => ({ ...current, integrations: items }))} /></SectionBlock>
                <SectionBlock title="Notificaciones" description="Disparador, destinatarios, momento, frecuencia y acción esperada." icon={<AlertTriangle size={18} />} open={openSections.notifications} onToggle={() => toggleSection("notifications")}><StringListEditor items={draft.notifications} disabled={!canManage} placeholder="Al ocurrir..., notificar a..., cada..., con enlace a..." addLabel="Agregar notificación" onChange={(items) => changeDraft((current) => ({ ...current, notifications: items }))} /></SectionBlock>
                <SectionBlock title="Dependencias" description="Precondiciones, terceros, datos, diseños o historias relacionadas." icon={<Layers3 size={18} />} open={openSections.dependencies} onToggle={() => toggleSection("dependencies")}><StringListEditor items={draft.dependencies} disabled={!canManage} placeholder="Dependencia y condición para resolverla..." addLabel="Agregar dependencia" onChange={(items) => changeDraft((current) => ({ ...current, dependencies: items }))} /></SectionBlock>
                <SectionBlock title="Requisitos no funcionales" description="Seguridad, rendimiento, accesibilidad, disponibilidad y observabilidad." icon={<CheckCircle2 size={18} />} open={openSections.nonFunctional} onToggle={() => toggleSection("nonFunctional")}><StringListEditor items={draft.nonFunctionalRequirements} disabled={!canManage} placeholder="Métrica, umbral o condición no funcional..." addLabel="Agregar requisito" onChange={(items) => changeDraft((current) => ({ ...current, nonFunctionalRequirements: items }))} /></SectionBlock>
                <SectionBlock title="Trazabilidad y referencias" description="Documentos, prototipos, decisiones, tickets, fuentes importadas o enlaces de soporte." icon={<FileText size={18} />} open={openSections.traceability} onToggle={() => toggleSection("traceability")}>
                  <StringListEditor items={draft.traceabilityReferences} disabled={!canManage} placeholder="Nombre y ubicación de la referencia..." addLabel="Agregar referencia" onChange={(items) => changeDraft((current) => ({ ...current, traceabilityReferences: items }))} />
                  {draft.sourceImports.length > 0 && (
                    <div className="mt-4 border-t border-slate-100 pt-4">
                      <FieldLabel>Documentos interpretados por IA</FieldLabel>
                      <div className="space-y-2">
                        {draft.sourceImports.map((item) => (
                          <div key={item.id} className="flex min-w-0 flex-col gap-1 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-black text-slate-800">{item.fileName}</p>
                              <p className="mt-0.5 text-xs font-medium text-slate-500">
                                {item.importedByLabel || "Usuario"} · {item.importedAt ? new Date(item.importedAt).toLocaleString("es-CO") : "sin fecha"} · {item.mode === "fill_empty" ? "completó vacíos" : "reemplazó el borrador"}
                              </p>
                            </div>
                            <span className="shrink-0 rounded-full bg-violet-50 px-2 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-violet-700">IA · borrador revisable</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </SectionBlock>

                <StoryVisualEvidenceGallery
                  projectId={projectId}
                  project={project}
                  story={selectedStoryForDocuments}
                  stories={stories}
                  currentUser={currentUser}
                  teamMembers={members}
                  sections={visualSectionOptions}
                  criteria={draft.acceptanceCriteria.map((criterion, index) => ({
                    id: criterion.id,
                    label: criterion.title || criterion.statement || `Criterio ${index + 1}`,
                  }))}
                  fields={draft.fieldMatrix.map((field, index) => ({
                    id: field.id,
                    label: field.name || `Campo ${index + 1}`,
                  }))}
                  roles={draft.rolePermissions.map((role, index) => ({
                    id: role.id,
                    label: role.role || `Rol ${index + 1}`,
                  }))}
                  canUpload={canUploadDocuments && canManage}
                  canManageAccess={canManageDocumentAccess}
                  canDelete={canDeleteDocuments}
                  canReorder={canManage}
                  onVisibleEvidenceChange={setVisualEvidence}
                />

                <SectionBlock title="Definition of Ready" description="Condiciones que deben cumplirse antes de comprometer la historia en desarrollo." icon={<ClipboardCheck size={18} />} open={openSections.dor} onToggle={() => toggleSection("dor")} badge={draft.definitionOfReady.length > 0 && draft.definitionOfReady.every((item) => item.done) ? <CheckCircle2 size={17} className="shrink-0 text-emerald-600" /> : undefined}>
                  <ChecklistEditor items={draft.definitionOfReady} disabled={!canManage} onChange={(items) => changeDraft((current) => ({ ...current, definitionOfReady: items }))} />
                </SectionBlock>
                <SectionBlock title="Definition of Done" description="Condiciones comunes para considerar la entrega realmente terminada." icon={<BookOpenCheck size={18} />} open={openSections.dod} onToggle={() => toggleSection("dod")} badge={draft.definitionOfDone.length > 0 && draft.definitionOfDone.every((item) => item.done) ? <CheckCircle2 size={17} className="shrink-0 text-emerald-600" /> : undefined}>
                  <ChecklistEditor items={draft.definitionOfDone} disabled={!canManage} onChange={(items) => changeDraft((current) => ({ ...current, definitionOfDone: items }))} />
                </SectionBlock>

                {!canManage && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-600">
                    Tienes acceso de consulta. La edición del expediente está reservada para quienes administran el proyecto.
                  </div>
                )}
              </div>
            </div>
          )}
        </article>
      </div>
    </section>
    <UserStoryImportDialog
      open={isImportOpen && Boolean(selectedStory && draft)}
      projectId={projectId}
      epicId={selectedEpicId || undefined}
      onOpenChange={setIsImportOpen}
      onApply={applyImportedStory}
    />
    <TaskDocumentsViewer
      isOpen={isDocumentsOpen && Boolean(selectedStoryForDocuments)}
      onClose={() => setIsDocumentsOpen(false)}
      task={selectedStoryForDocuments}
      userId={currentUser?.uid || currentUser?.id || ""}
      currentUser={currentUser}
      project={project}
      tasks={stories}
      teamMembers={members}
      canUploadDocuments={canUploadDocuments}
      canManageAccess={canManageDocumentAccess}
      canDeleteDocuments={canDeleteDocuments}
    />
    </>
  );
}
