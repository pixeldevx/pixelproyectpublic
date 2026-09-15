"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Download, Share, Smartphone, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { ensurePixelPushSubscription } from '@/lib/push/client-subscription';
import { toast } from 'sonner';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const LEGACY_DISMISSED_KEY = 'pixel-project-pwa-dismissed';
const INSTALL_DISMISSED_KEY = 'pixel-project-pwa-install-dismissed';
const PUSH_DISMISSED_KEY = 'pixel-project-pwa-push-dismissed';
const WEB_PUSH_PUBLIC_KEY = process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY || '';

const getPromptStorageKey = (baseKey: string, user: any) => {
  const identity = user?.uid || user?.id || user?.email || 'anonymous';
  return `${baseKey}:${identity}`;
};

const isIosDevice = () => {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
};

const isStandaloneMode = () => {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches || Boolean((window.navigator as any).standalone);
};

export function PWAInstallPrompt() {
  const { user, userOrganizationIds } = useAuth();
  const pushAttestationAttemptRef = useRef('');
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallDismissed, setIsInstallDismissed] = useState(true);
  const [isPushDismissed, setIsPushDismissed] = useState(true);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');
  const [hasActiveSubscription, setHasActiveSubscription] = useState(false);
  const [isSavingSubscription, setIsSavingSubscription] = useState(false);

  const canUseNotifications = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
  }, []);

  const hasPushKey = Boolean(WEB_PUSH_PUBLIC_KEY);
  const organizationIdsKey = [...(userOrganizationIds || [])].sort().join('|');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!user) {
      setIsInstallDismissed(true);
      setIsPushDismissed(true);
      return;
    }

    const installKey = getPromptStorageKey(INSTALL_DISMISSED_KEY, user);
    const pushKey = getPromptStorageKey(PUSH_DISMISSED_KEY, user);
    const legacyInstallDismissed =
      window.localStorage.getItem(LEGACY_DISMISSED_KEY) === 'true' ||
      window.localStorage.getItem(INSTALL_DISMISSED_KEY) === 'true';
    const legacyPushDismissed = window.localStorage.getItem(PUSH_DISMISSED_KEY) === 'true';

    if (legacyInstallDismissed) {
      window.localStorage.setItem(installKey, 'true');
      window.localStorage.removeItem(LEGACY_DISMISSED_KEY);
      window.localStorage.removeItem(INSTALL_DISMISSED_KEY);
    }
    if (legacyPushDismissed) {
      window.localStorage.setItem(pushKey, 'true');
      window.localStorage.removeItem(PUSH_DISMISSED_KEY);
    }

    setIsInstallDismissed(window.localStorage.getItem(installKey) === 'true' || legacyInstallDismissed);
    setIsPushDismissed(window.localStorage.getItem(pushKey) === 'true' || legacyPushDismissed);
    setIsStandalone(isStandaloneMode());
    setIsIos(isIosDevice());
    if ('Notification' in window) {
      setNotificationPermission(Notification.permission);
    }
  }, [user]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const onAppInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
      if (user) {
        window.localStorage.setItem(getPromptStorageKey(INSTALL_DISMISSED_KEY, user), 'true');
      }
      window.localStorage.removeItem(INSTALL_DISMISSED_KEY);
      window.localStorage.removeItem(LEGACY_DISMISSED_KEY);
      toast.success('Pixel Project quedo instalado.');
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, [user]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    let cancelled = false;

    navigator.serviceWorker
      .register('/sw.js')
      .then(async (serviceWorkerRegistration) => {
        if (!('PushManager' in window)) return;

        const existingSubscription = await serviceWorkerRegistration.pushManager.getSubscription();
        if (cancelled) return;
        setHasActiveSubscription(Boolean(existingSubscription));

        if (!existingSubscription || !user?.uid || !hasPushKey || Notification.permission !== 'granted') return;

        const attestationAttemptKey = `${user.uid}:${WEB_PUSH_PUBLIC_KEY}`;
        if (pushAttestationAttemptRef.current === attestationAttemptKey) return;
        pushAttestationAttemptRef.current = attestationAttemptKey;

        const result = await ensurePixelPushSubscription({
          user,
          organizationIds: organizationIdsKey ? organizationIdsKey.split('|') : [],
          promptForPermission: false,
        });

        if (cancelled) return;
        if (!result.ok) {
          console.warn('No fue posible renovar silenciosamente la suscripción push:', result.reason);
        }
      })
      .catch((error) => {
        console.warn('No fue posible registrar la PWA:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [hasPushKey, organizationIdsKey, user]);

  const handleDismiss = (mode: 'install' | 'push') => {
    const key = mode === 'push' ? PUSH_DISMISSED_KEY : INSTALL_DISMISSED_KEY;
    window.localStorage.setItem(getPromptStorageKey(key, user), 'true');
    if (mode === 'push') {
      setIsPushDismissed(true);
    } else {
      setIsInstallDismissed(true);
    }
  };

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    setDeferredPrompt(null);

    if (choice.outcome === 'accepted') {
      window.localStorage.setItem(getPromptStorageKey(INSTALL_DISMISSED_KEY, user), 'true');
      window.localStorage.removeItem(LEGACY_DISMISSED_KEY);
      toast.success('Pixel Project se esta instalando.');
    }
  };

  const handleEnableNotifications = async () => {
    if (!user || !canUseNotifications || !hasPushKey) return;

    setIsSavingSubscription(true);
    try {
      const result = await ensurePixelPushSubscription({
        user,
        organizationIds: userOrganizationIds || [],
      });

      if (!result.ok) {
        setNotificationPermission(result.permission || ('Notification' in window ? Notification.permission : 'default'));
        if (result.reason === 'permission_denied') {
          toast.error('Las notificaciones quedaron bloqueadas en este dispositivo.');
        } else {
          toast.error(result.message);
        }
        return;
      }

      setNotificationPermission(result.permission);
      setHasActiveSubscription(true);
      pushAttestationAttemptRef.current = `${user.uid}:${WEB_PUSH_PUBLIC_KEY}`;
      toast.success('Notificaciones activadas en este dispositivo.');
    } catch (error) {
      console.error('Error enabling push notifications:', error);
      toast.error('No fue posible activar las notificaciones push.');
    } finally {
      setIsSavingSubscription(false);
    }
  };

  const shouldShowInstall = Boolean(user) && !isInstallDismissed && !isStandalone && (Boolean(deferredPrompt) || isIos);
  const shouldShowPush =
    Boolean(user) &&
    !isPushDismissed &&
    isStandalone &&
    canUseNotifications &&
    notificationPermission !== 'denied' &&
    hasPushKey &&
    (notificationPermission !== 'granted' || !hasActiveSubscription);

  useEffect(() => {
    if (typeof window === 'undefined' || !user) return;
    if (shouldShowInstall) {
      window.localStorage.setItem(getPromptStorageKey(INSTALL_DISMISSED_KEY, user), 'true');
    }
    if (shouldShowPush) {
      window.localStorage.setItem(getPromptStorageKey(PUSH_DISMISSED_KEY, user), 'true');
    }
  }, [shouldShowInstall, shouldShowPush, user]);

  if (!user) return null;

  if (!shouldShowInstall && !shouldShowPush) return null;

  return (
    <div className="fixed inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 mx-auto max-w-md md:bottom-5 md:left-auto md:right-5 md:mx-0">
      <div className="rounded-2xl border border-indigo-100 bg-white/95 p-3 shadow-2xl shadow-indigo-950/15 backdrop-blur">
        <button
          type="button"
          onClick={() => handleDismiss(shouldShowPush ? 'push' : 'install')}
          className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          aria-label="Cerrar"
        >
          <X size={15} />
        </button>

        <div className="flex gap-3 pr-8">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/25">
            {shouldShowPush ? <Bell size={20} /> : <Smartphone size={20} />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black text-slate-950">
              {shouldShowPush ? 'Activa alertas moviles' : 'Instala Pixel Project'}
            </p>
            <p className="mt-1 text-xs font-medium leading-5 text-slate-500">
              {isIos && shouldShowInstall
                ? 'En iPhone: compartir, luego Agregar a pantalla de inicio.'
                : shouldShowPush
                  ? 'Recibe tareas y workflows directo en este dispositivo.'
                  : 'Accede como app, con pantalla completa y acceso rapido.'}
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              {deferredPrompt && shouldShowInstall && (
                <Button size="sm" onClick={() => void handleInstall()} className="h-8 bg-indigo-600 text-xs font-black hover:bg-indigo-700">
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  Instalar
                </Button>
              )}
              {isIos && shouldShowInstall && (
                <span className="inline-flex h-8 items-center gap-1 rounded-md bg-slate-100 px-2.5 text-xs font-black text-slate-700">
                  <Share className="h-3.5 w-3.5" />
                  Compartir
                </span>
              )}
              {shouldShowPush && (
                <Button
                  size="sm"
                  onClick={() => void handleEnableNotifications()}
                  disabled={isSavingSubscription}
                  className="h-8 bg-emerald-600 text-xs font-black hover:bg-emerald-700"
                >
                  <Bell className="mr-1.5 h-3.5 w-3.5" />
                  {isSavingSubscription ? 'Activando...' : 'Activar'}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
