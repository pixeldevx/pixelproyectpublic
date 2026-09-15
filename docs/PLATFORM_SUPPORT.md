# Administración global y aprendizaje

## Panel de soporte

La cuenta inicial de la plataforma accede a `/platform` desde **Administración global**. Al iniciar sesión, esta cuenta llega directamente al panel global; conserva su espacio operativo desde Inicio.

El panel incluye totales, búsqueda y paginación de usuarios, espacios y organizaciones. En cada espacio permite corregir nombres, activar o pausar el acceso, ajustar el vencimiento de una prueba, consultar miembros y revisar el historial. Los usuarios pueden editarse, suspenderse o reactivarse; sus organizaciones deben pertenecer al mismo espacio. El propietario conserva su rol administrativo y la cuenta global no puede pausarse a sí misma.

Desde la ficha se puede crear e invitar una cuenta nueva al espacio seleccionado. No se trasladan cuentas que ya pertenezcan a otro espacio. Para problemas de acceso se generan invitaciones o recuperaciones: la persona elige su propia contraseña. Si falta Resend, se entrega un enlace manual con respuesta privada y sin caché. No se almacena el enlace en la auditoría.

Los registros públicos sin confirmar aparecen en el directorio de usuarios. Deben completar la confirmación de correo antes de obtener un espacio; soporte no los transforma en invitados ni confirma el correo en su nombre.

## Límite de autorización

Cada endpoint de `/api/platform` verifica el token con Supabase Auth, el correo contra la configuración privada `BOOTSTRAP_ADMIN_EMAILS` y la membresía del propietario original (`legacy_storage`). Un perfil de usuario con rol `admin` en una prueba no cumple estas condiciones.

Las consultas globales se ejecutan mediante funciones disponibles únicamente para `service_role`. Las funciones internas también verifican que el actor sea el propietario original. No se amplía ninguna política RLS para leer otras organizaciones desde el cliente. No hay suplantación de usuarios ni modificación arbitraria de sus documentos operativos.

`platform_support_audit` registra actor, espacio, destino, acción, motivo y los cambios administrativos. Los cambios de perfil, membresía y su auditoría se guardan en la misma transacción. Generación de enlaces e invitaciones registra el intento antes de llamar a Auth; una creación completada añade otra entrada. Los eventos no afirman que un correo llegó a la bandeja del destinatario.

Suspender una cuenta establece `app_workspace_members.suspended_at`. Las políticas de datos y Storage lo consultan, así que un token emitido antes de la suspensión no conserva acceso a los datos. Las APIs de servidor también rechazan esa membresía. Los datos y la cuenta se conservan para su reactivación.

La migración `20260915204258_platform_support.sql` añade estos controles sin mover los datos existentes. La vista de detalle muestra hasta 200 usuarios; el directorio general pagina de 20 en 20 y admite filtrar por espacio.

## Tutorial interactivo

**Aprender Pixel** (`/tutorial`) contiene prácticas de proyecto, usuarios e invitaciones, grupos de tareas, asignaciones, Gantt, flujos y Rate Cards. Cada práctica tiene instrucciones, acciones simuladas y validación de los pasos. Los enlaces opcionales llevan al módulo real.

Los ejercicios son independientes y no escriben en Supabase ni envían correos. El navegador conserva únicamente los identificadores de lecciones completadas, separados por cuenta y espacio. Se puede reiniciar el progreso.

## Verificación

```sh
node --test tests/*.test.cjs
PGLITE_MODULE_ROOT=/tmp/pixel-db-tests node tests/run-workspace-db.mjs
npm run build
```

`supabase/tests/platform_support.sql` prueba acceso global, rechazo de actores y organizaciones ajenas, auditoría, suspensión con un JWT existente y recuperación del mismo espacio. Usa cuentas sintéticas en una transacción revertida. El arnés local ejecuta las 47 migraciones y también conserva las pruebas anteriores de aislamiento.

Los correos se describen en [EMAIL_TEMPLATES.md](EMAIL_TEMPLATES.md). Preparar una plantilla no configura SMTP ni prueba su entrega: ese proveedor sigue siendo necesario para el registro público general.
