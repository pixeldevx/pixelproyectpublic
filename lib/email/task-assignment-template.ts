export type TaskAssignmentEmailData = {
  appUrl: string;
  assigneeName: string;
  taskTitle: string;
  projectName: string;
  organizationName: string;
  priorityLabel: string;
  statusLabel: string;
  dueDateLabel: string;
  taskTypeLabel: string;
  description: string;
  actionUrl: string;
  introTemplate?: string;
};

export const DEFAULT_TASK_ASSIGNMENT_EMAIL_SUBJECT = 'Nueva tarea en Pixel Project: {taskTitle} · {projectName}';
export const DEFAULT_TASK_ASSIGNMENT_EMAIL_INTRO = 'Hola {assigneeName}, tienes una actividad lista para gestionar dentro de Pixel Project.';

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const metaRow = (label: string, value: string, accent = '#6d5dfc') => `
  <tr>
    <td style="padding: 10px 0; color: #7d8aa5; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; width: 38%;">${escapeHtml(label)}</td>
    <td style="padding: 10px 0; color: #e9efff; font-size: 14px; font-weight: 700; text-align: right;">
      <span style="display: inline-block; padding: 5px 10px; border: 1px solid rgba(109,93,252,.24); border-radius: 999px; background: rgba(109,93,252,.10); color: ${accent};">
        ${escapeHtml(value)}
      </span>
    </td>
  </tr>
`;

const interpolateTemplate = (template: string, data: TaskAssignmentEmailData) => {
  const tokens: Record<string, string> = {
    assigneeName: data.assigneeName,
    taskTitle: data.taskTitle,
    projectName: data.projectName,
    organizationName: data.organizationName,
    priorityLabel: data.priorityLabel,
    statusLabel: data.statusLabel,
    dueDateLabel: data.dueDateLabel,
    taskTypeLabel: data.taskTypeLabel,
    actionUrl: data.actionUrl,
    appUrl: data.appUrl,
  };

  return template.replace(/\{(\w+)\}/g, (match, key) => tokens[key] || match);
};

export const buildTaskAssignmentSubject = (
  data: TaskAssignmentEmailData,
  template = DEFAULT_TASK_ASSIGNMENT_EMAIL_SUBJECT
) => interpolateTemplate(template || DEFAULT_TASK_ASSIGNMENT_EMAIL_SUBJECT, data);

export const buildTaskAssignmentIntro = (
  data: TaskAssignmentEmailData,
  template = DEFAULT_TASK_ASSIGNMENT_EMAIL_INTRO
) => interpolateTemplate(template || DEFAULT_TASK_ASSIGNMENT_EMAIL_INTRO, data);

export const buildTaskAssignmentText = (data: TaskAssignmentEmailData) => `
${buildTaskAssignmentIntro(data, data.introTemplate)}

Tienes una nueva tarea en tu bandeja de entrada.

Tarea: ${data.taskTitle}
Proyecto: ${data.projectName}
Organización: ${data.organizationName}
Prioridad: ${data.priorityLabel}
Estado: ${data.statusLabel}
Fecha límite: ${data.dueDateLabel}

Abrir: ${data.actionUrl}
`;

export const buildTaskAssignmentEmailHtml = (data: TaskAssignmentEmailData) => {
  const preview = `Nueva tarea en ${data.projectName}: ${data.taskTitle}`;
  const safeDescription = escapeHtml(data.description || 'Sin descripción').replace(/\n/g, '<br />');
  const intro = buildTaskAssignmentIntro(data, data.introTemplate);

  return `<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(preview)}</title>
  </head>
  <body style="margin:0; padding:0; background:#070b19; color:#e9efff; font-family: Arial, Helvetica, sans-serif;">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0;">${escapeHtml(preview)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: radial-gradient(circle at top left, #3427ff 0, #111936 34%, #070b19 74%); padding: 36px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 640px; border-collapse: separate; border-spacing: 0;">
            <tr>
              <td style="padding: 0 0 18px 0;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td>
                      <div style="display:inline-block; width:48px; height:48px; border-radius:14px; background:linear-gradient(135deg,#6d5dfc,#35d0ff); color:#fff; text-align:center; line-height:48px; font-weight:900; font-size:21px; box-shadow:0 12px 28px rgba(53,208,255,.25);">PX</div>
                    </td>
                    <td align="right" style="font-size:12px; color:#93a2c7; letter-spacing:.14em; text-transform:uppercase;">Pixel Project</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="border:1px solid rgba(148,163,184,.22); border-radius:28px; overflow:hidden; background:rgba(11,18,38,.88); box-shadow:0 24px 70px rgba(0,0,0,.38);">
                <div style="height:5px; background:linear-gradient(90deg,#6d5dfc,#35d0ff,#00c875);"></div>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="padding:34px 34px 18px;">
                      <div style="display:inline-block; border:1px solid rgba(53,208,255,.28); border-radius:999px; padding:6px 10px; color:#8be8ff; background:rgba(53,208,255,.10); font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.12em;">Nueva asignación</div>
                      <h1 style="margin:18px 0 8px; color:#ffffff; font-size:28px; line-height:1.18; letter-spacing:-.02em;">Tu bandeja recibió una nueva tarea</h1>
                      <p style="margin:0; color:#9fb0d1; font-size:15px; line-height:1.6;">${escapeHtml(intro)}</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 34px 24px;">
                      <div style="border:1px solid rgba(109,93,252,.24); border-radius:22px; background:linear-gradient(180deg,rgba(109,93,252,.18),rgba(17,25,54,.64)); padding:22px;">
                        <div style="font-size:12px; color:#93a2c7; text-transform:uppercase; letter-spacing:.10em; font-weight:800;">${escapeHtml(data.taskTypeLabel)}</div>
                        <div style="margin-top:8px; color:#ffffff; font-size:22px; line-height:1.25; font-weight:900;">${escapeHtml(data.taskTitle)}</div>
                        <div style="margin-top:10px; color:#b8c6e6; font-size:14px; line-height:1.55;">${safeDescription}</div>
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 34px 22px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid rgba(148,163,184,.15); border-bottom:1px solid rgba(148,163,184,.15);">
                        ${metaRow('Proyecto', data.projectName, '#8be8ff')}
                        ${metaRow('Organización', data.organizationName, '#a7f3d0')}
                        ${metaRow('Prioridad', data.priorityLabel, data.priorityLabel.toLowerCase().includes('alta') ? '#ff6b7f' : '#fbbf24')}
                        ${metaRow('Estado', data.statusLabel, '#c4b5fd')}
                        ${metaRow('Fecha límite', data.dueDateLabel, '#fbbf24')}
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 34px 36px;">
                      <a href="${escapeHtml(data.actionUrl)}" style="display:block; text-align:center; text-decoration:none; border-radius:16px; padding:15px 18px; color:#ffffff; background:linear-gradient(135deg,#6d5dfc,#35d0ff); font-size:15px; font-weight:900; box-shadow:0 18px 38px rgba(53,208,255,.24);">Abrir bandeja de entrada</a>
                      <p style="margin:16px 0 0; color:#7180a3; font-size:12px; line-height:1.5; text-align:center;">Puedes ajustar estas alertas desde el Centro de Alertas de Pixel Project.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 8px 0; color:#61708f; font-size:12px; text-align:center; line-height:1.5;">
                Pixel Project · Gestión inteligente de proyectos<br />
                <a href="${escapeHtml(data.appUrl)}" style="color:#8be8ff; text-decoration:none;">${escapeHtml(data.appUrl)}</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};
