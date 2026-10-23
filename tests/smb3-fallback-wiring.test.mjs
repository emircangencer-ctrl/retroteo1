import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const player = await readFile(new URL('../src/emulatorjs-nes-player.js', import.meta.url), 'utf8');
const publicWorker = await readFile(new URL('../public/service-worker.js', import.meta.url), 'utf8');
const rootWorker = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');

test('unknown SMB3 payloads are rejected before any emulator player is created', () => {
  assert.match(app, /if \(!isSuperMarioBros3LaunchAllowed\(smb3Diagnostic\)\) \{/);
  assert.doesNotMatch(app, /compatibility-fallback|useSmb3FceummFallback|alternatif çekirdekle uyumluluk deneniyor/);
  assert.ok(
    app.indexOf('if (!isSuperMarioBros3LaunchAllowed(smb3Diagnostic))')
      < app.indexOf('new EmulatorJsPlayer'),
    'the fail-closed ROM check must run before player construction'
  );
});

test('FCEUmm requires an explicit query parameter and Nestopia remains the default', () => {
  assert.match(app, /get\('nescore'\) === 'fceumm'/);
  assert.match(app, /coreId: useFceummComparison \? 'fceumm' : system\.emulatorJsCoreId/);
  assert.match(app, /systemLabel: useFceummComparison \? \x60\$\{system\.shortLabel\} \/ FCEUmm karşılaştırma modu\x60 : system\.shortLabel/);
  assert.match(player, /nes: new Set\(\['nes', 'fceumm', 'nestopia'\]\)/);
  assert.match(player, /window\.EJS_core = /);
});

test('both service-worker entry files invalidate the stale shell/runtime cache generations', () => {
  for (const source of [publicWorker, rootWorker]) {
    assert.match(source, /CACHE_NAME = 'retroplay-shell-v12'/);
    assert.match(source, /EMULATORJS_CACHE_NAME = 'retroplay-emulatorjs-runtime-v4'/);
  }
  assert.equal(publicWorker, rootWorker, 'deployed and root service worker sources must remain identical');
});
