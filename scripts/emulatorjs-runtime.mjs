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
  genesis_plus_gx: { name: '@emulatorjs/core-genesis_plus_gx', integrity: 'sha512-D1e2XA2CPRAjfr0JurpXJgR9dePxl/xHtaE8v1T9BqD9A3DLfobIFWsWU9jCFS4NfUxCvcLdTYdY/We3QzvcTw==' },
  fbneo: { name: '@emulatorjs/core-fbneo', integrity: 'sha512-54Yx8Kcq8DH42caTakws3pMUZc6UkBNqtZgg7Q04lNmWWc/W0wPGN0gHxG90xmlOFGHHtxp9QnicBb1NXMjGWg==' },
  mame2003_plus: { name: '@emulatorjs/core-mame2003_plus', integrity: 'sha512-z37RxbT4R6dJe4r+/+GGN0gDW7d3K+DACJPowqJDSYO8TQK9RQBWPl0nsgp1aiLYkRL7yspbJn2tu2inBMWZow==' }
});

/** Cores RetroPlay ships. Thread variants are omitted: they need cross-origin isolation. */
export const CORES = Object.freeze(['nestopia', 'fceumm', 'snes9x', 'genesis_plus_gx', 'fbneo', 'mame2003_plus']);
/** Cores stored for offline use when the app is installed (the default console cores, ~3.5 MB). */
export const PRECACHED_CORES = Object.freeze(['nestopia', 'snes9x', 'genesis_plus_gx']);
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
  var CANVAS_SIZE_CODE = 'if(entry.devicePixelContentBoxSize){width=entry.devicePixelContentBoxSize[0].inlineSize;height=entry.devicePixelContentBoxSize[0].blockSize}';
  var CANVAS_SIZE_FIX = 'if(entry.devicePixelContentBoxSize&&Math.abs(entry.devicePixelContentBoxSize[0].inlineSize-entry.contentRect.width*window.devicePixelRatio)<1.5&&Math.abs(entry.devicePixelContentBoxSize[0].blockSize-entry.contentRect.height*window.devicePixelRatio)<1.5){width=entry.devicePixelContentBoxSize[0].inlineSize;height=entry.devicePixelContentBoxSize[0].blockSize}';
  if (Emulator && Emulator.prototype && typeof Emulator.prototype.initGameCore === 'function') {
    var baseInitGameCore = Emulator.prototype.initGameCore;
    Emulator.prototype.initGameCore = function (js, wasm, thread) {
      try {
        var text = typeof js === 'string' ? js : new TextDecoder().decode(js);
        if (text.indexOf(CANVAS_SIZE_CODE) !== -1) {
          js = text.split(CANVAS_SIZE_CODE).join(CANVAS_SIZE_FIX);
          window.RETROPLAY_CANVAS_FIX = true;
        }
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
  for (const core of CORES) {
    const dir = ensurePackage(core, cacheDir);
    const files = [];
    for (const variant of CORE_VARIANTS) {
      const name = `${core}${variant}`;
      put(`cores/${name}`, path.join(dir, name));
      files.push(`cores/${name}`);
    }
    put(`cores/reports/${core}.json`, path.join(dir, 'reports', `${core}.json`));
    cores[core] = { report: `cores/reports/${core}.json`, files };
  }

  const essential = ['loader.js', scriptFile, styleFile, 'localization/tr-TR.json', 'compression/extract7z.js', 'compression/extractzip.js', ...CORES.map(core => cores[core].report)];
  const manifest = {
    version: EJS_VERSION,
    dataPath: DATA_PATH,
    script: DATA_PATH + scriptFile,
    style: DATA_PATH + styleFile,
    precache: [...essential, ...PRECACHED_CORES.map(core => `cores/${core}-legacy-wasm.data`)].map(file => DATA_PATH + file),
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
