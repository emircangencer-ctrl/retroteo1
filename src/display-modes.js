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

// LCD: the sharp sampling above plus a thin dark grid between source pixels, like the screen of a
// handheld. The grid fades out when a source pixel is under 3 screen pixels (it would only darken).
const LCD_GRID_GLSL = SHARP_BILINEAR_GLSL
  .replace('// RetroPlay sharp bilinear: integer prescale + bilinear for the remaining fraction.', '// RetroPlay LCD: sharp bilinear sampling and a thin grid between source pixels.')
  .replace(
    '  FragColor = vec4(COMPAT_TEXTURE(Texture, (texelFloored + f) / TextureSize).rgb, 1.0);',
    [
      '  vec3 color = COMPAT_TEXTURE(Texture, (texelFloored + f) / TextureSize).rgb;',
      '  vec2 screenScale = OutputSize / InputSize;',
      '  vec2 edge = min(s, 1.0 - s) * screenScale;',
      '  float line = min(smoothstep(0.0, 0.9, edge.x), smoothstep(0.0, 0.9, edge.y));',
      '  float strength = clamp((min(screenScale.x, screenScale.y) - 2.0) / 2.0, 0.0, 1.0);',
      '  FragColor = vec4(color * mix(1.0, mix(0.62, 1.0, line), strength), 1.0);'
    ].join('\n')
  );

/** Extra shaders registered with EmulatorJS (EJS_shaders); its built-in CRT shaders stay available. */
export const RETROPLAY_SHADERS = Object.freeze({
  'retroplay-sharp': {
    shader: { type: 'text', value: 'shaders = 1\nshader0 = "retroplay-sharp.glsl"\nfilter_linear0 = true\nscale_type_0 = viewport\n' },
    resources: [{ name: 'retroplay-sharp.glsl', type: 'text', value: SHARP_BILINEAR_GLSL }]
  },
  'retroplay-lcd': {
    shader: { type: 'text', value: 'shaders = 1\nshader0 = "retroplay-lcd.glsl"\nfilter_linear0 = true\nscale_type_0 = viewport\n' },
    resources: [{ name: 'retroplay-lcd.glsl', type: 'text', value: LCD_GRID_GLSL }]
  }
});

// ---- Faz 2: scaling and screen filter are chosen separately ---------------------------------------
// Settings → Görüntü offers "Ölçekleme" (sharp / pixel / integer) and "Ekran filtresi" (none / CRT /
// LCD). A filter brings its own sampling, so it replaces the scaling shader; integer scaling still
// applies (it is a RetroArch setting, not a shader).

export const DISPLAY_SETTINGS_KEY = 'retroplay-display';

export const DISPLAY_SCALES = Object.freeze({
  sharp: Object.freeze({ label: 'Keskin', hint: 'Her oyun pikseli eşit büyüklükte çizilir; kenarlar çok hafif yumuşatılır. Önerilen.', shader: 'retroplay-sharp', integer: false }),
  pixel: Object.freeze({ label: 'Piksel', hint: 'En sert kenarlar; ekrana tam oturmayan ölçekte bazı pikseller bir ekran pikseli geniş olabilir.', shader: 'disabled', integer: false }),
  integer: Object.freeze({ label: 'Tam sayı', hint: 'Kusursuz eşit pikseller; kenarlarda siyah boşluk kalır. Oyun açılırken uygulanır.', shader: 'disabled', integer: true })
});

export const DISPLAY_FILTERS = Object.freeze({
  none: Object.freeze({ label: 'Yok', hint: 'Oyunun kendi görüntüsü.', shader: null }),
  crt: Object.freeze({ label: 'CRT', hint: 'Tüplü televizyon: tarama çizgileri ve hafif maske.', shader: 'crt-easymode.glslp' }),
  lcd: Object.freeze({ label: 'LCD', hint: 'El konsolu ekranı: pikseller arasında ince ızgara (büyük ekranda belirginleşir).', shader: 'retroplay-lcd' })
});

const own = (object, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(object, key);
const LEGACY = Object.freeze({ sharp: ['sharp', 'none'], pixel: ['pixel', 'none'], crt: ['sharp', 'crt'], integer: ['integer', 'none'] });

/** { scale, filter } from a stored object or from the single mode stored by earlier versions. */
export function normalizeDisplay(value) {
  if (typeof value === 'string' || value === null || value === undefined) {
    const [scale, filter] = LEGACY[normalizeDisplayMode(value)];
    return { scale, filter };
  }
  const raw = typeof value === 'object' ? value : {};
  return { scale: own(DISPLAY_SCALES, raw.scale) ? raw.scale : 'sharp', filter: own(DISPLAY_FILTERS, raw.filter) ? raw.filter : 'none' };
}

export function displayLabel(value) {
  const { scale, filter } = normalizeDisplay(value);
  return filter === 'none' ? DISPLAY_SCALES[scale].label : `${DISPLAY_SCALES[scale].label} · ${DISPLAY_FILTERS[filter].label}`;
}

export function displayShader(value) {
  const { scale, filter } = normalizeDisplay(value);
  return DISPLAY_FILTERS[filter].shader || DISPLAY_SCALES[scale].shader;
}

/** Settings handed to the emulator when a game starts. */
export function displayStart(value) {
  const { scale } = normalizeDisplay(value);
  return {
    shader: displayShader(value),
    retroarchConfig: DISPLAY_SCALES[scale].integer ? { video_scale_integer: 'true', video_scale_integer_axis: '1' } : { video_scale_integer: 'false' }
  };
}

/** Reads the display choice: the Faz 2 key first, then the single mode of earlier versions. */
export function loadDisplay(storage = globalThis.localStorage) {
  try {
    const stored = storage?.getItem(DISPLAY_SETTINGS_KEY);
    if (stored) return normalizeDisplay(JSON.parse(stored));
    return normalizeDisplay(storage?.getItem(DISPLAY_MODE_STORAGE_KEY));
  } catch {
    return normalizeDisplay(null);
  }
}

export function storeDisplay(value, storage = globalThis.localStorage) {
  const display = normalizeDisplay(value);
  try { storage?.setItem(DISPLAY_SETTINGS_KEY, JSON.stringify(display)); } catch {}
  return display;
}
