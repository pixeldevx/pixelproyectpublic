type SendEmailParams = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  idempotencyKey?: string;
};

export const getEmailFromAddress = () =>
  process.env.RESEND_FROM_EMAIL ||
  process.env.EMAIL_FROM ||
  'Pixel Project <notificaciones@pixelprojects.com.co>';

export const sendEmailWithResend = async ({ to, subject, html, text, idempotencyKey }: SendEmailParams) => {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    return {
      skipped: true,
      reason: 'missing_resend_api_key',
    };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey.slice(0, 256) } : {}),
    },
    body: JSON.stringify({
      from: getEmailFromAddress(),
      to,
      subject,
      html,
      text,
    }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.message || data?.error?.message || 'Resend no pudo enviar el correo.');
  }

  return {
    skipped: false,
    id: data?.id,
  };
};
