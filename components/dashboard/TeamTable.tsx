import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { DashboardMetrics } from '@/hooks/useDashboardData';
import Image from 'next/image';

export function TeamTable({ metrics }: { metrics: DashboardMetrics }) {
  const teamData = metrics.teamPerformance;

  return (
    <Card className="col-span-3 border-slate-200 shadow-sm">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg font-semibold text-slate-900">Liquidación de Resultados por Consultor</CardTitle>
          <CardDescription className="text-sm text-slate-500">
            Basado en productos validados en bases de datos externas.
          </CardDescription>
        </div>
        <button className="text-sm font-medium text-indigo-600 hover:text-indigo-700 bg-indigo-50 px-3 py-1.5 rounded-md transition-colors">
          Exportar Rate Card
        </button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow className="border-slate-200 hover:bg-transparent">
              <TableHead className="font-semibold text-slate-600">Profesional</TableHead>
              <TableHead className="font-semibold text-slate-600 text-right">Valor Generado</TableHead>
              <TableHead className="font-semibold text-slate-600 text-right">Valor Rework</TableHead>
              <TableHead className="font-semibold text-slate-600 text-center">Calidad</TableHead>
              <TableHead className="font-semibold text-slate-600 text-right">Total Liquidación</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {teamData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-slate-500">
                  No hay datos de rendimiento disponibles.
                </TableCell>
              </TableRow>
            ) : (
              teamData.map((row, index) => {
                const total = row.value + row.reworkValue;
                const quality = row.value > 0 ? Math.round((row.value / total) * 100) : 0;
                
                return (
                  <TableRow key={index} className="border-slate-100 hover:bg-slate-50/50">
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-500 overflow-hidden relative">
                          {row.photoURL ? (
                            <Image src={row.photoURL} alt={row.name} fill className="object-cover" referrerPolicy="no-referrer" />
                          ) : (
                            row.name.split(' ').map(n => n[0]).join('')
                          )}
                        </div>
                        <div>
                          <div className="text-slate-900">{row.name}</div>
                          <div className="text-xs text-slate-500">Consultor</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium text-emerald-600">
                      {row.value.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })}
                    </TableCell>
                    <TableCell className="text-right text-red-500">
                      {row.reworkValue.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-2">
                        <span className="text-sm font-medium text-slate-700 w-8">{quality}%</span>
                        <Progress value={quality} className="w-16 h-1.5 bg-slate-100" indicatorClassName={quality > 90 ? 'bg-emerald-500' : quality > 75 ? 'bg-amber-500' : 'bg-red-500'} />
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={quality > 90 ? 'success' : quality > 75 ? 'warning' : 'destructive'} className="font-mono">
                        {total.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
