/** Shared, image-independent identity for transactional Pixel emails. */
export const PIXEL_EMAIL_BRAND = {
  name: 'Pixel Project',
  ink: '#20352f',
  muted: '#65716a',
  paper: '#faf9f5',
  line: '#dfe4dc',
  coral: '#c94d32',
} as const;

export const escapeEmailHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Links come from trusted app/Auth configuration, never from profile metadata. */
export function validateEmailUrl(value: string): string {
  if (!value || /[\u0000-\u0020\u007f]/.test(value)) throw new Error('El enlace del correo no es válido.');
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password) {
    throw new Error('El enlace del correo debe usar HTTPS.');
  }
  return url.href;
}

type EmailDetail = { label: string; value: string };
export type PixelEmailData = {
  appUrl: string;
  preview: string;
  eyebrow: string;
  heading: string;
  paragraphs: string[];
  details?: EmailDetail[];
  action?: { label: string; url: string };
  code?: string;
  note: string;
};

const pixelMark = () => `<table role="presentation" aria-hidden="true" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:2px;">${[0, 1, 2].map(row => `<tr>${[0, 1, 2].map(col => {
  const index = row * 3 + col;
  const color = index === 8 ? PIXEL_EMAIL_BRAND.paper : [2, 5, 7].includes(index) ? PIXEL_EMAIL_BRAND.coral : PIXEL_EMAIL_BRAND.ink;
  return `<td width="8" height="8" bgcolor="${color}" style="width:8px;height:8px;font-size:0;line-height:0;">&nbsp;</td>`;
}).join('')}</tr>`).join('')}</table>`;

export function buildPixelEmailHtml(data: PixelEmailData): string {
  const b = PIXEL_EMAIL_BRAND;
  const esc = escapeEmailHtml;
  const appUrl = esc(validateEmailUrl(data.appUrl));
  const actionUrl = data.action ? esc(validateEmailUrl(data.action.url)) : '';
  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(data.preview)}</title></head>
<body style="margin:0;padding:0;background-color:${b.paper};color:${b.ink};font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(data.preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${b.paper}" style="background-color:${b.paper};">
<tr><td align="center" style="padding:32px 16px;">
<!--[if mso]><table role="presentation" width="600"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
<tr><td style="padding:0 0 26px;">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-right:10px;">${pixelMark()}</td><td style="font-size:24px;letter-spacing:-1px;color:${b.ink};"><strong>pixel</strong><span style="font-weight:400;">project</span></td></tr></table>
</td></tr>
<tr><td style="border-top:4px solid ${b.coral};border-right:1px solid ${b.line};border-bottom:1px solid ${b.line};border-left:1px solid ${b.line};background-color:#ffffff;padding:32px 24px;">
  <p style="margin:0 0 14px;color:${b.coral};font-size:11px;line-height:1.6;font-weight:bold;letter-spacing:1.3px;text-transform:uppercase;">${esc(data.eyebrow)}</p>
  <h1 style="margin:0 0 22px;color:${b.ink};font-size:32px;line-height:1.15;letter-spacing:-1px;font-weight:600;">${esc(data.heading)}</h1>
  ${data.paragraphs.map(p => `<p style="margin:0 0 16px;color:${b.muted};font-size:15px;line-height:1.75;">${esc(p)}</p>`).join('\n  ')}
  ${data.details?.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f0f2e9" style="background-color:#f0f2e9;margin:22px 0;"><tr><td style="padding:8px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${data.details.map(detail => `<tr><td style="padding:10px 0;color:${b.muted};font-size:12px;line-height:1.5;vertical-align:top;width:32%;">${esc(detail.label)}</td><td style="padding:10px 0 10px;color:${b.ink};font-size:13px;font-weight:bold;line-height:1.5;overflow-wrap:anywhere;word-break:break-word;">${esc(detail.value)}</td></tr>`).join('')}</table></td></tr></table>` : ''}
  ${data.code ? `<p style="margin:24px 0;padding:18px;background-color:#f0f2e9;color:${b.ink};font-size:30px;letter-spacing:8px;font-weight:bold;text-align:center;">${esc(data.code)}</p>` : ''}
  ${data.action ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td bgcolor="${b.coral}" style="background-color:${b.coral};border-radius:4px;text-align:center;mso-padding-alt:16px 22px;"><a href="${actionUrl}" style="display:inline-block;padding:16px 22px;border:1px solid ${b.coral};border-radius:4px;color:#ffffff;font-size:14px;line-height:1.3;font-weight:bold;text-decoration:none;">${esc(data.action.label)}&nbsp; &#8599;</a></td></tr></table>
  <p style="margin:0 0 22px;color:${b.muted};font-size:12px;line-height:1.7;">Si el botón no funciona, copia este enlace en tu navegador:<br><a href="${actionUrl}" style="color:${b.ink};text-decoration:underline;word-break:break-all;overflow-wrap:anywhere;">${actionUrl}</a></p>` : ''}
  <p style="margin:24px 0 0;padding-top:20px;border-top:1px solid ${b.line};color:${b.muted};font-size:12px;line-height:1.7;">${esc(data.note)}</p>
</td></tr>
<tr><td style="padding:23px 4px 0;color:${b.muted};font-size:12px;line-height:1.8;">
  <strong style="color:${b.ink};">Pixel Project</strong><br>Tu equipo. Tus proyectos. Un mismo lugar.<br>
  <a href="${appUrl}" style="color:${b.ink};text-decoration:underline;">Conoce Pixel Project</a>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>`;
}

export function buildPixelEmailText(data: PixelEmailData): string {
  const appUrl = validateEmailUrl(data.appUrl);
  const action = data.action ? `${data.action.label}: ${validateEmailUrl(data.action.url)}\n\n` : '';
  const details = data.details?.length ? `${data.details.map(detail => `${detail.label}: ${detail.value}`).join('\n')}\n\n` : '';
  return `${data.heading}\n\n${data.paragraphs.join('\n\n')}\n\n${details}${data.code ? `Código: ${data.code}\n\n` : ''}${action}${data.note}\n\nPixel Project · Tu equipo. Tus proyectos. Un mismo lugar.\n${appUrl}`;
}
