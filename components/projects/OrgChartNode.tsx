import React, { useState } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import Image from 'next/image';
import { Input } from '@/components/ui/input';
import { Users, WalletCards } from 'lucide-react';

const statusStyles: Record<string, { dot: string; chip: string }> = {
  covered: {
    dot: 'bg-emerald-500',
    chip: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  },
  gap: {
    dot: 'bg-amber-500',
    chip: 'bg-amber-50 text-amber-700 ring-amber-100',
  },
  uncovered: {
    dot: 'bg-red-500',
    chip: 'bg-red-50 text-red-700 ring-red-100',
  },
};

const currencyFormatter = (value: number, currency = 'COP') =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'COP' ? 0 : 2,
  }).format(Number.isFinite(value) ? value : 0);

export function OrgChartNode({ data, isConnectable, selected }: NodeProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [label, setLabel] = useState(String(data.label || 'Nodo'));
  const coverageStatus = String(data.coverageStatus || 'uncovered');
  const style = statusStyles[coverageStatus] || statusStyles.uncovered;
  const budgetAmount = typeof data.budgetAmount === 'number' ? data.budgetAmount : null;
  const canEdit = data.canEdit === true;
  const alias = String(data.alias || data.member || 'Cargo sin definir');
  const aliasValue = String(data.alias || data.member || '');

  const onBlur = () => {
    setIsEditing(false);
    if (typeof data.onChange === 'function') {
      (data.onChange as (label: string) => void)(label);
    }
  };

  return (
    <div className={`min-w-[240px] overflow-hidden rounded-2xl border bg-white shadow-lg shadow-slate-900/8 transition ${selected ? 'border-indigo-500 ring-4 ring-indigo-100' : 'border-slate-200'}`}>
      <Handle type="target" position={Position.Top} isConnectable={isConnectable} className="h-3 w-3 bg-indigo-500" />

      <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full bg-indigo-100 text-indigo-700 ring-1 ring-indigo-100">
            {data.photoURL ? (
              <Image src={data.photoURL as string} alt={label} fill className="object-cover" referrerPolicy="no-referrer" />
            ) : (
              <span className="flex h-full w-full items-center justify-center">
                <Users size={18} />
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            {isEditing ? (
              <Input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                onBlur={onBlur}
                autoFocus
                className="nodrag nowheel h-8 border-slate-200 bg-white text-sm font-black"
                onMouseDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onBlur();
                }}
              />
            ) : (
              <button
                type="button"
                className="block max-w-full truncate text-left text-sm font-black text-slate-950 hover:text-indigo-700"
                onDoubleClick={() => setIsEditing(true)}
              >
                {label}
              </button>
            )}
            {selected && canEdit ? (
              <Input
                value={aliasValue}
                placeholder="Alias o cargo"
                onChange={(event) => {
                  if (typeof data.onAliasChange === 'function') {
                    (data.onAliasChange as (alias: string) => void)(event.target.value);
                  }
                }}
                onMouseDown={(event) => event.stopPropagation()}
                className="nodrag nowheel mt-1 h-7 border-indigo-100 bg-white text-xs font-bold text-slate-600"
              />
            ) : (
              <p className="mt-0.5 truncate text-xs font-bold text-slate-500">{alias}</p>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-3 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ring-1 ${style.chip}`}>
            <span className={`h-2 w-2 rounded-full ${style.dot}`} />
            {String(data.coverageLabel || 'Sin cobertura')}
          </span>
        </div>

        <div className="rounded-xl bg-slate-50 px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
              <WalletCards size={13} />
              Presupuesto
            </span>
            <span className="text-xs font-black text-slate-900">
              {budgetAmount == null ? 'Protegido' : currencyFormatter(budgetAmount)}
            </span>
          </div>
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} isConnectable={isConnectable} className="h-3 w-3 bg-indigo-500" />
    </div>
  );
}
