"use client"

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Building2, Check, CheckCircle2, Eye, EyeOff, Layers3, Loader2, Mail, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { WorkspaceAccessState } from '@/components/auth/WorkspaceAccessState';

const inputClass = 'min-h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[15px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#dc5638] focus:ring-4 focus:ring-[#dc5638]/10 disabled:bg-slate-50';

export default function RegisterPage() {
  const router = useRouter();
  const { user, workspace, loading, workspaceExpired } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [resendAfter, setResendAfter] = useState(0);

  useEffect(() => {
    if (!loading && user && workspace && !workspaceExpired) router.replace(workspace.is_platform_admin ? '/platform' : '/dashboard');
  }, [loading, router, user, workspace, workspaceExpired]);

  useEffect(() => {
    if (resendAfter <= 0) return;
    const timer = window.setTimeout(() => setResendAfter((seconds) => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendAfter]);

  const handleRegister = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (displayName.trim().length < 2 || workspaceName.trim().length < 2) {
      setError('Escribe tu nombre y el nombre de tu organización (al menos 2 caracteres).');
      return;
    }
    if (password.length < 10) {
      setError('Usa una contraseña de al menos 10 caracteres.');
      return;
    }
    setSubmitting(true);
    try {
      const { data, error: signupError } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/login`,
          data: { displayName: displayName.trim(), workspaceName: workspaceName.trim() },
        },
      });
      if (signupError) throw signupError;
      setPassword('');
      if (data.session) {
        router.replace('/dashboard');
      } else {
        setSent(true);
        setResendAfter(60);
      }
    } catch (cause) {
      const authError = cause as { code?: string; message?: string };
      if (authError.code === 'over_email_send_rate_limit' || authError.code === 'over_request_rate_limit') {
        setError('Se han solicitado varios correos. Espera unos minutos antes de volver a intentarlo.');
      } else if (authError.code === 'user_already_exists' || /already registered/i.test(authError.message || '')) {
        setError('Este correo ya tiene una cuenta. Inicia sesión para entrar a tu espacio.');
      } else if (authError.code === 'weak_password') {
        setError('Elige una contraseña más segura y evita contraseñas comunes.');
      } else {
        setError('No pudimos completar el registro. Revisa tus datos e inténtalo de nuevo en un momento.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const resendConfirmation = async () => {
    if (resendAfter > 0 || submitting) return;
    setSubmitting(true);
    setError('');
    setMessage('');
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup', email: email.trim().toLowerCase(),
        options: { emailRedirectTo: `${window.location.origin}/login` },
      });
      if (resendError) throw resendError;
      setMessage('Solicitud enviada. Revisa tu bandeja de entrada y la carpeta de spam.');
      setResendAfter(60);
    } catch {
      setError('No pudimos reenviar el correo. Espera unos minutos e inténtalo de nuevo.');
    } finally {
      setSubmitting(false);
    }
  };

  if (user) return <WorkspaceAccessState />;

  return (
    <main className="min-h-[100dvh] bg-[#faf9f5] text-slate-900 lg:grid lg:grid-cols-[0.9fr_1.1fr]">
      <aside className="relative overflow-hidden bg-[#253d31] px-6 py-8 text-white sm:px-10 lg:flex lg:min-h-screen lg:flex-col lg:px-14 lg:py-12">
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 -left-24 h-96 w-96 rounded-full bg-[#dc5638]/10 blur-3xl" />
        <Link href="/" className="relative inline-flex items-center gap-3 text-lg font-bold tracking-tight"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#dc5638] text-sm">PX</span>pixelproject</Link>
        <div className="relative mx-auto mt-10 max-w-lg lg:my-auto lg:py-20">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-[#e4ecda]"><span className="h-1.5 w-1.5 rounded-full bg-lime-300" /> Una invitación a explorar</span>
          <h1 className="mt-6 max-w-md text-3xl font-semibold leading-tight tracking-tight sm:text-4xl lg:text-5xl">Grandes proyectos.<br /><span className="text-[#d3dfa8]">Un espacio para<br className="hidden lg:block" /> hacerlos realidad.</span></h1>
          <p className="mt-5 max-w-sm text-sm leading-7 text-slate-300 sm:text-base">Te invito a conocer Pixel, darle forma a una idea y descubrir lo que puedes construir con tu equipo.</p>
          <div className="mt-9 hidden space-y-5 lg:block">
            {[{ icon: Building2, title: 'Tu propia organización', text: 'Un espacio independiente para tus proyectos y tu equipo.' }, { icon: Layers3, title: 'Explora el flujo completo', text: 'Tareas, documentos, presupuestos y seguimiento, conectados.' }, { icon: ShieldCheck, title: 'Tus datos, en tu espacio', text: 'Otras organizaciones no pueden acceder a tu información.' }].map(({ icon: Icon, title, text }) => (
              <div key={title} className="flex gap-4"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-[#d3dfa8]"><Icon size={19} /></span><div><h2 className="text-sm font-semibold">{title}</h2><p className="mt-1 max-w-xs text-sm leading-6 text-slate-400">{text}</p></div></div>
            ))}
          </div>
        </div>
        <p className="relative hidden text-xs text-slate-400 lg:block">Pixel Project · Del plan a la ejecución.</p>
      </aside>

      <section className="flex items-center justify-center px-5 py-10 sm:px-10 lg:py-12">
        <div className="w-full max-w-md">
          <Link href="/" className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-[#c4472b]"><ArrowLeft size={16} /> Volver al inicio</Link>
          {sent ? (
            <div>
              <span className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#f0f2e9] text-[#c4472b]"><Mail size={28} /></span>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#c4472b]">Solo falta un paso</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#20352f]">Confirma tu correo</h2>
              <p className="mt-4 text-sm leading-7 text-slate-600">Revisa <strong className="break-all font-semibold text-slate-900">{email.trim()}</strong> y abre el enlace de confirmación. Después prepararemos <strong className="font-semibold text-slate-900">{workspaceName.trim()}</strong> para que empieces a explorar.</p>
              <p className="mt-3 text-sm leading-6 text-slate-500">Si ya tienes una cuenta con este correo, puedes iniciar sesión. Revisa también la carpeta de spam.</p>
              {error && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
              {message && <p role="status" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{message}</p>}
              <Link href="/login" className="mt-7 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#c94d32] px-5 text-sm font-semibold text-white hover:bg-[#bd432a]">Ir a iniciar sesión <ArrowRight size={17} /></Link>
              <button onClick={() => void resendConfirmation()} disabled={resendAfter > 0 || submitting} className="mt-3 min-h-11 w-full rounded-xl text-sm font-semibold text-[#c4472b] hover:bg-[#f0f2e9] disabled:cursor-not-allowed disabled:text-slate-400">{submitting ? 'Enviando…' : resendAfter > 0 ? `Reenviar enlace en ${resendAfter} s` : 'Reenviar correo de confirmación'}</button>
              <button onClick={() => { setSent(false); setError(''); setMessage(''); }} className="mt-2 min-h-10 w-full text-sm text-slate-500 hover:text-slate-900">Corregir mi correo</button>
            </div>
          ) : (
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.17em] text-[#c4472b]"><CheckCircle2 size={16} /> Conoce Pixel por dentro</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#20352f] sm:text-4xl">Un espacio para explorar.</h2>
              <p className="mt-3 text-sm leading-6 text-slate-500">Crea tu cuenta y tu organización para probar Pixel con tus propias ideas.</p>
              <form className="mt-8 space-y-5" onSubmit={handleRegister}>
                <div><label htmlFor="register-name" className="mb-2 block text-sm font-semibold text-slate-700">Tu nombre</label><input id="register-name" name="name" autoComplete="name" required minLength={2} maxLength={100} disabled={submitting || loading} value={displayName} onChange={(event) => setDisplayName(event.target.value)} className={inputClass} placeholder="¿Cómo te llamas?" /></div>
                <div><label htmlFor="register-workspace" className="mb-2 block text-sm font-semibold text-slate-700">Nombre de tu organización</label><input id="register-workspace" name="organization" autoComplete="organization" required minLength={2} maxLength={100} disabled={submitting || loading} value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} className={inputClass} placeholder="Por ejemplo, Estudio Norte" /><p className="mt-2 text-xs leading-5 text-slate-500">Será el nombre de tu espacio de trabajo.</p></div>
                <div><label htmlFor="register-email" className="mb-2 block text-sm font-semibold text-slate-700">Correo electrónico</label><input id="register-email" name="email" type="email" autoComplete="email" required maxLength={254} disabled={submitting || loading} value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} placeholder="tu@empresa.com" /></div>
                <div><label htmlFor="register-password" className="mb-2 block text-sm font-semibold text-slate-700">Contraseña</label><div className="relative"><input id="register-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={10} maxLength={128} disabled={submitting || loading} value={password} onChange={(event) => setPassword(event.target.value)} aria-describedby="password-help" className={`${inputClass} pr-12`} placeholder="Al menos 10 caracteres" /><button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-slate-400 hover:text-slate-700" aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div><p id="password-help" className="mt-2 text-xs leading-5 text-slate-500">Combina palabras, números y símbolos para proteger tu cuenta.</p></div>
                {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-700">{error}</p>}
                <button type="submit" disabled={submitting || loading} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#c94d32] px-5 text-sm font-semibold text-white shadow-lg shadow-[#dc5638]/15 transition hover:bg-[#bd432a] disabled:cursor-wait disabled:opacity-60">{submitting || loading ? <><Loader2 size={18} className="animate-spin" /> {submitting ? 'Creando tu cuenta…' : 'Verificando sesión…'}</> : <>Crear mi espacio <ArrowRight size={17} /></>}</button>
                <p className="flex items-center justify-center gap-2 text-xs text-slate-500"><Check size={14} className="text-emerald-600" /> El espacio de prueba estará disponible durante 14 días desde su creación.</p>
              </form>
              <div className="mt-7 border-t border-slate-200 pt-6 text-center text-sm text-slate-500">¿Ya tienes una cuenta? <Link href="/login" className="font-semibold text-[#c4472b] hover:text-[#92351f]">Inicia sesión</Link></div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
