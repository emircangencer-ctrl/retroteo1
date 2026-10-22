import test from 'node:test';
import assert from 'node:assert/strict';
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
