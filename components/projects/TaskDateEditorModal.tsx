"use client"

import React, { useEffect, useState } from 'react';
import { Calendar, Save, X } from 'lucide-react';

interface TaskDateEditorModalProps {
  isOpen: boolean;
  task: any;
  onClose: () => void;
  onSave?: (taskId: string, start: Date, end: Date, task: any) => void | Promise<void>;
}

const getTaskTitle = (task: any) => task?.title || task?.name || 'Sin título';

const getTaskDate = (task: any, field: 'start' | 'end') => {
  const dateValue = task?.[field] || task?.[`${field}Date`];
  if (!dateValue) return new Date();
  if (dateValue.toDate) return dateValue.toDate();
  const parsed = new Date(dateValue);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

const toDateInputValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseDateInputValue = (value: string) => {
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const TaskDateEditorModal: React.FC<TaskDateEditorModalProps> = ({
  isOpen,
  task,
  onClose,
  onSave,
}) => {
  const [startValue, setStartValue] = useState('');
  const [endValue, setEndValue] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!task || !isOpen) return;
    setStartValue(toDateInputValue(getTaskDate(task, 'start')));
    setEndValue(toDateInputValue(getTaskDate(task, 'end')));
    setError('');
    setIsSaving(false);
  }, [task, isOpen]);

  if (!isOpen || !task) return null;

  const handleSave = async () => {
    const start = parseDateInputValue(startValue);
    const end = parseDateInputValue(endValue);

    if (!start || !end) {
      setError('Selecciona una fecha de inicio y una fecha de fin.');
      return;
    }

    if (start > end) {
      setError('La fecha de inicio no puede ser posterior a la fecha de fin.');
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      await onSave?.(task.id, start, end, task);
      onClose();
    } catch (saveError: any) {
      setError(saveError?.message || 'No se pudieron guardar las fechas.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 p-5">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
              <Calendar size={18} className="text-indigo-600" />
              Editar fechas
            </h2>
            <p className="mt-1 truncate text-sm text-slate-500">{getTaskTitle(task)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-slate-700">Fecha de inicio</span>
            <input
              type="date"
              value={startValue}
              onChange={(event) => setStartValue(event.target.value)}
              className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-800 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-slate-700">Fecha de fin</span>
            <input
              type="date"
              value={endValue}
              onChange={(event) => setEndValue(event.target.value)}
              className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-800 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10"
            />
          </label>

          {error && (
            <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-medium text-red-600">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 p-5">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-lg px-4 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-800"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !onSave}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Save size={15} className="mr-2" />
            {isSaving ? 'Guardando...' : 'Guardar fechas'}
          </button>
        </div>
      </div>
    </div>
  );
};
