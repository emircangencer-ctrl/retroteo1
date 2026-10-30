// App-wide state: offline readiness (service worker and cached emulator cores), network, updates.
import { watchServiceWorkerUpdates, activateUpdate, summarizeRuntimeCache } from '../sw-update.js';

export const RUNTIME_CACHE_NAME = 'retroplay-emulatorjs-4.2.3-v1';
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';

class AppState {
  online = $state(typeof navigator === 'undefined' ? true : navigator.onLine);
  offline = $state('Kontrol ediliyor');
  offlineReady = $state(false);
  coresCached = $state(0);
  updateReady = $state(false);
  updateDismissed = $state(false);
  /** Mirrors the player (the update banner never appears over a running game). */
  playerOpen = $state(false);
  persisted = $state<boolean | null>(null);
  #worker: ServiceWorker | null = null;
  #registration: ServiceWorkerRegistration | null = null;

  start() {
    addEventListener('online', () => { this.online = true; });
    addEventListener('offline', () => { this.online = false; });
    void this.#register();
    if (navigator.storage?.persist) {
      navigator.storage.persisted?.().then(already => {
        if (already) { this.persisted = true; return; }
        return navigator.storage.persist().then(granted => { this.persisted = granted; });
      }).catch(() => {});
    }
  }

  async #register() {
    if (!('serviceWorker' in navigator)) { this.offline = 'Çevrimdışı uygulama desteklenmiyor'; return; }
    try {
      this.#registration = await navigator.serviceWorker.register('/service-worker.js');
      watchServiceWorkerUpdates(this.#registration, { serviceWorker: navigator.serviceWorker, onUpdateReady: (worker: ServiceWorker) => { this.#worker = worker; this.updateReady = true; } });
      navigator.serviceWorker.ready.then(() => this.refreshOffline());
      navigator.serviceWorker.addEventListener('controllerchange', () => { void this.refreshOffline(); });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && navigator.onLine) this.#registration?.update().catch(() => {});
      });
      void this.refreshOffline();
    } catch (error) {
      this.offline = 'Önbellek kaydı başarısız';
      console.warn('Service worker registration failed:', error);
    }
  }

  /** Which emulator cores are stored on this device for offline play. */
  async refreshOffline() {
    if (!('caches' in globalThis)) return;
    try {
      const keys = await (await caches.open(RUNTIME_CACHE_NAME)).keys();
      const { runtimeReady, cores } = summarizeRuntimeCache(keys.map(request => request.url)) as { runtimeReady: boolean; cores: string[] };
      this.offlineReady = runtimeReady;
      this.coresCached = cores.length;
      this.offline = runtimeReady ? `Hazır · ${cores.length} çekirdek cihazda` : navigator.serviceWorker?.controller ? 'Hazırlanıyor…' : 'İlk açılış bekleniyor';
    } catch {
      this.offline = 'Durum okunamadı';
    }
  }

  applyUpdate() {
    this.updateReady = false;
    if (!activateUpdate(this.#worker, { serviceWorker: navigator.serviceWorker, reload: () => location.reload() })) location.reload();
  }
}

export const app = new AppState();
