const APP_CACHE = 'pixel-project-shell-v2';
const APP_SHELL = [
  '/icons/pixel-project-icon-192.png',
  '/icons/pixel-project-icon-512.png',
  '/icons/pixel-project-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(APP_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== APP_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_next/')) return;

  event.respondWith(
    fetch(request).catch(() => {
      if (request.mode === 'navigate') {
        return new Response(
          '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pixel Project</title><body style="font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#f8fafc;color:#0f172a"><main style="max-width:360px;padding:24px;text-align:center"><strong style="font-size:20px">Pixel Project esta sin conexion</strong><p style="color:#64748b;line-height:1.5">Vuelve a conectarte para cargar tus proyectos y tareas actualizadas.</p></main></body></html>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }

      return caches.match(request).then((response) => response || Response.error());
    })
  );
});

self.addEventListener('push', (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {
      title: 'Nueva notificacion de Pixel Project',
      body: event.data ? event.data.text() : 'Tienes una actualizacion pendiente.',
    };
  }

  const title = payload.title || 'Nueva tarea en Pixel Project';
  const options = {
    body: payload.body || 'Tienes una actividad pendiente en tu bandeja.',
    icon: payload.icon || '/icons/pixel-project-icon-192.png',
    badge: payload.badge || '/icons/pixel-project-icon-192.png',
    tag: payload.tag || `pixel-project-${Date.now()}`,
    data: {
      url: payload.url || '/workflows',
      ...payload.data,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/workflows';
  const url = new URL(targetUrl, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client && client.url.startsWith(self.location.origin)) {
          client.navigate(url);
          return client.focus();
        }
      }

      return self.clients.openWindow(url);
    })
  );
});
