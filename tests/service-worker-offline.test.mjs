import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const serviceWorkerSource = await readFile(new URL('../public/service-worker.js', import.meta.url), 'utf8');

function createServiceWorkerHarness() {
  const listeners = new Map();
  const store = new Map();
  let networkOnline = true;
  let networkCalls = 0;
  const cache = {
    async addAll() {},
    async match(request) {
      const response = store.get(typeof request === 'string' ? request : request.url);
      return response?.clone();
    },
    async put(request, response) {
      store.set(typeof request === 'string' ? request : request.url, response.clone());
    }
  };
  const caches = {
    async open() { return cache; },
    async match(request) { return cache.match(request); },
    async keys() { return []; },
    async delete() { return true; }
  };
  const self = {
    location: { origin: 'https://retroplay.test' },
    clients: { claim: async () => {} },
    skipWaiting: async () => {},
    addEventListener(type, callback) { listeners.set(type, callback); }
  };
  const fetch = async request => {
    networkCalls++;
    if (!networkOnline) throw new TypeError('offline');
    const url = typeof request === 'string' ? request : request.url;
    return new Response(`network:${url}`, { status: 200 });
  };
  runInNewContext(serviceWorkerSource, { self, caches, fetch, URL, Response, console, Promise, Set });

  return {
    setOnline(value) { networkOnline = value; },
    getNetworkCalls() { return networkCalls; },
    async request(url) {
      const request = new Request(url);
      let responsePromise;
      let intercepted = false;
      listeners.get('fetch')({
        request,
        respondWith(response) {
          intercepted = true;
          responsePromise = Promise.resolve(response);
        }
      });
      return {
        intercepted,
        response: intercepted ? await responsePromise : null
      };
    }
  };
}

test('service worker caches EmulatorJS runtime requests and serves them without network later', async () => {
  const worker = createServiceWorkerHarness();
  const url = 'https://cdn.emulatorjs.org/stable/data/loader.js';

  const first = await worker.request(url);
  assert.equal(first.intercepted, true);
  assert.equal(first.response.status, 200);
  assert.equal(await first.response.text(), `network:${url}`);
  assert.equal(worker.getNetworkCalls(), 1);

  worker.setOnline(false);
  const offline = await worker.request(url);
  assert.equal(offline.intercepted, true);
  assert.equal(offline.response.status, 200);
  assert.equal(await offline.response.text(), `network:${url}`);
  assert.equal(worker.getNetworkCalls(), 1, 'cached runtime request must not touch network');
});

test('service worker does not cache unrelated CDN paths or third-party origins', async () => {
  const worker = createServiceWorkerHarness();
  const unrelated = await worker.request('https://cdn.emulatorjs.org/ads/script.js');
  const otherHost = await worker.request('https://example.invalid/stable/data/loader.js');
  assert.equal(unrelated.intercepted, false);
  assert.equal(otherHost.intercepted, false);
});
