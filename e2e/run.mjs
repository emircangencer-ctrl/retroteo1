// RetroPlay browser E2E: runs the production build (dist/), which serves the real EmulatorJS 4.2.3 runtime itself.
// Usage: npm run build (repo root) → cd e2e && npm install && npx playwright install chromium && npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { startServer, newPage, importFile, reviewItems, answerDialog, openGame, play, closeGame, playerState, waitForPlayer, appBatterySaves, deleteEmulatorSaveStore, deleteAppSaveStates, appSaveStates, appGames, liveSram, waitFor, DIST, cdnRequests, recordInputs, heldInputs, touchScreen, padGeometry } from './harness.mjs';
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
// Tekken 3 (Namco System 12) as the 2025 MAME 2003-Plus lists it: TET1/VER.E with its file names.
const tekken3Zip = arcadeFile('tekken3.zip', mameCatalog.games.tekken3[6]);
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
// Files for the import review: an N64 file (not supported), a broken NES header, a second copy.
const n64Rom = path.join(tmp, 'GoldenEye 007.z64');
fs.writeFileSync(n64Rom, new Uint8Array(4096));
const badNes = path.join(tmp, 'broken header.nes');
{ const rom = checkerboardRom(); rom[0] = 0x00; fs.writeFileSync(badNes, rom); }
const batteryCopy = path.join(tmp, 'copy', 'battery-test copy.nes');
fs.mkdirSync(path.dirname(batteryCopy));
fs.writeFileSync(batteryCopy, batteryTestRom());
const folder = path.join(tmp, 'Oyunlar');
fs.mkdirSync(path.join(folder, 'NES'), { recursive: true });
fs.writeFileSync(path.join(folder, 'NES', 'checkerboard.nes'), checkerboardRom());
fs.writeFileSync(path.join(folder, 'genesis-stub.bin'), megaDriveBinStub());
fs.writeFileSync(path.join(folder, 'okubeni.txt'), 'not a game');
fs.writeFileSync(path.join(folder, 'NES', 'kapak.jpg'), new Uint8Array(100));

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

const status = page => page.evaluate(() => document.querySelector('#player-status').textContent);
const waitStatus = (page, re, timeout = 5000) => page.waitForFunction(source => new RegExp(source).test(document.querySelector('#player-status').textContent), re.source, { timeout });
const notice = (page, re, timeout = 5000) => page.waitForFunction(source => new RegExp(source).test(document.querySelector('#player-notice-text')?.textContent || ''), re.source, { timeout });
const click = (page, selector) => page.evaluate(s => { const el = document.querySelector(s); if (!el) throw new Error(`missing ${s}`); el.click(); }, selector);

const { server, base } = await startServer();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const results = [];

async function scenario(name, fn, options = {}) {
  if (process.env.ONLY && !new RegExp(process.env.ONLY, 'i').test(name)) return;
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

const fakePad = () => {
  const pad = { id: 'Test Pad (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  window.__pad = pad; window.__padOn = false;
  Object.defineProperty(Navigator.prototype, 'getGamepads', { configurable: true, value: () => (window.top.__padOn ? [window.top.__pad, null, null, null] : [null, null, null, null]) });
};

// ---- saves -----------------------------------------------------------------------------------------
await scenario('in-game save is stored when the player is closed with the app button', async page => {
  await importFile(page, batteryRom);
  const state = await play(page, 'battery test');
  assert.match(state.status, /^Çalışıyor/);
  await page.waitForTimeout(3000);
  await closeGame(page);
  const saves = await waitFor(async () => { const all = await appBatterySaves(page); return all.length ? all : null; });
  assert.ok(saves?.length === 1, 'one battery save record expected');
  assert.equal(saves[0].byteLength, 8192);
  await page.waitForFunction(() => document.querySelector('[data-export-sram]') && !document.querySelector('[data-export-sram]').disabled, null, { timeout: 5000 });
});

await scenario('the app copy is restored into the core even when the emulator store is empty', async page => {
  await importFile(page, batteryRom);
  await play(page, 'battery test');
  await page.waitForTimeout(2500);
  await closeGame(page);
  const first = await waitFor(async () => (await appBatterySaves(page))[0] || null);
  const bootCount = first.bytes[2];
  await deleteEmulatorSaveStore(page);
  await deleteAppSaveStates(page); // isolate battery-save restore from the resume point
  await page.reload({ waitUntil: 'networkidle' });
  await play(page, 'battery test');
  await page.waitForTimeout(2500);
  await closeGame(page);
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
  await click(page, '#play-save');
  await notice(page, /Kaydedildi/);
  await page.waitForFunction(() => !document.querySelector('#play-load').disabled, null, { timeout: 5000 });
  await page.evaluate(() => document.querySelector('#player-screen iframe').contentWindow.EJS_emulator.gameManager.restart());
  await page.waitForTimeout(500);
  assert.equal((await liveSram(page))[2], (before + 1) & 0xff, 'the reset advanced the boot counter');
  await click(page, '#play-load');
  await notice(page, /yüklendi/);
  await page.waitForTimeout(300);
  assert.equal((await liveSram(page))[2], before, 'loading the state restored the saved moment');
  const quick = (await appSaveStates(page)).find(state => state.slot === 'quick');
  assert.ok(quick?.thumb > 0 && quick.thumbType === 'image/png', 'the quick save carries a picture of the game');
});

await scenario('closing and reopening continues where the player left off; "Baştan başla" starts over', async page => {
  await importFile(page, batteryRom);
  await play(page, 'battery test');
  await page.waitForTimeout(1500);
  const atClose = (await liveSram(page))[2];
  await closeGame(page);
  const states = await waitFor(async () => { const all = await appSaveStates(page); return all.some(state => state.slot === 'auto') ? all : null; });
  assert.ok(states, 'a resume point is stored on close');
  assert.ok(states.find(state => state.slot === 'auto').thumb > 0, 'with a picture');
  await openGame(page, 'battery test');
  assert.match(await page.evaluate(() => document.querySelector('.detail [data-play]').textContent), /Devam et/);
  await click(page, '.detail [data-play]');
  await waitForPlayer(page);
  await notice(page, /Kaldığın yerden/);
  await page.waitForTimeout(300);
  assert.equal((await liveSram(page))[2], atClose, 'the machine state at close was restored');
  await click(page, '#player-notice-action');
  await page.waitForTimeout(500);
  assert.equal((await liveSram(page))[2], (atClose + 1) & 0xff, 'the notice\'s "Baştan başla" resets the game');
  await closeGame(page);
  await page.waitForSelector('#play-fresh');
  const now = (await waitFor(async () => (await appBatterySaves(page))[0]))?.bytes[2];
  await click(page, '#play-fresh');
  await waitForPlayer(page);
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => /Kaldığın yerden/.test(document.querySelector('#player-notice-text')?.textContent || '')), false, 'the page\'s "Baştan başla" does not load the resume point');
  assert.equal((await liveSram(page))[2], (now + 1) & 0xff, 'it boots the game (SRAM kept, boot counter +1)');
});

await scenario('a non-fatal runtime rejection does not mark the running game as stopped', async page => {
  await importFile(page, batteryRom);
  await play(page, 'battery test');
  await page.waitForTimeout(4000);
  const state = await playerState(page);
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
  assert.ok(await page.evaluate(() => Boolean(document.querySelector('.detail'))), 'back on the game page');
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
  await waitStatus(page, /Duraklatıldı/);
  const saves = await waitFor(async () => { const all = await appBatterySaves(page); return all.length ? all : null; });
  assert.ok(saves?.length === 1, 'backgrounding stores the save without closing the game');
  assert.ok(await waitFor(async () => (await appSaveStates(page)).some(s => s.slot === 'auto')), 'and a resume point');
  await setVisibility('visible');
  await waitStatus(page, /Çalışıyor/);
});

await scenario('tapping outside the game no longer closes it', async page => {
  await importFile(page, batteryRom);
  await play(page, 'battery test');
  await page.mouse.click(5, 300);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.querySelector('#player-modal').classList.contains('hidden')), false);
});

await scenario('an unverified SMB3 dump is flagged in the review, asks once; "Yine de oyna" starts it and is remembered', async page => {
  await page.evaluate(() => { location.hash = '#/import'; });
  await page.setInputFiles('#import-file-input', unverifiedRom);
  await page.waitForSelector('#import-commit');
  const [item] = await reviewItems(page);
  assert.equal(item.tone, 'warn');
  assert.match(item.headline, /Tanınmayan döküm/);
  await click(page, '#import-commit');
  await page.waitForFunction(() => /Tamamlandı/.test(document.querySelector('#import-results')?.textContent || ''));
  const id = await openGame(page, 'Super Mario Bros. 3');
  assert.match(await page.evaluate(() => document.querySelector('.detail .badges').textContent), /Doğrulanmamış döküm/);
  await click(page, '.detail [data-play]');
  await page.waitForFunction(() => !document.querySelector('#player-consent').hidden, null, { timeout: 10000 });
  assert.match(await page.evaluate(() => document.querySelector('#player-consent-detail').textContent), /CRC32 [0-9A-F]{8} · Mapper 4/);
  assert.equal(await page.evaluate(() => document.querySelector('#player-screen iframe')), null, 'no emulator before consent');
  await click(page, '#consent-play');
  await waitStatus(page, /Çalışıyor/, 90000);
  await closeGame(page);
  await page.waitForSelector(`.detail[data-game-id="${id}"] [data-play]`);
  await click(page, '.detail [data-play]');
  await waitStatus(page, /Çalışıyor/, 90000);
  assert.equal(await page.evaluate(() => document.querySelector('#player-consent').hidden), true, 'the choice is remembered');
});

await scenario('declining an unverified dump keeps it closed and shows why', async page => {
  await importFile(page, unverifiedRom);
  await openGame(page, 'Super Mario Bros. 3');
  await click(page, '.detail [data-play]');
  await page.waitForFunction(() => !document.querySelector('#player-consent').hidden, null, { timeout: 10000 });
  await click(page, '#consent-cancel');
  await waitStatus(page, /Başlatılmadı/);
  assert.equal(await page.evaluate(() => document.querySelector('#player-screen iframe')), null);
  assert.equal(await page.evaluate(() => document.querySelector('#play-save').disabled), true);
  assert.match(await page.evaluate(() => document.querySelector('.player-blocked').textContent), /Temiz bir Super Mario Bros\. 3/);
});

await scenario('a ROM can be re-added to a record restored from a metadata backup', async page => {
  await importFile(page, batteryRom);
  await page.evaluate(() => { location.hash = '#/settings'; });
  await page.waitForSelector('#export-library');
  const [download] = await Promise.all([page.waitForEvent('download'), click(page, '#export-library')]);
  const backup = path.join(tmp, 'backup.json');
  await download.saveAs(backup);
  assert.match(download.suggestedFilename(), /^RetroPlay-Library-\d{4}-\d{2}-\d{2}-v\d+\.\d+\.\d+\.json$/);
  await openGame(page, 'battery test');
  await click(page, '.detail [data-remove]');
  await answerDialog(page, true);
  await page.waitForFunction(() => location.hash === '#/library');
  await page.evaluate(() => { location.hash = '#/settings'; });
  await page.waitForSelector('#library-backup-input', { state: 'attached' });
  await page.setInputFiles('#library-backup-input', backup);
  await answerDialog(page, true);
  await page.evaluate(() => { location.hash = '#/library'; });
  await page.waitForFunction(() => document.body.textContent.includes('Yedek kaydı · ROM yok'), null, { timeout: 5000 });
  const text = await importFile(page, batteryRom);
  assert.match(text, /Yedek kaydına bağlandı/);
  await openGame(page, 'battery test');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.detail [data-play]').length), 1);
});

await scenario('a Mega Drive .bin with a SEGA header is imported as a playable Mega Drive game', async page => {
  const text = await importFile(page, mdBin);
  assert.match(text, /Eklendi: genesis-stub\.bin/);
  await page.evaluate(() => { location.hash = '#/library'; });
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
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).fontFamily.includes('Archivo')), true, 'the bundled font is part of the app');
  await importFile(page, batteryRom);
  const state = await play(page, 'battery test');
  assert.match(state.status, /^Çalışıyor/, `offline start failed: ${state.error}`);
  await context.setOffline(false);
}, { serviceWorkers: 'allow' });

// ---- picture ---------------------------------------------------------------------------------------
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

await scenario('"Tam sayı" display mode (also the choice stored by earlier versions) makes every NES pixel exactly the same size', async page => {
  await page.evaluate(() => localStorage.setItem('retroplay-display-mode', 'integer'));
  await page.reload({ waitUntil: 'networkidle' });
  await importFile(page, checkerRom);
  await play(page, 'checkerboard');
  await page.waitForTimeout(1500);
  const { image } = await gameScreenshot(page);
  const runs = rowRuns(image, Math.floor(image.height / 2));
  assert.ok(runs.length >= 250, `all columns visible (${runs.length})`);
  assert.equal(new Set(runs).size, 1, `one pixel width only, got ${[...new Set(runs)].join('/')}`);
  assert.match(await page.evaluate(() => document.querySelector('#display-mode').textContent), /Tam sayı/);
}, { mobile: true });

await scenario('the performance meter measures the speed factor and normal play resumes afterwards', async page => {
  await importFile(page, checkerRom);
  await play(page, 'checkerboard');
  await page.waitForTimeout(1000);
  await click(page, '#perf-test');
  const text = await waitFor(() => page.evaluate(() => { const value = document.querySelector('#player-notice-text')?.textContent || ''; return /Hız payı/.test(value) ? value : null; }), { timeout: 20000, interval: 300 });
  assert.match(text || '', /Hız payı \d+,\d× \(\d+ kare\/sn\)/);
  const history = await page.evaluate(() => JSON.parse(localStorage.getItem('retroplay-performance-history') || '[]'));
  assert.equal(history.length, 1);
  assert.ok(history[0].headroom > 1, `headroom ${history[0].headroom}`);
  assert.equal(history[0].core, 'nestopia');
  const fastForward = await page.evaluate(() => document.querySelector('#player-screen iframe').contentWindow.EJS_emulator.isFastForward);
  assert.equal(Boolean(fastForward), false, 'fast-forward is off again');
  await closeGame(page);
  await page.evaluate(() => { location.hash = '#/settings'; });
  await page.waitForSelector('#perf-history');
  assert.match(await page.evaluate(() => document.querySelector('#perf-history').textContent), /checkerboard · NES\/nestopia/);
// Headless Chromium draws WebGL in software (SwiftShader), where the speed depends on the canvas size
// far more than on any device: a ~800×600 picture keeps this a test of the meter, not of the machine.
}, { viewport: { width: 1060, height: 680 } });

// ---- arcade ----------------------------------------------------------------------------------------
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
  await page.evaluate(() => { location.hash = '#/library'; });
  assert.match(await page.evaluate(() => document.querySelector('#library-games .game-card .game-foot').textContent), /Eksik set · 1 dosya eksik/);
  await openGame(page, 'Puck Man');
  assert.match(await page.evaluate(() => document.querySelector('.detail').textContent), /Eksik: pm1_prg2\.6k/);
});

await scenario('a CPS2 set no core can start without its key is explained before any core is loaded', async page => {
  let text = await importFile(page, noKeyZip);
  assert.match(text, /Super Puzzle Fighter II Turbo \(Europe 960529\) · FinalBurn Neo · CPS2 şifre anahtarı eksik: spf2t\.key/);
  await page.evaluate(() => { location.hash = '#/library'; });
  assert.match(await page.evaluate(() => document.querySelector('#library-games .game-card .game-foot').textContent), /Eksik set · CPS2 anahtarı yok/);
  // The user's record was saved by an earlier build: no "different"/"cps2Key" fields.
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
  await closeGame(page);
  text = await importFile(page, keyedZip);
  assert.match(text, /Super Puzzle Fighter II Turbo \(Europe 960529\) · FinalBurn Neo · tam set · aynı oyunun eksik eski kopyası kütüphanede/);
});

await scenario('an old CPS2 set without .key runs on FB Alpha 2012 CPS2, also when it was imported by an earlier build', async page => {
  const text = await importFile(page, oldCps2Zip);
  assert.match(text, /Eklendi: megaman2\.zip — .* · FB Alpha 2012 CPS2 · tam set/);
  // Turn the record into what an earlier build stored: FinalBurn Neo, incomplete, key missing.
  await page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('retroplay-local-v1');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => { const tx = req.result.transaction('games', 'readwrite'); const store = tx.objectStore('games'); const all = store.getAll();
      all.onsuccess = () => { for (const game of all.result) if (game.arcade) { game.arcade = { core: 'fbneo', set: 'megaman2', status: 'incomplete', missing: ['megaman2.key'], missingCount: 1, parent: '', bios: '', vertical: false, manufacturer: 'Capcom', renamedFrom: '', alternatives: [{ core: 'mame2003_plus', status: 'incomplete', set: 'megaman2' }] }; store.put(game); } };
      tx.oncomplete = () => { req.result.close(); resolve(); }; tx.onerror = () => reject(tx.error); };
  }));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => /arcade oyunu artık açılabiliyor/.test(document.querySelector('#toast')?.textContent || ''), null, { timeout: 15000 });
  await page.evaluate(() => { location.hash = '#/library'; });
  await page.waitForSelector('#library-games .game-card');
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
  await openGame(page, 'Metal Slug - Super');
  assert.match(await page.evaluate(() => document.querySelector('.detail .callout').textContent), /neogeo\.zip gerekli/);
  let state = await play(page, 'Metal Slug - Super');
  assert.match(state.status, /Başlatılamadı · neogeo\.zip gerekli/);
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('#player-screen iframe'))), false, 'nothing is loaded without the BIOS');
  assert.equal(await page.evaluate(() => document.querySelector('#player-retry').textContent), 'neogeo.zip ekle');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#player-retry')]);
  await chooser.setFiles(neogeoZip);
  await page.waitForFunction(() => { const text = document.querySelector('#player-status')?.textContent || ''; return /^Çalışıyor/.test(text) || (/Başlatılamadı/.test(text) && !/neogeo\.zip gerekli/.test(text)); }, null, { timeout: 90000 });
  state = await playerState(page);
  assert.match(state.status, /^Çalışıyor · EmulatorJS · Arcade · FinalBurn Neo/, state.error);
  const files = await page.evaluate(() => { const gm = document.querySelector('#player-screen iframe').contentWindow.EJS_emulator.gameManager; return [gm.FS.analyzePath('/mslug.zip').exists, gm.FS.analyzePath('/neogeo.zip').exists, gm.functions.saveStateInfo()]; });
  assert.deepEqual(files.slice(0, 2), [true, true]);
  assert.doesNotMatch(files[2], /^Size is zero/);
  const pad = await page.evaluate(() => [...document.querySelectorAll('#touch-controls .tc-face')].map(el => `${el.textContent}=${el.dataset.input}`));
  assert.deepEqual(pad, ['A=BUTTON_B', 'B=BUTTON_A', 'C=BUTTON_Y', 'D=BUTTON_X']);
  await closeGame(page);
  await page.evaluate(() => { location.hash = '#/settings'; });
  await page.waitForSelector('#bios-list');
  assert.match(await page.evaluate(() => document.querySelector('#bios-list').textContent), /neogeo\.zip.*kullanıma hazır/);
});

await scenario('a set only MAME 2003-Plus has is started with MAME 2003-Plus', async page => {
  const text = await importFile(page, zigzagZip);
  assert.match(text, /MAME 2003-Plus · tam set/);
  const state = await play(page, 'Zig Zag');
  assert.match(state.status, /^Çalışıyor · EmulatorJS · Arcade · MAME 2003-Plus/, state.error);
});

await scenario("a Namco System 12 set (Tekken 3) starts with RetroPlay's current MAME 2003-Plus build, also when an earlier build imported it", async page => {
  const text = await importFile(page, tekken3Zip);
  assert.match(text, /Eklendi: tekken3\.zip — Tekken 3 \(Japan, TET1\/VER\.E1\) · MAME 2003-Plus \(2026\) · tam set · dosya adı tekken3je1\.zip olarak tanındı/);
  const inFrame = () => page.evaluate(() => { const emu = document.querySelector('#player-screen iframe').contentWindow.EJS_emulator; return { zip: emu.gameManager.FS.analyzePath('/tekken3je1.zip').exists, core: emu.getCore(), kind: emu.getCore(true), state: emu.gameManager.functions.saveStateInfo() }; });
  let state = await play(page, 'Tekken 3');
  assert.match(state.status, /^Çalışıyor · EmulatorJS · Arcade · MAME 2003-Plus \(2026\)/, state.error);
  let loaded = await inFrame();
  assert.deepEqual([loaded.zip, loaded.core, loaded.kind], [true, 'mame2003_plus_next', 'mame'], 'the set under its current name, on the built core, treated as MAME');
  assert.doesNotMatch(loaded.state, /^Size is zero/, 'the game itself is loaded, not just the core');
  await closeGame(page);
  // What an earlier build stored: MAME 2003-Plus (2025), set tekken3.
  await page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('retroplay-local-v1');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => { const tx = req.result.transaction('games', 'readwrite'); const store = tx.objectStore('games'); const all = store.getAll();
      all.onsuccess = () => { for (const game of all.result) if (game.arcade) { game.arcade = { checkedWith: 'fbneo-dedd04f2+fba2012cps2-3fb5b89+mame2003p-3a72dae', core: 'mame2003_plus', set: 'tekken3', status: 'complete', missing: [], missingCount: 0, different: [], cps2Key: false, parent: '', bios: '', vertical: false, manufacturer: 'Namco', renamedFrom: '', alternatives: [] }; store.put(game); } };
      tx.oncomplete = () => { req.result.close(); resolve(); }; tx.onerror = () => reject(tx.error); };
  }));
  await page.reload({ waitUntil: 'networkidle' });
  await waitFor(async () => (await appGames(page)).find(g => g.arcade?.core === 'mame2003_plus_next'), { timeout: 15000, interval: 300 });
  const [record] = (await appGames(page)).filter(g => g.arcade);
  assert.deepEqual([record.arcade.core, record.arcade.set, record.arcade.status], ['mame2003_plus_next', 'tekken3je1', 'complete']);
  assert.deepEqual(record.arcade.alternatives, [{ core: 'mame2003_plus', status: 'complete', set: 'tekken3' }], 'the 2025 build stays as the alternative');
  assert.equal(record.hasBlob, true, 'the ROM stays');
  state = await play(page, 'Tekken 3');
  assert.match(state.status, /^Çalışıyor · EmulatorJS · Arcade · MAME 2003-Plus \(2026\)/, state.error);
  loaded = await inFrame();
  assert.deepEqual([loaded.zip, loaded.core], [true, 'mame2003_plus_next']);
});

await scenario('when Nestopia cannot open an NES file, FCEUmm is offered instead of switching silently', async page => {
  await importFile(page, mapperRom);
  const state = await play(page, 'mapper220');
  assert.match(state.status, /Nestopia bu oyunu açamadı/);
  const retry = await page.evaluate(() => { const button = document.querySelector('#player-retry'); return { hidden: button.hidden, text: button.textContent }; });
  assert.deepEqual(retry, { hidden: false, text: 'FCEUmm ile dene' });
});

// ---- touch play (phones/tablets) and controllers -------------------------------------------------
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
  const chrome = await page.evaluate(() => ({ nav: getComputedStyle(document.querySelector('.bottom-nav')).visibility, inert: document.querySelector('#app-shell').inert, desk: getComputedStyle(document.querySelector('#player-close')).display }));
  assert.deepEqual(chrome, { nav: 'visible', inert: true, desk: 'none' }, 'the app underneath is inert and the desktop bar buttons are hidden');
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
  await click(page, '#play-menu');
  await click(page, '#fullscreen-game');
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => Boolean(document.fullscreenElement)), true);
  const full = await padGeometry(page);
  assert.equal(full.orientation, 'landscape');
  assert.deepEqual([Math.round(full.dpad.x), Math.round(full.face[1].x)], [Math.round(g.dpad.x), Math.round(g.face[1].x)], 'same pad in fullscreen');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#touch-controls')).display), 'block');
  await waitStatus(page, /Çalışıyor/);
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
  await click(page, '#play-menu');
  await waitStatus(page, /^Duraklatıldı/);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#player-menu')).display), 'flex');
  await page.goBack();
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.querySelector('#player-modal').classList.contains('menu-open')), false, 'back closed the menu');
  assert.equal(await page.evaluate(() => document.querySelector('#player-modal').classList.contains('hidden')), false, 'the game is still open');
  await waitStatus(page, /^Çalışıyor/);
  await click(page, '#play-menu');
  await click(page, '#touch-settings-open');
  await page.evaluate(() => { const input = document.querySelector('#ts-scale'); input.value = '85'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await click(page, '#ts-dpad-mode button[data-value="4"]');
  await page.waitForTimeout(100);
  const live = await padGeometry(page);
  assert.ok(live.face[0].r < before.face[0].r && live.dpad.r < before.dpad.r, 'the pad changed size while the menu is open');
  assert.equal(await page.evaluate(() => document.querySelector('#ts-scale-out').textContent), '%85');
  assert.equal(await page.evaluate(() => document.querySelector('#ts-dpad-mode button[data-value="4"]').getAttribute('aria-pressed')), 'true');
  const menuBox = await page.evaluate(() => { const r = document.querySelector('#player-menu').getBoundingClientRect(); return r.bottom; });
  assert.ok(menuBox <= live.dpad.box.y + 4, 'the pad settings leave the pad in view');
  await click(page, '#ts-done');
  await waitStatus(page, /^Çalışıyor/);
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
  await click(page, '#play-pad-chip');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('retroplay-touch-settings')).hideWithGamepad), false, 'the chip brings the touch pad back');
}, { mobile: true, init: fakePad });

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
  await click(page, '#player-exit');
  await page.waitForFunction(() => document.querySelector('#player-modal').classList.contains('hidden'));
  await importFile(page, mdBin);
  state = await play(page, 'genesis stub');
  assert.match(state.status, /^Çalışıyor · EmulatorJS · Mega Drive/, state.error);
  g = await padGeometry(page);
  assert.deepEqual(g.face.map(b => b.label), ['A', 'B', 'C', 'X', 'Y', 'Z']);
  assert.ok(g.face.slice(3).every(top => top.y < Math.min(...g.face.slice(0, 3).map(b => b.y))), 'X Y Z row above A B C');
  assert.deepEqual(g.system.map(b => b.label), ['START']);
}, { mobile: true });

// ---- Faz 2: import review, slots, play time, controller menus, desktop, settings ------------------
await scenario('import shows each file before adding: playable, flagged, not supported, already chosen; only checked files are added', async page => {
  await page.evaluate(() => { location.hash = '#/import'; });
  await page.setInputFiles('#import-file-input', [batteryRom, batteryCopy, badNes, n64Rom, checkerRom]);
  await page.waitForSelector('#import-commit');
  const items = await reviewItems(page);
  const by = name => items.find(item => item.name === name);
  assert.equal(items.length, 5);
  assert.deepEqual([by('battery-test').tone, by('battery-test').selected], ['ok', true]);
  assert.match(by('battery-test').headline, /NES · Oynatılabilir dosya/);
  assert.deepEqual([by('battery-test copy').tone, by('battery-test copy').selectable], ['skip', false]);
  assert.match(by('battery-test copy').headline, /iki kez/);
  assert.deepEqual([by('broken header').tone, by('broken header').selectable], ['skip', false]);
  assert.match(by('GoldenEye 007').headline, /Nintendo 64 henüz desteklenmiyor/);
  assert.equal(await page.evaluate(() => document.querySelector('#import-commit').textContent), '2 oyunu ekle');
  // Leave the checkerboard out.
  await page.evaluate(() => [...document.querySelectorAll('#import-review .item')].find(item => item.textContent.includes('checkerboard')).querySelector('input').click());
  assert.equal(await page.evaluate(() => document.querySelector('#import-commit').textContent), '1 oyunu ekle');
  await click(page, '#import-commit');
  await page.waitForFunction(() => /Tamamlandı/.test(document.querySelector('#import-results')?.textContent || ''));
  const text = await page.evaluate(() => document.querySelector('#import-results').textContent);
  assert.match(text, /^Tamamlandı: 1 · Atlandı: 4 · Hata: 0/);
  assert.match(text, /Atlandı: checkerboard\.nes — seçilmedi/);
  const games = await appGames(page);
  assert.deepEqual(games.map(g => g.title), ['battery test']);
  assert.match(games[0].crc32, /^[0-9A-F]{8}$/, 'the CRC32 is kept for the game page');
  // A second import of the same file is recognised as already in the library.
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('Başka dosya ekle')).click());
  await page.setInputFiles('#import-file-input', batteryRom);
  await page.waitForSelector('#import-commit');
  const [again] = await reviewItems(page);
  assert.match(again.headline, /Zaten kütüphanede/);
  assert.equal(await page.evaluate(() => document.querySelector('#import-commit').disabled), true);
});

await scenario('"Klasör tara" goes through sub-folders and passes over files that are not games', async page => {
  await page.evaluate(() => { location.hash = '#/import'; });
  await page.setInputFiles('#import-folder-input', folder);
  await page.waitForSelector('#import-commit');
  const items = await reviewItems(page);
  assert.deepEqual(items.map(i => i.name).sort(), ['checkerboard', 'genesis-stub']);
  assert.match(await page.evaluate(() => document.querySelector('.review-head').textContent), /Klasör · Oyunlar[\s\S]*2 başka dosya atlandı/);
  await click(page, '#import-commit');
  await page.waitForFunction(() => /Tamamlandı: 2/.test(document.querySelector('#import-results')?.textContent || ''));
});

await scenario('save slots: the menu saves to a slot with a picture, the game page lists it and continues from it', async page => {
  await importFile(page, batteryRom);
  await play(page, 'battery test');
  await page.waitForTimeout(1500);
  await click(page, '#play-menu');
  await waitStatus(page, /^Duraklatıldı/);
  const saved = (await liveSram(page))[2];
  await click(page, '#menu-slots');
  await click(page, '[data-slot-save="2"]');
  await notice(page, /Yuva 2 kaydedildi/);
  const slot = await waitFor(async () => (await appSaveStates(page)).find(s => s.slot === '2'));
  assert.ok(slot.thumb > 0 && slot.thumbType === 'image/png', 'the slot has the picture taken when the game paused');
  await page.waitForFunction(() => document.querySelector('[data-slot="2"] img')?.naturalWidth > 0, null, { timeout: 5000 });
  // Saving again over a filled slot asks first.
  await click(page, '[data-slot-save="2"]');
  await answerDialog(page, false);
  await click(page, '#ts-done');
  await waitStatus(page, /^Çalışıyor/);
  await page.evaluate(() => document.querySelector('#player-screen iframe').contentWindow.EJS_emulator.gameManager.restart());
  await page.waitForTimeout(400);
  await closeGame(page);
  await page.waitForFunction(() => document.querySelector('.detail [data-slot="2"] img')?.naturalWidth > 0, null, { timeout: 5000 });
  // The resume point is written after the player closes (with its picture); the page follows it.
  await page.waitForFunction(() => /2 \/ 5/.test(document.querySelector('.detail .stats')?.textContent || ''), null, { timeout: 5000 });
  await click(page, '.detail [data-slot="2"]');
  await page.waitForSelector('.sheet');
  await page.evaluate(() => [...document.querySelectorAll('.sheet button')].find(b => b.textContent.includes('Bu kayıttan devam et')).click());
  await waitForPlayer(page);
  await notice(page, /Yuva 2 yüklendi/);
  await page.waitForTimeout(300);
  assert.equal((await liveSram(page))[2], saved, 'the slot\'s moment is back');
});

await scenario('a slot can be deleted from the game page', async page => {
  await importFile(page, batteryRom);
  await play(page, 'battery test');
  await page.waitForTimeout(800);
  await click(page, '#play-save');
  await notice(page, /Kaydedildi/);
  await waitFor(async () => (await appSaveStates(page)).find(s => s.slot === 'quick' && s.thumb > 0));
  await closeGame(page);
  await page.waitForSelector('.detail [data-slot="quick"]:not([disabled])');
  await click(page, '.detail [data-slot="quick"]');
  await page.evaluate(() => [...document.querySelectorAll('.sheet button')].find(b => b.textContent.includes('Kaydı sil')).click());
  await answerDialog(page, true);
  assert.ok(await waitFor(async () => !(await appSaveStates(page)).some(s => s.slot === 'quick')), 'the quick save is gone');
  assert.ok((await appSaveStates(page)).some(s => s.slot === 'auto'), 'the resume point stays');
});

await scenario('play time is counted while the game runs and shown on the game page and the home screen', async page => {
  await importFile(page, batteryRom);
  await play(page, 'battery test');
  await page.waitForTimeout(3000);
  await click(page, '#play-menu');
  await waitStatus(page, /^Duraklatıldı/);
  await page.waitForTimeout(1500); // paused time does not count
  await click(page, '#player-exit');
  await page.waitForFunction(() => document.querySelector('#player-modal').classList.contains('hidden'));
  const [game] = await waitFor(async () => { const games = await appGames(page); return games[0]?.playtimeMs ? games : null; });
  assert.ok(game.playtimeMs >= 2500 && game.playtimeMs < 4500, `about 3 s counted (${game.playtimeMs})`);
  assert.match(await page.evaluate(() => document.querySelector('.detail .stats').textContent), /1 dk'dan az[\s\S]*Bugün/);
  await page.evaluate(() => { location.hash = '#/'; });
  await page.waitForSelector('.continue');
  const hero = await page.evaluate(() => ({ title: document.querySelector('.continue .title').textContent, button: document.querySelector('.continue [data-play]').textContent, shot: document.querySelector('.continue .shot img')?.naturalWidth || 0, line: document.querySelector('.continue .sub').textContent }));
  assert.equal(hero.title, 'battery test');
  assert.match(hero.button, /Devam et/);
  assert.ok(hero.shot > 0, 'the resume point picture is shown');
  assert.match(hero.line, /Bugün oynandı · toplam 1 dk'dan az/);
});

await scenario('with a controller the interface is navigable: A plays the focused game, Select+Start opens the menu without reaching the game, B goes back', async page => {
  await importFile(page, batteryRom);
  await page.evaluate(() => { location.hash = '#/library'; });
  await page.waitForSelector('#library-games .game-card');
  const press = async index => {
    await page.evaluate(i => { window.__pad.buttons[i].pressed = true; }, index); await page.waitForTimeout(120);
    await page.evaluate(i => { window.__pad.buttons[i].pressed = false; }, index); await page.waitForTimeout(120);
  };
  await page.evaluate(() => { window.__padOn = true; window.dispatchEvent(new Event('gamepadconnected')); });
  await page.waitForTimeout(200);
  assert.match(await page.evaluate(() => document.querySelector('.pad-legend')?.textContent || ''), /A\s*Oyna[\s\S]*Y\s*Ayrıntılar/);
  // Move focus onto the card (it sits below the chips and the sort bar).
  for (let i = 0; i < 8 && !(await page.evaluate(() => document.activeElement?.classList.contains('game-card'))); i++) await press(13);
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('game-card')), true, 'the d-pad reaches the game card');
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('gp-nav')), true, 'focus is shown for controller use');
  await press(0);
  await waitForPlayer(page);
  await waitStatus(page, /^Çalışıyor/);
  await recordInputs(page);
  await page.evaluate(() => { window.__pad.buttons[8].pressed = true; });
  await page.waitForTimeout(40);
  await page.evaluate(() => { window.__pad.buttons[9].pressed = true; });
  await page.waitForTimeout(250);
  await page.evaluate(() => { window.__pad.buttons[8].pressed = false; window.__pad.buttons[9].pressed = false; });
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => document.querySelector('#player-modal').classList.contains('menu-open')), true, 'Select+Start opened the menu');
  assert.equal(await page.evaluate(() => window.__inputs.filter(([index, value]) => (index === 2 || index === 3) && value).length), 0, 'neither Select nor Start reached the game');
  await waitStatus(page, /^Duraklatıldı/);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'play-menu-close', 'the menu starts on "Oyuna dön"');
  await press(13);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'quick-save', 'down moves to the next item');
  await page.evaluate(() => { window.__inputs.length = 0; });
  await press(1);
  await waitStatus(page, /^Çalışıyor/);
  assert.equal(await page.evaluate(() => document.querySelector('#player-modal').classList.contains('menu-open')), false, 'B closed the menu');
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__inputs.filter(([index, value]) => index === 8 && value).length), 0, 'the B that closed the menu did not reach the game');
}, { init: fakePad });

await scenario('desktop: sidebar instead of the bottom bar; the game fills the window at 4:3; Esc opens and closes the menu', async page => {
  assert.deepEqual(await page.evaluate(() => [getComputedStyle(document.querySelector('.sidebar')).display, getComputedStyle(document.querySelector('.bottom-nav')).display]), ['flex', 'none']);
  await importFile(page, checkerRom);
  await play(page, 'checkerboard');
  const frame = await page.evaluate(() => { const r = document.querySelector('.player-screen-frame').getBoundingClientRect(); return { w: r.width, h: r.height, cx: r.left + r.width / 2 }; });
  assert.ok(Math.abs(frame.w / frame.h - 4 / 3) < 0.01, `4:3 picture (${frame.w}×${frame.h})`);
  assert.ok(frame.h > 600 && Math.abs(frame.cx - 640) < 2, 'large and centred');
  // A console game: its own keys under the picture, no coin button, no coin hint.
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.desk-hints .key-hint')].map(el => el.textContent.trim())), ['↑↓←→ yön', 'Z B', 'X A', 'Sağ Shift Select', 'Enter Start', 'Esc menü']);
  assert.equal(await page.evaluate(() => document.querySelector('#play-coin')), null);
  await page.keyboard.press('Escape');
  await waitStatus(page, /^Duraklatıldı/);
  assert.equal(await page.evaluate(() => document.querySelector('#player-modal').classList.contains('menu-open')), true);
  const panel = await page.evaluate(() => { const r = document.querySelector('#player-menu').getBoundingClientRect(); return [r.left, Math.round(r.height)]; });
  assert.deepEqual(panel, [0, 860], 'side panel on the left');
  // The keyboard drives the menu: Enter on "Oyuna dön" (not Start in the paused game).
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'play-menu-close');
  await page.keyboard.press('Enter');
  await waitStatus(page, /^Çalışıyor/);
  await page.keyboard.press('Escape');
  await waitStatus(page, /^Duraklatıldı/);
  await page.keyboard.press('Escape');
  await waitStatus(page, /^Çalışıyor/);
  // Fullscreen: the picture fills the screen height at 4:3 and the game is drawn (it was a black,
  // zero-height box when the bar left the grid).
  await click(page, '#bar-fullscreen');
  await page.waitForFunction(() => document.fullscreenElement?.id === 'player-modal');
  await page.waitForTimeout(800);
  const full = await page.evaluate(() => { const r = document.querySelector('.player-screen-frame').getBoundingClientRect(); const c = document.querySelector('#player-screen iframe').contentDocument.querySelector('canvas'); return { w: Math.round(r.width), h: Math.round(r.height), canvas: [c.width, c.height] }; });
  assert.deepEqual(full, { w: 1147, h: 860, canvas: [1147, 860] }, JSON.stringify(full));
  const { image } = await gameScreenshot(page);
  let lit = 0;
  for (let y = 100; y < image.height - 100; y += 37) for (let x = 100; x < image.width - 100; x += 41) if (image.luminance(x, y) > 40) lit++;
  assert.ok(lit > 50, `the game is drawn in fullscreen (${lit} lit samples)`);
  assert.equal(await page.evaluate(() => document.querySelector('#bar-fullscreen').getAttribute('aria-label')), 'Tam ekrandan çık');
  await click(page, '#bar-fullscreen');
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.waitForTimeout(500);
  assert.ok(await page.evaluate(() => document.querySelector('.player-screen-frame').getBoundingClientRect().height) > 600, 'back to the window size');
  // The emulator frame has focus after a click: Esc still reaches the app.
  await page.mouse.click(640, 430);
  await page.keyboard.press('Escape');
  await waitStatus(page, /^Duraklatıldı/);
});

// Every call the game receives, with its time, so press lengths can be checked.
const recordTimedInputs = page => page.evaluate(() => {
  const gm = document.querySelector('#player-screen iframe').contentWindow.EJS_emulator.gameManager;
  const original = gm.simulateInput.bind(gm);
  window.__timed = [];
  gm.simulateInput = (player, index, value) => { window.__timed.push([index, value, performance.now()]); return original(player, index, value); };
});
const takeTimed = page => page.evaluate(() => window.__timed.splice(0));
const pressLength = (events, index) => {
  const down = events.find(([i, v]) => i === index && v);
  const up = down && events.find(([i, v, t]) => i === index && !v && t >= down[2]);
  return up ? Math.round(up[2] - down[2]) : null;
};

await scenario('desktop arcade: Jeton and Başla in the bar and on 5 / 1; a quick press lasts long enough; EmulatorJS\'s own keys are off', async page => {
  await importFile(page, puckmanZip);
  const state = await play(page, 'Puck Man');
  assert.match(state.status, /^Çalışıyor/, state.error);
  await page.waitForFunction(() => /^Jeton: 5 · Başla: 1/.test(document.querySelector('#player-notice-text')?.textContent || ''), null, { timeout: 5000 });
  // The hint's "Jeton at" cannot act on a paused game: the menu takes it away.
  await page.keyboard.press('Escape');
  await waitStatus(page, /^Duraklatıldı/);
  assert.equal(await page.evaluate(() => document.querySelector('#player-notice').hidden), true);
  await page.keyboard.press('Escape');
  await waitStatus(page, /^Çalışıyor/);
  const bar = await page.evaluate(() => ['#play-coin', '#play-start'].map(sel => { const el = document.querySelector(sel); return el && getComputedStyle(el).display !== 'none' && !el.disabled ? el.textContent.trim() : null; }));
  assert.deepEqual(bar, ['Jeton5', 'Başla1']);
  // Pac-Man's cabinet has a joystick and no buttons: the hints say exactly that.
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.desk-hints .key-hint')].map(el => el.textContent.trim())), ['↑↓←→ joystick', '5 Jeton', '1 Başla', 'Esc menü']);
  await recordTimedInputs(page);
  for (const [key, index] of [['Digit5', 2], ['Digit1', 3], ['ShiftRight', 2], ['KeyV', 2]]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(220);
    const events = await takeTimed(page);
    const length = pressLength(events, index);
    assert.ok(length !== null && length >= 95, `${key}: held ${length} ms`);
    assert.equal(events.filter(([i, v]) => v && i !== index).length, 0, `${key} presses only its button`);
  }
  // The bar button: a real mouse click; the focus leaves it so Space/Enter keep going to the game.
  await page.click('#play-coin');
  await page.waitForTimeout(300);
  let events = await takeTimed(page);
  assert.ok(pressLength(events, 2) >= 130, `Jeton button held ${pressLength(events, 2)} ms`);
  assert.notEqual(await page.evaluate(() => document.activeElement?.id), 'play-coin');
  await page.click('#play-start');
  await page.waitForTimeout(300);
  assert.ok(pressLength(await takeTimed(page), 3) >= 130, 'Başla button');
  // Keys typed while the emulator frame has focus: EmulatorJS's own bindings (2 = load its state,
  // E = R, Tab = L2) stay silent and V inserts one coin, not two.
  await page.evaluate(() => document.querySelector('#player-screen iframe').contentWindow.focus());
  for (const key of ['Digit2', 'KeyE', 'Tab', 'KeyV']) await page.keyboard.press(key);
  await page.waitForTimeout(250);
  events = await takeTimed(page);
  assert.deepEqual(events.filter(([, v]) => v).map(([i]) => i), [2], 'only the coin');
  // A controller's Select tapped for 30 ms (under the Select+Start wait) still inserts a coin.
  await page.evaluate(() => { window.__padOn = true; window.dispatchEvent(new Event('gamepadconnected')); });
  await page.waitForTimeout(150);
  await page.evaluate(() => { window.__pad.buttons[8].pressed = true; });
  await page.waitForTimeout(30);
  await page.evaluate(() => { window.__pad.buttons[8].pressed = false; });
  await page.waitForTimeout(350);
  events = await takeTimed(page);
  assert.ok(pressLength(events, 2) >= 95, `controller Select held ${pressLength(events, 2)} ms`);
  assert.equal(await page.evaluate(() => document.querySelector('#player-modal').classList.contains('menu-open')), false, 'Select alone is not the menu');
}, { init: fakePad });

await scenario('settings: accent colour, display filter and "Çıkışta devam noktası" are kept and used', async page => {
  await page.evaluate(() => { location.hash = '#/settings'; });
  await page.waitForSelector('.swatches');
  await page.evaluate(() => document.querySelector('.swatches button[aria-label="Turkuaz"]').click());
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()), '#3DD9C1');
  await page.evaluate(() => document.querySelector('#display-filter button[data-value="lcd"]').click());
  await page.evaluate(() => document.querySelector('#setting-auto-resume').click());
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()), '#3DD9C1');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('retroplay-display'))), { scale: 'sharp', filter: 'lcd' });
  await importFile(page, batteryRom);
  await play(page, 'battery test');
  assert.match(await page.evaluate(() => document.querySelector('#display-mode').textContent), /Keskin · LCD/);
  await page.waitForTimeout(1000);
  await closeGame(page);
  await page.waitForTimeout(500);
  assert.equal((await appSaveStates(page)).some(s => s.slot === 'auto'), false, 'no resume point when turned off');
  assert.match(await page.evaluate(() => document.querySelector('.detail [data-play]').textContent), /Oyna/);
});

// The RetroPlay TV app (tv/android) as the page sees it: window.RetroPlayTV, here a stand-in.
const tvStub = () => {
  if (window !== window.top) return;
  const state = { version: 0, pads: [], inbox: [], deleted: [], keepOn: [], uploads: 0 };
  window.__tv = state;
  window.RetroPlayTV = {
    info: () => JSON.stringify({ app: 'RetroPlayTV', versionName: '1.0.9', versionCode: 9, sdk: 34, model: 'Test TV', device: 'Salon TV', address: '192.168.1.20', filePicker: false }),
    gamepadVersion: () => state.version,
    gamepads: () => JSON.stringify({ v: state.version, pads: state.pads }),
    inbox: () => JSON.stringify(state.inbox),
    inboxDelete: id => { state.deleted.push(id); state.inbox = state.inbox.filter(file => file.id !== id); return true; },
    startUpload: () => { state.uploads++; return JSON.stringify({ url: 'http://192.168.1.20:8686/?k=4821', address: '192.168.1.20:8686', port: 8686, code: '4821' }); },
    stopUpload: () => {},
    setKeepScreenOn: on => state.keepOn.push(on),
    exit: () => { state.exited = true; }
  };
};
const tvPad = pressed => ({ index: 0, id: 'Test Pad', timestamp: Date.now(), axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, b) => [pressed.includes(b) ? 1 : 0, pressed.includes(b) ? 1 : 0]) });

await scenario('TV app: files sent from a phone are imported, the remote moves the focus, Back goes back and opens the game menu, controllers come from the app', async (page, context) => {
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('tv') && document.documentElement.classList.contains('gp-nav')), true);
  // Oyun ekle opens on "Telefondan gönder": QR code, address and code; no folder or Drive.
  await page.evaluate(() => { location.hash = '#/import'; });
  await page.waitForSelector('#tv-upload svg.qr');
  assert.deepEqual(await page.evaluate(() => [document.querySelector('#tv-upload-address')?.textContent, document.querySelector('#tv-upload-code')?.textContent, Boolean(document.querySelector('#choose-folder')), Boolean(document.querySelector('#choose-drive')), Boolean(document.querySelector('#choose-files'))]), ['192.168.1.20:8686', '4821', false, false, false]);
  // A file arrives from the phone; the TV app answers /__tv/inbox/<id> (stood in for here).
  const rom = fs.readFileSync(checkerRom);
  await context.route('**/__tv/inbox/*', route => route.fulfill({ status: 200, contentType: 'application/octet-stream', body: rom }));
  await page.evaluate(size => { window.__tv.inbox = [{ id: 'ab12cd34ef', name: 'checkerboard.nes', size, time: Date.now() }]; window.RetroPlayTVHost.inboxChanged(); }, rom.length);
  await page.waitForSelector('#tv-inbox-add');
  // The remote: arrows move the focus to the add button, OK presses it.
  for (let i = 0; i < 6 && await page.evaluate(() => document.activeElement?.id) !== 'tv-inbox-add'; i++) await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'tv-inbox-add', 'the remote reached the add button');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#import-commit');
  assert.match(await page.evaluate(() => document.querySelector('#import-review').textContent), /checkerboard[\s\S]*NES · Oynatılabilir dosya/);
  await click(page, '#import-commit');
  await page.waitForFunction(() => /Tamamlandı: 1/.test(document.querySelector('#import-results')?.textContent || ''));
  assert.deepEqual(await page.evaluate(() => window.__tv.deleted), ['ab12cd34ef'], 'added files leave the inbox');
  // The app cannot save files: no download buttons or backup export, a note instead.
  await openGame(page, 'checkerboard');
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('.detail [data-export-rom], .detail [data-export-sram]'))), false, 'no download buttons on the TV');
  await page.evaluate(() => { location.hash = '#/settings'; });
  await page.waitForSelector('#tv-backup-note');
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('#export-library'))), false, 'no backup export on the TV');
  // Whatever a host puts next to the app (Netlify's preview toolbar) is not on the TV screen.
  assert.equal(await page.evaluate(() => { const el = document.createElement('div'); el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:60px;background:#fff'; document.body.append(el); const shown = el.getBoundingClientRect().height; el.remove(); return shown; }), 0);
  // Back: previous screen; on the home screen the app steps aside.
  await page.evaluate(() => { location.hash = '#/library'; });
  await page.waitForSelector('#library-games .game-card');
  assert.equal(await page.evaluate(() => window.RetroPlayTVHost.back()), true);
  await page.waitForFunction(() => location.hash === '#/settings', null, { timeout: 5000 });
  await page.evaluate(() => { location.hash = '#/'; });
  await page.waitForTimeout(200);
  // Play: full screen at once, the bar steps away, Back opens the menu and closes it again.
  await play(page, 'checkerboard');
  assert.equal(await page.evaluate(() => document.querySelector('#player-modal').classList.contains('tv')), true);
  await notice(page, /Oyun menüsü: kumandanın Geri tuşu/);
  await page.waitForFunction(() => document.querySelector('#player-modal').classList.contains('idle'), null, { timeout: 5000 });
  const frame = await page.evaluate(() => { const r = document.querySelector('.player-screen-frame').getBoundingClientRect(); return [Math.round(r.height), Math.round(innerHeight)]; });
  assert.equal(frame[0], frame[1], 'the picture fills the screen height');
  assert.ok(await page.evaluate(() => window.__tv.keepOn.at(-1) === true), 'the screen stays on while playing');
  await recordInputs(page);
  await page.evaluate(pad => { window.__tv.pads = [pad]; window.__tv.version++; }, tvPad([1]));
  await page.waitForTimeout(250);
  assert.equal(await heldInputs(page), 'A', 'right face button from the TV app = A');
  await page.evaluate(pad => { window.__tv.pads = [pad]; window.__tv.version++; }, tvPad([]));
  await page.waitForTimeout(250);
  assert.equal(await heldInputs(page), '-');
  assert.equal(await page.evaluate(() => window.RetroPlayTVHost.back()), true);
  await waitStatus(page, /^Duraklatıldı/);
  assert.equal(await page.evaluate(() => document.querySelector('#fullscreen-game')), null, 'no fullscreen item: the TV app is always full screen');
  // A notice shown while the menu is open sits beside the menu, over the picture.
  assert.ok(await page.evaluate(() => {
    const el = document.querySelector('#player-notice'); const wasHidden = el.hidden; const text = el.textContent;
    el.hidden = false; if (wasHidden) el.firstElementChild.textContent = 'Hız payı 0,6× (35 kare/sn) · Yetersiz · oyun yavaşlar';
    const notice = el.getBoundingClientRect(), menu = document.querySelector('#player-menu, .player-menu').getBoundingClientRect();
    el.hidden = wasHidden; if (wasHidden) el.firstElementChild.textContent = text;
    return notice.left >= menu.right && notice.right <= innerWidth - 48;
  }), 'the notice does not cover the menu and stays inside the TV safe area');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'quick-save', 'the remote moves in the menu');
  // The last menu item, reached with the remote, ends inside the TV safe area (27 px at the bottom).
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(400);
  assert.ok(await page.evaluate(() => document.activeElement.getBoundingClientRect().bottom <= innerHeight - 27), `the focused item ${await page.evaluate(() => document.activeElement?.id)} stays inside the safe area`);
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowDown');
  assert.ok(await page.evaluate(() => window.__tv.keepOn.at(-1) === false), 'the screen may sleep while paused');
  assert.equal(await page.evaluate(() => window.RetroPlayTVHost.back()), true);
  await waitStatus(page, /^Çalışıyor/);
}, { init: tvStub, viewport: { width: 960, height: 540 } });

await scenario('no request ever reaches cdn.emulatorjs.org', async () => {
  assert.deepEqual(cdnRequests, []);
});

await browser.close();
server.close();
fs.rmSync(tmp, { recursive: true, force: true });
const failed = results.filter(result => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} E2E scenarios passed`);
process.exit(failed.length ? 1 : 0);
