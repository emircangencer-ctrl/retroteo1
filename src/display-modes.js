// How the game picture is drawn. RetroArch renders at the screen's real (device-pixel) resolution;
// these modes decide how source pixels are scaled to it.
//
// sharp  – "sharp bilinear": every source pixel is scaled by the largest whole number that fits and
//          only the remaining fraction is blended at its edges, so all pixels have the same size.
// pixel  – plain nearest neighbour: hardest edges, but at non-integer scales some pixels are one
//          screen pixel wider than others.
// crt    – EmulatorJS's crt-easymode shader (scanlines and a light mask).
// integer – whole-number scaling only (black borders); applied when the game starts.

export const DISPLAY_MODE_STORAGE_KEY = 'retroplay-display-mode';
export const DEFAULT_DISPLAY_MODE = 'sharp';

export const DISPLAY_MODES = Object.freeze({
  sharp: Object.freeze({ label: 'Keskin', shader: 'retroplay-sharp', integer: false }),
  pixel: Object.freeze({ label: 'Piksel', shader: 'disabled', integer: false }),
  crt: Object.freeze({ label: 'CRT', shader: 'crt-easymode.glslp', integer: false }),
  integer: Object.freeze({ label: 'Tam sayı', shader: 'disabled', integer: true })
});

export function normalizeDisplayMode(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(DISPLAY_MODES, value) ? value : DEFAULT_DISPLAY_MODE;
}

export function nextDisplayMode(value) {
  const keys = Object.keys(DISPLAY_MODES);
  return keys[(keys.indexOf(normalizeDisplayMode(value)) + 1) % keys.length];
}

/** Settings handed to the emulator iframe when a game starts. */
export function displayStartOptions(value) {
  const mode = DISPLAY_MODES[normalizeDisplayMode(value)];
  return {
    shader: mode.shader,
    retroarchConfig: mode.integer ? { video_scale_integer: 'true', video_scale_integer_axis: '1' } : { video_scale_integer: 'false' }
  };
}

// RetroArch GLSL shader (GLSL ES 1.00 for WebGL1 cores, 3.00 for WebGL2 cores).
const SHARP_BILINEAR_GLSL = `// RetroPlay sharp bilinear: integer prescale + bilinear for the remaining fraction.
#if defined(VERTEX)
#if __VERSION__ >= 130
#define COMPAT_VARYING out
#define COMPAT_ATTRIBUTE in
#else
#define COMPAT_VARYING varying
#define COMPAT_ATTRIBUTE attribute
#endif
COMPAT_ATTRIBUTE vec4 VertexCoord;
COMPAT_ATTRIBUTE vec4 TexCoord;
COMPAT_VARYING vec4 TEX0;
uniform mat4 MVPMatrix;
void main() {
  gl_Position = MVPMatrix * VertexCoord;
  TEX0.xy = TexCoord.xy;
}
#elif defined(FRAGMENT)
#if __VERSION__ >= 130
#define COMPAT_VARYING in
#define COMPAT_TEXTURE texture
out vec4 FragColor;
#else
#define COMPAT_VARYING varying
#define FragColor gl_FragColor
#define COMPAT_TEXTURE texture2D
#endif
#ifdef GL_ES
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
#endif
uniform vec2 OutputSize;
uniform vec2 TextureSize;
uniform vec2 InputSize;
uniform sampler2D Texture;
COMPAT_VARYING vec4 TEX0;
void main() {
  vec2 texel = TEX0.xy * TextureSize;
  vec2 scale = max(floor(OutputSize / InputSize), vec2(1.0));
  vec2 texelFloored = floor(texel);
  vec2 s = fract(texel);
  vec2 regionRange = 0.5 - 0.5 / scale;
  vec2 centerDist = s - 0.5;
  vec2 f = (centerDist - clamp(centerDist, -regionRange, regionRange)) * scale + 0.5;
  FragColor = vec4(COMPAT_TEXTURE(Texture, (texelFloored + f) / TextureSize).rgb, 1.0);
}
#endif
`;

/** Extra shaders registered with EmulatorJS (EJS_shaders); its built-in CRT shaders stay available. */
export const RETROPLAY_SHADERS = Object.freeze({
  'retroplay-sharp': {
    shader: { type: 'text', value: 'shaders = 1\nshader0 = "retroplay-sharp.glsl"\nfilter_linear0 = true\nscale_type_0 = viewport\n' },
    resources: [{ name: 'retroplay-sharp.glsl', type: 'text', value: SHARP_BILINEAR_GLSL }]
  }
});
