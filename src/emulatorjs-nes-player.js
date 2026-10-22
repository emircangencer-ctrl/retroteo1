const DATA_PATH = 'https://cdn.emulatorjs.org/4.2.3/data/';
export const EMULATORJS_INPUT_INDEX = Object.freeze({ BUTTON_B: 0, BUTTON_Y: 1, BUTTON_SELECT: 2, BUTTON_START: 3, BUTTON_UP: 4, BUTTON_DOWN: 5, BUTTON_LEFT: 6, BUTTON_RIGHT: 7, BUTTON_A: 8, BUTTON_X: 9, BUTTON_L: 10, BUTTON_R: 11 });
const INPUT_INDEX = EMULATORJS_INPUT_INDEX;
const KEY_TO_BUTTON = Object.freeze({ ArrowUp:'BUTTON_UP', ArrowDown:'BUTTON_DOWN', ArrowLeft:'BUTTON_LEFT', ArrowRight:'BUTTON_RIGHT', KeyZ:'BUTTON_B', KeyX:'BUTTON_A', KeyA:'BUTTON_Y', KeyS:'BUTTON_X', KeyQ:'BUTTON_L', KeyW:'BUTTON_R', Enter:'BUTTON_START', ControlRight:'BUTTON_SELECT' });
const ALLOWED_SYSTEM_IDS = new Set(['nes', 'snes', 'segaMD']);
const HIDDEN_BUTTONS = { playPause:false, play:false, pause:false, restart:false, mute:false, unmute:false, volumeSlider:false, settings:false, fullscreen:false, enterFullscreen:false, exitFullscreen:false, saveState:false, loadState:false, quickSave:false, quickLoad:false, screenshot:false, gamepad:false, cheat:false, cacheManager:false, exitEmulation:false, netplay:false, diskButton:false, contextMenu:false, saveSavFiles:false, loadSavFiles:false };
const literal = value => JSON.stringify(value).replace(/</g, '\\u003c');
export function buildEmulatorDocument(gameUrl, gameName, systemId = 'nes', gameId = 1) {
  if (!ALLOWED_SYSTEM_IDS.has(systemId)) throw new TypeError(`Unsupported EmulatorJS system: ${systemId}`);
  if (!Number.isSafeInteger(gameId) || gameId < 1) throw new TypeError('EmulatorJS game ID must be a positive safe integer.');
  const startup = [
    '(() => {',
    "const notify = (type, details = {}, transfer = []) => parent.postMessage({ source: 'retroplay-emulatorjs', type, ...details }, '*', transfer);",
    "window.addEventListener('error', event => notify('error', { message: event && event.message ? event.message : 'Emülatör betiği yüklenemedi.' }));",
    "window.addEventListener('unhandledrejection', event => notify('error', { message: String(event.reason && event.reason.message || event.reason || 'Emülatör başlatılamadı.') }));",
    "window.EJS_player = '#ejs-player';",
    'window.EJS_startOnLoaded = true;',
    'window.EJS_core = ' + literal(systemId) + ';',
    'window.EJS_pathtodata = ' + literal(DATA_PATH) + ';',
    'window.EJS_gameUrl = ' + literal(gameUrl) + ';',
    'window.EJS_gameName = ' + literal(gameName) + ';',
    'window.EJS_gameID = ' + String(gameId) + ';',
    'window.EJS_fixedSaveInterval = 15000;',
    "window.EJS_onSaveUpdate = event => { if (!event || event.save == null) return; const send = buffer => { const copy = buffer.slice(0); notify('save-update', { hash: String(event.hash || ''), saveBuffer: copy }, [copy]); }; const save = event.save; if (save instanceof ArrayBuffer) send(save); else if (ArrayBuffer.isView(save)) send(save.buffer.slice(save.byteOffset, save.byteOffset + save.byteLength)); else if (typeof Blob !== 'undefined' && save instanceof Blob) save.arrayBuffer().then(send).catch(error => notify('error', { message: 'Oyun kaydı okunamadı: ' + String(error && error.message || error) })); };",
    'window.EJS_volume = 0.7;',
    'window.EJS_Buttons = ' + literal(HIDDEN_BUTTONS) + ';',
    "window.EJS_onGameStart = () => { const emu = window.EJS_emulator; const missing = []; if (typeof emu?.gameManager?.simulateInput !== 'function') missing.push('kontrol desteği'); if (typeof emu?.pause !== 'function') missing.push('duraklatma'); if (typeof emu?.play !== 'function') missing.push('devam etme'); if (missing.length) { notify('error', { message: 'EmulatorJS yüklendi ancak gerekli API eksik: ' + missing.join(', ') + '. Çalışma zamanı ile kontrol katmanı uyumsuz.' }); return; } const css = document.createElement('style'); css.textContent = 'html,body,#ejs-player{margin:0!important;padding:0!important;width:100%!important;height:100%!important;overflow:hidden!important;background:#000!important}#ejs-player .ejs_parent{position:relative!important;width:100%!important;height:100%!important;min-height:0!important;background:#000!important}#ejs-player .ejs_canvas_parent{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;display:flex!important;align-items:center!important;justify-content:center!important;background:#000!important}#ejs-player canvas{display:block!important;width:100%!important;height:100%!important;max-width:100%!important;max-height:100%!important;image-rendering:pixelated!important}.ejs_virtualGamepad_parent,.ejs_virtualGamepad_open,.ejs_menu_bar,.ejs_menu,.ejs_volume_parent,.ejs_bottom_bar,.ejs_menu_button,.ejs_start_button,.ejs_contextMenu,.ejs_control_bar{display:none!important}'; document.head.appendChild(css); notify('started'); };",
    "window.EJS_onExit = () => notify('exit');",
    "const loader = document.createElement('script'); loader.src = " + literal(DATA_PATH + 'loader.js') + "; loader.onerror = () => notify('error', { message: 'EmulatorJS yüklenemedi. İnternet bağlantısını kontrol et.' }); document.head.appendChild(loader);",
    '})();'
  ].join('\n');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>RetroPlay NES runtime</title></head><body style="margin:0;background:#000;overflow:hidden"><div id="ejs-player"></div><script>' + startup + '</script></body></html>';
}
export class EmulatorJsPlayer {
  constructor(container, { onError = () => {}, onSaveUpdate = () => {}, gameId = 1, systemId = 'nes', systemLabel = 'NES' } = {}) {
    if (!ALLOWED_SYSTEM_IDS.has(systemId)) throw new TypeError(`Unsupported EmulatorJS system: ${systemId}`);
    if (!Number.isSafeInteger(gameId) || gameId < 1) throw new TypeError('EmulatorJS game ID must be a positive safe integer.');
    this.container=container; this.onError=onError; this.onSaveUpdate=onSaveUpdate; this.gameId=gameId; this.systemId=systemId; this.systemLabel=systemLabel; this.keyToButton=KEY_TO_BUTTON; this.engineName=`EmulatorJS · ${systemLabel}`; this.romInfo=null;
    this.frame=null; this.romUrl=null; this.started=false; this.destroyed=false; this.held=new Map(); this.timer=null; this.resolveStart=null; this.rejectStart=null;
    this.boundMessage=event=>this.handleMessage(event); this.boundKeyDown=event=>this.handleKey(event,true); this.boundKeyUp=event=>this.handleKey(event,false); this.boundBlur=()=>this.releaseAllButtons(); this.frameWindow=null; this.boundFrameLoad=()=>{const win=this.frame?.contentWindow;if(!win)return;win.removeEventListener('keydown',this.boundKeyDown,true);win.removeEventListener('keyup',this.boundKeyUp,true);this.frameWindow=win;win.addEventListener('keydown',this.boundKeyDown,true);win.addEventListener('keyup',this.boundKeyUp,true);};
    document.addEventListener('keydown',this.boundKeyDown); document.addEventListener('keyup',this.boundKeyUp); window.addEventListener('blur',this.boundBlur);
  }
  loadROM(bytes, gameName='NES game') {
    if(this.destroyed) return Promise.reject(new Error('Oynatıcı kapatıldı.'));
    if(this.frame) return Promise.reject(new Error('Bu oynatıcıda zaten bir ROM yükleniyor.'));
    const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
    this.romUrl=URL.createObjectURL(new Blob([data],{type:'application/octet-stream'}));
    const frame=document.createElement('iframe'); frame.title=gameName+' — '+this.systemLabel+' emülatörü'; frame.setAttribute('allow','autoplay; fullscreen; gamepad'); frame.referrerPolicy='no-referrer'; frame.style.cssText='display:block;width:100%;height:100%;border:0;background:#000;';
    this.frame=frame; frame.addEventListener('load',this.boundFrameLoad); this.container.replaceChildren(frame); window.addEventListener('message',this.boundMessage);
    return new Promise((resolve,reject)=>{ this.resolveStart=resolve; this.rejectStart=reject; this.timer=window.setTimeout(()=>this.fail(new Error('NES çekirdeği 75 saniye içinde başlamadı. İnternet bağlantısını kontrol edip yeniden dene.')),75000); frame.srcdoc=buildEmulatorDocument(this.romUrl,gameName,this.systemId,this.gameId); });
  }
  handleMessage(event) {
    if(!this.frame||event.source!==this.frame.contentWindow||!event.data||event.data.source!=='retroplay-emulatorjs')return;
    const data=event.data;
    if(data.type==='started'){ this.started=true; window.clearTimeout(this.timer); this.timer=null; const resolve=this.resolveStart; this.resolveStart=null; this.rejectStart=null; resolve?.(true); }
    else if(data.type==='error') this.fail(new Error(data.message||'EmulatorJS başlatılamadı.'));
    else if(data.type==='save-update' && data.saveBuffer instanceof ArrayBuffer) {
      try {
        this.onSaveUpdate({
          hash: String(data.hash || ''),
          bytes: new Uint8Array(data.saveBuffer),
          updatedAt: Date.now(),
          gameId: this.gameId,
          systemId: this.systemId
        });
      } catch(error) {
        this.onError(error instanceof Error ? error : new Error(String(error)));
      }
    }
    else if(data.type==='exit'&&!this.destroyed)this.onError(new Error('Emülatör oturumu kapandı.'));
  }
  fail(error){ if(this.destroyed)return; window.clearTimeout(this.timer); this.timer=null; const reject=this.rejectStart; this.resolveStart=null; this.rejectStart=null; this.onError(error); reject?.(error); }
  fitInParent(){try{this.frame?.contentWindow?.EJS_emulator?.frontend?.handleResize?.();}catch{}}
  pause(){const e=this.frame?.contentWindow?.EJS_emulator;if(!this.started||!e)throw new Error('Emülatör henüz hazır değil.');this.releaseAllButtons();e.pause();}
  resume(){const e=this.frame?.contentWindow?.EJS_emulator;if(!this.started||!e)throw new Error('Emülatör henüz hazır değil.');e.play();}
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
