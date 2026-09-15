"use client"

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { DashboardMetrics } from '@/hooks/useDashboardData';

export function PerformanceChart({ metrics }: { metrics: DashboardMetrics }) {
  const data = metrics.dailyProduction;

  return (
    <Card className="col-span-2 border-slate-200 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-semibold text-slate-900">Producción Diaria vs Meta</CardTitle>
        <CardDescription className="text-sm text-slate-500">
          Fichas catastrales cargadas en el GIS externo
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] w-full mt-4">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="colorRealizados" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="colorDevueltos" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} dx={-10} />
              <Tooltip 
                contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                itemStyle={{ fontSize: '14px', fontWeight: 500 }}
                labelStyle={{ fontSize: '12px', color: '#64748b', marginBottom: '4px' }}
              />
              <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px', color: '#64748b' }}/>
              <Area type="monotone" dataKey="meta" stroke="#94a3b8" strokeDasharray="5 5" fill="none" name="Meta Esperada" strokeWidth={2} />
              <Area type="monotone" dataKey="realizados" stroke="#10b981" fillOpacity={1} fill="url(#colorRealizados)" name="Realizados (GIS)" strokeWidth={2} />
              <Area type="monotone" dataKey="devueltos" stroke="#ef4444" fillOpacity={1} fill="url(#colorDevueltos)" name="Devueltos (Rechazo)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
