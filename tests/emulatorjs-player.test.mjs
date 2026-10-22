import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { buildEmulatorDocument, EmulatorJsNesPlayer } from '../src/emulatorjs-nes-player.js';

class FakeFrameWindow extends EventTarget {
  constructor(inputCalls) {
    super();
    this.EJS_emulator = {
      gameManager: {
        simulateInput: (...args) => inputCalls.push(args)
      },
      pause: () => {},
      play: () => {}
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

function installFakeBrowser() {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const fakeDocument = new EventTarget();
  const fakeWindow = new EventTarget();
  fakeWindow.clearTimeout = () => {};
  globalThis.document = fakeDocument;
  globalThis.window = fakeWindow;
  return () => {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  };
}

function makePlayer(calls, options) {
  const container = {
    closest: () => ({ classList: { contains: () => false } }),
    replaceChildren: () => {}
  };
  const player = new EmulatorJsNesPlayer(container, options);
  player.frame = new FakeFrame(calls);
  return player;
}

test('keyboard input is forwarded when the emulator iframe owns focus', () => {
  const restore = installFakeBrowser();
  const calls = [];
  let player;
  try {
    player = makePlayer(calls);
    player.started = true;

    // This is the callback wired to the iframe's load event.
    player.boundFrameLoad();

    const down = keyEvent('keydown', 'ArrowRight');
    player.frame.contentWindow.dispatchEvent(down);
    assert.equal(down.defaultPrevented, true);
    assert.deepEqual(calls, [[0, 7, 1]], 'right should be pressed once');

    const up = keyEvent('keyup', 'ArrowRight');
    player.frame.contentWindow.dispatchEvent(up);
    assert.equal(up.defaultPrevented, true);
    assert.deepEqual(calls, [[0, 7, 1], [0, 7, 0]], 'right should then be released');
  } finally {
    try { player?.destroy(); } catch {}
    restore();
  }
});

test('a button stays pressed until every input source releases it', () => {
  const restore = installFakeBrowser();
  const calls = [];
  let player;
  try {
    player = makePlayer(calls);
    player.started = true;

    player.pressButton('BUTTON_RIGHT', 'keyboard');
    player.pressButton('BUTTON_RIGHT', 'pointer');
    player.releaseButton('BUTTON_RIGHT', 'keyboard');
    assert.deepEqual(calls, [[0, 7, 1]], 'releasing one source must not release the other source');

    player.releaseButton('BUTTON_RIGHT', 'pointer');
    assert.deepEqual(calls, [[0, 7, 1], [0, 7, 0]], 'release only after both sources are up');
  } finally {
    try { player?.destroy(); } catch {}
    restore();
  }
});

test('startup succeeds only for the player iframe and resolves on its game-start signal', () => {
  const restore = installFakeBrowser();
  const calls = [];
  let player;
  let resolved = false;
  let rejected = false;
  try {
    player = makePlayer(calls);
    player.timer = 123;
    player.resolveStart = () => { resolved = true; };
    player.rejectStart = () => { rejected = true; };

    player.handleMessage({
      source: new FakeFrameWindow(calls),
      data: { source: 'retroplay-emulatorjs', type: 'started' }
    });
    assert.equal(player.started, false, 'messages from another iframe must be ignored');
    assert.equal(resolved, false);

    player.handleMessage({
      source: player.frame.contentWindow,
      data: { source: 'retroplay-emulatorjs', type: 'started' }
    });
    assert.equal(player.started, true);
    assert.equal(resolved, true);
    assert.equal(rejected, false);
    assert.equal(player.timer, null);
  } finally {
    try { player?.destroy(); } catch {}
    restore();
  }
});

test('a runtime bootstrap error rejects pending startup and reports a readable error', () => {
  const restore = installFakeBrowser();
  const calls = [];
  const reported = [];
  const rejected = [];
  let player;
  try {
    player = makePlayer(calls, { onError: error => reported.push(error.message) });
    player.timer = 456;
    player.rejectStart = error => rejected.push(error.message);
    player.resolveStart = () => assert.fail('startup should not resolve after an error');

    player.handleMessage({
      source: player.frame.contentWindow,
      data: { source: 'retroplay-emulatorjs', type: 'error', message: 'loader failed' }
    });

    assert.deepEqual(reported, ['loader failed']);
    assert.deepEqual(rejected, ['loader failed']);
    assert.equal(player.timer, null);
    assert.equal(player.rejectStart, null);
  } finally {
    try { player?.destroy(); } catch {}
    restore();
  }
});

function invokeGameStart(emulator) {
  const messages = [];
  const fakeDocument = {
    head: { appendChild: () => {} },
    createElement: () => ({})
  };
  const context = {
    document: fakeDocument,
    parent: { postMessage: message => messages.push(message) },
    addEventListener: () => {}
  };
  context.window = context;
  const html = buildEmulatorDocument('blob:https://retroplay.invalid/rom', 'Test ROM');
  const start = html.indexOf('<script>') + '<script>'.length;
  const end = html.indexOf('</script>', start);
  runInNewContext(html.slice(start, end), context);
  if (emulator !== undefined) context.EJS_emulator = emulator;
  context.EJS_onGameStart();
  return messages;
}

test('runtime reports an error instead of false startup when controller/pause APIs are missing', () => {
  const messages = invokeGameStart(undefined);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, 'error');
  assert.match(messages[0].message, /kontrol desteği/);
  assert.match(messages[0].message, /duraklatma/);
  assert.match(messages[0].message, /devam etme/);
});

test('runtime reports started only when required controller and pause APIs exist', () => {
  const messages = invokeGameStart({
    gameManager: { simulateInput: () => {} },
    pause: () => {},
    play: () => {}
  });
  assert.deepEqual(messages, [{ source: 'retroplay-emulatorjs', type: 'started' }]);
});
