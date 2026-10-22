const CACHE_NAME = 'retroplay-shell-v7';
const CACHE_PREFIX = 'retroplay-shell-';
const CORE = ['/', '/index.html', '/manifest.webmanifest', '/assets/icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE);

    // Refresh the shell explicitly rather than relying on an intermediary HTTP cache.
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
      .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put('/index.html', response.clone());
        }
        return response;
      } catch {
        const shell = await caches.match('/index.html');
        return shell || new Response('RetroPlay çevrimdışı. Uygulamayı ilk kez açmak için internet bağlantısı gerekir.', {
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
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  })());
});
