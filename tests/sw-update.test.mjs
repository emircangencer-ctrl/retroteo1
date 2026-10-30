import test from 'node:test';
import assert from 'node:assert/strict';
import { watchServiceWorkerUpdates, activateUpdate, summarizeRuntimeCache } from '../src/sw-update.js';

class FakeTarget {
  constructor() { this.listeners = {}; }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  emit(type) { for (const listener of this.listeners[type] || []) listener(); }
}

test('an update that is already waiting is offered when the page is controlled', () => {
  const offered = [];
  const waiting = { id: 'w' };
  watchServiceWorkerUpdates(Object.assign(new FakeTarget(), { waiting }), { serviceWorker: { controller: {} }, onUpdateReady: worker => offered.push(worker) });
  assert.deepEqual(offered, [waiting]);
});

test('a newly installed worker is offered only after it finished installing', () => {
  const offered = [];
  const registration = Object.assign(new FakeTarget(), { waiting: null, installing: null });
  watchServiceWorkerUpdates(registration, { serviceWorker: { controller: {} }, onUpdateReady: worker => offered.push(worker) });
  const worker = Object.assign(new FakeTarget(), { state: 'installing' });
  registration.installing = worker;
  registration.emit('updatefound');
  worker.emit('statechange');
  assert.equal(offered.length, 0);
  worker.state = 'installed';
  worker.emit('statechange');
  assert.deepEqual(offered, [worker]);
});

test('the very first install is not presented as an update', () => {
  const offered = [];
  watchServiceWorkerUpdates(Object.assign(new FakeTarget(), { waiting: { id: 'first' } }), { serviceWorker: { controller: null }, onUpdateReady: worker => offered.push(worker) });
  assert.equal(offered.length, 0);
});

test('applying an update asks the waiting worker to take over and reloads exactly once', () => {
  const serviceWorker = new FakeTarget();
  const messages = [];
  let reloads = 0;
  assert.equal(activateUpdate({ postMessage: message => messages.push(message) }, { serviceWorker, reload: () => reloads++ }), true);
  assert.deepEqual(messages, [{ type: 'SKIP_WAITING' }]);
  serviceWorker.emit('controllerchange');
  serviceWorker.emit('controllerchange');
  assert.equal(reloads, 1);
  assert.equal(activateUpdate(null, { serviceWorker, reload: () => reloads++ }), false);
});

test('the offline status names the cores stored on the device', () => {
  const summary = summarizeRuntimeCache([
    'https://x.test/emulatorjs/4.2.3/data/loader.js',
    'https://x.test/emulatorjs/4.2.3/data/cores/nestopia-legacy-wasm.data',
    'https://x.test/emulatorjs/4.2.3/data/cores/nestopia-wasm.data',
    'https://x.test/emulatorjs/4.2.3/data/cores/fbneo-legacy-wasm.data',
    'https://x.test/emulatorjs/4.2.3/data/cores/reports/fbneo.json'
  ]);
  assert.deepEqual(summary, { runtimeReady: true, cores: ['fbneo', 'nestopia'] });
  assert.deepEqual(summarizeRuntimeCache([]), { runtimeReady: false, cores: [] });
});
