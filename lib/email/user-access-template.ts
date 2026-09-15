import { buildPixelEmailHtml, buildPixelEmailText, type PixelEmailData } from './pixel-brand';

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

const roleLabels: Record<string, string> = {
  admin: 'Administrador del espacio',
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
  if (!Array.isArray(organizationIds) || organizationIds.length === 0) return 'Tu espacio de trabajo';
  return organizationIds.length === 1 ? '1 organización asignada' : `${organizationIds.length} organizaciones asignadas`;
};

export const buildUserAccessSubject = (data: UserAccessEmailData) => data.mode === 'invite'
  ? 'Tu equipo te espera en Pixel Project'
  : 'Configura tu contraseña de Pixel Project';

const emailContent = (data: UserAccessEmailData): PixelEmailData => ({
  appUrl: data.appUrl,
  preview: data.mode === 'invite' ? 'Acepta tu invitación y empieza a trabajar con tu equipo.' : 'Usa este enlace personal para configurar tu contraseña.',
  eyebrow: data.mode === 'invite' ? 'Tu próximo proyecto empieza aquí' : 'Acceso a tu cuenta',
  heading: data.mode === 'invite' ? 'Tu equipo te espera.' : 'Recupera el acceso a tu espacio.',
  paragraphs: data.mode === 'invite'
    ? [`Hola ${data.recipientName || 'de nuevo'},`, `${data.invitedBy || 'El administrador de tu espacio'} te invitó a Pixel Project. Crea tu contraseña para organizar proyectos, compartir tareas y avanzar junto a tu equipo.`, 'Tu acceso pertenece al espacio que te invitó. Sus proyectos y archivos se mantienen separados de otros espacios.']
    : [`Hola ${data.recipientName || 'de nuevo'},`, 'Se solicitó un enlace para configurar tu contraseña de Pixel Project. Elige una nueva contraseña para volver a tu espacio de trabajo.'],
  details: [
    { label: 'Cuenta', value: data.recipientEmail },
    { label: 'Rol', value: data.roleLabel },
    { label: 'Espacio', value: data.organizationLabel },
    ...(data.mode === 'invite' ? [{ label: 'Invitación de', value: data.invitedBy || 'Administrador del espacio' }] : []),
  ],
  action: { label: data.mode === 'invite' ? 'Aceptar y crear mi contraseña' : 'Configurar mi contraseña', url: data.actionUrl },
  note: data.mode === 'invite'
    ? 'Este enlace es personal y tiene vigencia limitada. No lo compartas. Si no esperabas esta invitación, puedes ignorar el mensaje. Pixel nunca te pedirá tu contraseña por correo.'
    : 'Si no solicitaste este cambio, ignora este mensaje: tu contraseña seguirá igual. Este enlace es personal y tiene vigencia limitada. No lo compartas.',
});

export const buildUserAccessText = (data: UserAccessEmailData) => buildPixelEmailText(emailContent(data));
export const buildUserAccessEmailHtml = (data: UserAccessEmailData) => buildPixelEmailHtml(emailContent(data));
