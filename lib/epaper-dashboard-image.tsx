import React from 'react';
import type { EpaperDashboardSnapshot } from '@/lib/epaper-dashboard';

export const EPAPER_IMAGE_WIDTH = 800;
export const EPAPER_IMAGE_HEIGHT = 480;
export const EPAPER_FONT_FAMILY = 'PixelEpaperSans';

const formatNumber = (value: number) => new Intl.NumberFormat('es-CO').format(Math.round(value || 0));
const trimText = (value: string, max = 60) =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

const wrapText = (value: string, maxChars: number, maxLines: number) => {
  const words = String(value || '').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
      return;
    }
    current = next;
  });

  if (current) lines.push(current);
  const kept = lines.slice(0, maxLines);
  if (lines.length > maxLines && kept.length) {
    kept[kept.length - 1] = trimText(kept[kept.length - 1], Math.max(8, maxChars - 1));
  }
  return kept;
};

function Badge({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'dark' | 'alert' }) {
  const palette = {
    default: { bg: '#f3f4f6', border: '#9ca3af', color: '#111827' },
    dark: { bg: '#111827', border: '#111827', color: '#ffffff' },
    alert: { bg: '#ffffff', border: '#111827', color: '#111827' },
  }[tone];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        border: `2px solid ${palette.border}`,
        borderRadius: 999,
        background: palette.bg,
        color: palette.color,
        padding: '4px 10px',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
      }}
    >
      {children}
    </div>
  );
}

function MetricCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        boxSizing: 'border-box',
        width: 142,
        height: 64,
        border: '2px solid #111827',
        borderRadius: 15,
        padding: '8px 12px',
        background: '#ffffff',
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, color: '#4b5563', letterSpacing: 1.3, textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 25, fontWeight: 700, color: '#111827', lineHeight: 1 }}>{value}</span>
        {hint ? <span style={{ marginLeft: 'auto', fontSize: 8, fontWeight: 700, color: '#6b7280' }}>{hint}</span> : null}
      </div>
    </div>
  );
}

function ProgressBar({ value, width = 104 }: { value: number; width?: number }) {
  return (
    <div style={{ width, height: 8, borderRadius: 999, background: '#e5e7eb', overflow: 'hidden', border: '1px solid #111827' }}>
      <div style={{ width: `${Math.max(6, Math.min(value, 100))}%`, height: '100%', background: '#111827' }} />
    </div>
  );
}

function PulseChart({ snapshot }: { snapshot: EpaperDashboardSnapshot }) {
  const values = [
    { label: 'VEN', value: snapshot.metrics.overdueTasks },
    { label: 'PRO', value: snapshot.metrics.dueSoonTasks },
    { label: 'BLO', value: snapshot.metrics.blockedTasks },
    { label: 'ALT', value: snapshot.metrics.highPriorityTasks },
  ];
  const max = Math.max(...values.map((item) => item.value), 1);

  return (
    <div
      style={{
        width: 298,
        height: 114,
        border: '2px solid #111827',
        borderRadius: 18,
        background: '#ffffff',
        boxSizing: 'border-box',
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.3, color: '#111827' }}>PULSO OPERATIVO</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#111827' }}>{snapshot.metrics.completionRate}%</div>
      </div>
      <div style={{ marginTop: 7, display: 'flex', alignItems: 'flex-end', gap: 8, height: 62, overflow: 'hidden' }}>
        {values.map((item) => {
          const barHeight = Math.max(5, Math.round((item.value / max) * 52));
          return (
            <div key={item.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 28, gap: 3 }}>
              <div style={{ fontSize: 8, fontWeight: 700, color: '#111827' }}>{formatNumber(item.value)}</div>
              <div style={{ width: 22, height: barHeight, borderRadius: 6, background: '#111827' }} />
              <div style={{ fontSize: 8, fontWeight: 700, color: '#4b5563' }}>{item.label}</div>
            </div>
          );
        })}
        <div style={{ marginLeft: 'auto', width: 70, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ fontSize: 8, fontWeight: 700, color: '#4b5563', letterSpacing: 1 }}>AVANCE</div>
          <ProgressBar value={snapshot.metrics.completionRate} width={70} />
        </div>
      </div>
    </div>
  );
}

export function DashboardImage({ snapshot }: { snapshot: EpaperDashboardSnapshot }) {
  const focusProjects = snapshot.focusProjects.slice(0, 4);
  const focusTasks = snapshot.focusTasks.slice(0, 3);
  const assistantLines = wrapText(snapshot.assistantMessage, 50, 4);

  return (
    <div
      style={{
        display: 'flex',
        width: EPAPER_IMAGE_WIDTH,
        height: EPAPER_IMAGE_HEIGHT,
        background: '#eef2f7',
        color: '#111827',
        fontFamily: EPAPER_FONT_FAMILY,
        fontWeight: 700,
        padding: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          border: '2px solid #111827',
          borderRadius: 24,
          background: '#f8fafc',
          boxSizing: 'border-box',
          padding: '10px 12px',
          gap: 12,
        }}
      >
        <div style={{ height: 42, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #111827', paddingBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 42,
                height: 32,
                borderRadius: 10,
                background: '#111827',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
                fontWeight: 700,
              }}
            >
              PX
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.8, color: '#4b5563' }}>PIXEL 24/7 · E1001</div>
              <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>Centro de mando administrativo</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Badge tone={snapshot.metrics.overdueTasks > 0 ? 'dark' : 'default'}>{snapshot.metrics.overdueTasks > 0 ? 'Atención' : 'Estable'}</Badge>
            <div style={{ width: 96, fontSize: 8, fontWeight: 700, color: '#4b5563', textAlign: 'right', overflow: 'hidden' }}>{trimText(snapshot.generatedAtLabel, 24)}</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <MetricCard label="Proyectos" value={formatNumber(snapshot.metrics.activeProjects)} hint="activos" />
          <MetricCard label="Abiertas" value={formatNumber(snapshot.metrics.openTasks)} />
          <MetricCard label="Vencidas" value={formatNumber(snapshot.metrics.overdueTasks)} />
          <MetricCard label="Próximas" value={formatNumber(snapshot.metrics.dueSoonTasks)} />
          <MetricCard label="Avance" value={`${formatNumber(snapshot.metrics.completionRate)}%`} />
        </div>

        <div style={{ display: 'flex', gap: 16 }}>
          <div
            style={{
              width: 438,
              height: 114,
              display: 'flex',
              border: '2px solid #111827',
              borderRadius: 18,
              background: '#ffffff',
              overflow: 'hidden',
              boxSizing: 'border-box',
              padding: 12,
              flexDirection: 'column',
            }}
          >
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: '#4b5563' }}>ASISTENTE PIXEL</div>
            <div style={{ flex: 1, marginTop: 5, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {assistantLines.map((line, index) => (
                <div key={`${index}-${line}`} style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.25, whiteSpace: 'nowrap' }}>{line}</div>
              ))}
            </div>
          </div>

          <PulseChart snapshot={snapshot} />
        </div>

        <div style={{ display: 'flex', gap: 14, flex: 1, minHeight: 0 }}>
          <div
            style={{
              width: 376,
              border: '2px solid #111827',
              borderRadius: 18,
              background: '#ffffff',
              padding: 14,
              boxSizing: 'border-box',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.4, textTransform: 'uppercase' }}>Proyectos a mirar</div>
            </div>

            {focusProjects.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {focusProjects.map((project, index) => (
                  <div
                    key={project.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 7,
                      borderTop: index === 0 ? '0 solid transparent' : '1px solid #d1d5db',
                      paddingTop: index === 0 ? 0 : 4,
                    }}
                  >
                    <div
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 999,
                        border: '2px solid #111827',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: 9,
                        flexShrink: 0,
                      }}
                    >
                      {index + 1}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {trimText(project.name, 20)}
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
                        <span style={{ fontSize: 8, fontWeight: 700, color: '#4b5563' }}>{project.open} abiertas</span>
                        <span style={{ fontSize: 8, fontWeight: 700, color: '#4b5563' }}>{project.overdue} vencidas</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
                      <ProgressBar value={project.completionRate} width={82} />
                      <span style={{ fontSize: 8, fontWeight: 700 }}>{project.completionRate}%</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 16, fontWeight: 700, color: '#4b5563', marginTop: 22 }}>Sin proyectos críticos por ahora.</div>
            )}
          </div>

          <div
            style={{
              flex: 1,
              border: '2px solid #111827',
              borderRadius: 18,
              background: '#ffffff',
              padding: 14,
              boxSizing: 'border-box',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.4, textTransform: 'uppercase' }}>Siguientes tareas</div>
            </div>

            {focusTasks.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {focusTasks.map((task) => (
                  <div key={task.id} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '5px 8px', border: '1px solid #cbd5e1', borderRadius: 10, background: '#f8fafc', overflow: 'hidden' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden' }}>{trimText(task.title, 27)}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ maxWidth: 180, fontSize: 8, fontWeight: 700, color: '#4b5563', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {trimText(task.projectName, 20)}
                      </span>
                      <span style={{ fontSize: 8, fontWeight: 700, color: '#111827', whiteSpace: 'nowrap' }}>{trimText(task.dueLabel, 17)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 16, fontWeight: 700, color: '#4b5563', marginTop: 22 }}>Sin tareas urgentes.</div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 8, fontWeight: 700, color: '#4b5563' }}>
          <span>PNG {EPAPER_IMAGE_WIDTH}×{EPAPER_IMAGE_HEIGHT} · versión {snapshot.version}</span>
          <span>{snapshot.dataQuality.tasksTruncated ? `Vista limitada a ${snapshot.dataQuality.tasksConsidered} tareas operativas` : `${snapshot.dataQuality.tasksConsidered} tareas operativas`}</span>
        </div>
      </div>
    </div>
  );
}

export function StatusImage({ title, message }: { title: string; message: string }) {
  return (
    <div
      style={{
        width: EPAPER_IMAGE_WIDTH,
        height: EPAPER_IMAGE_HEIGHT,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 48,
        background: '#ffffff',
        color: '#111827',
        fontFamily: EPAPER_FONT_FAMILY,
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' }}>Pixel ePaper</div>
      <div style={{ marginTop: 18, fontSize: 40, fontWeight: 700 }}>{title}</div>
      <div style={{ marginTop: 16, fontSize: 22, fontWeight: 700, color: '#4b5563', lineHeight: 1.25 }}>{message}</div>
    </div>
  );
}
