"use client"

import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Sparkles, TrendingUp, Zap, BrainCircuit, Loader2 } from 'lucide-react';
import { DashboardMetrics } from '@/hooks/useDashboardData';

interface AIAnalysis {
  status: 'success' | 'warning' | 'error';
  statusLabel: string;
  summary: string;
  recommendations: string[];
  metrics: {
    label: string;
    value: string;
    subValue: string;
    progress: number;
    color: string;
  }[];
}

export function AIAssistantAlerts({ metrics }: { metrics: DashboardMetrics }) {
  const [analysis, setAnalysis] = useState<AIAnalysis | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    function getLocalAnalysis() {
      if (metrics.loading) return;
      
      setLoading(true);

      const budgetRisk = metrics.utilizationRate > 100 ? 'error' : metrics.utilizationRate > 85 ? 'warning' : 'success';
      const qualityRisk = metrics.acceptanceRate < 70 ? 'error' : metrics.acceptanceRate < 85 ? 'warning' : 'success';
      const status: AIAnalysis['status'] = budgetRisk === 'error' || qualityRisk === 'error'
        ? 'error'
        : budgetRisk === 'warning' || qualityRisk === 'warning'
          ? 'warning'
          : 'success';

      const totalActual = metrics.totalActualCost.toLocaleString('es-CO', {
        style: 'currency',
        currency: 'COP',
        maximumFractionDigits: 0,
      });

      setAnalysis({
        status,
        statusLabel:
          status === 'error' ? 'Alerta Roja' : status === 'warning' ? 'Alerta Amarilla' : 'Rendimiento Saludable',
        summary:
          `El proyecto registra ${metrics.totalProduction.toLocaleString('es-CO')} unidades producidas, ` +
          `una aceptación del ${metrics.acceptanceRate}% y un costo ejecutado de ${totalActual}. ` +
          (status === 'success'
            ? 'Los indicadores principales se mantienen dentro de rangos esperados.'
            : 'Conviene revisar desviaciones de costo, calidad o reproceso antes de seguir escalando producción.'),
        recommendations: [
          metrics.utilizationRate > 85
            ? 'Revisar rate cards y líneas de presupuesto con mayor consumo.'
            : 'Mantener seguimiento semanal de presupuesto ejecutado contra plan.',
          metrics.acceptanceRate < 85
            ? 'Identificar pasos de workflow con devoluciones frecuentes.'
            : 'Documentar buenas prácticas de los equipos con mayor aceptación.',
          metrics.teamPerformance.length > 0
            ? 'Balancear carga según desempeño y reproceso por usuario.'
            : 'Completar asignación de responsables para mejorar trazabilidad.',
        ],
        metrics: [
          {
            label: 'Utilización',
            value: `${metrics.utilizationRate}%`,
            subValue: 'presupuesto',
            progress: Math.min(metrics.utilizationRate, 100),
            color: '#4f46e5',
          },
          {
            label: 'Calidad',
            value: `${metrics.acceptanceRate}%`,
            subValue: 'aceptación',
            progress: Math.min(metrics.acceptanceRate, 100),
            color: '#10b981',
          },
          {
            label: 'Producción',
            value: metrics.totalProduction.toLocaleString('es-CO'),
            subValue: 'unidades',
            progress: Math.min(metrics.totalProduction > 0 ? 75 : 0, 100),
            color: '#f59e0b',
          },
        ],
      });

      setLoading(false);
    }

    getLocalAnalysis();
  }, [metrics]);

  if (loading) {
    return (
      <Card className="border-slate-200 bg-slate-50/50 shadow-sm overflow-hidden mb-8">
        <CardContent className="p-12 flex flex-col items-center justify-center gap-4">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
          <p className="text-slate-500 font-medium">Asistente IA analizando métricas en tiempo real...</p>
        </CardContent>
      </Card>
    );
  }

  if (!analysis) return null;

  const statusColors = {
    success: 'bg-emerald-500 border-emerald-200 text-emerald-700',
    warning: 'bg-amber-500 border-amber-200 text-amber-700',
    error: 'bg-red-500 border-red-200 text-red-700'
  };

  const badgeVariants = {
    success: 'success',
    warning: 'warning',
    error: 'destructive'
  };

  return (
    <Card className={`border-2 ${analysis.status === 'warning' ? 'border-amber-200 bg-amber-50/30' : analysis.status === 'error' ? 'border-red-200 bg-red-50/30' : 'border-emerald-200 bg-emerald-50/30'} shadow-sm overflow-hidden mb-8 relative`}>
      <div className={`h-1.5 w-full ${analysis.status === 'warning' ? 'bg-amber-400' : analysis.status === 'error' ? 'bg-red-400' : 'bg-emerald-400'}`} />
      
      <div className="absolute top-4 right-4 opacity-10 pointer-events-none">
        <BrainCircuit size={120} className="text-slate-900" />
      </div>

      <CardContent className="p-6">
        <div className="flex flex-col lg:flex-row gap-8 justify-between items-start">
          
          <div className="space-y-5 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant={badgeVariants[analysis.status] as any} className="px-3 py-1 text-xs font-bold uppercase tracking-wider">
                {analysis.statusLabel}
              </Badge>
              <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-500" />
                Análisis Inteligente de Rendimiento
              </h2>
            </div>
            
            <p className="text-slate-700 text-sm max-w-3xl leading-relaxed font-medium">
              {analysis.summary}
            </p>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
              {analysis.metrics.map((m, i) => (
                <div key={i} className="bg-white/80 backdrop-blur-sm rounded-xl p-4 border border-slate-200 shadow-sm flex flex-col justify-between group hover:border-indigo-200 transition-colors">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">{m.label}</div>
                  <div className="flex items-baseline gap-2">
                    <div className="text-2xl font-bold text-slate-900">{m.value}</div>
                    <div className="text-xs font-medium text-slate-500">{m.subValue}</div>
                  </div>
                  <div className="mt-4">
                    <div className="flex justify-between text-[10px] mb-1 font-bold text-slate-400">
                      <span>PROGRESO</span>
                      <span>{m.progress}%</span>
                    </div>
                    <Progress value={m.progress} className="h-1.5 bg-slate-100" indicatorClassName={m.progress > 80 ? 'bg-emerald-500' : m.progress > 50 ? 'bg-amber-500' : 'bg-red-500'} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          <div className="bg-white/90 backdrop-blur-sm p-6 rounded-2xl border border-slate-200 shadow-sm w-full lg:w-80 shrink-0">
            <h3 className="font-bold text-slate-900 mb-5 text-sm flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500 fill-amber-500" />
              Acciones Recomendadas
            </h3>
            <ul className="space-y-4">
              {analysis.recommendations.map((rec, i) => (
                <li key={i} className="flex gap-3 text-sm group">
                  <div className="mt-0.5 w-6 h-6 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0 text-indigo-600 font-bold text-xs group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                    {i + 1}
                  </div>
                  <div className="text-slate-600 leading-snug font-medium">{rec}</div>
                </li>
              ))}
            </ul>
            <button className="w-full mt-6 bg-slate-900 text-white text-sm font-bold py-3 rounded-xl hover:bg-indigo-600 transition-all shadow-lg shadow-slate-200 hover:shadow-indigo-200 flex items-center justify-center gap-2">
              Gestionar Desviaciones
              <TrendingUp size={16} />
            </button>
          </div>
          
        </div>
      </CardContent>
    </Card>
  );
}
