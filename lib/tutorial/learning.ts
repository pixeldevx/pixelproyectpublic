export const LESSON_IDS = ['project', 'people', 'groups', 'tasks', 'gantt', 'workflow', 'rates'] as const;
export type LessonId = typeof LESSON_IDS[number];

export const LESSONS: Array<{
  id: LessonId; title: string; subtitle: string; duration: string;
  description: string; path: string; instructions: string[]; tip: string;
}> = [
  {
    id: 'project', title: 'Tu primer proyecto', subtitle: 'Dale un lugar a tu trabajo', duration: '2 min',
    description: 'Un proyecto reúne tareas, personas, documentos y resultados. Comienza con uno operativo para conocer lo esencial.',
    path: 'Proyectos → Nuevo Proyecto',
    instructions: ['Escribe un nombre y una descripción.', 'Selecciona Proyecto operativo y la organización a la que pertenece.', 'Pulsa Guardar Proyecto. Luego podrás asignar más personas.'],
    tip: 'Desarrollo de software agrega backlog, épicas y sprints. Aquí practicamos con un proyecto operativo.',
  },
  {
    id: 'people', title: 'Crea e invita a tu equipo', subtitle: 'Cada persona, con su acceso', duration: '3 min',
    description: 'El administrador crea el acceso de un colaborador mediante una invitación. El colaborador acepta y define su propia contraseña.',
    path: 'Configuración → Usuarios del espacio → Invitar Usuario',
    instructions: ['Completa el nombre y correo del colaborador.', 'Asigna Rol del Sistema, organizaciones y Rol de Proyecto (Cargo), cuando esté disponible.', 'Envía la invitación. La persona abre el enlace y completa su acceso; después asígnala al proyecto.'],
    tip: 'Registrarse desde la portada crea un espacio nuevo. Para entrar a tu espacio, la persona debe aceptar tu invitación. Administrar usuarios requiere permisos de administrador.',
  },
  {
    id: 'groups', title: 'Organiza con grupos', subtitle: 'Ordena las etapas del proyecto', duration: '2 min',
    description: 'Los grupos visuales organizan tareas por etapa o frente de trabajo. Ayudan a leer el proyecto sin cambiar quién puede acceder.',
    path: 'Proyectos → Tu proyecto → Tareas → Grupos',
    instructions: ['Abre Grupos en la barra de tareas.', 'Define el nombre y el color del grupo.', 'Al crear una tarea, elige el grupo en Grupo visual.'],
    tip: 'Un grupo visual organiza tareas; no es un grupo de permisos. Al eliminarlo, las tareas permanecen en el proyecto sin ese grupo.',
  },
  {
    id: 'tasks', title: 'Asigna tu primera tarea', subtitle: 'Responsable, fechas y prioridad', duration: '3 min',
    description: 'Una tarea convierte el plan en una acción concreta. Practica con Estado simple y deja claro quién la hará y cuándo.',
    path: 'Proyectos → Tu proyecto → Tareas → Nueva Tarea',
    instructions: ['Escribe el título y elige Estado simple en Tipo de Tarea.', 'Selecciona una persona en Asignar a y un Grupo visual.', 'Define las fechas y pulsa Crear Tarea. Las personas disponibles dependen del equipo asignado al proyecto.'],
    tip: 'Una tarea simple puede pasar por Pendiente, Trabajando, Estancado y Listo. Usa otros tipos cuando necesites cantidades o varias etapas.',
  },
  {
    id: 'gantt', title: 'Lee el Gantt', subtitle: 'Mira el tiempo de otra manera', duration: '2 min',
    description: 'El Gantt dibuja cada tarea entre su fecha de inicio y fin. Así puedes detectar actividades simultáneas y revisar la planificación.',
    path: 'Proyectos → Tu proyecto → Tareas → Gantt completo',
    instructions: ['Abre Gantt completo. Si la línea de tiempo está oculta, usa Mostrar Gantt.', 'Cambia entre Día, Semana y Mes para ajustar la escala.', 'Selecciona una barra para revisar sus detalles. Las tareas necesitan fechas para ubicarse en la línea de tiempo.'],
    tip: 'El Gantt es otra vista de tus mismas tareas. Cambiar la escala no modifica las fechas ni crea tareas nuevas.',
  },
  {
    id: 'workflow', title: 'Diseña un flujo', subtitle: 'Del primer paso a la aprobación', duration: '3 min',
    description: 'Un Workflow (Flujo) conecta pasos con responsables. Prueba una secuencia de preparación y revisión para ver cómo avanza el trabajo.',
    path: 'Proyectos → Tu proyecto → Nueva Tarea → Tipo de Tarea: Workflow (Flujo)',
    instructions: ['Elige Workflow (Flujo) como tipo de tarea.', 'Usa AGREGAR PASO; escribe el nombre y asigna un responsable a cada paso.', 'Revisa la ruta, crea la tarea y avanza por sus pasos. Puedes usar GUARDAR PLANTILLA para reutilizar la estructura.'],
    tip: 'En una tarea real también puedes configurar formularios, condiciones y Rate Cards por paso. Esta práctica usa una secuencia sencilla.',
  },
  {
    id: 'rates', title: 'Crea un Rate Card', subtitle: 'Conecta producción y valor', duration: '3 min',
    description: 'Un Rate Card define qué mides y el valor por cada unidad. Puede calcular dinero o una métrica productiva.',
    path: 'Proyectos → Tu proyecto → Rate Cards → Nuevo Rate Card',
    instructions: ['Define Nombre, Indicador a medir y Tipo de resultado.', 'Para dinero, configura ingreso, costo por indicador y moneda. Para unidades, usa factor productivo y unidad resultado.', 'Crea el Rate Card y vincúlalo al trabajo correspondiente. Cada movimiento registra las unidades que producen su resultado.'],
    tip: 'La sección Rate Cards del menú ofrece una visión general. La creación se realiza dentro de un proyecto. El ejemplo calcula en COP.',
  },
];

export function tutorialStorageKey(userId: string, workspaceId: string): string {
  if (!userId || !workspaceId) throw new Error('Tutorial progress requires a user and workspace.');
  return `pixel:tutorial:v1:${encodeURIComponent(workspaceId)}:${encodeURIComponent(userId)}`;
}

export function readTutorialProgress(raw: string | null): LessonId[] {
  try {
    const parsed: unknown = JSON.parse(raw || 'null');
    if (!parsed || typeof parsed !== 'object' || !('version' in parsed) || parsed.version !== 1 || !('completed' in parsed) || !Array.isArray(parsed.completed)) return [];
    const completed = parsed.completed;
    return LESSON_IDS.filter((id) => completed.includes(id));
  } catch { return []; }
}

export function serializeTutorialProgress(completed: LessonId[]): string {
  return JSON.stringify({ version: 1, completed: LESSON_IDS.filter((id) => completed.includes(id)) });
}

export function taskDateError(start: string, end: string): string | null {
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  const isValidDate = (value: string) => {
    if (!isoDate.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  if (!isValidDate(start) || !isValidDate(end)) return 'Selecciona una fecha de inicio y una fecha de fin válidas.';
  if (end < start) return 'La fecha de fin debe ser igual o posterior al inicio.';
  return null;
}

export function calculateRatePreview(income: number, cost: number, units: number) {
  if (![income, cost, units].every((value) => Number.isFinite(value) && value >= 0) || units <= 0) return null;
  const totalIncome = income * units;
  const totalCost = cost * units;
  if (!Number.isFinite(totalIncome) || !Number.isFinite(totalCost)) return null;
  return { income: totalIncome, cost: totalCost, margin: totalIncome - totalCost };
}
