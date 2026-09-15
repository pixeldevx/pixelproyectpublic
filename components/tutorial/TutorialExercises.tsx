"use client";

import { useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, Check, CheckCircle2, Circle, FolderKanban, Layers3, Mail, Plus, UserRound } from 'lucide-react';
import { calculateRatePreview, taskDateError, type LessonId } from '@/lib/tutorial/learning';
import styles from './tutorial.module.css';

type ExerciseProps = { onComplete: () => void };

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className={styles.field}><span>{label}</span>{children}</label>;
}

function Feedback({ children }: { children: ReactNode }) {
  return <div className={styles.feedback} role="status"><CheckCircle2 size={20} /><div>{children}</div></div>;
}

function MemberSelect({ value, onChange, label = 'Asignar a' }: { value: string; onChange: (value: string) => void; label?: string }) {
  return <Field label={label}><select value={value} onChange={(event) => onChange(event.target.value)} required>
    <option value="">Seleccionar miembro…</option><option value="you">Tú · Coordinación</option><option value="ana">Ana · Analista de ejemplo</option>
  </select></Field>;
}

function ProjectExercise({ onComplete }: ExerciseProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [organization, setOrganization] = useState('');
  const [saved, setSaved] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !description.trim() || !organization) return;
    setSaved(true); onComplete();
  };
  return <div className={styles.exerciseGrid}>
    <form onSubmit={submit} className={styles.form}>
      <Field label="Nombre del Proyecto"><input value={name} maxLength={100} onChange={(event) => { setName(event.target.value); setSaved(false); }} placeholder="Ej. Lanzamiento de mi equipo" required /></Field>
      <Field label="Descripción"><textarea value={description} maxLength={240} onChange={(event) => { setDescription(event.target.value); setSaved(false); }} placeholder="¿Qué quieres lograr con este proyecto?" required rows={3} /></Field>
      <Field label="Tipo de proyecto"><select defaultValue="general"><option value="general">Proyecto operativo</option></select></Field>
      <Field label="Organización"><select value={organization} onChange={(event) => { setOrganization(event.target.value); setSaved(false); }} required><option value="">Selecciona una organización</option><option value="demo">Mi organización de ejemplo</option></select></Field>
      <button className={styles.primaryButton} disabled={!name.trim() || !description.trim() || !organization || saved}>{saved ? 'Proyecto de ejemplo guardado' : 'Guardar Proyecto'}<ArrowRight size={16} /></button>
    </form>
    <div className={styles.preview}>
      <p className={styles.eyebrow}>ASÍ TOMA FORMA</p>
      <div className={styles.projectCard}><FolderKanban size={24} /><span className={styles.pill}>{saved ? 'Creado en la práctica' : 'Borrador de práctica'}</span>
        <h4>{name.trim() || 'Tu próximo proyecto'}</h4><p>{description.trim() || 'Un objetivo claro, un equipo conectado y todo el trabajo en un solo lugar.'}</p>
        <div className={styles.cardMeta}><span>Proyecto operativo</span><span>0 tareas</span></div>
      </div>
      {saved ? <Feedback>Ya sabes crear el punto de partida. En el aplicativo podrás abrirlo y agregar las tareas.</Feedback> : <p className={styles.hint}>Completa los campos para ver la vista previa. La descripción es opcional en el aplicativo; aquí te ayuda a definir el objetivo.</p>}
    </div>
  </div>;
}

function PeopleExercise({ onComplete }: ExerciseProps) {
  const [role, setRole] = useState('');
  const [linked, setLinked] = useState(false);
  const [step, setStep] = useState<'draft' | 'invited' | 'accepted'>('draft');
  return <div className={styles.exerciseGrid}>
    <div className={styles.form}>
      <Field label="Nombre"><input readOnly value="Ana · Persona de ejemplo" /></Field>
      <Field label="Correo Electrónico"><input readOnly value="ana@equipo.example" aria-describedby="demo-email-note" /></Field>
      <p className={styles.hint} id="demo-email-note">Esta dirección es ficticia. La práctica no envía correos ni crea cuentas.</p>
      <Field label="Rol del Sistema"><select value={role} disabled={step !== 'draft'} onChange={(event) => setRole(event.target.value)}><option value="">Selecciona un rol</option><option value="user">Usuario</option><option value="org_admin">Administrador de organización</option></select></Field>
      <label className={styles.checkField}><input type="checkbox" checked={linked} disabled={step !== 'draft'} onChange={(event) => setLinked(event.target.checked)} /><span>Vincular a Mi organización de ejemplo</span></label>
      <div className={styles.detailBox}><strong>Rol de Proyecto (Cargo)</strong><p>Analista · Define su función en el equipo.</p></div>
      <button className={styles.primaryButton} type="button" disabled={!role || !linked || step !== 'draft'} onClick={() => setStep('invited')}><Mail size={16} />Simular Enviar Invitación</button>
    </div>
    <div className={styles.preview}>
      <p className={styles.eyebrow}>DEL ENVÍO AL ACCESO</p>
      <ol className={styles.journey}>
        <li><CheckCircle2 size={19} /><div><strong>1. Define el acceso</strong><p>El rol determina qué puede hacer dentro de tu espacio.</p></div></li>
        <li>{step === 'draft' ? <Circle size={19} /> : <CheckCircle2 size={19} />}<div><strong>2. Invitación preparada</strong><p>En la aplicación se intenta enviar el correo. Si el envío no está configurado, el administrador recibe un enlace para compartirlo.</p></div></li>
        <li>{step === 'accepted' ? <CheckCircle2 size={19} /> : <Circle size={19} />}<div><strong>3. El colaborador activa su acceso</strong><p>Abre el enlace y define su contraseña. Tú no necesitas conocerla.</p></div></li>
      </ol>
      {step === 'invited' && <div className={styles.demoMail}><span className={styles.pill}>Bandeja de ejemplo</span><h4>Te invitaron a trabajar en Pixel</h4><p>Ana puede completar su acceso al espacio del equipo.</p><button className={styles.secondaryButton} type="button" onClick={() => { setStep('accepted'); onComplete(); }}>Simular aceptación del enlace<ArrowRight size={16} /></button></div>}
      {step === 'accepted' && <Feedback>Acceso activado en la práctica. El siguiente paso real es agregar a Ana al equipo del proyecto para asignarle tareas.</Feedback>}
    </div>
  </div>;
}

function GroupsExercise({ onComplete }: ExerciseProps) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#526d4e');
  const [created, setCreated] = useState(false);
  const [assigned, setAssigned] = useState(false);
  return <div className={styles.exerciseGrid}>
    <form className={styles.form} onSubmit={(event) => { event.preventDefault(); if (name.trim()) setCreated(true); }}>
      <Field label="Nombre del grupo"><input required maxLength={60} value={name} disabled={created} onChange={(event) => setName(event.target.value)} placeholder="Ej. Preparación" /></Field>
      <fieldset className={styles.colorField}><legend>Color del grupo</legend><div>{[['#526d4e', 'Verde'], ['#c45137', 'Coral'], ['#676593', 'Violeta'], ['#926c25', 'Ocre']].map(([value, label]) => <button key={value} type="button" aria-label={label} aria-pressed={color === value} disabled={created} style={{ backgroundColor: value }} onClick={() => setColor(value)}>{color === value && <Check size={16} />}</button>)}</div></fieldset>
      <button className={styles.primaryButton} disabled={!name.trim() || created}><Plus size={16} />Crear grupo de ejemplo</button>
      {created && <Field label="Grupo visual de «Definir el alcance»"><select value={assigned ? 'demo' : ''} onChange={(event) => { const selected = event.target.value === 'demo'; setAssigned(selected); if (selected) onComplete(); }}><option value="">Sin grupo</option><option value="demo">{name}</option></select></Field>}
    </form>
    <div className={styles.preview}><p className={styles.eyebrow}>TAREAS ORGANIZADAS</p>
      {created && <div className={styles.groupHeading} style={{ borderColor: color }}><Layers3 size={17} style={{ color }} /><strong>{name}</strong><span>{assigned ? '1 tarea' : '0 tareas'}</span></div>}
      {assigned && <div className={styles.taskRow}><CheckCircle2 size={16} /><span>Definir el alcance</span><span className={styles.pill}>Pendiente</span></div>}
      <div className={styles.groupHeading}><Layers3 size={17} /><strong>Sin grupo</strong><span>{assigned ? '0 tareas' : '1 tarea'}</span></div>
      {!assigned && <div className={styles.taskRow}><Circle size={16} /><span>Definir el alcance</span></div>}
      {assigned ? <Feedback>La tarea ahora aparece en tu grupo. En un proyecto real puedes agrupar por fases, equipos o frentes de trabajo.</Feedback> : <p className={styles.hint}>{created ? 'Ahora selecciona tu grupo en Grupo visual para mover la tarea de ejemplo.' : 'Crea un grupo y después mueve la tarea a él.'}</p>}
    </div>
  </div>;
}

function TaskExercise({ onComplete }: ExerciseProps) {
  const [title, setTitle] = useState('');
  const [person, setPerson] = useState('');
  const [group, setGroup] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [created, setCreated] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Pendiente');
  const submit = (event: FormEvent) => {
    event.preventDefault(); const dateError = taskDateError(start, end);
    if (dateError) { setError(dateError); return; }
    if (!title.trim() || !person || !group) return;
    setError(''); setCreated(true);
  };
  return <div className={styles.exerciseGrid}>
    <form className={styles.form} onSubmit={submit}>
      <fieldset disabled={created} className={styles.plainFieldset}>
        <Field label="Título de la tarea"><input required maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ej. Definir el alcance" /></Field>
        <div className={styles.twoColumns}><Field label="Tipo de Tarea"><select defaultValue="state"><option value="state">Estado simple</option></select></Field><Field label="Prioridad"><select defaultValue="medium"><option value="high">Alta</option><option value="medium">Media</option><option value="low">Baja</option></select></Field></div>
        <MemberSelect value={person} onChange={setPerson} />
        <Field label="Grupo visual"><select value={group} onChange={(event) => setGroup(event.target.value)} required><option value="">Selecciona un grupo</option><option value="preparation">Preparación · Ejemplo</option></select></Field>
        <div className={styles.twoColumns}><Field label="Fecha de inicio"><input type="date" required value={start} onChange={(event) => setStart(event.target.value)} /></Field><Field label="Fecha de fin"><input type="date" required min={start || undefined} value={end} onChange={(event) => setEnd(event.target.value)} /></Field></div>
      </fieldset>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <button className={styles.primaryButton} disabled={created || !title.trim() || !person || !group || !start || !end}>Crear Tarea<ArrowRight size={16} /></button>
    </form>
    <div className={styles.preview}><p className={styles.eyebrow}>UNA ACCIÓN CON RESPONSABLE</p>
      <div className={styles.projectCard}><span className={styles.pill}>{status}</span><h4>{title.trim() || 'El trabajo comienza aquí'}</h4><p><UserRound size={15} />{person ? person === 'ana' ? 'Ana · Analista de ejemplo' : 'Tú · Coordinación' : 'Selecciona a una persona'}</p><div className={styles.cardMeta}><span>Preparación</span><span>{start && end ? `${start} → ${end}` : 'Fechas por definir'}</span></div></div>
      {created && <Field label="Ahora cambia el estado a Trabajando"><select value={status} onChange={(event) => { setStatus(event.target.value); if (event.target.value === 'Trabajando') onComplete(); }}><option>Pendiente</option><option>Trabajando</option><option>Estancado</option><option>Listo</option></select></Field>}
      {status === 'Trabajando' ? <Feedback>Tu tarea ya tiene responsable y fechas. El estado Trabajando comunica al equipo que está en curso.</Feedback> : <p className={styles.hint}>{created ? 'Ya está creada. Cambia su estado para practicar el seguimiento.' : 'Completa los campos y crea tu tarea de ejemplo.'}</p>}
    </div>
  </div>;
}

function GanttExercise({ onComplete }: ExerciseProps) {
  const [opened, setOpened] = useState(false);
  const [scale, setScale] = useState<'Día' | 'Semana' | 'Mes'>('Día');
  const [weekViewed, setWeekViewed] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const tasks = [{ title: 'Definir el alcance', start: 2, end: 6, person: 'Tú', color: '#526d4e' }, { title: 'Preparar entregable', start: 5, end: 15, person: 'Ana', color: '#c45137' }, { title: 'Revisar y aprobar', start: 16, end: 22, person: 'Tú', color: '#676593' }];
  const columns = scale === 'Día' ? 28 : scale === 'Semana' ? 4 : 1;
  return <div className={styles.ganttExercise}>
    <div className={styles.ganttToolbar}><p>Proyecto de ejemplo <span>/ Tareas</span></p><button className={styles.primaryButton} type="button" disabled={opened} onClick={() => setOpened(true)}>Gantt completo<ArrowRight size={16} /></button></div>
    {!opened ? <div className={styles.emptyGantt}><Layers3 size={32} /><h4>Tres tareas, una línea de tiempo</h4><p>Abre Gantt completo para explorar sus fechas.</p></div> : <>
      <div className={styles.ganttToolbar}><h4>Gantt interactivo del proyecto</h4><div className={styles.segmented} aria-label="Escala del Gantt">{(['Día', 'Semana', 'Mes'] as const).map((item) => <button key={item} type="button" aria-pressed={scale === item} onClick={() => { setScale(item); if (item === 'Semana') { setWeekViewed(true); if (selected !== null) onComplete(); } }}>{item}</button>)}</div></div>
      <p className={styles.hint}>Cambia a Semana y selecciona una barra. Ejemplo: febrero de 2027.</p>
      <div className={styles.timelineScroll} tabIndex={0} role="region" aria-label="Cronograma de ejemplo, desplazable horizontalmente">
        <div className={styles.timeline} style={{ minWidth: scale === 'Día' ? 780 : 490 }}>
          <div className={styles.timelineLabels}><span>Tarea</span>{tasks.map((task) => <strong key={task.title}>{task.title}</strong>)}</div>
          <div className={styles.timelineChart}>
            <div className={styles.timelineDates} style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>{Array.from({ length: columns }, (_, index) => <span key={index}>{scale === 'Día' ? index + 1 : scale === 'Semana' ? `${index * 7 + 1}–${index * 7 + 7} feb` : 'Febrero de 2027'}</span>)}</div>
            {tasks.map((task, index) => <div className={styles.timelineTrack} key={task.title} style={{ backgroundSize: `${100 / columns}% 100%` }}><button type="button" className={styles.timelineBar} aria-label={`${task.title}, del ${task.start} al ${task.end} de febrero; ver detalles`} aria-pressed={selected === index} style={{ left: `${(task.start - 1) / 28 * 100}%`, width: `${(task.end - task.start + 1) / 28 * 100}%`, background: task.color }} onClick={() => { setSelected(index); if (weekViewed) onComplete(); }}><span>{task.title}</span></button></div>)}
          </div>
        </div>
      </div>
      {selected !== null && <div className={styles.detailBox} role="status"><strong>{tasks[selected].title}</strong><p>Responsable: {tasks[selected].person} · Inicio: {tasks[selected].start} de febrero · Fin: {tasks[selected].end} de febrero de 2027.</p></div>}
      {selected !== null && weekViewed && <Feedback>Ya cambiaste la escala y leíste una barra. Las barras superpuestas muestran actividades que ocurren durante los mismos días.</Feedback>}
    </>}
  </div>;
}

function WorkflowExercise({ onComplete }: ExerciseProps) {
  const [steps, setSteps] = useState<Array<{ label: string; person: string }>>([]);
  const [label, setLabel] = useState('');
  const [person, setPerson] = useState('');
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState(0);
  const finished = running && current === steps.length;
  return <div className={styles.exerciseGrid}>
    <div className={styles.form}>
      <Field label="Tipo de Tarea"><select defaultValue="workflow"><option value="workflow">Workflow (Flujo)</option></select></Field>
      {!running && <form className={styles.form} onSubmit={(event) => { event.preventDefault(); if (!label.trim() || !person || steps.length >= 4) return; setSteps([...steps, { label: label.trim(), person }]); setLabel(''); setPerson(''); }}>
        <Field label="Nombre del paso"><input maxLength={70} value={label} onChange={(event) => setLabel(event.target.value)} placeholder={steps.length ? 'Ej. Revisar y aprobar' : 'Ej. Preparar entregable'} required /></Field>
        <MemberSelect value={person} onChange={setPerson} label="Responsable del paso" />
        <button className={styles.secondaryButton} disabled={!label.trim() || !person || steps.length >= 4}><Plus size={16} />AGREGAR PASO</button>
      </form>}
      <p className={styles.hint}>Crea al menos dos pasos con responsables. Puedes agregar hasta cuatro en esta práctica.</p>
      <button className={styles.primaryButton} type="button" disabled={steps.length < 2 || running} onClick={() => setRunning(true)}>Crear flujo de ejemplo<ArrowRight size={16} /></button>
      {running && !finished && <button className={styles.secondaryButton} type="button" onClick={() => { const next = current + 1; setCurrent(next); if (next === steps.length) onComplete(); }}>Simular completar paso {current + 1}<Check size={16} /></button>}
      {finished && <Feedback>Flujo completado. Cada paso tuvo un responsable y la secuencia avanzó hasta el cierre.</Feedback>}
    </div>
    <div className={styles.preview}><p className={styles.eyebrow}>LA RUTA DE TU TRABAJO</p>
      {!steps.length && <div className={styles.emptyGantt}><Layers3 size={32} /><p>Agrega los pasos para construir una ruta.</p></div>}
      <ol className={styles.workflowSteps}>{steps.map((step, index) => <li key={index} data-active={running && current === index}><span className={styles.stepNumber}>{running && current > index ? <Check size={16} /> : index + 1}</span><div><strong>{step.label}</strong><p>{step.person === 'ana' ? 'Ana · Analista' : 'Tú · Coordinación'}{running ? current > index ? ' · Completado' : current === index ? ' · En curso' : ' · Pendiente' : ''}</p></div>{!running && <button type="button" className={styles.textButton} aria-label={`Quitar paso ${index + 1}: ${step.label}`} onClick={() => setSteps(steps.filter((_, i) => i !== index))}>Quitar</button>}</li>)}</ol>
      <p className={styles.hint}>El avance está simulado. En el aplicativo, cada participante completa el trabajo y los formularios que le corresponden.</p>
    </div>
  </div>;
}

function RatesExercise({ onComplete }: ExerciseProps) {
  const [name, setName] = useState('');
  const [indicator, setIndicator] = useState('');
  const [income, setIncome] = useState('');
  const [cost, setCost] = useState('');
  const [units, setUnits] = useState('');
  const [created, setCreated] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const totals = calculateRatePreview(Number(income), Number(cost), Number(units));
  const format = (value: number) => value.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
  return <div className={styles.exerciseGrid}>
    <div className={styles.form}>
      <form className={styles.form} onSubmit={(event) => { event.preventDefault(); if (!name.trim() || !indicator.trim() || income === '' || cost === '' || !calculateRatePreview(Number(income), Number(cost), 1)) return; setCreated(true); }}>
        <fieldset disabled={created} className={styles.plainFieldset}>
          <Field label="Nombre"><input required maxLength={90} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Revisión de entregables" /></Field>
          <Field label="Indicador a medir"><input required maxLength={70} value={indicator} onChange={(event) => setIndicator(event.target.value)} placeholder="Ej. Entregables revisados" /></Field>
          <Field label="Tipo de resultado"><select defaultValue="currency"><option value="currency">Dinero / tarifa monetaria</option></select></Field>
          <div className={styles.twoColumns}><Field label="Ingreso por indicador (COP)"><input type="number" min="0" max="1000000000000" step="any" required value={income} onChange={(event) => setIncome(event.target.value)} placeholder="50000" /></Field><Field label="Costo por indicador (COP)"><input type="number" min="0" max="1000000000000" step="any" required value={cost} onChange={(event) => setCost(event.target.value)} placeholder="30000" /></Field></div>
        </fieldset>
        <button className={styles.primaryButton} disabled={created || !name.trim() || !indicator.trim() || income === '' || cost === ''}>Crear Rate Card<ArrowRight size={16} /></button>
      </form>
      {created && <form className={styles.form} onSubmit={(event) => { event.preventDefault(); if (!totals) return; setRecorded(true); onComplete(); }}><Field label="Unidades del movimiento de ejemplo"><input type="number" min="0.01" max="1000000" step="any" required value={units} onChange={(event) => { setUnits(event.target.value); setRecorded(false); }} placeholder="Ej. 3" /></Field><button className={styles.secondaryButton} disabled={!totals || recorded}>Simular movimiento<Plus size={16} /></button></form>}
    </div>
    <div className={styles.preview}><p className={styles.eyebrow}>DE UNIDADES A RESULTADOS</p><h4>{name.trim() || 'Tu Rate Card de ejemplo'}</h4><p className={styles.hint}>{indicator.trim() || 'Define qué vas a medir'}</p>
      <div className={styles.rateTotals}><div><span>Ingreso</span><strong>{totals ? format(totals.income) : '—'}</strong></div><div><span>Costo</span><strong>{totals ? format(totals.cost) : '—'}</strong></div><div><span>Diferencia ingreso − costo</span><strong>{totals ? format(totals.margin) : '—'}</strong></div></div>
      <p className={styles.hint}>Unidades × valor por indicador. El costo y el ingreso se calculan por separado; la diferencia puede ser negativa.</p>
      {recorded && <Feedback>Movimiento registrado en la práctica: {units} unidades. Ahora conoces la relación entre el trabajo realizado y su valor.</Feedback>}
    </div>
  </div>;
}

export function TutorialExercise({ lesson, onComplete }: ExerciseProps & { lesson: LessonId }) {
  const exercises = { project: ProjectExercise, people: PeopleExercise, groups: GroupsExercise, tasks: TaskExercise, gantt: GanttExercise, workflow: WorkflowExercise, rates: RatesExercise };
  const Exercise = exercises[lesson];
  return <Exercise onComplete={onComplete} />;
}
