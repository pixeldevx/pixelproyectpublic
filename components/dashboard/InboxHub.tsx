"use client"

import { useState } from 'react';
import { CalendarDays, Inbox } from 'lucide-react';
import WorkflowTray from '@/components/dashboard/WorkflowTray';
import InboxCalendar from '@/components/dashboard/InboxCalendar';

export default function InboxHub() {
  const [activeView, setActiveView] = useState<'tray' | 'calendar'>('tray');

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        <button
          type="button"
          onClick={() => setActiveView('tray')}
          className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-bold transition-all ${
            activeView === 'tray'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-50 hover:text-indigo-700'
          }`}
        >
          <Inbox size={16} />
          Recibidos
        </button>
        <button
          type="button"
          onClick={() => setActiveView('calendar')}
          className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-bold transition-all ${
            activeView === 'calendar'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-50 hover:text-indigo-700'
          }`}
        >
          <CalendarDays size={16} />
          Calendario
        </button>
      </div>

      {activeView === 'tray' ? <WorkflowTray /> : <InboxCalendar />}
    </div>
  );
}
