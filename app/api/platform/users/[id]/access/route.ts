import { NextRequest } from 'next/server';
import { platformFailure, platformJson, platformRpc, requirePlatformAdmin, requireUuid, supportReason } from '@/lib/platform/server';
import { WorkspaceAccessError } from '@/lib/workspaces/server';
import { sendEmailWithResend } from '@/lib/email/resend';
import { buildUserAccessEmailHtml, buildUserAccessSubject, buildUserAccessText, getUserAccessRoleLabel } from '@/lib/email/user-access-template';
export const runtime = 'nodejs';
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { client, actor } = await requirePlatformAdmin(request);
    const userId = requireUuid((await context.params).id);
    const payload = await request.json();
    const reason = supportReason(payload.reason);
    const mode = payload.mode;
    if (mode !== 'invite' && mode !== 'recovery') throw new WorkspaceAccessError('Tipo de enlace no válido.', 400);
    const { data, error } = await client.auth.admin.getUserById(userId);
    if (error || !data.user?.email) throw new WorkspaceAccessError('Usuario no encontrado.', 404);
    if (!data.user.email_confirmed_at && !data.user.invited_at) throw new WorkspaceAccessError('Esta cuenta debe confirmar su registro desde el correo de confirmación.', 400);
    if (mode === 'invite' && data.user.email_confirmed_at) throw new WorkspaceAccessError('La cuenta ya está activa. Usa recuperación de acceso.', 400);
    if (mode === 'recovery' && !data.user.email_confirmed_at) throw new WorkspaceAccessError('La cuenta aún debe aceptar su invitación.', 400);
    const { data: member, error: memberError } = await client.from('app_workspace_members').select('workspace_id,suspended_at').eq('user_id', userId).maybeSingle();
    if (memberError) throw new WorkspaceAccessError('No se pudo comprobar el espacio.', 503);
    if (member?.suspended_at) throw new WorkspaceAccessError('Reactiva la cuenta antes de enviar un enlace.', 400);
    const appUrl = process.env.NEXT_PUBLIC_SITE_URL;
    if (!appUrl || !appUrl.startsWith('https://')) throw new WorkspaceAccessError('Configura el dominio público para los enlaces de acceso.', 503);
    // Audit before generation/delivery. Never persist the action token or URL.
    await platformRpc(client, 'app_platform_log_access', { p_actor_id: actor.id, p_workspace_id: member?.workspace_id || null,
      p_target_id: userId, p_action: `access.${mode}`, p_reason: reason });
    const { data: generated, error: linkError } = await client.auth.admin.generateLink({ type: mode, email: data.user.email,
      options: { redirectTo: `${appUrl.replace(/\/$/, '')}/reset-password` } });
    if (linkError || !generated.properties?.action_link || generated.user?.id !== userId) throw new WorkspaceAccessError('No se pudo generar el enlace de acceso.', 502);
    const { data: profile } = member ? await client.from('app_documents').select('data').eq('tenant_id',member.workspace_id)
      .eq('collection_path','users').eq('doc_id',userId).maybeSingle() : { data: null };
    const emailData = { appUrl, actionUrl: generated.properties.action_link,
      recipientName: String(profile?.data?.displayName || data.user.user_metadata?.displayName || data.user.email.split('@')[0]),
      recipientEmail: data.user.email, invitedBy: actor.email || 'Soporte Pixel', roleLabel: getUserAccessRoleLabel(profile?.data?.role),
      organizationLabel: 'Tu espacio de trabajo', mode };
    const delivery = await sendEmailWithResend({ to: data.user.email, subject: buildUserAccessSubject(emailData),
      html: buildUserAccessEmailHtml(emailData), text: buildUserAccessText(emailData) });
    return platformJson({ delivery: delivery.skipped ? 'manual' : 'email',
      ...(delivery.skipped ? { actionLink: generated.properties.action_link } : {}),
      message: delivery.skipped ? 'Enlace creado. El correo automático está pendiente; compártelo de forma privada con la persona.' : 'Correo de acceso enviado.' });
  } catch (error) { return platformFailure(error); }
}
