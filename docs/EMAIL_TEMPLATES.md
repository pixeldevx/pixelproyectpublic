# Correos de acceso de Pixel Project

Los correos usan la identidad de la portada pública: papel crema, verde oscuro, acento coral y el símbolo de píxeles. Se construyen con tablas de presentación, estilos en línea y fuentes del sistema. No descargan logotipos externos ni incluyen seguimiento.

## Dos vías de envío

- **Invitaciones de la aplicación**: `lib/email/user-access-template.ts` genera el asunto, HTML y texto para crear una contraseña o recuperar el acceso. Las rutas de invitación y reenvío ya usan estos exports; Resend es el proveedor opcional. Si falta su configuración, la aplicación devuelve un enlace manual e indica que el correo no se envió.
- **Supabase Auth**: registro, invitación directa, restablecimiento, enlace mágico, cambio de correo y verificación adicional usan los archivos de `supabase/email-templates/`. También se incluyen avisos de contraseña y correo actualizados, sin habilitar esos avisos automáticamente.

Ambas vías comparten `lib/email/pixel-brand.ts`. El rol `admin` de un espacio se presenta como **Administrador del espacio**; no otorga administración global.

## Aplicar en Supabase

El archivo `supabase/email-templates/manifest.json` relaciona cada opción del panel con su asunto y archivo HTML. En **Authentication → Email → Templates** del proyecto público, copiar el asunto y el HTML correspondientes y guardar. Los archivos `.txt` son las versiones de texto para proveedores que permitan configurar una parte `text/plain`; el editor de Supabase publica la plantilla HTML.

| Opción del panel | Archivo |
| --- | --- |
| Confirm sign up | `confirm-signup.html` |
| Invite user | `invite-user.html` |
| Reset password | `reset-password.html` |
| Magic link | `magic-link.html` |
| Change email address | `change-email.html` |
| Reauthentication | `reauthentication.html` |
| Password changed | `password-changed.html` |
| Email address changed | `email-changed.html` |

Las plantillas conservan `{{ .ConfirmationURL }}`, `{{ .SiteURL }}` y, para reautenticación, `{{ .Token }}`. No incorporan roles ni permisos desde metadatos editables. No sustituir el enlace de verificación por una URL fija: contiene la verificación de un solo uso y la redirección configurada por Auth.

El registro redirige a `/login`; invitación y recuperación, a `/reset-password`. Mantener ambas redirecciones autorizadas para el dominio público. Mantener la confirmación de correo habilitada.

### Proveedor de correo pendiente

En la última verificación de este proyecto seguía pendiente configurar SMTP propio en Supabase y el envío opcional de Resend en la aplicación. Los archivos preparados no configuran esos proveedores ni prueban entrega real.

Desde el 3 de junio de 2026, los proyectos Free nuevos que utilizan el SMTP integrado de Supabase no pueden personalizar sus plantillas de Auth. SMTP propio permite personalizarlas; los planes Pro y superiores no tienen esa restricción. Verificar el estado del panel antes de considerar las plantillas publicadas. La configuración de `RESEND_API_KEY` en Vercel no configura automáticamente SMTP en Supabase.

Al configurar el proveedor, desactivar la reescritura o seguimiento de enlaces de autenticación. Algunos filtros de correo consumen enlaces de verificación al previsualizarlos; si ocurre, revisar el flujo de verificación con OTP antes de cambiar enlaces arbitrariamente.

## Revisión y mantenimiento

```sh
node scripts/generate-email-templates.mjs
node scripts/generate-email-templates.mjs --check
node --test tests/email-branding.test.cjs
```

La generación produce ocho pares HTML/texto y una vista previa segura: `docs/previews/pixel-invitation-email.html`. La vista previa utiliza datos ficticios y un enlace de ejemplo sin token válido. Revisar el correo en móvil y escritorio y, cuando exista proveedor, comprobar entrega con una cuenta de prueba controlada antes del lanzamiento público.

Las pruebas verifican escape de texto, rechazo de URLs peligrosas, coincidencia de los enlaces de HTML/texto, nombres de roles y preservación de las variables de Supabase. No envían correos.

## Referencias

- [Variables y comportamiento de plantillas Auth](https://supabase.com/docs/guides/auth/auth-email-templates).
- [Cambio de personalización de plantillas Free](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier).
