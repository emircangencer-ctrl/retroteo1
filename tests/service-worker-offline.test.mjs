import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const serviceWorkerSource = await readFile(new URL('../public/service-worker.js', import.meta.url), 'utf8');
const ORIGIN = 'https://retroplay.test';
const MANIFEST = {
  precache: [
    '/emulatorjs/4.2.3/data/loader.js',
    '/emulatorjs/4.2.3/data/emulator.min.abc.js',
    '/emulatorjs/4.2.3/data/cores/nestopia-legacy-wasm.data',
    'https://evil.invalid/steal.js'
  ]
};

function createServiceWorkerHarness({ failing = new Set() } = {}) {
  const listeners = new Map();
  const stores = new Map();
  const deleted = [];
  let networkOnline = true;
  const networkLog = [];
  const keyOf = request => {
    const url = typeof request === 'string' ? request : request.url;
    return new URL(url, ORIGIN).href;
  };
  const openStore = name => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
      async addAll(urls) { for (const url of urls) store.set(keyOf(url), new Response(`network:${url}`)); },
      async match(request) { return store.get(keyOf(request))?.clone(); },
      async put(request, response) { store.set(keyOf(request), response.clone()); },
      async keys() { return [...store.keys()]; }
    };
  };
  const caches = {
    async open(name) { return openStore(name); },
    async match(request) {
      for (const name of stores.keys()) { const hit = await openStore(name).match(request); if (hit) return hit; }
      return undefined;
    },
    async keys() { return [...stores.keys(), 'retroplay-shell-v12', 'retroplay-emulatorjs-runtime-v4', 'retroplay-emulatorjs-4.2.3-v1']; },
    async delete(name) { deleted.push(name); return true; }
  };
  let skipped = 0;
  const self = {
    location: { origin: ORIGIN },
    clients: { claim: async () => {} },
    skipWaiting: async () => { skipped++; },
    addEventListener(type, callback) { listeners.set(type, callback); }
  };
  const fetch = async (request, init) => {
    const url = new URL(typeof request === 'string' ? request : request.url, ORIGIN).href;
    networkLog.push(url);
    if (!networkOnline) throw new TypeError('offline');
    if (failing.has(new URL(url).pathname)) return new Response('missing', { status: 404 });
    if (url.endsWith('/emulatorjs/runtime-manifest.json')) return new Response(JSON.stringify(MANIFEST), { status: 200 });
    if (url.endsWith('/index.html')) return new Response('<script type="module" src="/assets/index-1.js"></script>', { status: 200 });
    return new Response(`network:${url}`, { status: 200 });
  };
  runInNewContext(serviceWorkerSource, { self, caches, fetch, URL, Response, console, Promise, Set, Array, JSON });

  const waitUntil = async (type, extra = {}) => {
    let pending;
    listeners.get(type)({ waitUntil(promise) { pending = promise; }, ...extra });
    await pending;
  };
  return {
    stores, deleted, networkLog,
    get skipped() { return skipped; },
    setOnline(value) { networkOnline = value; },
    install: () => waitUntil('install'),
    activate: () => waitUntil('activate'),
    message: data => waitUntil('message', { data, source: { postMessage() {} } }),
    async request(url, { mode = 'no-cors' } = {}) {
      const request = new Request(new URL(url, ORIGIN).href);
      Object.defineProperty(request, 'mode', { value: mode });
      let responsePromise;
      let intercepted = false;
      listeners.get('fetch')({ request, respondWith(response) { intercepted = true; responsePromise = Promise.resolve(response); } });
      return { intercepted, response: intercepted ? await responsePromise : null };
    }
  };
}

test('installing stores the self-hosted runtime and default cores from the build manifest', async () => {
  const worker = createServiceWorkerHarness();
  await worker.install();
  const runtime = worker.stores.get('retroplay-emulatorjs-4.2.3-v2');
  assert.ok(runtime.has(`${ORIGIN}/emulatorjs/4.2.3/data/loader.js`));
  assert.ok(runtime.has(`${ORIGIN}/emulatorjs/4.2.3/data/cores/nestopia-legacy-wasm.data`));
  assert.ok(![...runtime.keys()].some(key => key.includes('evil.invalid')), 'only same-origin runtime paths from the manifest are cached');
  assert.equal(worker.skipped, 0, 'an update never takes over on its own');
});

test('a runtime file that fails to download does not block installing the app shell', async () => {
  const worker = createServiceWorkerHarness({ failing: new Set(['/emulatorjs/4.2.3/data/cores/nestopia-legacy-wasm.data']) });
  await worker.install();
  assert.ok(worker.stores.get('retroplay-shell-v15').has(`${ORIGIN}/index.html`));
  assert.ok(!worker.stores.get('retroplay-emulatorjs-4.2.3-v2').has(`${ORIGIN}/emulatorjs/4.2.3/data/cores/nestopia-legacy-wasm.data`));
});

test('runtime files are served from the cache without touching the network, and cores are stored on first use', async () => {
  const worker = createServiceWorkerHarness();
  await worker.install();
  worker.setOnline(false);
  const loader = await worker.request('/emulatorjs/4.2.3/data/loader.js');
  assert.equal(loader.intercepted, true);
  assert.equal(loader.response.status, 200);
  worker.setOnline(true);
  const arcade = await worker.request('/emulatorjs/4.2.3/data/cores/fbneo-legacy-wasm.data');
  assert.equal(arcade.response.status, 200);
  worker.setOnline(false);
  const again = await worker.request('/emulatorjs/4.2.3/data/cores/fbneo-legacy-wasm.data');
  assert.equal(again.response.status, 200, 'an arcade core used once also works offline');
});

test('the CDN and other origins are never intercepted', async () => {
  const worker = createServiceWorkerHarness();
  assert.equal((await worker.request('https://cdn.emulatorjs.org/4.2.3/data/loader.js')).intercepted, false);
  assert.equal((await worker.request('https://example.invalid/emulatorjs/4.2.3/data/loader.js')).intercepted, false);
});

test('activation removes old shell and CDN runtime caches; SKIP_WAITING is the only way to take over', async () => {
  const worker = createServiceWorkerHarness();
  await worker.install();
  await worker.activate();
  assert.ok(worker.deleted.includes('retroplay-shell-v12'));
  assert.ok(worker.deleted.includes('retroplay-emulatorjs-runtime-v4'));
  assert.ok(worker.deleted.includes('retroplay-emulatorjs-4.2.3-v1'), 'cores cached before the RetroPlay builds are dropped');
  assert.ok(!worker.deleted.includes('retroplay-emulatorjs-4.2.3-v2'));
  await worker.message({ type: 'SKIP_WAITING' });
  assert.equal(worker.skipped, 1);
});

test('the build stamps an ID and the asset list into the worker', () => {
  assert.match(serviceWorkerSource, /const BUILD_ID = '__RETROPLAY_BUILD_ID__';/);
  assert.match(serviceWorkerSource, /const APP_ASSETS = \[\/\*__RETROPLAY_APP_ASSETS__\*\/\];/);
  assert.match(serviceWorkerSource, /fetch\('\/index\.html', \{ cache: 'no-store' \}\)/);
  assert.doesNotMatch(serviceWorkerSource, /cdn\.emulatorjs\.org/);
});
