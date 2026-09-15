"use client";

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowDown, ArrowRight, ArrowUpRight, Boxes, Building2, CalendarDays,
  Check, ChevronDown, CircleCheck, ClipboardCheck, FileText, FolderClosed,
  GitBranch, LayoutGrid, ListTodo, LockKeyhole, Plus, ShieldCheck, Users, Wallet,
} from 'lucide-react';
import styles from './landing.module.css';

const modules = [
  { title: 'Proyectos y tareas', text: 'Organiza entregables, asigna responsables y sigue fechas, dependencias y avances con tableros y Gantt.', icon: ListTodo, tag: 'Planifica' },
  { title: 'Equipos y permisos', text: 'Reúne a las personas de tu organización y define quién puede acceder y trabajar en cada proyecto.', icon: Users, tag: 'Colabora' },
  { title: 'Documentos', text: 'Ordena carpetas, archivos y evidencias junto al trabajo al que pertenecen, con acceso controlado.', icon: FolderClosed, tag: 'Centraliza' },
  { title: 'Presupuesto', text: 'Desglosa costos de personas, licencias y operación. Distribuye recursos y consulta la cobertura mensual.', icon: Wallet, tag: 'Controla' },
  { title: 'Inventario', text: 'Registra activos, ubicaciones y responsables. Conserva su historial de movimientos y mantenimiento.', icon: Boxes, tag: 'Administra' },
  { title: 'Flujos de trabajo', text: 'Conecta pasos, formularios y aprobaciones para que cada persona sepa qué debe hacer a continuación.', icon: GitBranch, tag: 'Coordina' },
  { title: 'Calidad', text: 'Revisa entregas, documenta devoluciones y consulta el estado de las revisiones dentro del proyecto.', icon: ClipboardCheck, tag: 'Revisa' },
  { title: 'Bitácora e indicadores', text: 'Conserva decisiones y comentarios. Consulta avances y pendientes para dar contexto al siguiente paso.', icon: LayoutGrid, tag: 'Da seguimiento' },
];

const previewTabs = ['Proyectos', 'Presupuesto', 'Documentos'] as const;
type PreviewTab = (typeof previewTabs)[number];

function PixelMark({ light = false }: { light?: boolean }) {
  return <span className={`${styles.pixelMark} ${light ? styles.pixelMarkLight : ''}`} aria-hidden="true">{Array.from({ length: 9 }, (_, index) => <i key={index} />)}</span>;
}

function ExploreLink({ children = 'Crear mi espacio', small = false }: { children?: React.ReactNode; small?: boolean }) {
  return <Link href="/register" className={`${styles.primaryButton} ${small ? styles.smallButton : ''}`}>{children}<ArrowUpRight size={18} aria-hidden="true" /></Link>;
}

function ProductPreview() {
  const [activeTab, setActiveTab] = useState<PreviewTab>('Proyectos');

  return (
    <figure className={styles.productFigure}>
      <div className={styles.productWindow}>
        <aside className={styles.previewSidebar} aria-hidden="true">
          <PixelMark light />
          <span className={styles.sidebarActive}><LayoutGrid size={18} /></span>
          <span><ListTodo size={18} /></span><span><Users size={18} /></span><span><FolderClosed size={18} /></span>
          <span className={styles.sidebarBottom}>T</span>
        </aside>
        <div className={styles.previewMain}>
          <div className={styles.previewTopbar}><span><Building2 size={13} /> Estudio Horizonte <ChevronDown size={12} /></span><span className={styles.privatePill}><LockKeyhole size={10} /> Privado</span></div>
          <div className={styles.previewHeading}><div><p>ESPACIO DE TRABAJO</p><h2>Las ideas toman forma.</h2></div><span className={styles.previewAvatar} aria-label="Tu perfil de ejemplo">Tú</span></div>
          <div className={styles.previewTabs} aria-label="Explorar vistas ilustrativas">
            {previewTabs.map((tab) => <button key={tab} type="button" aria-pressed={activeTab === tab} onClick={() => setActiveTab(tab)} className={activeTab === tab ? styles.selectedTab : ''}>{tab}</button>)}
          </div>
          <div className={styles.previewContent} aria-live="polite">
            {activeTab === 'Proyectos' && <>
              <div className={styles.projectCard}>
                <div className={styles.projectCardTop}><span className={styles.projectIcon}><FolderClosed size={19} /></span><span className={styles.activeBadge}>En marcha</span></div>
                <h3>Lanzamiento de marca</h3><p>De la primera idea a la entrega final.</p>
                <div className={styles.projectProgress}><span /></div>
                <div className={styles.projectCardBottom}><span>1 de 3 tareas completada</span><span className={styles.tinyAvatar}>Tú</span></div>
              </div>
              <div className={styles.taskList}>
                <div className={styles.taskListHeading}><strong>El siguiente paso</strong><span>Estado</span></div>
                <div><CircleCheck size={15} className={styles.doneIcon} /><span>Definir el alcance</span><small className={styles.doneBadge}>Listo</small></div>
                <div><span className={styles.emptyCheck} /><span>Preparar la propuesta</span><small className={styles.doingBadge}>En curso</small></div>
                <div><span className={styles.emptyCheck} /><span>Revisar los entregables</span><small className={styles.pendingBadge}>Por hacer</small></div>
              </div>
            </>}
            {activeTab === 'Presupuesto' && <>
              <div className={`${styles.projectCard} ${styles.budgetCard}`}>
                <div className={styles.projectCardTop}><span className={styles.projectIcon}><Wallet size={19} /></span><span className={styles.activeBadge}>Planificación</span></div>
                <h3>Cada recurso en su lugar</h3><p>Composición ilustrativa del presupuesto</p>
                <div className={styles.budgetBar}><span /><span /><span /></div>
                <div className={styles.budgetLegend}><span>Personas</span><span>Operación</span><span>Licencias</span></div>
              </div>
              <div className={styles.taskList}>
                <div className={styles.taskListHeading}><strong>Líneas de presupuesto</strong><span>Distribución</span></div>
                <div><Users size={15} /><span>Equipo de diseño</span><small>Mensual</small></div>
                <div><Boxes size={15} /><span>Producción y entregas</span><small>Por actividad</small></div>
                <div><LayoutGrid size={15} /><span>Software de trabajo</span><small>Mensual</small></div>
              </div>
            </>}
            {activeTab === 'Documentos' && <>
              <div className={`${styles.projectCard} ${styles.documentsCard}`}>
                <div className={styles.projectCardTop}><span className={styles.projectIcon}><FolderClosed size={19} /></span><span className={styles.activeBadge}><LockKeyhole size={10} /> Acceso controlado</span></div>
                <h3>El contexto, a un clic</h3><p>Archivos y evidencias de tu proyecto.</p>
                <div className={styles.folderRow}><span><FolderClosed size={19} /> Planeación</span><span><FolderClosed size={19} /> Entregables</span></div>
              </div>
              <div className={styles.taskList}>
                <div className={styles.taskListHeading}><strong>Archivos de ejemplo</strong><span>Tipo</span></div>
                <div><FileText size={15} /><span>Alcance del proyecto</span><small>PDF</small></div>
                <div><FileText size={15} /><span>Propuesta inicial</span><small>PDF</small></div>
                <div><FileText size={15} /><span>Acta de revisión</span><small>PDF</small></div>
              </div>
            </>}
          </div>
        </div>
      </div>
      <div className={styles.floatingNote}><span><Check size={16} /></span><div><strong>Tu organización. Tu espacio.</strong><small>Proyectos conectados, acceso privado.</small></div></div>
      <figcaption>Vista ilustrativa de Pixel Project · Explora las pestañas</figcaption>
    </figure>
  );
}

export default function LandingPage() {
  return (
    <main className={styles.landing}>
      <a href="#contenido" className={styles.skipLink}>Saltar al contenido</a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.brand} aria-label="Pixel Project, inicio"><PixelMark /><span>pixel<span className={styles.brandProject}>project</span></span></Link>
          <nav aria-label="Navegación principal" className={styles.navigation}><a href="#plataforma">La plataforma</a><a href="#tu-espacio">Tu espacio</a><a href="#preguntas">Preguntas</a></nav>
          <div className={styles.headerActions}><Link href="/login" className={styles.loginLink}>Iniciar sesión</Link><ExploreLink small>Explorar Pixel</ExploreLink></div>
        </div>
      </header>
      <section id="contenido" className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}><span /> TU TRABAJO, PIEZA POR PIEZA</p>
          <h1>Grandes ideas.<br />Todas las piezas.<br /><em>Un solo lugar.</em></h1>
          <p className={styles.heroDescription}>Creé Pixel Project para conectar proyectos, personas y recursos en un mismo lugar. Hoy te invito a explorarlo y darle forma a tus propias ideas.</p>
          <div className={styles.heroActions}><ExploreLink /><a href="#plataforma" className={styles.textLink}>Descubrir Pixel <ArrowDown size={16} aria-hidden="true" /></a></div>
          <p className={styles.trialNote}><Check size={14} /> Tu espacio para explorar <span /> Tus ideas para hacerlo crecer</p>
        </div>
        <div className={styles.heroVisual}><div className={styles.cornerPixels} aria-hidden="true"><i /><i /><i /><i /></div><ProductPreview /></div>
        <div className={styles.heroBottom}><p>DEL PRIMER PLAN A LA ÚLTIMA ENTREGA</p><div><span><CalendarDays size={16} /> Planifica con claridad</span><span><Users size={16} /> Conecta a tu equipo</span><span><CircleCheck size={16} /> Sigue cada avance</span></div></div>
      </section>
      <section id="plataforma" className={styles.modulesSection}>
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>EL SISTEMA COMPLETO</p><h2>Cada pieza cuenta.<br />Juntas, hacen más.</h2></div><p>Un proyecto necesita mucho más que una lista de tareas. Explora los módulos de Pixel y organiza la operación desde un mismo espacio.</p></div>
        <div className={styles.moduleGrid}>{modules.map(({ title, text, icon: Icon, tag }, index) => <article key={title} className={styles.moduleCard}><div className={styles.moduleCardTop}><span className={styles.moduleIcon}><Icon size={23} strokeWidth={1.6} /></span><span className={styles.moduleNumber}>0{index + 1}</span></div><p className={styles.moduleTag}>{tag}</p><h3>{title}</h3><p>{text}</p></article>)}</div>
      </section>
      <section id="tu-espacio" className={styles.workspaceSection}>
        <div className={styles.workspaceVisual} aria-label="Tu organización mantiene sus proyectos, documentos y equipo en un espacio privado">
          <div className={styles.workspaceOutline}><span className={styles.workspaceLabel}><LockKeyhole size={13} /> SOLO TU ORGANIZACIÓN</span><div className={styles.workspaceIdentity}><span><Building2 size={27} /></span><h3>Tu espacio de trabajo</h3><p>Un lugar para hacer tus ideas realidad</p></div><div className={styles.workspacePieces}><span><ListTodo size={20} />Proyectos</span><span><Users size={20} />Equipo</span><span><FolderClosed size={20} />Archivos</span></div><div className={styles.workspaceConnection} aria-hidden="true" /><div className={styles.workspaceOwner}><span>Tú</span><div><strong>Tu cuenta</strong><small>Administras tu organización</small></div><ShieldCheck size={21} /></div></div>
          <span className={styles.workspaceFootnote}><LockKeyhole size={13} /> Cada organización tiene su propio espacio.</span>
        </div>
        <div className={styles.workspaceCopy}><p className={styles.eyebrow}>HECHO PARA TU FORMA DE TRABAJAR</p><h2>Tu organización.<br />Tu propio universo.</h2><p>Al registrarte, creas un espacio de trabajo para tu organización. Allí viven tus proyectos, documentos y recursos.</p><ul><li><Check size={17} /><span><strong>Tu espacio es privado.</strong> Otras organizaciones no pueden ver tus proyectos ni tus archivos.</span></li><li><Check size={17} /><span><strong>Tú organizas el trabajo.</strong> Empieza por tu cuenta y define los accesos de tu equipo.</span></li><li><Check size={17} /><span><strong>Listo para explorar.</strong> Prueba los módulos con tus propios proyectos, a tu ritmo.</span></li></ul><Link href="/register" className={styles.textLink}>Crear mi organización <ArrowRight size={18} /></Link></div>
      </section>
      <section className={styles.startSection}>
        <div className={styles.startIntro}><p className={styles.eyebrow}>DE LA CURIOSIDAD A LA ACCIÓN</p><h2>Tu primer proyecto<br />empieza aquí.</h2><p>Una cuenta. Un espacio propio.<br />Una invitación a descubrir lo que puedes crear.</p><ExploreLink>Quiero probar Pixel</ExploreLink></div>
        <ol className={styles.steps}><li><span>01</span><div><h3>Crea tu cuenta</h3><p>Regístrate con tu correo y confirma tu acceso.</p></div><Plus size={18} aria-hidden="true" /></li><li><span>02</span><div><h3>Dale nombre a tu organización</h3><p>Prepara el espacio donde vas a trabajar. Tú serás su administrador.</p></div><Building2 size={18} aria-hidden="true" /></li><li><span>03</span><div><h3>Convierte una idea en proyecto</h3><p>Crea tareas, agrega documentos y conoce los módulos mientras experimentas con una idea propia.</p></div><ArrowUpRight size={18} aria-hidden="true" /></li></ol>
      </section>
      <section id="preguntas" className={styles.faqSection}>
        <div><p className={styles.eyebrow}>ANTES DE EMPEZAR</p><h2>Lo que quieres saber.</h2></div>
        <div className={styles.faqList}>{[
          ['¿Qué es Pixel Project?', 'Es una plataforma para gestionar proyectos y su operación: tareas, equipos, documentos, presupuesto, inventario, flujos de trabajo y calidad. La información se organiza dentro de tu espacio de trabajo.'],
          ['¿Cómo puedo aprender a usar Pixel?', 'Crea tu cuenta y abre «Aprender Pixel» desde el menú. El tutorial interactivo te acompaña con ejercicios sobre proyectos, usuarios, grupos, tareas, Gantt, flujos y Rate Cards, sin modificar tus datos reales.'],
          ['¿Otras personas pueden ver mi organización?', 'Las personas de otras organizaciones no pueden acceder a tu espacio. Dentro de tu organización, el acceso depende de los miembros, sus roles y los permisos de cada proyecto.'],
          ['¿Puedo empezar si trabajo por mi cuenta?', 'Sí. Puedes ser el único integrante de tu organización. Crea tu espacio y empieza a organizar tus propios proyectos.'],
        ].map(([question, answer]) => <details key={question}><summary>{question}<Plus size={19} aria-hidden="true" /></summary><p>{answer}</p></details>)}</div>
      </section>
      <section className={styles.finalCta}><div className={styles.ctaPixels} aria-hidden="true">{Array.from({ length: 16 }, (_, index) => <i key={index} />)}</div><div><p className={styles.eyebrow}>EL SIGUIENTE PIXEL LO PONES TÚ</p><h2>Te invito a probar<br />lo que estoy creando.</h2><p>Explora, crea un proyecto y comparte tus impresiones. Tu experiencia puede ayudarme a seguir mejorando Pixel.</p><ExploreLink>Quiero probar Pixel</ExploreLink><span className={styles.finalTrialNote}>Gracias por ser parte de esta etapa.</span></div></section>
      <footer className={styles.footer}><Link href="/" className={styles.brand} aria-label="Pixel Project, inicio"><PixelMark /><span>pixel<span className={styles.brandProject}>project</span></span></Link><p>Una idea. Muchas piezas. Pixel Project.</p><nav aria-label="Enlaces del pie de página"><a href="#plataforma">La plataforma</a><Link href="/login">Iniciar sesión</Link><Link href="/register">Crear cuenta <ArrowUpRight size={13} /></Link></nav></footer>
    </main>
  );
}
