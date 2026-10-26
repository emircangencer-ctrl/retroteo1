// RetroPlay browser E2E: runs the production build (dist/), which serves the real EmulatorJS 4.2.3 runtime itself.
// Usage: npm run build (repo root) → cd e2e && npm install && npx playwright install chromium && npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { startServer, newPage, importFile, play, appBatterySaves, deleteEmulatorSaveStore, deleteAppSaveStates, appSaveStates, liveSram, waitFor, DIST, cdnRequests, recordInputs, heldInputs, touchScreen, padGeometry } from './harness.mjs';
import { batteryTestRom, megaDriveBinStub, unverifiedMmc3Rom, checkerboardRom } from './fixtures/make-roms.mjs';
import { decodePng, rowRuns } from './png.mjs';
import { placeholderSet } from './fixtures/zip-writer.mjs';

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('dist/ is missing — run `npm run build` in the repository root first.');
  process.exit(2);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'retroplay-e2e-'));
const batteryRom = path.join(tmp, 'battery-test.nes');
const mdBin = path.join(tmp, 'genesis-stub.bin');
fs.writeFileSync(batteryRom, batteryTestRom());
fs.writeFileSync(mdBin, megaDriveBinStub());
const unverifiedRom = path.join(tmp, 'Super Mario Bros. 3 (U) (PRG 1) [h2].nes');
fs.writeFileSync(unverifiedRom, unverifiedMmc3Rom());
const checkerRom = path.join(tmp, 'checkerboard.nes');
fs.writeFileSync(checkerRom, checkerboardRom());

// Arcade sets made of CRC-matched placeholder files (zeros; no game data), built from the catalogs.
const fbneoCatalog = JSON.parse(fs.readFileSync(path.join(DIST, 'assets', 'arcade-fbneo.json'), 'utf8'));
const mameCatalog = JSON.parse(fs.readFileSync(path.join(DIST, 'assets', 'arcade-mame2003plus.json'), 'utf8'));
const arcadeFile = (name, roms, options) => { const file = path.join(tmp, name); fs.writeFileSync(file, placeholderSet(roms, options)); return file; };
const puckmanZip = arcadeFile('puckman.zip', fbneoCatalog.games.puckman[6]);
const renamedZip = arcadeFile('Pac Man kopyam.zip', fbneoCatalog.games.puckman[6]);
const brokenZip = path.join(tmp, 'broken', 'puckman.zip');
fs.mkdirSync(path.dirname(brokenZip));
fs.writeFileSync(brokenZip, placeholderSet(fbneoCatalog.games.puckman[6], { omit: ['pm1_prg2.6k'] }));
const mslugZip = arcadeFile('mslug.zip', fbneoCatalog.games.mslug[6]);
const neogeoZip = arcadeFile('neogeo.zip', fbneoCatalog.games.neogeo[6].filter(([name]) => ['sp-s3.sp1', 'sm1.sm1', 'sfix.sfix', '000-lo.lo'].includes(name)));
const zigzagZip = arcadeFile('zigzag.zip', mameCatalog.games.zigzag[6]);
// An old CPS2 set: every file right except the 20-byte decryption key (sets before MAME 0.178).
const noKeyZip = path.join(tmp, 'old', 'spf2t.zip');
fs.mkdirSync(path.dirname(noKeyZip));
fs.writeFileSync(noKeyZip, placeholderSet(fbneoCatalog.games.spf2t[6], { omit: ['spf2t.key'] }));
const keyedZip = arcadeFile('spf2t.zip', fbneoCatalog.games.spf2t[6]);
// Old CPS2 sets FB Alpha 2012 CPS2 knows: a parent and a self-contained clone, both without .key.
const fbaCatalog = JSON.parse(fs.readFileSync(path.join(DIST, 'assets', 'arcade-fba2012-cps2.json'), 'utf8'));
const oldCps2Zip = arcadeFile('megaman2.zip', fbneoCatalog.games.megaman2[6].filter(([name]) => !name.endsWith('.key')));
const oldCloneZip = arcadeFile('megaman2a.zip', fbaCatalog.games.megaman2a[6]);
const snesRom = path.join(tmp, 'snes pad.sfc');
fs.writeFileSync(snesRom, new Uint8Array(131072));
const mapperRom = path.join(tmp, 'mapper220.nes');
{ const rom = checkerboardRom(); rom[6] = 0xc0; rom[7] = 0xd0; fs.writeFileSync(mapperRom, rom); }

async function gameScreenshot(page) {
  const box = await page.evaluate(() => {
    const frame = document.querySelector('#player-screen iframe');
    const canvas = frame.contentWindow.document.querySelector('canvas');
    const outer = frame.getBoundingClientRect(); const inner = canvas.getBoundingClientRect();
    return { x: outer.left + inner.left, y: outer.top + inner.top, width: inner.width, height: inner.height, backing: [canvas.width, canvas.height], ratio: frame.contentWindow.devicePixelRatio };
  });
  const image = decodePng(await page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height } }));
  return { box, image };
}

const { server, base } = await startServer();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const results = [];

async function scenario(name, fn, options = {}) {
  const started = Date.now();
  const { context, page, logs } = await newPage(browser, base, options);
  try {
    await fn(page, context);
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`ok   ${name} (${Date.now() - started} ms)`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log(`FAIL ${name}\n     ${error?.stack || error}\n     ${logs.slice(-5).join('\n     ')}`);
  } finally {
    await context.close();
  }
}

await scenario('in-game save is stored when the player is closed with the app button', async page => {
  await importFile(page, batteryRom);
  const state = await play(page, 'battery test');
  assert.match(state.status, /^Çalışıyor/);
  await page.waitForTimeout(3000);
  await page.evaluate(() => document.querySelector('#player-close').click());
  const saves = await waitFor(async () => { const all = await appBatterySaves(page); return all.length ? all : null; });
  assert.ok(saves?.length === 1, 'one battery save record expected');
  assert.equal(saves[0].byteLength, 8192);
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('[data-export-sram]'))), true, 'SRAM export button appears');
});

await scenario('the app copy is restored into the core even when the emulator store is empty', async page => {
  await importFile(page, batteryRom);
  await play(page, 'battery test');
  await page.waitForTimeout(2500);
  await page.evaluate(() => document.querySelector('#player-close').click());
  const first = await waitFor(async () => (await appBatterySaves(page))[0] || null);
  const bootCount = first.bytes[2];
  await deleteEmulatorSaveStore(page);
  await deleteAppSaveStates(page); // isolate battery-save restore from the resume point
  await page.reload({ waitUntil: 'networkidle' });
  await play(page, 'battery test');
  await page.waitForTimeout(2500);
  await page.evaluate(() => document.querySelector('#player-close').click());
  const second = await waitFor(async () => {
    const save = (await appBatterySaves(page))[0];
    return save && save.bytes[2] !== bootCount ? save : null;
  });
  // Restored save + soft reset → boot counter advances from the saved value. A blank start would repeat it.
  assert.equal(second?.bytes[2], (bootCount + 1) & 0xff);
});

await scenario('quick save and quick load return the game to the saved moment', async page => {
  await importFile(page, batteryRom);
  await play(page, 'battery test');
  await page.waitForTimeout(1500);
  const before = (await liveSram(page))[2];
  await page.evaluate(() => document.querySelector('#quick-save').click());
  await page.waitForFunction(() => /Kaydedildi/.test(document.querySelector('#player-notice-text')?.textContent || ''), null, { timeout: 5000 });
  assert.equal(await page.evaluate(() => document.querySelector('#quick-load').disabled), false);
  await page.evaluate(() => document.querySelector('#player-screen iframe').contentWindow.EJS_emulator.gameManager.restart());
  await page.waitForTimeout(500);
  assert.equal((await liveSram(page))[2], (before + 1) & 0xff, 'the reset advanced the boot counter');
  await page.evaluate(() => document.querySelector('#quick-load').click());
  await page.waitForFunction(() => /yüklendi/.test(document.querySelector('#player-notice-text')?.textContent || ''), null, { timeout: 5000 });
  await page.waitForTimeout(300);
  assert.equal((await liveSram(page))[2], before, 'loading the state restored the saved moment');
});

await scenario('closing and reopening continues where the player left off', async page => {
  await importFile(page, batteryRom);
  await play(page, 'battery test');
  await page.waitForTimeout(1500);
  const atClose = (await liveSram(page))[2];
  await page.evaluate(() => document.querySelector('#player-close').click());
  const states = await waitFor(async () => { const all = await appSaveStates(page); return all.some(state => state.slot === 'auto') ? all : null; });
  assert.ok(states, 'a resume point is stored on close');
  await page.evaluate(() => document.querySelector('[data-view="library"]').click());
  assert.match(await page.evaluate(() => document.querySelector('#library-games [data-play]').textContent), /Devam et/);
  await play(page, 'battery test');
  await page.waitForFunction(() => /Kaldığın yerden/.test(document.querySelector('#player-notice-text')?.textContent || ''), null, { timeout: 5000 });
  await page.waitForTimeout(300);
  assert.equal((await liveSram(page))[2], atClose, 'the machine state at close was restored');
  await page.evaluate(() => document.querySelector('#player-notice-action').click());
  await page.waitForTimeout(500);
  assert.equal((await liveSram(page))[2], (atClose + 1) & 0xff, '"Baştan başla" resets the game');
});

await scenario('a non-fatal runtime rejection does not mark the running game as stopped', async page => {
  await importFile(page, batteryRom);
  await play(page, 'battery test');
  await page.waitForTimeout(4000);
  const state = await page.evaluate(() => ({ status: document.querySelector('#player-status').textContent, error: document.querySelector('#player-error').textContent }));
  assert.match(state.status, /^Çalışıyor/);
  assert.equal(state.error, '');
});

await scenario('browser/Android back closes the player, keeps the app open and saves', async page => {
  await importFile(page, batteryRom);
  await play(page, 'battery test');
  await page.waitForTimeout(2000);
  const origin = new URL(page.url()).origin;
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('#player-modal').classList.contains('hidden'), null, { timeout: 5000 });
  assert.equal(new URL(page.url()).origin, origin);
  assert.ok(await page.evaluate(() => Boolean(document.querySelector('#view-library'))));
  const saves = await waitFor(async () => { const all = await appBatterySaves(page); return all.length ? all : null; });
  assert.ok(saves?.length === 1);
});

await scenario('sending the app to the background saves and pauses; returning resumes', async page => {
  await importFile(page, batteryRom);
  await play(page, 'battery test');
  await page.waitForTimeout(2000);
  const setVisibility = state => page.evaluate(value => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
  await setVisibility('hidden');
  await page.waitForFunction(() => /Duraklatıldı/.test(document.querySelector('#player-status').textContent), null, { timeout: 5000 });
  const saves = await waitFor(async () => { const all = await appBatterySaves(page); return all.length ? all : null; });
  assert.ok(saves?.length === 1, 'backgrounding stores the save without closing the game');
  await setVisibility('visible');
  await page.waitForFunction(() => /Çalışıyor/.test(document.querySelector('#player-status').textContent), null, { timeout: 5000 });
});

await scenario('tapping outside the game no longer closes it', async page => {
  await importFile(page, batteryRom);
  await play(page, 'battery test');
  await page.mouse.click(5, 5);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.querySelector('#player-modal').classList.contains('hidden')), false);
});

await scenario('an unverified SMB3 dump asks once; "Yine de oyna" starts it and is remembered', async page => {
  await importFile(page, unverifiedRom);
  await page.evaluate(() => document.querySelector('[data-view="library"]').click());
  const id = await page.evaluate(() => document.querySelector('#library-games [data-play]').dataset.play);
  await page.evaluate(gameId => document.querySelector(`#library-games [data-play="${gameId}"]`).click(), id);
  await page.waitForFunction(() => !document.querySelector('#player-consent').hidden, null, { timeout: 10000 });
  assert.match(await page.evaluate(() => document.querySelector('#player-consent-detail').textContent), /CRC32 [0-9A-F]{8} · Mapper 4/);
  assert.equal(await page.evaluate(() => document.querySelector('#player-screen iframe')), null, 'no emulator before consent');
  await page.evaluate(() => document.querySelector('#consent-play').click());
  await page.waitForFunction(() => /Çalışıyor/.test(document.querySelector('#player-status').textContent), null, { timeout: 90000 });
  await page.evaluate(() => document.querySelector('#player-close').click());
  await page.waitForTimeout(800);
  await page.evaluate(gameId => document.querySelector(`#library-games [data-play="${gameId}"]`).click(), id);
  await page.waitForFunction(() => /Çalışıyor/.test(document.querySelector('#player-status').textContent), null, { timeout: 90000 });
  assert.equal(await page.evaluate(() => document.querySelector('#player-consent').hidden), true, 'the choice is remembered');
});

await scenario('declining an unverified dump keeps it closed and shows why', async page => {
  await importFile(page, unverifiedRom);
  await page.evaluate(() => document.querySelector('[data-view="library"]').click());
  await page.evaluate(() => document.querySelector('#library-games [data-play]').click());
  await page.waitForFunction(() => !document.querySelector('#player-consent').hidden, null, { timeout: 10000 });
  await page.evaluate(() => document.querySelector('#consent-cancel').click());
  await page.waitForFunction(() => /Başlatılmadı/.test(document.querySelector('#player-status').textContent), null, { timeout: 5000 });
  assert.equal(await page.evaluate(() => document.querySelector('#player-screen iframe')), null);
  assert.equal(await page.evaluate(() => document.querySelector('#quick-save').disabled), true);
});

await scenario('a ROM can be re-added to a record restored from a metadata backup', async page => {
  await importFile(page, batteryRom);
  const [download] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => document.querySelector('#export-library').click())]);
  const backup = path.join(tmp, 'backup.json');
  await download.saveAs(backup);
  assert.match(download.suggestedFilename(), /^RetroPlay-Library-\d{4}-\d{2}-\d{2}-v\d+\.\d+\.\d+\.json$/);
  await page.evaluate(() => document.querySelector('[data-view="library"]').click());
  await page.evaluate(() => document.querySelector('#library-games [data-remove]').click());
  await page.setInputFiles('#library-backup-input', backup);
  await page.waitForFunction(() => document.body.textContent.includes('Yedek kaydı · ROM yok'), null, { timeout: 5000 });
  const text = await importFile(page, batteryRom);
  assert.match(text, /Yedek kaydına bağlandı/);
  await page.evaluate(() => document.querySelector('[data-view="library"]').click());
  assert.equal(await page.evaluate(() => document.querySelectorAll('#library-games [data-play]').length), 1);
});

await scenario('a Mega Drive .bin with a SEGA header is imported as a playable Mega Drive game', async page => {
  const text = await importFile(page, mdBin);
  assert.match(text, /Eklendi: genesis-stub\.bin/);
  await page.evaluate(() => document.querySelector('[data-view="library"]').click());
  const label = await page.evaluate(() => [...document.querySelectorAll('#library-games .game-card')].find(card => card.textContent.includes('genesis stub'))?.querySelector('.game-foot')?.textContent || '');
  assert.match(label, /Mega Drive · Oynatılabilir dosya/);
});

await scenario('after one online visit, a game starts with no network at all (service worker cache)', async (page, context) => {
  const manifest = JSON.parse(fs.readFileSync(path.join(DIST, 'emulatorjs', 'runtime-manifest.json'), 'utf8'));
  await page.evaluate(() => navigator.serviceWorker.ready);
  const cached = await waitFor(() => page.evaluate(async urls => {
    const cache = await caches.open('retroplay-emulatorjs-4.2.3-v1');
    const hits = await Promise.all(urls.map(url => cache.match(url)));
    return hits.every(Boolean);
  }, manifest.precache), { timeout: 60000, interval: 500 });
  assert.equal(cached, true, 'runtime and default cores are stored by the service worker');
  await context.setOffline(true);
  await page.reload({ waitUntil: 'load' });
  assert.equal(await page.evaluate(() => navigator.onLine), false);
  await importFile(page, batteryRom);
  const state = await play(page, 'battery test');
  assert.match(state.status, /^Çalışıyor/, `offline start failed: ${state.error}`);
  await context.setOffline(false);
}, { serviceWorkers: 'allow' });

await scenario('on a phone the game is drawn at full screen resolution and no pixel is lost', async page => {
  await importFile(page, checkerRom);
  const state = await play(page, 'checkerboard');
  assert.match(state.status, /^Çalışıyor/);
  await page.waitForTimeout(1500);
  const { box, image } = await gameScreenshot(page);
  assert.equal(box.backing[0], Math.round(box.width * box.ratio), 'canvas backing store uses device pixels');
  // A row exactly on the border between two NES rows is blended by the sharp shader: use the
  // crispest row near the middle.
  const middle = Math.floor(image.height / 2);
  const runs = [-3, -2, -1, 0, 1, 2, 3].map(dy => rowRuns(image, middle + dy)).sort((a, b) => b.length - a.length)[0];
  assert.ok(runs.length >= 250, `all 256 NES columns are visible (${runs.length})`);
  assert.ok(Math.max(...runs) <= Math.ceil(image.width / 256) + 1, `no two NES pixels merge into one (widest run ${Math.max(...runs)})`);
  assert.match(await page.evaluate(() => document.querySelector('#display-mode').textContent), /Keskin/);
}, { mobile: true });

await scenario('"Tam sayı" display mode makes every NES pixel exactly the same size', async page => {
  await page.evaluate(() => localStorage.setItem('retroplay-display-mode', 'integer'));
  await page.reload({ waitUntil: 'networkidle' });
  await importFile(page, checkerRom);
  await play(page, 'checkerboard');
  await page.waitForTimeout(1500);
  const { image } = await gameScreenshot(page);
  const runs = rowRuns(image, Math.floor(image.height / 2));
  assert.ok(runs.length >= 250, `all columns visible (${runs.length})`);
  assert.equal(new Set(runs).size, 1, `one pixel width only, got ${[...new Set(runs)].join('/')}`);
}, { mobile: true });

await scenario('the performance meter measures the speed factor and normal play resumes afterwards', async page => {
  await importFile(page, checkerRom);
  await play(page, 'checkerboard');
  await page.waitForTimeout(1000);
  await page.evaluate(() => document.querySelector('#perf-test').click());
  const notice = await waitFor(() => page.evaluate(() => { const text = document.querySelector('#player-notice-text')?.textContent || ''; return /Hız payı/.test(text) ? text : null; }), { timeout: 20000, interval: 300 });
  assert.match(notice || '', /Hız payı \d+,\d× \(\d+ kare\/sn\)/);
  const history = await page.evaluate(() => JSON.parse(localStorage.getItem('retroplay-performance-history') || '[]'));
  assert.equal(history.length, 1);
  assert.ok(history[0].headroom > 1, `headroom ${history[0].headroom}`);
  assert.equal(history[0].core, 'nestopia');
  const fastForward = await page.evaluate(() => document.querySelector('#player-screen iframe').contentWindow.EJS_emulator.isFastForward);
  assert.equal(Boolean(fastForward), false, 'fast-forward is off again');
  await page.evaluate(() => document.querySelector('[data-view="settings"]').click());
  assert.match(await page.evaluate(() => document.querySelector('#perf-history').textContent), /checkerboard · NES\/nestopia/);
});

await scenario('an arcade zip is recognised by its set name, checked against FinalBurn Neo and started with it', async page => {
  const text = await importFile(page, puckmanZip);
  assert.match(text, /Eklendi: puckman\.zip — Puck Man \(Japan, set 1\) · FinalBurn Neo · tam set/);
  const state = await play(page, 'Puck Man');
  assert.match(state.status, /^Çalışıyor · EmulatorJS · Arcade · FinalBurn Neo/, state.error);
  const loaded = await page.evaluate(() => { const gm = document.querySelector('#player-screen iframe').contentWindow.EJS_emulator.gameManager; return { zip: gm.FS.analyzePath('/puckman.zip').exists, info: gm.functions.saveStateInfo() }; });
  assert.equal(loaded.zip, true, 'the core sees the set under its set name');
  assert.doesNotMatch(loaded.info, /^Size is zero/, 'the game itself is loaded, not just the core');
  // Pac-Man's cabinet: a 4-way joystick and no buttons (MAME 2003-Plus control list).
  const pad = await page.evaluate(() => ({ buttons: [...document.querySelectorAll('#touch-controls .tc-btn')].map(el => el.textContent || el.dataset.input), fourWay: document.querySelector('#touch-controls').dataset.fourWay }));
  assert.deepEqual(pad, { buttons: ['JETON', 'START'], fourWay: 'true' });
});

await scenario('a renamed arcade zip is recognised from its file checksums', async page => {
  const text = await importFile(page, renamedZip);
  assert.match(text, /Puck Man \(Japan, set 1\) · FinalBurn Neo · tam set · dosya adı puckman\.zip olarak tanındı/);
  const state = await play(page, 'Puck Man');
  assert.match(state.status, /^Çalışıyor/, state.error);
  assert.equal(await page.evaluate(() => document.querySelector('#player-screen iframe').contentWindow.EJS_emulator.gameManager.FS.analyzePath('/puckman.zip').exists), true);
});

await scenario('an incomplete arcade set says which file is missing', async page => {
  const text = await importFile(page, brokenZip);
  assert.match(text, /FinalBurn Neo · 1 dosya eksik/);
  await page.evaluate(() => document.querySelector('[data-view="library"]').click());
  assert.match(await page.evaluate(() => document.querySelector('#library-games .game-card .game-foot').textContent), /Eksik set · 1 dosya eksik/);
});

await scenario('a CPS2 set no core can start without its key is explained before any core is loaded', async page => {
  let text = await importFile(page, noKeyZip);
  assert.match(text, /Super Puzzle Fighter II Turbo \(Europe 960529\) · FinalBurn Neo · CPS2 şifre anahtarı eksik: spf2t\.key/);
  await page.evaluate(() => document.querySelector('[data-view="library"]').click());
  assert.match(await page.evaluate(() => document.querySelector('#library-games .game-card .game-foot').textContent), /Eksik set · CPS2 anahtarı yok/);
  // The user's record was saved by the previous build: no "different"/"cps2Key" fields.
  await page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('retroplay-local-v1');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => { const tx = req.result.transaction('games', 'readwrite'); const store = tx.objectStore('games'); const all = store.getAll();
      all.onsuccess = () => { for (const game of all.result) if (game.arcade) { delete game.arcade.different; delete game.arcade.cps2Key; store.put(game); } };
      tx.oncomplete = () => { req.result.close(); resolve(); }; tx.onerror = () => reject(tx.error); };
  }));
  await page.reload({ waitUntil: 'networkidle' });
  const state = await play(page, 'Super Puzzle Fighter');
  assert.match(state.status, /Başlatılamadı · CPS2 şifre anahtarı eksik/);
  assert.match(state.error, /Bu zip'te spf2t\.key yok\. CPS2 oyunlarının programı şifreli/);
  assert.match(state.error, /MAME 0\.178/);
  assert.doesNotMatch(state.error, /\.\./, 'no doubled full stop');
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('#player-screen iframe'))), false, 'no core is loaded for a set that cannot start');
  await page.evaluate(() => document.querySelector('#player-close').click());
  text = await importFile(page, keyedZip);
  assert.match(text, /Super Puzzle Fighter II Turbo \(Europe 960529\) · FinalBurn Neo · tam set · aynı oyunun eksik eski kopyası kütüphanede/);
});

await scenario('an old CPS2 set without .key runs on FB Alpha 2012 CPS2, also when it was imported by the previous build', async page => {
  const text = await importFile(page, oldCps2Zip);
  assert.match(text, /Eklendi: megaman2\.zip — .* · FB Alpha 2012 CPS2 · tam set/);
  // Turn the record into what the previous build stored: FinalBurn Neo, incomplete, key missing.
  await page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('retroplay-local-v1');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => { const tx = req.result.transaction('games', 'readwrite'); const store = tx.objectStore('games'); const all = store.getAll();
      all.onsuccess = () => { for (const game of all.result) if (game.arcade) { game.arcade = { core: 'fbneo', set: 'megaman2', status: 'incomplete', missing: ['megaman2.key'], missingCount: 1, parent: '', bios: '', vertical: false, manufacturer: 'Capcom', renamedFrom: '', alternatives: [{ core: 'mame2003_plus', status: 'incomplete', set: 'megaman2' }] }; store.put(game); } };
      tx.oncomplete = () => { req.result.close(); resolve(); }; tx.onerror = () => reject(tx.error); };
  }));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => /arcade oyunu artık açılabiliyor/.test(document.querySelector('#toast')?.textContent || ''), null, { timeout: 15000 });
  await page.evaluate(() => document.querySelector('[data-view="library"]').click());
  assert.match(await page.evaluate(() => document.querySelector('#library-games .game-card .game-foot').textContent), /FB Alpha 2012 CPS2 · tam set/);
  const state = await play(page, 'Mega Man 2');
  assert.match(state.status, /^Çalışıyor · EmulatorJS · Arcade · FB Alpha 2012 CPS2/, state.error);
  const loaded = await page.evaluate(() => { const gm = document.querySelector('#player-screen iframe').contentWindow.EJS_emulator.gameManager; return [gm.FS.analyzePath('/megaman2.zip').exists, gm.functions.saveStateInfo()]; });
  assert.equal(loaded[0], true);
  assert.doesNotMatch(loaded[1], /^Size is zero/, 'the game itself is loaded, not just the core');
  const pad = await page.evaluate(() => [...document.querySelectorAll('#touch-controls .tc-btn')].map(el => el.textContent || el.dataset.input));
  assert.deepEqual(pad, ['BUTTON_Y', 'BUTTON_X', 'BUTTON_L', 'BUTTON_B', 'BUTTON_A', 'BUTTON_R', 'JETON', 'START']);
});

await scenario('a self-contained old CPS2 clone runs on FB Alpha 2012 CPS2 without its parent set', async page => {
  const text = await importFile(page, oldCloneZip);
  assert.match(text, /Mega Man 2 - the power fighters \(960708 Asia\) · FB Alpha 2012 CPS2 · tam set/);
  const state = await play(page, 'Mega Man 2');
  assert.match(state.status, /^Çalışıyor · EmulatorJS · Arcade · FB Alpha 2012 CPS2/, state.error);
  const loaded = await page.evaluate(() => { const gm = document.querySelector('#player-screen iframe').contentWindow.EJS_emulator.gameManager; return [gm.FS.analyzePath('/megaman2a.zip').exists, gm.FS.analyzePath('/megaman2.zip').exists, gm.functions.saveStateInfo()]; });
  assert.deepEqual(loaded.slice(0, 2), [true, true], 'the clone and a stand-in parent zip are in place');
  assert.doesNotMatch(loaded[2], /^Size is zero/);
});

await scenario('a Neo Geo game asks for neogeo.zip, offers to add it in the player and then starts with the BIOS', async page => {
  const text = await importFile(page, mslugZip);
  assert.match(text, /Metal Slug - Super Vehicle-001 · FinalBurn Neo · tam set · neogeo\.zip BIOS gerekli/);
  let state = await play(page, 'Metal Slug - Super');
  assert.match(state.status, /Başlatılamadı · neogeo\.zip gerekli/);
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('#player-screen iframe'))), false, 'nothing is loaded without the BIOS');
  assert.equal(await page.evaluate(() => document.querySelector('#player-retry').textContent), 'neogeo.zip ekle');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#player-retry')]);
  await chooser.setFiles(neogeoZip);
  await page.waitForFunction(() => { const text = document.querySelector('#player-status')?.textContent || ''; return /^Çalışıyor/.test(text) || (/Başlatılamadı/.test(text) && !/neogeo\.zip gerekli/.test(text)); }, null, { timeout: 90000 });
  state = await page.evaluate(() => ({ status: document.querySelector('#player-status').textContent, error: document.querySelector('#player-error').textContent }));
  assert.match(state.status, /^Çalışıyor · EmulatorJS · Arcade · FinalBurn Neo/, state.error);
  const files = await page.evaluate(() => { const gm = document.querySelector('#player-screen iframe').contentWindow.EJS_emulator.gameManager; return [gm.FS.analyzePath('/mslug.zip').exists, gm.FS.analyzePath('/neogeo.zip').exists, gm.functions.saveStateInfo()]; });
  assert.deepEqual(files.slice(0, 2), [true, true]);
  assert.doesNotMatch(files[2], /^Size is zero/);
  const pad = await page.evaluate(() => [...document.querySelectorAll('#touch-controls .tc-face')].map(el => `${el.textContent}=${el.dataset.input}`));
  assert.deepEqual(pad, ['A=BUTTON_B', 'B=BUTTON_A', 'C=BUTTON_Y', 'D=BUTTON_X']);
  await page.evaluate(() => document.querySelector('#player-close').click());
  await page.evaluate(() => document.querySelector('[data-view="settings"]').click());
  assert.match(await page.evaluate(() => document.querySelector('#bios-list').textContent), /neogeo\.zip.*kullanıma hazır/);
});

await scenario('a set only MAME 2003-Plus has is started with MAME 2003-Plus', async page => {
  const text = await importFile(page, zigzagZip);
  assert.match(text, /MAME 2003-Plus · tam set/);
  const state = await play(page, 'Zig Zag');
  assert.match(state.status, /^Çalışıyor · EmulatorJS · Arcade · MAME 2003-Plus/, state.error);
});

await scenario('when Nestopia cannot open an NES file, FCEUmm is offered instead of switching silently', async page => {
  await importFile(page, mapperRom);
  const state = await play(page, 'mapper220');
  assert.match(state.status, /Nestopia bu oyunu açamadı/);
  const retry = await page.evaluate(() => { const button = document.querySelector('#player-retry'); return { hidden: button.hidden, text: button.textContent }; });
  assert.deepEqual(retry, { hidden: false, text: 'FCEUmm ile dene' });
});

// ---- Touch play (phones/tablets) and controllers -------------------------------------------------
const boxesOverlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

await scenario('on a phone the picture is on top and the console pad below; turning the phone puts the pad beside the picture', async page => {
  await importFile(page, checkerRom);
  const state = await play(page, 'checkerboard');
  assert.match(state.status, /^Çalışıyor/);
  let g = await padGeometry(page);
  assert.equal(g.touchPlay, true);
  assert.equal(g.orientation, 'portrait');
  assert.deepEqual([g.screen.x, g.screen.y, Math.round(g.screen.w)], [0, 48, 393], 'edge-to-edge picture under the bar');
  const parts = [g.dpad.box, ...g.face.map(b => b.box), ...g.system.map(b => b.box)];
  for (const box of parts) {
    assert.ok(box.y >= g.screen.y + g.screen.h, 'pad below the picture');
    assert.ok(box.x >= 8 && box.x + box.w <= 393 - 8 && box.y + box.h <= 873, 'pad on screen');
  }
  assert.deepEqual(g.face.map(b => `${b.label}=${b.input}`), ['B=BUTTON_B', 'A=BUTTON_A']);
  assert.deepEqual(g.system.map(b => b.label), ['SELECT', 'START']);
  assert.ok(g.dpad.r * 2 >= 150, `d-pad ${g.dpad.r * 2}px`);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.player-header')).display), 'none', 'no page chrome around the game');
  await page.setViewportSize({ width: 873, height: 393 });
  await page.waitForTimeout(500);
  g = await padGeometry(page);
  assert.equal(g.orientation, 'landscape');
  assert.equal(Math.round(g.screen.h), 393, 'full-height picture');
  assert.ok(Math.abs(g.screen.x + g.screen.w / 2 - 873 / 2) < 2, 'centred');
  for (const box of [g.dpad.box, ...g.face.map(b => b.box), ...g.system.map(b => b.box)]) assert.ok(!boxesOverlap(box, g.screen), 'beside the picture on a 20:9 phone');
  assert.ok(g.dpad.x < g.screen.x && g.face.every(b => b.x > g.screen.x + g.screen.w));
  const canvas = await page.evaluate(() => { const c = document.querySelector('#player-screen iframe').contentWindow.document.querySelector('canvas'); return [c.width, c.height]; });
  assert.ok(canvas[1] >= 393 * 2.75 - 2, `the picture is re-rendered at the new size (${canvas})`);
  // Fullscreen only hides the browser; the handheld layout stays usable.
  await page.evaluate(() => document.querySelector('#play-menu').click());
  await page.evaluate(() => document.querySelector('#fullscreen-game').click());
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => Boolean(document.fullscreenElement)), true);
  const full = await padGeometry(page);
  assert.equal(full.orientation, 'landscape');
  assert.deepEqual([Math.round(full.dpad.x), Math.round(full.face[1].x)], [Math.round(g.dpad.x), Math.round(g.face[1].x)], 'same pad in fullscreen');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#touch-controls')).display), 'block');
}, { mobile: true });

await scenario('touch pad: the d-pad rolls through 8 directions without lifting, fingers work together, B→A slides and B+A presses both', async (page, context) => {
  await importFile(page, checkerRom);
  await play(page, 'checkerboard');
  await recordInputs(page);
  const touch = await touchScreen(context, page);
  const { dpad: d, face } = await padGeometry(page);
  const [B, A] = face;
  const seen = [];
  const step = async (type, points, label) => { await touch(type, points); seen.push(`${label}:${await heldInputs(page)}`); };
  await step('touchStart', [[d.x, d.y - d.r * 0.6, 1]], 'down-on-up');
  await step('touchMove', [[d.x + d.r * 0.43, d.y - d.r * 0.43, 1]], 'roll');
  await step('touchMove', [[d.x + d.r * 0.7, d.y + 3, 1]], 'roll');
  await step('touchMove', [[d.x + d.r * 0.45, d.y + d.r * 0.45, 1]], 'roll');
  await step('touchMove', [[d.x + 2, d.y + d.r * 0.75, 1]], 'roll');
  await step('touchMove', [[d.x + d.r * 1.9, d.y + d.r * 0.25, 1]], 'past-the-edge');
  await step('touchStart', [[d.x + d.r * 1.9, d.y + d.r * 0.25, 1], [B.x, B.y, 2]], 'second-finger');
  await step('touchMove', [[d.x + d.r * 1.9, d.y + d.r * 0.25, 1], [(A.x + B.x) / 2, (A.y + B.y) / 2, 2]], 'between');
  await step('touchMove', [[d.x + d.r * 1.9, d.y + d.r * 0.25, 1], [A.x, A.y, 2]], 'slid');
  await step('touchEnd', [[A.x, A.y, 2]], 'lift-A');
  await step('touchEnd', [], 'all-up');
  assert.deepEqual(seen, [
    'down-on-up:UP', 'roll:RIGHT+UP', 'roll:RIGHT', 'roll:DOWN+RIGHT', 'roll:DOWN', 'past-the-edge:RIGHT',
    'second-finger:B+RIGHT', 'between:A+B+RIGHT', 'slid:A+RIGHT', 'lift-A:RIGHT', 'all-up:-'
  ]);
  const buzz = await page.evaluate(() => window.__buzz);
  assert.ok(buzz.length >= 6 && buzz.every(ms => ms > 0 && ms <= 20), `short vibrations on presses (${buzz})`);
}, { mobile: true, init: () => { window.__buzz = []; navigator.vibrate = ms => { window.__buzz.push(ms); return true; }; } });

await scenario('the menu pauses the game and resumes it; the back button closes the menu, not the game; pad settings apply live and are remembered', async page => {
  await importFile(page, checkerRom);
  await play(page, 'checkerboard');
  const before = await padGeometry(page);
  await page.evaluate(() => document.querySelector('#play-menu').click());
  assert.match(await page.evaluate(() => document.querySelector('#player-status').textContent), /^Duraklatıldı/);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#player-menu')).display), 'flex');
  await page.goBack();
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.querySelector('#player-modal').classList.contains('menu-open')), false, 'back closed the menu');
  assert.equal(await page.evaluate(() => document.querySelector('#player-modal').classList.contains('hidden')), false, 'the game is still open');
  assert.match(await page.evaluate(() => document.querySelector('#player-status').textContent), /^Çalışıyor/, 'and running again');
  await page.evaluate(() => document.querySelector('#play-menu').click());
  await page.evaluate(() => document.querySelector('#touch-settings-open').click());
  await page.evaluate(() => { const input = document.querySelector('#ts-scale'); input.value = '85'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.evaluate(() => document.querySelector('#ts-dpad-mode button[data-value="4"]').click());
  const live = await padGeometry(page);
  assert.ok(live.face[0].r < before.face[0].r && live.dpad.r < before.dpad.r, 'the pad changed size while the menu is open');
  assert.equal(await page.evaluate(() => document.querySelector('#ts-scale-out').textContent), '%85');
  assert.equal(await page.evaluate(() => document.querySelector('#ts-dpad-mode button[data-value="4"]').getAttribute('aria-pressed')), 'true');
  await page.evaluate(() => document.querySelector('#ts-done').click());
  assert.match(await page.evaluate(() => document.querySelector('#player-status').textContent), /^Çalışıyor/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('retroplay-touch-settings')));
  assert.equal(saved.scale, 0.85);
  assert.equal(saved.dpadMode, '4');
  await page.reload({ waitUntil: 'networkidle' });
  await play(page, 'checkerboard');
  const after = await padGeometry(page);
  assert.equal(Math.round(after.face[0].r), Math.round(live.face[0].r), 'remembered after a reload');
}, { mobile: true });

await scenario('a USB/Bluetooth controller plays the game: buttons by position, stick as d-pad, the touch pad steps aside, the guide button opens the menu', async page => {
  await importFile(page, checkerRom);
  await play(page, 'checkerboard');
  await recordInputs(page);
  const set = async fn => { await page.evaluate(fn); await page.waitForTimeout(150); };
  await set(() => { window.__padOn = true; window.dispatchEvent(new Event('gamepadconnected')); });
  await set(() => { window.__pad.buttons[1].pressed = true; });
  assert.equal(await heldInputs(page), 'A', 'right face button = A');
  const hidden = await page.evaluate(() => ({ cls: document.querySelector('#player-modal').classList.contains('pad-hidden'), chip: !document.querySelector('#play-pad-chip').hidden, display: getComputedStyle(document.querySelector('#touch-controls')).display }));
  assert.deepEqual(hidden, { cls: true, chip: true, display: 'none' });
  await set(() => { window.__pad.buttons[1].pressed = false; window.__pad.buttons[0].pressed = true; window.__pad.axes[0] = -0.95; window.__pad.axes[1] = 0.9; });
  assert.equal(await heldInputs(page), 'B+DOWN+LEFT', 'bottom face = B, stick down-left');
  await set(() => { window.__pad.buttons[0].pressed = false; window.__pad.axes[0] = 0; window.__pad.axes[1] = 0; });
  assert.equal(await heldInputs(page), '-');
  // EmulatorJS's own gamepad code would have pressed RetroPad B for the right face button.
  assert.equal(await page.evaluate(() => window.__inputs.filter(([index, value]) => index === 0 && value).length), 1, 'no double input from the emulator');
  await set(() => { window.__pad.buttons[16].pressed = true; });
  await set(() => { window.__pad.buttons[16].pressed = false; });
  assert.equal(await page.evaluate(() => document.querySelector('#player-modal').classList.contains('menu-open')), true);
  await page.evaluate(() => document.querySelector('#play-pad-chip').click());
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('retroplay-touch-settings')).hideWithGamepad), false, 'the chip brings the touch pad back');
}, { mobile: true, init: () => {
  const pad = { id: 'Test Pad (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  window.__pad = pad; window.__padOn = false;
  Object.defineProperty(Navigator.prototype, 'getGamepads', { configurable: true, value: () => (window.top.__padOn ? [window.top.__pad, null, null, null] : [null, null, null, null]) });
} });

await scenario('every console has its own pad: Super Nintendo diamond with L/R, Mega Drive A B C under X Y Z', async page => {
  await importFile(page, snesRom);
  let state = await play(page, 'snes pad');
  assert.match(state.status, /^Çalışıyor · EmulatorJS · SNES/, state.error);
  let g = await padGeometry(page);
  assert.deepEqual(g.face.map(b => `${b.label}=${b.input}`), ['X=BUTTON_X', 'Y=BUTTON_Y', 'A=BUTTON_A', 'B=BUTTON_B']);
  const [X, Y, A, B] = g.face;
  assert.ok(X.y < Y.y && Y.x < A.x && B.y > A.y && Math.abs(X.x - B.x) < 2, 'diamond: X top, Y left, A right, B bottom');
  assert.deepEqual(g.shoulders.map(b => b.label), ['L', 'R']);
  assert.ok(g.shoulders.every(s => s.y < g.dpad.y - g.dpad.r && s.y > g.screen.y + g.screen.h), 'shoulders above the pad, below the picture');
  await page.evaluate(() => document.querySelector('#player-exit').click());
  await importFile(page, mdBin);
  state = await play(page, 'genesis stub');
  assert.match(state.status, /^Çalışıyor · EmulatorJS · Mega Drive/, state.error);
  g = await padGeometry(page);
  assert.deepEqual(g.face.map(b => b.label), ['A', 'B', 'C', 'X', 'Y', 'Z']);
  assert.ok(g.face.slice(3).every(top => top.y < Math.min(...g.face.slice(0, 3).map(b => b.y))), 'X Y Z row above A B C');
  assert.deepEqual(g.system.map(b => b.label), ['START']);
}, { mobile: true });

await scenario('no request ever reaches cdn.emulatorjs.org', async () => {
  assert.deepEqual(cdnRequests, []);
});

await browser.close();
server.close();
fs.rmSync(tmp, { recursive: true, force: true });
const failed = results.filter(result => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} E2E scenarios passed`);
process.exit(failed.length ? 1 : 0);
