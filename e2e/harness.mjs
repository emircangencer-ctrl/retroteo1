// Shared helpers: a static server for dist/ (which now contains the self-hosted EmulatorJS 4.2.3
// runtime and cores), a browser context that refuses every request to cdn.emulatorjs.org (so a
// passing run proves the app no longer depends on the CDN), and app actions.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DIST = path.resolve(here, '..', 'dist');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain', '.wasm': 'application/wasm', '.data': 'application/octet-stream' };
export const cdnRequests = [];

export function startServer(port = 0) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let file = path.join(DIST, decodeURIComponent(url.pathname));
    if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}/` })));
}

export async function newPage(browser, base, { mobile = false, serviceWorkers = 'block', init = null } = {}) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 393, height: 873 } : { width: 1280, height: 860 },
    deviceScaleFactor: mobile ? 2.75 : 1, isMobile: mobile, hasTouch: mobile,
    serviceWorkers, acceptDownloads: true
  });
  await context.route('https://cdn.emulatorjs.org/**', route => {
    cdnRequests.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  page.on('dialog', dialog => dialog.accept());
  const logs = [];
  page.on('pageerror', error => logs.push(`pageerror: ${error.message}`));
  await page.goto(base, { waitUntil: 'networkidle' });
  return { context, page, logs };
}

export async function importFile(page, file) {
  await page.evaluate(() => document.querySelector('[data-action="add"]').click());
  await page.setInputFiles('#modal-file-input', file);
  await page.waitForFunction(() => /Tamamlandı/.test(document.querySelector('#import-results')?.textContent || ''), null, { timeout: 30000 });
  const text = await page.evaluate(() => document.querySelector('#import-results').textContent);
  await page.evaluate(() => document.querySelector('#modal-close').click());
  return text;
}

export async function play(page, titleIncludes) {
  await page.evaluate(() => document.querySelector('[data-view="library"]').click());
  const id = await page.evaluate(title => [...document.querySelectorAll('#library-games .game-card')]
    .find(card => card.querySelector('.game-title')?.textContent.includes(title))?.querySelector('[data-play]')?.dataset.play, titleIncludes);
  if (!id) throw new Error(`no playable card for ${titleIncludes}`);
  await page.evaluate(gameId => document.querySelector(`#library-games [data-play="${gameId}"]`).click(), id);
  await page.waitForFunction(() => /Çalışıyor|Başlatılamadı|engellendi|durduruldu|açamadı/.test(document.querySelector('#player-status')?.textContent || ''), null, { timeout: 90000 });
  return page.evaluate(() => ({ status: document.querySelector('#player-status').textContent, error: document.querySelector('#player-error').textContent }));
}

export function appBatterySaves(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('retroplay-local-v1');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const read = request.result.transaction('batterySaves').objectStore('batterySaves').getAll();
      read.onsuccess = () => { resolve(read.result.map(save => ({ id: save.id, byteLength: save.byteLength, bytes: Array.from(save.bytes.slice(0, 8)) }))); request.result.close(); };
      read.onerror = () => reject(read.error);
    };
  }));
}

export function deleteEmulatorSaveStore(page) {
  return page.evaluate(() => new Promise(resolve => {
    const request = indexedDB.deleteDatabase('/data/saves');
    request.onsuccess = request.onerror = request.onblocked = () => resolve(true);
  }));
}

export async function waitFor(fn, { timeout = 8000, interval = 200 } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  return last;
}

export function deleteAppSaveStates(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('retroplay-local-v1');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const tx = request.result.transaction('saveStates', 'readwrite');
      tx.objectStore('saveStates').clear();
      tx.oncomplete = () => { request.result.close(); resolve(true); };
      tx.onerror = () => reject(tx.error);
    };
  }));
}

export function appSaveStates(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('retroplay-local-v1');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const read = request.result.transaction('saveStates').objectStore('saveStates').getAll();
      read.onsuccess = () => { resolve(read.result.map(state => ({ id: state.id, slot: state.slot, coreId: state.coreId, byteLength: state.byteLength }))); request.result.close(); };
      read.onerror = () => reject(read.error);
    };
  }));
}

/** Current battery RAM of the running core (live, flushed), as a plain array. */
export function liveSram(page) {
  return page.evaluate(() => {
    const data = document.querySelector('#player-screen iframe')?.contentWindow?.EJS_emulator?.gameManager?.getSaveFile();
    return data ? Array.from(data.slice(0, 8)) : null;
  });
}

/** Records every input the player sends to the core (RetroPad index, value) inside the emulator frame. */
export function recordInputs(page) {
  return page.evaluate(() => {
    const frame = document.querySelector('#player-screen iframe').contentWindow;
    const gm = frame.EJS_emulator.gameManager;
    const original = gm.simulateInput.bind(gm);
    window.__inputs = [];
    gm.simulateInput = (player, index, value) => { window.__inputs.push([index, value]); return original(player, index, value); };
  });
}
const RETROPAD = { 0: 'B', 1: 'Y', 2: 'SELECT', 3: 'START', 4: 'UP', 5: 'DOWN', 6: 'LEFT', 7: 'RIGHT', 8: 'A', 9: 'X', 10: 'L', 11: 'R', 12: 'L2', 13: 'R2' };
/** RetroPad buttons currently held, e.g. "B+RIGHT" ("-" for none). */
export function heldInputs(page) {
  return page.evaluate(names => {
    const state = new Map();
    for (const [index, value] of window.__inputs || []) state.set(index, value);
    return [...state].filter(([, value]) => value).map(([index]) => names[index] || index).sort().join('+') || '-';
  }, RETROPAD);
}
/** Real multi-touch through the DevTools protocol (Chrome turns it into pointer events). */
export async function touchScreen(context, page) {
  const cdp = await context.newCDPSession(page);
  return async (type, points) => {
    await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id]) => ({ x, y, id, radiusX: 8, radiusY: 8, force: 1 })) });
    await page.waitForTimeout(60);
  };
}
/** Centres of the drawn pad parts in page coordinates. */
export function padGeometry(page) {
  return page.evaluate(() => {
    const centre = el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2, box: { x: r.left, y: r.top, w: r.width, h: r.height } }; };
    const dpad = document.querySelector('#touch-controls .tc-dpad');
    return {
      dpad: dpad ? centre(dpad) : null,
      face: [...document.querySelectorAll('#touch-controls .tc-face')].map(el => ({ input: el.dataset.input, label: el.textContent, ...centre(el) })),
      shoulders: [...document.querySelectorAll('#touch-controls .tc-shoulder')].map(el => ({ input: el.dataset.input, label: el.textContent, ...centre(el) })),
      system: [...document.querySelectorAll('#touch-controls .tc-system')].map(el => ({ input: el.dataset.input, label: el.textContent, ...centre(el) })),
      screen: (() => { const r = document.querySelector('.player-screen-frame').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })(),
      orientation: document.querySelector('#player-modal').dataset.orientation,
      touchPlay: document.querySelector('#player-modal').classList.contains('touch-play')
    };
  });
}
