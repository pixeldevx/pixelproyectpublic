"use client"

import React, { useEffect, useState } from "react";
import { ClipboardList, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CustomForm } from "@/components/projects/WorkflowStepFormBuilderModal";
import { toast } from "sonner";
import { getIncrementalRateBinding, isRateDrivenIncrementalTask } from "@/lib/incremental-rate-tasks";

interface IncrementTaskValueModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: any | null;
  onSubmit: (
    task: any,
    amount: number,
    formData: Record<string, any>,
    comment: string
  ) => Promise<void> | void;
}

const getTaskTitle = (task: any) => task?.title || task?.name || "Tarea";

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

const hasRequiredValue = (value: any) => {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return true;
  return value !== undefined && value !== null && String(value).trim().length > 0;
};

export function IncrementTaskValueModal({
  isOpen,
  onClose,
  task,
  onSubmit,
}: IncrementTaskValueModalProps) {
  const [amount, setAmount] = useState("1");
  const [comment, setComment] = useState("");
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const incrementForm: CustomForm | undefined = task?.incrementForm || undefined;
  const rateBinding = getIncrementalRateBinding(task);
  const isRateDriven = isRateDrivenIncrementalTask(task);
  const delegatesIncrementToSubtasks =
    task?.type === "quantitative" &&
    (task?.incrementDelegatedToSubtasks || task?.isParentTask || Number(task?.totalSubtasks || 0) > 0);
  const currentValue = Number(task?.currentValue || 0);
  const targetValue = Number(task?.indicatorValue || 0);
  const amountValue = Number(amount);
  const nextValue =
    targetValue > 0 && amountValue > 0
      ? Math.min(targetValue, currentValue + amountValue)
      : currentValue;

  useEffect(() => {
    if (!isOpen || !task) return;
    setAmount("1");
    setComment("");
    setFormData({});
    setIsSubmitting(false);
  }, [isOpen, task]);

  if (!isOpen || !task) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (isRateDriven) {
      toast.info("Esta tarea avanza automáticamente con el Rate Card configurado.");
      return;
    }

    if (delegatesIncrementToSubtasks) {
      toast.info("Esta tarea matriz delega su avance en sus subtareas.");
      return;
    }

    if (!amountValue || amountValue <= 0) {
      toast.warning("Ingresa un valor de incremento mayor a cero.");
      return;
    }

    if (targetValue <= 0) {
      toast.warning("Esta tarea no tiene una meta válida configurada.");
      return;
    }

    const missingRequired = incrementForm?.fields?.some(
      (field) => field.required && !hasRequiredValue(formData[field.id])
    );
    if (missingRequired) {
      toast.warning("Completa los campos obligatorios del formulario.");
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit(task, amountValue, formData, comment.trim());
      onClose();
    } catch (error: any) {
      console.error("Error incrementing task:", error);
      toast.error(error?.message || "No se pudo registrar el incremento.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderField = (field: any) => (
    <div key={field.id}>
      <label className="block text-sm font-medium text-slate-700 mb-1">
        {field.label} {field.required && <span className="text-red-500">*</span>}
      </label>

      {field.type === "text" && (
        <input
          type="text"
          value={formData[field.id] || ""}
          onChange={(event) => setFormData({ ...formData, [field.id]: event.target.value })}
          className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        />
      )}

      {field.type === "number" && (
        <input
          type="number"
          value={formData[field.id] || ""}
          onChange={(event) => setFormData({ ...formData, [field.id]: event.target.value })}
          className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        />
      )}

      {field.type === "date" && (
        <input
          type="date"
          value={formData[field.id] || ""}
          onChange={(event) => setFormData({ ...formData, [field.id]: event.target.value })}
          className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        />
      )}

      {field.type === "datetime" && (
        <input
          type="datetime-local"
          value={formData[field.id] || ""}
          onChange={(event) => setFormData({ ...formData, [field.id]: event.target.value })}
          className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        />
      )}

      {field.type === "select" && (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          {field.options?.length ? (
            field.selectionMode === "single" ? (
              <select
                value={Array.isArray(formData[field.id]) ? formData[field.id][0] || "" : formData[field.id] || ""}
                onChange={(event) => setFormData({ ...formData, [field.id]: event.target.value })}
                className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
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
                          setFormData({
                            ...formData,
                            [field.id]: toggleMultiSelectValue(formData[field.id], option),
                          })
                        }
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                      />
                      {option}
                    </label>
                  );
                })}
              </div>
            )
          ) : (
            <p className="text-xs text-amber-600">
              Este campo no tiene opciones configuradas.
            </p>
          )}
        </div>
      )}

      {field.type === "checkbox" && (
        <label className="flex items-center gap-2 mt-2 text-sm text-slate-600 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(formData[field.id])}
            onChange={(event) => setFormData({ ...formData, [field.id]: event.target.checked })}
            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4"
          />
          Confirmar
        </label>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-xl w-full max-w-xl flex flex-col max-h-[90vh]">
        <div className="flex items-start justify-between p-6 border-b border-slate-100">
          <div>
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <Plus className="text-indigo-600" size={22} />
              Registrar incremento
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              {getTaskTitle(task)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
            disabled={isSubmitting}
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          <div className="grid grid-cols-3 gap-3 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">Actual</p>
              <p className="text-lg font-bold text-slate-800">{currentValue}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">Meta</p>
              <p className="text-lg font-bold text-slate-800">{targetValue}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">Resultado</p>
              <p className="text-lg font-bold text-slate-800">{nextValue}</p>
            </div>
          </div>

          {isRateDriven && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
              <p className="font-bold">Incremento gobernado por Rate Card</p>
              <p className="mt-1 text-xs">
                Esta tarea solo avanza cuando se reporta el Rate Card configurado
                {rateBinding?.assigneeMode === "fixed" ? " por la persona seleccionada" : ""}
                {rateBinding?.dateMode === "range" ? " dentro del periodo definido" : ""}.
              </p>
            </div>
          )}

          {delegatesIncrementToSubtasks && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <p className="font-bold">Incremento delegado a subtareas</p>
              <p className="mt-1 text-xs">
                Esta matriz se completa automáticamente cuando todas sus subtareas incrementales alcanzan su meta.
              </p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Incrementar en <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              disabled={isRateDriven || delegatesIncrementToSubtasks}
              className="w-full h-11 px-4 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
              autoFocus
            />
            <p className="mt-1 text-xs text-slate-500">
              Unidad: {task.indicator || "contador"}. La tarea se completará al llegar a la meta.
            </p>
          </div>

          {incrementForm?.fields?.length ? (
            <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <ClipboardList size={16} className="text-indigo-600" />
                {incrementForm.title || "Formulario de incremento"}
              </h3>
              {incrementForm.fields.map(renderField)}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
              Esta tarea no tiene formulario personalizado; solo se registrará el incremento.
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Comentario opcional
            </label>
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              className="w-full min-h-[76px] p-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm resize-none"
              placeholder="Notas del incremento"
            />
          </div>
        </div>

        <div className="p-6 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting || isRateDriven || delegatesIncrementToSubtasks} className="bg-indigo-600 hover:bg-indigo-700 text-white min-w-[150px]">
            {isSubmitting ? (
              <>
                <Loader2 size={16} className="mr-2 animate-spin" />
                Guardando...
              </>
            ) : (
              "Registrar"
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
