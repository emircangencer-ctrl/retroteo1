// Builds the self-hosted EmulatorJS runtime that RetroPlay serves from its own origin.
//
// The EmulatorJS npm packages cannot be installed as normal dependencies: the runtime package
// pulls every core of every system through an optional dependency (~300 MB), and each core
// package depends on the runtime again. Instead the exact tarballs are fetched with `npm pack`,
// verified against pinned sha512 integrity values and unpacked into a cache directory.
//
// Output (under <outDir>/emulatorjs/<version>/data/):
//   loader.js, compression/*, localization/*, src/*       – unmodified EmulatorJS 4.2.3 files
//   emulator.min.<hash>.js / emulator.min.<hash>.css       – the runtime bundle with RetroPlay's patch
//   cores/<core>-legacy-wasm.data, cores/<core>-wasm.data  – WebGL1 and WebGL2 builds of each core
//   cores/reports/<core>.json                              – build reports (EmulatorJS uses them to cache cores)
//   cores/mame2003_plus_next-*                              – RetroPlay's own MAME 2003-Plus build (BUILT_CORES)
//   cores/cores-fast-r<n>/…                                 – RetroPlay's faster builds of the stock cores
//                                                             (FAST_CORES) and Snes9x 2005 Plus, with reports
// plus <outDir>/emulatorjs/runtime-manifest.json for the service worker.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { transform } from 'esbuild';

export const EJS_VERSION = '4.2.3';
export const DATA_PATH = `/emulatorjs/${EJS_VERSION}/data/`;
export const MANIFEST_PATH = '/emulatorjs/runtime-manifest.json';

/** Exact npm tarballs. Integrity values come from the npm registry for 4.2.3. */
export const PACKAGES = Object.freeze({
  emulatorjs: { name: '@emulatorjs/emulatorjs', integrity: 'sha512-7z3qaA4LwyurhuGvdMUDF9xJpEbxC3SNy9+E9tSaOsRo8FCS2QXam/0k/lc9kqHWRFIlLKWahNjPAStyL0rFnw==' },
  nestopia: { name: '@emulatorjs/core-nestopia', integrity: 'sha512-Flz0+Sebpn5sgjJvghhQydZ5OM+Jf4jwa+E6tG1TuZGQ4+5sYeJFB3FA5zHAIXZuFBS91cWnIXRbpOUennf8Fw==' },
  fceumm: { name: '@emulatorjs/core-fceumm', integrity: 'sha512-XX9Vv2N/hzp0TstNMCTSppEs+sg+1lpJpPdSDuRqIO/cwdt7dUcF+WjNX1yQJLRbP5+XwcNHZ6K4BKy8CJpndQ==' },
  snes9x: { name: '@emulatorjs/core-snes9x', integrity: 'sha512-JTe9Rv9eOuCkgkG4ILwuCZUqNcVI3m9ju1NHTTjridUlFgJSqL4DUqF/vLKN9olCpsqlJFfcCayAOoikJxefwA==' },
  picodrive: { name: '@emulatorjs/core-picodrive', integrity: 'sha512-FUxeHeJIIKi4XG+UdOoCARDjH7hV11XLb6LFUO644F7Ri08veGqMQkOJAoCP8uXGxa/JdgS7SXqc0a40+vLv2w==' },
  genesis_plus_gx: { name: '@emulatorjs/core-genesis_plus_gx', integrity: 'sha512-D1e2XA2CPRAjfr0JurpXJgR9dePxl/xHtaE8v1T9BqD9A3DLfobIFWsWU9jCFS4NfUxCvcLdTYdY/We3QzvcTw==' },
  fbneo: { name: '@emulatorjs/core-fbneo', integrity: 'sha512-54Yx8Kcq8DH42caTakws3pMUZc6UkBNqtZgg7Q04lNmWWc/W0wPGN0gHxG90xmlOFGHHtxp9QnicBb1NXMjGWg==' },
  mame2003_plus: { name: '@emulatorjs/core-mame2003_plus', integrity: 'sha512-z37RxbT4R6dJe4r+/+GGN0gDW7d3K+DACJPowqJDSYO8TQK9RQBWPl0nsgp1aiLYkRL7yspbJn2tu2inBMWZow==' },
  fbalpha2012_cps2: { name: '@emulatorjs/core-fbalpha2012_cps2', integrity: 'sha512-RqmLd0J/Gh8dkyjnpGN7YGIRS1fJjtCKqBs8r54Uz35KmHxw4Qs/ghCc836DRXP/IrIYX871jMxVvsOIOdCB/g==' }
});

/** Cores RetroPlay ships. Thread variants are omitted: they need cross-origin isolation. */
export const CORES = Object.freeze(['nestopia', 'fceumm', 'snes9x', 'picodrive', 'genesis_plus_gx', 'fbneo', 'mame2003_plus', 'fbalpha2012_cps2']);

/**
 * Cores RetroPlay builds itself are published as releases of this repository and pinned by sha512
 * like the npm packages. `files` maps the served name (under the core's directory) to { asset, integrity }.
 */
const FAST_TAG = 'cores-fast-r1';
// `dir`: these files are served under cores/<dir>/ (one directory per release) and EmulatorJS is
// pointed at them by file name (EJS_paths, manifest.paths): the runtime directory is cached as
// immutable, so a rebuilt core never reuses a URL a browser may have cached.
const fastCore = (source, integrity) => Object.freeze({
  source,
  release: `https://github.com/emircangencer-ctrl/retroteo1/releases/download/${FAST_TAG}/`,
  dir: FAST_TAG,
  files: Object.freeze(Object.fromEntries(Object.entries(integrity).map(([name, value]) => [name, Object.freeze({ asset: name.replace(/^reports\//, ''), integrity: value })])))
});

/**
 * The stock cores RetroPlay serves as its own builds (.github/workflows/cores-fast.yml): the sources
 * the 4.2.3 packages were built from (source below) and the same toolchain (emsdk 3.1.74,
 * EmulatorJS/RetroArch 6dd4353), linked without Asyncify, with RetroArch's Web Audio driver instead of
 * OpenAL (measurements in TEST-REPORT.md). Each comes with its own build report (EmulatorJS caches a
 * core by its report's buildStart) and is served from its release directory (see `dir`); the stock
 * files stay at the stock names for copies of the app that are still open. A core missing here is
 * served from its npm package (Genesis Plus GX: no gain measured); removing an entry switches a core
 * back to the 4.2.3 package.
 */
export const FAST_CORES = Object.freeze({
  nestopia: fastCore('https://github.com/EmulatorJS/nestopia/tree/6b08ec9148bd4cedc893ed0c97bc64061d044399', {
    'nestopia-wasm.data': 'sha512-V9J0Vr5Yala4vL36isTrGJ0Lpt/0wL1mRDyA56bthCQYGjxz+fL4SVa0yn1uOMrgTNBVYyNzV0EI7a/nZxGzrA==',
    'nestopia-legacy-wasm.data': 'sha512-hSfi2Brtx78KmrurWnlcps7a/iESNU27zws7Vmr05RoZNBNBZbJoLuBn41CgypAUw8hmcUH0k4+/DRwRhSNSlQ==',
    'reports/nestopia.json': 'sha512-01S82HbM5yWehiQNpxH4vZ7BrENqyYnoaZN85GgHw1ReUnm1YP0EHH/VVfRgQer1NmAXIsxJU+VcE5tVmeUbmQ=='
  }),
  fceumm: fastCore('https://github.com/EmulatorJS/libretro-fceumm/tree/d9d7e141274d07186b6a871ca2919b6f13cfb2f9', {
    'fceumm-wasm.data': 'sha512-Tl/jZvrPKiB1Th9ddT4NURYEe1w/MI3lkjIZHPwRxQZ7xb8dbGWLqE+VrPBS4Q/UBCl+oE5KEzN/advKBHaJ+A==',
    'fceumm-legacy-wasm.data': 'sha512-Ks/4oP61muZzHVtuEAtmctON0l7p5zbBRgyMjfO1IC6Db2+Kbi1Of5LazC6lU9iRup0d1Xa/DVxZrf6yfh4dlw==',
    'reports/fceumm.json': 'sha512-nSEzbXpfs83PYJnhfgut8wd/Ix3Z5O6ziZKHvbtQlyrDbcF+kkNX0o6Dl5Zm0qp/EJwi2Y/YGfGDH8fzUbDycg=='
  }),
  snes9x: fastCore('https://github.com/EmulatorJS/snes9x/tree/6ca2343e5f3b0acbea49ca958251e3a0af58a81d', {
    'snes9x-wasm.data': 'sha512-CIYOXMr2uhMJ+ccyo+ZQvAIKYBCbuiMG6bTXlsQYkdP62khb9bgxCIkKRHqw2/akssxx0+92d6UJqzT27alN2g==',
    'snes9x-legacy-wasm.data': 'sha512-tpo3ThS9ZnkEXhCk8cGezLEvvCM+EwB71BRJvvzVgJ53zNwbGZWQsHt8pGtYvJ2QOOQcfm+EhIxLsd83tt6FGg==',
    'reports/snes9x.json': 'sha512-0QCF56ccbR8UcFRd4txuAGocXpFWVzbSKTl6J7th+uCB3GsMN8NVQUf2WeJs0uGYgyllVC8hWh23qitRUlyv+g=='
  }),
  picodrive: fastCore('https://github.com/EmulatorJS/picodrive/tree/09d3cb634c337aa3a1ed6575267d37bc1fdf064e', {
    'picodrive-wasm.data': 'sha512-+wTGziHdliqQp+Ik2SfheaECfhVjn1Pxr4SUK3YBBEA/GV5pXxTSCSx7M0BN5sHSO0Sz30B3ua7S1C0YuZ1RDw==',
    'picodrive-legacy-wasm.data': 'sha512-GdCCVXkOgbSrh82Opi316xE4+hohV9yrPYATdSPLoQxq3T/KYoak5TP6PJguyGS8rPuUSNMSYMRA5C53I/W7IA==',
    'reports/picodrive.json': 'sha512-qaYT/01lh4KahsgBLYq7jGmtCfRGtcddHFOaOmUp3tf8VNaLkoTwCH+1ofDg81W5DLHsxYIMzN8PJitT7jnAQw=='
  }),
  fbneo: fastCore('https://github.com/EmulatorJS/FBNeo/tree/dedd04f2de6423970e18a586991f87812034dc4f', {
    'fbneo-wasm.data': 'sha512-ufGTMwXEII6HF4/IBnnQCqQcsdN6xNs8BTKHuK+3O1p8PLyZzSBSiX+4BkEU2xSKEu0jV91bcoXer8IFW+Ngdg==',
    'fbneo-legacy-wasm.data': 'sha512-f1//6H3TtUh6wz6qaphPgBr6vIa3AS5jTybQv3tji2req9YGYQVDQ/bRTMkjxmI4MQQwC0rGTNbMrUZhPzN45Q==',
    'reports/fbneo.json': 'sha512-1hsDI43VXIMw/SFP9arC21cEq1UCmjoXP/IknDyJ7WlEfNAQ1DM83Aqc7W6H4NVyARQVQcFpocySD21zmEDquQ=='
  }),
  mame2003_plus: fastCore('https://github.com/EmulatorJS/mame2003-plus-libretro/tree/3a72dae33dfae65871158f03dbc1e849d74b4060', {
    'mame2003_plus-wasm.data': 'sha512-xzGA3h7DbgS9ekWaaJgP6tPrl4/WeNl/xF8iiE+Pg3Cxxr1jdzTE4NrL3PIfdPdvnuiB2HCG5GzNhuua5+Kfkw==',
    'mame2003_plus-legacy-wasm.data': 'sha512-PNRCXH9Op8WZM7NkO/0g1M/QautVLVuXv96FylQobnO7Hg3PQmcB5Ue9jqfKwi9NjuCPWUuPKoUt3e2LUcxhbw==',
    'reports/mame2003_plus.json': 'sha512-cMGBtqSEYLXB2c7fMzlhdCcjNgUZg+GLIkc3SFHhZW+H4URFMoJAwg8VTy80tFisRtJNGxQAkObBzrYQoFSUTw=='
  }),
  fbalpha2012_cps2: fastCore('https://github.com/EmulatorJS/fbalpha2012_cps2/tree/3fb5b89d2ab719e45e814e1ad0b5ff721bffdff2', {
    'fbalpha2012_cps2-wasm.data': 'sha512-LmGQItu1yufQ1/VVJYOIqvypkj8ocruKcmt+wuH68sYr0/dQI9NHNnv+zBVgap3uiPoMprHEyEnJN+vPRCzFLw==',
    'fbalpha2012_cps2-legacy-wasm.data': 'sha512-Kxk1QxVuFUCCtIAfBbNcd+ZO5/cxwGsCuRp98nsEU1Kz5TnJV2/qlZ3uPr2K42S/L0aIaLUeHL07xIc9FI4yiA==',
    'reports/fbalpha2012_cps2.json': 'sha512-WS/4/JCIHfQ7VDpvYsPFuekMHnT1oQWotf7/c/Se0RgcUw2ZkYnyMMgpIFjYKQC2ecoDjmBMibdB2lnsXwx8xg=='
  })
});

/**
 * Cores RetroPlay builds itself (.github/workflows/cores.yml) with the toolchain of the 4.2.3 cores,
 * published as releases of this repository and pinned here by sha512 like the npm packages.
 * mame2003_plus_next: the current libretro MAME 2003-Plus (64b3c38a, GPL; source at the commit
 * below) for the drivers listed in scripts/build-arcade-catalogs.mjs (NEXT_DRIVERS).
 */
export const BUILT_CORES = Object.freeze({
  mame2003_plus_next: Object.freeze({
    source: 'https://github.com/libretro/mame2003-plus-libretro/tree/64b3c38ac6dae0fb513e6b881fb3bfc31fca54c4',
    release: 'https://github.com/emircangencer-ctrl/retroteo1/releases/download/core-mame2003_plus_next-64b3c38a-r23/',
    files: Object.freeze({
      'mame2003_plus_next-wasm.data': Object.freeze({ asset: 'next-mame2003_plus_next-wasm.data', integrity: 'sha512-oY1UdhIyTth2NI/fdiQZP0uywlsClSeDj3RZwSKU438f2KylUOkW1/GLOu/jxLB6wrsBGhKWl55lil21aaG2+g==' }),
      'mame2003_plus_next-legacy-wasm.data': Object.freeze({ asset: 'next-mame2003_plus_next-legacy-wasm.data', integrity: 'sha512-eq/Sl7NQkdz+S9LtzfEsEZUt5P1t+eg5HG2GHcw1SMrVPVSc6U0101fMMrH1zAdCXymqUMDKcOgABJmkN7gKsw==' }),
      'reports/mame2003_plus_next.json': Object.freeze({ asset: 'next-mame2003_plus_next.json', integrity: 'sha512-NcNICFmsaExSqYHVDewWxA/7uTnwQYt5AbBF19UIlNyQ+T6zrCZryuXQoL69KDt6ZqQpb5D0oxc544GWLTMqRQ==' })
    })
  }),
  // snes9x2005_plus: Snes9x 2005 with blargg's audio (libretro/snes9x2005, non-commercial license),
  // a lighter Super Nintendo core offered per game; built with the fast cores.
  snes9x2005_plus: fastCore('https://github.com/libretro/snes9x2005/tree/a79dfe9047e7fec58808aefe48ad2bf499c7af11', {
    'snes9x2005_plus-wasm.data': 'sha512-ECLuEs/gk18ijVDAUP7GzrU1GgzpoQpK5WOqGzEKutAiZWHH+38G0CdJ0kBm5cmkpdgz8fHGF70SorTpHKfpZA==',
    'snes9x2005_plus-legacy-wasm.data': 'sha512-JS3x4sdHbyXks+vMhh2682qSxgOJqJJaN1SPwsvZ+2HXEHHCQs9s7qBENpoqxpOT7kxTB/ITLGciuT54XT/VrA==',
    'reports/snes9x2005_plus.json': 'sha512-/ZbhfPmK3lpj4IJX5le51xcng6wbk814Cpwro0kDeM9niy+pALv5+X65R0jxJmARWBLb6oFpgfEwUL4u3IkGmA=='
  })
});
/** Every core the runtime serves. */
export const ALL_CORES = Object.freeze([...CORES, ...Object.keys(BUILT_CORES)]);
/** Cores stored for offline use when the app is installed (the default console cores, ~3.5 MB). */
// The default console cores (the faster ones: FCEUmm, PicoDrive); Nestopia and Genesis Plus GX are
// cached when a game first uses them.
export const PRECACHED_CORES = Object.freeze(['fceumm', 'snes9x', 'picodrive']);
const CORE_VARIANTS = Object.freeze(['-legacy-wasm.data', '-wasm.data']);

// Same order as EmulatorJS's loader.js uses when it loads the unminified sources.
const SCRIPT_ORDER = Object.freeze(['emulator.js', 'nipplejs.js', 'shaders.js', 'storage.js', 'gamepad.js', 'GameManager.js', 'socket.io.min.js', 'compression.js']);
const LANGUAGES = Object.freeze(['tr-TR.json', 'en-US.json']);

/**
 * RetroPlay's additions to the runtime, appended to the bundle and run inside the emulator iframe.
 * - RETROPLAY_RETROARCH_CFG: extra retroarch.cfg lines (EmulatorJS 4.2.3 only takes them from core.json).
 * - RETROPLAY_EXTRA_FILES: files (for example a BIOS zip) written next to the game before it loads.
 *   EmulatorJS's own BIOS download unpacks archives and names files after blob URLs, which breaks
 *   arcade BIOS sets that must stay a zip with their set name.
 * - Canvas resolution: RetroArch sizes its canvas from ResizeObserver's devicePixelContentBoxSize.
 *   When a browser reports that box in CSS pixels (seen with emulated device pixel ratios), the game
 *   is drawn at CSS resolution and stretched, so pixels come out uneven. The core's glue code is
 *   patched to use CSS size × devicePixelRatio whenever the reported box disagrees with it.
 */
export const RETROPLAY_PATCH = `
;(function () {
  'use strict';
  var GameManager = window.EJS_GameManager;
  if (GameManager && GameManager.prototype && typeof GameManager.prototype.getRetroArchCfg === 'function') {
    var baseCfg = GameManager.prototype.getRetroArchCfg;
    GameManager.prototype.getRetroArchCfg = function () {
      var cfg = baseCfg.call(this);
      var extra = window.RETROPLAY_RETROARCH_CFG;
      if (!extra || typeof extra !== 'object') return cfg;
      Object.keys(extra).forEach(function (key) {
        if (!/^[a-z0-9_]+$/.test(key)) return;
        var value = String(extra[key]).replace(/["\\r\\n]/g, '');
        cfg = cfg.split('\\n').filter(function (line) { return line.split('=')[0].trim() !== key; }).join('\\n');
        if (cfg && cfg.charAt(cfg.length - 1) !== '\\n') cfg += '\\n';
        cfg += key + ' = "' + value + '"\\n';
      });
      return cfg;
    };
  }
  var Emulator = window.EmulatorJS;
  // RetroPlay's own core builds belong to a system EmulatorJS knows: its MAME 2003-Plus build is a
  // MAME core (arcade zips are written as they are, MAME controls and settings), Snes9x 2005 Plus
  // a Super Nintendo core, like the cores it knows by name.
  var BUILT_SYSTEM_CORES = { mame: ['mame2003_plus_next'], snes: ['snes9x2005_plus'] };
  if (Emulator && Emulator.prototype && typeof Emulator.prototype.getCores === 'function') {
    var baseGetCores = Emulator.prototype.getCores;
    Emulator.prototype.getCores = function () {
      var cores = baseGetCores.call(this);
      Object.keys(BUILT_SYSTEM_CORES).forEach(function (system) {
        if (cores && Array.isArray(cores[system])) {
          cores[system] = cores[system].concat(BUILT_SYSTEM_CORES[system].filter(function (core) { return cores[system].indexOf(core) === -1; }));
        }
      });
      return cores;
    };
  }
  var CANVAS_SIZE_CODE = 'if(entry.devicePixelContentBoxSize){width=entry.devicePixelContentBoxSize[0].inlineSize;height=entry.devicePixelContentBoxSize[0].blockSize}';
  var CANVAS_SIZE_FIX = 'if(entry.devicePixelContentBoxSize&&Math.abs(entry.devicePixelContentBoxSize[0].inlineSize-entry.contentRect.width*window.devicePixelRatio)<1.5&&Math.abs(entry.devicePixelContentBoxSize[0].blockSize-entry.contentRect.height*window.devicePixelRatio)<1.5){width=entry.devicePixelContentBoxSize[0].inlineSize;height=entry.devicePixelContentBoxSize[0].blockSize}';
  // Software WebGL (no usable GPU: SwiftShader, llvmpipe …) draws every pixel on the CPU, and a
  // phone-sized picture then costs more than the game itself (measured: Mega Drive 37 → 59 frames
  // a second on a 4× slowed CPU). There the picture is drawn at most RETROPLAY_CANVAS_CAP lines
  // high (twice the consoles' 240) and the browser scales it up. The page may set a cap of its own
  // (the TV app: 1080 lines, so a TV box rendering at 4K never draws 2160); RETROPLAY_RENDER = 'full'
  // keeps the full resolution.
  function softwareRenderer() {
    try {
      var canvas = document.createElement('canvas');
      var gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!gl) return '';
      var info = gl.getExtension('WEBGL_debug_renderer_info');
      var name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
      var lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name) ? name : '';
    } catch (error) {
      return '';
    }
  }
  window.RETROPLAY_SOFTWARE_GL = softwareRenderer();
  if (window.RETROPLAY_RENDER === 'full') window.RETROPLAY_CANVAS_CAP = 0;
  else if (window.RETROPLAY_SOFTWARE_GL) window.RETROPLAY_CANVAS_CAP = window.RETROPLAY_CANVAS_CAP > 0 ? Math.min(window.RETROPLAY_CANVAS_CAP, 480) : 480;
  var CANVAS_STORE_CODE = 'RPE.canvasWidth=width;RPE.canvasHeight=height;';
  var CANVAS_STORE_CAP = 'if(window.RETROPLAY_CANVAS_CAP>0&&height>window.RETROPLAY_CANVAS_CAP){width=Math.round(width*window.RETROPLAY_CANVAS_CAP/height);height=window.RETROPLAY_CANVAS_CAP}' + CANVAS_STORE_CODE;
  if (Emulator && Emulator.prototype && typeof Emulator.prototype.initGameCore === 'function') {
    var baseInitGameCore = Emulator.prototype.initGameCore;
    Emulator.prototype.initGameCore = function (js, wasm, thread) {
      try {
        var text = typeof js === 'string' ? js : new TextDecoder().decode(js);
        if (text.indexOf(CANVAS_SIZE_CODE) !== -1) {
          text = text.split(CANVAS_SIZE_CODE).join(CANVAS_SIZE_FIX);
          window.RETROPLAY_CANVAS_FIX = true;
        }
        if (text.indexOf(CANVAS_STORE_CODE) !== -1) {
          text = text.split(CANVAS_STORE_CODE).join(CANVAS_STORE_CAP);
          window.RETROPLAY_CANVAS_CAP_READY = true;
        }
        if (window.RETROPLAY_CANVAS_FIX || window.RETROPLAY_CANVAS_CAP_READY) js = text;
      } catch (error) {
        console.warn('RetroPlay: canvas size patch skipped', error);
      }
      return baseInitGameCore.call(this, js, wasm, thread);
    };
  }
  if (Emulator && Emulator.prototype && typeof Emulator.prototype.downloadRom === 'function') {
    var baseDownloadRom = Emulator.prototype.downloadRom;
    Emulator.prototype.downloadRom = function () {
      var self = this;
      var files = Array.isArray(window.RETROPLAY_EXTRA_FILES) ? window.RETROPLAY_EXTRA_FILES : [];
      return Promise.all(files.map(function (file) {
        if (!file || typeof file.name !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(file.name) || typeof file.url !== 'string') return null;
        return fetch(file.url).then(function (response) {
          if (!response.ok) throw new Error('Dosya okunamadı: ' + file.name);
          return response.arrayBuffer();
        }).then(function (buffer) {
          self.gameManager.FS.writeFile('/' + file.name, new Uint8Array(buffer));
        });
      })).then(function () { return baseDownloadRom.call(self); });
    };
  }
})();
`;

const sha512 = buffer => `sha512-${createHash('sha512').update(buffer).digest('base64')}`;
const shortHash = content => createHash('sha256').update(content).digest('hex').slice(0, 10);

function tarballName(pkg) {
  return `${pkg.name.replace(/^@/, '').replace('/', '-')}-${EJS_VERSION}.tgz`;
}

/** Downloads (once) and unpacks one pinned package; returns the unpacked package directory. */
export function ensurePackage(key, cacheDir) {
  const pkg = PACKAGES[key];
  if (!pkg) throw new Error(`Unknown EmulatorJS package: ${key}`);
  fs.mkdirSync(cacheDir, { recursive: true });
  const tarball = path.join(cacheDir, tarballName(pkg));
  const unpacked = path.join(cacheDir, key);
  const marker = path.join(unpacked, '.integrity');
  if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === pkg.integrity) return path.join(unpacked, 'package');
  if (!fs.existsSync(tarball) || sha512(fs.readFileSync(tarball)) !== pkg.integrity) {
    fs.rmSync(tarball, { force: true });
    execFileSync('npm', ['pack', `${pkg.name}@${EJS_VERSION}`, '--pack-destination', cacheDir, '--silent'], { stdio: ['ignore', 'ignore', 'inherit'] });
  }
  const actual = sha512(fs.readFileSync(tarball));
  if (actual !== pkg.integrity) {
    fs.rmSync(tarball, { force: true });
    throw new Error(`${pkg.name}@${EJS_VERSION} integrity mismatch: expected ${pkg.integrity}, got ${actual}`);
  }
  fs.rmSync(unpacked, { recursive: true, force: true });
  fs.mkdirSync(unpacked, { recursive: true });
  execFileSync('tar', ['-xzf', tarball, '-C', unpacked]);
  fs.writeFileSync(marker, pkg.integrity);
  return path.join(unpacked, 'package');
}

const curlDownload = (url, file) => execFileSync('curl', ['-fsSL', '--retry', '3', '--retry-delay', '2', '-o', file, url], { stdio: ['ignore', 'ignore', 'inherit'] });

/**
 * Downloads (once) files pinned by sha512 into `dir`: { name: { asset, integrity } } from `release`.
 * A download with other contents is refused and not kept. Returns { name: local path }.
 */
export function ensurePinnedFiles(dir, release, files, download = curlDownload) {
  fs.mkdirSync(dir, { recursive: true });
  const local = {};
  for (const [name, file] of Object.entries(files)) {
    const target = path.join(dir, file.asset);
    if (!fs.existsSync(target) || sha512(fs.readFileSync(target)) !== file.integrity) {
      const partial = `${target}.part`;
      fs.rmSync(partial, { force: true });
      download(release + file.asset, partial);
      const actual = fs.existsSync(partial) ? sha512(fs.readFileSync(partial)) : 'nothing downloaded';
      if (actual !== file.integrity) {
        fs.rmSync(partial, { force: true });
        throw new Error(`${file.asset} integrity mismatch: expected ${file.integrity}, got ${actual}`);
      }
      fs.renameSync(partial, target);
    }
    local[name] = target;
  }
  return local;
}

/** Where a core RetroPlay builds is served: cores/<dir>/ for builds with a release directory, else cores/. */
export const servedCoreDir = core => (core.dir ? `cores/${core.dir}/` : 'cores/');

/** The pinned files of a core RetroPlay builds: { 'cores/…': local path }. */
export function ensureBuiltCore(key, cacheDir, download = curlDownload, core = BUILT_CORES[key] || FAST_CORES[key]) {
  if (!core) throw new Error(`Unknown built core: ${key}`);
  const local = ensurePinnedFiles(path.join(cacheDir, 'built', core.dir || key), core.release, core.files, download);
  return Object.fromEntries(Object.entries(local).map(([name, file]) => [servedCoreDir(core) + name, file]));
}

/**
 * EmulatorJS file name → served path (relative to the data path) for cores served from a release
 * directory: the player passes these as EJS_paths.
 */
export function coreFilePaths(core) {
  if (!core.dir) return {};
  return Object.fromEntries(Object.keys(core.files).map(name => [name.split('/').pop(), servedCoreDir(core) + name]));
}

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

/**
 * Builds the runtime into <outDir>/emulatorjs/... and returns its manifest.
 * The manifest lists URL paths (relative to the site root) for the service worker.
 */
export async function buildRuntime({ cacheDir, outDir }) {
  const runtime = ensurePackage('emulatorjs', cacheDir);
  const data = path.join(runtime, 'data');
  const target = path.join(outDir, DATA_PATH);
  fs.rmSync(path.join(outDir, 'emulatorjs'), { recursive: true, force: true });
  const written = [];
  const put = (relative, from) => { copyFile(from, path.join(target, relative)); written.push(relative); };

  put('loader.js', path.join(data, 'loader.js'));
  put('version.json', path.join(data, 'version.json'));
  for (const file of fs.readdirSync(path.join(data, 'compression')).filter(name => /\.(js|wasm)$/.test(name))) put(`compression/${file}`, path.join(data, 'compression', file));
  for (const file of LANGUAGES) put(`localization/${file}`, path.join(data, 'localization', file));
  // Unminified sources: loader.js falls back to these if the bundle is ever missing.
  for (const file of SCRIPT_ORDER) put(`src/${file}`, path.join(data, 'src', file));

  const source = SCRIPT_ORDER.map(file => fs.readFileSync(path.join(data, 'src', file), 'utf8')).join('\n;\n') + RETROPLAY_PATCH;
  const script = (await transform(source, { minify: true, loader: 'js', target: 'es2020', legalComments: 'none' })).code;
  const style = (await transform(fs.readFileSync(path.join(data, 'emulator.css'), 'utf8'), { minify: true, loader: 'css' })).code;
  const scriptFile = `emulator.min.${shortHash(script)}.js`;
  const styleFile = `emulator.min.${shortHash(style)}.css`;
  fs.writeFileSync(path.join(target, scriptFile), script);
  fs.writeFileSync(path.join(target, styleFile), style);
  written.push(scriptFile, styleFile);

  const cores = {};
  const paths = {};
  const served = (key, core) => {
    for (const [relative, from] of Object.entries(ensureBuiltCore(key, cacheDir, undefined, core))) put(relative, from);
    Object.assign(paths, coreFilePaths(core));
    const dir = servedCoreDir(core);
    return { report: `${dir}reports/${key}.json`, files: CORE_VARIANTS.map(variant => `${dir}${key}${variant}`) };
  };
  for (const core of CORES) {
    // The stock files stay at the stock names (copies of the app that are still open ask for them).
    const dir = ensurePackage(core, cacheDir);
    for (const variant of CORE_VARIANTS) put(`cores/${core}${variant}`, path.join(dir, `${core}${variant}`));
    put(`cores/reports/${core}.json`, path.join(dir, 'reports', `${core}.json`));
    cores[core] = FAST_CORES[core] ? served(core, FAST_CORES[core]) : { report: `cores/reports/${core}.json`, files: CORE_VARIANTS.map(variant => `cores/${core}${variant}`) };
  }
  for (const core of Object.keys(BUILT_CORES)) cores[core] = served(core, BUILT_CORES[core]);

  const essential = ['loader.js', scriptFile, styleFile, 'localization/tr-TR.json', 'compression/extract7z.js', 'compression/extractzip.js', ...ALL_CORES.map(core => cores[core].report)];
  const manifest = {
    version: EJS_VERSION,
    dataPath: DATA_PATH,
    script: DATA_PATH + scriptFile,
    style: DATA_PATH + styleFile,
    precache: [...essential, ...PRECACHED_CORES.map(core => cores[core].files.find(file => file.endsWith('-legacy-wasm.data')))].map(file => DATA_PATH + file),
    paths,
    cores: Object.fromEntries(Object.entries(cores).map(([core, entry]) => [core, entry.files.map(file => DATA_PATH + file)])),
    files: written.map(file => DATA_PATH + file).sort()
  };
  manifest.buildId = shortHash(JSON.stringify(manifest));
  fs.writeFileSync(path.join(outDir, MANIFEST_PATH), JSON.stringify(manifest, null, 2));
  return manifest;
}

/** Default cache directory (kept between Netlify builds together with node_modules). */
export function defaultCacheDir(root) {
  return path.join(root, 'node_modules', '.cache', 'retroplay-emulatorjs');
}
