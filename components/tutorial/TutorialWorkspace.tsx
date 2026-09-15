"use client";

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, Clock3, ExternalLink, GraduationCap, RotateCcw, ShieldCheck, Sparkles } from 'lucide-react';
import { LESSONS, LESSON_IDS, readTutorialProgress, serializeTutorialProgress, type LessonId } from '@/lib/tutorial/learning';
import { TutorialExercise } from './TutorialExercises';
import styles from './tutorial.module.css';

export function TutorialWorkspace({ storageKey, canManageUsers }: { storageKey: string; canManageUsers: boolean }) {
  const [completed, setCompleted] = useState<LessonId[]>([]);
  const [active, setActive] = useState<LessonId>('project');
  const [ready, setReady] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [resetRequested, setResetRequested] = useState(false);
  const [exerciseVersion, setExerciseVersion] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    try {
      const progress = readTutorialProgress(window.localStorage.getItem(storageKey));
      setCompleted(progress);
      setActive(LESSON_IDS.find((id) => !progress.includes(id)) || 'project');
    } catch { setStorageUnavailable(true); }
    setReady(true);
  }, [storageKey]);

  const save = (next: LessonId[]) => {
    setCompleted(next);
    try { window.localStorage.setItem(storageKey, serializeTutorialProgress(next)); }
    catch { setStorageUnavailable(true); }
  };
  const markComplete = () => {
    if (!completed.includes(active)) save([...completed, active]);
  };
  const chooseLesson = (id: LessonId) => {
    setActive(id);
    setResetRequested(false);
    window.requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }));
  };
  const activeIndex = LESSON_IDS.indexOf(active);
  const lesson = LESSONS[activeIndex];
  const isCompleted = completed.includes(active);
  const allCompleted = completed.length === LESSONS.length;
  const progress = Math.round(completed.length / LESSONS.length * 100);

  if (!ready) return <div className={styles.loading} role="status">Preparando tu ruta de aprendizaje…</div>;

  return <div className={styles.tutorial}>
    <header className={styles.hero}>
      <div className={styles.heroCopy}>
        <p className={styles.eyebrow}><span />APRENDE PIXEL, A TU RITMO</p>
        <h1>De la primera idea<br />a tu primer <em>proyecto.</em></h1>
        <p>Aprende haciendo. Construye un proyecto de ejemplo y descubre cómo conectar personas, tareas y resultados.</p>
        <div className={styles.heroNotes}><span><Clock3 size={15} />7 prácticas breves</span><span><ShieldCheck size={15} />Entorno de ejemplo</span></div>
      </div>
      <div className={styles.progressCard}>
        <span className={styles.courseIcon}><GraduationCap size={27} /></span>
        <p>Tu ruta de aprendizaje</p><strong>{completed.length}<span> / {LESSONS.length}</span></strong><span>prácticas completadas</span>
        <div className={styles.progressTrack} role="progressbar" aria-label="Prácticas completadas" aria-valuenow={completed.length} aria-valuemin={0} aria-valuemax={LESSONS.length}><span style={{ width: `${progress}%` }} /></div>
        <small>{allCompleted ? 'Ya conoces lo esencial de Pixel.' : 'Puedes salir y continuar en este navegador.'}</small>
      </div>
    </header>

    <div className={styles.sandboxNotice}><ShieldCheck size={18} /><p><strong>Estás practicando.</strong> Cada práctica usa su propio ejemplo. Los formularios no crean proyectos, cuentas o cobros reales, ni envían correos. Solo guardamos las prácticas completadas en este navegador para tu usuario y espacio.</p></div>
    {storageUnavailable && <p className={styles.storageNotice} role="status">Tu navegador no permite guardar el avance. Puedes continuar; el progreso de esta sesión se perderá al salir.</p>}

    <div className={styles.learningLayout}>
      <aside className={styles.roadmap}>
        <div className={styles.roadmapHeader}><BookOpen size={17} /><h2>Tu recorrido</h2></div>
        <nav aria-label="Lecciones del tutorial"><ol>{LESSONS.map((item, index) => <li key={item.id}><button type="button" aria-current={active === item.id ? 'step' : undefined} onClick={() => chooseLesson(item.id)} className={active === item.id ? styles.activeLesson : ''}><span className={completed.includes(item.id) ? styles.doneNumber : styles.lessonNumber}>{completed.includes(item.id) ? <Check size={16} aria-label="Completada" /> : String(index + 1).padStart(2, '0')}</span><span><strong>{item.title}</strong><small>{item.duration}{completed.includes(item.id) ? ' · Completada' : ''}</small></span>{active === item.id && <ArrowRight size={15} />}</button></li>)}</ol></nav>
        <div className={styles.resetArea}>
          {!resetRequested ? <button className={styles.textButton} type="button" onClick={() => setResetRequested(true)}><RotateCcw size={13} />Reiniciar mi progreso</button> : <div className={styles.resetPrompt}><p>¿Borrar las marcas de todas las prácticas? Tus datos reales no cambian.</p><div><button type="button" className={styles.textButton} onClick={() => setResetRequested(false)}>Cancelar</button><button type="button" className={styles.textButton} onClick={() => { save([]); setActive('project'); setExerciseVersion((value) => value + 1); setResetRequested(false); }}>Reiniciar</button></div></div>}
        </div>
      </aside>

      <section className={styles.lessonPanel} aria-labelledby="tutorial-lesson-title">
        <div className={styles.lessonIntro}>
          <div className={styles.lessonKicker}><span>PRÁCTICA {String(activeIndex + 1).padStart(2, '0')}</span><span><Clock3 size={13} />{lesson.duration}</span></div>
          <h2 id="tutorial-lesson-title" ref={heading} tabIndex={-1}>{lesson.title}</h2><p>{lesson.description}</p>
          <div className={styles.location}><span>En el aplicativo</span><strong>{lesson.path}</strong></div>
          <ol className={styles.instructions}>{lesson.instructions.map((instruction, index) => <li key={instruction}><span>{index + 1}</span><p>{instruction}</p></li>)}</ol>
        </div>

        <section className={styles.practiceArea} aria-label={`Ejercicio: ${lesson.title}`}>
          <div className={styles.practiceHeading}><span><Sparkles size={16} />Ahora inténtalo</span><span className={styles.pill}>Simulación</span></div>
          <TutorialExercise key={`${active}:${exerciseVersion}`} lesson={active} onComplete={markComplete} />
        </section>
        <div className={styles.tip}><BookOpen size={18} /><p>{lesson.tip}</p></div>
        <footer className={styles.lessonFooter}>
          <div aria-live="polite">{isCompleted ? <span className={styles.completedLabel}><CheckCircle2 size={17} />Práctica completada</span> : <span>Completa el ejercicio para guardar tu avance.</span>}</div>
          <div className={styles.lessonActions}>{activeIndex > 0 && <button className={styles.secondaryButton} type="button" onClick={() => chooseLesson(LESSON_IDS[activeIndex - 1])}><ArrowLeft size={15} />Anterior</button>}{activeIndex < LESSON_IDS.length - 1 ? <button className={styles.primaryButton} type="button" disabled={!isCompleted} onClick={() => chooseLesson(LESSON_IDS[activeIndex + 1])}>Siguiente práctica<ArrowRight size={15} /></button> : <Link className={styles.secondaryButton} href="/projects">Ir a mis proyectos<ExternalLink size={15} /></Link>}</div>
        </footer>
      </section>
    </div>

    {allCompleted && <section className={styles.completion}><GraduationCap size={36} /><div><p className={styles.eyebrow}>SIETE PASOS. MUCHAS POSIBILIDADES.</p><h2>Ahora, hazlo tuyo.</h2><p>Ya conoces el recorrido. Lleva lo aprendido a tu espacio y crea tu primer proyecto real.</p></div><Link href="/projects" className={styles.primaryButton}>Crear mi proyecto<ArrowRight size={17} /></Link></section>}
    <div className={styles.quickLinks}><span>Cuando quieras ponerlo en práctica:</span><Link href="/projects">Abrir Proyectos<ExternalLink size={13} /></Link>{canManageUsers && <Link href="/settings">Administrar mi equipo<ExternalLink size={13} /></Link>}</div>
  </div>;
}
