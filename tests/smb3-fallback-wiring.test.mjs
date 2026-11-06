import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

const session = await readFile(new URL('../src/player/session.svelte.ts', import.meta.url), 'utf8');
const player = await readFile(new URL('../src/emulatorjs-nes-player.js', import.meta.url), 'utf8');
const publicWorker = await readFile(new URL('../public/service-worker.js', import.meta.url), 'utf8');

test('unknown SMB3 payloads never start without explicit consent, asked before any emulator player is created', () => {
  assert.match(session, /if \(!isSuperMarioBros3LaunchAllowed\(smb3Diagnostic\)\) \{/);
  assert.match(session, /game\.unverifiedDumpAccepted === true \|\| await this\.#askConsent\(smb3Diagnostic\)/);
  assert.match(session, /Başlatılmadı · doğrulanmamış döküm/);
  assert.doesNotMatch(session, /compatibility-fallback|useSmb3FceummFallback|alternatif çekirdekle uyumluluk deneniyor/);
  assert.ok(session.indexOf('if (!isSuperMarioBros3LaunchAllowed(smb3Diagnostic))') < session.indexOf('new EmulatorJsPlayer'), 'the ROM identity check and consent must run before player construction');
});

test('when the first core cannot open a file the next one is offered (never switched silently) and remembered', () => {
  assert.match(session, /if \(\(error as \{ code\?: string \}\)\?\.code !== 'content-not-loaded' \|\| !next\) throw error;/);
  assert.match(session, /label: `\$\{next\.name\} ile dene`/);
  assert.match(session, /this\.start\(gameId, \{ coreOverride: next\.coreId \}\)/);
  assert.match(session, /rememberCore\(game, used\.coreId\)/);
  assert.match(player, /nes: new Set\(\['nes', 'fceumm', 'nestopia'\]\)/);
  assert.match(player, /error\.code='content-not-loaded'/);
});

test('there is a single service worker source and it starts new cache generations', async () => {
  await assert.rejects(access(new URL('../service-worker.js', import.meta.url)), 'the old duplicate root service-worker.js must stay removed');
  assert.match(publicWorker, /CACHE_NAME = 'retroplay-shell-v15'/);
  assert.match(publicWorker, /RUNTIME_CACHE_NAME = 'retroplay-emulatorjs-4\.2\.3-v2'/);
});
