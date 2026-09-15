"use client"

import Link from 'next/link';
import {
  ArrowRight,
  BellRing,
  BookOpenText,
  Boxes,
  BrainCircuit,
  CalendarClock,
  ChevronRight,
  ClipboardCheck,
  FileStack,
  Gauge,
  GitBranch,
  Grid3X3,
  Inbox,
  LayoutDashboard,
  LineChart,
  LockKeyhole,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
  WalletCards,
} from 'lucide-react';

const capabilityGroups = [
  {
    eyebrow: 'Planifica',
    title: 'Tareas, Gantt y workflows',
    description:
      'Convierte cada entregable en tareas, subtareas, iteraciones masivas y flujos de aprobación con responsables, fechas, formularios y trazabilidad completa.',
    icon: GitBranch,
    tone: 'bg-indigo-50 text-indigo-700 border-indigo-100',
    pixels: ['bg-indigo-500', 'bg-sky-400', 'bg-emerald-400', 'bg-amber-400'],
  },
  {
    eyebrow: 'Controla',
    title: 'Presupuesto por piezas',
    description:
      'Arma líneas macro, piezas, calendarios mensuales, cobertura por persona y rate cards para saber dónde vive cada peso del proyecto.',
    icon: WalletCards,
    tone: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    pixels: ['bg-emerald-500', 'bg-teal-400', 'bg-lime-400', 'bg-slate-300'],
  },
  {
    eyebrow: 'Asegura',
    title: 'Calidad y revisión',
    description:
      'Mide aceptaciones, devoluciones, causales, revisores, tiempos de respuesta y desempeño por profesional desde una lectura global o por proyecto.',
    icon: ShieldCheck,
    tone: 'bg-amber-50 text-amber-700 border-amber-100',
    pixels: ['bg-amber-500', 'bg-orange-400', 'bg-rose-400', 'bg-emerald-400'],
  },
  {
    eyebrow: 'Aprende',
    title: 'Bitácora inteligente',
    description:
      'Guarda la historia del proyecto, detecta acciones en la redacción y enlaza tareas derivadas para que las reuniones no se pierdan en notas sueltas.',
    icon: BookOpenText,
    tone: 'bg-cyan-50 text-cyan-700 border-cyan-100',
    pixels: ['bg-cyan-500', 'bg-blue-400', 'bg-violet-400', 'bg-emerald-400'],
  },
];

const productModules = [
  { label: 'Bandeja de entrada', detail: 'Tareas, workflows y comentarios accionables', icon: Inbox },
  { label: 'Indicadores', detail: 'Estados, atrasos, riesgo y rendimiento', icon: Gauge },
  { label: 'Equipo', detail: 'Carga, calidad, rate cards y alertas por persona', icon: Users },
  { label: 'Documentos y Drive', detail: 'Repositorio, permisos y trazabilidad documental', icon: FileStack },
  { label: 'Alertas', detail: 'Correo, vencimientos y seguimiento por organización', icon: BellRing },
  { label: 'Permisos', detail: 'Roles, acceso por proyecto y edición controlada', icon: LockKeyhole },
];

const planningFlow = [
  {
    step: '01',
    title: 'Captura la señal',
    text: 'La bitácora recoge decisiones, verbos de acción, comentarios y evidencia de cómo nació cada actividad.',
    icon: BrainCircuit,
  },
  {
    step: '02',
    title: 'Ordena el tablero',
    text: 'Las tareas se agrupan, se calendarizan, se asignan y entran a workflows con formularios a la medida.',
    icon: LayoutDashboard,
  },
  {
    step: '03',
    title: 'Mide el costo real',
    text: 'El presupuesto se arma por piezas, meses, personas, rate cards y cobertura para anticipar huecos financieros.',
    icon: Boxes,
  },
  {
    step: '04',
    title: 'Decide con evidencia',
    text: 'Calidad, desempeño, vencimientos y producción se consolidan en paneles para actuar antes del problema.',
    icon: LineChart,
  },
];

const pixelRows = [
  {
    name: 'Presupuesto',
    color: 'bg-emerald-500',
    cells: ['on', 'on', 'on', 'on', 'off', 'off', 'on', 'on', 'on', 'off', 'on', 'on'],
  },
  {
    name: 'Tareas',
    color: 'bg-indigo-500',
    cells: ['on', 'on', 'warn', 'on', 'on', 'on', 'on', 'warn', 'on', 'on', 'on', 'on'],
  },
  {
    name: 'Calidad',
    color: 'bg-amber-500',
    cells: ['on', 'on', 'on', 'risk', 'on', 'on', 'on', 'on', 'on', 'on', 'risk', 'on'],
  },
  {
    name: 'Equipo',
    color: 'bg-cyan-500',
    cells: ['on', 'off', 'on', 'on', 'on', 'on', 'off', 'on', 'on', 'on', 'on', 'on'],
  },
];

const metricTiles = [
  { label: 'Workflows vivos', value: '248', color: 'border-indigo-200 bg-indigo-50 text-indigo-700' },
  { label: 'Cobertura mensual', value: '94%', color: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  { label: 'Alertas críticas', value: '07', color: 'border-rose-200 bg-rose-50 text-rose-700' },
  { label: 'Calidad aceptada', value: '88%', color: 'border-amber-200 bg-amber-50 text-amber-700' },
];

const decisionCards = [
  {
    title: 'Bandeja priorizada',
    text: 'Lo pendiente se ve primero y se gestiona sin saltar de pantalla.',
    icon: Inbox,
  },
  {
    title: 'Comentarios con contexto',
    text: 'Cada interacción se queda pegada a la tarea y al workflow.',
    icon: MessageSquareText,
  },
  {
    title: 'Calendario inteligente',
    text: 'Fechas de tareas, iteraciones y presupuesto se leen en conjunto.',
    icon: CalendarClock,
  },
  {
    title: 'Indicadores accionables',
    text: 'Los rankings llevan directamente al origen de cada alerta.',
    icon: Target,
  },
];

function PixelLogo({ className = 'h-11 w-11' }: { className?: string }) {
  return (
    <div className={`${className} grid grid-cols-3 gap-0.5 rounded-lg bg-slate-950 p-1 shadow-sm`}>
      {['bg-indigo-500', 'bg-cyan-400', 'bg-emerald-400', 'bg-amber-400', 'bg-white', 'bg-indigo-300', 'bg-slate-500', 'bg-rose-400', 'bg-sky-400'].map((color, index) => (
        <span key={`${color}-${index}`} className={`${color} rounded-sm`} />
      ))}
    </div>
  );
}

function PixelStatusCell({ state, color }: { state: string; color: string }) {
  const palette =
    state === 'risk'
      ? 'bg-rose-500 shadow-rose-200'
      : state === 'warn'
        ? 'bg-amber-400 shadow-amber-200'
        : state === 'off'
          ? 'bg-slate-200 shadow-transparent'
          : `${color} shadow-slate-200`;

  return <span className={`h-5 min-w-5 rounded shadow-sm ${palette}`} />;
}

function ProductScene() {
  return (
    <div className="relative mx-auto w-full max-w-5xl">
      <div className="absolute left-6 top-6 hidden h-28 w-28 border-l border-t border-slate-300 md:block" />
      <div className="absolute bottom-8 right-5 hidden h-24 w-24 border-b border-r border-emerald-300 md:block" />

      <div className="relative overflow-hidden rounded-lg border border-slate-800 bg-slate-950 text-white shadow-2xl">
        <div className="grid gap-0.5 bg-slate-800 p-0.5 sm:grid-cols-[1fr_0.78fr]">
          <div className="bg-slate-950 p-5 sm:p-7">
            <div className="mb-6 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.34em] text-cyan-300">Pixel Control Room</p>
                <h2 className="mt-2 text-2xl font-black tracking-tight text-white sm:text-3xl">Cada pixel tiene dueño, fecha, costo y evidencia.</h2>
              </div>
              <div className="hidden rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-right sm:block">
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Pulso</p>
                <p className="text-xl font-black text-emerald-300">96%</p>
              </div>
            </div>

            <div className="space-y-3">
              {pixelRows.map((row) => (
                <div key={row.name} className="grid grid-cols-[92px_1fr] items-center gap-3 sm:grid-cols-[120px_1fr]">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-black uppercase tracking-[0.2em] text-slate-400">{row.name}</p>
                  </div>
                  <div className="grid grid-cols-12 gap-1">
                    {row.cells.map((cell, index) => (
                      <PixelStatusCell key={`${row.name}-${index}`} state={cell} color={row.color} />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-7 grid grid-cols-2 gap-3">
              {metricTiles.map((metric) => (
                <div key={metric.label} className={`min-w-0 rounded-lg border px-3 py-3 ${metric.color}`}>
                  <p className="break-words text-[9px] font-black uppercase leading-4 tracking-[0.08em] opacity-75">{metric.label}</p>
                  <p className="mt-2 text-2xl font-black leading-none">{metric.value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white p-5 text-slate-950 sm:p-7">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.28em] text-emerald-700">Proyecto VANTI</p>
                <h3 className="mt-1 text-xl font-black">Mapa operativo</h3>
              </div>
              <div className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-black uppercase tracking-[0.16em] text-slate-600">
                12 alertas
              </div>
            </div>

            <div className="space-y-3">
              {[
                ['Levantamiento GPS', 'Trabajando', 'bg-amber-100 text-amber-800', 'w-4/5'],
                ['Calidad predial', 'Revisión', 'bg-cyan-100 text-cyan-800', 'w-2/3'],
                ['Cobertura de equipo', 'Completo', 'bg-emerald-100 text-emerald-800', 'w-full'],
                ['Presupuesto campo', 'Riesgo', 'bg-rose-100 text-rose-800', 'w-1/2'],
              ].map(([name, status, badge, width]) => (
                <div key={name} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-black text-slate-800">{name}</p>
                    <span className={`rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${badge}`}>{status}</span>
                  </div>
                  <div className="mt-3 h-2 rounded-full bg-slate-200">
                    <div className={`h-2 rounded-full bg-slate-950 ${width}`} />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 rounded-lg border border-indigo-100 bg-indigo-50 p-4">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-indigo-600 p-2 text-white">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="break-words text-sm font-black text-slate-950">Señal inteligente</p>
                  <p className="mt-1 break-words text-sm leading-relaxed text-slate-600">
                    La bitácora detectó 4 acciones nuevas y 2 posibles riesgos de calidad para asignar hoy.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-[#f6f8fb] font-sans text-slate-950 selection:bg-cyan-100 selection:text-slate-950">
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3" aria-label="Pixel Project">
            <PixelLogo />
            <div>
              <p className="text-xl font-black tracking-tight text-slate-950">Pixel Project</p>
              <p className="hidden text-xs font-bold uppercase tracking-[0.24em] text-slate-500 sm:block">Project intelligence</p>
            </div>
          </Link>

          <nav className="hidden items-center gap-7 md:flex">
            <a href="#pixel-system" className="text-sm font-bold text-slate-600 transition-colors hover:text-slate-950">
              Sistema
            </a>
            <a href="#modules" className="text-sm font-bold text-slate-600 transition-colors hover:text-slate-950">
              Módulos
            </a>
            <a href="#budget" className="text-sm font-bold text-slate-600 transition-colors hover:text-slate-950">
              Presupuesto
            </a>
            <a href="#quality" className="text-sm font-bold text-slate-600 transition-colors hover:text-slate-950">
              Calidad
            </a>
          </nav>

          <div className="flex items-center gap-3">
            <Link href="/login" className="hidden text-sm font-bold text-slate-600 transition-colors hover:text-slate-950 sm:block">
              Iniciar sesión
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center justify-center rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-black text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-slate-800"
            >
              Entrar
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden border-b border-slate-200 bg-white">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#e2e8f0_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f0_1px,transparent_1px)] bg-[size:48px_48px] opacity-45" />
        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-white to-transparent" />

        <div className="relative mx-auto grid min-h-[calc(100vh-80px)] max-w-7xl items-center gap-12 px-4 py-14 sm:px-6 lg:grid-cols-[0.78fr_1.22fr] lg:px-8">
          <div className="max-w-2xl">
            <div className="mb-7 inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black uppercase tracking-[0.2em] text-emerald-800">
              <Grid3X3 className="h-4 w-4" />
              El poder del pixel
            </div>
            <h1 className="text-5xl font-black leading-[0.95] tracking-tight text-slate-950 sm:text-6xl lg:text-7xl">
              Pixel Project
            </h1>
            <p className="mt-6 text-xl font-semibold leading-relaxed text-slate-600 sm:text-2xl">
              La plataforma donde cada tarea, peso, revisión, comentario y decisión se convierte en un pixel visible del proyecto.
            </p>
            <p className="mt-5 max-w-xl text-base leading-8 text-slate-600">
              Diseñada para equipos que necesitan planear, ejecutar, auditar y anticiparse. Pixel Project une Gantt, workflows, presupuesto, calidad, bitácora, rate cards y desempeño en una sola lectura operativa.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-6 py-4 text-base font-black text-white shadow-lg shadow-indigo-200 transition-all hover:-translate-y-0.5 hover:bg-indigo-700"
              >
                Entrar a la plataforma
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
              <a
                href="#pixel-system"
                className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-6 py-4 text-base font-black text-slate-800 transition-all hover:-translate-y-0.5 hover:border-slate-400"
              >
                Ver capacidades
              </a>
            </div>

            <div className="mt-10 grid grid-cols-3 gap-3">
              {[
                ['Tareas', 'Gantt + workflows'],
                ['Costos', 'Presupuesto vivo'],
                ['Calidad', 'Revisión medible'],
              ].map(([title, text]) => (
                <div key={title} className="rounded-lg border border-slate-200 bg-white/80 p-3">
                  <p className="text-sm font-black text-slate-950">{title}</p>
                  <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">{text}</p>
                </div>
              ))}
            </div>
          </div>

          <ProductScene />
        </div>
      </section>

      <section id="pixel-system" className="bg-[#f6f8fb] py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-12 grid gap-6 lg:grid-cols-[0.7fr_1fr]">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.3em] text-indigo-600">Sistema pixel</p>
              <h2 className="mt-4 text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
                Un pixel es una unidad de control.
              </h2>
            </div>
            <p className="max-w-3xl text-lg leading-8 text-slate-600">
              El proyecto deja de ser una lista larga y se vuelve un mapa. Cada pixel representa una pieza concreta: una subtarea, una revisión de calidad, un mes de presupuesto, una alerta o una decisión que quedó documentada.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-4">
            {capabilityGroups.map((capability) => {
              const Icon = capability.icon;
              return (
                <article key={capability.title} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg">
                  <div className="mb-6 flex items-center justify-between">
                    <div className={`rounded-lg border p-2.5 ${capability.tone}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="grid grid-cols-4 gap-1">
                      {capability.pixels.map((pixel, index) => (
                        <span key={`${capability.title}-${index}`} className={`h-4 w-4 rounded-sm ${pixel}`} />
                      ))}
                    </div>
                  </div>
                  <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">{capability.eyebrow}</p>
                  <h3 className="mt-2 text-xl font-black tracking-tight text-slate-950">{capability.title}</h3>
                  <p className="mt-4 text-sm leading-7 text-slate-600">{capability.description}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section id="modules" className="border-y border-slate-200 bg-white py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-10 flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.3em] text-cyan-700">Todo conectado</p>
              <h2 className="mt-4 max-w-3xl text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
                La operación completa en una pantalla que entiende contexto.
              </h2>
            </div>
            <Link href="/login" className="inline-flex items-center rounded-lg border border-slate-300 px-4 py-3 text-sm font-black text-slate-700 transition-colors hover:border-slate-950 hover:text-slate-950">
              Abrir dashboard
              <ChevronRight className="ml-1 h-4 w-4" />
            </Link>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {productModules.map((module) => {
              const Icon = module.icon;
              return (
                <article key={module.label} className="group rounded-lg border border-slate-200 bg-slate-50 p-5 transition-all hover:bg-slate-950">
                  <div className="mb-8 flex items-center justify-between">
                    <div className="rounded-lg border border-slate-200 bg-white p-2.5 text-indigo-600 transition-colors group-hover:border-white/10 group-hover:bg-white/10 group-hover:text-cyan-300">
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className="h-2 w-14 rounded-full bg-slate-200 transition-colors group-hover:bg-emerald-300" />
                  </div>
                  <h3 className="text-lg font-black text-slate-950 transition-colors group-hover:text-white">{module.label}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600 transition-colors group-hover:text-slate-300">{module.detail}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="bg-[#f6f8fb] py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-4 lg:grid-cols-4">
            {planningFlow.map((item) => {
              const Icon = item.icon;
              return (
                <article key={item.step} className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="mb-8 flex items-center justify-between">
                    <span className="text-4xl font-black text-slate-200">{item.step}</span>
                    <div className="rounded-lg bg-slate-950 p-3 text-white">
                      <Icon className="h-5 w-5" />
                    </div>
                  </div>
                  <h3 className="text-xl font-black text-slate-950">{item.title}</h3>
                  <p className="mt-4 text-sm leading-7 text-slate-600">{item.text}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section id="budget" className="overflow-hidden border-y border-slate-200 bg-slate-950 py-20 text-white">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-[0.85fr_1.15fr] lg:px-8">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.3em] text-emerald-300">Pixel financiero</p>
            <h2 className="mt-4 text-4xl font-black tracking-tight sm:text-5xl">
              Presupuesto como piezas que se pueden ver, mover y medir.
            </h2>
            <p className="mt-6 text-lg leading-8 text-slate-300">
              Pixel Project no guarda números sueltos. Cada línea se descompone en piezas, meses, personas, licencias, operaciones y supuestos. Así sabes quién tiene cobertura, qué línea se agota y qué actividad consume el plan.
            </p>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/5 p-5">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">Cobertura mensual</p>
                <h3 className="mt-1 text-2xl font-black">Personal y presupuesto</h3>
              </div>
              <WalletCards className="h-7 w-7 text-emerald-300" />
            </div>
            <div className="space-y-4">
              {[
                ['Analistas campo', '$ 96.000.000', 12],
                ['Calidad', '$ 42.000.000', 9],
                ['Licencias SIG', '$ 18.500.000', 7],
              ].map(([name, value, active]) => (
                <div key={name} className="rounded-lg border border-white/10 bg-slate-900 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <p className="font-black">{name}</p>
                    <p className="font-black text-emerald-300">{value}</p>
                  </div>
                  <div className="mt-4 grid grid-cols-12 gap-1">
                    {Array.from({ length: 12 }).map((_, index) => (
                      <span
                        key={`${name}-${index}`}
                        className={`h-6 rounded ${index < Number(active) ? 'bg-emerald-400' : 'bg-slate-700'}`}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="quality" className="bg-white py-20">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-[1fr_0.85fr] lg:px-8">
          <div className="rounded-lg border border-slate-200 bg-[#f6f8fb] p-5">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.24em] text-amber-700">Radar de calidad</p>
                <h3 className="mt-1 text-2xl font-black text-slate-950">Trazabilidad de revisiones</h3>
              </div>
              <ClipboardCheck className="h-7 w-7 text-amber-600" />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ['Aceptadas', '312', 'bg-emerald-50 text-emerald-700 border-emerald-200'],
                ['Devueltas', '28', 'bg-rose-50 text-rose-700 border-rose-200'],
                ['En revisión', '46', 'bg-amber-50 text-amber-700 border-amber-200'],
              ].map(([label, value, style]) => (
                <div key={label} className={`rounded-lg border p-4 ${style}`}>
                  <p className="text-xs font-black uppercase tracking-[0.2em]">{label}</p>
                  <p className="mt-3 text-4xl font-black">{value}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 space-y-3">
              {[
                ['Contrato de predios', 'Devuelto por causal documental', 'bg-rose-500'],
                ['Informe de avalúos', 'Aceptado sin observaciones', 'bg-emerald-500'],
                ['Base catastral', 'Requiere segunda revisión', 'bg-amber-500'],
              ].map(([title, detail, color]) => (
                <div key={title} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
                  <span className={`h-10 w-2 rounded ${color}`} />
                  <div className="min-w-0">
                    <p className="truncate font-black text-slate-950">{title}</p>
                    <p className="truncate text-sm text-slate-600">{detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col justify-center">
            <p className="text-sm font-black uppercase tracking-[0.3em] text-amber-700">Calidad que aprende</p>
            <h2 className="mt-4 text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
              No solo sabes qué falló. Sabes dónde, cuándo y quién puede corregirlo.
            </h2>
            <p className="mt-6 text-lg leading-8 text-slate-600">
              Las devoluciones se conectan con tareas, comentarios, formularios y profesionales. La calidad deja de ser un reporte final y se vuelve una señal viva para mejorar la entrega.
            </p>
          </div>
        </div>
      </section>

      <section className="border-t border-slate-200 bg-[#f6f8fb] py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
            <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
              <div>
                <p className="text-sm font-black uppercase tracking-[0.3em] text-indigo-600">Centro de decisión</p>
                <h2 className="mt-4 text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
                  La plataforma que convierte el proyecto en una imagen clara.
                </h2>
                <p className="mt-6 text-lg leading-8 text-slate-600">
                  Pixel a pixel, el sistema muestra qué está a tiempo, qué cuesta más de lo esperado, quién necesita apoyo y qué decisión debe tomarse antes de que el proyecto pierda ritmo.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {decisionCards.map(({ title, text, icon: ModuleIcon }) => {
                  return (
                    <article key={title} className="rounded-lg border border-slate-200 bg-slate-50 p-5">
                      <ModuleIcon className="h-6 w-6 text-indigo-600" />
                      <h3 className="mt-5 font-black text-slate-950">{title}</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
                    </article>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-slate-950 py-16 text-white">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-8 px-4 sm:px-6 lg:flex-row lg:items-center lg:px-8">
          <div className="max-w-3xl">
            <div className="mb-5 flex items-center gap-3">
              <PixelLogo className="h-10 w-10" />
              <p className="text-sm font-black uppercase tracking-[0.28em] text-cyan-300">Pixel Project</p>
            </div>
            <h2 className="text-4xl font-black tracking-tight sm:text-5xl">
              El proyecto completo, visto con precisión de pixel.
            </h2>
            <p className="mt-5 text-lg leading-8 text-slate-300">
              Entra a la plataforma y dirige tareas, presupuesto, calidad y equipo desde una lectura integrada.
            </p>
          </div>

          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-lg bg-white px-6 py-4 text-base font-black text-slate-950 shadow-lg transition-all hover:-translate-y-0.5 hover:bg-cyan-50"
          >
            Entrar ahora
            <ArrowRight className="ml-2 h-5 w-5" />
          </Link>
        </div>
      </section>

      <footer className="border-t border-slate-800 bg-slate-950 py-8 text-slate-400">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-4 px-4 text-sm sm:px-6 md:flex-row lg:px-8">
          <p>© {new Date().getFullYear()} Pixel Project. Inteligencia operativa para proyectos.</p>
          <div className="flex gap-5">
            <a href="#modules" className="transition-colors hover:text-white">Módulos</a>
            <a href="#budget" className="transition-colors hover:text-white">Presupuesto</a>
            <a href="#quality" className="transition-colors hover:text-white">Calidad</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
