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


const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('the player offers fullscreen in its menu and bar, follows browser fullscreen changes and re-lays out', async () => {
  const [menu, bar, session] = await Promise.all([read('../src/player/PauseMenu.svelte'), read('../src/player/Player.svelte'), read('../src/player/session.svelte.ts')]);
  assert.match(menu, /id="fullscreen-game"[^>]*aria-pressed=\{player\.fullscreen \|\| player\.fullscreenFallback\}/);
  assert.match(menu, /Tam ekrandan çık/);
  assert.match(bar, /id="bar-fullscreen"/);
  assert.match(session, /document\.addEventListener\('fullscreenchange', onFullscreen\)/);
  assert.match(session, /document\.addEventListener\('webkitfullscreenchange', onFullscreen\)/);
  assert.match(session, /this\.fitInParent|fitInParent\?\.\(\)/);
});

test('touch devices keep the handheld layout in fullscreen; desktop fills the window with the picture', async () => {
  const styles = await read('../src/styles/player.css');
  assert.match(styles, /\.player\.touch-play \.player-screen-frame \{ position: absolute; left: var\(--scr-x\); top: var\(--scr-y\)/);
  assert.match(styles, /\.player\.touch-play #touch-controls \{ display: block; position: absolute; inset: 0; z-index: 20; touch-action: none/);
  assert.match(styles, /\.player:not\(\.touch-play\) \.player-screen-frame \{ position: relative; width: min\(100cqw, 100cqh \* 4 \/ 3\); aspect-ratio: 4 \/ 3/);
  assert.match(styles, /\.player:not\(\.touch-play\):fullscreen, \.player\.is-fallback:not\(\.touch-play\)/);
  assert.match(styles, /\.player\.hidden \{ display: none !important; \}/, 'a hidden player never covers the app, whatever layout it had');
});

test('a browser that rejects or ignores fullscreen gets the wide fallback on desktop and a short notice on phones', async () => {
  const session = await read('../src/player/session.svelte.ts');
  assert.match(session, /if \(!result\.supported\) \{[\s\S]*?if \(this\.touchPlay\) \{ this\.showNotice\('Bu tarayıcı tam ekranı desteklemiyor'\); return; \}[\s\S]*?this\.#setFallback\(true\)/);
  assert.match(session, /if \(result\.error \|\| !result\.entered\) \{[\s\S]*?Tarayıcı tam ekrana izin vermedi[\s\S]*?this\.#setFallback\(true\)/);
});

test('RetroPlay draws its own bar and menu: the emulator\'s menus stay hidden for every game', async () => {
  const [session, player] = await Promise.all([read('../src/player/session.svelte.ts'), read('../src/emulatorjs-nes-player.js')]);
  assert.match(session, /player\.setImmersive\?\.\(true\)/);
  assert.match(player, /setImmersive\(active\)/);
  assert.match(player, /postMessage\(\{source:'retroplay-app',type:'immersive',active:Boolean\(active\)\}/);
  assert.match(player, /html\.retroplay-immersive \.ejs_menu/);
});
