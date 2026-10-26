export function watchServiceWorkerUpdates(registration: ServiceWorkerRegistration | null, options: { serviceWorker: ServiceWorkerContainer; onUpdateReady: (worker: ServiceWorker) => void }): void;
export function activateUpdate(worker: ServiceWorker | null, options: { serviceWorker: ServiceWorkerContainer; reload: () => void }): boolean;
export function summarizeRuntimeCache(urls: string[]): { runtimeReady: boolean; cores: string[] };
