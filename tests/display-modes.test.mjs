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
