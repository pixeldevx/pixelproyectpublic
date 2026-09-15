"use client";

import { supabase } from '@/lib/backend';

const cleanEnvValue = (value?: string) => {
  const trimmed = (value || '').trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const WEB_PUSH_PUBLIC_KEY = cleanEnvValue(process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY);
const PUSH_PUBLIC_KEY_STORAGE_KEY = 'pixel-project-push-public-key';
const PUSH_DEVICE_ID_STORAGE_KEY = 'pixel-project-push-device-id';

export type PixelPushRegistrationUser = {
  uid: string;
  email?: string | null;
};

export type EnsurePixelPushSubscriptionResult =
  | {
      ok: true;
      subscriptionId: string;
      reusedExistingSubscription: boolean;
      permission: NotificationPermission;
    }
  | {
      ok: false;
      reason:
        | 'missing_user'
        | 'missing_session'
        | 'missing_public_key'
        | 'unsupported_browser'
        | 'permission_denied'
        | 'subscription_failed'
        | 'save_failed';
      message: string;
      permission?: NotificationPermission;
    };

const urlBase64ToUint8Array = (base64String: string) => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
};

const arrayBufferToBase64Url = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return window
    .btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
};

const getStoredPushPublicKey = () => {
  try {
    return window.localStorage.getItem(PUSH_PUBLIC_KEY_STORAGE_KEY) || '';
  } catch {
    return '';
  }
};

const setStoredPushPublicKey = () => {
  try {
    window.localStorage.setItem(PUSH_PUBLIC_KEY_STORAGE_KEY, WEB_PUSH_PUBLIC_KEY);
  } catch {
    // Local storage can be unavailable in restricted browser modes.
  }
};

const getPushDeviceId = () => {
  try {
    const existing = window.localStorage.getItem(PUSH_DEVICE_ID_STORAGE_KEY);
    if (existing) return existing;

    const nextId =
      typeof window.crypto?.randomUUID === 'function'
        ? window.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    window.localStorage.setItem(PUSH_DEVICE_ID_STORAGE_KEY, nextId);
    return nextId;
  } catch {
    return '';
  }
};

const subscriptionUsesCurrentPublicKey = (subscription: PushSubscription) => {
  const applicationServerKey = subscription.options?.applicationServerKey;
  if (!applicationServerKey) return getStoredPushPublicKey() === WEB_PUSH_PUBLIC_KEY;
  return arrayBufferToBase64Url(applicationServerKey) === WEB_PUSH_PUBLIC_KEY;
};

const supportsPushNotifications = () => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  return 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
};

export const ensurePixelPushSubscription = async ({
  user,
  organizationIds = [],
  forceRenew = false,
  promptForPermission = true,
}: {
  user: PixelPushRegistrationUser | null | undefined;
  organizationIds?: string[];
  forceRenew?: boolean;
  promptForPermission?: boolean;
}): Promise<EnsurePixelPushSubscriptionResult> => {
  if (!user?.uid) {
    return {
      ok: false,
      reason: 'missing_user',
      message: 'No hay usuario autenticado para asociar este dispositivo.',
    };
  }

  if (!WEB_PUSH_PUBLIC_KEY) {
    return {
      ok: false,
      reason: 'missing_public_key',
      message: 'Falta NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY en el entorno publicado.',
    };
  }

  if (!supportsPushNotifications()) {
    return {
      ok: false,
      reason: 'unsupported_browser',
      message: 'Este navegador no permite notificaciones push PWA.',
    };
  }

  const permission =
    Notification.permission === 'granted'
      ? 'granted'
      : promptForPermission
        ? await Notification.requestPermission()
        : Notification.permission;

  if (permission !== 'granted') {
    return {
      ok: false,
      reason: 'permission_denied',
      permission,
      message: 'Las notificaciones están bloqueadas o no fueron autorizadas en este dispositivo.',
    };
  }

  try {
    await navigator.serviceWorker.register('/sw.js');
    const registration = await navigator.serviceWorker.ready;
    const existingSubscription = await registration.pushManager.getSubscription();
    const reusableSubscription =
      !forceRenew && existingSubscription && subscriptionUsesCurrentPublicKey(existingSubscription)
        ? existingSubscription
        : null;

    if (existingSubscription && !reusableSubscription) {
      await existingSubscription.unsubscribe().catch(() => false);
    }

    const subscription =
      reusableSubscription ||
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(WEB_PUSH_PUBLIC_KEY),
      }));

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
      return {
        ok: false,
        reason: 'missing_session',
        permission,
        message: 'La sesión expiró antes de guardar la suscripción push.',
      };
    }

    const response = await fetch('/api/notifications/push-subscription', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subscription: subscription.toJSON(),
        endpoint: subscription.endpoint,
        permission,
        organizationIds,
        deviceId: getPushDeviceId(),
        vapidPublicKey: WEB_PUSH_PUBLIC_KEY,
        replaceExistingForDevice: forceRenew,
        userAgent: navigator.userAgent,
        platform: navigator.platform,
      }),
    });
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      return {
        ok: false,
        reason: 'save_failed',
        permission,
        message: body?.error || 'No fue posible guardar este dispositivo para push.',
      };
    }

    setStoredPushPublicKey();

    return {
      ok: true,
      subscriptionId: body?.subscriptionId || '',
      reusedExistingSubscription: Boolean(reusableSubscription),
      permission,
    };
  } catch (error) {
    console.error('Error ensuring push subscription:', error);
    return {
      ok: false,
      reason: 'subscription_failed',
      permission,
      message: error instanceof Error ? error.message : 'No fue posible crear la suscripción push.',
    };
  }
};

export const hasPixelPushSupport = supportsPushNotifications;
