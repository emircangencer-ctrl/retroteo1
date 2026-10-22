import test from 'node:test';
import assert from 'node:assert/strict';
import { EmulatorJsNesPlayer } from '../src/emulatorjs-nes-player.js';

class FakeFrameWindow extends EventTarget {
  constructor(inputCalls) {
    super();
    this.EJS_emulator = {
      gameManager: {
        simulateInput: (...args) => inputCalls.push(args)
      },
      pause: () => {}
    };
  }
}

class FakeFrame extends EventTarget {
  constructor(inputCalls) {
    super();
    this.contentWindow = new FakeFrameWindow(inputCalls);
  }
  remove() {}
}

function keyEvent(type, code, key = code) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, {
    code: { value: code },
    key: { value: key },
    location: { value: 0 }
  });
  return event;
}

test('keyboard input is forwarded when the emulator iframe owns focus', () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const fakeDocument = new EventTarget();
  const fakeWindow = new EventTarget();
  fakeWindow.clearTimeout = () => {};
  const calls = [];
  globalThis.document = fakeDocument;
  globalThis.window = fakeWindow;

  let player;
  try {
    const container = {
      closest: () => ({ classList: { contains: () => false } })
    };
    player = new EmulatorJsNesPlayer(container);
    const frame = new FakeFrame(calls);
    player.frame = frame;
    player.started = true;

    // This is the callback wired to the iframe's load event.
    player.boundFrameLoad();

    const down = keyEvent('keydown', 'ArrowRight');
    frame.contentWindow.dispatchEvent(down);
    assert.equal(down.defaultPrevented, true);
    assert.deepEqual(calls, [[0, 7, 1]], 'right should be pressed once');

    const up = keyEvent('keyup', 'ArrowRight');
    frame.contentWindow.dispatchEvent(up);
    assert.equal(up.defaultPrevented, true);
    assert.deepEqual(calls, [[0, 7, 1], [0, 7, 0]], 'right should then be released');
  } finally {
    try { player?.destroy(); } catch {}
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
