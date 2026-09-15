# Pixel para equipos de desarrollo

## Propósito

Este documento conserva la visión funcional y la ruta de implementación para convertir Pixel en el centro de trabajo de equipos de desarrollo de software sin crear una aplicación separada.

Pixel mantendrá un único núcleo de organizaciones, usuarios, permisos, documentos, calidad, costos, tareas y auditoría. Los proyectos que seleccionen el modo **Desarrollo de software / Scrum** activarán una experiencia especializada con backlog, sprints, trabajo por módulos, evidencia de ingeniería y métricas de entrega.

## Principios que no se deben romper

1. Un commit demuestra actividad, pero no finaliza por sí solo una tarea.
2. El resultado se controla en el ítem de trabajo más pequeño que pueda entregar valor: historia, error, tarea técnica o investigación.
3. Un propósito grande se representa como objetivo, iniciativa o épica; nunca como una tarea gigante compartida por todo el equipo.
4. La asignación admite una persona, una dupla o un equipo. Siempre existe un responsable principal y puede haber colaboradores.
5. Los pasos y validaciones son configurables por proyecto. La ausencia de revisor técnico o de seguridad no puede dejar pasos vacíos ni bloquear el flujo.
6. Las validaciones no configuradas se registran como **No requeridas**, nunca como aprobadas.
7. Las métricas se usan para mejorar el sistema y el equipo, no para crear rankings por commits, líneas de código u horas conectado.
8. Las integraciones externas deben ser resilientes, idempotentes y reparables. Un webhook repetido no duplica evidencia y uno perdido se puede reconstruir.
9. Los proyectos actuales deben conservar exactamente su comportamiento mientras no activen el modo de desarrollo.

## Modelo de trabajo

```text
Organización
└── Producto o proyecto de software
    ├── Objetivo del producto
    ├── Releases
    │   └── Épicas
    │       └── Submódulos funcionales
    │           └── Historias de usuario
    ├── Sprints vinculados al alcance
    │   ├── Historias
    │   ├── Errores
    │   ├── Tareas técnicas
    │   └── Investigaciones
    ├── Backlog de grooming y backlog priorizado
    └── Repositorios y ambientes
```

La jerarquía funcional canónica es **Proyecto → Release → Épica → Submódulo → Historia de usuario**. El Sprint es un eje temporal de planificación vinculado a la historia, no su padre estructural. Por eso una historia conserva su submódulo, especificación e historial cuando cambia de sprint o vuelve al backlog. Pueden existir varios sprints activos al mismo tiempo, incluso dentro de una misma entrega, sin mezclar su alcance ni su trazabilidad.

### Tipos de ítem

- **Épica:** resultado amplio que agrupa trabajo relacionado. Su avance se calcula desde sus elementos hijos.
- **Historia:** capacidad funcional verificable que puede terminarse dentro de un sprint.
- **Error:** comportamiento defectuoso que debe corregirse y validarse.
- **Tarea técnica:** trabajo necesario de infraestructura, mantenimiento, datos o arquitectura.
- **Investigación:** actividad con resultado de conocimiento, decisión o prototipo; puede no producir código.

### Expediente de la historia de usuario

Cuando una historia termina el grooming, el mismo registro —sin duplicar su código ni perder historial— aparece en la pestaña **Historias**. Allí se administra como un expediente funcional versionado con:

- Identificación, Release, épica, submódulo propietario y submódulos impactados.
- Narrativa separada en **Como**, **Quiero** y **Para qué**, más contexto y alcance.
- Roles y permisos, criterios de aceptación verificables y matrices de campos.
- Reglas de negocio, integraciones, notificaciones, dependencias y requisitos no funcionales.
- Definition of Ready, Definition of Done, completitud y revisiones auditadas.

El registro operativo permanece en `tasks` para conservar Bandeja, tablero y evidencia GitHub. La especificación extensa vive en `userStories/{taskId}` y sus revisiones, evitando inflar todas las consultas de tareas. `scrumGroupId` conserva el submódulo propietario para compatibilidad y `scrumSubmoduleIds` incluye los demás submódulos impactados.

### Asignación

- `individual`: un responsable principal.
- `pair`: un responsable principal y un colaborador de dupla.
- `team`: un responsable principal y varios colaboradores.

La modalidad es informativa. La trazabilidad conserva quién creó, modificó, desarrolló, revisó, aprobó y desplegó.

## Flujo efectivo y reglas de salida

Estados de referencia:

```text
Backlog → Listo → En desarrollo → Revisión → Validación → Terminado
```

Cada proyecto compone su flujo efectivo con las validaciones activas:

- Pull request requerido.
- Pull request principal integrado.
- Pull requests adicionales marcados como requeridos integrados.
- Pruebas automáticas exitosas.
- Revisión técnica.
- Validación de seguridad.
- Validación funcional.
- Despliegue exitoso.
- Evidencia documental.

Ejemplo sin revisor técnico ni seguridad:

```text
Desarrollo → Cambio integrado → Validación funcional → Terminado
```

Ejemplo sin repositorio:

```text
Desarrollo → Evidencia adjunta → Validación funcional → Terminado
```

## Sprints

Un sprint contiene:

- Nombre y numeración.
- Objetivo del sprint.
- Fecha de inicio y fin.
- Capacidad estimada.
- Ítems comprometidos.
- Cambios de alcance.
- Puntos comprometidos y terminados.
- Fotografía histórica de cierre.

Al cerrar un sprint, Pixel congela el resumen. Los elementos incompletos regresan al backlog para ser reprogramados; nunca se consideran terminados ni pasan silenciosamente al siguiente sprint.

El inicio y cierre del sprint corresponde al líder propietario del proyecto, coordinadores, gerentes y administradores autorizados. Al iniciarlo, Pixel registra quién lo hizo y activa una cuenta regresiva hasta su fecha final. El cierre también conserva actor, fecha, alcance comprometido y resultado.

Los responsables autorizados también pueden eliminar un sprint planeado, activo o terminado. La eliminación es recuperable y auditada: Pixel conserva el registro original, el actor, la fecha y la fotografía del alcance. En sprints terminados, las historias mantienen su estado y avance; en sprints planeados o activos, el trabajo regresa al backlog de su submódulo.

Los puntos expresan complejidad relativa, incertidumbre y esfuerzo. No equivalen directamente a horas y no se usan para comparar personas o equipos.

## Panel de control de entrega

La vista inicial del espacio Scrum es un centro de control y no una guía estática. Debe mostrar, con una única fórmula conciliable:

- Avance ponderado por puntos y etapa para cada sprint.
- Avance agregado de cada épica y cada Release.
- Sprints activos en paralelo y su cuenta regresiva.
- Entrega terminada frente al alcance, bloqueos y riesgo temporal.
- Distribución del trabajo por etapa.
- Alertas por épicas sin Release y sprints sin Submódulo, sin modificar datos históricos de forma automática.

Los sprints cerrados usan su fotografía histórica; los activos y planeados usan los datos vivos del trabajo. Así se evita que un mismo alcance muestre porcentajes contradictorios en diferentes pantallas.

El mapa es la vista inicial y el control principal de arquitectura. Representa Release, épicas, submódulos, historias y su planificación en sprints; permite seleccionar y editar entidades, mover nodos visualmente, centrar, restaurar la organización automática y guardar para el equipo posiciones y perspectiva. Las conexiones sólidas expresan pertenencia funcional y las punteadas expresan planificación temporal o impacto sobre otros submódulos.

## Integración de ingeniería

La integración recomendada es una GitHub App instalada por la organización y una vinculación personal para reconocer identidades.

Convención sugerida:

```text
PIX-184-auditoria-dian
```

Una historia puede tener:

- Un pull request principal.
- Cero o más pull requests requeridos.
- Cero o más pull requests complementarios no bloqueantes.

El desarrollador utiliza **Solicitar validación** para declarar que la entrega técnica está lista. Pixel comprueba todas las reglas requeridas antes de avanzar.

Eventos a registrar:

- Rama creada.
- Commit publicado.
- Pull request creado, actualizado, aprobado, rechazado, cerrado o integrado.
- Verificaciones y pruebas.
- Análisis de seguridad.
- Despliegue y ambiente.
- Reversión, incidente o reapertura.

## Fases de implementación

### Fase 1 — Scrum esencial

Objetivo: planear y ejecutar desarrollo dentro del Pixel actual.

- Tipo de proyecto **Desarrollo de software / Scrum**.
- Objetivo del producto y configuración básica de cadencia.
- Backlog priorizado.
- Épicas, historias, errores, tareas técnicas e investigaciones.
- Estimación por puntos.
- Módulo o componente afectado.
- Responsable individual o responsables múltiples.
- Creación, inicio y cierre de sprints.
- Jerarquía funcional Release → Épica → Submódulo → Historia y planificación temporal por Sprint.
- Ejecución simultánea de varios sprints.
- Cuenta regresiva visible para sprints activos.
- Tablero del sprint.
- Centro de control con avance por sprint, épica y Release, alcance, puntos, etapas, riesgo y bloqueos.
- Compatibilidad con las tareas, usuarios y permisos actuales.

### Fase 2 — GitHub y evidencia técnica

Objetivo: enlazar el trabajo planeado con la actividad real de ingeniería.

- GitHub App por organización y repositorios autorizados.
- Vinculación de identidad GitHub–Pixel.
- Código legible de trabajo `PIX-###`.
- Repositorios y módulos asociados al proyecto.
- Ramas, commits y pull requests vinculados.
- PR principal, requerido o complementario.
- Línea de evidencia técnica dentro de la historia.
- Sincronización por webhooks, reintentos e idempotencia.
- Reparación manual y automática de eventos perdidos.

Estado de implementación: **implementada en rama de integración**. Incluye GitHub App, identidad personal sin persistir tokens, selección de repositorios, línea de evidencia, clasificación de pull requests, webhooks idempotentes, reparación manual y solicitud explícita de validación. Requiere configurar la GitHub App y sus secretos en Vercel para activarse.

### Fase 3 — Definición de terminado y validaciones

Objetivo: adaptar el flujo a la realidad de cada proyecto.

- Motor de reglas de salida por tipo de ítem.
- Pasos opcionales de revisión técnica, seguridad, pruebas, validación funcional y despliegue.
- Responsables por persona, rol o validación automática.
- Suplencias y delegaciones auditadas.
- Acción **Solicitar validación**.
- Transiciones y devoluciones automáticas.
- Excepciones autorizadas con motivo y trazabilidad.

### Fase 4 — Releases, ambientes y operación

Objetivo: seguir el cambio hasta que esté disponible y estable.

- Versiones publicables y gobierno de Releases; la jerarquía básica Release → Épica → Submódulo → Sprint ya forma parte del núcleo Scrum.
- Ambientes de desarrollo, pruebas, preproducción y producción.
- Despliegues vinculados a historias.
- Reversiones, hotfixes e incidentes.
- Notas de versión automáticas.
- Relación entre errores de producción, tarea, PR y release.

### Fase 5 — Métricas de flujo y calidad

Objetivo: mejorar el sistema de entrega sin vigilar personas.

- Tiempo de ciclo y tiempo de espera por etapa.
- Trabajo en curso y antigüedad.
- Tiempo de revisión.
- Frecuencia de despliegue.
- Tiempo de entrega de cambios.
- Tiempo de recuperación de despliegues fallidos.
- Porcentaje de fallos y reprocesos.
- Historias reabiertas, defectos escapados y bloqueos.
- Capacidad basada en sprints anteriores.
- Satisfacción y experiencia del desarrollador.

### Fase 6 — Asistente de ingeniería con IA

Objetivo: convertir los eventos en decisiones útiles.

- Propuesta de objetivo del sprint.
- Detección de sobrecarga y alcance poco realista.
- Recomendación para dividir historias grandes.
- Identificación de dependencias y cuellos de botella.
- Resumen diario por equipo y proyecto.
- Preparación de revisión y retrospectiva.
- Detección de PR sin tarea y tareas sin evidencia.
- Alertas de riesgo explicables.
- Recomendaciones sujetas a confirmación humana.

### Fase 7 — Proveedores adicionales y gobierno

Objetivo: evitar dependencia de un único proveedor.

- GitLab, Azure DevOps y Bitbucket mediante adaptadores.
- Políticas globales con excepciones por organización y proyecto.
- Retención de metadatos y eliminación controlada.
- Auditoría, exportación y cumplimiento.
- Panel global de ingeniería para administradores autorizados.

## Criterio de éxito de la Fase 1

La fase queda terminada cuando un proyecto puede activar el modo de desarrollo, configurar su objetivo, crear un sprint, registrar y priorizar trabajo, asignarlo a una persona o varias, moverlo por el tablero y cerrar el sprint conservando su resumen histórico, sin alterar el funcionamiento de proyectos generales.
