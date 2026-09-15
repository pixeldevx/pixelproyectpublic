"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  FileText,
  FileUp,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase/client";
import type { ImportedStorySpecDraft } from "@/lib/ai/story-import";
import { cn } from "@/lib/utils";

const MAX_FILE_SIZE = 4 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = ["pdf", "docx"] as const;

export type UserStoryImportMode = "fill_empty" | "replace";

export type UserStoryImportResult = {
  suggestedTitle: string;
  draft: ImportedStorySpecDraft;
  warnings: string[];
  source: {
    fileName: string;
    fileType: string;
    fileSize: number;
  };
  model: string;
};

export type UserStoryImportApplyPayload = {
  result: UserStoryImportResult;
  file: File;
  mode: UserStoryImportMode;
};

export type UserStoryImportDialogProps = {
  open: boolean;
  projectId: string;
  epicId?: string;
  onOpenChange: (open: boolean) => void;
  onApply: (payload: UserStoryImportApplyPayload) => void | Promise<void>;
};

type JsonRecord = Record<string, unknown>;

const toRecord = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

const asText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const asStringList = (value: unknown) =>
  Array.isArray(value)
    ? value.map(asText).filter(Boolean)
    : [];

const getFileExtension = (fileName: string) =>
  fileName.split(".").at(-1)?.toLocaleLowerCase("en") || "";

const formatFileSize = (size: number) => {
  if (!Number.isFinite(size) || size <= 0) return "0 KB";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toLocaleString("es-CO", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  })} MB`;
};

const validateFile = (file: File) => {
  const extension = getFileExtension(file.name);
  if (!ACCEPTED_EXTENSIONS.includes(extension as (typeof ACCEPTED_EXTENSIONS)[number])) {
    return "Selecciona un documento PDF o DOCX.";
  }
  if (file.size === 0) return "El documento está vacío.";
  if (file.size > MAX_FILE_SIZE) return "El documento supera el límite de 4 MB.";
  return "";
};

const parseApiError = (payload: unknown, status: number) => {
  const root = toRecord(payload);
  const error = root.error;
  if (typeof error === "string" && error.trim()) return error.trim();
  const errorRecord = toRecord(error);
  const message = asText(errorRecord.message);
  if (message) return message;
  if (status === 401) return "Tu sesión de Pixel expiró. Vuelve a iniciar sesión.";
  if (status === 403) return "No tienes permiso para importar esta historia de usuario.";
  if (status === 413) return "El documento supera el límite de 4 MB.";
  if (status === 415) return "El archivo no es un PDF o DOCX válido.";
  return "No fue posible analizar el documento. Intenta nuevamente.";
};

const parseImportResult = (payload: unknown): UserStoryImportResult => {
  const response = toRecord(payload);
  const root = Object.keys(toRecord(response.data)).length > 0
    ? toRecord(response.data)
    : response;
  const draft = toRecord(root.draft);
  const narrative = toRecord(draft.narrative);
  const scope = toRecord(draft.scope);
  const source = toRecord(root.source);

  if (!Object.keys(draft).length || !Object.keys(narrative).length || !Object.keys(scope).length) {
    throw new Error("La IA devolvió un borrador incompleto. Vuelve a analizar el documento.");
  }

  const normalizedDraft = {
    ...draft,
    status: "draft",
    narrative: {
      actor: asText(narrative.actor),
      wantTo: asText(narrative.wantTo),
      soThat: asText(narrative.soThat),
      context: asText(narrative.context),
    },
    scope: {
      included: asStringList(scope.included),
      excluded: asStringList(scope.excluded),
    },
    rolesAndPermissions: asText(draft.rolesAndPermissions),
    rolePermissions: Array.isArray(draft.rolePermissions) ? draft.rolePermissions : [],
    acceptanceCriteria: Array.isArray(draft.acceptanceCriteria) ? draft.acceptanceCriteria : [],
    fieldMatrix: Array.isArray(draft.fieldMatrix) ? draft.fieldMatrix : [],
    businessRules: asStringList(draft.businessRules),
    integrations: asStringList(draft.integrations),
    notifications: asStringList(draft.notifications),
    dependencies: asStringList(draft.dependencies),
    nonFunctionalRequirements: asStringList(draft.nonFunctionalRequirements),
    traceabilityReferences: asStringList(draft.traceabilityReferences),
    definitionOfReady: Array.isArray(draft.definitionOfReady) ? draft.definitionOfReady : [],
    definitionOfDone: Array.isArray(draft.definitionOfDone) ? draft.definitionOfDone : [],
    primarySubmoduleId: asText(draft.primarySubmoduleId),
    impactedSubmoduleIds: asStringList(draft.impactedSubmoduleIds),
  } as ImportedStorySpecDraft;

  return {
    suggestedTitle: asText(root.suggestedTitle),
    draft: normalizedDraft,
    warnings: asStringList(root.warnings),
    source: {
      fileName: asText(source.fileName),
      fileType: asText(source.fileType),
      fileSize: Number(source.fileSize) || 0,
    },
    model: asText(root.model),
  };
};

const getFocusableElements = (container: HTMLElement) =>
  Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute("aria-hidden"));

export function UserStoryImportDialog({
  open,
  projectId,
  epicId,
  onOpenChange,
  onApply,
}: UserStoryImportDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [analyzedFile, setAnalyzedFile] = useState<File | null>(null);
  const [result, setResult] = useState<UserStoryImportResult | null>(null);
  const [mode, setMode] = useState<UserStoryImportMode>("fill_empty");
  const [error, setError] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const counts = useMemo(() => {
    if (!result) return null;
    const draft = result.draft;
    return {
      roles: draft.rolePermissions.length,
      criteria: draft.acceptanceCriteria.length,
      fields: draft.fieldMatrix.length,
      rules: draft.businessRules.length,
      scope: draft.scope.included.length + draft.scope.excluded.length,
    };
  }, [result]);

  useEffect(() => {
    if (!open) {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      setFile(null);
      setAnalyzedFile(null);
      setResult(null);
      setMode("fill_empty");
      setError("");
      setIsAnalyzing(false);
      setIsApplying(false);
      return;
    }

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);

    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      previouslyFocusedRef.current?.focus?.();
    };
  }, [open]);

  useEffect(() => () => abortControllerRef.current?.abort(), []);

  const closeDialog = () => {
    if (isApplying) return;
    abortControllerRef.current?.abort();
    onOpenChange(false);
  };

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;

    const focusable = getFocusableElements(dialogRef.current);
    if (focusable.length === 0) {
      event.preventDefault();
      dialogRef.current.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    const selectedFile = event.target.files?.[0] || null;
    setResult(null);
    setAnalyzedFile(null);
    setError("");
    if (!selectedFile) {
      setFile(null);
      return;
    }
    const validationError = validateFile(selectedFile);
    if (validationError) {
      setFile(null);
      setError(validationError);
      event.target.value = "";
      return;
    }
    setFile(selectedFile);
  };

  const analyzeDocument = async () => {
    if (!file) {
      setError("Selecciona el PDF o DOCX que contiene la historia de usuario.");
      fileInputRef.current?.focus();
      return;
    }
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    const fileBeingAnalyzed = file;
    setIsAnalyzing(true);
    setResult(null);
    setAnalyzedFile(null);
    setError("");
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (sessionError || !accessToken) {
        throw new Error("Tu sesión de Pixel expiró. Vuelve a iniciar sesión.");
      }

      const body = new FormData();
      body.append("file", fileBeingAnalyzed, fileBeingAnalyzed.name);
      if (epicId?.trim()) body.append("epicId", epicId.trim());

      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/scrum/stories/import`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
          body,
          cache: "no-store",
          signal: controller.signal,
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(parseApiError(payload, response.status));
      if (abortControllerRef.current !== controller) return;
      setResult(parseImportResult(payload));
      setAnalyzedFile(fileBeingAnalyzed);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "No fue posible analizar el documento.");
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
      setIsAnalyzing(false);
    }
  };

  const applyDraft = async () => {
    if (!result || !file) return;
    if (analyzedFile !== file) {
      setResult(null);
      setAnalyzedFile(null);
      setError("El archivo cambió después del análisis. Analízalo nuevamente antes de aplicar el borrador.");
      return;
    }
    setIsApplying(true);
    setError("");
    try {
      await onApply({ result, file, mode });
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible aplicar el borrador al formulario.");
    } finally {
      setIsApplying(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeDialog();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="story-import-title"
        aria-describedby="story-import-description"
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
        className="flex max-h-[100dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[26px] bg-white shadow-2xl sm:max-h-[92vh] sm:rounded-[26px]"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-7 sm:py-5">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
              <Sparkles size={20} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-700">
                Lectura inteligente
              </p>
              <h2 id="story-import-title" className="mt-1 text-xl font-black text-slate-950 sm:text-2xl">
                Importar historia existente
              </h2>
              <p id="story-import-description" className="mt-1 max-w-2xl text-sm leading-5 text-slate-600">
                La IA extrae la información y propone un borrador. Podrás revisarlo antes de aplicarlo y nada se guarda automáticamente.
              </p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={closeDialog}
            disabled={isApplying}
            className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            aria-label="Cerrar importación"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
          <section aria-labelledby="story-import-file-label">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h3 id="story-import-file-label" className="text-sm font-black text-slate-900">
                  Documento de origen
                </h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">Un archivo PDF o DOCX de máximo 4 MB.</p>
              </div>
              {result && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                  <CheckCircle2 size={14} aria-hidden="true" /> Analizado
                </span>
              )}
            </div>

            <label
              htmlFor="user-story-import-file"
              className={cn(
                "mt-3 flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed p-4 transition focus-within:border-violet-500 focus-within:ring-2 focus-within:ring-violet-100",
                file ? "border-violet-300 bg-violet-50/60" : "border-slate-300 bg-slate-50 hover:border-violet-300 hover:bg-violet-50/40",
              )}
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-violet-700 shadow-sm">
                {file ? <FileText size={21} aria-hidden="true" /> : <FileUp size={21} aria-hidden="true" />}
              </div>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-black text-slate-900">
                  {file?.name || "Seleccionar historia de usuario"}
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  {file ? `${formatFileSize(file.size)} · Haz clic para cambiar el archivo` : "PDF o documento de Word (.docx)"}
                </span>
              </span>
              <span className="hidden rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 sm:block">
                Examinar
              </span>
              <input
                ref={fileInputRef}
                id="user-story-import-file"
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={handleFileChange}
                disabled={isAnalyzing || isApplying}
                className="sr-only"
                aria-describedby="story-import-description"
              />
            </label>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Al pulsar Analizar, el documento se procesa con el servicio de IA configurado por Pixel. Al aplicar y guardar la historia se conserva la trazabilidad del análisis, sin duplicar el archivo fuente.
            </p>
          </section>

          {isAnalyzing && (
            <div className="mt-5 rounded-2xl border border-violet-200 bg-violet-50 p-5" role="status" aria-live="polite">
              <div className="flex items-center gap-3">
                <Loader2 className="animate-spin text-violet-700" size={22} aria-hidden="true" />
                <div>
                  <p className="text-sm font-black text-violet-950">Leyendo y estructurando el documento</p>
                  <p className="mt-0.5 text-xs leading-5 text-violet-700">Puede tardar unos segundos. La historia permanece sin cambios.</p>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-5 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-800" role="alert">
              <AlertTriangle className="mt-0.5 shrink-0" size={18} aria-hidden="true" />
              <p className="text-sm font-semibold leading-5">{error}</p>
            </div>
          )}

          {result && counts && (
            <section className="mt-6 space-y-5" aria-labelledby="story-import-preview-title">
              <div className="rounded-2xl border border-slate-200 bg-slate-950 p-5 text-white">
                <div className="flex items-start gap-3">
                  <Bot className="mt-0.5 shrink-0 text-violet-300" size={20} aria-hidden="true" />
                  <div className="min-w-0">
                    <p id="story-import-preview-title" className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-300">
                      Vista previa del borrador
                    </p>
                    <h3 className="mt-2 text-lg font-black leading-6">
                      {result.suggestedTitle || "Historia sin título identificado"}
                    </h3>
                    <p className="mt-2 line-clamp-3 text-sm leading-5 text-slate-300">
                      {[result.draft.narrative.actor && `Como ${result.draft.narrative.actor}`,
                        result.draft.narrative.wantTo && `quiero ${result.draft.narrative.wantTo}`,
                        result.draft.narrative.soThat && `para ${result.draft.narrative.soThat}`]
                        .filter(Boolean)
                        .join(", ") || "La narrativa debe completarse durante la revisión."}
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {[
                  ["Roles", counts.roles],
                  ["Criterios", counts.criteria],
                  ["Campos", counts.fields],
                  ["Reglas", counts.rules],
                  ["Alcance", counts.scope],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.13em] text-slate-500">{label}</p>
                    <p className="mt-1 text-xl font-black text-slate-950">{value}</p>
                  </div>
                ))}
              </div>

              <div
                className={cn(
                  "rounded-2xl border p-4",
                  result.warnings.length > 0
                    ? "border-amber-200 bg-amber-50"
                    : "border-emerald-200 bg-emerald-50",
                )}
              >
                <div className="flex items-start gap-3">
                  {result.warnings.length > 0
                    ? <AlertTriangle className="mt-0.5 shrink-0 text-amber-700" size={18} aria-hidden="true" />
                    : <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-700" size={18} aria-hidden="true" />}
                  <div>
                    <p className={cn("text-sm font-black", result.warnings.length > 0 ? "text-amber-950" : "text-emerald-950")}>
                      {result.warnings.length > 0
                        ? `${result.warnings.length} aspecto${result.warnings.length === 1 ? "" : "s"} por revisar`
                        : "Borrador sin advertencias automáticas"}
                    </p>
                    {result.warnings.length > 0 ? (
                      <ul className="mt-2 space-y-1 pl-4 text-xs leading-5 text-amber-800">
                        {result.warnings.map((warning) => <li key={warning} className="list-disc">{warning}</li>)}
                      </ul>
                    ) : (
                      <p className="mt-1 text-xs leading-5 text-emerald-700">Aun así, revisa cada campo antes de guardar la historia.</p>
                    )}
                  </div>
                </div>
              </div>

              <fieldset>
                <legend className="text-sm font-black text-slate-900">Cómo aplicar el borrador</legend>
                <p className="mt-1 text-xs leading-5 text-slate-500">Esta acción solo modifica el formulario abierto; después decides si guardas.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition",
                    mode === "fill_empty" ? "border-violet-400 bg-violet-50 ring-2 ring-violet-100" : "border-slate-200 hover:border-slate-300",
                  )}>
                    <input
                      type="radio"
                      name="user-story-import-mode"
                      value="fill_empty"
                      checked={mode === "fill_empty"}
                      onChange={() => setMode("fill_empty")}
                      className="mt-1 accent-violet-600"
                    />
                    <span>
                      <span className="block text-sm font-black text-slate-900">Completar solo campos vacíos</span>
                      <span className="mt-1 block text-xs leading-5 text-slate-600">Conserva la información que ya escribiste y agrega lo que falta.</span>
                    </span>
                  </label>
                  <label className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition",
                    mode === "replace" ? "border-violet-400 bg-violet-50 ring-2 ring-violet-100" : "border-slate-200 hover:border-slate-300",
                  )}>
                    <input
                      type="radio"
                      name="user-story-import-mode"
                      value="replace"
                      checked={mode === "replace"}
                      onChange={() => setMode("replace")}
                      className="mt-1 accent-violet-600"
                    />
                    <span>
                      <span className="block text-sm font-black text-slate-900">Reemplazar expediente digital</span>
                      <span className="mt-1 block text-xs leading-5 text-slate-600">Sustituye el contenido editable actual por el borrador extraído.</span>
                    </span>
                  </label>
                </div>
              </fieldset>
            </section>
          )}
        </div>

        <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <Button type="button" variant="outline" onClick={closeDialog} disabled={isApplying} className="sm:min-w-28">
            Cancelar
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            {result && (
              <Button
                type="button"
                variant="outline"
                onClick={analyzeDocument}
                disabled={!file || isAnalyzing || isApplying}
              >
                {isAnalyzing ? <Loader2 className="mr-2 animate-spin" size={16} /> : <Sparkles className="mr-2" size={16} />}
                Analizar de nuevo
              </Button>
            )}
            {result ? (
              <Button
                type="button"
                onClick={applyDraft}
                disabled={isApplying || isAnalyzing || analyzedFile !== file}
                className="bg-violet-600 font-black text-white hover:bg-violet-700"
              >
                {isApplying ? <Loader2 className="mr-2 animate-spin" size={16} /> : <CheckCircle2 className="mr-2" size={16} />}
                Aplicar borrador
              </Button>
            ) : (
              <Button
                type="button"
                onClick={analyzeDocument}
                disabled={!file || isAnalyzing}
                className="bg-violet-600 font-black text-white hover:bg-violet-700"
              >
                {isAnalyzing ? <Loader2 className="mr-2 animate-spin" size={16} /> : <Sparkles className="mr-2" size={16} />}
                Analizar documento
              </Button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
