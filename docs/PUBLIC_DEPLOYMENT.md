# Instancia pública independiente

- Repositorio: https://github.com/pixeldevx/pixelproyectpublic
- Dominio previsto: https://public.pixelprojects.com.co
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
node --test tests/private-storage.test.cjs
npm run build
```

El modelo de permisos del proyecto original usa miembros invitados. Esta versión no incorpora registro abierto ni una nueva arquitectura de aislamiento entre clientes. Revisar esos permisos antes de ofrecer autoservicio a organizaciones independientes.
