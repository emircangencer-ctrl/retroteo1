// RetroPlay browser E2E: runs the production build (dist/) with the real EmulatorJS 4.2.3 runtime.
// Usage: npm run build (repo root) → cd e2e && npm install && npx playwright install chromium && npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { startServer, newPage, importFile, play, appBatterySaves, deleteEmulatorSaveStore, waitFor, DIST } from './harness.mjs';
import { batteryTestRom, megaDriveBinStub } from './fixtures/make-roms.mjs';

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('dist/ is missing — run `npm run build` in the repository root first.');
  process.exit(2);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'retroplay-e2e-'));
const batteryRom = path.join(tmp, 'battery-test.nes');
const mdBin = path.join(tmp, 'genesis-stub.bin');
fs.writeFileSync(batteryRom, batteryTestRom());
fs.writeFileSync(mdBin, megaDriveBinStub());

const { server, base } = await startServer();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const results = [];

async function scenario(name, fn) {
  const started = Date.now();
  const { context, page, logs } = await newPage(browser, base);
  try {
    await fn(page);
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

await browser.close();
server.close();
fs.rmSync(tmp, { recursive: true, force: true });
const failed = results.filter(result => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} E2E scenarios passed`);
process.exit(failed.length ? 1 : 0);
