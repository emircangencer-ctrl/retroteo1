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
