export type AdvanceRequestNotificationEmailData = {
  recipientName: string;
  requesterName: string;
  projectName: string;
  organizationName: string;
  amountLabel: string;
  purpose: string;
  destination: string;
  travelPeriod: string;
  costCenterName: string;
  actionUrl: string;
  appUrl: string;
};

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const buildAdvanceRequestNotificationSubject = (
  data: AdvanceRequestNotificationEmailData
) => `Nueva solicitud de anticipo · ${data.projectName} · ${data.requesterName}`;

export const buildAdvanceRequestNotificationText = (
  data: AdvanceRequestNotificationEmailData
) => `Hola ${data.recipientName},

${data.requesterName} radicó una nueva solicitud de anticipo en Pixel Project.

Proyecto: ${data.projectName}
Organización: ${data.organizationName}
Valor solicitado: ${data.amountLabel}
Destino: ${data.destination}
Periodo: ${data.travelPeriod}
Centro de costos: ${data.costCenterName}
Justificación: ${data.purpose}

Consultar solicitud: ${data.actionUrl}
`;

const detailRow = (label: string, value: string, accent: string) => `
  <tr>
    <td style="padding:10px 0;color:#8290ae;font-size:11px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;width:38%;">${escapeHtml(label)}</td>
    <td style="padding:10px 0;color:#eef4ff;font-size:14px;font-weight:800;text-align:right;">
      <span style="display:inline-block;max-width:330px;color:${accent};">${escapeHtml(value)}</span>
    </td>
  </tr>`;

export const buildAdvanceRequestNotificationHtml = (
  data: AdvanceRequestNotificationEmailData
) => {
  const preview = `${data.requesterName} solicitó ${data.amountLabel} para ${data.projectName}`;

  return `<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(preview)}</title>
  </head>
  <body style="margin:0;padding:0;background:#070b19;color:#eef4ff;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preview)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:36px 16px;background:radial-gradient(circle at top left,#075985 0,#111936 38%,#070b19 76%);">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;border-collapse:separate;border-spacing:0;">
            <tr>
              <td style="padding:0 0 18px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td><div style="display:inline-block;width:48px;height:48px;border-radius:14px;background:linear-gradient(135deg,#06b6d4,#6d5dfc);color:#fff;text-align:center;line-height:48px;font-size:21px;font-weight:900;">PX</div></td>
                    <td align="right" style="color:#93a2c7;font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;">Pixel Project</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="overflow:hidden;border:1px solid rgba(148,163,184,.22);border-radius:28px;background:rgba(11,18,38,.94);box-shadow:0 24px 70px rgba(0,0,0,.38);">
                <div style="height:5px;background:linear-gradient(90deg,#06b6d4,#6d5dfc,#00c875);"></div>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="padding:34px 34px 18px;">
                      <div style="display:inline-block;border:1px solid rgba(34,211,238,.28);border-radius:999px;padding:6px 10px;background:rgba(34,211,238,.10);color:#8be8ff;font-size:11px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;">Alerta administrativa</div>
                      <h1 style="margin:18px 0 8px;color:#fff;font-size:28px;line-height:1.18;letter-spacing:-.02em;">Nueva solicitud de anticipo</h1>
                      <p style="margin:0;color:#a8b7d7;font-size:15px;line-height:1.6;">Hola ${escapeHtml(data.recipientName)}, ${escapeHtml(data.requesterName)} radicó una solicitud que puedes consultar desde Pixel.</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 34px 22px;">
                      <div style="border:1px solid rgba(34,211,238,.22);border-radius:22px;padding:22px;background:linear-gradient(180deg,rgba(8,145,178,.16),rgba(17,25,54,.64));">
                        <div style="color:#8be8ff;font-size:12px;font-weight:900;letter-spacing:.10em;text-transform:uppercase;">${escapeHtml(data.projectName)}</div>
                        <div style="margin-top:8px;color:#fff;font-size:24px;font-weight:900;line-height:1.25;">${escapeHtml(data.amountLabel)}</div>
                        <div style="margin-top:10px;color:#bdcae5;font-size:14px;line-height:1.55;">${escapeHtml(data.purpose || 'Sin justificación registrada')}</div>
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 34px 24px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid rgba(148,163,184,.15);border-bottom:1px solid rgba(148,163,184,.15);">
                        ${detailRow('Solicitante', data.requesterName, '#a7f3d0')}
                        ${detailRow('Organización', data.organizationName, '#8be8ff')}
                        ${detailRow('Destino', data.destination, '#c4b5fd')}
                        ${detailRow('Periodo', data.travelPeriod, '#fcd34d')}
                        ${detailRow('Centro de costos', data.costCenterName, '#f0abfc')}
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 34px 36px;">
                      <a href="${escapeHtml(data.actionUrl)}" style="display:block;border-radius:16px;padding:15px 18px;background:linear-gradient(135deg,#0891b2,#6d5dfc);box-shadow:0 18px 38px rgba(34,211,238,.20);color:#fff;font-size:15px;font-weight:900;text-align:center;text-decoration:none;">Consultar anticipo</a>
                      <p style="margin:16px 0 0;color:#7180a3;font-size:12px;line-height:1.5;text-align:center;">Los destinatarios de esta alerta se configuran desde el Centro de Alertas de Pixel Project.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 8px 0;color:#61708f;font-size:12px;line-height:1.5;text-align:center;">Pixel Project · Control administrativo<br /><a href="${escapeHtml(data.appUrl)}" style="color:#8be8ff;text-decoration:none;">${escapeHtml(data.appUrl)}</a></td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};
