// "New version ready" flow for the installed app.
// A new service worker installs in the background and waits; it never replaces the running
// version on its own, so an update cannot interrupt a game. The page offers a reload and only
// then asks the waiting worker to take over.

/** Calls onUpdateReady(worker) when an updated worker is installed and waiting. */
export function watchServiceWorkerUpdates(registration, { serviceWorker, onUpdateReady }) {
  if (!registration || !serviceWorker || typeof onUpdateReady !== 'function') return;
  // Without a controller this is the first install; there is nothing to update.
  const offer = worker => { if (worker && serviceWorker.controller) onUpdateReady(worker); };
  if (registration.waiting) offer(registration.waiting);
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') offer(worker);
    });
  });
}

/** Lets the waiting worker take over and reloads once it controls the page. */
export function activateUpdate(worker, { serviceWorker, reload }) {
  if (!worker || !serviceWorker) return false;
  let reloaded = false;
  serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    reload();
  });
  worker.postMessage({ type: 'SKIP_WAITING' });
  return true;
}

/** Counts which emulator cores the runtime cache holds (for the offline status in Settings). */
export function summarizeRuntimeCache(urls) {
  const paths = urls.map(url => { try { return new URL(url).pathname; } catch { return String(url); } });
  const cores = new Set(paths
    .filter(path => path.endsWith('.data'))
    .map(path => path.split('/').pop().replace(/-(?:legacy-)?wasm\.data$/, '')));
  return { runtimeReady: paths.some(path => path.endsWith('/loader.js')), cores: [...cores].sort() };
}
