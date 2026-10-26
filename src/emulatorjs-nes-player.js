import { RETROPLAY_SHADERS, DISPLAY_MODES } from './display-modes.js';
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
const KEY_TO_BUTTON = Object.freeze({ ArrowUp:'BUTTON_UP', ArrowDown:'BUTTON_DOWN', ArrowLeft:'BUTTON_LEFT', ArrowRight:'BUTTON_RIGHT', KeyZ:'BUTTON_B', KeyX:'BUTTON_A', KeyA:'BUTTON_Y', KeyS:'BUTTON_X', KeyQ:'BUTTON_L', KeyW:'BUTTON_R', Enter:'BUTTON_START', ControlRight:'BUTTON_SELECT' });
const ALLOWED_SYSTEM_IDS = new Set(['nes', 'snes', 'segaMD', 'arcade', 'mame']);
const CORES_BY_SYSTEM = Object.freeze({
  nes: new Set(['nes', 'fceumm', 'nestopia']),
  snes: new Set(['snes']),
  segaMD: new Set(['segaMD']),
  arcade: new Set(['fbneo', 'fbalpha2012_cps2']),
  mame: new Set(['mame2003_plus'])
});
const SAFE_FILE_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
const ALLOWED_SHADERS = new Set(Object.values(DISPLAY_MODES).map(mode => mode.shader));
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
    'window.EJS_defaultOptions = ' + literal(coreOptions) + ';',
    'window.EJS_shaders = ' + literal(RETROPLAY_SHADERS) + ';',
    'window.EJS_gameUrl = ' + literal(gameUrl) + ';',
    'window.EJS_gameName = ' + literal(gameName) + ';',
    'window.EJS_gameID = ' + String(gameId) + ';',
    'window.EJS_volume = 0.7;',
    'window.EJS_Buttons = ' + literal(HIDDEN_BUTTONS) + ';',
    "window.EJS_onGameStart = () => { const emu = window.EJS_emulator; const missing = []; if (typeof emu?.gameManager?.simulateInput !== 'function') missing.push('kontrol desteği'); if (typeof emu?.pause !== 'function') missing.push('duraklatma'); if (typeof emu?.play !== 'function') missing.push('devam etme'); if (missing.length) { notify('error', { message: 'EmulatorJS yüklendi ancak gerekli API eksik: ' + missing.join(', ') + '. Çalışma zamanı ile kontrol katmanı uyumsuz.' }); return; } try { if (emu.gamepad && typeof emu.gamepad.terminate === 'function') emu.gamepad.terminate(); } catch (error) {} const css = document.createElement('style'); css.textContent = " + literal(RUNTIME_CSS) + "; document.head.appendChild(css); if (typeof emu.enableShader === 'function') { try { emu.enableShader(" + literal(shader) + "); } catch (error) { notify('warning', { message: 'Görüntü modu uygulanamadı: ' + (error && error.message || error) }); } } gameStarted = true; notify('started'); };",
    "window.EJS_onExit = () => notify('exit');",
    "window.addEventListener('message', event => { if (event.source !== parent || !event.data || event.data.source !== 'retroplay-app' || event.data.type !== 'immersive') return; document.documentElement.classList.toggle('retroplay-immersive', Boolean(event.data.active)); });",
    "const loader = document.createElement('script'); loader.src = " + literal(new URL('loader.js', dataPath).href) + "; loader.onerror = () => notify('error', { message: 'EmulatorJS yüklenemedi. Uygulamayı yenileyip tekrar dene; ilk açılışta internet bağlantısı gerekir.' }); document.head.appendChild(loader);",
    '})();'
  ].join('\n');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>RetroPlay EmulatorJS runtime</title></head><body style="margin:0;background:#000;overflow:hidden"><div id="ejs-player"></div><script>' + startup + '</script></body></html>';
}
export class EmulatorJsPlayer {
  constructor(container, { onError = () => {}, onWarning = () => {}, gameId = 1, systemId = 'nes', systemLabel = 'NES', coreId = systemId, extraFiles = [], retroarchConfig = {}, coreOptions = {}, shader = 'disabled' } = {}) {
    if (!ALLOWED_SYSTEM_IDS.has(systemId)) throw new TypeError(`Unsupported EmulatorJS system: ${systemId}`);
    if (!CORES_BY_SYSTEM[systemId]?.has(coreId)) throw new TypeError(`Unsupported EmulatorJS core for ${systemId}: ${coreId}`);
    if (!Number.isSafeInteger(gameId) || gameId < 1) throw new TypeError('EmulatorJS game ID must be a positive safe integer.');
    this.container=container; this.onError=onError; this.onWarning=onWarning; this.gameId=gameId; this.systemId=systemId; this.systemLabel=systemLabel; this.coreId=coreId; this.documentOptions={ extraFiles, retroarchConfig, coreOptions, shader }; this.keyToButton=KEY_TO_BUTTON; this.engineName=`EmulatorJS · ${systemLabel}`; this.romInfo=null;
    this.frame=null; this.romUrl=null; this.started=false; this.destroyed=false; this.held=new Map(); this.timer=null; this.resolveStart=null; this.rejectStart=null;
    this.boundMessage=event=>this.handleMessage(event); this.boundKeyDown=event=>this.handleKey(event,true); this.boundKeyUp=event=>this.handleKey(event,false); this.boundBlur=()=>this.releaseAllButtons(); this.frameWindow=null; this.boundFrameLoad=()=>{const win=this.frame?.contentWindow;if(!win)return;win.removeEventListener('keydown',this.boundKeyDown,true);win.removeEventListener('keyup',this.boundKeyUp,true);this.frameWindow=win;win.addEventListener('keydown',this.boundKeyDown,true);win.addEventListener('keyup',this.boundKeyUp,true);};
    document.addEventListener('keydown',this.boundKeyDown); document.addEventListener('keyup',this.boundKeyUp); window.addEventListener('blur',this.boundBlur);
  }
  loadROM(bytes, gameName='RetroPlay game') {
    if(this.destroyed) return Promise.reject(new Error('Oynatıcı kapatıldı.'));
    if(this.frame) return Promise.reject(new Error('Bu oynatıcıda zaten bir ROM yükleniyor.'));
    // A Blob (an arcade zip) is handed over as it is; bytes are wrapped once.
    const blob=bytes instanceof Blob?bytes:new Blob([bytes instanceof Uint8Array?bytes:new Uint8Array(bytes)],{type:'application/octet-stream'});
    this.romUrl=URL.createObjectURL(blob);
    const frame=document.createElement('iframe'); frame.title=gameName+' — '+this.systemLabel+' emülatörü'; frame.setAttribute('allow','autoplay; fullscreen; gamepad; screen-wake-lock'); frame.referrerPolicy='no-referrer'; frame.style.cssText='display:block;width:100%;height:100%;border:0;background:#000;';
    this.frame=frame; frame.addEventListener('load',this.boundFrameLoad); this.container.replaceChildren(frame); window.addEventListener('message',this.boundMessage);
    return new Promise((resolve,reject)=>{ this.resolveStart=resolve; this.rejectStart=reject; this.timer=window.setTimeout(()=>this.fail(new Error('Emülatör çekirdeği 75 saniye içinde başlamadı. İlk açılışta çekirdek indirilir; bağlantını kontrol edip yeniden dene.')),75000); frame.srcdoc=buildEmulatorDocument(this.romUrl,gameName,this.systemId,this.gameId,this.coreId,this.documentOptions); });
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
    if (this.coreId === 'mame2003_plus') return null;
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
      try { emu.setVolume?.(0); } catch {}
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
      try { gm.toggleFastForward(0); } catch {}
      try { gm.setFastForwardRatio?.(3); } catch {}
      try { gm.functions?.setVSync?.(1); } catch {}
      try { emu.setVolume?.(volume); } catch {}
    }
  }
  /** Switches the shader of the running game (display mode); returns false if it is not possible. */
  setShader(name) {
    const emu = this.frame?.contentWindow?.EJS_emulator;
    if (!this.started || this.destroyed || typeof emu?.enableShader !== 'function') return false;
    try { emu.enableShader(safeShader(name)); return true; }
    catch (error) { try { this.onWarning(`Görüntü modu uygulanamadı: ${error?.message || error}`); } catch {} return false; }
  }
  /** Soft-resets the running game; battery-backed RAM is preserved by the core. */
  restartGame() {
    const gm = this.frame?.contentWindow?.EJS_emulator?.gameManager;
    if (!this.started || this.destroyed || typeof gm?.restart !== 'function') return false;
    gm.restart();
    return true;
  }
  handleKey(event, pressed) {
    if (!this.started || this.destroyed || this.container.closest('#player-modal')?.classList.contains('hidden')) return;
    if (event.altKey || event.metaKey || (event.ctrlKey && event.code !== 'ControlRight')) return;
    const targetTag = event.target?.tagName?.toLowerCase();
    if (targetTag === 'input' || targetTag === 'textarea' || targetTag === 'select' || event.target?.isContentEditable) return;
    const name = this.keyToButton[event.code] || (event.key === 'Control' && event.location === 2 ? 'BUTTON_SELECT' : null);
    if (!name) return;
    event.preventDefault();
    // The iframe's own default keyboard handler must not process the same key a second time.
    event.stopPropagation?.();
    if (pressed) this.pressButton(name, 'keyboard'); else this.releaseButton(name, 'keyboard');
  }
  pressButton(name, source = 'pointer') {
    const index = INPUT_INDEX[name], gm = this.frame?.contentWindow?.EJS_emulator?.gameManager;
    if (index === undefined || !this.started || !gm) return;
    let sources = this.held.get(index);
    if (!sources) { sources = new Set(); this.held.set(index, sources); gm.simulateInput(0, index, 1); }
    sources.add(source);
  }
  releaseButton(name, source = 'pointer') {
    const index = INPUT_INDEX[name], gm = this.frame?.contentWindow?.EJS_emulator?.gameManager, sources = this.held.get(index);
    if (index === undefined || !sources) return;
    sources.delete(source);
    if (sources.size === 0) { this.held.delete(index); if (gm) gm.simulateInput(0, index, 0); }
  }
  releaseAllButtons() {
    const gm = this.frame?.contentWindow?.EJS_emulator?.gameManager;
    if (gm) for (const index of this.held.keys()) gm.simulateInput(0, index, 0);
    this.held.clear();
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
    this.frame?.removeEventListener('load', this.boundFrameLoad);
    this.frameWindow?.removeEventListener('keydown', this.boundKeyDown, true);
    this.frameWindow?.removeEventListener('keyup', this.boundKeyUp, true);
    this.frameWindow = null;
    const reject = this.rejectStart; this.resolveStart = null; this.rejectStart = null;
    if (!this.started) reject?.(new Error('Oyun açılışı iptal edildi.'));
    try { this.frame?.contentWindow?.EJS_emulator?.pause(); } catch {}
    this.frame?.remove(); this.frame = null;
    if (this.romUrl) URL.revokeObjectURL(this.romUrl);
    this.romUrl = null; this.held.clear();
  }
}

// Backward-compatible NES name for existing callers and tests.
export class EmulatorJsNesPlayer extends EmulatorJsPlayer {
  constructor(container, options = {}) {
    super(container, { ...options, systemId: 'nes', systemLabel: 'NES' });
  }
}
