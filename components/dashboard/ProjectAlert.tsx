import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { AlertCircle, CheckCircle2, TrendingDown, Database, FileWarning, Briefcase, Wallet } from 'lucide-react';

export function ProjectAlert() {
  return (
    <Card className="border-amber-200 bg-amber-50/50 shadow-sm overflow-hidden mb-8">
      <div className="h-1 w-full bg-amber-400" />
      <CardContent className="p-6">
        <div className="flex flex-col md:flex-row gap-6 justify-between items-start">
          
          <div className="space-y-4 flex-1">
            <div className="flex items-center gap-3">
              <Badge variant="warning" className="bg-amber-500 hover:bg-amber-600">Alerta Amarilla</Badge>
              <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <Briefcase className="w-5 h-5 text-slate-500" />
                Actualización Catastral Municipio X
              </h2>
            </div>
            
            <p className="text-slate-600 text-sm max-w-2xl leading-relaxed">
              El rendimiento diario está por debajo de la meta esperada. La tasa de rechazo técnico está afectando la liquidación del bono variable del equipo.
            </p>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
              <div className="bg-white rounded-lg p-4 border border-slate-200 shadow-sm flex flex-col justify-between">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Meta Hoy</div>
                <div className="text-2xl font-bold text-slate-900">100 <span className="text-sm font-normal text-slate-500">fichas</span></div>
                <Progress value={100} className="h-1.5 mt-3 bg-slate-100" indicatorClassName="bg-slate-300" />
              </div>
              
              <div className="bg-white rounded-lg p-4 border border-slate-200 shadow-sm flex flex-col justify-between relative overflow-hidden">
                <div className="absolute top-0 right-0 p-2 opacity-10">
                  <Database size={48} />
                </div>
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <Database size={12} />
                  DB Externa (GIS)
                </div>
                <div className="flex items-end gap-2">
                  <div className="text-2xl font-bold text-emerald-600">85</div>
                  <div className="text-sm font-medium text-slate-500 mb-1">cargadas</div>
                </div>
                <div className="flex items-center gap-1 text-xs text-red-500 mt-1 font-medium bg-red-50 w-fit px-1.5 py-0.5 rounded">
                  <FileWarning size={12} />
                  10 devueltas (error técnico)
                </div>
                <Progress value={85} className="h-1.5 mt-2 bg-slate-100" indicatorClassName="bg-emerald-500" />
              </div>
              
              <div className="bg-white rounded-lg p-4 border border-amber-200 shadow-sm flex flex-col justify-between">
                <div className="text-xs font-semibold text-amber-600 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <Wallet size={12} />
                  Impacto Nómina
                </div>
                <div className="flex items-end gap-2">
                  <div className="text-2xl font-bold text-amber-600">75%</div>
                  <div className="text-sm font-medium text-slate-500 mb-1">bono devengado</div>
                </div>
                <div className="flex items-center gap-1 text-xs text-amber-600 mt-1">
                  <TrendingDown size={12} />
                  -25% vs potencial
                </div>
                <Progress value={75} className="h-1.5 mt-2 bg-amber-100" indicatorClassName="bg-amber-500" />
              </div>
            </div>
          </div>
          
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm w-full md:w-72 shrink-0">
            <h3 className="font-semibold text-slate-900 mb-4 text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-500" />
              Acciones Recomendadas
            </h3>
            <ul className="space-y-3">
              <li className="flex gap-3 text-sm">
                <div className="mt-0.5 w-5 h-5 rounded-full bg-indigo-50 flex items-center justify-center shrink-0 text-indigo-600 font-medium text-xs">1</div>
                <div className="text-slate-600">Revisar topología en QGIS para las 10 fichas devueltas.</div>
              </li>
              <li className="flex gap-3 text-sm">
                <div className="mt-0.5 w-5 h-5 rounded-full bg-indigo-50 flex items-center justify-center shrink-0 text-indigo-600 font-medium text-xs">2</div>
                <div className="text-slate-600">Reasignar 15 fichas pendientes a equipo de contingencia.</div>
              </li>
              <li className="flex gap-3 text-sm">
                <div className="mt-0.5 w-5 h-5 rounded-full bg-indigo-50 flex items-center justify-center shrink-0 text-indigo-600 font-medium text-xs">3</div>
                <div className="text-slate-600">Aprobar liquidación parcial (75%) en módulo financiero.</div>
              </li>
            </ul>
            <button className="w-full mt-5 bg-slate-900 text-white text-sm font-medium py-2 rounded-md hover:bg-slate-800 transition-colors">
              Gestionar Desviación
            </button>
          </div>
          
        </div>
      </CardContent>
    </Card>
  );
}
