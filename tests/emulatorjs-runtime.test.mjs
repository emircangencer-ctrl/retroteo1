import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { RETROPLAY_PATCH, PACKAGES, CORES, ALL_CORES, BUILT_CORES, FAST_CORES, PRECACHED_CORES, DATA_PATH, EJS_VERSION, ensurePinnedFiles, coreFilePaths, servedCoreDir } from '../scripts/emulatorjs-runtime.mjs';

function patchedRuntime({ cfg = 'video_vsync = true\naudio_latency = 64\n', extraCfg, extraFiles, fetchImpl } = {}) {
  const written = [];
  class EJS_GameManager { getRetroArchCfg() { return cfg; } }
  class EmulatorJS {
    constructor() { this.gameManager = { FS: { writeFile: (name, data) => written.push([name, data.length]) } }; }
    getCores() { return { arcade: ['fbneo'], mame: ['mame2003_plus', 'mame2003'], nes: ['fceumm'], snes: ['snes9x'] }; }
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
  assert.deepEqual([...PRECACHED_CORES].sort(), ['fceumm', 'picodrive', 'snes9x']);
  assert.ok(CORES.includes('fbneo') && CORES.includes('mame2003_plus') && CORES.includes('fbalpha2012_cps2'));
});

test('RetroPlay\'s own MAME 2003-Plus build is a MAME core to EmulatorJS, Snes9x 2005 Plus a SNES core', () => {
  const { EmulatorJS } = patchedRuntime();
  const cores = new EmulatorJS().getCores();
  assert.deepEqual(cores.mame, ['mame2003_plus', 'mame2003', 'mame2003_plus_next']);
  assert.deepEqual(cores.arcade, ['fbneo']);
  assert.deepEqual(new EmulatorJS().getCores().mame, ['mame2003_plus', 'mame2003', 'mame2003_plus_next'], 'added once per call, never twice');
  assert.deepEqual(cores.snes, ['snes9x', 'snes9x2005_plus']);
});

test('cores RetroPlay builds are pinned to one release of this repository by sha512', () => {
  assert.deepEqual(Object.keys(BUILT_CORES), ['mame2003_plus_next', 'snes9x2005_plus']);
  assert.deepEqual(ALL_CORES, [...CORES, 'mame2003_plus_next', 'snes9x2005_plus']);
  const core = BUILT_CORES.mame2003_plus_next;
  assert.match(core.release, /^https:\/\/github\.com\/emircangencer-ctrl\/retroteo1\/releases\/download\/core-mame2003_plus_next-64b3c38a-r\d+\/$/);
  assert.match(core.source, /libretro\/mame2003-plus-libretro\/tree\/64b3c38ac6dae0fb513e6b881fb3bfc31fca54c4$/);
  assert.deepEqual(Object.keys(core.files), ['mame2003_plus_next-wasm.data', 'mame2003_plus_next-legacy-wasm.data', 'reports/mame2003_plus_next.json']);
  for (const file of Object.values(core.files)) assert.match(file.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/, file.asset);
  assert.equal(servedCoreDir(core), 'cores/', 'served as before');
  assert.deepEqual(coreFilePaths(core), {});
});

test('the fast core builds replace every stock core but Genesis Plus GX, each from its release directory', () => {
  assert.deepEqual(Object.keys(FAST_CORES).sort(), CORES.filter(core => core !== 'genesis_plus_gx').sort());
  for (const [key, core] of [...Object.entries(FAST_CORES), ['snes9x2005_plus', BUILT_CORES.snes9x2005_plus]]) {
    assert.match(core.release, /^https:\/\/github\.com\/emircangencer-ctrl\/retroteo1\/releases\/download\/cores-fast-r\d+\/$/, key);
    assert.equal(core.release.split('/').at(-2), core.dir, `${key}: one directory per release`);
    assert.match(core.source, /^https:\/\/github\.com\/(EmulatorJS|libretro)\/[\w.-]+\/tree\/[0-9a-f]{40}$/, key);
    assert.deepEqual(Object.keys(core.files), [`${key}-wasm.data`, `${key}-legacy-wasm.data`, `reports/${key}.json`]);
    for (const file of Object.values(core.files)) assert.match(file.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/, file.asset);
    assert.deepEqual(coreFilePaths(core), {
      [`${key}-wasm.data`]: `cores/${core.dir}/${key}-wasm.data`,
      [`${key}-legacy-wasm.data`]: `cores/${core.dir}/${key}-legacy-wasm.data`,
      [`${key}.json`]: `cores/${core.dir}/reports/${key}.json`
    }, `${key}: EmulatorJS finds the files by name`);
  }
});

test('pinned downloads: fetched once, reused from the cache, refused when the contents differ', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-core-'));
  const sha = data => `sha512-${createHash('sha512').update(data).digest('base64')}`;
  const files = { 'x-wasm.data': { asset: 'r-x-wasm.data', integrity: sha('core bytes') }, 'reports/x.json': { asset: 'r-x.json', integrity: sha('{}') } };
  const contents = { 'r-x-wasm.data': 'core bytes', 'r-x.json': '{}' };
  const urls = [];
  try {
    const local = ensurePinnedFiles(dir, 'https://example.invalid/rel/', files, (url, file) => { urls.push(url); fs.writeFileSync(file, contents[url.split('/').pop()]); });
    assert.deepEqual(urls, ['https://example.invalid/rel/r-x-wasm.data', 'https://example.invalid/rel/r-x.json']);
    assert.equal(fs.readFileSync(local['x-wasm.data'], 'utf8'), 'core bytes');
    ensurePinnedFiles(dir, 'https://example.invalid/rel/', files, () => { throw new Error('downloaded again'); });
    const other = { 'y.data': { asset: 'r-y.data', integrity: sha('expected') } };
    assert.throws(() => ensurePinnedFiles(dir, 'https://example.invalid/rel/', other, (url, file) => fs.writeFileSync(file, 'tampered')), /r-y\.data integrity mismatch/);
    assert.equal(fs.existsSync(path.join(dir, 'r-y.data')) || fs.existsSync(path.join(dir, 'r-y.data.part')), false, 'nothing of it is kept');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
