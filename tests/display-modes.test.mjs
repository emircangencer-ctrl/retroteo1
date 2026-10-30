import test from 'node:test';
import assert from 'node:assert/strict';
import { DISPLAY_MODES, DEFAULT_DISPLAY_MODE, normalizeDisplayMode, nextDisplayMode, displayStartOptions, RETROPLAY_SHADERS } from '../src/display-modes.js';

test('sharp is the default display mode and unknown values fall back to it', () => {
  assert.equal(DEFAULT_DISPLAY_MODE, 'sharp');
  assert.equal(normalizeDisplayMode('crt'), 'crt');
  assert.equal(normalizeDisplayMode('__proto__'), 'sharp');
  assert.equal(normalizeDisplayMode(null), 'sharp');
});

test('the display button cycles through every mode', () => {
  const seen = [];
  let mode = 'sharp';
  for (let i = 0; i < 4; i++) { seen.push(mode); mode = nextDisplayMode(mode); }
  assert.deepEqual(seen, Object.keys(DISPLAY_MODES));
  assert.equal(mode, 'sharp');
});

test('integer scaling uses whole numbers on both axes; other modes turn it off', () => {
  assert.deepEqual(displayStartOptions('integer'), { shader: 'disabled', retroarchConfig: { video_scale_integer: 'true', video_scale_integer_axis: '1' } });
  assert.deepEqual(displayStartOptions('sharp'), { shader: 'retroplay-sharp', retroarchConfig: { video_scale_integer: 'false' } });
  assert.equal(displayStartOptions('crt').shader, 'crt-easymode.glslp');
});

test('the sharp shader is a complete RetroArch GLSL shader for WebGL1 and WebGL2 cores', () => {
  const preset = RETROPLAY_SHADERS['retroplay-sharp'];
  assert.match(preset.shader.value, /filter_linear0 = true/);
  const glsl = preset.resources[0].value;
  assert.match(glsl, /#if defined\(VERTEX\)/);
  assert.match(glsl, /#elif defined\(FRAGMENT\)/);
  assert.match(glsl, /__VERSION__ >= 130/);
  assert.match(glsl, /floor\(OutputSize \/ InputSize\)/);
});

import { DISPLAY_SCALES, DISPLAY_FILTERS, normalizeDisplay, displayLabel, displayShader, displayStart, loadDisplay, storeDisplay, DISPLAY_SETTINGS_KEY, DISPLAY_MODE_STORAGE_KEY } from '../src/display-modes.js';
import { buildEmulatorDocument } from '../src/emulatorjs-nes-player.js';

const memoryStorage = (initial = {}) => { const map = new Map(Object.entries(initial)); return { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), map }; };

test('Faz 2: scaling and screen filter are chosen separately; the earlier single mode still reads', () => {
  assert.deepEqual(Object.keys(DISPLAY_SCALES), ['sharp', 'pixel', 'integer']);
  assert.deepEqual(Object.keys(DISPLAY_FILTERS), ['none', 'crt', 'lcd']);
  assert.deepEqual(normalizeDisplay('crt'), { scale: 'sharp', filter: 'crt' });
  assert.deepEqual(normalizeDisplay('integer'), { scale: 'integer', filter: 'none' });
  assert.deepEqual(normalizeDisplay(null), { scale: 'sharp', filter: 'none' });
  assert.deepEqual(normalizeDisplay({ scale: 'pixel', filter: 'bogus' }), { scale: 'pixel', filter: 'none' });
  assert.equal(displayLabel({ scale: 'sharp', filter: 'lcd' }), 'Keskin · LCD');
  assert.equal(displayShader({ scale: 'pixel', filter: 'none' }), 'disabled');
  assert.equal(displayShader({ scale: 'integer', filter: 'crt' }), 'crt-easymode.glslp', 'a filter brings its own sampling');
  assert.deepEqual(displayStart({ scale: 'integer', filter: 'lcd' }), { shader: 'retroplay-lcd', retroarchConfig: { video_scale_integer: 'true', video_scale_integer_axis: '1' } });
  assert.deepEqual(displayStart({ scale: 'sharp', filter: 'none' }).retroarchConfig, { video_scale_integer: 'false' });
});

test('the display choice is stored under its own key and falls back to the earlier one', () => {
  assert.deepEqual(loadDisplay(memoryStorage({ [DISPLAY_MODE_STORAGE_KEY]: 'integer' })), { scale: 'integer', filter: 'none' });
  const storage = memoryStorage({ [DISPLAY_MODE_STORAGE_KEY]: 'integer' });
  storeDisplay({ scale: 'pixel', filter: 'crt' }, storage);
  assert.equal(storage.map.get(DISPLAY_SETTINGS_KEY), '{"scale":"pixel","filter":"crt"}');
  assert.deepEqual(loadDisplay(storage), { scale: 'pixel', filter: 'crt' });
  assert.deepEqual(loadDisplay({ getItem: () => { throw new Error('denied'); } }), { scale: 'sharp', filter: 'none' });
});

test('the LCD shader is registered with the emulator and may be chosen', () => {
  assert.ok(RETROPLAY_SHADERS['retroplay-lcd'].resources[0].value.includes('mix(0.62, 1.0, line)'));
  assert.ok(!RETROPLAY_SHADERS['retroplay-lcd'].resources[0].value.includes('FragColor = vec4(COMPAT_TEXTURE(Texture, (texelFloored + f) / TextureSize).rgb, 1.0);'), 'the grid replaced the plain output');
  const doc = buildEmulatorDocument('blob:x', 'Game', 'nes', 1, 'nestopia', { shader: 'retroplay-lcd', baseUrl: 'https://example.test/' });
  assert.match(doc, /enableShader\("retroplay-lcd"\)/);
  assert.match(buildEmulatorDocument('blob:x', 'Game', 'nes', 1, 'nestopia', { shader: 'evil.glslp', baseUrl: 'https://example.test/' }), /enableShader\("disabled"\)/);
});
