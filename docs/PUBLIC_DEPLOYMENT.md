# Instancia pública independiente

- Repositorio: https://github.com/pixeldevx/pixelproyectpublic
- Dominio: https://public.pixelprojects.com.co
- Supabase: pixelpublic (`ilwufjkxpgeggojppmzl`).
- Origen del código: revisión `80def6c7525295fa7c31fb9352c03b84f292d75a`; historial independiente.

## Configuración

Configurar en Vercel las variables de `.env.example`. Como mínimo: URL de Supabase, clave pública, clave de servidor, bucket, URL del sitio y correo bootstrap privado. No subir `.env.local` ni valores secretos. Las claves de Resend, GitHub, S3, OpenAI y Web Push son opcionales y no se copian de la instancia corporativa.

El administrador debe existir también en Supabase Auth. Registrar su correo mediante `app.bootstrap_admin_email` en una sesión SQL privada; la migración 0002 omite el usuario si no se configura un correo real. Crear su cuenta y contraseña desde Supabase Auth. Configurar la URL de sitio y redirecciones `/login` y `/reset-password` con el dominio de esta instancia.

## Diferencias deliberadas

- Bucket `pixel-project-files` privado.
- `/api/storage/file` valida la sesión y descarga con el token del visitante, respetando las políticas de Supabase. No utiliza la clave administrativa para leer archivos.
- Cookie de archivos HttpOnly, SameSite Strict, restringida a `/api/storage`, con vencimiento y eliminación al salir. Respuestas privadas sin caché; contenido activo aislado.
- Los enlaces permanentes de archivos requieren sesión. Los enlaces firmados solicitados explícitamente duran cinco minutos.
- Imágenes sin optimizador intermedio para conservar autenticación y evitar caché pública.
- Avisos de anticipos desactivados por decisión del propietario, sin copia de datos para notificaciones.
- Sin trabajo automático de borrado de alertas.
- Integración de aprendizaje específica del cliente excluida de código y migraciones.
- No se migraron datos, archivos, usuarios Auth ni credenciales de la instancia corporativa.

## Validación

```sh
npm ci
node --test tests/*.test.cjs
npm run build
```

## Registro y espacios de prueba

La portada explica los módulos e incluye acceso a `/register`. Un correo confirmado crea, de forma transaccional, un espacio privado con organización, perfil de propietario y roles iniciales. La prueba dura 14 días sin tarjeta; al vencer se bloquea el acceso operativo y se conservan los datos. La misma base soporta todos los espacios mediante membresías protegidas y políticas RLS.

Antes de aplicar `20260915200621_workspace_trials.sql`, debe existir exactamente un administrador inicial en Auth que coincida con el perfil bootstrap. La migración conserva los registros actuales dentro de su espacio activo. No debe aplicarse a una instalación corporativa con múltiples administradores sin adaptar antes el traspaso.

Para completar registros del público general, configura un remitente y SMTP propio en **Supabase → Authentication → Email**. Mantén la confirmación de correo habilitada. El servicio integrado de prueba limita los destinatarios; configurar `RESEND_API_KEY` en Vercel por sí solo no configura los correos de Auth. Las invitaciones de la app ofrecen un enlace manual cuando no está configurado Resend.

En el despliegue del 15 de septiembre de 2026, el SMTP propio sigue pendiente. El formulario, el aprovisionamiento de espacios y el aislamiento están implementados; la confirmación de correo para cualquier visitante debe verificarse tras configurar el proveedor.

Consulta [WORKSPACES.md](WORKSPACES.md) para el alcance de seguridad y las pruebas reproducibles.
