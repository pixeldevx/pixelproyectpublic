"use client"

import React from 'react';
import Link from 'next/link';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import InboxHub from '@/components/dashboard/InboxHub';
import { Inbox, ChevronLeft } from 'lucide-react';

export default function WorkflowsPage() {
  return (
    <DashboardLayout>
      <div className="mx-auto max-w-[1600px] space-y-4 sm:p-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 mb-2">
              <Link href="/dashboard" className="text-xs font-medium text-slate-500 hover:text-indigo-600 transition-colors flex items-center gap-1">
                <ChevronLeft size={12} />
                Regresar al Dashboard
              </Link>
            </div>
            <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Inbox className="text-indigo-600" size={22} />
              Bandeja de entrada
            </h1>
          </div>
        </div>

        <InboxHub />
      </div>
    </DashboardLayout>
  );
}
