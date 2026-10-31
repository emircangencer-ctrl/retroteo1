import { RETROPLAY_SHADERS, DISPLAY_MODES, DISPLAY_SCALES, DISPLAY_FILTERS } from './display-modes.js';
// The runtime is served from RetroPlay's own origin (see scripts/emulatorjs-runtime.mjs). The build
// injects the hashed bundle names; tests and unbundled use fall back to the fixed data path.
/* global __EJS_RUNTIME__ */
const RUNTIME = Object.freeze(typeof __EJS_RUNTIME__ === 'object' && __EJS_RUNTIME__
  ? __EJS_RUNTIME__
  : { dataPath: '/emulatorjs/4.2.3/data/', script: '', style: '', buildId: 'dev' });
export const EMULATORJS_VERSION = '4.2.3';
export function emulatorJsDataPath(base = globalThis.location?.href) {
  try { return new URL(RUNTIME.dataPath, base || 'https://retroplay.invalid/').href; }
  catch { return RUNTIME.dataPath; }
}
export const EMULATORJS_INPUT_INDEX = Object.freeze({ BUTTON_B: 0, BUTTON_Y: 1, BUTTON_SELECT: 2, BUTTON_START: 3, BUTTON_UP: 4, BUTTON_DOWN: 5, BUTTON_LEFT: 6, BUTTON_RIGHT: 7, BUTTON_A: 8, BUTTON_X: 9, BUTTON_L: 10, BUTTON_R: 11, BUTTON_L2: 12, BUTTON_R2: 13, BUTTON_L3: 14, BUTTON_R3: 15 });
const INPUT_INDEX = EMULATORJS_INPUT_INDEX;
/**
 * Two players on one keyboard, by physical key (KeyboardEvent.code), the keyboard split in two:
 * player 1 on the right (arrows, as on RetroArch and MAME), player 2 on the left (WASD). Each player
 * has a 2×3 block of buttons beside its directions, laid out like the on-screen pad (lower row:
 * the main buttons), plus Start and Select: MAME's 1 and 5 (coin) for player 1, with Enter and
 * Right Shift beside the arrows (Right Ctrl as earlier RetroPlay builds); MAME's 2 and 6 for
 * player 2. Letters only, so labels and places hold on Q, F, AZERTY and QWERTZ keyboards.
 */
export const KEYBOARD_PLAYERS = Object.freeze([
  Object.freeze({
    move: Object.freeze(['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']),
    bottom: Object.freeze(['KeyJ', 'KeyK', 'KeyL']), top: Object.freeze(['KeyU', 'KeyI', 'KeyO']),
    start: Object.freeze(['Enter', 'NumpadEnter', 'Digit1']), select: Object.freeze(['ShiftRight', 'Digit5', 'ControlRight'])
  }),
  Object.freeze({
    move: Object.freeze(['KeyW', 'KeyA', 'KeyS', 'KeyD']),
    bottom: Object.freeze(['KeyF', 'KeyG', 'KeyH']), top: Object.freeze(['KeyR', 'KeyT', 'KeyY']),
    start: Object.freeze(['Digit2']), select: Object.freeze(['Digit6'])
  })
]);
const MOVE_INPUTS = Object.freeze(['BUTTON_UP', 'BUTTON_LEFT', 'BUTTON_DOWN', 'BUTTON_RIGHT']);
/**
 * The RetroPad buttons of the 2×3 block, placed as on the on-screen pads: arcade panels and the
 * Super Nintendo have B A R below and Y X L above (FinalBurn Neo / MAME 2003-Plus: kicks below,
 * punches above), the NES its B A on the left of the lower row; the Mega Drive A B C below and
 * X Y Z above (Genesis Plus GX: A=Y, B=B, C=A, X=L, Y=X, Z=R).
 */
export const BUTTON_BLOCKS = Object.freeze({
  default: Object.freeze({ bottom: Object.freeze(['BUTTON_B', 'BUTTON_A', 'BUTTON_R']), top: Object.freeze(['BUTTON_Y', 'BUTTON_X', 'BUTTON_L']) }),
  segaMD: Object.freeze({ bottom: Object.freeze(['BUTTON_Y', 'BUTTON_B', 'BUTTON_A']), top: Object.freeze(['BUTTON_L', 'BUTTON_X', 'BUTTON_R']) })
});
/** Key code → [player (0 = player 1), RetroPad button] for an EmulatorJS system. */
export function keyboardMap(systemId = 'nes') {
  const block = BUTTON_BLOCKS[systemId] || BUTTON_BLOCKS.default;
  const map = {};
  KEYBOARD_PLAYERS.forEach((keys, player) => {
    keys.move.forEach((code, i) => { map[code] = Object.freeze([player, MOVE_INPUTS[i]]); });
    keys.bottom.forEach((code, i) => { map[code] = Object.freeze([player, block.bottom[i]]); });
    keys.top.forEach((code, i) => { map[code] = Object.freeze([player, block.top[i]]); });
    for (const code of keys.start) map[code] = Object.freeze([player, 'BUTTON_START']);
    for (const code of keys.select) map[code] = Object.freeze([player, 'BUTTON_SELECT']);
  });
  return Object.freeze(map);
}
/** Players EmulatorJS passes to the core (RetroArch ports 1–4). */
export const EMULATORJS_PLAYERS = 4;
const validPlayer = player => (Number.isInteger(player) && player >= 0 && player < EMULATORJS_PLAYERS ? player : 0);
// held/pressedAt/releaseTimers are keyed by player and RetroPad button together.
const inputSlot = (player, index) => player * 32 + index;
/**
 * Select and Start (coin and start on arcade boards) stay down at least this long, however short
 * the press: arcade games read their coin switch once per frame and many ignore a pulse shorter than
 * a few frames, so a quick tap, a one-frame controller press or a click must still count.
 */
export const MIN_SYSTEM_PRESS_MS = 100;
const SYSTEM_INPUTS = new Set([EMULATORJS_INPUT_INDEX.BUTTON_SELECT, EMULATORJS_INPUT_INDEX.BUTTON_START]);
const now = () => globalThis.performance?.now?.() ?? Date.now();
/** 'full' when the device keeps the full picture resolution under software WebGL (retroplay-render). */
function renderPreference() {
  try { return globalThis.localStorage?.getItem('retroplay-render') === 'full' ? 'full' : 'auto'; } catch { return 'auto'; }
}
/**
 * Sets a game's volume. EmulatorJS turns OpenAL's sources up or down; RetroPlay's own core builds
 * play through RetroArch's Web Audio driver, whose sources go through one gain node (Module.RWA).
 * EmulatorJS re-applies emu.volume when the game resumes, so it is set too (unless `keep`).
 */
function setCoreVolume(emu, volume, { keep = false } = {}) {
  if (!keep) emu.volume = volume;
  if (typeof emu.setVolume === 'function') emu.setVolume(volume);
  const gain = emu.Module?.RWA?.gain;
  if (gain?.gain) gain.gain.value = volume;
}
const ALLOWED_SYSTEM_IDS = new Set(['nes', 'snes', 'segaMD', 'arcade', 'mame']);
const CORES_BY_SYSTEM = Object.freeze({
  nes: new Set(['nes', 'fceumm', 'nestopia']),
  snes: new Set(['snes', 'snes9x', 'snes9x2005_plus']),
  segaMD: new Set(['segaMD', 'picodrive', 'genesis_plus_gx']),
  arcade: new Set(['fbneo', 'fbalpha2012_cps2']),
  mame: new Set(['mame2003_plus', 'mame2003_plus_next'])
});
const SAFE_FILE_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
const CORE_FILE = /^[a-z0-9_]+(-legacy)?(-wasm\.data|\.json)$/;
const SERVED_CORE_PATH = /^cores\/[A-Za-z0-9_.-]+\/(reports\/)?[a-z0-9_]+(-legacy)?(-wasm\.data|\.json)$/;
const ALLOWED_SHADERS = new Set([...Object.values(DISPLAY_MODES), ...Object.values(DISPLAY_SCALES), ...Object.values(DISPLAY_FILTERS)].map(mode => mode.shader).filter(Boolean));
const safeShader = name => (ALLOWED_SHADERS.has(name) ? name : 'disabled');
const SAFE_CFG_KEY = /^[a-z0-9_]{1,64}$/;
const SAFE_OPTION_KEY = /^[A-Za-z0-9_-]{1,64}$/;
function sanitizeExtraFiles(files) {
  if (!Array.isArray(files)) return [];
  return files.filter(file => file && SAFE_FILE_NAME.test(String(file.name)) && /^blob:/.test(String(file.url)))
    .map(file => ({ name: String(file.name), url: String(file.url) }));
}
function sanitizeSettings(settings, keyPattern) {
  const result = {};
  if (!settings || typeof settings !== 'object') return result;
  for (const [key, value] of Object.entries(settings)) {
    if (!keyPattern.test(key) || !['string', 'number', 'boolean'].includes(typeof value)) continue;
    result[key] = String(value).replace(/[\r\n"]/g, '').slice(0, 64);
  }
  return result;
}
const HIDDEN_BUTTONS = { playPause:false, play:false, pause:false, restart:false, mute:false, unmute:false, volumeSlider:false, settings:false, fullscreen:false, enterFullscreen:false, exitFullscreen:false, saveState:false, loadState:false, quickSave:false, quickLoad:false, screenshot:false, gamepad:true, cheat:false, cacheManager:false, exitEmulation:false, netplay:false, diskButton:false, contextMenu:false, saveSavFiles:false, loadSavFiles:false };
// Inside the emulator iframe: the canvas fills the player and RetroArch letterboxes the picture with
// the core's own aspect ratio (4:3 for consoles, the cabinet ratio for arcade, rotated when vertical).
// EmulatorJS's menu bar would cover the bottom of the game; RetroPlay has its own controls.
const RUNTIME_CSS = [
  'html,body,#ejs-player{margin:0!important;padding:0!important;width:100%!important;height:100%!important;min-width:0!important;min-height:0!important;overflow:hidden!important;background:#000!important}',
  '#ejs-player .ejs_parent{position:relative!important;width:100%!important;height:100%!important;min-width:0!important;min-height:0!important;background:#000!important;overflow:hidden!important}',
  '#ejs-player .ejs_canvas_parent{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;min-width:0!important;min-height:0!important;display:block!important;overflow:hidden!important;background:#000!important}',
  '#ejs-player canvas{display:block!important;width:100%!important;height:100%!important;max-width:100%!important;max-height:100%!important;margin:0!important;image-rendering:pixelated!important}',
  '.ejs_virtualGamepad_parent,.ejs_virtualGamepad_open,.ejs_volume_parent,.ejs_bottom_bar,.ejs_start_button,.ejs_contextMenu,.ejs_menu_bar{display:none!important}',
  'html.retroplay-immersive .ejs_menu,html.retroplay-immersive .ejs_settings,html.retroplay-immersive .ejs_overlay,html.retroplay-immersive .ejs_toolbar,html.retroplay-immersive .ejs_gamepad_settings{display:none!important}'
].join('');
const literal = value => JSON.stringify(value).replace(/</g, '\\u003c');
/**
 * Builds the iframe document that boots EmulatorJS for one game.
 * options.extraFiles: [{ name, url }] blob URLs written next to the game (for example a BIOS zip).
 * options.retroarchConfig: extra retroarch.cfg keys; options.coreOptions: core option defaults.
 */
export function buildEmulatorDocument(gameUrl, gameName, systemId = 'nes', gameId = 1, coreId = systemId, options = {}) {
  if (!ALLOWED_SYSTEM_IDS.has(systemId)) throw new TypeError(`Unsupported EmulatorJS system: ${systemId}`);
  if (!CORES_BY_SYSTEM[systemId]?.has(coreId)) throw new TypeError(`Unsupported EmulatorJS core for ${systemId}: ${coreId}`);
  if (!Number.isSafeInteger(gameId) || gameId < 1) throw new TypeError('EmulatorJS game ID must be a positive safe integer.');
  const dataPath = emulatorJsDataPath(options.baseUrl);
  const paths = {};
  if (RUNTIME.script) paths['emulator.min.js'] = new URL(RUNTIME.script, dataPath).href;
  if (RUNTIME.style) paths['emulator.min.css'] = new URL(RUNTIME.style, dataPath).href;
  // RetroPlay's own core builds live in a directory per release (see scripts/emulatorjs-runtime.mjs).
  for (const [file, served] of Object.entries(RUNTIME.paths || {})) {
    if (CORE_FILE.test(file) && SERVED_CORE_PATH.test(served)) paths[file] = new URL(served, dataPath).href;
  }
  const extraFiles = sanitizeExtraFiles(options.extraFiles);
  const retroarchConfig = sanitizeSettings(options.retroarchConfig, SAFE_CFG_KEY);
  const coreOptions = sanitizeSettings(options.coreOptions, SAFE_OPTION_KEY);
  const shader = safeShader(options.shader);
  const startup = [
    '(() => {',
    "const notify = (type, details = {}, transfer = []) => parent.postMessage({ source: 'retroplay-emulatorjs', type, ...details }, '*', transfer);",
    // Before the game starts, a script error means the runtime failed to boot. After start,
    // EmulatorJS/RetroArch can reject non-essential promises (for example a denied screen wake
    // lock); those must not be reported as a stopped session while the game keeps running.
    "let gameStarted = false;",
    "const report = message => notify(gameStarted ? 'warning' : 'error', { message });",
    "window.addEventListener('error', event => report(event && event.message ? event.message : 'Emülatör betiği yüklenemedi.'));",
    "window.addEventListener('unhandledrejection', event => report(String(event.reason && event.reason.message || event.reason || 'Emülatör başlatılamadı.')));",
    "window.EJS_player = '#ejs-player';",
    'window.EJS_startOnLoaded = true;',
    'window.EJS_core = ' + literal(coreId) + ';',
    'window.EJS_controlScheme = ' + literal(systemId) + ';',
    "window.EJS_language = 'tr-TR';",
    'window.EJS_pathtodata = ' + literal(dataPath) + ';',
    'window.EJS_paths = ' + literal(paths) + ';',
    'window.RETROPLAY_EXTRA_FILES = ' + literal(extraFiles) + ';',
    'window.RETROPLAY_RETROARCH_CFG = ' + literal(retroarchConfig) + ';',
    // 'full': draw at the screen's full resolution even with software WebGL (see the runtime patch).
    'window.RETROPLAY_RENDER = ' + literal(options.render === 'full' ? 'full' : 'auto') + ';',
    'window.EJS_defaultOptions = ' + literal(coreOptions) + ';',
    'window.EJS_shaders = ' + literal(RETROPLAY_SHADERS) + ';',
    'window.EJS_gameUrl = ' + literal(gameUrl) + ';',
    'window.EJS_gameName = ' + literal(gameName) + ';',
    'window.EJS_gameID = ' + String(gameId) + ';',
    'window.EJS_volume = 0.7;',
    'window.EJS_Buttons = ' + literal(HIDDEN_BUTTONS) + ';',
    "window.EJS_onGameStart = () => { const emu = window.EJS_emulator; const missing = []; if (typeof emu?.gameManager?.simulateInput !== 'function') missing.push('kontrol desteği'); if (typeof emu?.pause !== 'function') missing.push('duraklatma'); if (typeof emu?.play !== 'function') missing.push('devam etme'); if (missing.length) { notify('error', { message: 'EmulatorJS yüklendi ancak gerekli API eksik: ' + missing.join(', ') + '. Çalışma zamanı ile kontrol katmanı uyumsuz.' }); return; } try { if (emu.gamepad && typeof emu.gamepad.terminate === 'function') emu.gamepad.terminate(); } catch (error) {} const css = document.createElement('style'); css.textContent = " + literal(RUNTIME_CSS) + "; document.head.appendChild(css); if (typeof emu.enableShader === 'function') { try { emu.enableShader(" + literal(shader) + "); } catch (error) { notify('warning', { message: 'Görüntü modu uygulanamadı: ' + (error && error.message || error) }); } } try { const rwa = emu.Module && emu.Module.RWA; if (rwa && rwa.gain) rwa.gain.gain.value = typeof emu.volume === 'number' ? emu.volume : 0.7; } catch (error) {} gameStarted = true; notify('started'); };",
    "window.EJS_onExit = () => notify('exit');",
    "window.addEventListener('message', event => { if (event.source !== parent || !event.data || event.data.source !== 'retroplay-app' || event.data.type !== 'immersive') return; document.documentElement.classList.toggle('retroplay-immersive', Boolean(event.data.active)); });",
    "const loader = document.createElement('script'); loader.src = " + literal(new URL('loader.js', dataPath).href) + "; loader.onerror = () => notify('error', { message: 'EmulatorJS yüklenemedi. Uygulamayı yenileyip tekrar dene; ilk açılışta internet bağlantısı gerekir.' }); document.head.appendChild(loader);",
    '})();'
  ].join('\n');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>RetroPlay EmulatorJS runtime</title></head><body style="margin:0;background:#000;overflow:hidden"><div id="ejs-player"></div><script>' + startup + '</script></body></html>';
}
export class EmulatorJsPlayer {
  constructor(container, { onError = () => {}, onWarning = () => {}, onHotkey = () => {}, gameId = 1, systemId = 'nes', systemLabel = 'NES', coreId = systemId, extraFiles = [], retroarchConfig = {}, coreOptions = {}, shader = 'disabled' } = {}) {
    if (!ALLOWED_SYSTEM_IDS.has(systemId)) throw new TypeError(`Unsupported EmulatorJS system: ${systemId}`);
    if (!CORES_BY_SYSTEM[systemId]?.has(coreId)) throw new TypeError(`Unsupported EmulatorJS core for ${systemId}: ${coreId}`);
    if (!Number.isSafeInteger(gameId) || gameId < 1) throw new TypeError('EmulatorJS game ID must be a positive safe integer.');
    this.container=container; this.onError=onError; this.onWarning=onWarning; this.onHotkey=onHotkey; this.gameId=gameId; this.systemId=systemId; this.systemLabel=systemLabel; this.coreId=coreId; this.documentOptions={ extraFiles, retroarchConfig, coreOptions, shader }; this.keyMap=keyboardMap(systemId); this.engineName=`EmulatorJS · ${systemLabel}`; this.romInfo=null;
    this.frame=null; this.romUrl=null; this.started=false; this.destroyed=false; this.held=new Map(); this.pressedAt=new Map(); this.releaseTimers=new Map(); this.tapTimers=new Set(); this.keysDown=new Map(); this.fastForward=false; this.rewinding=false; this.rightCtrlDown=false; this.timer=null; this.resolveStart=null; this.rejectStart=null;
    this.boundMessage=event=>this.handleMessage(event); this.boundKeyDown=event=>this.handleKey(event,true); this.boundKeyUp=event=>this.handleKey(event,false); this.boundBlur=()=>{this.rightCtrlDown=false;this.releaseAllButtons();}; this.boundWake=()=>this.resumeAudio(); this.frameWindow=null; this.boundFrameLoad=()=>{const win=this.frame?.contentWindow;if(!win)return;win.removeEventListener('keydown',this.boundKeyDown,true);win.removeEventListener('keyup',this.boundKeyUp,true);this.frameWindow=win;win.addEventListener('keydown',this.boundKeyDown,true);win.addEventListener('keyup',this.boundKeyUp,true);};
    document.addEventListener('keydown',this.boundKeyDown); document.addEventListener('keyup',this.boundKeyUp); window.addEventListener('blur',this.boundBlur); document.addEventListener('pointerdown',this.boundWake,true); document.addEventListener('keydown',this.boundWake,true);
  }
  loadROM(bytes, gameName='RetroPlay game') {
    if(this.destroyed) return Promise.reject(new Error('Oynatıcı kapatıldı.'));
    if(this.frame) return Promise.reject(new Error('Bu oynatıcıda zaten bir ROM yükleniyor.'));
    // A Blob (an arcade zip) is handed over as it is; bytes are wrapped once.
    const blob=bytes instanceof Blob?bytes:new Blob([bytes instanceof Uint8Array?bytes:new Uint8Array(bytes)],{type:'application/octet-stream'});
    this.romUrl=URL.createObjectURL(blob);
    const frame=document.createElement('iframe'); frame.title=gameName+' — '+this.systemLabel+' emülatörü'; frame.setAttribute('allow','autoplay; fullscreen; gamepad; screen-wake-lock'); frame.referrerPolicy='no-referrer'; frame.style.cssText='display:block;width:100%;height:100%;border:0;background:#000;';
    this.frame=frame; frame.addEventListener('load',this.boundFrameLoad); this.container.replaceChildren(frame); window.addEventListener('message',this.boundMessage);
    return new Promise((resolve,reject)=>{ this.resolveStart=resolve; this.rejectStart=reject; this.timer=window.setTimeout(()=>this.fail(new Error('Emülatör çekirdeği 75 saniye içinde başlamadı. İlk açılışta çekirdek indirilir; bağlantını kontrol edip yeniden dene.')),75000); frame.srcdoc=buildEmulatorDocument(this.romUrl,gameName,this.systemId,this.gameId,this.coreId,{ ...this.documentOptions, render: renderPreference() }); });
  }
  handleMessage(event) {
    if(!this.frame||event.source!==this.frame.contentWindow||!event.data||event.data.source!=='retroplay-emulatorjs')return;
    const data=event.data;
    if(data.type==='started'){
      this.started=true;
      // RetroArch keeps running its own (hidden) menu when a core cannot load the file, so a
      // "started" event alone does not prove the game is running. An empty save state means no game.
      if(this.contentLoaded()===false){ this.started=false; const error=new Error('Çekirdek bu oyun dosyasını açamadı.'); error.code='content-not-loaded'; this.fail(error); return; }
      window.clearTimeout(this.timer); this.timer=null; const resolve=this.resolveStart; this.resolveStart=null; this.rejectStart=null; resolve?.(true);
    }
    else if(data.type==='error') this.fail(new Error(data.message||'EmulatorJS başlatılamadı.'));
    else if(data.type==='warning') {
      try { this.onWarning(String(data.message || 'Emülatör uyarısı')); } catch {}
    }
    else if(data.type==='exit'&&!this.destroyed){ if(!this.started){ const error=new Error('Çekirdek oyunu başlatamadı.'); error.code='content-not-loaded'; this.fail(error); } else this.onError(new Error('Emülatör oturumu kapandı.')); }
  }
  fail(error){ if(this.destroyed)return; window.clearTimeout(this.timer); this.timer=null; const reject=this.rejectStart; this.resolveStart=null; this.rejectStart=null; this.onError(error); reject?.(error); }
  setImmersive(active){try{this.frame?.contentWindow?.postMessage({source:'retroplay-app',type:'immersive',active:Boolean(active)},'*');}catch{}}
  // RetroArch re-measures its canvas (in device pixels) on the iframe's resize event.
  fitInParent(){const win=this.frame?.contentWindow;try{win?.dispatchEvent(new win.Event('resize'));}catch{}try{win?.EJS_emulator?.handleResize?.();}catch{}}
  pause(){const e=this.frame?.contentWindow?.EJS_emulator;if(!this.started||!e)throw new Error('Emülatör henüz hazır değil.');this.releaseAllButtons();e.pause();}
  resume(){const e=this.frame?.contentWindow?.EJS_emulator;if(!this.started||!e)throw new Error('Emülatör henüz hazır değil.');e.play();}
  /**
   * Returns a copy of the game's battery save (SRAM) owned by the host app, or null when the
   * running core has none. With flush=true the core first writes its live SRAM to the virtual
   * file system; with flush=false only the file the core loaded at startup is read.
   * EmulatorJS 4.2.3 itself persists this file only every 5 minutes, so the app must copy it.
   */
  readSaveData({ flush = true } = {}) {
    const gm = this.frame?.contentWindow?.EJS_emulator?.gameManager;
    if (!this.started || this.destroyed || !gm?.FS || typeof gm.getSaveFilePath !== 'function') return null;
    try {
      if (flush) gm.saveSaveFiles();
      const path = gm.getSaveFilePath();
      if (!path || !gm.FS.analyzePath(path).exists) return null;
      const data = gm.FS.readFile(path);
      if (!data || !data.length) return null;
      return new Uint8Array(data);
    } catch (error) {
      try { this.onWarning(`Oyun kaydı okunamadı: ${error?.message || error}`); } catch {}
      return null;
    }
  }
  /** Writes a host-owned battery save into the running core and asks it to reload SRAM. */
  writeSaveData(bytes) {
    const gm = this.frame?.contentWindow?.EJS_emulator?.gameManager;
    const data = bytes instanceof Uint8Array ? bytes : (ArrayBuffer.isView(bytes) || bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : null);
    if (!this.started || this.destroyed || !gm?.FS || !data?.length) return false;
    const path = gm.getSaveFilePath();
    if (!path) return false;
    let dir = '';
    for (const part of path.split('/').slice(0, -1)) {
      if (!part) continue;
      dir += `/${part}`;
      if (!gm.FS.analyzePath(dir).exists) gm.FS.mkdir(dir);
    }
    if (gm.FS.analyzePath(path).exists) gm.FS.unlink(path);
    gm.FS.writeFile(path, new Uint8Array(data));
    gm.loadSaveFiles();
    return true;
  }
  /**
   * false when the core runs without a game (RetroArch reports a zero-size save state); null if
   * unknown. MAME 2003-Plus has no state support for some games, so a zero size proves nothing there.
   */
  contentLoaded() {
    if (/^mame2003_plus/.test(this.coreId)) return null;
    const gm = this.frame?.contentWindow?.EJS_emulator?.gameManager;
    try {
      const info = gm?.functions?.saveStateInfo?.();
      if (typeof info !== 'string') return null;
      return !/^Size is zero/i.test(info);
    } catch { return null; }
  }
  /** True when the running core can serialize its full machine state. */
  supportsStates() {
    const gm = this.frame?.contentWindow?.EJS_emulator?.gameManager;
    if (!this.started || this.destroyed || !gm) return false;
    try { return typeof gm.supportsStates === 'function' ? Boolean(gm.supportsStates()) : typeof gm.getState === 'function'; } catch { return false; }
  }
  /**
   * Returns a host-owned copy of the full machine state (a "save state"), or null.
   * The runtime returns a view into emulator memory, so it is copied before returning.
   */
  saveState() {
    const gm = this.frame?.contentWindow?.EJS_emulator?.gameManager;
    if (!this.started || this.destroyed || typeof gm?.getState !== 'function') return null;
    try {
      const state = gm.getState();
      return state && state.length ? new Uint8Array(state) : null;
    } catch (error) {
      try { this.onWarning(`Kayıt noktası alınamadı: ${error?.message || error}`); } catch {}
      return null;
    }
  }
  /** Loads a save state previously produced by saveState() for the same core. */
  loadState(bytes) {
    const gm = this.frame?.contentWindow?.EJS_emulator?.gameManager;
    const data = bytes instanceof Uint8Array ? bytes : (ArrayBuffer.isView(bytes) || bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : null);
    if (!this.started || this.destroyed || typeof gm?.loadState !== 'function' || !data?.length) return false;
    try {
      this.releaseAllButtons();
      gm.loadState(new Uint8Array(data));
      return true;
    } catch (error) {
      try { this.onWarning(`Kayıt noktası yüklenemedi: ${error?.message || error}`); } catch {}
      return false;
    }
  }
  /** Frames per second during normal play (vsync on); about 60 unless the screen drives it faster. */
  async measurePace({ ms = 2000 } = {}) {
    const gm = this.frame?.contentWindow?.EJS_emulator?.gameManager;
    if (!this.started || this.destroyed || typeof gm?.getFrameNum !== 'function') return null;
    const startFrame = gm.getFrameNum();
    const startTime = performance.now();
    await new Promise(resolve => window.setTimeout(resolve, ms));
    return (gm.getFrameNum() - startFrame) / ((performance.now() - startTime) / 1000);
  }
  /**
   * Measures how fast this device can run the game: the core runs unthrottled (fast-forward with
   * no limit, vsync off, muted) for `seconds` and the emulated frame rate is compared with the
   * system's normal rate. Returns { fps, headroom, frames, ms } or null; always restores normal play.
   */
  async benchmark({ seconds = 4, nominalFps = 60 } = {}) {
    const emu = this.frame?.contentWindow?.EJS_emulator;
    const gm = emu?.gameManager;
    if (!this.started || this.destroyed || typeof gm?.getFrameNum !== 'function' || typeof gm.toggleFastForward !== 'function') return null;
    const wait = ms => new Promise(resolve => window.setTimeout(resolve, ms));
    const volume = typeof emu.volume === 'number' ? emu.volume : 0.7;
    this.releaseAllButtons();
    try {
      try { setCoreVolume(emu, 0, { keep: true }); } catch {}
      try { gm.functions?.setVSync?.(0); } catch {}
      gm.setFastForwardRatio?.(0);
      gm.toggleFastForward(1);
      await wait(500); // let the unthrottled loop settle
      const startFrame = gm.getFrameNum();
      const startTime = performance.now();
      await wait(Math.max(1000, seconds * 1000));
      const frames = gm.getFrameNum() - startFrame;
      const ms = performance.now() - startTime;
      const fps = frames / (ms / 1000);
      return { fps, headroom: fps / nominalFps, frames, ms };
    } catch (error) {
      try { this.onWarning(`Performans ölçülemedi: ${error?.message || error}`); } catch {}
      return null;
    } finally {
      try { gm.setFastForwardRatio?.(3); } catch {}
      // The player's own fast forward (if it was on) carries on after the measurement.
      try { gm.toggleFastForward(this.fastForward ? 1 : 0); } catch {}
      try { gm.functions?.setVSync?.(1); } catch {}
      try { setCoreVolume(emu, volume); } catch {}
    }
  }
  /** Switches the shader of the running game (display mode); returns false if it is not possible. */
  setShader(name) {
    const emu = this.frame?.contentWindow?.EJS_emulator;
    if (!this.started || this.destroyed || typeof emu?.enableShader !== 'function') return false;
    try { emu.enableShader(safeShader(name)); return true; }
    catch (error) { try { this.onWarning(`Görüntü modu uygulanamadı: ${error?.message || error}`); } catch {} return false; }
  }
  /** The software WebGL renderer the game is drawn with ('' with a GPU) and the line cap in use. */
  renderInfo() {
    const win = this.frame?.contentWindow;
    return { software: String(win?.RETROPLAY_SOFTWARE_GL || ''), cap: Number(win?.RETROPLAY_CANVAS_CAP) || 0 };
  }
  /** Sound volume 0–1 of the running game. */
  setVolume(value) {
    const emu = this.frame?.contentWindow?.EJS_emulator;
    const volume = Math.min(1, Math.max(0, Number(value)));
    if (!this.started || this.destroyed || typeof emu?.setVolume !== 'function' || !Number.isFinite(volume)) return false;
    try { setCoreVolume(emu, volume); return true; } catch { return false; }
  }
  /**
   * Starts the game's sound if the browser held it back (an audio context may only start after a
   * tap or key press; the player's taps land on the page, not in the emulator frame).
   */
  resumeAudio() {
    const emu = this.frame?.contentWindow?.EJS_emulator;
    if (!this.started || this.destroyed || !emu?.Module) return;
    for (const context of [emu.Module.RWA?.context, emu.Module.AL?.currentCtx?.audioCtx]) {
      try { if (context && context.state === 'suspended') context.resume().catch(() => {}); } catch {}
    }
  }
  /**
   * A PNG of the current frame as the core drew it (RetroArch screenshot, game resolution), or
   * null. The core writes it from its main loop, so a paused game produces none.
   */
  async screenshot({ timeout = 1500 } = {}) {
    const gm = this.frame?.contentWindow?.EJS_emulator?.gameManager;
    if (!this.started || this.destroyed || typeof gm?.functions?.screenshot !== 'function' || !gm.FS) return null;
    const path = '/screenshot.png';
    try { gm.FS.unlink(path); } catch {}
    try { gm.functions.screenshot(); } catch { return null; }
    const end = performance.now() + timeout;
    while (performance.now() < end) {
      await new Promise(resolve => window.setTimeout(resolve, 40));
      if (this.destroyed || this.frame?.contentWindow?.EJS_emulator?.gameManager !== gm) return null;
      try {
        if (gm.FS.stat(path)?.size > 0) {
          const data = gm.FS.readFile(path);
          try { gm.FS.unlink(path); } catch {}
          return data?.length ? new Blob([new Uint8Array(data)], { type: 'image/png' }) : null;
        }
      } catch {}
    }
    return null;
  }
  /**
   * Fast forward (RetroArch's fastforward_ratio, 3× in EmulatorJS) on or off; false when the
   * runtime cannot do it.
   */
  setFastForward(active) {
    const gm = this.frame?.contentWindow?.EJS_emulator?.gameManager;
    if (!this.started || this.destroyed || typeof gm?.toggleFastForward !== 'function') return false;
    gm.toggleFastForward(active ? 1 : 0);
    this.fastForward = Boolean(active);
    return true;
  }
  /** Whether this game was started with RetroArch's rewind buffer (light consoles only). */
  supportsRewind() {
    return this.documentOptions?.retroarchConfig?.rewind_enable === 'true';
  }
  /** Runs the game backwards while active (RetroArch rewind); false when it is not available. */
  setRewind(active) {
    const fn = this.frame?.contentWindow?.EJS_emulator?.gameManager?.functions?.toggleRewind;
    if (!this.started || this.destroyed || !this.supportsRewind() || typeof fn !== 'function') return false;
    fn(active ? 1 : 0);
    this.rewinding = Boolean(active);
    return true;
  }
  /** Soft-resets the running game; battery-backed RAM is preserved by the core. */
  restartGame() {
    const gm = this.frame?.contentWindow?.EJS_emulator?.gameManager;
    if (!this.started || this.destroyed || typeof gm?.restart !== 'function') return false;
    gm.restart();
    return true;
  }
  handleKey(event, pressed) {
    if (!this.started || this.destroyed) return;
    const modal = this.container.closest('#player-modal');
    if (modal?.classList.contains('hidden')) return;
    const inFrame = Boolean(this.frameWindow && event.currentTarget === this.frameWindow);
    // RetroPlay is the only keyboard handler of the game: keys typed while the emulator frame has
    // focus never reach EmulatorJS's own key handling (its defaults differ: X/Z swapped, V = Select,
    // and 1/2/3 save, load and change EmulatorJS's own state slots).
    if (inFrame) event.stopPropagation?.();
    if (event.code === 'ControlRight') this.rightCtrlDown = pressed;
    // Space held: fast forward; Backspace held: rewind (outside both players' halves of the keyboard).
    if ((event.code === 'Space' || event.code === 'Backspace') && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const targetTag = event.target?.tagName?.toLowerCase();
      if (targetTag === 'input' || targetTag === 'textarea' || targetTag === 'select' || event.target?.isContentEditable) return;
      if (!inFrame && modal?.classList.contains('menu-open')) return;
      event.preventDefault();
      if (!event.repeat) { try { this.onHotkey(event.code === 'Space' ? 'FastForward' : 'Rewind', pressed); } catch {} }
      return;
    }
    if (event.code === 'Escape' && pressed && !event.repeat && inFrame) {
      // Inside the emulator frame the page never sees Escape; hand it to the app (menu).
      event.preventDefault();
      try { this.onHotkey('Escape'); } catch {}
      return;
    }
    const mapped = this.keyMap[event.code] || (event.key === 'Control' && event.location === 2 ? [0, 'BUTTON_SELECT'] : null);
    if (!mapped) return;
    const [player, name] = mapped;
    const source = `key:${event.code || event.key}`;
    // A key that comes up always lets go of its button (for the player it pressed it for),
    // whatever modifiers are held by then.
    if (!pressed) { const down = this.keysDown.get(source); if (down) { event.preventDefault(); this.keysDown.delete(source); this.releaseButton(down.name, source, down.player); } return; }
    if (event.altKey || event.metaKey || (event.ctrlKey && event.code !== 'ControlRight' && !this.rightCtrlDown)) return;
    const targetTag = event.target?.tagName?.toLowerCase();
    if (targetTag === 'input' || targetTag === 'textarea' || targetTag === 'select' || event.target?.isContentEditable) return;
    // While the menu is open the keyboard drives the menu (Enter activates the focused item).
    if (!inFrame && modal?.classList.contains('menu-open')) return;
    event.preventDefault();
    // The iframe's own default keyboard handler must not process the same key a second time.
    event.stopPropagation?.();
    this.keysDown.set(source, { name, player });
    this.pressButton(name, source, player);
  }
  /** Holds a RetroPad button of a player (0 = player 1) for one input source. */
  pressButton(name, source = 'pointer', player = 0) {
    const index = INPUT_INDEX[name], gm = this.frame?.contentWindow?.EJS_emulator?.gameManager;
    if (index === undefined || !this.started || !gm) return;
    const port = validPlayer(player), slot = inputSlot(port, index);
    let sources = this.held.get(slot);
    if (!sources) {
      sources = new Set(); this.held.set(slot, sources);
      const pending = this.releaseTimers.get(slot);
      // Pressed again before a short press was let go: it simply stays down.
      if (pending) { globalThis.clearTimeout(pending); this.releaseTimers.delete(slot); }
      else { gm.simulateInput(port, index, 1); this.pressedAt.set(slot, now()); }
    }
    sources.add(source);
  }
  releaseButton(name, source = 'pointer', player = 0) {
    const index = INPUT_INDEX[name];
    if (index === undefined) return;
    const slot = inputSlot(validPlayer(player), index), sources = this.held.get(slot);
    if (!sources) return;
    sources.delete(source);
    if (sources.size) return;
    this.held.delete(slot);
    const left = SYSTEM_INPUTS.has(index) ? MIN_SYSTEM_PRESS_MS - (now() - (this.pressedAt.get(slot) ?? -Infinity)) : 0;
    if (left > 0) {
      this.releaseTimers.set(slot, globalThis.setTimeout(() => { this.releaseTimers.delete(slot); if (!this.held.has(slot)) this.#sendRelease(slot); }, left));
      return;
    }
    this.#sendRelease(slot);
  }
  #sendRelease(slot) {
    this.pressedAt.delete(slot);
    const gm = this.frame?.contentWindow?.EJS_emulator?.gameManager;
    if (gm) gm.simulateInput(Math.floor(slot / 32), slot % 32, 0);
  }
  /** A short press from an on-screen button (Jeton, Başla): down now, up after `ms`. */
  tapButton(name, ms = 140, player = 0) {
    if (INPUT_INDEX[name] === undefined || !this.started || this.destroyed) return false;
    const port = validPlayer(player), source = `tap:${port}:${name}`;
    this.pressButton(name, source, port);
    const timer = globalThis.setTimeout(() => { this.tapTimers.delete(timer); this.releaseButton(name, source, port); }, ms);
    this.tapTimers.add(timer);
    return true;
  }
  releaseAllButtons() {
    const gm = this.frame?.contentWindow?.EJS_emulator?.gameManager;
    for (const timer of this.tapTimers) globalThis.clearTimeout(timer);
    this.tapTimers.clear();
    const slots = new Set([...this.held.keys(), ...this.releaseTimers.keys()]);
    for (const timer of this.releaseTimers.values()) globalThis.clearTimeout(timer);
    this.releaseTimers.clear();
    if (gm) for (const slot of slots) gm.simulateInput(Math.floor(slot / 32), slot % 32, 0);
    this.held.clear();
    this.pressedAt.clear();
    this.keysDown.clear();
  }
  destroy() {
    if (this.destroyed) return;
    this.releaseAllButtons();
    this.destroyed = true;
    window.clearTimeout(this.timer);
    window.removeEventListener('message', this.boundMessage);
    document.removeEventListener('keydown', this.boundKeyDown);
    document.removeEventListener('keyup', this.boundKeyUp);
    window.removeEventListener('blur', this.boundBlur);
    document.removeEventListener('pointerdown', this.boundWake, true);
    document.removeEventListener('keydown', this.boundWake, true);
    this.frame?.removeEventListener('load', this.boundFrameLoad);
    this.frameWindow?.removeEventListener('keydown', this.boundKeyDown, true);
    this.frameWindow?.removeEventListener('keyup', this.boundKeyUp, true);
    this.frameWindow = null;
    const reject = this.rejectStart; this.resolveStart = null; this.rejectStart = null;
    if (!this.started) reject?.(new Error('Oyun açılışı iptal edildi.'));
    try { this.frame?.contentWindow?.EJS_emulator?.pause(); } catch {}
    this.frame?.remove(); this.frame = null;
    if (this.romUrl) URL.revokeObjectURL(this.romUrl);
    this.romUrl = null; this.held.clear(); this.keysDown.clear();
  }
}

// Backward-compatible NES name for existing callers and tests.
export class EmulatorJsNesPlayer extends EmulatorJsPlayer {
  constructor(container, options = {}) {
    super(container, { ...options, systemId: 'nes', systemLabel: 'NES' });
  }
}
