import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Activity, DollarSign, CheckCircle, Clock } from 'lucide-react';
import { DashboardMetrics } from '@/hooks/useDashboardData';

export function KpiCards({ metrics }: { metrics: DashboardMetrics }) {
  const kpis = [
    {
      title: "Utilization Rate",
      value: `${metrics.utilizationRate}%`,
      change: "+2.5%",
      trend: "up",
      icon: <Clock className="w-4 h-4 text-indigo-500" />,
      description: "Capacidad facturada a proyectos"
    },
    {
      title: "Tasa de Aceptación",
      value: `${metrics.acceptanceRate}%`,
      change: "-1.2%",
      trend: "down",
      icon: <CheckCircle className="w-4 h-4 text-emerald-500" />,
      description: "Realizados vs Devueltos (Quality)"
    },
    {
      title: "Producción Total",
      value: metrics.totalProduction.toLocaleString(),
      change: "+124",
      trend: "up",
      icon: <Activity className="w-4 h-4 text-sky-500" />,
      description: "Productos validados este mes"
    },
    {
      title: "Liquidación Proyectada",
      value: metrics.totalActualCost.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }),
      change: "+$2.1M",
      trend: "up",
      icon: <DollarSign className="w-4 h-4 text-amber-500" />,
      description: "Pago por resultados (Variable)"
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      {kpis.map((kpi, index) => (
        <Card key={index} className="overflow-hidden border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-slate-500">{kpi.title}</h3>
              <div className="p-2 bg-slate-50 rounded-md border border-slate-100">
                {kpi.icon}
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <h2 className="text-3xl font-bold text-slate-900 tracking-tight">{kpi.value}</h2>
              <span className={`text-xs font-medium px-1.5 py-0.5 rounded-md ${
                kpi.trend === 'up' 
                  ? 'bg-emerald-50 text-emerald-700' 
                  : 'bg-red-50 text-red-700'
              }`}>
                {kpi.change}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-3">{kpi.description}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
