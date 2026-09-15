import { NextRequest, NextResponse } from 'next/server';
import {
  authorizeEpaperRequest,
  getEpaperDashboardSnapshot,
  type EpaperDashboardSnapshot,
} from '@/lib/epaper-dashboard';
import { EPAPER_IMAGE_HEIGHT, EPAPER_IMAGE_WIDTH } from '@/lib/epaper-dashboard-image';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Content-Type': 'image/svg+xml; charset=utf-8',
};

const escapeXml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const formatNumber = (value: number) => new Intl.NumberFormat('es-CO').format(Math.round(value || 0));

const SVG_FONT_STACK = "'DejaVu Sans', Arial, Helvetica, sans-serif";

const trimText = (value: string, max = 70) =>
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
  if (lines.length <= maxLines) return lines;

  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = trimText(kept[maxLines - 1], Math.max(8, maxChars - 1));
  return kept;
};

const textLines = ({
  lines,
  x,
  y,
  size,
  weight = 700,
  fill = '#111827',
  lineHeight = 20,
}: {
  lines: string[];
  x: number;
  y: number;
  size: number;
  weight?: number;
  fill?: string;
  lineHeight?: number;
}) =>
  lines
    .map(
      (line, index) =>
        `<text x="${x}" y="${y + index * lineHeight}" font-family="${SVG_FONT_STACK}" font-size="${size}" font-weight="${weight}" fill="${fill}">${escapeXml(line)}</text>`,
    )
    .join('');

const metricBox = (x: number, label: string, value: string, hint = '') => `
  <rect x="${x}" y="82" width="142" height="64" rx="15" fill="#ffffff" stroke="#111827" stroke-width="2"/>
  <path d="M ${x + 12} 137 H ${x + 130}" stroke="#cbd5e1" stroke-width="1"/>
  <text x="${x + 12}" y="105" font-family="${SVG_FONT_STACK}" font-size="10" font-weight="700" fill="#4b5563" letter-spacing="1.3">${escapeXml(label)}</text>
  <text x="${x + 12}" y="132" font-family="${SVG_FONT_STACK}" font-size="25" font-weight="700" fill="#111827">${escapeXml(value)}</text>
  ${hint ? `<text x="${x + 130}" y="132" text-anchor="end" font-family="${SVG_FONT_STACK}" font-size="8" font-weight="700" fill="#6b7280">${escapeXml(hint)}</text>` : ''}
`;

const pulseBar = (x: number, label: string, value: number, max: number, height = 42) => {
  const barHeight = Math.max(4, Math.round((Math.max(0, value) / Math.max(max, 1)) * height));
  const y = 246 - barHeight;
  return `
    <rect x="${x}" y="${246 - height}" width="26" height="${height}" rx="7" fill="#f8fafc" stroke="#94a3b8" stroke-width="1"/>
    <rect x="${x}" y="${y}" width="26" height="${barHeight}" rx="7" fill="#111827"/>
    <text x="${x + 13}" y="260" text-anchor="middle" font-family="${SVG_FONT_STACK}" font-size="8" font-weight="700" fill="#4b5563">${escapeXml(label)}</text>
    <text x="${x + 13}" y="200" text-anchor="middle" font-family="${SVG_FONT_STACK}" font-size="9" font-weight="700" fill="#111827">${formatNumber(value)}</text>
  `;
};

const progressLine = (x: number, y: number, width: number, value: number) => `
  <rect x="${x}" y="${y}" width="${width}" height="8" rx="4" fill="#e5e7eb"/>
  <rect x="${x}" y="${y}" width="${Math.max(6, Math.round((Math.max(0, Math.min(value, 100)) / 100) * width))}" height="8" rx="4" fill="#111827"/>
`;

function dashboardSvg(snapshot: EpaperDashboardSnapshot) {
  const projects = snapshot.focusProjects.slice(0, 4);
  const tasks = snapshot.focusTasks.slice(0, 3);
  const messageLines = wrapText(snapshot.assistantMessage, 50, 4);
  const pulseMax = Math.max(
    snapshot.metrics.overdueTasks,
    snapshot.metrics.dueSoonTasks,
    snapshot.metrics.blockedTasks,
    snapshot.metrics.highPriorityTasks,
    1,
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${EPAPER_IMAGE_WIDTH}" height="${EPAPER_IMAGE_HEIGHT}" viewBox="0 0 ${EPAPER_IMAGE_WIDTH} ${EPAPER_IMAGE_HEIGHT}">
  <defs>
    <style>
      text { font-family: ${SVG_FONT_STACK}; }
    </style>
    <pattern id="grid" width="18" height="18" patternUnits="userSpaceOnUse">
      <path d="M 18 0 L 0 0 0 18" fill="none" stroke="#e2e8f0" stroke-width="1"/>
    </pattern>
    <clipPath id="headerDateClip"><rect x="664" y="20" width="96" height="28"/></clipPath>
    <clipPath id="assistantMessageClip"><rect x="40" y="170" width="406" height="90"/></clipPath>
    <clipPath id="pulseClip"><rect x="490" y="168" width="272" height="94"/></clipPath>
    <clipPath id="projectListClip"><rect x="38" y="323" width="344" height="116"/></clipPath>
    <clipPath id="taskListClip"><rect x="428" y="321" width="332" height="126"/></clipPath>
  </defs>
  <rect width="800" height="480" fill="#eef2f7"/>
  <rect width="800" height="480" fill="url(#grid)" opacity="0.65"/>
  <rect x="12" y="10" width="776" height="460" rx="24" fill="#f8fafc" stroke="#111827" stroke-width="2"/>
  <path d="M 28 64 H 772" stroke="#111827" stroke-width="2"/>

  <rect x="30" y="22" width="42" height="32" rx="10" fill="#111827"/>
  <text x="40" y="44" font-size="18" font-weight="700" fill="#fff">PX</text>
  <text x="84" y="34" font-size="10" font-weight="700" fill="#4b5563" letter-spacing="1.8">PIXEL 24/7 · E1001</text>
  <text x="84" y="55" font-size="22" font-weight="700" fill="#111827">Centro de mando administrativo</text>
  <rect x="566" y="22" width="88" height="27" rx="13" fill="${snapshot.metrics.overdueTasks > 0 ? '#111827' : '#ffffff'}" stroke="#111827" stroke-width="2"/>
  <text x="610" y="40" text-anchor="middle" font-size="9" font-weight="700" fill="${snapshot.metrics.overdueTasks > 0 ? '#fff' : '#111827'}">${snapshot.metrics.overdueTasks > 0 ? 'ATENCIÓN' : 'ESTABLE'}</text>
  <g clip-path="url(#headerDateClip)"><text x="758" y="39" text-anchor="end" font-size="8" font-weight="700" fill="#4b5563">${escapeXml(trimText(snapshot.generatedAtLabel, 24))}</text></g>

  ${metricBox(24, 'PROYECTOS', formatNumber(snapshot.metrics.activeProjects), 'activos')}
  ${metricBox(176, 'ABIERTAS', formatNumber(snapshot.metrics.openTasks))}
  ${metricBox(328, 'VENCIDAS', formatNumber(snapshot.metrics.overdueTasks))}
  ${metricBox(480, 'PRÓXIMAS', formatNumber(snapshot.metrics.dueSoonTasks))}
  ${metricBox(632, 'AVANCE', `${formatNumber(snapshot.metrics.completionRate)}%`)}

  <rect x="24" y="158" width="438" height="114" rx="18" fill="#ffffff" stroke="#111827" stroke-width="2"/>
  <text x="42" y="181" font-size="9" font-weight="700" fill="#4b5563" letter-spacing="1.5">ASISTENTE PIXEL</text>
  <g clip-path="url(#assistantMessageClip)">${textLines({ lines: messageLines, x: 42, y: 202, size: 14, weight: 700, lineHeight: 19 })}</g>

  <rect x="478" y="158" width="298" height="114" rx="18" fill="#ffffff" stroke="#111827" stroke-width="2"/>
  <g clip-path="url(#pulseClip)">
    <text x="498" y="181" font-size="11" font-weight="700" fill="#111827" letter-spacing="1.3">PULSO OPERATIVO</text>
    <circle cx="720" cy="218" r="32" fill="#f8fafc" stroke="#111827" stroke-width="2"/>
    <path d="M 720 186 A 32 32 0 0 1 752 218" fill="none" stroke="#111827" stroke-width="6" stroke-linecap="round"/>
    <text x="720" y="216" text-anchor="middle" font-size="18" font-weight="700" fill="#111827">${formatNumber(snapshot.metrics.completionRate)}%</text>
    <text x="720" y="231" text-anchor="middle" font-size="7" font-weight="700" fill="#4b5563" letter-spacing="1">AVANCE</text>
    ${pulseBar(500, 'VEN', snapshot.metrics.overdueTasks, pulseMax)}
    ${pulseBar(540, 'PRO', snapshot.metrics.dueSoonTasks, pulseMax)}
    ${pulseBar(580, 'BLO', snapshot.metrics.blockedTasks, pulseMax)}
    ${pulseBar(620, 'ALT', snapshot.metrics.highPriorityTasks, pulseMax)}
  </g>

  <rect x="24" y="286" width="376" height="166" rx="18" fill="#ffffff" stroke="#111827" stroke-width="2"/>
  <text x="42" y="313" font-size="12" font-weight="700" fill="#111827" letter-spacing="1.4">PROYECTOS A MIRAR</text>
  <g clip-path="url(#projectListClip)">${projects
    .map((project, index) => {
      const y = 342 + index * 27;
      return `
        <circle cx="48" cy="${y - 5}" r="10" fill="#fff" stroke="#111827" stroke-width="2"/>
        <text x="48" y="${y - 1}" text-anchor="middle" font-size="9" font-weight="700" fill="#111827">${index + 1}</text>
        <text x="66" y="${y - 7}" font-size="12" font-weight="700" fill="#111827">${escapeXml(trimText(project.name, 20))}</text>
        <text x="66" y="${y + 8}" font-size="8" font-weight="700" fill="#4b5563">${project.open} abiertas · ${project.overdue} vencidas</text>
        ${progressLine(258, y - 14, 104, project.completionRate)}
        <text x="370" y="${y - 6}" text-anchor="end" font-size="8" font-weight="700" fill="#111827">${project.completionRate}%</text>
      `;
    })
    .join('')}</g>
  ${projects.length ? '' : `<text x="42" y="378" font-family="${SVG_FONT_STACK}" font-size="16" font-weight="700" fill="#4b5563">Sin proyectos críticos por ahora.</text>`}

  <rect x="414" y="286" width="362" height="166" rx="18" fill="#ffffff" stroke="#111827" stroke-width="2"/>
  <text x="432" y="313" font-size="12" font-weight="700" fill="#111827" letter-spacing="1.4">SIGUIENTES TAREAS</text>
  <g clip-path="url(#taskListClip)">${tasks
    .map((task, index) => {
      const y = 347 + index * 42;
      const titleLines = wrapText(task.title, 27, 1);
      return `
        <rect x="432" y="${y - 22}" width="322" height="38" rx="10" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1"/>
        <text x="446" y="${y - 6}" font-size="11" font-weight="700" fill="#111827">${escapeXml(titleLines[0])}</text>
        <text x="446" y="${y + 10}" font-size="8" font-weight="700" fill="#4b5563">${escapeXml(trimText(task.projectName, 20))}</text>
        <text x="742" y="${y + 10}" text-anchor="end" font-size="8" font-weight="700" fill="#111827">${escapeXml(trimText(task.dueLabel, 17))}</text>
      `;
    })
    .join('')}</g>
  ${tasks.length ? '' : `<text x="432" y="378" font-family="${SVG_FONT_STACK}" font-size="16" font-weight="700" fill="#4b5563">Sin tareas urgentes.</text>`}

  <text x="28" y="468" font-size="8" font-weight="700" fill="#4b5563">SVG ${EPAPER_IMAGE_WIDTH}×${EPAPER_IMAGE_HEIGHT} · versión ${escapeXml(snapshot.version)} · ${snapshot.dataQuality.tasksConsidered} tareas operativas</text>
</svg>`;
}

const statusSvg = (title: string, message: string) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${EPAPER_IMAGE_WIDTH}" height="${EPAPER_IMAGE_HEIGHT}" viewBox="0 0 ${EPAPER_IMAGE_WIDTH} ${EPAPER_IMAGE_HEIGHT}">
  <rect width="800" height="480" fill="#fff"/>
  <rect x="40" y="40" width="720" height="400" rx="24" fill="#fff" stroke="#111827" stroke-width="3"/>
  <text x="400" y="180" text-anchor="middle" font-family="${SVG_FONT_STACK}" font-size="18" font-weight="700" fill="#111827" letter-spacing="2">PIXEL EPAPER</text>
  <text x="400" y="235" text-anchor="middle" font-family="${SVG_FONT_STACK}" font-size="40" font-weight="700" fill="#111827">${escapeXml(title)}</text>
  <foreignObject x="90" y="260" width="620" height="110">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family: 'DejaVu Sans', Arial, Helvetica, sans-serif; text-align: center; font-size: 22px; font-weight: 700; line-height: 1.25; color: #4b5563;">${escapeXml(message)}</div>
  </foreignObject>
</svg>`;

export async function GET(request: NextRequest) {
  const auth = authorizeEpaperRequest(request);
  if (!auth.ok) {
    return new NextResponse(statusSvg('Sin acceso', auth.message), {
      status: auth.status,
      headers,
    });
  }

  try {
    const snapshot = await getEpaperDashboardSnapshot();
    return new NextResponse(dashboardSvg(snapshot), { headers });
  } catch (error: any) {
    return new NextResponse(statusSvg('Dashboard en pausa', error?.message || 'No se pudo crear el dashboard ePaper.'), {
      headers,
    });
  }
}
