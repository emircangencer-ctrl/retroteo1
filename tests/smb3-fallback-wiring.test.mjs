import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const player = await readFile(new URL('../src/emulatorjs-nes-player.js', import.meta.url), 'utf8');
const publicWorker = await readFile(new URL('../public/service-worker.js', import.meta.url), 'utf8');

test('unknown SMB3 payloads never start without explicit consent, asked before any emulator player is created', () => {
  assert.match(app, /if \(!isSuperMarioBros3LaunchAllowed\(smb3Diagnostic\)\) \{/);
  assert.match(app, /game\.unverifiedDumpAccepted === true \|\| await askUnverifiedDumpConsent\(smb3Diagnostic\)/);
  assert.doesNotMatch(app, /compatibility-fallback|useSmb3FceummFallback|alternatif çekirdekle uyumluluk deneniyor/);
  assert.ok(
    app.indexOf('if (!isSuperMarioBros3LaunchAllowed(smb3Diagnostic))')
      < app.indexOf('new EmulatorJsPlayer'),
    'the ROM identity check and consent must run before player construction'
  );
});

test('FCEUmm requires an explicit query parameter and Nestopia remains the default', () => {
  assert.match(app, /get\('nescore'\) === 'fceumm'/);
  assert.match(app, /coreId: useFceummComparison \? 'fceumm' : system\.emulatorJsCoreId/);
  assert.match(app, /systemLabel: useFceummComparison \? \x60\$\{system\.shortLabel\} \/ FCEUmm karşılaştırma modu\x60 : system\.shortLabel/);
  assert.match(player, /nes: new Set\(\['nes', 'fceumm', 'nestopia'\]\)/);
  assert.match(player, /window\.EJS_core = /);
});

test('there is a single service worker source and it starts new cache generations', async () => {
  const { access } = await import('node:fs/promises');
  await assert.rejects(access(new URL('../service-worker.js', import.meta.url)), 'the old duplicate root service-worker.js must stay removed');
  assert.match(publicWorker, /CACHE_NAME = 'retroplay-shell-v13'/);
  assert.match(publicWorker, /RUNTIME_CACHE_NAME = 'retroplay-emulatorjs-4\.2\.3-v1'/);
});
