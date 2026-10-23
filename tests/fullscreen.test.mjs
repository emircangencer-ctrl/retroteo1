import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fullscreenElement, isFullscreen, enterFullscreen, leaveFullscreen } from '../src/fullscreen.js';

test('detects standard and WebKit fullscreen elements', () => {
  const standard = { fullscreenElement: { id: 'player' } };
  assert.equal(fullscreenElement(standard).id, 'player');
  assert.equal(isFullscreen(standard), true);
  assert.equal(isFullscreen(standard, { id: 'other' }), false);
  assert.equal(fullscreenElement({ webkitFullscreenElement: { id: 'legacy' } }).id, 'legacy');
});

test('reports unsupported fullscreen APIs without throwing', async () => {
  const result = await enterFullscreen({}, {});
  assert.deepEqual(result, { supported: false, entered: false });
});

test('enters and exits standard fullscreen', async () => {
  const documentLike = { fullscreenElement: null };
  const element = {
    async requestFullscreen() {
      documentLike.fullscreenElement = element;
    }
  };
  const entered = await enterFullscreen(element, documentLike);
  assert.deepEqual(entered, { supported: true, entered: true });
  const exited = await leaveFullscreen({
    get fullscreenElement() { return documentLike.fullscreenElement; },
    async exitFullscreen() { documentLike.fullscreenElement = null; }
  });
  assert.deepEqual(exited, { supported: true, exited: true });
});

test('supports WebKit-prefixed fullscreen APIs and reports failures', async () => {
  const documentLike = { webkitFullscreenElement: null };
  const element = {
    async webkitRequestFullscreen() {
      documentLike.webkitFullscreenElement = element;
    }
  };
  assert.deepEqual(await enterFullscreen(element, documentLike), { supported: true, entered: true });
  const failed = await enterFullscreen({ requestFullscreen: async () => { throw new Error('blocked'); } }, { fullscreenElement: null });
  assert.equal(failed.supported, true);
  assert.equal(failed.entered, false);
  assert.equal(failed.error.message, 'blocked');
});


test('player UI exposes fullscreen and updates after browser fullscreen changes', async () => {
  const [html, app, styles] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
  ]);
  assert.match(html, /id="fullscreen-game"[^>]*aria-label="Oyunu tam ekran yap"/);
  assert.match(html, /id="immersive-exit"[^>]*aria-label="Tam ekrandan çık"/);
  assert.match(html, /id="fullscreen-game"[^>]*>⛶ Tam ekran<\/button>/);
  assert.match(app, /document\.addEventListener\('fullscreenchange', onChange\)/);
  assert.match(app, /activeEmulator\?\.fitInParent\?\.\(\)/);
  assert.match(app, /setFullscreenFallback\(true\)/);
  assert.match(app, /\$\('#immersive-exit'\)\?\.addEventListener\('click', toggleGameFullscreen\)/);
  assert.match(styles, /#player-modal:fullscreen \.player-header[\s\S]*?display:none!important/);
  assert.match(styles, /#player-modal:fullscreen \.touch-controls[\s\S]*?position:absolute!important/);
  assert.match(styles, /\.immersive-exit/);
  assert.match(styles, /#player-modal:fullscreen/);
  assert.match(styles, /\.player-backdrop\.is-immersive-fallback/);
});


test('fullscreen requests hide browser navigation UI when supported and rejected API uses visual fallback', async () => {
  const documentLike = { fullscreenElement: null };
  let options;
  const element = {
    async requestFullscreen(value) {
      options = value;
      documentLike.fullscreenElement = element;
    }
  };
  const entered = await enterFullscreen(element, documentLike);
  assert.equal(entered.entered, true);
  assert.deepEqual(options, { navigationUI: 'hide' });
  const [app, styles] = await Promise.all([
    readFile(new URL('../src/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
  ]);
  assert.match(app, /setFullscreenFallback\(true\);[\s\S]*?oyun alanı genişletilmiş görünümde açıldı/);
  assert.match(styles, /#player-modal:fullscreen #player-screen iframe[\s\S]*?height:\s*100%\s*!important/);
  assert.match(styles, /#player-modal:fullscreen \.touch-controls button[\s\S]*?pointer-events:\s*auto\s*!important/);
  assert.match(app, /!isSuperMarioBros3LaunchAllowed\(smb3Diagnostic\)/);
  assert.match(app, /Grafik bozulmasını önlemek için doğrulanmamış SMB3 ROM’u engellendi/);
  assert.match(app, /\$\('#player-screen'\)\.style\.display = 'none'/);
  assert.doesNotMatch(app, /const proceed = confirm\(/);
});


test('fullscreen change tells the emulator iframe to hide its own menus and restore them on exit', async () => {
  const [app, player] = await Promise.all([
    readFile(new URL('../src/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/emulatorjs-nes-player.js', import.meta.url), 'utf8')
  ]);
  assert.match(app, /setImmersive\?\.\(isFullscreen\(document, \$\('#player-modal'\)\) \|\| fullscreenFallback\)/);
  assert.match(player, /setImmersive\(active\)/);
  assert.match(player, /postMessage\(\{source:'retroplay-app',type:'immersive',active:Boolean\(active\)\}/);
});


test('fullscreen handler falls back if the API promise resolves without entering fullscreen', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /if \(result\.error \|\| !result\.entered\)/);
  assert.match(app, /result\.error[\s\S]*?Tarayıcı tam ekran geçişini doğrulamadı/);
});
