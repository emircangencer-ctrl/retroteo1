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

test('Nestopia starts first; when it cannot open a file FCEUmm is offered (not switched silently); ?nescore=fceumm forces it', () => {
  assert.match(app, /get\('nescore'\) === 'fceumm'/);
  assert.match(app, /const cores = forced \? \[fceumm\] : game\.nesCore === 'fceumm' \? \[fceumm, nestopia\] : \[nestopia, fceumm\];/);
  assert.match(app, /if \(error\?\.code !== 'content-not-loaded' \|\| !next\) throw error;/);
  assert.match(app, /label: `\$\{next\.name\} ile dene`/);
  assert.match(app, /startGame\(game\.id, \{ coreOverride: next\.coreId \}\)/);
  assert.match(app, /rememberCore\(game, used\.coreId\)/);
  assert.match(player, /nes: new Set\(\['nes', 'fceumm', 'nestopia'\]\)/);
  assert.match(player, /error\.code='content-not-loaded'/);
});

test('there is a single service worker source and it starts new cache generations', async () => {
  const { access } = await import('node:fs/promises');
  await assert.rejects(access(new URL('../service-worker.js', import.meta.url)), 'the old duplicate root service-worker.js must stay removed');
  assert.match(publicWorker, /CACHE_NAME = 'retroplay-shell-v13'/);
  assert.match(publicWorker, /RUNTIME_CACHE_NAME = 'retroplay-emulatorjs-4\.2\.3-v1'/);
});
