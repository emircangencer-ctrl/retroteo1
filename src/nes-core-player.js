import { NES, NESControllerButton } from '@nesjs/core';

const WIDTH = 256;
const HEIGHT = 240;
const PIXEL_COUNT = WIDTH * HEIGHT;
const AUDIO_SAMPLE_RATE = 44100;
const KEY_BINDINGS = Object.freeze({
  ArrowUp: 'UP',
  ArrowDown: 'DOWN',
  ArrowLeft: 'LEFT',
  ArrowRight: 'RIGHT',
  KeyZ: 'A',
  KeyX: 'B',
  ControlRight: 'SELECT',
  Enter: 'START'
});
const BUTTON_BY_NAME = Object.freeze({
  A: NESControllerButton.A,
  B: NESControllerButton.B,
  SELECT: NESControllerButton.SELECT,
  START: NESControllerButton.START,
  UP: NESControllerButton.UP,
  DOWN: NESControllerButton.DOWN,
  LEFT: NESControllerButton.LEFT,
  RIGHT: NESControllerButton.RIGHT
});
const GAMEPAD_BUTTONS = Object.freeze([
  [0, 'A'], [1, 'B'], [8, 'SELECT'], [9, 'START'],
  [12, 'UP'], [13, 'DOWN'], [14, 'LEFT'], [15, 'RIGHT']
]);

// Existing RetroPlay touch-control markup names buttons BUTTON_UP, BUTTON_A, etc.
// Keep the adapter compatible with that stable UI contract.
export function normalizeButtonName(name) {
  const normalized = String(name ?? '').replace(/^BUTTON_/, '');
  return BUTTON_BY_NAME[normalized] !== undefined ? normalized : null;
}

/**
 * Build a reusable, packed-pixel renderer for @nesjs/core 2.7.0.
 * The upstream render path clones the 61,440-byte PPU bitmap, allocates a
 * 245,760-byte RGBA array, converts every pixel, then copies it into ImageData.
 * The pinned core's TypeScript-private fields are ordinary runtime properties,
 * so reading ppu.bitmap avoids the per-frame clone without modifying emulation.
 */
export function createFastFrameRenderer(nes, imageData, onRendered, shouldRender = () => true) {
  const palette = typeof nes.getPalette === 'function' ? nes.getPalette() : nes.palette;
  const littleEndian = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 0x04;
  const packedPalette = new Uint32Array(64);
  for (let i = 0; i < packedPalette.length; i++) {
    const color = palette?.[i] ?? 0;
    const red = color >>> 16 & 0xff;
    const green = color >>> 8 & 0xff;
    const blue = color & 0xff;
    packedPalette[i] = littleEndian
      ? (0xff000000 | blue << 16 | green << 8 | red) >>> 0
      : (red << 24 | green << 16 | blue << 8 | 0xff) >>> 0;
  }

  const output = new Uint32Array(
    imageData.data.buffer,
    imageData.data.byteOffset,
    PIXEL_COUNT
  );

  return function renderFastFrame() {
    if (!shouldRender()) return;
    const ppu = nes.ppu;
    // The bitmap field is a stable internal buffer in the pinned core version.
    // Keep getBitmap() as a safe fallback if a compatible build omits it.
    const bitmap = ppu?.bitmap ?? ppu?.getBitmap?.();
    if (!bitmap || bitmap.length < PIXEL_COUNT) return;

    for (let i = 0; i < PIXEL_COUNT; i++) {
      output[i] = packedPalette[bitmap[i] & 0x3f];
    }
    onRendered(imageData);
  };
}

class BrowserNesAudioOutput {
  constructor() {
    this.context = null;
    this.node = null;
    this.samples = new Float32Array(8192);
    this.offset = 0;
    this.enabled = false;
    this.destroyed = false;
  }

  async start() {
    if (this.destroyed) throw new Error('Ses katmanı kapatılmış.');
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) throw new Error('Bu tarayıcı Web Audio API desteklemiyor.');
    if (!this.context) {
      this.context = new Context({
        sampleRate: AUDIO_SAMPLE_RATE,
        latencyHint: 'interactive'
      });
    }
    if (!this.node) {
      if (!this.context.audioWorklet || typeof AudioWorkletNode === 'undefined') {
        throw new Error('AudioWorklet desteği bulunamadı.');
      }
      await this.context.audioWorklet.addModule('/nes-audio-processor.js');
      this.node = new AudioWorkletNode(this.context, 'retroplay-audio-processor', {
        numberOfOutputs: 1,
        outputChannelCount: [2]
      });
      this.node.connect(this.context.destination);
    }
    await this.context.resume();
    this.enabled = true;
  }

  outputSample(sample) {
    if (!this.enabled || !this.node || this.destroyed) return;
    if (this.offset + 2 > this.samples.length) {
      const enlarged = new Float32Array(this.samples.length * 2);
      enlarged.set(this.samples.subarray(0, this.offset));
      this.samples = enlarged;
    }
    const normalized = Math.max(-1, Math.min(1, sample / 0x7fff));
    this.samples[this.offset++] = normalized;
    this.samples[this.offset++] = normalized;
  }

  flushFrame() {
    if (!this.enabled || !this.node || this.offset === 0 || this.destroyed) {
      this.offset = 0;
      return;
    }
    const chunk = this.samples.slice(0, this.offset);
    this.offset = 0;
    this.node.port.postMessage({ type: 'samples', buffer: chunk.buffer }, [chunk.buffer]);
  }

  async pause() {
    this.enabled = false;
    this.offset = 0;
    if (this.context && this.context.state === 'running') {
      await this.context.suspend();
    }
  }

  async resume() {
    return this.start();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.enabled = false;
    this.offset = 0;
    if (this.node) {
      try { this.node.port.close(); } catch {}
      try { this.node.disconnect(); } catch {}
      this.node = null;
    }
    if (this.context && this.context.state !== 'closed') {
      this.context.close().catch(() => {});
    }
    this.context = null;
  }
}

export class BrowserNesPlayer {
  constructor(container, { onError = () => {}, onAudioError = () => {} } = {}) {
    this.container = container;
    this.onError = onError;
    this.onAudioError = onAudioError;
    this.destroyed = false;
    this.running = false;
    this.rafId = null;
    this.lastTime = null;
    this.accumulator = 0;
    this.frameDuration = 1000 / (1789773 / 29781);
    this.frameCostAverageMs = null;
    this.renderEveryNFrames = 1;
    this.emulatedFrameCount = 0;
    this.shouldRenderFrame = true;
    this.romInfo = null;
    this.sources = {
      keyboard: new Set(),
      touch: new Set(),
      gamepad: new Set()
    };

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'nes-core-canvas';
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    this.canvas.style.imageRendering = 'pixelated';
    this.context = this.canvas.getContext('2d', { alpha: false });
    if (!this.context) throw new Error('Canvas 2D bağlamı oluşturulamadı.');
    this.imageData = this.context.createImageData(WIDTH, HEIGHT);
    container.appendChild(this.canvas);

    this.audio = new BrowserNesAudioOutput();
    this.nes = new NES(
      { audioSampleRate: AUDIO_SAMPLE_RATE, enableCheat: false },
      {
        onROMLoaded: info => { this.romInfo = info; },
        onError: error => this.onError(error)
      }
    );
    // Bypass the core's allocation-heavy renderFrame implementation. The
    // optimized path writes directly into this reusable ImageData buffer.
    this.nes.renderFrame = createFastFrameRenderer(
      this.nes,
      this.imageData,
      () => {
        if (!this.destroyed) this.context.putImageData(this.imageData, 0, 0);
      },
      () => !this.destroyed && this.shouldRenderFrame
    );
    this.nes.setAudioInterface(this.audio);

    this.handleKeyDown = event => {
      const button = KEY_BINDINGS[event.code];
      if (!button || this.destroyed) return;
      event.preventDefault();
      this.setSourceButton('keyboard', button, true);
    };
    this.handleKeyUp = event => {
      const button = KEY_BINDINGS[event.code];
      if (!button || this.destroyed) return;
      event.preventDefault();
      this.setSourceButton('keyboard', button, false);
    };
    this.handleBlur = () => {
      this.replaceSource('keyboard', new Set());
      this.replaceSource('touch', new Set());
      this.replaceSource('gamepad', new Set());
    };
    document.addEventListener('keydown', this.handleKeyDown, { passive: false });
    document.addEventListener('keyup', this.handleKeyUp, { passive: false });
    window.addEventListener('blur', this.handleBlur);

    this.fitInParent();
  }

  async loadROM(bytes) {
    if (this.destroyed) throw new Error('Oynatıcı kapatılmış.');
    await this.nes.loadROM(bytes);
    const tvType = this.nes.getTVType();
    const fps = tvType === 'PAL'
      ? 1662607 / 33252
      : tvType === 'DENDY'
        ? 1773448 / 35469
        : 1789773 / 29781;
    this.frameDuration = 1000 / fps;
    this.fitInParent();
    return this.romInfo;
  }

  async start() {
    if (this.destroyed) throw new Error('Oynatıcı kapatılmış.');
    if (this.running) return;
    try {
      await this.audio.start();
    } catch (error) {
      this.onAudioError(error);
    }
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this.tick);
  }

  async pause() {
    if (!this.running || this.destroyed) return;
    this.running = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.lastTime = null;
    this.accumulator = 0;
    await this.audio.pause();
  }

  async resume() {
    if (this.destroyed || this.running) return;
    await this.start();
  }

  pressButton(name) {
    const normalized = normalizeButtonName(name);
    if (normalized) this.setSourceButton('touch', normalized, true);
  }

  releaseButton(name) {
    const normalized = normalizeButtonName(name);
    if (normalized) this.setSourceButton('touch', normalized, false);
  }

  setSourceButton(source, name, pressed) {
    const buttons = this.sources[source];
    if (!buttons || BUTTON_BY_NAME[name] === undefined) return;
    const wasPressed = buttons.has(name);
    if (pressed) buttons.add(name);
    else buttons.delete(name);
    if (wasPressed === buttons.has(name)) return;
    const pressedByAnySource = Object.values(this.sources).some(set => set.has(name));
    this.nes.getGamepad(1).setButton(BUTTON_BY_NAME[name], pressedByAnySource ? 1 : 0);
  }

  replaceSource(source, next) {
    const current = this.sources[source];
    if (!current) return;
    const changed = new Set([...current, ...next]);
    this.sources[source] = new Set(next);
    for (const name of changed) {
      const pressedByAnySource = Object.values(this.sources).some(set => set.has(name));
      const button = BUTTON_BY_NAME[name];
      if (button !== undefined) this.nes.getGamepad(1).setButton(button, pressedByAnySource ? 1 : 0);
    }
  }

  pollGamepad() {
    if (!navigator.getGamepads) {
      this.replaceSource('gamepad', new Set());
      return;
    }
    const pads = Array.from(navigator.getGamepads() || []);
    const pad = pads.find(item => item && item.connected);
    const pressed = new Set();
    if (pad) {
      for (const [index, name] of GAMEPAD_BUTTONS) {
        const button = pad.buttons[index];
        if (button && (button.pressed || button.value > 0.5)) pressed.add(name);
      }
      const horizontal = pad.axes[0] || 0;
      const vertical = pad.axes[1] || 0;
      if (horizontal < -0.45) pressed.add('LEFT');
      if (horizontal > 0.45) pressed.add('RIGHT');
      if (vertical < -0.45) pressed.add('UP');
      if (vertical > 0.45) pressed.add('DOWN');
    }
    this.replaceSource('gamepad', pressed);
  }

  tick = now => {
    if (!this.running || this.destroyed) return;
    if (this.lastTime === null) this.lastTime = now;
    const elapsed = Math.max(0, Math.min(now - this.lastTime, 100));
    this.lastTime = now;
    this.accumulator += elapsed;

    // Gamepad state need only be sampled once per display refresh, not once
    // for every catch-up frame.
    this.pollGamepad();

    let frames = 0;
    while (this.accumulator >= this.frameDuration && frames < 4) {
      this.shouldRenderFrame =
        this.renderEveryNFrames === 1 ||
        this.emulatedFrameCount % this.renderEveryNFrames === 0;
      const frameStarted = performance.now();
      this.nes.runFrame();
      const frameCost = performance.now() - frameStarted;
      this.frameCostAverageMs = this.frameCostAverageMs === null
        ? frameCost
        : this.frameCostAverageMs * 0.9 + frameCost * 0.1;
      this.emulatedFrameCount++;
      this.accumulator -= this.frameDuration;
      frames++;

      // If CPU emulation plus presentation is using most of the frame budget,
      // skip pixel conversion/presentation on alternate frames. Emulation still
      // advances at the native rate; graphics remain fully detailed when drawn.
      // Hysteresis prevents flickering between modes on borderline devices.
      if (
        this.renderEveryNFrames === 1 &&
        this.frameCostAverageMs > this.frameDuration * 0.85
      ) {
        this.renderEveryNFrames = 2;
      } else if (
        this.renderEveryNFrames === 2 &&
        this.frameCostAverageMs < this.frameDuration * 0.62
      ) {
        this.renderEveryNFrames = 1;
      }
    }
    if (frames === 4 && this.accumulator >= this.frameDuration) {
      this.accumulator = 0;
    }
    this.rafId = requestAnimationFrame(this.tick);
  };

  fitInParent() {
    if (this.destroyed || !this.container || !this.canvas) return;
    const availableWidth = this.container.clientWidth;
    const availableHeight = Math.min(
      this.container.clientHeight || availableWidth * 0.75,
      Math.min(window.innerHeight * 0.65, 560)
    );
    if (!availableWidth || !availableHeight) return;
    const aspect = 4 / 3;
    const width = Math.floor(Math.min(availableWidth, availableHeight * aspect));
    const height = Math.floor(width / aspect);
    this.canvas.style.width = width + 'px';
    this.canvas.style.height = height + 'px';
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.running = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    document.removeEventListener('keydown', this.handleKeyDown);
    document.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    this.handleBlur();
    this.nes.getGamepad(1).reset();
    this.nes.getGamepad(2).reset();
    this.audio.destroy();
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
  }
}
