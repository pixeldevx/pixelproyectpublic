"use client";

import React, { useEffect, useId, useMemo, useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { onSnapshot } from '@/lib/supabase/document-store';
import { cn } from '@/lib/utils';
import {
  createScrumStoryCatalogEntry,
  getScrumStoryCatalogCollection,
  mergeScrumStoryCatalogEntries,
  normalizeScrumStoryCatalogEntry,
  normalizeScrumStoryCatalogLabel,
  SCRUM_STORY_CATALOG_LABELS,
  SCRUM_STORY_CATALOG_TYPES,
  type ScrumStoryCatalogActor,
  type ScrumStoryCatalogEntry,
  type ScrumStoryCatalogType,
} from '@/lib/scrum-story-catalogs';

type SharedProps = {
  projectId: string;
  catalogType: ScrumStoryCatalogType;
  currentUser?: ScrumStoryCatalogActor | null;
  label?: string;
  description?: string;
  placeholder?: string;
  createPlaceholder?: string;
  disabled?: boolean;
  required?: boolean;
  canCreate?: boolean;
  createTemplate?: Record<string, any>;
  className?: string;
  onEntrySelected?: (entry: ScrumStoryCatalogEntry) => void;
  catalogEntries?: ScrumStoryCatalogEntry[];
  catalogLoading?: boolean;
  catalogError?: string;
};

type SingleProps = SharedProps & {
  multiple?: false;
  value: string;
  onChange: (value: string) => void;
};

type MultipleProps = SharedProps & {
  multiple: true;
  value: string[];
  onChange: (value: string[]) => void;
};

export type ScrumStoryCatalogSelectProps = SingleProps | MultipleProps;

export const useScrumStoryCatalogCollection = ({
  projectId,
}: {
  projectId: string;
}) => {
  const [storedEntries, setStoredEntries] = useState<ScrumStoryCatalogEntry[]>([]);
  const [loadState, setLoadState] = useState<{
    projectId: string;
    status: 'ready' | 'error';
    message: string;
  }>({ projectId: '', status: 'ready', message: '' });

  useEffect(() => {
    if (!projectId) return;
    return onSnapshot(
      getScrumStoryCatalogCollection(projectId),
      (snapshot) => {
        const entries = snapshot.docs
          .map((entry) => normalizeScrumStoryCatalogEntry(entry.id, entry.data()))
          .filter((entry): entry is ScrumStoryCatalogEntry => Boolean(entry));
        setStoredEntries(entries);
        setLoadState({ projectId, status: 'ready', message: '' });
      },
      (loadError) => {
        console.error('Error loading Scrum story catalog:', loadError);
        setLoadState({
          projectId,
          status: 'error',
          message: 'No se pudo cargar el catálogo del proyecto.',
        });
      },
    );
  }, [projectId]);

  const entriesByType = useMemo(() => Object.fromEntries(
    SCRUM_STORY_CATALOG_TYPES.map((catalogType) => [
      catalogType,
      mergeScrumStoryCatalogEntries({ projectId, catalogType, storedEntries }),
    ]),
  ) as Record<ScrumStoryCatalogType, ScrumStoryCatalogEntry[]>, [projectId, storedEntries]);
  const activeEntriesByType = useMemo(() => Object.fromEntries(
    SCRUM_STORY_CATALOG_TYPES.map((catalogType) => [
      catalogType,
      entriesByType[catalogType].filter((entry) => entry.active),
    ]),
  ) as Record<ScrumStoryCatalogType, ScrumStoryCatalogEntry[]>, [entriesByType]);

  return {
    entriesByType,
    activeEntriesByType,
    storedEntries,
    loading: Boolean(projectId) && loadState.projectId !== projectId,
    error: !projectId
      ? 'No se identificó el proyecto.'
      : loadState.projectId === projectId && loadState.status === 'error'
        ? loadState.message
        : '',
  };
};

export const useScrumStoryCatalog = ({
  projectId,
  catalogType,
}: {
  projectId: string;
  catalogType: ScrumStoryCatalogType;
}) => {
  const catalog = useScrumStoryCatalogCollection({ projectId });
  return {
    entries: catalog.entriesByType[catalogType],
    activeEntries: catalog.activeEntriesByType[catalogType],
    storedEntries: catalog.storedEntries.filter((entry) => entry.catalogType === catalogType),
    loading: catalog.loading,
    error: catalog.error,
  };
};

const inputClassName = 'h-10 min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400';

function ScrumStoryCatalogSelectView({
  props,
  activeEntries,
  loading,
  error,
}: {
  props: ScrumStoryCatalogSelectProps;
  activeEntries: ScrumStoryCatalogEntry[];
  loading: boolean;
  error: string;
}) {
  const {
    projectId,
    catalogType,
    currentUser,
    label = SCRUM_STORY_CATALOG_LABELS[catalogType],
    description,
    placeholder = `Selecciona ${SCRUM_STORY_CATALOG_LABELS[catalogType].toLowerCase()}`,
    createPlaceholder = `Nuevo ${SCRUM_STORY_CATALOG_LABELS[catalogType].toLowerCase()}`,
    disabled = false,
    required = false,
    canCreate = false,
    createTemplate,
    className,
    onEntrySelected,
  } = props;
  const [isCreating, setIsCreating] = useState(false);
  const [newValue, setNewValue] = useState('');
  const [saving, setSaving] = useState(false);
  const selectId = useId();
  const descriptionId = useId();
  const selectedValues = useMemo(
    () => props.multiple ? props.value : props.value ? [props.value] : [],
    [props.multiple, props.value],
  );

  const optionEntries = useMemo(() => {
    const entries = [...activeEntries];
    const known = new Set(entries.map((entry) => entry.normalizedLabel));
    selectedValues.forEach((selectedValue) => {
      const normalizedLabel = normalizeScrumStoryCatalogLabel(selectedValue);
      if (!normalizedLabel || known.has(normalizedLabel)) return;
      known.add(normalizedLabel);
      entries.push({
        id: `legacy--${normalizedLabel}`,
        projectId,
        catalogType,
        label: selectedValue,
        normalizedLabel,
        active: true,
        source: 'project',
      });
    });
    return entries.sort((left, right) => {
      const orderDifference = Number(left.sortOrder ?? 10_000) - Number(right.sortOrder ?? 10_000);
      if (orderDifference !== 0) return orderDifference;
      return left.label.localeCompare(right.label, 'es', { sensitivity: 'base' });
    });
  }, [activeEntries, catalogType, projectId, selectedValues]);

  const applySelection = (entry: ScrumStoryCatalogEntry) => {
    if (props.multiple) {
      const exists = props.value.some(
        (value) => normalizeScrumStoryCatalogLabel(value) === entry.normalizedLabel,
      );
      if (!exists) props.onChange([...props.value, entry.label]);
    } else {
      props.onChange(entry.label);
    }
    onEntrySelected?.(entry);
  };

  const handleSelect = (selectedLabel: string) => {
    if (!selectedLabel) {
      if (!props.multiple) props.onChange('');
      return;
    }
    const normalizedLabel = normalizeScrumStoryCatalogLabel(selectedLabel);
    const entry = optionEntries.find((option) => option.normalizedLabel === normalizedLabel);
    if (entry) applySelection(entry);
  };

  const handleCreate = async () => {
    const cleanValue = newValue.replace(/\s+/g, ' ').trim();
    if (!cleanValue || saving || disabled || !canCreate) return;
    setSaving(true);
    try {
      const existing = activeEntries.find(
        (entry) => entry.normalizedLabel === normalizeScrumStoryCatalogLabel(cleanValue),
      );
      const entry = existing || await createScrumStoryCatalogEntry({
        projectId,
        catalogType,
        label: cleanValue,
        template: createTemplate,
        actor: currentUser,
      });
      applySelection(entry);
      setNewValue('');
      setIsCreating(false);
      toast.success(existing ? 'Valor seleccionado.' : 'Valor agregado al catálogo del proyecto.');
    } catch (createError: any) {
      console.error('Error creating Scrum story catalog entry:', createError);
      toast.error(createError?.message || 'No se pudo agregar el valor al catálogo.');
    } finally {
      setSaving(false);
    }
  };

  const removeSelectedValue = (selectedValue: string) => {
    if (!props.multiple || disabled) return;
    const normalizedValue = normalizeScrumStoryCatalogLabel(selectedValue);
    props.onChange(props.value.filter(
      (value) => normalizeScrumStoryCatalogLabel(value) !== normalizedValue,
    ));
  };

  return (
    <div className={cn('min-w-0', className)}>
      <div className="mb-1.5 flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <label htmlFor={selectId} className="block text-[11px] font-black uppercase tracking-[0.14em] text-slate-600">
            {label}{required ? ' *' : ''}
          </label>
          {description && <p id={descriptionId} className="mt-1 text-xs font-medium leading-5 text-slate-500">{description}</p>}
        </div>
        {canCreate && !disabled && (
          <button
            type="button"
            onClick={() => setIsCreating((current) => !current)}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-black text-violet-700 transition hover:bg-violet-50"
          >
            {isCreating ? <X size={13} /> : <Plus size={13} />}
            {isCreating ? 'Cancelar' : 'Crear'}
          </button>
        )}
      </div>

      {props.multiple && selectedValues.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selectedValues.map((selectedValue) => (
            <span key={normalizeScrumStoryCatalogLabel(selectedValue)} className="inline-flex max-w-full items-center gap-1 rounded-lg bg-violet-50 px-2 py-1 text-xs font-bold text-violet-800 ring-1 ring-violet-100">
              <span className="truncate">{selectedValue}</span>
              {!disabled && (
                <button type="button" onClick={() => removeSelectedValue(selectedValue)} className="rounded p-0.5 hover:bg-violet-100" aria-label={`Quitar ${selectedValue}`}>
                  <X size={12} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      <div className="flex min-w-0 items-center gap-2">
        <select
          id={selectId}
          aria-describedby={description ? descriptionId : undefined}
          value={props.multiple ? '' : props.value}
          onChange={(event) => handleSelect(event.target.value)}
          disabled={disabled || loading}
          required={required && !props.multiple}
          className={cn(inputClassName, 'w-full')}
        >
          <option value="">{loading ? 'Cargando catálogo...' : placeholder}</option>
          {optionEntries.map((entry) => (
            <option key={entry.id} value={entry.label}>{entry.label}</option>
          ))}
        </select>
        {loading && <Loader2 size={17} className="shrink-0 animate-spin text-violet-600" />}
      </div>

      {isCreating && canCreate && !disabled && (
        <div className="mt-2 flex min-w-0 gap-2 rounded-xl border border-violet-100 bg-violet-50/60 p-2">
          <input
            value={newValue}
            onChange={(event) => setNewValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void handleCreate();
              }
            }}
            maxLength={500}
            placeholder={createPlaceholder}
            autoFocus
            className={cn(inputClassName, 'w-full bg-white')}
          />
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={!newValue.trim() || saving}
            className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl bg-violet-600 px-3 text-sm font-black text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            <span className="ml-1.5 hidden sm:inline">Agregar</span>
          </button>
        </div>
      )}

      {error && <p className="mt-1.5 text-xs font-semibold text-rose-600">{error}</p>}
    </div>
  );
}

function ScrumStoryCatalogSelectWithSubscription({
  props,
}: {
  props: ScrumStoryCatalogSelectProps;
}) {
  const catalog = useScrumStoryCatalog({
    projectId: props.projectId,
    catalogType: props.catalogType,
  });
  return (
    <ScrumStoryCatalogSelectView
      props={props}
      activeEntries={catalog.activeEntries}
      loading={catalog.loading}
      error={catalog.error}
    />
  );
}

export function ScrumStoryCatalogSelect(props: ScrumStoryCatalogSelectProps) {
  if (props.catalogEntries !== undefined) {
    return (
      <ScrumStoryCatalogSelectView
        props={props}
        activeEntries={props.catalogEntries}
        loading={Boolean(props.catalogLoading)}
        error={props.catalogError || ''}
      />
    );
  }
  return <ScrumStoryCatalogSelectWithSubscription props={props} />;
}
