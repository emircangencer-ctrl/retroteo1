import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { RETROPLAY_PATCH, PACKAGES, CORES, PRECACHED_CORES, DATA_PATH, EJS_VERSION } from '../scripts/emulatorjs-runtime.mjs';

function patchedRuntime({ cfg = 'video_vsync = true\naudio_latency = 64\n', extraCfg, extraFiles, fetchImpl } = {}) {
  const written = [];
  class EJS_GameManager { getRetroArchCfg() { return cfg; } }
  class EmulatorJS {
    constructor() { this.gameManager = { FS: { writeFile: (name, data) => written.push([name, data.length]) } }; }
    downloadRom() { written.push(['rom', 0]); return Promise.resolve('rom-loaded'); }
  }
  const window = { EJS_GameManager, EmulatorJS, RETROPLAY_RETROARCH_CFG: extraCfg, RETROPLAY_EXTRA_FILES: extraFiles };
  runInNewContext(RETROPLAY_PATCH, { window, fetch: fetchImpl || (async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) })), Promise, Object, Array, String, Uint8Array, Error });
  return { window, written, EJS_GameManager, EmulatorJS };
}

test('the runtime patch appends or replaces retroarch.cfg keys and ignores unsafe ones', () => {
  const { EJS_GameManager } = patchedRuntime({ extraCfg: { audio_latency: 48, video_scale_integer: true, 'bad key': 'x', run_ahead_frames: '1"\nmalicious = 1' } });
  const cfg = new EJS_GameManager().getRetroArchCfg();
  assert.match(cfg, /^video_vsync = true$/m);
  assert.doesNotMatch(cfg, /^audio_latency = 64$/m, 'the default value is replaced, not duplicated');
  assert.match(cfg, /^audio_latency = "48"$/m);
  assert.match(cfg, /^video_scale_integer = "true"$/m);
  assert.doesNotMatch(cfg, /bad key|^malicious/m, "a value cannot start a new cfg line");
  assert.equal(cfg.split('\n').filter(line => line.startsWith('run_ahead_frames')).length, 1);
});

test('the runtime patch leaves retroarch.cfg untouched without extra settings', () => {
  const { EJS_GameManager } = patchedRuntime();
  assert.equal(new EJS_GameManager().getRetroArchCfg(), 'video_vsync = true\naudio_latency = 64\n');
});

test('extra files (a BIOS zip) are written to the content directory before the game loads', async () => {
  const { EmulatorJS, written } = patchedRuntime({ extraFiles: [{ name: 'neogeo.zip', url: 'blob:x' }, { name: '../evil', url: 'blob:y' }] });
  assert.equal(await new EmulatorJS().downloadRom(), 'rom-loaded');
  assert.deepEqual(written, [['/neogeo.zip', 4], ['rom', 0]]);
});

test('a BIOS that cannot be read stops the start with a clear error', async () => {
  const { EmulatorJS } = patchedRuntime({ extraFiles: [{ name: 'neogeo.zip', url: 'blob:x' }], fetchImpl: async () => ({ ok: false }) });
  await assert.rejects(new EmulatorJS().downloadRom(), /neogeo\.zip/);
});

test('every shipped core and the runtime are pinned to 4.2.3 with sha512 integrity', () => {
  assert.equal(EJS_VERSION, '4.2.3');
  assert.equal(DATA_PATH, '/emulatorjs/4.2.3/data/');
  for (const key of ['emulatorjs', ...CORES]) assert.match(PACKAGES[key]?.integrity || '', /^sha512-[A-Za-z0-9+/]{86}==$/, key);
  assert.deepEqual([...PRECACHED_CORES].sort(), ['genesis_plus_gx', 'nestopia', 'snes9x']);
  assert.ok(CORES.includes('fbneo') && CORES.includes('mame2003_plus'));
});
