// RetroPlay service worker.
// The production build replaces the build ID below, so every release produces a new worker and
// installed copies can offer "new version ready" (see src/lib/app-state.svelte.ts).
const BUILD_ID = '__RETROPLAY_BUILD_ID__';
const CACHE_NAME = 'retroplay-shell-v15';
// v2: the console and arcade cores became RetroPlay's own builds under the same file names.
const RUNTIME_CACHE_NAME = 'retroplay-emulatorjs-4.2.3-v2';
const CACHE_PREFIX = 'retroplay-shell-';
const RUNTIME_CACHE_PREFIX = 'retroplay-emulatorjs-';
const RUNTIME_PATH_PREFIX = '/emulatorjs/';
const RUNTIME_MANIFEST = '/emulatorjs/runtime-manifest.json';
const CORE = ['/', '/index.html', '/manifest.webmanifest', '/assets/icon.svg'];
// Every built asset, including lazily imported chunks; filled in by the build.
const APP_ASSETS = [/*__RETROPLAY_APP_ASSETS__*/];

/** Stores the EmulatorJS runtime and the default console cores so games start offline. */
async function precacheRuntime() {
  let manifest;
  try {
    const response = await fetch(RUNTIME_MANIFEST, { cache: 'no-store' });
    if (!response.ok) return;
    manifest = await response.json();
  } catch {
    return;
  }
  const urls = Array.isArray(manifest?.precache) ? manifest.precache.filter(url => typeof url === 'string' && url.startsWith(RUNTIME_PATH_PREFIX)) : [];
  const cache = await caches.open(RUNTIME_CACHE_NAME);
  for (const url of urls) {
    // A missing file must not block the app shell; it is cached on first use instead.
    try {
      if (await cache.match(url)) continue;
      const response = await fetch(url);
      if (response.ok) await cache.put(url, response);
      else console.warn('EmulatorJS runtime file could not be cached:', url, response.status);
    } catch (error) {
      console.warn('EmulatorJS runtime file could not be cached:', url, error);
    }
  }
}

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
    const all = [...new Set([...assets, ...APP_ASSETS])];
    if (all.length) await cache.addAll(all);

    await precacheRuntime();
    // No automatic skipWaiting: an update must not replace the running version in the middle of
    // a game. The page asks for it with a SKIP_WAITING message when the player taps "Yenile".
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
  else if (event.data?.type === 'GET_BUILD_ID') event.source?.postMessage({ type: 'BUILD_ID', buildId: BUILD_ID });
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key =>
        (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME) ||
        (key.startsWith(RUNTIME_CACHE_PREFIX) && key !== RUNTIME_CACHE_NAME)
      )
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Files sent to the RetroPlay TV app: answered by the app itself, never cached here.
  if (url.pathname.startsWith('/__tv/')) return;

  if (url.pathname.startsWith(RUNTIME_PATH_PREFIX) && url.pathname !== RUNTIME_MANIFEST) {
    // Versioned, immutable runtime files: cache first, store on first use (arcade cores too).
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE_NAME);
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) {
        try { await cache.put(request, response.clone()); }
        catch (error) { console.warn('EmulatorJS runtime cache write failed:', error); }
      }
      return response;
    })());
    return;
  }

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

  if (url.pathname === RUNTIME_MANIFEST) return;

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
