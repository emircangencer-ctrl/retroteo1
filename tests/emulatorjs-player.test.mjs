import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { buildEmulatorDocument, EmulatorJsNesPlayer, MIN_SYSTEM_PRESS_MS } from '../src/emulatorjs-nes-player.js';

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

function keyEvent(type, code, key = code, extra = {}) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, {
    code: { value: code },
    key: { value: key },
    location: { value: 0 },
    ...Object.fromEntries(Object.entries(extra).map(([name, value]) => [name, { value }]))
  });
  let stopped = false;
  const stop = event.stopPropagation.bind(event);
  event.stopPropagation = () => { stopped = true; stop(); };
  Object.defineProperty(event, 'stopped', { get: () => stopped });
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

function makePlayer(calls, options, modalClasses = new Set()) {
  const container = {
    closest: () => ({ classList: { contains: name => modalClasses.has(name) } }),
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

test('save states are copied out of emulator memory and loaded back through the runtime', () => {
  const restore = installFakeBrowser();
  let player;
  try {
    const runtime = fakeSaveRuntime();
    const heap = new Uint8Array([0, 11, 22, 33, 0]);
    const loaded = [];
    runtime.gameManager.supportsStates = () => true;
    runtime.gameManager.getState = () => heap.subarray(1, 4);
    runtime.gameManager.loadState = state => loaded.push([...state]);
    player = playerWithRuntime(runtime);
    assert.equal(player.supportsStates(), true);
    const state = player.saveState();
    assert.deepEqual([...state], [11, 22, 33]);
    heap[1] = 99;
    assert.deepEqual([...state], [11, 22, 33], 'the state must not alias emulator memory');
    assert.equal(player.loadState(state), true);
    assert.deepEqual(loaded, [[11, 22, 33]]);
    assert.equal(player.loadState(new Uint8Array(0)), false);
    runtime.gameManager.getState = () => { throw new Error('unsupported'); };
    assert.equal(player.saveState(), null);
    player.started = false;
    assert.equal(player.supportsStates(), false);
    assert.equal(player.loadState(state), false);
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


test("the canvas fills the player and RetroArch keeps each core's own aspect ratio; Nestopia stays the NES core", () => {
  const html = buildEmulatorDocument('blob:https://retroplay.invalid/rom', 'Super Mario Bros. 3', 'nes', 8, 'nestopia');
  assert.ok(html.includes('window.EJS_core = "nestopia";'));
  assert.ok(html.includes('#ejs-player canvas{display:block!important;width:100%!important;height:100%!important'));
  assert.ok(!html.includes('aspect-ratio:4/3'), 'no fixed 4:3 box: vertical arcade games must not be squeezed');
  assert.ok(html.includes('overflow:hidden!important'));
});

test('the display mode shader is registered and applied when the game starts', () => {
  const html = buildEmulatorDocument('blob:https://retroplay.invalid/rom', 'Test ROM', 'nes', 8, 'nestopia', { shader: 'retroplay-sharp' });
  assert.ok(html.includes('window.EJS_shaders = {"retroplay-sharp"'));
  assert.ok(html.includes('emu.enableShader("retroplay-sharp")'));
  const unknown = buildEmulatorDocument('blob:https://retroplay.invalid/rom', 'Test ROM', 'nes', 8, 'nestopia', { shader: '../../evil' });
  assert.ok(unknown.includes('emu.enableShader("disabled")'), 'unknown shader names fall back to none');
});

test('the emulator menu bar never covers the game; other emulator menus are hidden in immersive mode', () => {
  const html = buildEmulatorDocument('blob:https://retroplay.invalid/rom', 'Test ROM', 'nes', 9, 'nestopia');
  assert.ok(html.includes("event.data.source !== 'retroplay-app'"));
  assert.ok(html.includes("type !== 'immersive'"));
  assert.ok(html.includes('.ejs_contextMenu,.ejs_menu_bar{display:none!important}'));
  assert.ok(html.includes('html.retroplay-immersive .ejs_menu,'));
  assert.ok(html.includes("window.addEventListener('message'"));
});


test('SMB3 compatibility fallback accepts FCEUmm while keeping NES controls', () => {
  const html = buildEmulatorDocument('blob:https://retroplay.invalid/rom', 'Super Mario Bros. 3 (U) (PRG 1) [h2]', 'nes', 11, 'fceumm');
  assert.ok(html.includes('window.EJS_core = "fceumm";'));
  assert.ok(html.includes('window.EJS_controlScheme = "nes";'));
});


test('coin and start: 5, Right Shift and Right Ctrl insert a coin; 1 and Enter start (player 1)', () => {
  const restore = installFakeBrowser();
  const calls = [];
  let player;
  try {
    player = makePlayer(calls);
    player.started = true;
    player.boundFrameLoad();
    for (const code of ['Digit5', 'ShiftRight', 'ControlRight', 'Digit1', 'Enter', 'NumpadEnter']) {
      calls.length = 0;
      player.frame.contentWindow.dispatchEvent(keyEvent('keydown', code, code, code === 'ControlRight' ? { ctrlKey: true } : {}));
      const select = ['Digit5', 'ShiftRight', 'ControlRight'].includes(code);
      assert.deepEqual(calls, [[0, select ? 2 : 3, 1]], code);
      player.releaseAllButtons();
    }
  } finally {
    try { player?.destroy(); } catch {}
    restore();
  }
});

test('keys typed in the emulator frame never reach EmulatorJS\'s own key handling', () => {
  const restore = installFakeBrowser();
  const calls = [];
  let player;
  try {
    player = makePlayer(calls);
    player.started = true;
    player.boundFrameLoad();
    // EmulatorJS binds 2 to "load state", 3 to "change slot" and E to R; RetroPlay stops them (2 is
    // player 2's Start, the others are unmapped).
    for (const code of ['Digit3', 'KeyE', 'Tab', 'Digit5', 'Digit2']) {
      const event = keyEvent('keydown', code);
      player.frame.contentWindow.dispatchEvent(event);
      assert.equal(event.stopped, true, code);
    }
    assert.deepEqual(calls, [[0, 2, 1], [1, 3, 1]], '5 is player 1\'s coin, 2 player 2\'s start; nothing else presses a button');
  } finally {
    try { player?.destroy(); } catch {}
    restore();
  }
});

test('a quick Select or Start press lasts long enough for an arcade game to see it', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let clock = 1000;
  t.mock.method(performance, 'now', () => clock);
  const restore = installFakeBrowser();
  const calls = [];
  let player;
  try {
    player = makePlayer(calls);
    player.started = true;
    player.pressButton('BUTTON_SELECT', 'gamepad');
    clock += 16; // released one frame later
    player.releaseButton('BUTTON_SELECT', 'gamepad');
    assert.deepEqual(calls, [[0, 2, 1]], 'not released yet');
    clock += MIN_SYSTEM_PRESS_MS - 16; t.mock.timers.tick(MIN_SYSTEM_PRESS_MS - 16);
    assert.deepEqual(calls, [[0, 2, 1], [0, 2, 0]], `released after ${MIN_SYSTEM_PRESS_MS} ms`);
    // A long press is released at once; other buttons are never held back.
    calls.length = 0;
    player.pressButton('BUTTON_START', 'keyboard'); clock += 300; player.releaseButton('BUTTON_START', 'keyboard');
    player.pressButton('BUTTON_B', 'keyboard'); clock += 5; player.releaseButton('BUTTON_B', 'keyboard');
    assert.deepEqual(calls, [[0, 3, 1], [0, 3, 0], [0, 0, 1], [0, 0, 0]]);
    // Pressed again while a short press is still held: it simply stays down.
    calls.length = 0;
    player.pressButton('BUTTON_SELECT', 'touch'); clock += 10; player.releaseButton('BUTTON_SELECT', 'touch');
    clock += 20; player.pressButton('BUTTON_SELECT', 'touch');
    t.mock.timers.tick(MIN_SYSTEM_PRESS_MS);
    assert.deepEqual(calls, [[0, 2, 1]]);
    player.releaseAllButtons();
    assert.deepEqual(calls, [[0, 2, 1], [0, 2, 0]]);
  } finally {
    try { player?.destroy(); } catch {}
    restore();
  }
});

test('an on-screen tap presses a button and lets go after the given time', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  const restore = installFakeBrowser();
  const calls = [];
  let player;
  try {
    player = makePlayer(calls);
    player.started = true;
    assert.equal(player.tapButton('BUTTON_SELECT', 140), true);
    assert.deepEqual(calls, [[0, 2, 1]]);
    clock += 140; t.mock.timers.tick(140);
    assert.deepEqual(calls, [[0, 2, 1], [0, 2, 0]]);
    assert.equal(player.tapButton('NOT_A_BUTTON'), false);
  } finally {
    try { player?.destroy(); } catch {}
    restore();
  }
});

test('a key always lets go of its button, even with Ctrl held by then; Right Ctrl does not block other keys', () => {
  const restore = installFakeBrowser();
  const calls = [];
  let player;
  try {
    player = makePlayer(calls);
    player.started = true;
    document.dispatchEvent(keyEvent('keydown', 'KeyK'));
    document.dispatchEvent(keyEvent('keyup', 'KeyK', 'k', { ctrlKey: true }));
    assert.deepEqual(calls, [[0, 8, 1], [0, 8, 0]]);
    calls.length = 0;
    document.dispatchEvent(keyEvent('keydown', 'ControlRight', 'Control', { ctrlKey: true }));
    document.dispatchEvent(keyEvent('keydown', 'ArrowLeft', 'ArrowLeft', { ctrlKey: true }));
    assert.deepEqual(calls, [[0, 2, 1], [0, 6, 1]], 'coin held with Right Ctrl, the joystick still moves');
    document.dispatchEvent(keyEvent('keyup', 'ArrowLeft'));
    document.dispatchEvent(keyEvent('keyup', 'ControlRight', 'Control'));
    calls.length = 0;
    document.dispatchEvent(keyEvent('keydown', 'KeyW', 'w', { ctrlKey: true }));
    assert.deepEqual(calls, [], 'Ctrl+W stays a browser shortcut when Right Ctrl is not held');
  } finally {
    try { player?.destroy(); } catch {}
    restore();
  }
});

test('while the pause menu is open the keyboard drives the menu, not the game', () => {
  const restore = installFakeBrowser();
  const calls = [];
  let player;
  try {
    player = makePlayer(calls, undefined, new Set(['menu-open']));
    player.started = true;
    const enter = keyEvent('keydown', 'Enter');
    document.dispatchEvent(enter);
    assert.equal(enter.defaultPrevented, false, 'Enter activates the focused menu item');
    assert.deepEqual(calls, []);
  } finally {
    try { player?.destroy(); } catch {}
    restore();
  }
});

test('fast forward and rewind: on and off through the runtime; rewind only when the game was started with it', () => {
  const restore = installFakeBrowser();
  const calls = [];
  let player;
  try {
    player = makePlayer(calls);
    player.started = true;
    const gm = player.frame.contentWindow.EJS_emulator.gameManager;
    const ff = [], rw = [];
    gm.toggleFastForward = value => ff.push(value);
    gm.functions = { toggleRewind: value => rw.push(value) };
    assert.equal(player.setFastForward(true), true);
    assert.equal(player.fastForward, true);
    assert.equal(player.setFastForward(false), true);
    assert.deepEqual(ff, [1, 0]);
    assert.equal(player.supportsRewind(), false);
    assert.equal(player.setRewind(true), false, 'no rewind buffer: nothing to rewind');
    player.documentOptions.retroarchConfig = { rewind_enable: 'true', rewind_granularity: '2' };
    assert.equal(player.setRewind(true), true);
    assert.equal(player.rewinding, true);
    player.setRewind(false);
    assert.deepEqual(rw, [1, 0]);
  } finally {
    try { player?.destroy(); } catch {}
    restore();
  }
});

test('Space held fast-forwards and Backspace held rewinds (as hotkeys, never game buttons); repeats are ignored', () => {
  const restore = installFakeBrowser();
  const calls = [];
  const hotkeys = [];
  let player;
  try {
    player = makePlayer(calls, { onHotkey: (key, pressed) => hotkeys.push(`${key}:${pressed}`) });
    player.started = true;
    player.boundFrameLoad();
    const win = player.frame.contentWindow;
    for (const [type, code, repeat] of [['keydown', 'Space'], ['keydown', 'Space', true], ['keyup', 'Space'], ['keydown', 'Backspace'], ['keyup', 'Backspace']]) {
      const event = keyEvent(type, code, code === 'Space' ? ' ' : code, { repeat: Boolean(repeat) });
      win.dispatchEvent(event);
      assert.equal(event.defaultPrevented, true, `${type} ${code}`);
    }
    assert.deepEqual(hotkeys, ['FastForward:true', 'FastForward:false', 'Rewind:true', 'Rewind:false']);
    assert.deepEqual(calls, [], 'no game input');
  } finally {
    try { player?.destroy(); } catch {}
    restore();
  }
});

/** A player whose core counts frames; `step()` runs one core frame and the display-frame work. */
function framedPlayer(calls, options) {
  const player = makePlayer(calls, options);
  let frame = 50;
  const ticks = [];
  player.frame.contentWindow.EJS_emulator.gameManager.getFrameNum = () => frame;
  player.latch.schedule = fn => ticks.push(fn);
  player.started = true;
  const step = (n = 1) => { for (let i = 0; i < n; i++) { frame += 1; for (const fn of ticks.splice(0)) fn(); } };
  return { player, step };
}

test('a touch tap shorter than a frame reaches the core: the release waits two core frames', () => {
  const restore = installFakeBrowser();
  const calls = [];
  let player;
  try {
    const rig = framedPlayer(calls);
    player = rig.player;
    player.pressButton('BUTTON_A', 'touch');
    player.releaseButton('BUTTON_A', 'touch');
    assert.deepEqual(calls, [[0, 8, 1]], 'down at once, up held back');
    rig.step(1);
    assert.deepEqual(calls, [[0, 8, 1]]);
    rig.step(1);
    assert.deepEqual(calls, [[0, 8, 1], [0, 8, 0]]);
    // A long press is let go at once.
    calls.length = 0;
    player.pressButton('BUTTON_B', 'touch'); rig.step(5); player.releaseButton('BUTTON_B', 'touch');
    assert.deepEqual(calls, [[0, 0, 1], [0, 0, 0]]);
  } finally {
    try { player?.destroy(); } catch {}
    restore();
  }
});

test('Seri ateş: a held turbo button fires on whole core frames, for every player', () => {
  const restore = installFakeBrowser();
  const calls = [];
  let player;
  try {
    const rig = framedPlayer(calls);
    player = rig.player;
    player.setButtonModes({ BUTTON_A: 'turbo', BUTTON_START: 'turbo', BUTTON_UP: 'hold' });
    assert.deepEqual(player.buttonModes, { BUTTON_A: 'turbo' }, 'directions, Select and Start keep their normal press');
    player.pressButton('BUTTON_A', 'touch');
    rig.step(8);
    assert.deepEqual(calls, [[0, 8, 1], [0, 8, 0], [0, 8, 1], [0, 8, 0], [0, 8, 1]]);
    player.releaseButton('BUTTON_A', 'touch');
    rig.step(4);
    assert.deepEqual(calls.at(-1), [0, 8, 0]);
    calls.length = 0;
    player.pressButton('BUTTON_A', 'gamepad', 1);
    rig.step(2);
    assert.deepEqual(calls, [[1, 8, 1], [1, 8, 0]], 'player 2 too');
    player.releaseButton('BUTTON_A', 'gamepad', 1);
  } finally {
    try { player?.destroy(); } catch {}
    restore();
  }
});

test('Basılı tut: one press holds the button, the next lets go; the menu lets go of everything', () => {
  const restore = installFakeBrowser();
  const calls = [];
  const locks = [];
  let player;
  try {
    const rig = framedPlayer(calls, { onLocks: names => locks.push(names.join('+') || '-') });
    player = rig.player;
    player.setButtonModes({ BUTTON_B: 'hold' });
    player.pressButton('BUTTON_B', 'touch'); rig.step(3); player.releaseButton('BUTTON_B', 'touch');
    rig.step(10);
    assert.deepEqual(calls, [[0, 0, 1]], 'still held after the finger left');
    assert.deepEqual(player.lockedButtons(), ['BUTTON_B']);
    player.pressButton('BUTTON_B', 'touch'); rig.step(3); player.releaseButton('BUTTON_B', 'touch');
    assert.deepEqual(calls, [[0, 0, 1], [0, 0, 0]]);
    assert.deepEqual(player.lockedButtons(), []);
    // Held again, then the menu opens: everything is let go and the pad hears about it.
    player.pressButton('BUTTON_B', 'touch'); player.releaseButton('BUTTON_B', 'touch');
    rig.step(3);
    player.releaseAllButtons();
    assert.deepEqual(calls.at(-1), [0, 0, 0]);
    assert.deepEqual(locks, ['-', 'BUTTON_B', '-', 'BUTTON_B', '-']);
    // Switching the mode off lets go of a held button.
    player.pressButton('BUTTON_B', 'touch'); player.releaseButton('BUTTON_B', 'touch');
    rig.step(3);
    player.setButtonModes({});
    rig.step(3);
    assert.deepEqual(calls.at(-1), [0, 0, 0]);
    assert.deepEqual(player.lockedButtons(), []);
  } finally {
    try { player?.destroy(); } catch {}
    restore();
  }
});
