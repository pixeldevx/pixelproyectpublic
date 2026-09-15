# GitHub App de Pixel — Fase 2

## Resultado funcional

La integración enlaza el backlog Scrum de Pixel con evidencia real de GitHub sin entregar a GitHub el control del flujo:

- Una GitHub App se instala por organización o cuenta y el proyecto selecciona únicamente sus repositorios.
- Cada desarrollador puede vincular su identidad de GitHub. Pixel guarda el perfil verificado, no el token OAuth personal.
- Ramas, commits, pull requests, checks, workflows y despliegues se enlazan mediante el código del trabajo, por ejemplo `PIX-184`.
- El primer pull request vinculado se clasifica como principal. Un responsable puede cambiarlo a principal, requerido o complementario.
- Los webhooks son idempotentes por `X-GitHub-Delivery` y por historia.
- **Reparar sincronización** consulta de nuevo pull requests y commits recientes si un webhook no llegó.
- Un commit o un merge nunca terminan automáticamente la historia. El PR principal integrado habilita **Solicitar validación**.

## 1. Crear la GitHub App

En GitHub, crea una GitHub App con estas URLs de producción:

- Homepage: `https://TU_DOMINIO`
- Setup URL: `https://TU_DOMINIO/api/github/install/callback`
- Callback URL: `https://TU_DOMINIO/api/github/user/callback`
- Webhook URL: `https://TU_DOMINIO/api/github/webhook`

Activa **Request user authorization (OAuth) during installation** solamente si deseas que GitHub solicite también la identidad personal durante su asistente. Pixel permite hacerlo después desde la pestaña GitHub.

Permisos mínimos recomendados del repositorio:

- Metadata: lectura.
- Contents: lectura.
- Pull requests: lectura.
- Checks: lectura.
- Actions: lectura.
- Deployments: lectura.

Eventos recomendados:

- Create.
- Push.
- Pull request.
- Check run.
- Workflow run.
- Deployment status.
- Installation.
- Installation repositories.

No habilites permisos de escritura sobre código. Pixel solo necesita leer evidencia.

## 2. Configurar Vercel

Crea estas variables en Production, Preview y Development cuando corresponda:

```text
GITHUB_APP_ID
GITHUB_APP_SLUG
GITHUB_APP_PRIVATE_KEY
GITHUB_WEBHOOK_SECRET
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
GITHUB_STATE_SECRET
CRON_SECRET
```

`GITHUB_APP_PRIVATE_KEY` acepta saltos de línea reales, `\\n`, o el prefijo `base64:` seguido de la clave codificada.

`GITHUB_WEBHOOK_SECRET` debe ser exactamente el mismo valor configurado en la GitHub App. `GITHUB_STATE_SECRET` y `CRON_SECRET` deben ser secretos aleatorios distintos. Vercel enviará `CRON_SECRET` como Bearer al ejecutar la reparación diaria definida en `vercel.json`.

Después de guardar las variables, vuelve a desplegar Vercel.

## 3. Configurar un proyecto

1. Abre un proyecto de tipo **Desarrollo de software / Scrum**.
2. Entra en la pestaña **GitHub**.
3. Un responsable del proyecto instala la GitHub App.
4. Selecciona los repositorios que pertenecen al proyecto y guarda.
5. Cada desarrollador pulsa **Vincular mi GitHub**.
6. Usa el código de Pixel en las ramas, commits o pull requests: `PIX-184-descripcion-corta`.

## 4. Operación y recuperación

GitHub entrega los eventos al webhook y Pixel conserva únicamente metadatos de evidencia. Los tokens de instalación se generan por pocos minutos y no se almacenan.

Si falta evidencia:

1. Comprueba que el repositorio siga seleccionado.
2. Comprueba que la rama, el commit o el PR contengan el código exacto de Pixel.
3. Pulsa **Reparar sincronización**.
4. Revisa las entregas recientes del webhook en la configuración de la GitHub App.

La reparación puede procesar de nuevo el mismo evento sin duplicarlo. Pixel ejecuta además una reparación automática diaria de la actividad reciente.
