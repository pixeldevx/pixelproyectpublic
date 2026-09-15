"use client"

import React, { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ClipboardList, CreditCard, ExternalLink, FileUp, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CustomForm } from "@/components/projects/WorkflowStepFormBuilderModal";
import {
  getStaticRateCardAssignmentKey,
  getStaticRateCardSources,
  isInvalidRateCardUnits,
  normalizeRateCardUnits,
  StaticRateCardSource,
} from "@/lib/rate-card-config";
import {
  getWorkflowDocumentDisplayName,
  isWorkflowDocumentValue,
  isWorkflowDocumentValueArray,
  uploadWorkflowFormDocument,
} from "@/lib/workflow-form-documents";
import { toast } from "sonner";
import { SecureDocumentLink } from "@/components/projects/SecureDocumentLink";

export type SubtaskCompletionSubmission = {
  formData: Record<string, any>;
  comment: string | null;
  staticRateCardUnits: Record<string, string>;
  staticRateCardAssignees: Record<string, string>;
  dynamicRateCard?: {
    assigneeId: string;
    rateCardId: string;
    units: number;
  } | null;
};

interface CompleteSubtaskFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: any | null;
  user: any;
  project?: any;
  tasks?: any[];
  teamMembers: any[];
  rateCards: any[];
  onSubmit: (submission: SubtaskCompletionSubmission) => Promise<void> | void;
}

const getTaskTitle = (task: any) => task?.title || task?.name || "Subtarea";

const getCompletionForm = (task: any): CustomForm | undefined =>
  task?.completionForm || task?.subtaskCompletionForm || undefined;

const hasRequiredValue = (value: any) => {
  if (isWorkflowDocumentValue(value)) return true;
  if (isWorkflowDocumentValueArray(value)) return true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return true;
  return value !== undefined && value !== null && String(value).trim().length > 0;
};

const getMultiSelectValue = (value: any): string[] => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) return [value];
  return [];
};

const toggleMultiSelectValue = (value: any, option: string) => {
  const current = getMultiSelectValue(value);
  return current.includes(option)
    ? current.filter((item) => item !== option)
    : [...current, option];
};

const isDynamicRateCardForm = (form?: CustomForm) =>
  Boolean(form?.dynamicRateCard || form?.rateCardMode === "dynamic" || form?.dynamicRateCardConfig);

const shouldRequestDynamicRateCardUnits = (form?: CustomForm) =>
  form?.autoAddUnits === false || form?.dynamicRateCardConfig?.promptForUnits === true;

const getDynamicRateCardUnits = (form?: CustomForm) =>
  normalizeRateCardUnits(form?.dynamicRateCardConfig?.defaultUnits ?? form?.unitsToAdd);

const getStaticSources = (form?: CustomForm): StaticRateCardSource[] =>
  getStaticRateCardSources({ form });

export function CompleteSubtaskFormModal({
  isOpen,
  onClose,
  task,
  user,
  project,
  tasks = [],
  teamMembers,
  rateCards,
  onSubmit,
}: CompleteSubtaskFormModalProps) {
  const completionForm = getCompletionForm(task);
  const staticRateCardSources = useMemo(() => getStaticSources(completionForm), [completionForm]);
  const manualStaticSources = staticRateCardSources.filter((source) => source.autoAddUnits === false);
  const runtimeStaticSources = staticRateCardSources.filter((source) => source.assigneeMode === "runtime");
  const usesDynamicRateCard = isDynamicRateCardForm(completionForm);
  const dynamicRequestsUnits = shouldRequestDynamicRateCardUnits(completionForm);
  const completionFormSignature = useMemo(
    () =>
      (completionForm?.fields || [])
        .map((field: any) => `${field.id}:${field.type}:${field.label || ""}:${field.required ? "1" : "0"}`)
        .join("|"),
    [completionForm?.fields]
  );
  const modalSessionKey =
    isOpen && task
      ? `${task.id || task.originalId || "task"}::${(completionForm as any)?.id || completionForm?.title || "form"}::${completionFormSignature}`
      : "";
  const initializedSessionRef = useRef("");

  const [formData, setFormData] = useState<Record<string, any>>({});
  const [comment, setComment] = useState("");
  const [staticRateCardUnits, setStaticRateCardUnits] = useState<Record<string, string>>({});
  const [staticRateCardAssignees, setStaticRateCardAssignees] = useState<Record<string, string>>({});
  const [documentFiles, setDocumentFiles] = useState<Record<string, File[]>>({});
  const [dynamicRateCardAssignee, setDynamicRateCardAssignee] = useState("");
  const [dynamicRateCardId, setDynamicRateCardId] = useState("");
  const [dynamicRateCardUnits, setDynamicRateCardUnits] = useState("1");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen || !task) {
      initializedSessionRef.current = "";
      return;
    }
    if (initializedSessionRef.current === modalSessionKey) return;

    initializedSessionRef.current = modalSessionKey;
    const initialStaticSources = getStaticSources(completionForm);
    const initialRuntimeSources = initialStaticSources.filter((source) => source.assigneeMode === "runtime");

    setFormData(task.completionFormData || {});
    setDocumentFiles({});
    setComment("");
    setStaticRateCardUnits(
      Object.fromEntries(initialStaticSources.map((source) => [source.key, String(normalizeRateCardUnits(source.unitsToAdd))]))
    );
    setStaticRateCardAssignees(
      Object.fromEntries(
        initialRuntimeSources.map((source) => [source.key, source.assignedTo || ""])
      )
    );
    setDynamicRateCardAssignee(task.assignedTo || user?.uid || "");
    setDynamicRateCardId("");
    setDynamicRateCardUnits(String(getDynamicRateCardUnits(completionForm)));
    setIsSubmitting(false);
  }, [completionForm, isOpen, modalSessionKey, task, user?.uid]);

  if (!isOpen || !task || !completionForm) return null;

  const validateSubmission = () => {
    const missingRequired = (completionForm.fields || []).some((field) => {
      if (!field.required) return false;
      if (field.type === "document" && (documentFiles[field.id] || []).length > 0) return false;
      return !hasRequiredValue(formData[field.id]);
    });
    if (missingRequired) {
      toast.warning("Completa los campos obligatorios del formulario.");
      return false;
    }

    const hasInvalidManualUnits = manualStaticSources.some((source) =>
      isInvalidRateCardUnits(staticRateCardUnits[source.key])
    );
    if (hasInvalidManualUnits) {
      toast.warning("Define unidades de Rate Card en cero o mayores.");
      return false;
    }

    const hasMissingRuntimeAssignee = runtimeStaticSources.some((source) => !staticRateCardAssignees[source.key]);
    if (hasMissingRuntimeAssignee) {
      toast.warning("Selecciona el profesional para cada Rate Card que se pide al ejecutar.");
      return false;
    }

    const assignmentKeys = staticRateCardSources.map((source) =>
      getStaticRateCardAssignmentKey(source, task.assignedTo || user?.uid, staticRateCardAssignees[source.key])
    );
    if (usesDynamicRateCard && dynamicRateCardId && dynamicRateCardAssignee) {
      assignmentKeys.push(`${dynamicRateCardId}::${dynamicRateCardAssignee}`);
    }
    const hasDuplicateAssignments = assignmentKeys.some(
      (assignmentKey, index) => assignmentKeys.indexOf(assignmentKey) !== index
    );
    if (hasDuplicateAssignments) {
      toast.warning("Puedes repetir un Rate Card solo si se carga a profesionales diferentes.");
      return false;
    }

    if (usesDynamicRateCard) {
      if (!dynamicRateCardAssignee || !dynamicRateCardId || (dynamicRequestsUnits && isInvalidRateCardUnits(dynamicRateCardUnits))) {
        toast.warning("Completa persona, perfil y unidades del Rate Card dinámico.");
        return false;
      }
    }

    return true;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!validateSubmission()) return;

    setIsSubmitting(true);
    try {
      const preparedFormData = { ...formData };
      for (const field of completionForm.fields || []) {
        if (field.type !== "document") continue;
        const files = documentFiles[field.id] || [];
        if (files.length === 0) continue;

        const uploadedDocuments = [];
        for (const file of files) {
          uploadedDocuments.push(await uploadWorkflowFormDocument({
            file,
            projectId: task.projectId,
            projectName: project?.name || task.projectName,
            task,
            tasks,
            user,
            field: { ...field, documentName: files.length > 1 && !field.documentVersioning ? file.name : field.documentName },
            stepIndex: null,
            stepLabel: "Cierre de subtarea",
          }));
        }
        preparedFormData[field.id] = uploadedDocuments.length === 1 ? uploadedDocuments[0] : uploadedDocuments;
      }

      await onSubmit({
        formData: preparedFormData,
        comment: comment.trim() || null,
        staticRateCardUnits,
        staticRateCardAssignees,
        dynamicRateCard: usesDynamicRateCard
          ? {
              assigneeId: dynamicRateCardAssignee,
              rateCardId: dynamicRateCardId,
              units: dynamicRequestsUnits ? normalizeRateCardUnits(dynamicRateCardUnits, 0) : getDynamicRateCardUnits(completionForm),
            }
          : null,
      });
      setDocumentFiles({});
      onClose();
    } catch (error: any) {
      console.error("Error completing subtask form:", error);
      toast.error(error?.message || "No se pudo completar la subtarea.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderField = (field: any) => (
    <div key={field.id}>
      <label className="mb-1 block text-sm font-medium text-slate-700">
        {field.label} {field.required && <span className="text-red-500">*</span>}
      </label>

      {field.type === "text" && (
        <input
          type="text"
          value={formData[field.id] || ""}
          onChange={(event) => setFormData((current) => ({ ...current, [field.id]: event.target.value }))}
          className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        />
      )}

      {field.type === "number" && (
        <input
          type="number"
          step="any"
          value={formData[field.id] || ""}
          onChange={(event) => setFormData((current) => ({ ...current, [field.id]: event.target.value }))}
          className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        />
      )}

      {field.type === "date" && (
        <input
          type="date"
          value={formData[field.id] || ""}
          onChange={(event) => setFormData((current) => ({ ...current, [field.id]: event.target.value }))}
          className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        />
      )}

      {field.type === "datetime" && (
        <input
          type="datetime-local"
          value={formData[field.id] || ""}
          onChange={(event) => setFormData((current) => ({ ...current, [field.id]: event.target.value }))}
          className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        />
      )}

      {field.type === "select" && (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          {field.options?.length ? (
            field.selectionMode === "single" ? (
              <select
                value={Array.isArray(formData[field.id]) ? formData[field.id][0] || "" : formData[field.id] || ""}
                onChange={(event) => setFormData((current) => ({ ...current, [field.id]: event.target.value }))}
                className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="">Selecciona una opción</option>
                {field.options.map((option: string, index: number) => (
                  <option key={index} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <div className="space-y-2">
                {field.options.map((option: string, index: number) => {
                  const selectedValues = getMultiSelectValue(formData[field.id]);
                  return (
                    <label key={index} className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={selectedValues.includes(option)}
                        onChange={() =>
                          setFormData((current) => ({
                            ...current,
                            [field.id]: toggleMultiSelectValue(current[field.id], option),
                          }))
                        }
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      {option}
                    </label>
                  );
                })}
              </div>
            )
          ) : (
            <p className="text-xs text-amber-600">Este campo no tiene opciones configuradas.</p>
          )}
        </div>
      )}

      {field.type === "checkbox" && (
        <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={Boolean(formData[field.id])}
            onChange={(event) => setFormData((current) => ({ ...current, [field.id]: event.target.checked }))}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          Confirmar
        </label>
      )}

      {field.type === "document" && (
        <div className="rounded-xl border border-dashed border-indigo-200 bg-indigo-50/50 p-3">
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-white bg-white px-3 py-2 text-sm font-bold text-slate-700 shadow-sm transition-colors hover:border-indigo-200">
            <span className="flex min-w-0 items-center gap-2">
              <FileUp size={16} className="text-indigo-600" />
              <span className="truncate">
                {(documentFiles[field.id] || []).length > 0
                  ? `${documentFiles[field.id].length} documento${documentFiles[field.id].length === 1 ? "" : "s"} seleccionado${documentFiles[field.id].length === 1 ? "" : "s"}`
                  : "Seleccionar documentos"}
              </span>
            </span>
            <span className="rounded-full bg-indigo-100 px-2 py-1 text-[10px] uppercase tracking-wider text-indigo-700">
              Adjuntar
            </span>
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                const selectedFiles = Array.from(event.target.files || []);
                setDocumentFiles((current) => ({ ...current, [field.id]: selectedFiles }));
              }}
            />
          </label>
          {(documentFiles[field.id] || []).length > 0 && (
            <div className="mt-2 space-y-1">
              {documentFiles[field.id].map((selectedFile) => (
                <div key={`${selectedFile.name}-${selectedFile.size}-${selectedFile.lastModified}`} className="flex min-w-0 items-center gap-2 rounded-lg border border-indigo-100 bg-white/80 px-3 py-2 text-xs font-bold text-slate-700">
                  <FileUp size={14} className="shrink-0 text-indigo-600" />
                  <span className="truncate">{selectedFile.name}</span>
                </div>
              ))}
            </div>
          )}
          {isWorkflowDocumentValueArray(formData[field.id]) && (
            <div className="mt-2 space-y-2">
              {formData[field.id].map((documentValue: any, index: number) => (
                <SecureDocumentLink
                  key={`${documentValue.documentId || documentValue.storagePath || documentValue.url}-${index}`}
                  storagePath={documentValue.storagePath}
                  fallbackUrl={documentValue.url}
                  className="flex min-w-0 items-center gap-2 rounded-lg border border-indigo-100 bg-white/80 px-3 py-2 text-xs font-bold text-indigo-700 hover:text-indigo-900"
                >
                  <ExternalLink size={14} />
                  <span className="truncate">{getWorkflowDocumentDisplayName(documentValue)}</span>
                </SecureDocumentLink>
              ))}
            </div>
          )}
          {isWorkflowDocumentValue(formData[field.id]) && (
            <SecureDocumentLink
              storagePath={formData[field.id].storagePath}
              fallbackUrl={formData[field.id].url}
              className="mt-2 flex min-w-0 items-center gap-2 rounded-lg border border-indigo-100 bg-white/80 px-3 py-2 text-xs font-bold text-indigo-700 hover:text-indigo-900"
            >
              <ExternalLink size={14} />
              <span className="truncate">{getWorkflowDocumentDisplayName(formData[field.id])}</span>
            </SecureDocumentLink>
          )}
          <p className="mt-2 text-[11px] leading-5 text-slate-500">
            {field.documentFolderPath
              ? `Ruta: ${field.documentFolderPath}. `
              : "Ruta: carpeta principal de la tarea. "}
            {field.documentVersioning
              ? `Se publicará como una nueva versión de ${field.documentName || field.label}.`
              : "Quedará como evidencia independiente del cierre."}
          </p>
        </div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <form onSubmit={handleSubmit} className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 p-6">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-indigo-600">Completar subtarea</p>
            <h2 className="mt-1 flex items-center gap-2 text-xl font-bold text-slate-900">
              <CheckCircle2 size={22} className="text-emerald-600" />
              {getTaskTitle(task)}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {completionForm.title || "Formulario de cierre"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto bg-slate-50 p-6">
          {(completionForm.fields || []).length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-800">
                <ClipboardList size={16} className="text-indigo-600" />
                Datos requeridos
              </h3>
              <div className="space-y-4">
                {(completionForm.fields || []).map(renderField)}
              </div>
            </section>
          )}

          {(staticRateCardSources.length > 0 || usesDynamicRateCard) && (
            <section className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-emerald-800">
                <CreditCard size={16} />
                Rate Cards al completar
              </h3>

              {manualStaticSources.length > 0 && (
                <div className="mb-3 space-y-2 rounded-lg border border-white bg-white/80 p-3">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Unidades manuales</p>
                  {manualStaticSources.map((source) => {
                    const rateCard = rateCards.find((candidate) => candidate.id === source.rateCardId);
                    return (
                      <label key={source.key} className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-2">
                        <span className="truncate text-xs font-bold text-slate-700">{rateCard?.name || "Rate Card"}</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          pattern="[0-9]*[.,]?[0-9]*"
                          value={staticRateCardUnits[source.key] ?? String(source.unitsToAdd ?? "")}
                          onChange={(event) =>
                            setStaticRateCardUnits((current) => ({
                              ...current,
                              [source.key]: event.target.value,
                            }))
                          }
                          className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                          placeholder="Ej. 0,051"
                          title="Puedes usar coma o punto decimal. Ejemplo: 0,051 o 0.051"
                        />
                      </label>
                    );
                  })}
                </div>
              )}

              {runtimeStaticSources.length > 0 && (
                <div className="mb-3 space-y-2 rounded-lg border border-indigo-100 bg-white p-3">
                  <p className="text-xs font-bold uppercase tracking-wider text-indigo-600">Profesional a cargar</p>
                  {runtimeStaticSources.map((source) => {
                    const rateCard = rateCards.find((candidate) => candidate.id === source.rateCardId);
                    return (
                      <label key={source.key} className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_240px] md:items-center">
                        <span className="truncate text-xs font-bold text-slate-700">{rateCard?.name || "Rate Card"}</span>
                        <select
                          value={staticRateCardAssignees[source.key] || ""}
                          onChange={(event) =>
                            setStaticRateCardAssignees((current) => ({
                              ...current,
                              [source.key]: event.target.value,
                            }))
                          }
                          className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                        >
                          <option value="">Selecciona profesional</option>
                          {teamMembers.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.name || member.email || "Profesional"}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  })}
                </div>
              )}

              {usesDynamicRateCard && (
                <div className="grid grid-cols-1 gap-3 rounded-lg border border-emerald-100 bg-white p-3 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-emerald-700">Persona</label>
                    <select
                      value={dynamicRateCardAssignee}
                      onChange={(event) => setDynamicRateCardAssignee(event.target.value)}
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    >
                      <option value="">Seleccionar...</option>
                      {teamMembers.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name || member.email || "Profesional"}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-emerald-700">Perfil</label>
                    <select
                      value={dynamicRateCardId}
                      onChange={(event) => setDynamicRateCardId(event.target.value)}
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    >
                      <option value="">Seleccionar...</option>
                      {rateCards.map((rateCard) => (
                        <option key={rateCard.id} value={rateCard.id}>
                          {rateCard.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {dynamicRequestsUnits ? (
                    <div className="md:col-span-2">
                      <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-emerald-700">Unidades</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        pattern="[0-9]*[.,]?[0-9]*"
                        value={dynamicRateCardUnits}
                        onChange={(event) => setDynamicRateCardUnits(event.target.value)}
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                        placeholder="Ej. 0,051"
                        title="Puedes usar coma o punto decimal. Ejemplo: 0,051 o 0.051"
                      />
                      <p className="mt-1 text-[10px] font-bold text-emerald-700">
                        Puedes usar coma o punto decimal; Pixel guarda el decimal normalizado.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 md:col-span-2">
                      Auto suma: se cargarán {getDynamicRateCardUnits(completionForm)} unidades configuradas.
                    </div>
                  )}
                </div>
              )}

              {staticRateCardSources.length > 0 && (
                <p className="mt-2 text-[10px] font-medium text-emerald-700">
                  Los Rate Cards automáticos se registrarán con las unidades configuradas al cerrar la subtarea.
                </p>
              )}
            </section>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Comentario de cierre</label>
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              className="h-24 w-full resize-none rounded-xl border border-slate-200 bg-white p-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              placeholder="Observación opcional sobre el cierre de la subtarea..."
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-100 p-6">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting} className="bg-emerald-600 text-white hover:bg-emerald-700">
            {isSubmitting ? (
              <>
                <Loader2 size={16} className="mr-2 animate-spin" />
                Guardando...
              </>
            ) : (
              "Guardar y finalizar"
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
