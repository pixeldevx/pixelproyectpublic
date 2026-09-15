"use client"

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Lock, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';

export default function LoginPage() {
  const router = useRouter();
  const { user, loading, accessError, loginWithEmail, requestPasswordReset, logout } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRecoveringPassword, setIsRecoveringPassword] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showLoadingRecovery, setShowLoadingRecovery] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      router.replace('/dashboard');
    }
  }, [loading, router, user]);

  useEffect(() => {
    if (!loading) {
      return;
    }

    const timeoutId = window.setTimeout(() => setShowLoadingRecovery(true), 8000);
    return () => window.clearTimeout(timeoutId);
  }, [loading]);

  const handleEmailAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError('');
    setAuthMessage('');
    setIsSubmitting(true);

    try {
      if (isRecoveringPassword) {
        await requestPasswordReset(email);
        setAuthMessage('Te enviamos un enlace para restablecer tu contraseña. Revisa tu correo.');
      } else {
        await loginWithEmail(email, password);
      }
    } catch (error: any) {
      console.error('Auth error:', error);
      const message = String(error.message || '');

      if (
        error.code === 'auth/invalid-credential' ||
        error.code === 'auth/user-not-found' ||
        error.code === 'auth/wrong-password' ||
        error.code === 'invalid_credentials' ||
        /invalid login credentials/i.test(message)
      ) {
        setAuthError('Correo o contraseña incorrectos.');
      } else if (error.code === 'email_not_confirmed' || /email not confirmed/i.test(message)) {
        setAuthError('El correo todavía no está confirmado en Supabase.');
      } else if (error.code === 'auth/email-already-in-use' || /already registered/i.test(message)) {
        setAuthError('El correo ya está registrado. Por favor, inicia sesión.');
      } else if (error.code === 'auth/weak-password') {
        setAuthError('La contraseña debe tener al menos 6 caracteres.');
      } else if (error.code === 'auth/operation-not-allowed') {
        setAuthError('El inicio de sesión con correo no está habilitado en Supabase. Por favor, habilítalo en la consola de Supabase.');
      } else {
        setAuthError(error.message || 'Ocurrió un error en la autenticación.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading || user) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-slate-50 px-4">
        <div className="space-y-4 text-center">
          <div className="text-slate-900">Cargando sesión...</div>
          {showLoadingRecovery && (
            <div className="space-y-3">
              <p className="max-w-sm text-sm text-slate-500">
                La sesión está tardando más de lo normal.
              </p>
              <div className="flex justify-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => window.location.reload()}
                  className="border-slate-200 text-slate-700 hover:bg-slate-50"
                >
                  Reintentar
                </Button>
                <Button
                  type="button"
                  onClick={() => void logout()}
                  className="bg-indigo-600 text-white hover:bg-indigo-700"
                >
                  Cerrar sesión
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const visibleAuthError = authError || accessError;

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl">
        <Link href="/" className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-slate-500 transition-colors hover:text-indigo-600">
          <ArrowLeft className="h-4 w-4" />
          Volver al inicio
        </Link>

        <div className="mb-8 text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-xl bg-indigo-600 text-2xl font-bold text-white shadow-md">
            PX
          </div>
          <h1 className="mb-2 text-2xl font-bold text-slate-900">Bienvenido a Pixel Project</h1>
          <p className="text-slate-500">Inicia sesión para gestionar tus proyectos y documentos.</p>
        </div>

        {authMessage && (
          <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-center text-sm text-emerald-700">
            {authMessage}
          </div>
        )}

        {visibleAuthError && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-3 text-center text-sm text-red-600">
            {visibleAuthError}
          </div>
        )}

        <form onSubmit={handleEmailAuth} className="mb-6 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Correo Electronico</label>
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <Mail className="h-5 w-5 text-slate-400" />
              </div>
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="block w-full rounded-lg border border-slate-300 py-2 pl-10 pr-3 text-sm focus:border-indigo-500 focus:ring-indigo-500"
                placeholder="tu@email.com"
              />
            </div>
          </div>

          {!isRecoveringPassword && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Contraseña</label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <Lock className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="block w-full rounded-lg border border-slate-300 py-2 pl-10 pr-3 text-sm focus:border-indigo-500 focus:ring-indigo-500"
                  placeholder="••••••••"
                />
              </div>
            </div>
          )}

          <Button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-indigo-600 py-2.5 text-white hover:bg-indigo-700"
          >
            {isSubmitting ? 'Procesando...' : isRecoveringPassword ? 'Enviar enlace' : 'Iniciar sesión'}
          </Button>
        </form>

        <div className="mt-6 text-center text-sm text-slate-600">
          {isRecoveringPassword ? '¿Recordaste tu contraseña?' : '¿Olvidaste tu contraseña?'}
          <button
            type="button"
            onClick={() => {
              setIsRecoveringPassword((current) => !current);
              setAuthError('');
              setAuthMessage('');
            }}
            className="ml-1 font-medium text-indigo-600 hover:text-indigo-800"
          >
            {isRecoveringPassword ? 'Inicia sesión' : 'Enviar enlace'}
          </button>
        </div>
      </div>
    </div>
  );
}
