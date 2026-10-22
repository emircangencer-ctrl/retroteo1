const DATA_PATH = 'https://cdn.emulatorjs.org/stable/data/';
const INPUT_INDEX = Object.freeze({ BUTTON_B: 0, BUTTON_SELECT: 2, BUTTON_START: 3, BUTTON_UP: 4, BUTTON_DOWN: 5, BUTTON_LEFT: 6, BUTTON_RIGHT: 7, BUTTON_A: 8 });
const HIDDEN_BUTTONS = { playPause:false, play:false, pause:false, restart:false, mute:false, unmute:false, volumeSlider:false, settings:false, fullscreen:false, enterFullscreen:false, exitFullscreen:false, saveState:false, loadState:false, quickSave:false, quickLoad:false, screenshot:false, gamepad:false, cheat:false, cacheManager:false, exitEmulation:false, netplay:false, diskButton:false, contextMenu:false, saveSavFiles:false, loadSavFiles:false };
const literal = value => JSON.stringify(value).replace(/</g, '\\u003c');
function buildDocument(gameUrl, gameName) {
  const startup = [
    '(() => {',
    "const notify = (type, details = {}) => parent.postMessage({ source: 'retroplay-emulatorjs', type, ...details }, '*');",
    "window.addEventListener('error', event => notify('error', { message: event && event.message ? event.message : 'Emülatör betiği yüklenemedi.' }));",
    "window.addEventListener('unhandledrejection', event => notify('error', { message: String(event.reason && event.reason.message || event.reason || 'Emülatör başlatılamadı.') }));",
    "window.EJS_player = '#ejs-player';",
    'window.EJS_startOnLoaded = true;',
    "window.EJS_core = 'fceumm';",
    'window.EJS_pathtodata = ' + literal(DATA_PATH) + ';',
    'window.EJS_gameUrl = ' + literal(gameUrl) + ';',
    'window.EJS_gameName = ' + literal(gameName) + ';',
    'window.EJS_volume = 0.7;',
    'window.EJS_Buttons = ' + literal(HIDDEN_BUTTONS) + ';',
    "window.EJS_onGameStart = () => { const css = document.createElement('style'); css.textContent = 'html,body,#ejs-player{margin:0!important;padding:0!important;width:100%!important;height:100%!important;overflow:hidden!important;background:#000!important}#ejs-player .ejs_parent{position:relative!important;width:100%!important;height:100%!important;min-height:0!important;background:#000!important}#ejs-player .ejs_canvas_parent{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;display:flex!important;align-items:center!important;justify-content:center!important;background:#000!important}#ejs-player canvas{display:block!important;width:100%!important;height:100%!important;max-width:100%!important;max-height:100%!important;image-rendering:pixelated!important}.ejs_virtualGamepad_parent,.ejs_menu,.ejs_bottom_bar,.ejs_menu_button,.ejs_start_button,.ejs_contextMenu,.ejs_control_bar{display:none!important}'; document.head.appendChild(css); notify('started'); };",
    "window.EJS_onExit = () => notify('exit');",
    "const loader = document.createElement('script'); loader.src = " + literal(DATA_PATH + 'loader.js') + "; loader.onerror = () => notify('error', { message: 'EmulatorJS yüklenemedi. İnternet bağlantısını kontrol et.' }); document.head.appendChild(loader);",
    '})();'
  ].join('\n');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>RetroPlay NES runtime</title></head><body style="margin:0;background:#000;overflow:hidden"><div id="ejs-player"></div><script>' + startup + '</script></body></html>';
}
export class EmulatorJsNesPlayer {
  constructor(container, { onError = () => {} } = {}) {
    this.container=container; this.onError=onError; this.engineName='EmulatorJS · FCEUmm'; this.romInfo=null;
    this.frame=null; this.romUrl=null; this.started=false; this.destroyed=false; this.held=new Set(); this.timer=null; this.resolveStart=null; this.rejectStart=null;
    this.boundMessage=event=>this.handleMessage(event);
  }
  loadROM(bytes, gameName='NES game') {
    if(this.destroyed) return Promise.reject(new Error('Oynatıcı kapatıldı.'));
    if(this.frame) return Promise.reject(new Error('Bu oynatıcıda zaten bir ROM yükleniyor.'));
    const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
    this.romUrl=URL.createObjectURL(new Blob([data],{type:'application/octet-stream'}));
    const frame=document.createElement('iframe'); frame.title=gameName+' — NES emülatörü'; frame.setAttribute('allow','autoplay; fullscreen; gamepad'); frame.referrerPolicy='no-referrer'; frame.style.cssText='display:block;width:100%;height:100%;border:0;background:#000;';
    this.frame=frame; this.container.replaceChildren(frame); window.addEventListener('message',this.boundMessage);
    return new Promise((resolve,reject)=>{ this.resolveStart=resolve; this.rejectStart=reject; this.timer=window.setTimeout(()=>this.fail(new Error('NES çekirdeği 75 saniye içinde başlamadı. İnternet bağlantısını kontrol edip yeniden dene.')),75000); frame.srcdoc=buildDocument(this.romUrl,gameName); });
  }
  handleMessage(event) {
    if(!this.frame||event.source!==this.frame.contentWindow||!event.data||event.data.source!=='retroplay-emulatorjs')return;
    const data=event.data;
    if(data.type==='started'){ this.started=true; window.clearTimeout(this.timer); this.timer=null; const resolve=this.resolveStart; this.resolveStart=null; this.rejectStart=null; resolve?.(true); }
    else if(data.type==='error') this.fail(new Error(data.message||'EmulatorJS başlatılamadı.'));
    else if(data.type==='exit'&&!this.destroyed)this.onError(new Error('Emülatör oturumu kapandı.'));
  }
  fail(error){ if(this.destroyed)return; window.clearTimeout(this.timer); this.timer=null; const reject=this.rejectStart; this.resolveStart=null; this.rejectStart=null; this.onError(error); reject?.(error); }
  pause(){const e=this.frame?.contentWindow?.EJS_emulator;if(!this.started||!e)throw new Error('Emülatör henüz hazır değil.');e.pause();}
  resume(){const e=this.frame?.contentWindow?.EJS_emulator;if(!this.started||!e)throw new Error('Emülatör henüz hazır değil.');e.play();}
  pressButton(name){const index=INPUT_INDEX[name],gm=this.frame?.contentWindow?.EJS_emulator?.gameManager;if(index===undefined||!this.started||!gm||this.held.has(index))return;this.held.add(index);gm.simulateInput(0,index,1);}
  releaseButton(name){const index=INPUT_INDEX[name],gm=this.frame?.contentWindow?.EJS_emulator?.gameManager;if(index===undefined||!this.held.has(index))return;this.held.delete(index);if(gm)gm.simulateInput(0,index,0);}
  destroy(){if(this.destroyed)return;this.destroyed=true;window.clearTimeout(this.timer);window.removeEventListener('message',this.boundMessage);const reject=this.rejectStart;this.resolveStart=null;this.rejectStart=null;if(!this.started)reject?.(new Error('Oyun açılışı iptal edildi.'));try{this.frame?.contentWindow?.EJS_emulator?.pause();}catch{}this.frame?.remove();this.frame=null;if(this.romUrl)URL.revokeObjectURL(this.romUrl);this.romUrl=null;this.held.clear();}
}
