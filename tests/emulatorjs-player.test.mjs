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

test('NES supports the explicit Nestopia core without changing its NES control scheme', () => {
  const html = buildEmulatorDocument('blob:https://retroplay.invalid/rom', 'Super Mario Bros. 3', 'nes', 7, 'nestopia');
  assert.ok(html.includes('window.EJS_core = "nestopia";'));
  assert.ok(html.includes('window.EJS_controlScheme = "nes";'));
  assert.throws(() => buildEmulatorDocument('blob:https://retroplay.invalid/rom', 'Invalid', 'nes', 7, 'snes'), /Unsupported EmulatorJS core/);
});

test('gamepad mapping remains accessible and uses the active console control scheme', () => {
  const systems = [
    ['nes', 'nes'],
    ['snes', 'snes'],
    ['segaMD', 'segaMD']
  ];
  for (const [systemId, controlScheme] of systems) {
    const html = buildEmulatorDocument(
      'blob:https://retroplay.invalid/rom',
      'Test ROM',
      systemId
    );
    assert.ok(
      html.includes(`window.EJS_controlScheme = "${controlScheme}";`),
      `${systemId} should select its own EmulatorJS control scheme`
    );
    assert.ok(html.includes("window.EJS_language = 'tr-TR';"));
    assert.ok(
      html.includes('"gamepad":true'),
      'the gamepad-mapping button must be visible'
    );
    assert.ok(
      !html.includes('.ejs_menu_bar,.ejs_menu,'),
      'the runtime toolbar containing controller settings must not be hidden'
    );
  }
});

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
  assert.equal(messages.length, 1);
  assert.equal(messages[0].source, 'retroplay-emulatorjs');
  assert.equal(messages[0].type, 'started');
});


function fakeSaveRuntime(initialFiles = {}) {
  const files = new Map(Object.entries(initialFiles));
  const dirs = new Set(['/data', '/data/saves']);
  const calls = [];
  const FS = {
    analyzePath: path => ({ exists: files.has(path) || dirs.has(path) }),
    mkdir: path => { calls.push(['mkdir', path]); dirs.add(path); },
    unlink: path => { calls.push(['unlink', path]); files.delete(path); },
    writeFile: (path, data) => { calls.push(['writeFile', path]); files.set(path, new Uint8Array(data)); },
    readFile: path => files.get(path)
  };
  const gameManager = {
    FS,
    simulateInput: () => {},
    getSaveFilePath: () => '/data/saves/Nestopia/Test.srm',
    saveSaveFiles: () => { calls.push(['saveSaveFiles']); if (gameManager.liveSram) files.set('/data/saves/Nestopia/Test.srm', new Uint8Array(gameManager.liveSram)); },
    loadSaveFiles: () => calls.push(['loadSaveFiles']),
    restart: () => calls.push(['restart']),
    liveSram: null
  };
  return { files, calls, gameManager };
}

function playerWithRuntime(runtime, options) {
  const player = makePlayer([], options);
  player.frame.contentWindow.EJS_emulator.gameManager = runtime.gameManager;
  player.started = true;
  return player;
}

test('battery saves are copied out of the core, flushing live SRAM first when asked', () => {
  const restore = installFakeBrowser();
  let player;
  try {
    const runtime = fakeSaveRuntime({ '/data/saves/Nestopia/Test.srm': new Uint8Array([1, 2, 3]) });
    player = playerWithRuntime(runtime);
    const loaded = player.readSaveData({ flush: false });
    assert.deepEqual([...loaded], [1, 2, 3]);
    assert.equal(runtime.calls.some(call => call[0] === 'saveSaveFiles'), false, 'flush:false must not overwrite the loaded file');

    runtime.gameManager.liveSram = new Uint8Array([7, 7]);
    const live = player.readSaveData();
    assert.deepEqual([...live], [7, 7]);
    live[0] = 99;
    assert.deepEqual([...runtime.files.get('/data/saves/Nestopia/Test.srm')], [7, 7], 'the returned bytes are a copy');
  } finally {
    try { player?.destroy(); } catch {}
    restore();
  }
});

test('reading saves returns null before start, after destroy, or when the core has no SRAM file', () => {
  const restore = installFakeBrowser();
  let player;
  try {
    const runtime = fakeSaveRuntime();
    player = playerWithRuntime(runtime);
    assert.equal(player.readSaveData({ flush: false }), null);
    player.started = false;
    runtime.files.set('/data/saves/Nestopia/Test.srm', new Uint8Array([5]));
    assert.equal(player.readSaveData(), null);
  } finally {
    try { player?.destroy(); } catch {}
    restore();
  }
  assert.equal(player.readSaveData(), null);
});

test('a host-owned save is written into the core file system and reloaded, then the game soft-resets', () => {
  const restore = installFakeBrowser();
  let player;
  try {
    const runtime = fakeSaveRuntime({ '/data/saves/Nestopia/Test.srm': new Uint8Array([0]) });
    runtime.gameManager.FS.analyzePath = path => ({ exists: runtime.files.has(path) || path === '/data' || path === '/data/saves' });
    player = playerWithRuntime(runtime);
    assert.equal(player.writeSaveData(new Uint8Array([4, 5, 6])), true);
    assert.deepEqual([...runtime.files.get('/data/saves/Nestopia/Test.srm')], [4, 5, 6]);
    assert.deepEqual(runtime.calls.map(call => call[0]), ['mkdir', 'unlink', 'writeFile', 'loadSaveFiles']);
    assert.equal(player.restartGame(), true);
    assert.equal(runtime.calls.at(-1)[0], 'restart');
    assert.equal(player.writeSaveData(new Uint8Array(0)), false, 'empty data is never written');
  } finally {
    try { player?.destroy(); } catch {}
    restore();
  }
});

test('runtime warnings are reported without failing a running session', () => {
  const restore = installFakeBrowser();
  const warnings = [];
  const errors = [];
  let player;
  try {
    player = makePlayer([], { onWarning: message => warnings.push(message), onError: error => errors.push(error.message) });
    player.started = true;
    player.handleMessage({ source: new FakeFrameWindow([]), data: { source: 'retroplay-emulatorjs', type: 'warning', message: 'foreign' } });
    player.handleMessage({ source: player.frame.contentWindow, data: { source: 'retroplay-emulatorjs', type: 'warning', message: 'Wake Lock permission request denied' } });
    assert.deepEqual(warnings, ['Wake Lock permission request denied']);
    assert.deepEqual(errors, []);
    assert.equal(player.started, true);
  } finally {
    try { player?.destroy(); } catch {}
    restore();
  }
});

test('the emulator iframe may request a screen wake lock', () => {
  const restore = installFakeBrowser();
  let frame = null;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  try {
    globalThis.document.createElement = () => {
      frame = { setAttribute(name, value) { this[name] = value; }, style: {}, addEventListener() {}, removeEventListener() {}, remove() {} };
      return frame;
    };
    globalThis.window.setTimeout = () => 1;
    URL.createObjectURL = () => 'blob:rom';
    URL.revokeObjectURL = () => {};
    const player = new EmulatorJsNesPlayer({ closest: () => null, replaceChildren: () => {} });
    player.loadROM(new Uint8Array([1])).catch(() => {});
    assert.match(frame.allow, /screen-wake-lock/);
    assert.match(frame.allow, /gamepad/);
    player.destroy();
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    restore();
  }
});


test('EmulatorJS canvas scales to the largest centered 4:3 area and keeps Nestopia selected for NES', () => {
  const html = buildEmulatorDocument('blob:https://retroplay.invalid/rom', 'Super Mario Bros. 3', 'nes', 8, 'nestopia');
  assert.ok(html.includes('window.EJS_core = "nestopia";'));
  assert.ok(html.includes('aspect-ratio:4/3!important'));
  assert.ok(html.includes('object-fit:fill!important'));
  assert.ok(html.includes('133.333dvh'));
  assert.ok(html.includes('75dvw'));
  assert.ok(html.includes('overflow:hidden!important'));
});


test('immersive mode hides the emulator-owned menu only when the parent requests it', () => {
  const html = buildEmulatorDocument('blob:https://retroplay.invalid/rom', 'Test ROM', 'nes', 9, 'nestopia');
  assert.ok(html.includes("event.data.source !== 'retroplay-app'"));
  assert.ok(html.includes("type !== 'immersive'"));
  assert.ok(html.includes('html.retroplay-immersive .ejs_menu_bar'));
  assert.ok(html.includes("window.addEventListener('message'"));
});


test('SMB3 compatibility fallback accepts FCEUmm while keeping NES controls', () => {
  const html = buildEmulatorDocument('blob:https://retroplay.invalid/rom', 'Super Mario Bros. 3 (U) (PRG 1) [h2]', 'nes', 11, 'fceumm');
  assert.ok(html.includes('window.EJS_core = "fceumm";'));
  assert.ok(html.includes('window.EJS_controlScheme = "nes";'));
});
