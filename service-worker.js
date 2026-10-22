const CACHE_NAME = 'retroplay-shell-v11';
const EMULATORJS_CACHE_NAME = 'retroplay-emulatorjs-runtime-v3';
const EMULATORJS_ORIGIN = 'https://cdn.emulatorjs.org';
const EMULATORJS_DATA_PREFIX = '/4.2.3/data/';
const CACHE_PREFIX = 'retroplay-shell-';
const RUNTIME_CACHE_PREFIX = 'retroplay-emulatorjs-runtime-';
const CORE = ['/', '/index.html', '/manifest.webmanifest', '/assets/icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE);

    // Force-refresh the app shell; don't seed a new cache generation with stale HTML.
    const response = await fetch('/index.html', { cache: 'no-store' });
    if (!response.ok) throw new Error('App shell could not be fetched during service-worker install.');
    const html = await response.clone().text();
    await cache.put('/index.html', response);

    const assets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
      .map(match => match[1])
      .filter(url => url.startsWith('/assets/'));
    if (assets.length) await cache.addAll([...new Set(assets)]);

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key =>
        (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME) ||
        (key.startsWith(RUNTIME_CACHE_PREFIX) && key !== EMULATORJS_CACHE_NAME)
      )
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Cache only EmulatorJS's pinned runtime/core path, not the rest of the CDN.
  if (url.origin === EMULATORJS_ORIGIN && url.pathname.startsWith(EMULATORJS_DATA_PREFIX)) {
    event.respondWith((async () => {
      const cache = await caches.open(EMULATORJS_CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;

      const response = await fetch(request);
      if (response && (response.ok || response.type === 'opaque')) {
        try { await cache.put(request, response.clone()); }
        catch (error) { console.warn('EmulatorJS runtime cache write failed:', error); }
      }
      return response;
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          try {
            const cache = await caches.open(CACHE_NAME);
            await cache.put('/index.html', response.clone());
          } catch (error) {
            console.warn('RetroPlay app shell cache write failed:', error);
          }
        }
        return response;
      } catch {
        const shell = await caches.match('/index.html');
        if (shell) return shell;
        return new Response('RetroPlay çevrimdışı. Uygulamayı ilk kez açmak için internet bağlantısı gerekir.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;

    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      try {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      } catch (error) {
        console.warn('RetroPlay asset cache write failed:', error);
      }
    }
    return response;
  })());
});
