import React, { useState } from 'react';
import { X, Plus, Trash2, GripVertical, Settings, FolderTree, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { getStaticRateCardAssignmentKey, isInvalidRateCardUnits, normalizeRateCardUnits } from '@/lib/rate-card-config';
import {
  DocumentDestinationExplorer,
  type DocumentRepositoryDestination,
} from '@/components/projects/DocumentDestinationExplorer';

export interface FormField {
  id: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'datetime' | 'select' | 'checkbox' | 'document';
  required: boolean;
  options?: string[];
  selectionMode?: 'single' | 'multiple';
  documentFolderPath?: string;
  documentName?: string;
  documentVersioning?: boolean;
  documentKey?: string;
  documentDestinationMode?: 'task' | 'repository';
  documentDestinationProjectId?: string;
  documentDestinationProjectName?: string;
  documentDestinationFolderId?: string | null;
  documentDestinationFolderPath?: string;
  documentDestinationFolderNames?: string[];
}

const normalizeDocumentKey = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

export interface FormRateCardItem {
  id: string;
  rateCardId: string;
  unitsToAdd: number | string;
  autoAddUnits: boolean;
  assigneeMode?: 'default' | 'fixed' | 'runtime';
  assignToProfessional?: boolean;
  assignedTo?: string | null;
}

export interface CustomForm {
  title: string;
  fields: FormField[];
  rateCards?: FormRateCardItem[];
  rateCardMode?: 'static' | 'dynamic' | null;
  dynamicRateCard?: boolean;
  dynamicRateCardConfig?: {
    defaultUnits: number;
    requirePerson: boolean;
    requireRateCard: boolean;
    promptForUnits?: boolean;
  } | null;
  rateCardId?: string | null;
  unitsToAdd?: number | string | null;
  autoAddUnits?: boolean | null;
  assigneeMode?: 'default' | 'fixed' | 'runtime' | null;
  assignToProfessional?: boolean | null;
  assignedTo?: string | null;
}

interface WorkflowStepFormBuilderModalProps {
  isOpen: boolean;
  onClose: () => void;
  stepName: string;
  initialForm?: CustomForm;
  rateCards?: any[];
  teamMembers?: any[];
  allowDynamicRateCard?: boolean;
  overlayClassName?: string;
  projectId?: string;
  project?: any;
  onSave: (form: CustomForm | undefined) => void;
}

export const WorkflowStepFormBuilderModal: React.FC<WorkflowStepFormBuilderModalProps> = ({
  isOpen,
  onClose,
  stepName,
  initialForm,
  rateCards = [],
  teamMembers = [],
  allowDynamicRateCard = true,
  overlayClassName = 'z-50',
  projectId = '',
  project,
  onSave
}) => {
  const [title, setTitle] = useState(initialForm?.title || `Formulario para ${stepName}`);
  const [fields, setFields] = useState<FormField[]>(initialForm?.fields || []);
  const [formRateCardMode, setFormRateCardMode] = useState<'none' | 'static' | 'dynamic'>(
    allowDynamicRateCard && (initialForm?.dynamicRateCard || initialForm?.rateCardMode === 'dynamic')
      ? 'dynamic'
      : (initialForm?.rateCards?.length || initialForm?.rateCardId)
        ? 'static'
        : 'none'
  );
  const getInitialStaticRateCards = React.useCallback(
    (form?: CustomForm): FormRateCardItem[] => {
      if (form?.rateCards?.length) {
        return form.rateCards.map((item, index) => ({
          id: item.id || `form_rc_initial_${item.rateCardId || 'empty'}_${index}`,
          rateCardId: item.rateCardId || '',
          unitsToAdd: normalizeRateCardUnits(item.unitsToAdd),
          autoAddUnits: item.autoAddUnits !== false,
          assigneeMode: item.assigneeMode || (item.assignToProfessional ? 'fixed' : 'default'),
          assignToProfessional: Boolean(item.assignToProfessional || item.assigneeMode === 'fixed' || item.assigneeMode === 'runtime'),
          assignedTo: item.assignedTo || '',
        }));
      }

      if (form?.rateCardId) {
        return [
          {
            id: 'form_rc_legacy',
            rateCardId: form.rateCardId,
            unitsToAdd: normalizeRateCardUnits(form.unitsToAdd),
            autoAddUnits: form.autoAddUnits !== false,
            assigneeMode: form.assigneeMode || (form.assignToProfessional ? 'fixed' : 'default'),
            assignToProfessional: Boolean(form.assignToProfessional || form.assigneeMode === 'fixed' || form.assigneeMode === 'runtime'),
            assignedTo: form.assignedTo || '',
          },
        ];
      }

      return [];
    },
    []
  );
  const [formRateCards, setFormRateCards] = useState<FormRateCardItem[]>(() => getInitialStaticRateCards(initialForm));
  const [formUnitsToAdd, setFormUnitsToAdd] = useState<string>(
    String(normalizeRateCardUnits(initialForm?.unitsToAdd ?? initialForm?.dynamicRateCardConfig?.defaultUnits))
  );
  const [formAutoAddUnits, setFormAutoAddUnits] = useState(initialForm?.autoAddUnits !== false);
  const [destinationFieldIndex, setDestinationFieldIndex] = useState<number | null>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    Promise.resolve().then(() => {
      setTitle(initialForm?.title || `Formulario para ${stepName}`);
      setFields(initialForm?.fields || []);
      setFormRateCardMode(
        allowDynamicRateCard && (initialForm?.dynamicRateCard || initialForm?.rateCardMode === 'dynamic')
          ? 'dynamic'
          : (initialForm?.rateCards?.length || initialForm?.rateCardId)
            ? 'static'
            : 'none'
      );
      setFormRateCards(getInitialStaticRateCards(initialForm));
      setFormUnitsToAdd(String(normalizeRateCardUnits(initialForm?.unitsToAdd ?? initialForm?.dynamicRateCardConfig?.defaultUnits)));
      setFormAutoAddUnits(initialForm?.autoAddUnits !== false);
      setDestinationFieldIndex(null);
    });
  }, [allowDynamicRateCard, getInitialStaticRateCards, initialForm, isOpen, stepName]);

  if (!isOpen) return null;

  const addField = () => {
    setFields([
      ...fields,
      {
        id: `field_${Date.now()}`,
        label: 'Nuevo Campo',
        type: 'text',
        required: false
      }
    ]);
  };

  const updateField = (index: number, updates: Partial<FormField>) => {
    const newFields = [...fields];
    newFields[index] = { ...newFields[index], ...updates };
    setFields(newFields);
  };

  const removeField = (index: number) => {
    setFields(fields.filter((_, i) => i !== index));
  };

  const addOption = (fieldIndex: number) => {
    const field = fields[fieldIndex];
    updateField(fieldIndex, {
      options: [...(field.options || []), `Opción ${(field.options?.length || 0) + 1}`],
    });
  };

  const updateOption = (fieldIndex: number, optionIndex: number, value: string) => {
    const field = fields[fieldIndex];
    const options = [...(field.options || [])];
    options[optionIndex] = value;
    updateField(fieldIndex, { options });
  };

  const removeOption = (fieldIndex: number, optionIndex: number) => {
    const field = fields[fieldIndex];
    updateField(fieldIndex, {
      options: (field.options || []).filter((_, index) => index !== optionIndex),
    });
  };

  const addFormRateCard = () => {
    setFormRateCards((current) => [
      ...current,
      {
        id: `form_rc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        rateCardId: '',
        unitsToAdd: 1,
        autoAddUnits: true,
        assigneeMode: 'default',
        assignToProfessional: false,
        assignedTo: '',
      },
    ]);
  };

  const updateFormRateCard = (itemId: string, updates: Partial<FormRateCardItem>) => {
    setFormRateCards((current) =>
      current.map((item) => (item.id === itemId ? { ...item, ...updates } : item))
    );
  };

  const removeFormRateCard = (itemId: string) => {
    setFormRateCards((current) => current.filter((item) => item.id !== itemId));
  };

  const handleSave = () => {
    if (fields.length === 0 && formRateCardMode === 'none') {
      onSave(undefined);
      onClose();
      return;
    }

    const cleanedFields: FormField[] = fields.map((field) => {
      const cleanLabel = field.label.trim();
      if (field.type === 'document') {
        return {
          ...field,
          label: cleanLabel,
          options: undefined,
          selectionMode: undefined,
          documentFolderPath: String(field.documentFolderPath || '')
            .split(/[\\/]+/)
            .map((segment) => segment.trim())
            .filter((segment) => segment && segment !== '.' && segment !== '..')
            .join('/'),
          documentName: String(field.documentName || '').trim(),
          documentVersioning: Boolean(field.documentVersioning),
          documentKey: field.documentVersioning
            ? normalizeDocumentKey(field.documentKey || '')
            : undefined,
          documentDestinationMode: field.documentDestinationMode === 'repository' ? 'repository' : 'task',
          documentDestinationProjectId: field.documentDestinationMode === 'repository'
            ? String(field.documentDestinationProjectId || '').trim()
            : undefined,
          documentDestinationProjectName: field.documentDestinationMode === 'repository'
            ? String(field.documentDestinationProjectName || '').trim()
            : undefined,
          documentDestinationFolderId: field.documentDestinationMode === 'repository'
            ? field.documentDestinationFolderId || null
            : undefined,
          documentDestinationFolderPath: field.documentDestinationMode === 'repository'
            ? String(field.documentDestinationFolderPath || '').trim()
            : undefined,
          documentDestinationFolderNames: field.documentDestinationMode === 'repository'
            ? (field.documentDestinationFolderNames || []).map((name) => String(name).trim()).filter(Boolean)
            : undefined,
        };
      }

      if (field.type !== 'select') {
        return {
          ...field,
          label: cleanLabel,
          options: undefined,
          selectionMode: undefined,
          documentFolderPath: undefined,
          documentName: undefined,
          documentVersioning: undefined,
          documentKey: undefined,
          documentDestinationMode: undefined,
          documentDestinationProjectId: undefined,
          documentDestinationProjectName: undefined,
          documentDestinationFolderId: undefined,
          documentDestinationFolderPath: undefined,
          documentDestinationFolderNames: undefined,
        };
      }

      return {
        ...field,
        label: cleanLabel,
        selectionMode: field.selectionMode || 'multiple',
        options: (field.options || []).map((option) => option.trim()).filter(Boolean),
        documentFolderPath: undefined,
        documentName: undefined,
        documentVersioning: undefined,
        documentKey: undefined,
        documentDestinationMode: undefined,
        documentDestinationProjectId: undefined,
        documentDestinationProjectName: undefined,
        documentDestinationFolderId: undefined,
        documentDestinationFolderPath: undefined,
        documentDestinationFolderNames: undefined,
      };
    });

    const hasEmptyLabels = cleanedFields.some(f => !f.label.trim());
    if (hasEmptyLabels) {
      toast.warning('Todos los campos deben tener un nombre (label).');
      return;
    }

    const hasSelectWithoutOptions = cleanedFields.some(f => f.type === 'select' && (!f.options || f.options.length === 0));
    if (hasSelectWithoutOptions) {
      toast.warning('Los campos de selección deben tener al menos una opción.');
      return;
    }

    const hasDuplicateOptions = cleanedFields.some((field) => {
      if (field.type !== 'select') return false;
      const normalizedOptions = (field.options || []).map((option) => option.toLowerCase());
      return new Set(normalizedOptions).size !== normalizedOptions.length;
    });
    if (hasDuplicateOptions) {
      toast.warning('Las opciones de selección no pueden estar repetidas.');
      return;
    }

    const versionedDocumentsWithoutKey = cleanedFields.some(
      (field) => field.type === 'document' && field.documentVersioning && !field.documentKey
    );
    if (versionedDocumentsWithoutKey) {
      toast.warning('Cada documento con versiones debe tener una clave documental.');
      return;
    }

    const repositoryDocumentsWithoutDestination = cleanedFields.some(
      (field) =>
        field.type === 'document' &&
        field.documentDestinationMode === 'repository' &&
        !field.documentDestinationProjectId
    );
    if (repositoryDocumentsWithoutDestination) {
      toast.warning('Selecciona el repositorio de destino para cada documento configurado fuera de la tarea.');
      return;
    }

    const versionedDocumentKeys = cleanedFields
      .filter((field) => field.type === 'document' && field.documentVersioning)
      .map((field) => field.documentKey);
    if (new Set(versionedDocumentKeys).size !== versionedDocumentKeys.length) {
      toast.warning('No repitas la misma clave documental dentro de un formulario.');
      return;
    }

    const cleanedStaticRateCards = formRateCards
      .map((item) => ({
        ...item,
        unitsToAdd: normalizeRateCardUnits(item.unitsToAdd, 0),
        autoAddUnits: item.autoAddUnits !== false,
        assigneeMode: item.assigneeMode || (item.assignToProfessional ? 'fixed' : 'default'),
        assignToProfessional: (item.assigneeMode || (item.assignToProfessional ? 'fixed' : 'default')) !== 'default',
        assignedTo: (item.assigneeMode || (item.assignToProfessional ? 'fixed' : 'default')) === 'fixed' ? item.assignedTo || '' : '',
      }))
      .filter((item) => item.rateCardId);

    if (formRateCardMode === 'static' && cleanedStaticRateCards.length === 0) {
      toast.warning('Agrega al menos un Rate Card fijo para el formulario.');
      return;
    }

    const hasInvalidStaticUnits = cleanedStaticRateCards.some((item) => isInvalidRateCardUnits(item.unitsToAdd));
    if (formRateCardMode === 'static' && hasInvalidStaticUnits) {
      toast.warning('Define unidades de Rate Card en cero o mayores.');
      return;
    }

    const hasMissingStaticAssignee = cleanedStaticRateCards.some(
      (item) => item.assigneeMode === 'fixed' && !item.assignedTo
    );
    if (formRateCardMode === 'static' && hasMissingStaticAssignee) {
      toast.warning('Selecciona el profesional para cada Rate Card fijo asignable.');
      return;
    }

    const duplicateStaticRateCardAssignments = cleanedStaticRateCards.some((item, index) =>
      cleanedStaticRateCards.findIndex(
        (candidate) => getStaticRateCardAssignmentKey(candidate) === getStaticRateCardAssignmentKey(item)
      ) !== index
    );
    if (duplicateStaticRateCardAssignments) {
      toast.warning('Puedes repetir un Rate Card solo si se carga a profesionales diferentes.');
      return;
    }

    if (formRateCardMode === 'dynamic' && isInvalidRateCardUnits(formUnitsToAdd)) {
      toast.warning('Define unidades de Rate Card en cero o mayores.');
      return;
    }

    const rateCardConfig =
      formRateCardMode === 'none'
        ? {
            rateCards: [],
            rateCardMode: null,
            dynamicRateCard: false,
            dynamicRateCardConfig: null,
            rateCardId: null,
            unitsToAdd: null,
            autoAddUnits: true,
          }
        : formRateCardMode === 'dynamic'
          ? {
              rateCards: [],
              rateCardMode: 'dynamic' as const,
              dynamicRateCard: true,
              dynamicRateCardConfig: {
                defaultUnits: normalizeRateCardUnits(formUnitsToAdd),
                requirePerson: true,
                requireRateCard: true,
                promptForUnits: !formAutoAddUnits,
              },
              rateCardId: null,
              unitsToAdd: normalizeRateCardUnits(formUnitsToAdd),
              autoAddUnits: formAutoAddUnits,
            }
          : {
              rateCards: cleanedStaticRateCards,
              rateCardMode: 'static' as const,
              dynamicRateCard: false,
              dynamicRateCardConfig: null,
              rateCardId: cleanedStaticRateCards[0]?.rateCardId || null,
              unitsToAdd: cleanedStaticRateCards[0]?.unitsToAdd ?? 1,
              autoAddUnits: cleanedStaticRateCards[0]?.autoAddUnits !== false,
              assigneeMode: cleanedStaticRateCards[0]?.assigneeMode || 'default',
              assignToProfessional: cleanedStaticRateCards[0]?.assignToProfessional || false,
              assignedTo: cleanedStaticRateCards[0]?.assignedTo || null,
            };

    onSave({ title: title.trim(), fields: cleanedFields, ...rateCardConfig });
    onClose();
  };

  return (
    <div className={`fixed inset-0 bg-slate-900/50 backdrop-blur-sm ${overlayClassName} flex items-center justify-center p-4`}>
      <div className="bg-white text-slate-900 rounded-2xl shadow-xl w-full max-w-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Formulario Personalizado</h2>
            <p className="text-sm text-slate-500 mt-1">
              Paso: {stepName || 'Sin nombre'}
            </p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Nombre del Formulario
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-4 py-2 border border-slate-200 rounded-xl bg-white text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="Ej: Formulario de Aprobación"
            />
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Rate Cards del formulario
                </label>
                <select
                  value={formRateCardMode}
                  onChange={(event) => {
                    if (event.target.value === 'dynamic') {
                      setFormRateCardMode('dynamic');
                      return;
                    }

                    if (event.target.value === 'static') {
                      setFormRateCardMode('static');
                      if (formRateCards.length === 0) addFormRateCard();
                      return;
                    }

                    setFormRateCardMode('none');
                  }}
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                >
                  <option value="none">Sin Rate Card</option>
                  <option value="static">Rate Cards fijos</option>
                  {allowDynamicRateCard && <option value="dynamic">Rate Card dinámico</option>}
                </select>
              </div>

              {formRateCardMode === 'dynamic' && (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex h-10 items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 text-xs font-medium text-emerald-700">
                    <input
                      type="checkbox"
                      checked={formAutoAddUnits}
                      onChange={(event) => setFormAutoAddUnits(event.target.checked)}
                      className="rounded border-emerald-200 text-emerald-600 focus:ring-emerald-500"
                    />
                    Sumar auto.
                  </label>
                  {formAutoAddUnits && (
                    <input
                      type="text"
                      inputMode="decimal"
                      pattern="[0-9]*[.,]?[0-9]*"
                      value={formUnitsToAdd}
                      onChange={(event) => setFormUnitsToAdd(event.target.value)}
                      className="h-10 w-24 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                      placeholder="Ej. 0,051"
                      title="Puedes usar coma o punto decimal. Ejemplo: 0,051 o 0.051"
                    />
                  )}
                  <span className="basis-full text-[10px] font-bold text-emerald-700">
                    Decimales: puedes escribir 0,051 o 0.051; Pixel guarda el valor decimal normalizado.
                  </span>
                </div>
              )}
            </div>

            {formRateCardMode === 'static' && (
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Indicadores a sumar
                  </p>
                  <p className="text-[10px] font-bold text-slate-400">
                    Decimales: 0,051 o 0.051.
                  </p>
                  <Button
                    type="button"
                    onClick={addFormRateCard}
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs text-slate-700"
                  >
                    <Plus size={14} className="mr-1" />
                    Agregar Rate Card
                  </Button>
                </div>

                {formRateCards.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 bg-white p-4 text-center text-xs font-medium text-slate-500">
                    Agrega uno o varios Rate Cards para este formulario.
                  </div>
                ) : (
                  formRateCards.map((item) => (
                    <div key={item.id} className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto_auto] md:items-center">
                        <select
                          value={item.rateCardId}
                          onChange={(event) => updateFormRateCard(item.id, { rateCardId: event.target.value })}
                          className="h-9 min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                        >
                          <option value="">Selecciona Rate Card</option>
                          {rateCards.map((rateCard) => (
                            <option key={rateCard.id} value={rateCard.id}>
                              {rateCard.name}
                            </option>
                          ))}
                        </select>
                        <label className="flex h-9 items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 text-xs font-medium text-emerald-700">
                          <input
                            type="checkbox"
                            checked={item.autoAddUnits !== false}
                            onChange={(event) => updateFormRateCard(item.id, { autoAddUnits: event.target.checked })}
                            className="rounded border-emerald-200 text-emerald-600 focus:ring-emerald-500"
                          />
                          Sumar auto.
                        </label>
                        <input
                          type="text"
                          inputMode="decimal"
                          pattern="[0-9]*[.,]?[0-9]*"
                          value={item.unitsToAdd}
                          onChange={(event) => updateFormRateCard(item.id, { unitsToAdd: event.target.value })}
                          className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 md:w-24"
                          placeholder="Ej. 0,051"
                          title="Puedes usar coma o punto decimal. Ejemplo: 0,051 o 0.051"
                        />
                        <button
                          type="button"
                          onClick={() => removeFormRateCard(item.id)}
                          className="flex h-9 w-full items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 md:w-9"
                          title="Quitar Rate Card"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-[auto_minmax(0,1fr)] md:items-center">
                        <select
                          value={item.assigneeMode || (item.assignToProfessional ? 'fixed' : 'default')}
                          onChange={(event) => {
                            const mode = event.target.value as 'default' | 'fixed' | 'runtime';
                            updateFormRateCard(item.id, {
                              assigneeMode: mode,
                              assignToProfessional: mode !== 'default',
                              assignedTo: mode === 'fixed' ? item.assignedTo || '' : '',
                            });
                          }}
                          className="h-9 rounded-lg border border-indigo-100 bg-indigo-50 px-3 text-xs font-medium text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                        >
                          <option value="default">Responsable del paso</option>
                          <option value="fixed">Profesional fijo</option>
                          <option value="runtime">Pedir al ejecutar</option>
                        </select>
                        {(item.assigneeMode || (item.assignToProfessional ? 'fixed' : 'default')) === 'fixed' && (
                          <select
                            value={item.assignedTo || ''}
                            onChange={(event) => updateFormRateCard(item.id, { assignedTo: event.target.value })}
                            className="h-9 min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                          >
                            <option value="">Selecciona profesional</option>
                            {teamMembers.map((member) => (
                              <option key={member.id} value={member.id}>
                                {member.name || member.email || 'Profesional'}
                              </option>
                            ))}
                          </select>
                        )}
                        {(item.assigneeMode || (item.assignToProfessional ? 'fixed' : 'default')) === 'runtime' && (
                          <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                            Se solicitará el profesional al aprobar este paso.
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
            {formRateCardMode !== 'none' && (
              <p className="mt-2 text-[10px] text-emerald-700">
                {formRateCardMode === 'dynamic'
                  ? `Al aprobar el formulario se pedirá persona y perfil; ${formAutoAddUnits ? 'usará las unidades configuradas.' : 'también pedirá unidades.'}`
                  : 'Al aprobar el formulario se cargarán todos los Rate Cards configurados; los que no tengan suma automática pedirán unidades.'}
              </p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-4">
              <label className="block text-sm font-medium text-slate-700">
                Campos del Formulario
              </label>
              <Button type="button" onClick={addField} size="sm" variant="outline" className="h-8 text-xs text-slate-700">
                <Plus size={14} className="mr-1" /> Agregar Campo
              </Button>
            </div>

            {fields.length === 0 ? (
              <div className="text-center py-8 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                <p className="text-sm text-slate-500">No hay campos definidos.</p>
                <p className="text-xs text-slate-400 mt-1">Agrega campos para solicitar información en este paso.</p>
                <Button type="button" onClick={addField} size="sm" variant="outline" className="mt-4 h-8 text-xs text-slate-700">
                  <Plus size={14} className="mr-1" /> Crear primer campo
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {fields.map((field, index) => (
                  <div key={field.id} className="flex items-start gap-3 p-4 bg-white border border-slate-200 rounded-xl shadow-sm">
                    <div className="mt-2 text-slate-300 cursor-move">
                      <GripVertical size={16} />
                    </div>
                    <div className="flex-1 space-y-3">
                      <div className="flex gap-3">
                        <div className="flex-1">
                          <input
                            type="text"
                            value={field.label}
                            onChange={(e) => updateField(index, { label: e.target.value })}
                            placeholder="Nombre del campo"
                            className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>
                        <div className="w-40">
                          <select
                            value={field.type}
                            onChange={(e) => {
                              const type = e.target.value as FormField['type'];
                              updateField(index, {
                                type,
                                ...(type === 'select'
                                  ? {
                                      selectionMode: field.selectionMode || 'multiple',
                                      options: field.options?.length ? field.options : ['Opción 1'],
                                    }
                                  : {}),
                                ...(type === 'document'
                                  ? {
                                      documentFolderPath: field.documentFolderPath || '',
                                      documentName: field.documentName || field.label,
                                      documentVersioning: Boolean(field.documentVersioning),
                                      documentKey: field.documentKey || '',
                                      documentDestinationMode: field.documentDestinationMode || 'task',
                                    }
                                  : {}),
                              });
                            }}
                            className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 focus:ring-2 focus:ring-indigo-500"
                          >
                            <option value="text">Texto corto</option>
                            <option value="number">Número</option>
                            <option value="date">Fecha</option>
                            <option value="datetime">Fecha y hora</option>
                            <option value="select">Selección</option>
                            <option value="checkbox">Casilla de verificación</option>
                            <option value="document">Adjuntar documento</option>
                          </select>
                        </div>
                      </div>

                      {field.type === 'select' && (
                        <div className="space-y-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <span className="text-xs font-medium text-slate-600">
                              Opciones de respuesta
                            </span>
                            <select
                              value={field.selectionMode || 'multiple'}
                              onChange={(e) =>
                                updateField(index, {
                                  selectionMode: e.target.value as FormField['selectionMode'],
                                })
                              }
                              className="h-8 px-2 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white text-slate-900"
                            >
                              <option value="single">Selección única</option>
                              <option value="multiple">Selección múltiple</option>
                            </select>
                          </div>

                          <div className="space-y-2">
                            {(field.options || []).map((option, optionIndex) => (
                              <div key={`${field.id}-option-${optionIndex}`} className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={option}
                                  onChange={(e) => updateOption(index, optionIndex, e.target.value)}
                                  placeholder={`Opción ${optionIndex + 1}`}
                                  className="flex-1 px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white text-slate-900 placeholder:text-slate-400"
                                />
                                <button
                                  type="button"
                                  onClick={() => removeOption(index, optionIndex)}
                                  className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                  title="Eliminar opción"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            ))}
                          </div>

                          <Button
                            type="button"
                            onClick={() => addOption(index)}
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs text-slate-700"
                          >
                            <Plus size={14} className="mr-1" />
                            Agregar opción
                          </Button>
                        </div>
                      )}

                      {field.type === 'document' && (
                        <div className="space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/50 p-3">
                          <div>
                            <label className="mb-2 block text-xs font-bold text-slate-700">
                              Ubicación en el gestor documental
                            </label>
                            <div className="grid grid-cols-2 gap-2 rounded-lg bg-white p-1 shadow-sm ring-1 ring-indigo-100">
                              <button
                                type="button"
                                onClick={() => updateField(index, { documentDestinationMode: 'task' })}
                                className={`rounded-md px-3 py-2 text-xs font-bold transition ${field.documentDestinationMode !== 'repository' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
                              >
                                Dentro de la tarea
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  updateField(index, { documentDestinationMode: 'repository' });
                                  setDestinationFieldIndex(index);
                                }}
                                className={`rounded-md px-3 py-2 text-xs font-bold transition ${field.documentDestinationMode === 'repository' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
                              >
                                Elegir repositorio
                              </button>
                            </div>
                          </div>

                          {field.documentDestinationMode === 'repository' ? (
                            <div className="rounded-lg border border-indigo-100 bg-white p-3">
                              <div className="flex items-start gap-3">
                                <div className="rounded-lg bg-indigo-50 p-2 text-indigo-600">
                                  <FolderTree size={18} />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Destino seleccionado</p>
                                  {field.documentDestinationProjectId ? (
                                    <>
                                      <p className="mt-1 truncate text-sm font-black text-slate-800">
                                        {field.documentDestinationProjectName || 'Proyecto seleccionado'}
                                      </p>
                                      <p className="mt-0.5 flex items-start gap-1 text-[11px] leading-4 text-slate-500">
                                        <MapPin size={12} className="mt-0.5 shrink-0" />
                                        <span>Documentación del proyecto{field.documentDestinationFolderPath ? ` / ${field.documentDestinationFolderPath}` : ''}</span>
                                      </p>
                                    </>
                                  ) : (
                                    <p className="mt-1 text-xs text-amber-700">Aún no has elegido una ubicación.</p>
                                  )}
                                </div>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setDestinationFieldIndex(index)}
                                  disabled={!projectId}
                                  className="h-8 shrink-0 border-indigo-200 text-xs text-indigo-700"
                                >
                                  Explorar
                                </Button>
                              </div>
                              {!projectId && (
                                <p className="mt-2 text-[11px] text-amber-700">
                                  Guarda este formulario desde un proyecto para habilitar el explorador.
                                </p>
                              )}
                            </div>
                          ) : (
                            <div>
                              <label className="mb-1 block text-xs font-bold text-slate-700">
                                Ruta dentro de la tarea
                              </label>
                              <input
                                type="text"
                                value={field.documentFolderPath || ''}
                                onChange={(event) => updateField(index, { documentFolderPath: event.target.value })}
                                placeholder="Ej. Entregables/Informes técnicos"
                                className="w-full rounded-lg border border-indigo-100 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500"
                              />
                              <p className="mt-1 text-[11px] leading-4 text-slate-500">
                                Se creará bajo la carpeta de esta tarea. Usa / para definir subcarpetas.
                              </p>
                            </div>
                          )}

                          <div>
                            <label className="mb-1 block text-xs font-bold text-slate-700">
                              Nombre del documento en el repositorio
                            </label>
                            <input
                              type="text"
                              value={field.documentName || ''}
                              onChange={(event) => updateField(index, { documentName: event.target.value })}
                              placeholder={field.label || 'Informe técnico'}
                              className="w-full rounded-lg border border-indigo-100 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500"
                            />
                          </div>

                          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-white bg-white p-3 shadow-sm">
                            <input
                              type="checkbox"
                              checked={Boolean(field.documentVersioning)}
                              onChange={(event) =>
                                updateField(index, {
                                  documentVersioning: event.target.checked,
                                  documentKey: event.target.checked
                                    ? field.documentKey || normalizeDocumentKey(field.documentName || field.label)
                                    : '',
                                })
                              }
                              className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <span>
                              <span className="block text-xs font-black text-slate-800">
                                Mantener un único documento con versiones
                              </span>
                              <span className="mt-1 block text-[11px] leading-4 text-slate-500">
                                Las cargas posteriores reemplazan la versión visible, pero Pixel conserva el historial completo.
                              </span>
                            </span>
                          </label>

                          {field.documentVersioning && (
                            <div>
                              <label className="mb-1 block text-xs font-bold text-slate-700">
                                Clave documental compartida
                              </label>
                              <input
                                type="text"
                                value={field.documentKey || ''}
                                onChange={(event) => updateField(index, { documentKey: normalizeDocumentKey(event.target.value) })}
                                placeholder="informe-tecnico"
                                className="w-full rounded-lg border border-indigo-100 bg-white px-3 py-2 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500"
                              />
                              <p className="mt-1 text-[11px] leading-4 text-slate-500">
                                Usa exactamente esta misma clave en otros pasos para publicar una nueva versión del mismo documento.
                              </p>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id={`required-${field.id}`}
                          checked={field.required}
                          onChange={(e) => updateField(index, { required: e.target.checked })}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <label htmlFor={`required-${field.id}`} className="text-xs text-slate-600">
                          Campo obligatorio
                        </label>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeField(index)}
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="p-6 border-t border-slate-100 flex justify-end gap-3 bg-slate-50 rounded-b-2xl">
          <Button type="button" variant="outline" onClick={onClose} className="text-slate-700">
            Cancelar
          </Button>
          <Button type="button" onClick={handleSave} className="bg-indigo-600 hover:bg-indigo-700 text-white">
            Guardar Formulario
          </Button>
        </div>
      </div>
      {destinationFieldIndex !== null && fields[destinationFieldIndex] && (
        <DocumentDestinationExplorer
          isOpen={destinationFieldIndex !== null}
          onClose={() => setDestinationFieldIndex(null)}
          sourceProjectId={projectId}
          sourceProject={project}
          initialDestination={{
            projectId: fields[destinationFieldIndex].documentDestinationProjectId,
            projectName: fields[destinationFieldIndex].documentDestinationProjectName,
            folderId: fields[destinationFieldIndex].documentDestinationFolderId,
            folderPath: fields[destinationFieldIndex].documentDestinationFolderPath,
            folderNames: fields[destinationFieldIndex].documentDestinationFolderNames,
          }}
          onSelect={(destination: DocumentRepositoryDestination) =>
            updateField(destinationFieldIndex, {
              documentDestinationMode: 'repository',
              documentDestinationProjectId: destination.projectId,
              documentDestinationProjectName: destination.projectName,
              documentDestinationFolderId: destination.folderId,
              documentDestinationFolderPath: destination.folderPath,
              documentDestinationFolderNames: destination.folderNames,
            })
          }
        />
      )}
    </div>
  );
};
