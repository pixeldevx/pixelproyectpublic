export type UserAccessEmailMode = 'invite' | 'recovery';

export type UserAccessEmailData = {
  appUrl: string;
  actionUrl: string;
  recipientName: string;
  recipientEmail: string;
  invitedBy: string;
  roleLabel: string;
  organizationLabel: string;
  mode: UserAccessEmailMode;
};

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const roleLabels: Record<string, string> = {
  admin: 'Administrador global',
  org_admin: 'Administrador de organización',
  manager: 'Gerente de proyecto',
  coordinador: 'Coordinador',
  administrativo: 'Administrativo',
  user: 'Usuario',
};

export const getUserAccessRoleLabel = (role: unknown) => {
  const key = String(role || '').trim();
  return roleLabels[key] || key || 'Usuario';
};

export const getOrganizationAccessLabel = (organizationIds: unknown) => {
  if (!Array.isArray(organizationIds) || organizationIds.length === 0) {
    return 'Acceso global';
  }

  if (organizationIds.length === 1) {
    return '1 organización asignada';
  }

  return `${organizationIds.length} organizaciones asignadas`;
};

export const buildUserAccessSubject = (data: UserAccessEmailData) =>
  data.mode === 'invite'
    ? `Activa tu acceso a Pixel Project, ${data.recipientName}`
    : `Tu enlace de acceso a Pixel Project está listo`;

export const buildUserAccessText = (data: UserAccessEmailData) => {
  const headline =
    data.mode === 'invite'
      ? 'Te invitaron a crear tu contraseña y activar tu cuenta en Pixel Project.'
      : 'Te enviamos un nuevo enlace para configurar tu contraseña en Pixel Project.';

  return `${headline}

Hola ${data.recipientName},

Pixel Project organiza tareas, workflows, presupuestos, calidad, mapas e inventario en un solo sistema inteligente de seguimiento.

Rol: ${data.roleLabel}
Alcance: ${data.organizationLabel}
Invitado por: ${data.invitedBy || 'Administrador Pixel Project'}

Crear contraseña: ${data.actionUrl}

Por seguridad, usa este enlace solamente desde tu correo. Si no esperabas esta invitación, ignora este mensaje.

${data.appUrl}`;
};

const infoPill = (label: string, value: string, accent: string) => `
  <tr>
    <td style="padding: 9px 0; color: #7180a3; font-size: 11px; text-transform: uppercase; letter-spacing: .16em; font-weight: 800;">${escapeHtml(label)}</td>
    <td align="right" style="padding: 9px 0;">
      <span style="display: inline-block; max-width: 300px; padding: 7px 11px; border-radius: 999px; color: ${accent}; background: rgba(255,255,255,.06); border: 1px solid rgba(148,163,184,.18); font-size: 13px; line-height: 1.35; font-weight: 800;">
        ${escapeHtml(value)}
      </span>
    </td>
  </tr>
`;

const pixelGrid = () => {
  const colors = [
    '#5b4bff',
    '#22d3ee',
    '#10b981',
    '#f59e0b',
    '#f8fafc',
    '#818cf8',
    '#64748b',
    '#fb7185',
    '#38bdf8',
  ];

  return `
    <table role="presentation" cellspacing="0" cellpadding="0" style="border-spacing: 4px;">
      ${[0, 1, 2]
        .map(
          (row) => `
            <tr>
              ${[0, 1, 2]
                .map((col) => {
                  const color = colors[row * 3 + col];
                  return `<td style="width: 12px; height: 12px; border-radius: 3px; background: ${color}; box-shadow: 0 0 18px rgba(34,211,238,.16);"></td>`;
                })
                .join('')}
            </tr>
          `
        )
        .join('')}
    </table>
  `;
};

export const buildUserAccessEmailHtml = (data: UserAccessEmailData) => {
  const preview =
    data.mode === 'invite'
      ? 'Activa tu cuenta y crea tu contraseña en Pixel Project'
      : 'Configura tu contraseña con tu nuevo enlace de acceso a Pixel Project';
  const headline =
    data.mode === 'invite'
      ? 'Tu cuenta Pixel Project está lista'
      : 'Tu nuevo enlace de acceso está listo';
  const eyebrow = data.mode === 'invite' ? 'Invitación inicial' : 'Reenvío de acceso';
  const cta = data.mode === 'invite' ? 'Crear mi contraseña' : 'Configurar contraseña';

  return `<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(preview)}</title>
  </head>
  <body style="margin: 0; padding: 0; background: #f4f7fb; color: #0f172a; font-family: Arial, Helvetica, sans-serif;">
    <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">${escapeHtml(preview)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: #f4f7fb; padding: 34px 14px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 680px; border-collapse: separate; border-spacing: 0;">
            <tr>
              <td style="padding: 0 6px 16px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td>
                      <table role="presentation" cellspacing="0" cellpadding="0">
                        <tr>
                          <td style="width: 52px; height: 52px; border-radius: 16px; background: #050816; box-shadow: 0 16px 35px rgba(15,23,42,.18);">
                            ${pixelGrid()}
                          </td>
                          <td style="padding-left: 13px;">
                            <div style="font-size: 20px; line-height: 1; font-weight: 900; letter-spacing: -.04em; color: #0f172a;">Pixel Project</div>
                            <div style="margin-top: 5px; color: #64748b; font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase;">Intelligent project control</div>
                          </td>
                        </tr>
                      </table>
                    </td>
                    <td align="right" style="color: #94a3b8; font-size: 12px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase;">Acceso seguro</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="border-radius: 30px; overflow: hidden; background: #050816; box-shadow: 0 28px 80px rgba(15,23,42,.22);">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: radial-gradient(circle at 8% 0%, rgba(91,75,255,.68), transparent 32%), radial-gradient(circle at 92% 8%, rgba(34,211,238,.30), transparent 28%), #050816;">
                  <tr>
                    <td style="padding: 34px 36px 22px;">
                      <div style="display: inline-block; padding: 7px 11px; border-radius: 999px; border: 1px solid rgba(34,211,238,.38); color: #a5f3fc; background: rgba(8,145,178,.16); font-size: 11px; line-height: 1; font-weight: 900; text-transform: uppercase; letter-spacing: .16em;">${escapeHtml(eyebrow)}</div>
                      <h1 style="margin: 18px 0 10px; color: #ffffff; font-size: 34px; line-height: 1.05; letter-spacing: -.05em; font-weight: 900;">${escapeHtml(headline)}</h1>
                      <p style="margin: 0; max-width: 560px; color: #b8c6e6; font-size: 16px; line-height: 1.65;">
                        Hola <strong style="color: #ffffff;">${escapeHtml(data.recipientName)}</strong>, te damos la bienvenida al sistema donde cada tarea, presupuesto, revisión de calidad y decisión del proyecto queda conectada como un pixel de una imagen completa.
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 0 36px 26px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border: 1px solid rgba(148,163,184,.18); border-radius: 24px; background: rgba(15,23,42,.70);">
                        <tr>
                          <td style="padding: 20px 22px;">
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                              ${infoPill('Correo', data.recipientEmail, '#a5f3fc')}
                              ${infoPill('Rol', data.roleLabel, '#c4b5fd')}
                              ${infoPill('Alcance', data.organizationLabel, '#86efac')}
                              ${infoPill('Invitado por', data.invitedBy || 'Administrador Pixel Project', '#fbbf24')}
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 0 36px 34px;">
                      <a href="${escapeHtml(data.actionUrl)}" style="display: block; text-align: center; text-decoration: none; border-radius: 18px; padding: 16px 20px; color: #ffffff; background: linear-gradient(135deg, #5b4bff, #22d3ee); font-size: 16px; font-weight: 900; box-shadow: 0 18px 42px rgba(34,211,238,.24);">${escapeHtml(cta)}</a>
                      <p style="margin: 18px 0 0; color: #8da0c5; font-size: 12px; line-height: 1.6; text-align: center;">
                        Este enlace es personal. Si el botón no funciona, copia y pega este link en tu navegador:<br />
                        <a href="${escapeHtml(data.actionUrl)}" style="color: #a5f3fc; text-decoration: none; word-break: break-all;">${escapeHtml(data.actionUrl)}</a>
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding: 18px 8px 0; color: #64748b; font-size: 12px; line-height: 1.55; text-align: center;">
                Pixel Project · Gestión inteligente de proyectos, calidad, presupuesto y operación.<br />
                <a href="${escapeHtml(data.appUrl)}" style="color: #5b4bff; text-decoration: none; font-weight: 800;">${escapeHtml(data.appUrl)}</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};
