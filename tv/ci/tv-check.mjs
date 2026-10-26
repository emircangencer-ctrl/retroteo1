// Runs the built RetroPlay TV app on an Android TV emulator and checks it end to end through
// Playwright's Android support (the app's WebView is debuggable): the TV layout, the remote, the
// controller bridge, the upload page (a real HTTP upload from this machine) and the inbox, a game
// started in the TV's WebView, Back opening the game menu, and Back on the home screen.
// Usage (repo root, emulator running): node tv/ci/tv-check.mjs RetroPlayTV.apk
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { _android: android } = await import(path.join(here, '../../e2e/node_modules/playwright/index.mjs'));
const { openGame, waitForPlayer } = await import(path.join(here, '../../e2e/harness.mjs'));
const { checkerboardRom } = await import(path.join(here, '../../e2e/fixtures/make-roms.mjs'));

const apk = path.resolve(process.argv[2] || 'RetroPlayTV.apk');
const out = path.resolve('tv-ci');
fs.mkdirSync(out, { recursive: true });
const PKG = 'app.retroplay.tv';
const results = [];
const note = (ok, label, detail = '') => {
  results.push({ ok, label, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const step = async (label, fn, { critical = true } = {}) => {
  try {
    const detail = await fn();
    note(true, label, typeof detail === 'string' ? detail : '');
    return true;
  } catch (error) {
    note(false, label, String(error?.message || error).split('\n')[0]);
    if (critical) throw new Error(`stopped at: ${label}`);
    return false;
  }
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

let device;
let page;
let shot = 0;
const snap = async name => { shot++; try { await device.screenshot({ path: path.join(out, `${String(shot).padStart(2, '0')}-${name}.png`) }); } catch {} };
const key = async code => { await device.shell(`input keyevent ${code}`); await sleep(500); };

try {
  [device] = await android.devices();
  if (!device) throw new Error('no Android device');
  const release = (await device.shell('getprop ro.build.version.release')).toString().trim();
  const features = (await device.shell('pm list features')).toString();
  const webview = (await device.shell('dumpsys webviewupdate')).toString().match(/Current WebView package \(name, version\): \(([^)]*)\)/)?.[1] || 'unknown';
  note(true, 'device', `${device.model()} · Android ${release} · leanback ${/android.software.leanback\b/.test(features) ? 'yes' : 'no'} · WebView ${webview}`);

  await step('install and start', async () => {
    await device.installApk(apk);
    await device.shell(`am start -W -n ${PKG}/.MainActivity`);
    const view = await device.webView({ pkg: PKG }, { timeout: 120_000 });
    page = await view.page();
    page.setDefaultTimeout(90_000);
    await page.waitForFunction(() => document.documentElement.classList.contains('tv') && Boolean(window.RetroPlayTV) && Boolean(document.querySelector('#app-shell')), null, { timeout: 180_000 });
    const info = await page.evaluate(() => ({ ua: navigator.userAgent.match(/Chrome\/[\d.]+|RetroPlayTV\/[\d.]+/g)?.join(' '), w: innerWidth, h: innerHeight, dpr: devicePixelRatio, gl2: Boolean(document.createElement('canvas').getContext('webgl2')), app: JSON.parse(window.RetroPlayTV.info()) }));
    return `${info.ua} · ${info.w}×${info.h} CSS px @${info.dpr} · WebGL2 ${info.gl2 ? 'yes' : 'no'} · app ${info.app.versionName} · ${info.app.model} · file picker ${info.app.filePicker ? 'yes' : 'no'}`;
  });
  await sleep(1500);
  await snap('home');

  await step('nothing from other sites on the screen (no deploy-preview toolbar)', async () => {
    const found = await page.evaluate(() => [...document.querySelectorAll('body > *')].filter(el => /netlify/i.test(`${el.id} ${el.className} ${el.tagName} ${el.getAttribute('src') || ''}`)).map(el => el.tagName).join(', '));
    if (found) throw new Error(`found: ${found}`);
  }, { critical: false });

  await step('the remote moves the focus', async () => {
    const before = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 60) || '');
    await key('DPAD_DOWN');
    await key('DPAD_DOWN');
    const after = await page.evaluate(() => ({ html: document.activeElement?.outerHTML.slice(0, 60) || '', ring: getComputedStyle(document.activeElement).outlineStyle }));
    if (after.html === before || after.ring === 'none') throw new Error(`focus did not move (${after.html})`);
    return after.html.replace(/\s+/g, ' ');
  });
  await snap('focus');

  await step('a controller reaches the page through the app (gamepad key events)', async () => {
    await device.shell('input gamepad keyevent KEYCODE_BUTTON_A');
    await page.waitForFunction(() => navigator.getGamepads().some(Boolean), null, { timeout: 10_000 });
    return await page.evaluate(() => navigator.getGamepads().filter(Boolean).map(pad => `${pad.index}:${pad.id} (${pad.mapping})`).join(', '));
  }, { critical: false });

  let upload;
  await step('the upload page opens with an address and a code', async () => {
    await page.evaluate(() => { location.hash = '#/import'; });
    await page.waitForSelector('#tv-upload-code', { timeout: 20_000 });
    upload = await page.evaluate(() => ({ address: document.querySelector('#tv-upload-address').textContent, code: document.querySelector('#tv-upload-code').textContent }));
    return `${upload.address} · code ${upload.code}`;
  });
  await snap('upload');

  await step('a file uploaded over HTTP arrives in the TV inbox', async () => {
    const port = upload.address.split(':').pop();
    execFileSync('adb', ['forward', 'tcp:18686', `tcp:${port}`]);
    const page200 = await fetch('http://127.0.0.1:18686/');
    if (!page200.ok || !/TV'ye oyun gönder/.test(await page200.text())) throw new Error('upload page not served');
    const bad = await fetch('http://127.0.0.1:18686/api/status?k=0000x');
    if (bad.status !== 403) throw new Error(`wrong code accepted (${bad.status})`);
    const rom = checkerboardRom();
    const response = await fetch(`http://127.0.0.1:18686/api/upload?k=${upload.code}&name=${encodeURIComponent('checkerboard.nes')}`, { method: 'PUT', body: rom });
    const body = await response.json();
    if (!body.ok) throw new Error(JSON.stringify(body));
    await page.waitForSelector('#tv-inbox-add', { timeout: 15_000 });
    return `${body.name} · ${body.size} bytes · id ${body.id}`;
  });
  await snap('inbox');

  await step('the inbox file is read through the app and imported', async () => {
    await page.evaluate(() => document.querySelector('#tv-inbox-add').click());
    await page.waitForSelector('#import-commit', { timeout: 30_000 });
    const review = await page.evaluate(() => document.querySelector('#import-review').textContent.replace(/\s+/g, ' ').trim());
    await page.evaluate(() => document.querySelector('#import-commit').click());
    await page.waitForFunction(() => /Tamamlandı: 1/.test(document.querySelector('#import-results')?.textContent || ''), null, { timeout: 30_000 });
    const left = await page.evaluate(() => JSON.parse(window.RetroPlayTV.inbox()).length);
    if (left !== 0) throw new Error(`${left} file(s) still in the inbox`);
    return review.slice(0, 90);
  });

  await step('a game starts in the TV WebView', async () => {
    await openGame(page, 'checkerboard');
    await page.evaluate(() => document.querySelector('.detail [data-play]').click());
    const state = await waitForPlayer(page, 180_000);
    if (!/^Çalışıyor/.test(state.status)) throw new Error(`${state.status} ${state.error}`);
    await sleep(2500);
    const frame = await page.evaluate(() => { const r = document.querySelector('.player-screen-frame').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight }; });
    // The picture fills the screen height at 4:3 (it collapsed to 0×0 on WebView 101 before the fallback).
    if (frame.h < frame.vh - 2 || Math.abs(frame.w - Math.round(frame.h * 4 / 3)) > 2) throw new Error(`picture ${frame.w}×${frame.h} of ${frame.vw}×${frame.vh}`);
    return `${state.status} · picture ${frame.w}×${frame.h} of ${frame.vw}×${frame.vh}`;
  });
  await snap('playing');

  await step('performance: speed factor in the emulator (software GPU; says nothing about a real TV)', async () => {
    await page.evaluate(() => { document.querySelector('#play-menu').click(); });
    await sleep(800);
    await page.evaluate(() => document.querySelector('#perf-test').click());
    await page.waitForFunction(() => /Hız payı/.test(document.querySelector('#player-notice-text')?.textContent || ''), null, { timeout: 40_000 });
    return await page.evaluate(() => document.querySelector('#player-notice-text').textContent);
  }, { critical: false });

  await step('Back opens the game menu, Back again returns to the game', async () => {
    await sleep(1500);
    await key('BACK');
    await page.waitForFunction(() => /^Duraklatıldı/.test(document.querySelector('#player-status').textContent), null, { timeout: 10_000 });
    await snap('menu');
    await key('BACK');
    await page.waitForFunction(() => /^Çalışıyor/.test(document.querySelector('#player-status').textContent), null, { timeout: 10_000 });
  });

  await step('leaving the game saves a resume point; Back on the home screen leaves the app', async () => {
    await page.evaluate(() => document.querySelector('#play-menu').click());
    await sleep(800);
    await page.evaluate(() => document.querySelector('#player-exit').click());
    await page.waitForFunction(() => document.querySelector('#player-modal').classList.contains('hidden'), null, { timeout: 15_000 });
    await page.evaluate(() => { location.hash = '#/'; });
    await sleep(800);
    await key('BACK');
    await sleep(1500);
    const top = (await device.shell('dumpsys activity activities')).toString().match(/(?:mResumedActivity|topResumedActivity)[^\n]*/)?.[0] || '';
    if (top.includes(PKG)) throw new Error(`still in front: ${top.trim()}`);
    return top.trim().slice(0, 100);
  }, { critical: false });
  await snap('left-app');
} catch (error) {
  console.log(`stopped: ${error?.message || error}`);
} finally {
  try { execFileSync('adb', ['logcat', '-d', '-s', 'RetroPlayTV:I', 'chromium:I'], { stdio: ['ignore', fs.openSync(path.join(out, 'logcat.txt'), 'w'), 'ignore'] }); } catch {}
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  for (const r of results) console.log(`${r.ok ? '::notice' : '::error'} title=TV ${r.ok ? 'ok' : 'FAIL'}::${r.label}${r.detail ? ` — ${r.detail}` : ''}`);
  try { await device?.close(); } catch {}
  process.exit(results.some(r => !r.ok) ? 1 : 0);
}
