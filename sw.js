/*
 * Service worker de firstOption (PWA).
 * Estrategia:
 *  - Install: precachea el app shell más el manifiesto de precache que
 *    genera el build (scripts/generate-precache.js), que incluye los
 *    bundles con hash de Metro y el HTML de cada ruta. Así el offline
 *    funciona también en enlaces directos a rutas todavía no visitadas.
 *  - Navegaciones: red primero (siempre fresco), con respaldo al caché.
 *  - Assets: caché primero + revalidación en segundo plano; los nombres
 *    de archivo incluyen hash, así que cada deploy trae URLs nuevas y el
 *    caché viejo se descarta en `activate`.
 * Cambia CACHE_NAME en cada release para invalidar el caché anterior.
 */

const CACHE_NAME = 'firstoption-v2';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
];

async function precacheAll(cache) {
  // addAll es todo-o-nada: cada grupo se degrada de forma independiente.
  await cache.addAll(APP_SHELL).catch(() => {});
  try {
    const response = await fetch('./precache-manifest.json');
    const urls = await response.json();
    if (Array.isArray(urls) && urls.length > 0) {
      await cache.addAll(urls).catch(() => {});
    }
  } catch {
    // Sin manifiesto (p. ej. servido sin build): el shell sigue en caché.
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(precacheAll).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navegaciones: red primero, caché como respaldo offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches
          .match(request)
          .then((cached) => cached || caches.match('./index.html')),
      ),
    );
    return;
  }

  // Assets: caché primero y actualización en segundo plano.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});