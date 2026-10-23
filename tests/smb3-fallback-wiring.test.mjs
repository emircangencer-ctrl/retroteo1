import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const player = await readFile(new URL('../src/emulatorjs-nes-player.js', import.meta.url), 'utf8');
const publicWorker = await readFile(new URL('../public/service-worker.js', import.meta.url), 'utf8');
const rootWorker = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');

test('SMB3 unknown-but-structurally-valid payload is wired to the real FCEUmm core', () => {
  assert.match(app, /const useSmb3FceummFallback = smb3Diagnostic\?\.status === 'compatibility-fallback'/);
  assert.match(app, /coreId: useSmb3FceummFallback \? 'fceumm' : system\.emulatorJsCoreId/);
  assert.match(app, /systemLabel: useSmb3FceummFallback \? \x60\$\{system\.shortLabel\} \/ FCEUmm uyumluluk modu\x60 : system\.shortLabel/);
  assert.match(player, /nes: new Set\(\['nes', 'fceumm', 'nestopia'\]\)/);
  assert.match(player, /window\.EJS_core = /);
});

test('fallback warning clearly distinguishes an unknown ROM fingerprint from a clean retail match', () => {
  assert.match(app, /ROM sürümü uyarısı/);
  assert.match(app, /alternatif çekirdekle uyumluluk deneniyor/);
  assert.match(app, /useSmb3FceummFallback \? 'fceumm'/);
});

test('both service-worker entry files invalidate the stale shell/runtime cache generations', () => {
  for (const source of [publicWorker, rootWorker]) {
    assert.match(source, /CACHE_NAME = 'retroplay-shell-v12'/);
    assert.match(source, /EMULATORJS_CACHE_NAME = 'retroplay-emulatorjs-runtime-v4'/);
  }
  assert.equal(publicWorker, rootWorker, 'deployed and root service worker sources must remain identical');
});
