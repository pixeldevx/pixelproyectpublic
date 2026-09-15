# Espacios de trabajo y exploración

## Experiencia

1. La persona conoce los módulos en la portada y elige probar Pixel.
2. Registra nombre, correo, contraseña y nombre de organización.
3. Confirma el correo en Supabase Auth y entra a la aplicación.
4. `ensure_trial_workspace` crea una sola vez su espacio, organización, perfil, miembro de equipo, configuración y roles iniciales.
5. Dispone de 14 días para probar los módulos. No se solicita tarjeta. La prueba vencida conserva los datos y bloquea las operaciones.

Cada cuenta pertenece a un único espacio en esta versión. El propietario puede invitar a personas que aún no pertenezcan a otro espacio. Una cuenta con espacio propio no puede ser incorporada silenciosamente a otro. Los módulos que requieren servicios externos necesitan sus credenciales; esos servicios no se incluyen automáticamente en la prueba.

## Una base compartida, acceso independiente

- `app_workspaces` guarda propietario, nombre, estado y vencimiento. El espacio inicial de la plataforma permanece activo.
- `app_workspace_members` es la fuente de autorización. El cliente solo puede leer su propia membresía; no puede escribirla.
- Los documentos y tablas espaciales llevan `tenant_id`. Las políticas RLS comprueban la membresía real y la vigencia del espacio.
- La clave documental incluye `(tenant_id, collection_path, doc_id)`. Dos espacios pueden usar los mismos identificadores internos sin colisiones.
- La organización de negocio vive dentro de un espacio. El límite de seguridad es el espacio, no un filtro visual de organización.
- Los perfiles no pueden cambiar su rol, identidad u organizaciones desde el navegador. Las modificaciones administrativas pasan por endpoints que verifican membresía y destino.
- Las APIs con clave de servidor usan `scopeWorkspaceClient`: filtra consultas, fija `tenant_id` en escrituras y deniega tablas o RPC desconocidas. Las operaciones de Auth también comprueban que el destinatario pertenezca al mismo espacio.
- Las funciones administrativas de contratistas reciben un espacio explícito y mantienen claves de idempotencia por espacio.
- Las licencias globales y la configuración S3 pertenecen al administrador de plataforma definido en el servidor, no a los propietarios de pruebas.

## Archivos y actualizaciones

Los archivos de pruebas van al bucket privado bajo `workspaces/<workspace-id>/…`. Storage valida la membresía y el vencimiento. Las descargas usan la sesión del visitante, sin caché pública. Las rutas heredadas solo son accesibles desde el espacio inicial.

Realtime publica inserciones y actualizaciones filtradas por espacio. Las eliminaciones no se publican porque Supabase no puede aplicar autorización por fila al registro eliminado. Las suscripciones documentales actualizan su consulta al recuperar el foco y cada 60 segundos mientras la página está visible.

## Correo e integraciones

La confirmación de email se mantiene obligatoria. Configurar SMTP propio en Supabase Auth antes de abrir el registro al público general; su servicio integrado de prueba restringe destinatarios. El Resend de la aplicación es independiente del SMTP de Auth. Sin Resend, las invitaciones muestran un enlace para compartir manualmente y avisan que no se envió correo.

Los procesos sin sesión necesitan un destino explícito: `GITHUB_AUTOMATION_WORKSPACE_ID` y `EPAPER_WORKSPACE_ID`. Si no existe, no deben consultar datos de todos los espacios.

## Validación

```sh
node --test tests/*.test.cjs
npm run build
```

Para probar todas las migraciones en PostgreSQL local embebido sin claves de nube:

```sh
npm install --prefix /tmp/pixel-db-tests @electric-sql/pglite@0.5.8
PGLITE_MODULE_ROOT=/tmp/pixel-db-tests node tests/run-workspace-db.mjs
```

El arnés reproduce políticas, permisos, disparadores y funciones. Las tablas de Auth/Storage son fixtures; reemplaza la geometría PostGIS por texto y omite su índice GiST. No prueba cálculos GIS ni conexiones WebSocket reales.

`supabase/tests/workspace_isolation.sql` y `workspace_rpc.sql` también se ejecutaron en Supabase pixelpublic después de la migración, dentro de transacciones revertidas. Cubren aprovisionamiento idempotente, dos espacios, acceso anónimo, perfiles, membresías, datos anidados, Storage, tablas espaciales, vencimiento y RPC con clave de servidor. No envían correos ni dejan usuarios de prueba.

La revisión de seguridad de Supabase deja tres avisos informativos de tablas exclusivas del servidor sin políticas para clientes. Sigue pendiente la protección de contraseñas filtradas de Auth: [configuración de Supabase](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
