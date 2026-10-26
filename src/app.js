import { inspectNesRom, diagnoseSuperMarioBros3Rom, isSuperMarioBros3LaunchAllowed } from './nes-rom.js';
import { PLATFORM, platformInfo } from './platforms.js';
import { safeCoverColor, validBackup } from './library-backup.js';
import { extractRomFilesFromZip, readZipDirectory } from './zip-rom.js';
import { ARCADE_CORES, loadCatalogs, identifyArcadeZip, arcadeLayout, describeArcadeStatus, onlyKeysMissing, isCps2KeyMissing, keyFindings, missingSummary } from './arcade.js';
import { EmulatorJsPlayer } from './emulatorjs-nes-player.js';
import { getEmulatedSystem, isPlayablePlatform, supportsRomExtension } from './emulator-systems.js';
import { createBatterySaveRecord, emulatorGameId } from './save-data.js';
import { createSaveCapture, decideSaveRestore } from './save-sync.js';
import { classifyImport } from './import-match.js';
import { detectRomPlatform } from './rom-detect.js';
import { inspectGamepads, describeGamepads } from './gamepad-status.js';
import { fullscreenElement, isFullscreen, enterFullscreen, leaveFullscreen } from './fullscreen.js';
import { watchServiceWorkerUpdates, activateUpdate, summarizeRuntimeCache } from './sw-update.js';
import { DISPLAY_MODES, DISPLAY_MODE_STORAGE_KEY, normalizeDisplayMode, nextDisplayMode, displayStartOptions } from './display-modes.js';
import { describeResult, paceWarning, deviceSummary, loadHistory, addToHistory, historyReport, PERF_HISTORY_KEY } from './performance-meter.js';
import { getDriveClientId, loadGoogleIdentity, requestDriveAccessToken, listDriveFiles, downloadDriveFile, isDriveFolder, isSupportedDriveGame } from './google-drive.js';
import './styles.css';
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const DB_NAME = 'retroplay-local-v1';
const DB_VERSION = 4;
const STORE = 'games';
const SAVE_STORE = 'batterySaves';
const STATE_STORE = 'saveStates';
const BIOS_STORE = 'bios';
const DEMO_GAMES = [
  {id:'demo-mario',title:'Super Mario Bros. 3',platform:'NES',year:1988,genre:'Platform',symbol:'M',coverBg:'#244a78',coverGlow:'#e15b45',sizeLabel:'384 KB',demo:true,favorite:true,addedAt:5},
  {id:'demo-zelda',title:'The Legend of Zelda',platform:'NES',year:1986,genre:'Adventure',symbol:'Z',coverBg:'#5b4525',coverGlow:'#e2b65c',sizeLabel:'128 KB',demo:true,favorite:false,addedAt:4},
  {id:'demo-sonic',title:'Sonic the Hedgehog 2',platform:'MD',year:1992,genre:'Platform',symbol:'S',coverBg:'#1e4777',coverGlow:'#39a9e9',sizeLabel:'1 MB',demo:true,favorite:true,addedAt:3},
  {id:'demo-street',title:'Street Fighter II',platform:'SNES',year:1992,genre:'Fighting',symbol:'Ⅱ',coverBg:'#762f37',coverGlow:'#ef9d4d',sizeLabel:'2 MB',demo:true,favorite:false,addedAt:2},
  {id:'demo-goldeneye',title:'GoldenEye 007',platform:'N64',year:1997,genre:'Shooter',symbol:'007',coverBg:'#5a4930',coverGlow:'#b9a16a',sizeLabel:'12 MB',demo:true,favorite:false,addedAt:1},
  {id:'demo-metal',title:'Metal Slug',platform:'ARCADE',year:1996,genre:'Run & gun',symbol:'MS',coverBg:'#354b3a',coverGlow:'#b3bd55',sizeLabel:'—',demo:true,favorite:false,addedAt:0}
];
let db;
let games = [];
let selectedPlatform = 'ALL';
let layoutMode = 'grid';
const GRID_PAGE_SIZE = 48;
let libraryVisibleLimit = GRID_PAGE_SIZE;
let favoriteVisibleLimit = GRID_PAGE_SIZE;
let recentVisibleLimit = GRID_PAGE_SIZE;
let toastTimer;
let activeEmulator = null;
let activeGameId = null;
let emulatorSession = 0;
let emulatorPaused = false;
let batterySaveIds = new Set();
let resumeStateIds = new Set();
let activeCoreId = null;
let playerNoticeTimer = 0;
let libraryRenderFrame = 0;
let driveAccessToken = '';
let driveCurrentFolder = 'root';
let driveFolderStack = [{ id: 'root', name: 'Drive' }];
let driveNextPageToken = '';
let driveVisibleFiles = [];
let driveListingGeneration = 0;
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';
const SAVE_CAPTURE_INTERVAL_MS = 30000;
const SYSTEM_CORE_LABELS = Object.freeze({ NES: 'Nestopia', SNES: 'Snes9x', MD: 'Genesis Plus GX', ARCADE: 'FinalBurn Neo / MAME 2003-Plus' });
let saveCapture = null;
let saveTimer = 0;
let displayMode = loadDisplayMode();
let activeDisplayStart = null;
let perfRunning = false;
function renderPerfHistory() {
  const el = $('#perf-history');
  if (el) el.textContent = historyReport(loadHistory());
}
/** Runs the performance meter on the running game and keeps the result for Settings. */
async function runPerformanceTest() {
  const game = games.find(g => g.id === activeGameId && !g.demo);
  if (!game || perfRunning || typeof activeEmulator?.benchmark !== 'function') return;
  if (emulatorPaused) { showPlayerNotice('Ölçüm için önce oyunu devam ettir'); return; }
  perfRunning = true;
  const button = $('#perf-test');
  if (button) button.disabled = true;
  const player = activeEmulator;
  showPlayerNotice('Performans ölçülüyor… yaklaşık 7 saniye', { timeout: 9000 });
  try {
    const normalFps = await player.measurePace({ ms: 2000 });
    const result = activeEmulator === player ? await player.benchmark({ seconds: 4 }) : null;
    if (activeEmulator !== player) return;
    if (!result) { showPlayerNotice('Performans ölçülemedi'); return; }
    const entry = { at: Date.now(), title: game.title, platform: game.platform, core: activeCoreId || '', headroom: result.headroom, fps: result.fps, normalFps, ...deviceSummary() };
    addToHistory(entry);
    renderPerfHistory();
    const warning = paceWarning(normalFps);
    showPlayerNotice(warning ? `${describeResult(entry)} · ${warning}` : describeResult(entry), { timeout: 10000 });
  } finally {
    perfRunning = false;
    if (button) button.disabled = !activeEmulator;
  }
}
function loadDisplayMode() {
  try { return normalizeDisplayMode(localStorage.getItem(DISPLAY_MODE_STORAGE_KEY)); } catch { return normalizeDisplayMode(null); }
}
function updateDisplayModeUi() {
  const label = DISPLAY_MODES[displayMode].label;
  const button = $('#display-mode');
  if (button) { button.textContent = `Görüntü: ${label}`; button.setAttribute('aria-label', `Görüntü modu: ${label}. Değiştirmek için dokun.`); }
  const select = $('#display-mode-setting');
  if (select) select.value = displayMode;
}
/** Changes the display mode, applies it to the running game when possible and remembers it. */
function setDisplayMode(mode) {
  displayMode = normalizeDisplayMode(mode);
  try { localStorage.setItem(DISPLAY_MODE_STORAGE_KEY, displayMode); } catch {}
  updateDisplayModeUi();
  if (!activeEmulator?.setShader || $('#player-modal').classList.contains('hidden')) return;
  activeEmulator.setShader(displayStartOptions(displayMode).shader);
  const needsRestart = activeDisplayStart && DISPLAY_MODES[displayMode].integer !== DISPLAY_MODES[activeDisplayStart].integer;
  showPlayerNotice(needsRestart ? `Görüntü: ${DISPLAY_MODES[displayMode].label} · tam sayı ölçek oyun yeniden açılınca değişir` : `Görüntü: ${DISPLAY_MODES[displayMode].label}`, { timeout: needsRestart ? 3500 : 1600 });
}
let autoPaused = false;

function openDB(){return new Promise((resolve,reject)=>{if(!('indexedDB' in window)){reject(new Error('Bu tarayıcı IndexedDB desteklemiyor.'));return;}const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=()=>{const d=req.result;if(!d.objectStoreNames.contains(STORE)){const st=d.createObjectStore(STORE,{keyPath:'id'});st.createIndex('addedAt','addedAt');st.createIndex('platform','platform');}if(!d.objectStoreNames.contains(SAVE_STORE))d.createObjectStore(SAVE_STORE,{keyPath:'id'});if(!d.objectStoreNames.contains(STATE_STORE)){const states=d.createObjectStore(STATE_STORE,{keyPath:'id'});states.createIndex('gameId','gameId');}if(!d.objectStoreNames.contains(BIOS_STORE))d.createObjectStore(BIOS_STORE,{keyPath:'id'});};req.onsuccess=()=>{const opened=req.result;opened.onversionchange=()=>opened.close();resolve(opened);};req.onerror=()=>reject(req.error||new Error('Yerel veritabanı açılamadı.'));});}
function txStore(mode='readonly'){return db.transaction(STORE,mode).objectStore(STORE)}
function allStored(){return new Promise((resolve,reject)=>{const r=txStore().getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error);});}
function allBatterySaves(){return new Promise((resolve,reject)=>{const tx=db.transaction(SAVE_STORE,'readonly');const r=tx.objectStore(SAVE_STORE).getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error||new Error('Batarya yedekleri okunamadı.'));});}
function getBatterySave(id){return new Promise((resolve,reject)=>{const tx=db.transaction(SAVE_STORE,'readonly');const r=tx.objectStore(SAVE_STORE).get(id);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error||new Error('Batarya yedeği okunamadı.'));});}
function saveGame(game){return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(game);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error||new Error('Oyun kaydı yazılamadı.'));tx.onabort=()=>reject(tx.error||new Error('Kayıt işlemi iptal edildi.'));});}
function saveBatteryBackup(game, update){
  if(!db)return Promise.reject(new Error('Yerel veritabanı hazır değil.'));
  const record=createBatterySaveRecord(game,update,getEmulatedSystem(game.platform)?.emulatorJsSystemId);
  if(!record)return Promise.resolve(false);
  return new Promise((resolve,reject)=>{
    let tx;
    try{
      tx=db.transaction(SAVE_STORE,'readwrite');
      tx.objectStore(SAVE_STORE).put(record);
    }catch(error){reject(error);return;}
    tx.oncomplete=()=>resolve(true);
    tx.onerror=()=>reject(tx.error||new Error('Batarya kaydı yerel olarak yedeklenemedi.'));
    tx.onabort=()=>reject(tx.error||new Error('Batarya kaydı yedekleme işlemi iptal edildi.'));
  });
}
function deleteGame(id){return new Promise((resolve,reject)=>{const tx=db.transaction([STORE,SAVE_STORE,STATE_STORE],'readwrite');tx.objectStore(STORE).delete(id);tx.objectStore(SAVE_STORE).delete(id);for(const slot of STATE_SLOTS)tx.objectStore(STATE_STORE).delete(stateKey(id,slot));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('Oyun ve kayıtları silinemedi.'));tx.onabort=()=>reject(tx.error||new Error('Silme işlemi iptal edildi.'));});}
const STATE_SLOTS=Object.freeze(['auto','quick']);
function stateKey(gameId,slot){return `${gameId}:${slot}`;}
function putSaveState(record){return new Promise((resolve,reject)=>{let tx;try{tx=db.transaction(STATE_STORE,'readwrite');tx.objectStore(STATE_STORE).put(record);}catch(error){reject(error);return;}tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error||new Error('Kayıt noktası yazılamadı.'));tx.onabort=()=>reject(tx.error||new Error('Kayıt noktası yazma işlemi iptal edildi.'));});}
function getSaveState(gameId,slot){return new Promise((resolve,reject)=>{const r=db.transaction(STATE_STORE,'readonly').objectStore(STATE_STORE).get(stateKey(gameId,slot));r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error||new Error('Kayıt noktası okunamadı.'));});}
function allSaveStateKeys(){return new Promise((resolve,reject)=>{const r=db.transaction(STATE_STORE,'readonly').objectStore(STATE_STORE).getAllKeys();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error||new Error('Kayıt noktaları okunamadı.'));});}
function allBios(){return new Promise((resolve,reject)=>{const r=db.transaction(BIOS_STORE,'readonly').objectStore(BIOS_STORE).getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error||new Error('BIOS dosyaları okunamadı.'));});}
function getBios(id){return new Promise((resolve,reject)=>{const r=db.transaction(BIOS_STORE,'readonly').objectStore(BIOS_STORE).get(id);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error||new Error('BIOS dosyası okunamadı.'));});}
function putBios(record){return new Promise((resolve,reject)=>{let tx;try{tx=db.transaction(BIOS_STORE,'readwrite');tx.objectStore(BIOS_STORE).put(record);}catch(error){reject(error);return;}tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error||new Error('BIOS dosyası kaydedilemedi.'));tx.onabort=()=>reject(tx.error||new Error('BIOS kaydı iptal edildi.'));});}
function deleteBios(id){return new Promise((resolve,reject)=>{const tx=db.transaction(BIOS_STORE,'readwrite');tx.objectStore(BIOS_STORE).delete(id);tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error||new Error('BIOS dosyası silinemedi.'));});}
let biosIds=new Set();
/** Settings → BIOS dosyaları: what is installed and what Neo Geo games still need. */
async function renderBiosList(){
  const el=$('#bios-list');
  if(!el||!db)return;
  let records=[];
  try{records=await allBios();}catch{}
  biosIds=new Set(records.map(record=>record.id));
  const rows=records.sort((a,b)=>a.id.localeCompare(b.id)).map(record=>`<div class="bios-row"><div><strong>${esc(record.id)}</strong><small>${esc(record.label||'BIOS')} · ${formatBytes(record.size)} · ${record.missing?.length?`eksik dosya: ${esc(record.missing.join(', '))}`:'kullanıma hazır'}</small></div><button type="button" class="text-button remove-game" data-remove-bios="${esc(record.id)}">Kaldır</button></div>`);
  if(!biosIds.has('neogeo.zip'))rows.push('<div class="bios-row missing"><div><strong>neogeo.zip</strong><small>Neo Geo oyunları için gerekli · henüz eklenmedi</small></div></div>');
  el.innerHTML=rows.join('');
}
async function removeBios(id){
  if(!confirm(`${id} bu cihazdan silinsin mi? Bu BIOS'u kullanan oyunlar, dosyayı yeniden ekleyene kadar açılmaz.`))return;
  try{await deleteBios(id);await renderBiosList();renderAll();showToast(`${id} silindi.`);}catch(error){showToast(`Silinemedi: ${error?.message||error}`,'error');}
}
function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function showToast(message,type='success'){const el=$('#toast');el.textContent=message;el.className=`toast show ${type}`;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.className='toast',3600);}

function getFileExt(name){const i=name.lastIndexOf('.');return i>=0?name.slice(i+1).toLowerCase():'';}
async function sha256File(file){if(!globalThis.crypto?.subtle||file.size>256*1024*1024)return null;const bytes=await file.arrayBuffer();const digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');}
function storageErrorMessage(error){if(error?.name==='QuotaExceededError')return 'Tarayıcı depolama alanı dolu';if(error?.name==='DataCloneError')return 'Dosya tarayıcı depolamasına aktarılamadı';return error?.message||'Bilinmeyen depolama hatası';}
function renderCard(g){const p=platformInfo(g.platform);const bg=safeCoverColor(g.coverBg,p.color);const glow=safeCoverColor(g.coverGlow,p.glow);const fav=g.favorite?' favorited':'';const size=g.sizeLabel||formatBytes(g.size||0);const canPlay=!g.demo&&isPlayablePlatform(g.platform)&&!g.restoredMetadataOnly&&g.blob instanceof Blob;const actions=g.demo?'':`<div class="game-card-actions">${canPlay?`<button class="button primary small" data-play="${esc(g.id)}">${resumeStateIds.has(g.id)?'▶ Devam et':'▶ Oyna'}</button>`:''}${batterySaveIds.has(g.id)?`<button class="text-button" data-export-sram="${esc(g.id)}">SRAM yedeği indir</button>`:''}${g.restoredMetadataOnly?'':`<button class="text-button" data-export-rom="${esc(g.id)}">ROM dışa aktar</button>`}<button class="text-button remove-game" data-remove="${esc(g.id)}">Kütüphaneden kaldır</button></div>`;const fileLabel=g.demo?'Örnek içerik':g.restoredMetadataOnly?'Yedek kaydı · ROM yok':g.platform==='ARCADE'&&g.arcade?arcadeCardLabel(g.arcade):canPlay?`${p.short} · Oynatılabilir dosya`:'Yerel dosya';return `<article class="game-card" data-game-id="${esc(g.id)}"><div class="game-cover" style="--cover-bg:${esc(bg)};--cover-glow:${esc(glow)}"><span class="cover-tag">${esc(p.short.toUpperCase())}</span><span class="cover-symbol">${esc(g.symbol||p.logo)}</span><button class="favorite-button${fav}" data-favorite="${esc(g.id)}" aria-label="${g.favorite?'Favorilerden çıkar':'Favorilere ekle'}" title="${g.favorite?'Favorilerden çıkar':'Favorilere ekle'}">${g.favorite?'♥':'♡'}</button></div><div class="game-info"><h3 class="game-title" title="${esc(g.title)}">${esc(g.title)}</h3><div class="game-meta"><span>${esc(g.year||'Yıl bilinmiyor')}</span><span class="platform-pill">${esc(p.short)}</span></div><div class="game-foot"><span>${fileLabel}</span><span class="status">${esc(size)}</span></div>${actions}</div></article>`;}
function arcadeCardLabel(arcade){
  if(arcade.bios&&!biosIds.has(`${arcade.bios}.zip`))return `${arcade.bios}.zip gerekli`;
  if(arcade.status==='complete')return `${ARCADE_CORES[arcade.core]?.label||'Arcade'} · tam set`;
  if(arcade.status==='needs-parent')return arcadeParentInstalled(arcade)?`Ana set ${arcade.parent} ile`:`Ana set ${arcade.parent}.zip gerekli`;
  if(onlyKeysMissing(arcade))return arcade.cps2Key===true?'Eksik set · CPS2 anahtarı yok':'Eksik set · şifre anahtarı yok';
  return `Eksik set · ${missingSummary(arcade)}`;
}
function formatBytes(n){if(!Number.isFinite(n)||n<=0)return '—';const units=['B','KB','MB','GB'];const i=Math.min(Math.floor(Math.log(n)/Math.log(1024)),units.length-1);return `${(n/Math.pow(1024,i)).toFixed(i?1:0)} ${units[i]}`;}
function renderSystemTile(key){const p=platformInfo(key);const count=games.filter(g=>g.platform===key).length;return `<button class="system-tile" data-system-filter="${key}"><span class="system-logo">${esc(p.logo)}</span><span><strong>${esc(p.short)}</strong><small>${isPlayablePlatform(key)?(count?`${count} kütüphane kaydı`:'Oynatmaya hazır'):'Yakında'}</small></span></button>`;}
function renderSystemRow(key){const p=platformInfo(key);const count=games.filter(g=>g.platform===key&&!g.demo).length;return `<article class="system-row"><span class="system-logo">${esc(p.logo)}</span><div class="system-row-copy"><strong>${esc(p.short)} <span style="color:#8291aa;font-weight:500">· ${esc(p.label)}</span></strong><p>${key==='ARCADE'?'Oynatıcı hazır · FinalBurn Neo (CPS1, CPS2, CPS3, Neo Geo ve daha fazlası) ve MAME 2003-Plus. Zip dosyası set adıyla tanınır ve çekirdek sürümüyle karşılaştırılır; Neo Geo için neogeo.zip gerekir.':SYSTEM_CORE_LABELS[key]?`Oynatıcı hazır · EmulatorJS / ${SYSTEM_CORE_LABELS[key]}. Oyun uyumluluğu oyun bazında doğrulanır.`:key==='N64'?'Henüz oynatılamaz. Uyumluluk oyun ve cihaz bazında ayrıca test edilecek.':key==='CPS1'||key==='CPS2'||key==='NEOGEO'?'Henüz oynatılamaz. Arcade için çekirdek ve doğru dosya seti gereklidir.':'Henüz oynatılamaz.'}</p></div><span class="system-row-count">${count} yerel oyun</span></article>`;}
function filteredGames({favorites=false,recent=false}={}){let result=[...games];if(favorites)result=result.filter(g=>g.favorite);if(recent)result=result.filter(g=>!g.demo&&g.lastPlayed).sort((a,b)=>(b.lastPlayed||0)-(a.lastPlayed||0));const q=($('#search-input')?.value||'').trim().toLocaleLowerCase('tr-TR');if(q&&$('#view-library').classList.contains('active'))result=result.filter(g=>`${g.title} ${platformInfo(g.platform).short} ${g.fileName||''}`.toLocaleLowerCase('tr-TR').includes(q));if($('#view-library').classList.contains('active')&&selectedPlatform!=='ALL')result=result.filter(g=>g.platform===selectedPlatform);const sort=$('#sort-select')?.value||'recent';if(sort==='name')result.sort((a,b)=>a.title.localeCompare(b.title,'tr'));else if(sort==='platform')result.sort((a,b)=>platformInfo(a.platform).short.localeCompare(platformInfo(b.platform).short)||a.title.localeCompare(b.title,'tr'));else result.sort((a,b)=>(b.addedAt||0)-(a.addedAt||0));return result;}
function fillGrid(el,items){if(!el)return;el.innerHTML=items.map(renderCard).join('');el.classList.toggle('list-layout',layoutMode==='list');}
function renderLibraryResults(){
  const lib=filteredGames();
  const visible=lib.slice(0,libraryVisibleLimit);
  fillGrid($('#library-games'),visible);
  const realCount=games.reduce((count,game)=>count+(!game.demo?1:0),0);
  $('#results-label').textContent=`${visible.length} / ${lib.length} gösteriliyor · ${realCount} içe aktarılmış dosya`;
  $('#empty-state').classList.toggle('hidden',lib.length!==0);
  const more=$('#library-load-more');
  if(more){more.hidden=visible.length>=lib.length;more.textContent=`Daha fazla oyun göster (${Math.min(GRID_PAGE_SIZE,lib.length-visible.length)})`;}
}
function scheduleLibraryRender(){
  if(libraryRenderFrame)cancelAnimationFrame(libraryRenderFrame);
  libraryRenderFrame=requestAnimationFrame(()=>{libraryRenderFrame=0;renderLibraryResults();});
}
function renderAll(){
  $('#library-count').textContent=String(games.length);
  $('#home-games').innerHTML=games.slice().sort((a,b)=>(b.addedAt||0)-(a.addedAt||0)).slice(0,4).map(renderCard).join('');
  $('#home-systems').innerHTML=['NES','SNES','MD','ARCADE','N64'].map(renderSystemTile).join('');
  $('#systems-list').innerHTML=['NES','SNES','MD','ARCADE','N64'].map(renderSystemRow).join('');
  renderLibraryResults();
  const favorites=games.filter(g=>g.favorite);
  fillGrid($('#favorite-games'),favorites.slice(0,favoriteVisibleLimit));
  $('#favorite-empty').classList.toggle('hidden',favorites.length!==0);
  const favoriteMore=$('#favorites-load-more');
  if(favoriteMore){favoriteMore.hidden=favorites.length<=favoriteVisibleLimit;favoriteMore.textContent=`Daha fazla favori göster (${Math.min(GRID_PAGE_SIZE,favorites.length-favoriteVisibleLimit)})`;}
  const recent=games.filter(g=>!g.demo&&g.lastPlayed).sort((a,b)=>(b.lastPlayed||0)-(a.lastPlayed||0));
  fillGrid($('#recent-games'),recent.slice(0,recentVisibleLimit));
  $('#recent-empty').classList.toggle('hidden',recent.length!==0);
  const recentMore=$('#recent-load-more');
  if(recentMore){recentMore.hidden=recent.length<=recentVisibleLimit;recentMore.textContent=`Daha fazla oyun göster (${Math.min(GRID_PAGE_SIZE,recent.length-recentVisibleLimit)})`;}
  renderFilters();
}
function renderFilters(){const list=[['ALL','Tümü'],...Object.keys(PLATFORM).map(k=>[k,platformInfo(k).short])];$('#platform-filters').innerHTML=list.map(([key,label])=>`<button class="filter-chip ${selectedPlatform===key?'selected':''}" data-filter="${key}">${esc(label)}</button>`).join('');}
function setView(name){const target=$(`#view-${name}`);if(!target)return;$$('.view').forEach(v=>v.classList.toggle('active',v===target));$$('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===name));const labels={home:'Ana Sayfa',library:'Kütüphane',systems:'Sistemler',favorites:'Favoriler',recent:'Son oynananlar',settings:'Ayarlar',help:'Yardım'};$('#breadcrumb').innerHTML=`${esc(labels[name]||'RetroPlay')} <span>/</span> ${name==='library'?'Koleksiyonun':name==='systems'?'Platform rehberi':'Kişisel retro merkez'}`;if(name==='library')renderAll();window.scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});}
function openImport(){const m=$('#import-modal');if(m.classList.contains('hidden'))pushOverlayState('import');m.classList.remove('hidden');$('#import-results').textContent='';$('#import-progress').classList.add('hidden');$('#modal-file-input').value='';$('#choose-files').focus();}
function closeImport({viaHistory=false}={}){const m=$('#import-modal');if(m.classList.contains('hidden'))return;m.classList.add('hidden');if(!viaHistory)leaveOverlayState('import');}
/** What the library keeps about a recognised arcade set (the full ROM list stays in the catalog). */
function arcadeRecord(arcade){
  return {core:arcade.core,set:arcade.set,status:arcade.status,missing:(arcade.missing||[]).slice(0,20),missingCount:(arcade.missing||[]).length,different:(arcade.different||[]).slice(0,20),cps2Key:Boolean(arcade.cps2Key),parent:arcade.parent||'',bios:arcade.bios||'',vertical:Boolean(arcade.vertical),manufacturer:arcade.manufacturer||'',renamedFrom:arcade.renamedFrom||'',alternatives:arcade.alternatives||[]};
}
function arcadeParentInstalled(arcade){
  return !arcade?.parent||arcade.status!=='needs-parent'||games.some(g=>g.platform==='ARCADE'&&g.arcade?.set===arcade.parent&&g.blob instanceof Blob);
}
async function handleFiles(fileList){
  const selected=[...fileList];if(!selected.length)return;
  $('#import-modal').classList.remove('hidden');$('#import-progress').classList.remove('hidden');$('#import-results').textContent='';
  const files=[];let archiveSkipped=0,archiveFailed=0,biosAdded=0;const archiveMessages=[];
  let catalogs=null,catalogError=null;
  const CONSOLE_EXTS=new Set(['nes','sfc','smc','md','gen']);
  for(const source of selected){
    if(getFileExt(source.name)!=='zip'){files.push({file:source});continue;}
    try{
      // Arcade sets and BIOS files must stay zipped; console ROMs are taken out of their zip.
      const entries=await readZipDirectory(source);
      let arcade=null;
      if(!entries.some(entry=>CONSOLE_EXTS.has(getFileExt(entry.name)))){
        if(!catalogs&&!catalogError){try{catalogs=await loadCatalogs();}catch(error){catalogError=error;}}
        if(catalogs)arcade=identifyArcadeZip(source.name,entries,catalogs);
      }
      if(arcade?.kind==='bios'){
        await putBios({id:`${arcade.set}.zip`,set:arcade.set,label:arcade.label,fileName:source.name,size:source.size,blob:source,missing:arcade.missing,addedAt:Date.now()});
        biosIds.add(`${arcade.set}.zip`);biosAdded++;
        archiveMessages.push(`BIOS eklendi: ${arcade.set}.zip — ${arcade.label}${arcade.missing.length?` · eksik dosya: ${arcade.missing.join(', ')}`:' · kullanıma hazır'}\n`);
        continue;
      }
      if(arcade?.kind==='game'){files.push({file:source,arcade});continue;}
      const extracted=await extractRomFilesFromZip(source);
      files.push(...extracted.map(file=>({file})));
      archiveMessages.push(`ZIP açıldı: ${source.name} — ${extracted.length} desteklenen ROM bulundu\n`);
    }catch(error){archiveFailed++;archiveMessages.push(`ZIP hatası: ${source.name} — ${error?.message||error}${catalogError?` (arcade oyun listesi yüklenemedi: ${catalogError.message})`:''}\n`);}
  }
  if(biosAdded){
    await renderBiosList();
    // The player asked for this BIOS: start the waiting game right away.
    const waiting=biosWaitingGameId;biosWaitingGameId=null;
    if(waiting&&!files.length&&waiting===activeGameId&&!$('#player-modal').classList.contains('hidden')){
      const game=games.find(g=>g.id===waiting);
      if(game?.arcade?.bios&&biosIds.has(`${game.arcade.bios}.zip`)){closeImport();renderAll();void startGame(waiting);return;}
    }
  }
  if(!files.length){
    $('#import-progress').classList.add('hidden');
    $('#import-results').textContent=`Tamamlandı: ${biosAdded} · Atlandı: ${archiveSkipped} · Hata: ${archiveFailed}\n`+archiveMessages.join('');
    if(biosAdded)showToast(`${biosAdded} BIOS dosyası eklendi.`);
    else showToast(archiveFailed?'ZIP açılamadı. Ayrıntılar içe aktarma penceresinde.':'ZIP içinde içe aktarılabilir ROM bulunamadı.','error');
    return;
  }
  const progress=$('#progress-bar');let done=0,success=0,skipped=archiveSkipped,failed=archiveFailed;const total=files.reduce((n,item)=>n+item.file.size,0);
  $('#import-results').textContent=archiveMessages.join('');
  $('#progress-label').textContent=`${files.length} dosya hazırlanıyor · ${formatBytes(total)}`;
  $('#progress-percent').textContent='0%';progress.style.width='0%';
  try{
    const estimate=await navigator.storage?.estimate?.();
    if(estimate?.quota&&estimate.quota-(estimate.usage||0)<total*1.1){
      $('#import-results').textContent='Uyarı: Kullanılabilir alan bu işlem için yetersiz olabilir. Dosyalar tek tek işlenecek; başarısız olanlar ayrıca bildirilecek.\n';
    }
  }catch{}
  const supported=['nes','sfc','smc','md','gen','bin','z64','n64','v64','cue','iso'];
  for(const {file,arcade} of files){
    try{
      const ext=getFileExt(file.name);
      if(!arcade&&!supported.includes(ext)){skipped++;$('#import-results').textContent+=`Atlandı: ${file.name} — tanınmayan uzantı\n`;continue;}
      if(file.size===0){skipped++;$('#import-results').textContent+=`Atlandı: ${file.name} — dosya boş\n`;continue;}
      let romValidation=null;
      if(ext==='nes'){
        const header=await file.slice(0,16).arrayBuffer();
        romValidation=inspectNesRom(header,{totalSize:file.size});
        if(!romValidation.valid){skipped++;$('#import-results').textContent+=`Atlandı: ${file.name} — NES doğrulaması başarısız: ${romValidation.reason}\n`;continue;}
      }
      const hash=await sha256File(file);
      const match=classifyImport(games,hash);
      if(match.action==='duplicate'){
        skipped++;$('#import-results').textContent+=`Atlandı: ${file.name} — aynı içerik kütüphanede zaten var\n`;continue;
      }
      const headerBytes=arcade?null:new Uint8Array(await file.slice(0,0x200).arrayBuffer());
      const detectedPlatform=arcade?'ARCADE':detectRomPlatform(file.name,headerBytes);
      const arcadeMeta=arcade?arcadeRecord(arcade):undefined;
      if(match.action==='relink'){
        // A metadata-only record restored from a backup gets its ROM back; favourites,
        // play history and the record ID (and therefore its saves) are kept.
        const previous=match.game;
        const platform=arcade?'ARCADE':previous.platform&&previous.platform!=='UNKNOWN'?previous.platform:detectedPlatform;
        const relinked={...previous,platform,fileName:file.name,size:file.size,sizeLabel:formatBytes(file.size),blob:file,romValidation,restoredMetadataOnly:false,status:platform==='UNKNOWN'?'platform-unknown':'imported',...(arcadeMeta?{arcade:arcadeMeta}:{})};
        await saveGame(relinked);
        const index=games.indexOf(previous);if(index>=0)games[index]=relinked;
        success++;$('#import-results').textContent+=`Yedek kaydına bağlandı: ${file.name}\n`;continue;
      }
      const platform=detectedPlatform;
      const id=`rom-${crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(16).slice(2)}`;
      const title=arcade?arcade.title:file.name.replace(/\.[^.]+$/,'').replace(/[._-]+/g,' ').trim()||file.name;
      const game={id,title,platform,year:arcade?Number(arcade.year)||null:null,genre:arcade?'Arcade':'Bilinmiyor',...(arcadeMeta?{arcade:arcadeMeta}:{}),symbol:platformInfo(platform).logo,coverBg:platformInfo(platform).color,coverGlow:platformInfo(platform).glow,fileName:file.name,size:file.size,sizeLabel:formatBytes(file.size),contentHash:hash,blob:file,romValidation,addedAt:Date.now(),favorite:false,demo:false,playable:false,status:platform==='UNKNOWN'?'platform-unknown':'imported'};
      const staleCopy=arcadeMeta&&arcadeMeta.status!=='incomplete'?games.find(g=>g.platform==='ARCADE'&&g.arcade?.set===arcadeMeta.set&&g.arcade?.status==='incomplete'):null;
      await saveGame(game);games.push(game);success++;
      $('#import-results').textContent+=arcade?`Eklendi: ${file.name} — ${arcade.title} · ${describeArcadeStatus(arcadeMeta,{biosInstalled:!arcadeMeta.bios||biosIds.has(`${arcadeMeta.bios}.zip`),parentInstalled:arcadeParentInstalled(arcadeMeta)})}${staleCopy?' · aynı oyunun eksik eski kopyası kütüphanede; onu kartındaki "Kütüphaneden kaldır" ile silebilirsin':''}\n`:`Eklendi: ${file.name}${hash?' — içerik parmak izi alındı':''}\n`;
    }catch(e){failed++;$('#import-results').textContent+=`Hata: ${file.name} — ${storageErrorMessage(e)}\n`;}
    finally{done++;const pct=Math.round(done/files.length*100);$('#progress-percent').textContent=`${pct}%`;progress.style.width=`${pct}%`;$('#progress-label').textContent=`İşlenen ${done}/${files.length} · ${formatBytes(Math.min(total,files.slice(0,done).reduce((n,item)=>n+item.file.size,0)))}`;}
  }
  await refreshGames();$('#progress-label').textContent='İçe aktarma tamamlandı';$('#progress-percent').textContent=`${success}/${files.length}`;
  $('#import-results').textContent=`Tamamlandı: ${success} · Atlandı: ${skipped} · Hata: ${failed}\n`+$('#import-results').textContent;
  showToast(`${success} oyun dosyası içe aktarıldı.`,success?'success':'error');setView('library');
}

let activeExtraFiles = [];
let biosWaitingGameId = null;
function revokeUrls(files) { for (const file of files || []) { try { URL.revokeObjectURL(file.url); } catch {} } }
function releaseExtraFiles() { revokeUrls(activeExtraFiles); activeExtraFiles = []; }
/** Shows why a game was not started (nothing is loaded into the emulator). */
function showBlockedStart(status, message, action = null) {
  $('.player-screen-frame').style.display = 'none';
  $('#player-screen').style.display = 'none';
  $('#touch-controls').style.display = 'none';
  $('#gamepad-status').style.display = 'none';
  $('#player-status').textContent = status;
  $('#player-error').textContent = message;
  $('#pause-game').disabled = true;
  const retry = $('#player-retry');
  if (retry) {
    retry.hidden = !action;
    retry.textContent = action?.label || '';
    retry.onclick = action ? () => { retry.hidden = true; action.onClick(); } : null;
  }
}
function rememberCore(game, coreId) {
  if (game.platform === 'NES') game.nesCore = coreId;
  else if (game.platform === 'ARCADE' && game.arcade) {
    const alt = (game.arcade.alternatives || []).find(choice => choice.core === coreId);
    const previous = { core: game.arcade.core, status: game.arcade.status, set: game.arcade.set };
    game.arcade = { ...game.arcade, core: coreId, set: alt?.set || game.arcade.set, status: alt?.status || game.arcade.status, alternatives: [previous, ...(game.arcade.alternatives || []).filter(choice => choice.core !== coreId)] };
  }
}
/**
 * Which core(s) to try for a game, the file name the core must see and extra files (arcade BIOS
 * and parent sets). Returns { cores, gameName, extraFiles } or { blocked: { status, message } }.
 */
async function resolveLaunch(game, system, { coreOverride = '' } = {}) {
  const prefer = launch => {
    if (!coreOverride || launch.blocked) return launch;
    const chosen = launch.cores.find(core => core.coreId === coreOverride);
    return chosen ? { ...launch, cores: [chosen] } : launch;
  };
  if (game.platform === 'NES') {
    const forced = new URLSearchParams(window.location.search).get('nescore') === 'fceumm';
    const nestopia = { coreId: 'nestopia', systemId: 'nes', name: 'Nestopia', label: system.shortLabel };
    const fceumm = { coreId: 'fceumm', systemId: 'nes', name: 'FCEUmm', label: forced ? `${system.shortLabel} / FCEUmm karşılaştırma modu` : `${system.shortLabel} / FCEUmm` };
    const cores = forced ? [fceumm] : game.nesCore === 'fceumm' ? [fceumm, nestopia] : [nestopia, fceumm];
    return prefer({ cores, gameName: game.title, extraFiles: [] });
  }
  if (game.platform !== 'ARCADE') {
    return { cores: [{ coreId: system.emulatorJsCoreId, systemId: system.emulatorJsSystemId, name: SYSTEM_CORE_LABELS[game.platform] || system.shortLabel, label: system.shortLabel }], gameName: game.title, extraFiles: [] };
  }
  const arcade = game.arcade;
  if (!arcade?.set) return { blocked: { status: 'Başlatılamadı · set tanınmadı', message: 'Bu arcade dosyası tanınmadı. Dosyayı kütüphaneden kaldırıp yeniden içe aktar.' } };
  // Each core may know the zip under its own set name (a renamed zip matched by checksums).
  const choices = [{ core: arcade.core, set: arcade.set }, ...(arcade.alternatives || []).filter(alt => alt.status !== 'incomplete')]
    .filter((choice, i, all) => ARCADE_CORES[choice.core] && all.findIndex(other => other.core === choice.core) === i);
  if (onlyKeysMissing(arcade)) return { blocked: await keyBlock(game) };
  const cores = choices.map(choice => ({ coreId: choice.core, systemId: ARCADE_CORES[choice.core].systemId, name: ARCADE_CORES[choice.core].label, label: `Arcade · ${ARCADE_CORES[choice.core].label}`, gameName: `${choice.set || arcade.set}.zip` }));
  const extraFiles = [];
  if (arcade.bios) {
    const bios = await getBios(`${arcade.bios}.zip`).catch(() => null);
    if (!(bios?.blob instanceof Blob)) {
      return { blocked: { bios: `${arcade.bios}.zip`, status: `Başlatılamadı · ${arcade.bios}.zip gerekli`, message: `Bu oyun ${arcade.bios}.zip BIOS dosyasını istiyor. Aşağıdaki düğmeyle seç ya da oyun ekler gibi içe aktar (Ayarlar → BIOS dosyaları). Dosya cihazında kalır; bir kez eklemen yeter.` } };
    }
    extraFiles.push({ name: `${arcade.bios}.zip`, url: URL.createObjectURL(bios.blob) });
  }
  if (arcade.status === 'needs-parent' && arcade.parent) {
    const parent = games.find(g => g.platform === 'ARCADE' && g.arcade?.set === arcade.parent && g.blob instanceof Blob);
    if (!parent) {
      revokeUrls(extraFiles);
      return { blocked: { status: `Başlatılamadı · ${arcade.parent}.zip gerekli`, message: `Bu set bir klon ve ana set ${arcade.parent}.zip olmadan açılamaz. ${arcade.parent}.zip dosyasını da içe aktar ya da her zip'in tek başına yettiği "non-merged" seti kullan.` } };
    }
    extraFiles.push({ name: `${arcade.parent}.zip`, url: URL.createObjectURL(parent.blob) });
  }
  return prefer({ cores, gameName: `${arcade.set}.zip`, extraFiles });
}
/** Why a set whose only missing files are decryption keys cannot start, and how to fix it. */
async function keyBlock(game) {
  const arcade = game.arcade;
  let cps2 = typeof arcade.cps2Key === 'boolean' && Array.isArray(arcade.different) ? arcade.cps2Key : null;
  if (cps2 === null) { try { cps2 = isCps2KeyMissing((await loadCatalogs())[arcade.core], arcade.set, arcade.missing); } catch { cps2 = true; } }
  const entries = await readZipDirectory(game.blob).catch(() => null);
  const found = entries ? keyFindings(arcade.missing, entries) : { absent: arcade.missing, different: [] };
  const keys = arcade.missing.join(', ');
  const coreLabel = ARCADE_CORES[arcade.core]?.label || 'FinalBurn Neo';
  const what = cps2 ? 'CPS2 şifre anahtarı' : 'şifre çözme anahtarı';
  const problem = found.different.length && !found.absent.length
    ? `Bu zip'teki ${keys} bu oyunun anahtarı değil: içeriği ${coreLabel}'un beklediğinden farklı.`
    : `Bu zip'te ${keys} yok.`;
  const why = cps2
    ? 'CPS2 oyunlarının programı şifreli; FinalBurn Neo da MAME 2003-Plus da bu 20 baytlık anahtar olmadan oyunu açamaz. Setin diğer dosyaları doğru: bu zip, anahtarların setlere eklendiği 2016\'dan (MAME 0.178) önceki bir koleksiyondan geliyor.'
    : 'Bu oyunun programı şifreli ve çekirdek anahtar dosyası olmadan açamaz; setin diğer dosyaları doğru, yani set eski bir sürüm.';
  const fix = `Aynı oyunun ${coreLabel === 'MAME 2003-Plus' ? 'MAME 2003-Plus' : 'FinalBurn Neo 1.0.0.03'} setini (ya da MAME 0.178 sonrası bir setini) içe aktar; yeni kopya açılınca bu kartı "Kütüphaneden kaldır" ile silebilirsin.`;
  return { status: `Başlatılamadı · ${what} ${found.different.length && !found.absent.length ? 'uyuşmuyor' : 'eksik'}`, message: `${problem} ${why} ${fix}` };
}
function playerStatus(label) {
  const engine = activeEmulator?.engineName || 'Emülatör';
  const mapper = Number.isInteger(activeEmulator?.romInfo?.mapper)
    ? ` · Mapper ${activeEmulator.romInfo.mapper}`
    : Number.isInteger(activeEmulator?.romInfo?.mapperNumber)
      ? ` · Mapper ${activeEmulator.romInfo.mapperNumber}`
      : '';
  return `${label} · ${engine}${mapper}`;
}
async function startGame(id, options = {}) {
  const game = games.find(g => g.id === id && !g.demo);
  if (!game || !isPlayablePlatform(game.platform) || !(game.blob instanceof Blob)) {
    showToast('Bu kayıt için henüz desteklenen bir sistemde oynatılabilir ROM bulunamadı.', 'error');
    return;
  }
  const session = ++emulatorSession;
  endSaveSession('switch');
  if (activeEmulator) {
    try { activeEmulator.destroy(); } catch {}
    activeEmulator = null;
  }
  releaseExtraFiles();

  activeGameId = game.id;
  emulatorPaused = false;
  autoPaused = false;
  $('#player-title').textContent = game.title;
  renderTouchControls(game.platform, game);
  $('#touch-controls').style.display = '';
  $('#gamepad-status').style.display = '';
  updateGamepadStatus();
  $('#player-status').textContent = 'ROM yükleniyor…';
  $('#player-error').textContent = '';
  if ($('#player-retry')) $('#player-retry').hidden = true;
  const playerWasHidden = $('#player-modal').classList.contains('hidden');
  $('#player-modal').classList.remove('hidden');
  if (playerWasHidden) pushOverlayState('player');
  $('.player-screen-frame').style.display = '';
  $('#player-screen').style.display = '';
  $('#player-screen').replaceChildren();
  // Vertical arcade games (1944, Galaga…) get a portrait screen instead of a small 4:3 box.
  $('#player-screen').classList.toggle('is-vertical', game.platform === 'ARCADE' && Boolean(game.arcade?.vertical));
  $('#pause-game').textContent = 'Ⅱ Duraklat';
  $('#pause-game').disabled = true;
  $('#perf-test').disabled = true;
  activeCoreId = null;
  setStateButtons({ canSave: false, canLoad: false });
  hidePlayerNotice();

  try {
    const system = getEmulatedSystem(game.platform);
    if (!system) throw new Error('Bu sistem için emülatör kaydı bulunamadı.');
    const extension = getFileExt(game.fileName || game.title);
    if (!supportsRomExtension(game.platform, extension)) {
      throw new Error(`${system.shortLabel} sistemi için desteklenmeyen dosya uzantısı: .${extension || 'bilinmiyor'}`);
    }
    // Arcade zips go to the core as they are (no copy into memory here; sets can be ~100 MB).
    const bytes = game.platform === 'ARCADE' ? null : new Uint8Array(await game.blob.arrayBuffer());
    const validation = game.platform === 'NES'
      ? inspectNesRom(bytes)
      : { valid: game.blob.size > 0, system: game.platform, mapper: null };
    if (session !== emulatorSession || activeGameId !== game.id) return;
    if (!validation.valid) {
      throw new Error(validation.reason || 'ROM başlığı veya dosya uzunluğu geçersiz.');
    }
    const smb3Diagnostic = game.platform === 'NES'
      ? diagnoseSuperMarioBros3Rom(bytes, `${game.fileName || ''} ${game.title}`, validation)
      : null;
    let unverifiedDump = false;
    if (!isSuperMarioBros3LaunchAllowed(smb3Diagnostic)) {
      // Not a recognised clean retail dump (often a ROM hack). It is never started silently:
      // the player decides once per game, after being told why graphics may differ.
      const accepted = game.unverifiedDumpAccepted === true || await askUnverifiedDumpConsent(smb3Diagnostic);
      if (session !== emulatorSession || activeGameId !== game.id) return;
      if (!accepted) {
        showBlockedStart('Başlatılmadı · doğrulanmamış döküm', 'Oyun başlatılmadı. Temiz bir Super Mario Bros. 3 kopyası eklersen doğrudan açılır.');
        return;
      }
      if (game.unverifiedDumpAccepted !== true) {
        game.unverifiedDumpAccepted = true;
        try { await saveGame(game); } catch (error) { console.warn('[RetroPlay] Seçim kaydedilemedi:', error); }
      }
      unverifiedDump = true;
    }

    const launch = await resolveLaunch(game, system, options);
    if (session !== emulatorSession || activeGameId !== game.id) { revokeUrls(launch.extraFiles); return; }
    if (launch.blocked) {
      // Missing BIOS: offer to add it right here and start the game as soon as it is imported.
      const bios = launch.blocked.bios;
      showBlockedStart(launch.blocked.status, launch.blocked.message, bios ? { label: `${bios} ekle`, onClick: () => { biosWaitingGameId = game.id; $('#bios-input')?.click(); } } : null);
      return;
    }
    activeExtraFiles = launch.extraFiles;

    const reportError = error => {
      if (session !== emulatorSession || activeGameId !== game.id) return;
      const message = error?.message || String(error || 'Bilinmeyen emülatör hatası');
      $('#player-error').textContent = `Oyun motoru hatası: ${message}`;
      $('#player-status').textContent = 'Oturum durduruldu';
    };

    // The preferred core starts. If it cannot open the file at all (for example an NES mapper
    // Nestopia lacks), the player is offered the next core instead of switching silently: a core
    // given a file it cannot handle may crash the page, so that is the player's choice.
    const candidate = launch.cores[0];
    const player = new EmulatorJsPlayer($('#player-screen'), {
      onError: reportError,
      systemId: candidate.systemId,
      coreId: candidate.coreId,
      systemLabel: candidate.label,
      gameId: emulatorGameId(game),
      shader: displayStartOptions(displayMode).shader,
      retroarchConfig: { ...displayStartOptions(displayMode).retroarchConfig },
      extraFiles: launch.extraFiles,
      // Non-fatal runtime messages (for example a denied screen wake lock) are logged only;
      // they must not mark a running game as stopped.
      onWarning: message => console.warn('[RetroPlay] EmulatorJS uyarısı:', message)
    });
    activeEmulator = player;
    activeDisplayStart = displayMode;
    activeEmulator.romInfo = validation;
    activeEmulator.romDiagnostic = smb3Diagnostic;
    try {
      await player.loadROM(bytes || game.blob, candidate.gameName || launch.gameName);
    } catch (error) {
      if (session !== emulatorSession || activeGameId !== game.id) { player.destroy(); return; }
      const next = launch.cores[1];
      if (error?.code !== 'content-not-loaded' || !next) throw error;
      player.destroy();
      activeEmulator = null;
      releaseExtraFiles();
      showBlockedStart(`${candidate.name} bu oyunu açamadı`, `${candidate.name} bu dosyayı açamadı. ${next.name} ile denemek ister misin? Seçimin bu oyun için hatırlanır.`, { label: `${next.name} ile dene`, onClick: () => { void startGame(game.id, { coreOverride: next.coreId }); } });
      return;
    }
    if (session !== emulatorSession || activeGameId !== game.id) { player.destroy(); return; }
    const used = candidate;
    if (options.coreOverride) {
      rememberCore(game, used.coreId);
      try { await saveGame(game); } catch (error) { console.warn('[RetroPlay] Çekirdek seçimi kaydedilemedi:', error); }
      showPlayerNotice(`${used.name} ile açıldı · bu oyun için hatırlandı`, { timeout: 4000 });
    }
    {
      const saveSync = await syncSaveOnStart(game, player);
      if (session !== emulatorSession || activeGameId !== game.id) {
        player.destroy();
        return;
      }
      if (saveSync.ok) beginSaveSession(game, player, saveSync.primed);
      else $('#player-error').textContent = `${saveSync.reason}. Mevcut kaydın korunması için bu oturumda oyun içi kayıt yedeği alınmıyor.`;
      activeCoreId = used.coreId;
      const resumed = await resumeFromAutoState(game, player);
      if (unverifiedDump && !resumed) showPlayerNotice('Doğrulanmamış döküm · grafikler orijinalden farklı olabilir', { timeout: 4000 });
      if (session !== emulatorSession || activeGameId !== game.id) {
        player.destroy();
        return;
      }
    }

    $('#player-status').textContent = playerStatus('Çalışıyor');
    $('#pause-game').disabled = false;
    $('#perf-test').disabled = false;
    game.lastPlayed = Date.now();
    await saveGame(game);
    await refreshGames();
  } catch (error) {
    if (session !== emulatorSession || activeGameId !== game.id) return;
    void endSaveSession('error');
    if (activeEmulator) {
      try { activeEmulator.destroy(); } catch {}
      activeEmulator = null;
    }
    $('#player-status').textContent = 'Başlatılamadı';
    $('#player-error').textContent = game.platform === 'ARCADE'
      ? `Arcade seti açılamadı: ${String(error?.message || error).replace(/[.\s]+$/, '')}. ${game.arcade?.status === 'incomplete' ? `Set bu çekirdek sürümüyle uyuşmuyor (${missingSummary(game.arcade)}): ${(game.arcade.missing || []).slice(0, 5).join(', ')}. ${ARCADE_CORES[game.arcade.core]?.label || ''} için doğru ROM seti sürümünü kullan.` : 'Set ve BIOS dosyalarını kontrol et.'}`
      : `Bu ROM çalıştırılamadı: ${String(error?.message || error).replace(/[.\s]+$/, '')}. ROM biçimi ve mapper desteği kontrol edilmeli.`;
    showToast('Oyun başlatılamadı. Ayrıntı oynatıcı penceresinde.', 'error');
  }
}
let fullscreenFallback = false;
function updateFullscreenButton() {
  const button = $('#fullscreen-game');
  if (!button) return;
  const active = isFullscreen(document, $('#player-modal')) || fullscreenFallback;
  button.textContent = active ? '⛶ Tam ekrandan çık' : '⛶ Tam ekran';
  button.setAttribute('aria-pressed', String(active));
  button.setAttribute('aria-label', active ? 'Tam ekrandan çık' : 'Oyunu tam ekran yap');
}
function setFullscreenFallback(active) {
  fullscreenFallback = active;
  $('#player-modal')?.classList.toggle('is-immersive-fallback', active);
  $('#player-modal')?.parentElement?.classList.toggle('is-immersive-fallback', active);
  activeEmulator?.setImmersive?.(active);
  updateFullscreenButton();
  if (active) showToast('Geniş ekran görünümü açıldı. Tarayıcı tam ekran API’sini desteklemediği için adres çubuğu gizlenmeyebilir.');
  requestAnimationFrame(() => {
    try { activeEmulator?.fitInParent?.(); } catch {}
  });
}
async function toggleGameFullscreen() {
  const modal = $('#player-modal');
  if (!modal || modal.classList.contains('hidden')) return;
  if (fullscreenFallback) {
    setFullscreenFallback(false);
    return;
  }
  if (isFullscreen(document, modal)) {
    const result = await leaveFullscreen(document);
    if (result.error) showToast('Tam ekrandan çıkılamadı. Esc tuşunu deneyebilirsin.', 'error');
    return;
  }
  const result = await enterFullscreen(modal, document);
  if (!result.supported) {
    setFullscreenFallback(true);
    return;
  }
  if (result.error || !result.entered) {
    // Some mobile browsers expose the Fullscreen API but reject it or resolve
    // without actually entering fullscreen. Keep play usable with visual fallback.
    setFullscreenFallback(true);
    showToast(
      result.error
        ? 'Tarayıcı gerçek tam ekranı engelledi; oyun alanı genişletilmiş görünümde açıldı.'
        : 'Tarayıcı tam ekran geçişini doğrulamadı; oyun alanı genişletilmiş görünümde açıldı.',
      'error'
    );
    return;
  }
  activeEmulator?.setImmersive?.(true);
  updateFullscreenButton();
  requestAnimationFrame(() => {
    try { activeEmulator?.fitInParent?.(); } catch {}
  });
}
function setupFullscreen() {
  $('#fullscreen-game')?.addEventListener('click', toggleGameFullscreen);
  $('#immersive-exit')?.addEventListener('click', toggleGameFullscreen);
  const onChange = () => {
    if (fullscreenElement(document) !== $('#player-modal') && fullscreenFallback) setFullscreenFallback(false);
    activeEmulator?.setImmersive?.(isFullscreen(document, $('#player-modal')) || fullscreenFallback);
    updateFullscreenButton();
    requestAnimationFrame(() => {
      try { activeEmulator?.fitInParent?.(); } catch {}
    });
  };
  document.addEventListener('fullscreenchange', onChange);
  document.addEventListener('webkitfullscreenchange', onChange);
  updateFullscreenButton();
}

/**
 * Loads the app-owned battery save into the core when it differs from what EmulatorJS loaded,
 * or adopts the emulator's own copy when the app has none yet. Returns { ok, primed }: primed is
 * what the core holds afterwards (so unchanged SRAM is not rewritten). ok=false means an existing
 * app save could not be loaded; capturing is then disabled for the session so that copy is
 * never overwritten by SRAM that started blank.
 */
async function syncSaveOnStart(game, player) {
  let record = null;
  let readFailed = false;
  try { record = await getBatterySave(game.id); } catch (error) { readFailed = true; console.warn('[RetroPlay] Kayıt okunamadı:', error); }
  if (readFailed) return { ok: false, primed: null, reason: 'Kayıt veritabanı okunamadı' };
  const appBytes = record?.bytes ? (record.bytes instanceof Uint8Array ? record.bytes : new Uint8Array(record.bytes)) : null;
  const coreBytes = player.readSaveData({ flush: false });
  const decision = decideSaveRestore({ appBytes, coreBytes });
  if (decision === 'restore-app') {
    let restored = false;
    try { restored = player.writeSaveData(appBytes) && player.restartGame(); } catch (error) { console.warn('[RetroPlay] Kayıt geri yüklenemedi:', error); }
    return restored ? { ok: true, primed: appBytes } : { ok: false, primed: null, reason: 'Kayıt emülatöre yüklenemedi' };
  }
  if (decision === 'adopt-core') {
    try {
      const saved = await saveBatteryBackup(game, { bytes: coreBytes, updatedAt: Date.now() });
      if (saved) batterySaveIds.add(game.id);
    } catch (error) { console.warn('[RetroPlay] Emülatör kaydı uygulamaya alınamadı:', error); }
    return { ok: true, primed: coreBytes };
  }
  if (decision === 'in-sync') return { ok: true, primed: appBytes };
  // No save anywhere yet: remember the initial SRAM so only real in-game saves are stored.
  return { ok: true, primed: player.readSaveData({ flush: true }) };
}
function beginSaveSession(game, player, primedBytes) {
  saveCapture = createSaveCapture({
    read: () => (activeEmulator === player && typeof player.readSaveData === 'function' ? player.readSaveData({ flush: true }) : null),
    persist: bytes => saveBatteryBackup(game, { bytes, updatedAt: Date.now() }).then(saved => {
      if (saved) batterySaveIds.add(game.id);
      return saved;
    })
  });
  saveCapture.prime(primedBytes);
  if (saveTimer) window.clearInterval(saveTimer);
  saveTimer = window.setInterval(() => {
    if (!emulatorPaused && document.visibilityState === 'visible') void captureActiveSave('interval');
  }, SAVE_CAPTURE_INTERVAL_MS);
}
/** Copies the live SRAM out of the core synchronously, then persists it asynchronously. */
function captureActiveSave(reason) {
  if (!saveCapture) return Promise.resolve(null);
  return saveCapture.capture(reason).then(result => {
    if (result?.status === 'failed' && !$('#player-modal').classList.contains('hidden')) {
      $('#player-error').textContent = `Oyun içi kayıt yerel yedeğe yazılamadı: ${result.error?.message || result.error}`;
    }
    return result;
  });
}
function endSaveSession(reason) {
  const pending = captureActiveSave(reason);
  if (saveTimer) { window.clearInterval(saveTimer); saveTimer = 0; }
  saveCapture = null;
  return pending;
}
let pendingConsent = null;
/** Shows the unverified-dump explanation in the player and resolves with the player's choice. */
function askUnverifiedDumpConsent(diagnostic) {
  const panel = $('#player-consent');
  if (!panel) return Promise.resolve(false);
  pendingConsent?.(false);
  $('.player-screen-frame').style.display = 'none';
  $('#player-screen').style.display = 'none';
  $('#touch-controls').style.display = 'none';
  $('#gamepad-status').style.display = 'none';
  $('#player-status').textContent = 'Onayın bekleniyor';
  const crc = Number.isInteger(diagnostic?.payloadCrc32) ? diagnostic.payloadCrc32.toString(16).toUpperCase().padStart(8, '0') : '';
  $('#player-consent-detail').textContent = crc ? `PRG+CHR CRC32 ${crc}${Number.isInteger(diagnostic?.mapper) ? ` · Mapper ${diagnostic.mapper}` : ''}` : String(diagnostic?.message || '');
  panel.hidden = false;
  return new Promise(resolve => {
    const finish = value => {
      if (pendingConsent !== finish) return;
      pendingConsent = null;
      panel.hidden = true;
      $('.player-screen-frame').style.display = '';
      $('#player-screen').style.display = '';
      $('#touch-controls').style.display = '';
      $('#gamepad-status').style.display = '';
      resolve(value);
    };
    pendingConsent = finish;
    $('#consent-play').onclick = () => finish(true);
    $('#consent-cancel').onclick = () => finish(false);
    $('#consent-play').focus();
  });
}
function setStateButtons({ canSave, canLoad }) {
  for (const id of ['#quick-save', '#immersive-save']) { const el = $(id); if (el) el.disabled = !canSave; }
  for (const id of ['#quick-load', '#immersive-load']) { const el = $(id); if (el) el.disabled = !canLoad; }
}
function hidePlayerNotice() {
  window.clearTimeout(playerNoticeTimer);
  const notice = $('#player-notice');
  if (notice) notice.hidden = true;
}
/** Short message inside the player (also visible in fullscreen, unlike the page toast). */
function showPlayerNotice(message, { actionLabel = '', onAction = null, timeout = 2200 } = {}) {
  const notice = $('#player-notice');
  if (!notice) return;
  window.clearTimeout(playerNoticeTimer);
  $('#player-notice-text').textContent = message;
  const action = $('#player-notice-action');
  action.hidden = !actionLabel;
  action.textContent = actionLabel;
  action.onclick = onAction ? () => { hidePlayerNotice(); onAction(); } : null;
  notice.hidden = false;
  playerNoticeTimer = window.setTimeout(hidePlayerNotice, timeout);
}
function stateRecord(game, slot, bytes) {
  return { id: stateKey(game.id, slot), gameId: game.id, slot, platform: game.platform, coreId: activeCoreId, bytes, byteLength: bytes.byteLength, createdAt: Date.now() };
}
/** Takes a save state synchronously (safe right before teardown) and stores it asynchronously. */
function captureState(slot) {
  const game = games.find(g => g.id === activeGameId && !g.demo);
  if (!game || !activeCoreId || typeof activeEmulator?.saveState !== 'function') return Promise.resolve(false);
  const bytes = activeEmulator.saveState();
  if (!bytes) return Promise.resolve(false);
  return putSaveState(stateRecord(game, slot, bytes)).then(() => {
    if (slot === 'auto') resumeStateIds.add(game.id);
    return true;
  }).catch(error => {
    console.warn('[RetroPlay] Kayıt noktası yazılamadı:', error);
    return false;
  });
}
/** Continues from the point where the player last left this game (same core only). */
async function resumeFromAutoState(game, player) {
  const canSave = player.supportsStates?.() !== false && typeof player.saveState === 'function';
  let quick = null;
  let resume = null;
  try { [resume, quick] = await Promise.all([getSaveState(game.id, 'auto'), getSaveState(game.id, 'quick')]); } catch (error) { console.warn('[RetroPlay] Kayıt noktaları okunamadı:', error); }
  setStateButtons({ canSave, canLoad: Boolean(quick?.bytes && quick.coreId === activeCoreId) });
  if (!resume?.bytes || resume.coreId !== activeCoreId) return false;
  if (!player.loadState(resume.bytes)) return false;
  showPlayerNotice('Kaldığın yerden devam ediliyor', { actionLabel: 'Baştan başla', onAction: restartFromBeginning, timeout: 7000 });
  return true;
}
function restartFromBeginning() {
  if (!activeEmulator?.restartGame?.()) return;
  showPlayerNotice('Oyun baştan başladı');
}
async function quickSave() {
  if (!activeEmulator || $('#player-modal').classList.contains('hidden')) return;
  const saved = await captureState('quick');
  if (saved) {
    setStateButtons({ canSave: true, canLoad: true });
    showPlayerNotice('Kaydedildi');
  } else {
    showPlayerNotice('Kayıt noktası alınamadı');
  }
}
async function quickLoad() {
  const game = games.find(g => g.id === activeGameId && !g.demo);
  if (!game || !activeEmulator?.loadState) return;
  let record = null;
  try { record = await getSaveState(game.id, 'quick'); } catch {}
  if (!record?.bytes || record.coreId !== activeCoreId) { showPlayerNotice('Henüz kayıt noktası yok'); return; }
  if (activeEmulator.loadState(record.bytes)) showPlayerNotice('Kayıt noktası yüklendi');
  else showPlayerNotice('Kayıt noktası yüklenemedi');
}
function pushOverlayState(kind) {
  try { history.pushState({ retroplayOverlay: kind }, ''); } catch {}
}
function leaveOverlayState(kind) {
  try { if (history.state?.retroplayOverlay === kind) history.back(); } catch {}
}
function closePlayer({ viaHistory = false } = {}) {
  const wasOpen = !$('#player-modal').classList.contains('hidden');
  pendingConsent?.(false);
  // Read the resume point and SRAM before the iframe is removed; the IndexedDB writes continue afterwards.
  const pendingState = captureState('auto');
  const pendingSave = endSaveSession('close');
  hidePlayerNotice();
  activeCoreId = null;
  emulatorSession += 1;
  if (activeEmulator) {
    try { activeEmulator.destroy(); } catch {}
    activeEmulator = null;
  }
  activeGameId = null;
  emulatorPaused = false;
  releaseExtraFiles();
  if (isFullscreen(document, $('#player-modal'))) void leaveFullscreen(document);
  if (fullscreenFallback) setFullscreenFallback(false);
  $('#player-modal').classList.add('hidden');
  $('#player-screen').replaceChildren();
  autoPaused = false;
  if (wasOpen && !viaHistory) leaveOverlayState('player');
  Promise.all([pendingState, pendingSave]).then(([stateSaved, result]) => { if (stateSaved || result?.status === 'saved') renderAll(); });
  showUpdateBanner();
  void updateOfflineStatus();
}
function showPausedState(paused) {
  $('#pause-game').textContent = paused ? '▶ Devam et' : 'Ⅱ Duraklat';
  $('#player-status').textContent = playerStatus(paused ? 'Duraklatıldı' : 'Çalışıyor');
}
async function togglePause() {
  if (!activeEmulator) return;
  try {
    if (emulatorPaused) {
      await activeEmulator.resume();
      emulatorPaused = false;
      autoPaused = false;
      showPausedState(false);
    } else {
      await activeEmulator.pause();
      emulatorPaused = true;
      showPausedState(true);
      void captureActiveSave('pause');
    }
  } catch (error) {
    $('#player-error').textContent = `Duraklatma/devam hatası: ${error?.message || error}`;
  }
}
/** Backgrounding (app switch, screen off) saves and pauses; returning resumes an auto-pause. */
async function handlePlayerVisibility() {
  if (!activeEmulator || $('#player-modal').classList.contains('hidden')) return;
  try {
    if (document.visibilityState === 'hidden') {
      void captureActiveSave('hidden');
      void captureState('auto');
      if (!emulatorPaused) {
        await activeEmulator.pause();
        emulatorPaused = true;
        autoPaused = true;
        showPausedState(true);
      }
    } else if (autoPaused) {
      autoPaused = false;
      await activeEmulator.resume();
      emulatorPaused = false;
      showPausedState(false);
    }
  } catch (error) {
    console.warn('[RetroPlay] Arka plan duraklatma hatası:', error);
  }
}
function renderTouchControls(platform, game = null) {
  const root = $('#touch-controls');
  const system = getEmulatedSystem(platform);
  if (!root || !system) return;
  const button = ({ label, input, ariaLabel = label }) => `<button data-nes-button="${esc(input)}" aria-label="${esc(ariaLabel)}">${esc(label)}</button>`;
  const layout = platform === 'ARCADE' ? arcadeLayout(game?.arcade) : 'standard';
  const actions = layout === 'neogeo' ? system.neoGeoButtons : system.actionButtons;
  root.dataset.platform = platform;
  root.dataset.layout = layout;
  root.innerHTML = `<div class="dpad"><button data-nes-button="BUTTON_UP" aria-label="Yukarı">▲</button><div><button data-nes-button="BUTTON_LEFT" aria-label="Sola">◀</button><button data-nes-button="BUTTON_DOWN" aria-label="Aşağı">▼</button><button data-nes-button="BUTTON_RIGHT" aria-label="Sağa">▶</button></div></div><div class="action-pad">${actions.map(button).join('')}</div><div class="system-pad">${system.showSelect ? button({label:system.selectLabel || 'SELECT',input:'BUTTON_SELECT',ariaLabel:system.selectLabel === 'JETON' ? 'Jeton at' : 'SELECT'}) : ''}${system.showStart ? button({label:'START',input:'BUTTON_START'}) : ''}</div>`;
}
function updateGamepadStatus() {
  const root = $('#gamepad-status');
  const text = $('#gamepad-status-text');
  if (!root || !text) return;
  const status = inspectGamepads(navigator);
  root.dataset.state = status.state;
  text.textContent = describeGamepads(status);
  root.setAttribute('aria-label', text.textContent);
}
function setupGamepadStatus() {
  $('#refresh-gamepads')?.addEventListener('click', updateGamepadStatus);
  window.addEventListener('gamepadconnected', updateGamepadStatus);
  window.addEventListener('gamepaddisconnected', updateGamepadStatus);
  window.addEventListener('focus', updateGamepadStatus);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') updateGamepadStatus();
  });
  updateGamepadStatus();
}

function wireTouchControls() {
  const root = $('#touch-controls');
  root.addEventListener('pointerdown', event => {
    const button = event.target.closest('[data-nes-button]');
    if (!button || !activeEmulator) return;
    event.preventDefault();
    try { button.setPointerCapture?.(event.pointerId); } catch {}
    activeEmulator.pressButton?.(button.dataset.nesButton);
    button.classList.add('pressed');
  });
  const release = event => {
    const button = event.target.closest('[data-nes-button]');
    if (!button) return;
    activeEmulator?.releaseButton?.(button.dataset.nesButton);
    button.classList.remove('pressed');
  };
  root.addEventListener('pointerup', release);
  root.addEventListener('pointercancel', release);
  root.addEventListener('lostpointercapture', release);
}

async function refreshGames(){const [stored,saves,stateKeys,bios]=await Promise.all([allStored(),allBatterySaves(),allSaveStateKeys().catch(()=>[]),allBios().catch(()=>[])]);batterySaveIds=new Set(saves.map(save=>save.id));biosIds=new Set(bios.map(record=>record.id));resumeStateIds=new Set(stateKeys.map(String).filter(key=>key.endsWith(':auto')).map(key=>key.slice(0,-':auto'.length)));games=[...DEMO_GAMES.map(g=>({...g})),...stored];renderAll();}
async function toggleFavorite(id){const game=games.find(g=>g.id===id);if(!game)return;game.favorite=!game.favorite;if(!game.demo){try{await saveGame(game);}catch(e){game.favorite=!game.favorite;showToast(`Favori kaydedilemedi: ${e.message}`,'error');return;}}renderAll();showToast(game.favorite?'Favorilere eklendi.':'Favorilerden çıkarıldı.');}
async function removeFromLibrary(id){const game=games.find(g=>g.id===id);if(!game||game.demo)return;const ok=confirm(`“${game.title}” kaydını kütüphaneden kaldırmak istiyor musun?\n\nBu işlem bu tarayıcıdaki ROM kopyasını, kütüphane kaydını, oyun içi kayıtları ve kayıt noktalarını da siler. Orijinal dosya değiştirilmez.`);if(!ok)return;try{await deleteGame(id);await refreshGames();showToast('Kayıt bu tarayıcıdan kaldırıldı. Orijinal dosya değiştirilmedi.');}catch(e){showToast(`Kaldırılamadı: ${e.message}`,'error');}}
function downloadBlob(blob,filename){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function exportBatterySave(id){const game=games.find(g=>g.id===id&&!g.demo);if(!game)return;try{const record=await getBatterySave(id);if(!record?.bytes||!record.byteLength){showToast('Bu oyun için henüz SRAM/batarya kaydı yok. Bir oyun içi kayıt yaptıktan sonra tekrar dene.','error');return;}const bytes=record.bytes instanceof Uint8Array?record.bytes:new Uint8Array(record.bytes);downloadBlob(new Blob([bytes],{type:'application/octet-stream'}),`${safeFilename(game.title||game.fileName||'retroplay-save')}.srm`);showToast(`SRAM yedeği indirildi (${formatBytes(bytes.byteLength)}).`);}catch(error){showToast(`SRAM yedeği indirilemedi: ${error?.message||error}`,'error');}}
function safeFilename(name){return String(name||'retroplay').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(0,140)||'retroplay';}
async function exportROM(id){const game=games.find(g=>g.id===id&&!g.demo);if(!game)return;if(!(game.blob instanceof Blob)){showToast('Bu oyun için yerel ROM içeriği bulunamadı. Dosyayı yeniden içe aktar.','error');return;}try{downloadBlob(game.blob,safeFilename(game.fileName||`${game.title}.rom`));showToast('ROM dışa aktarma başlatıldı.');}catch(e){showToast(`ROM dışa aktarılamadı: ${storageErrorMessage(e)}`,'error');}}
function backupMetadata(game){const {blob,...metadata}=game;return metadata;}
function exportLibraryBackup(){try{const payload={app:'RetroPlay',backupType:'library-metadata',schemaVersion:1,appVersion:APP_VERSION,createdAt:new Date().toISOString(),gameCount:games.filter(g=>!g.demo).length,games:games.filter(g=>!g.demo).map(backupMetadata)};const json=JSON.stringify(payload,null,2);downloadBlob(new Blob([json],{type:'application/json'}),`RetroPlay-Library-${new Date().toISOString().slice(0,10)}-v${APP_VERSION}.json`);showToast('Kütüphane yedeği hazırlandı. ROM içerikleri bu dosyaya dahil değildir.');}catch(e){showToast(`Yedek oluşturulamadı: ${e.message}`,'error');}}

async function restoreLibraryBackup(file){if(!file)return;try{if(file.size>20*1024*1024)throw new Error('Yedek 20 MB sınırını aşıyor.');const data=JSON.parse(await file.text());if(!validBackup(data))throw new Error('Yedek biçimi veya şema sürümü geçersiz. Mevcut kayıtlar değiştirilmedi.');const existing=new Set((await allStored()).map(g=>g.id));const candidates=data.games.filter(g=>!existing.has(g.id));const duplicateCount=data.games.length-candidates.length;const totalSize=candidates.reduce((n,g)=>n+(g.size||0),0);const preview=`Yedek önizlemesi\n\nYedek tarihi: ${data.createdAt||'Bilinmiyor'}\nYedekteki kayıt: ${data.games.length}\nYeni eklenebilecek kayıt: ${candidates.length}\nKimlik çakışması nedeniyle atlanacak: ${duplicateCount}\nİlişkili ROM boyutlarının toplamı: ${formatBytes(totalSize)}\n\nÖNEMLİ: Bu JSON yedeğinde ROM dosyalarının kendisi yoktur. Geri yüklenen kayıtlar, ROM dosyası tekrar eklenene kadar yalnızca metadata kaydıdır. Mevcut kayıtların üzerine yazılmayacak.\n\nBirleştirmeyi onaylıyor musun?`;
if(!confirm(preview))return;let added=0,failed=0;for(const raw of candidates){const g={...raw,blob:undefined,restoredMetadataOnly:true,addedAt:Number(raw.addedAt)||Date.now()};try{await saveGame(g);added++;}catch(e){failed++;}}await refreshGames();showToast(`Geri yükleme tamamlandı: ${added} eklendi, ${duplicateCount} çakışma atlandı, ${failed} hata.`,failed?'error':'success');if(failed)alert('Bazı kayıtlar geri yüklenemedi. Sağlıklı kayıtlar korundu. İşlem sonucu: '+added+' eklendi, '+failed+' hata.');}catch(e){showToast(`Yedek geri yüklenemedi: ${e.message}`,'error');}}
async function clearDemo(){if(!confirm('Örnek oyunları bu ekrandan kaldırmak istiyor musun? Gerçek ROM dosyalarına dokunulmaz.'))return;games=games.filter(g=>!g.demo);renderAll();showToast('Örnek içerikler bu oturumda gizlendi.');}

function setDriveStatus(message,state='idle'){
  const el=$('#drive-status');
  if(el){el.textContent=message;el.dataset.state=state;}
}
function renderDriveFiles(append=false){
  const container=$('#drive-files');
  if(!container)return;
  const visible=driveVisibleFiles.filter(file=>isDriveFolder(file)||isSupportedDriveGame(file));
  if(!visible.length&&!append){
    container.innerHTML='<p class="drive-empty">Bu klasörde desteklenen oyun dosyası veya alt klasör bulunamadı.</p>';
    return;
  }
  const markup=visible.map(file=>{
    const folder=isDriveFolder(file);
    const supported=folder||isSupportedDriveGame(file);
    const size=Number.isFinite(Number(file.size))&&Number(file.size)>0?formatBytes(Number(file.size)):'';
    const action=folder
      ?`<button type="button" class="drive-file-action" data-drive-folder="${esc(file.id)}" data-drive-folder-name="${esc(file.name)}">Klasörü aç →</button>`
      :`<button type="button" class="drive-file-action" data-drive-download="${esc(file.id)}" ${file.capabilities?.canDownload===false?'disabled':''}>İndir ve ekle</button>`;
    return `<article class="drive-file-row"><span class="drive-file-icon" aria-hidden="true">${folder?'📁':'🎮'}</span><div class="drive-file-copy"><strong title="${esc(file.name)}">${esc(file.name)}</strong><small>${folder?'Klasör':size||'Oyun dosyası'}</small></div>${action}</article>`;
  }).join('');
  if(append)container.insertAdjacentHTML('beforeend',markup);
  else container.innerHTML=markup;
}
async function loadDriveFolder(folderId=driveCurrentFolder,{append=false}={}){
  if(!driveAccessToken){setDriveStatus('Önce Google Drive bağlantısı kur.','idle');return;}
  const generation=++driveListingGeneration;
  setDriveStatus('Drive klasörü yükleniyor…','loading');
  if(!append){driveVisibleFiles=[];driveNextPageToken='';renderDriveFiles();}
  try{
    const result=await listDriveFiles({accessToken:driveAccessToken,folderId,pageToken:append?driveNextPageToken:''});
    if(generation!==driveListingGeneration)return;
    driveVisibleFiles=append?[...driveVisibleFiles,...result.files]:result.files;
    driveNextPageToken=result.nextPageToken;
    renderDriveFiles();
    $('#drive-breadcrumb').textContent=driveFolderStack.map(item=>item.name).join(' / ');
    $('#drive-up').hidden=driveFolderStack.length<=1;
    $('#drive-load-more').hidden=!driveNextPageToken;
    setDriveStatus(`${driveVisibleFiles.filter(file=>isDriveFolder(file)||isSupportedDriveGame(file)).length} klasör/oyun girdisi bulundu. Dosyalar seçilene kadar indirilmez.`,'ready');
  }catch(error){
    if(generation!==driveListingGeneration)return;
    setDriveStatus(error?.message||'Drive klasörü okunamadı.','error');
    showToast(error?.message||'Google Drive klasörü okunamadı.','error');
  }
}
async function connectDrive(){
  const clientId=getDriveClientId();
  if(!clientId){
    setDriveStatus('Bağlantı hazır değil. Netlify ortam değişkenlerine VITE_GOOGLE_CLIENT_ID ekle; Google Cloud Console’da Drive API ve OAuth Web istemcisi oluşturup Netlify alan adını yetkili JavaScript kaynağına ekle.','error');
    showToast('Google Drive için OAuth istemci kimliği yapılandırılmalı.','error');
    return;
  }
  const button=$('#drive-connect');
  const google=globalThis.google;
  if(!google?.accounts?.oauth2){
    setDriveStatus('Google kimlik kitaplığı hazır değil. Sayfayı yenileyip tekrar dene.','error');
    showToast('Google bağlantısı henüz hazır değil.','error');
    return;
  }
  button.disabled=true;
  setDriveStatus('Google izin penceresi bekleniyor…','loading');
  // Start the token request directly inside the click gesture. Awaiting a script load here
  // can lose transient user activation and cause popup blockers to reject the Google flow.
  const tokenPromise=requestDriveAccessToken({clientId,googleLike:google});
  try{
    driveAccessToken=await tokenPromise;
    driveFolderStack=[{id:'root',name:'Drive'}];
    driveCurrentFolder='root';
    await loadDriveFolder('root');
  }catch(error){
    driveAccessToken='';
    setDriveStatus(error?.message||'Google Drive bağlantısı başarısız.','error');
    showToast(error?.message||'Google Drive bağlantısı başarısız.','error');
  }finally{button.disabled=false;}
}
async function downloadSelectedDriveFile(fileId){
  const file=driveVisibleFiles.find(item=>item.id===fileId);
  if(!file||isDriveFolder(file)||!isSupportedDriveGame(file))return;
  if(file.capabilities?.canDownload===false){showToast('Bu dosyanın indirilmesine Google Drive izin vermiyor.','error');return;}
  const extension=getFileExt(file.name);
  const limit=extension==='zip'?512*1024*1024:256*1024*1024;
  if(Number(file.size)>limit){showToast(`Dosya boyutu ${formatBytes(limit)} sınırını aşıyor.`,'error');return;}
  const button=[...$('#drive-files').querySelectorAll('[data-drive-download]')].find(item=>item.dataset.driveDownload===fileId);
  if(button)button.disabled=true;
  setDriveStatus(`İndiriliyor: ${file.name}`,'loading');
  try{
    const blob=await downloadDriveFile({accessToken:driveAccessToken,fileId,maxBytes:limit});
    if(blob.size===0)throw new Error('Drive dosyası boş.');
    if(blob.size>limit)throw new Error(`Dosya boyutu ${formatBytes(limit)} sınırını aşıyor.`);
    const importedFile=new File([blob],file.name,{type:blob.type||'application/octet-stream',lastModified:file.modifiedTime?Date.parse(file.modifiedTime)||Date.now():Date.now()});
    setDriveStatus(`İndirildi: ${file.name}. Yerel kütüphaneye aktarılıyor…`,'ready');
    await handleFiles([importedFile]);
    setDriveStatus(`İçe aktarma başlatıldı: ${file.name}`,'ready');
  }catch(error){
    setDriveStatus(error?.message||'Dosya indirilemedi.','error');
    showToast(error?.message||'Google Drive dosyası indirilemedi.','error');
  }finally{if(button)button.disabled=false;}
}
function setupDrive(){
  $('#drive-connect')?.addEventListener('click',connectDrive);
  $('#drive-up')?.addEventListener('click',()=>{
    if(driveFolderStack.length<=1)return;
    driveFolderStack.pop();
    driveCurrentFolder=driveFolderStack[driveFolderStack.length-1].id;
    loadDriveFolder(driveCurrentFolder);
  });
  $('#drive-load-more')?.addEventListener('click',()=>loadDriveFolder(driveCurrentFolder,{append:true}));
  $('#drive-files')?.addEventListener('click',async event=>{
    const folder=event.target.closest('[data-drive-folder]');
    if(folder){
      driveFolderStack.push({id:folder.dataset.driveFolder,name:folder.dataset.driveFolderName||'Klasör'});
      driveCurrentFolder=folder.dataset.driveFolder;
      await loadDriveFolder(driveCurrentFolder);
      return;
    }
    const download=event.target.closest('[data-drive-download]');
    if(download)await downloadSelectedDriveFile(download.dataset.driveDownload);
  });
  // Preload Google Identity before the user clicks so the OAuth popup is opened from a real gesture.
  // This code path is opt-in and runs only when a client ID is configured for this deployment.
  if(getDriveClientId()){
    const button=$('#drive-connect');
    if(button)button.disabled=true;
    setDriveStatus('Google bağlantı hizmeti hazırlanıyor…','loading');
    loadGoogleIdentity().then(()=>{
      if(button)button.disabled=false;
      setDriveStatus('Google Drive bağlantıya hazır.','ready');
    }).catch(error=>{
      if(button)button.disabled=true;
      setDriveStatus((error?.message||'Google kimlik kitaplığı yüklenemedi.')+' Sayfayı yenileyip tekrar dene.','error');
    });
  }
}

function setupEvents(){document.addEventListener('click',async e=>{const view=e.target.closest('[data-view]');if(view){setView(view.dataset.view);return;}if(e.target.closest('[data-action="add"]')||e.target.closest('#add-top')){openImport();return;}const play=e.target.closest('[data-play]');if(play){await startGame(play.dataset.play);return;}const fav=e.target.closest('[data-favorite]');if(fav){await toggleFavorite(fav.dataset.favorite);return;}const exportRom=e.target.closest('[data-export-rom]');if(exportRom){await exportROM(exportRom.dataset.exportRom);return;}const exportSram=e.target.closest('[data-export-sram]');if(exportSram){await exportBatterySave(exportSram.dataset.exportSram);return;}const remove=e.target.closest('[data-remove]');if(remove){await removeFromLibrary(remove.dataset.remove);return;}const removeBiosButton=e.target.closest('[data-remove-bios]');if(removeBiosButton){await removeBios(removeBiosButton.dataset.removeBios);return;}const filter=e.target.closest('[data-filter]');if(filter){selectedPlatform=filter.dataset.filter;libraryVisibleLimit=GRID_PAGE_SIZE;renderAll();return;}const more=e.target.closest('[data-load-more]');if(more){if(more.dataset.loadMore==='library'){libraryVisibleLimit+=GRID_PAGE_SIZE;renderLibraryResults();}else if(more.dataset.loadMore==='favorites'){favoriteVisibleLimit+=GRID_PAGE_SIZE;renderAll();}else if(more.dataset.loadMore==='recent'){recentVisibleLimit+=GRID_PAGE_SIZE;renderAll();}return;}const system=e.target.closest('[data-system-filter]');if(system){selectedPlatform=system.dataset.systemFilter;setView('library');renderAll();return;}const layout=e.target.closest('[data-layout]');if(layout){layoutMode=layout.dataset.layout;$$('[data-layout]').forEach(b=>b.classList.toggle('selected',b===layout));renderAll();return;}});$('#search-input').addEventListener('input',()=>{if($('#view-library').classList.contains('active')){libraryVisibleLimit=GRID_PAGE_SIZE;scheduleLibraryRender();}});$('#sort-select').addEventListener('change',()=>{libraryVisibleLimit=GRID_PAGE_SIZE;renderLibraryResults();});$('#modal-close').addEventListener('click',()=>closeImport());$('#player-close').addEventListener('click',()=>closePlayer());$('#pause-game').addEventListener('click',togglePause);$('#quick-save').addEventListener('click',()=>{void quickSave();});$('#quick-load').addEventListener('click',()=>{void quickLoad();});$('#immersive-save').addEventListener('click',()=>{void quickSave();});$('#immersive-load').addEventListener('click',()=>{void quickLoad();});$('#player-exit').addEventListener('click',()=>closePlayer());$('#update-reload')?.addEventListener('click',applyUpdate);$('#display-mode')?.addEventListener('click',()=>setDisplayMode(nextDisplayMode(displayMode)));$('#perf-test')?.addEventListener('click',()=>{void runPerformanceTest();});$('#perf-copy')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(historyReport(loadHistory()));showToast('Performans ölçümleri panoya kopyalandı.');}catch{showToast('Kopyalanamadı; metni seçip kopyalayabilirsin.','error');}});$('#perf-clear')?.addEventListener('click',()=>{try{localStorage.removeItem(PERF_HISTORY_KEY);}catch{}renderPerfHistory();});renderPerfHistory();$('#display-mode-setting')?.addEventListener('change',e=>setDisplayMode(e.target.value));updateDisplayModeUi();$('#update-later')?.addEventListener('click',()=>{const banner=$('#update-banner');if(banner)banner.hidden=true;});wireTouchControls();setupGamepadStatus();setupFullscreen();setupDrive();window.addEventListener('resize',()=>{if(activeEmulator&&!$('#player-modal').classList.contains('hidden')){try{activeEmulator.fitInParent();}catch(error){console.warn('Emulator canvas resize failed:',error);}}});$('#import-modal').addEventListener('click',e=>{if(e.target===$('#import-modal'))closeImport();});window.addEventListener('popstate',()=>{if(!$('#player-modal').classList.contains('hidden')){closePlayer({viaHistory:true});return;}if(!$('#import-modal').classList.contains('hidden'))closeImport({viaHistory:true});});document.addEventListener('visibilitychange',()=>{void handlePlayerVisibility();});$('#choose-files').addEventListener('click',e=>{e.preventDefault();$('#modal-file-input').click();});$('#modal-file-input').addEventListener('change',e=>handleFiles(e.target.files));$('#rom-input').addEventListener('change',e=>handleFiles(e.target.files));$('#bios-add')?.addEventListener('click',()=>$('#bios-input').click());$('#bios-input')?.addEventListener('change',e=>{void handleFiles(e.target.files);e.target.value='';});$('#clear-demo').addEventListener('click',clearDemo);$('#export-library').addEventListener('click',exportLibraryBackup);$('#import-library-trigger').addEventListener('click',()=>$('#library-backup-input').click());$('#library-backup-input').addEventListener('change',e=>{restoreLibraryBackup(e.target.files?.[0]);e.target.value='';});const dz=$('#dropzone');dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('dragover');});dz.addEventListener('dragleave',()=>dz.classList.remove('dragover'));dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('dragover');handleFiles(e.dataTransfer.files);});document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeImport();if(isFullscreen(document,$('#player-modal')))return;if(fullscreenFallback){setFullscreenFallback(false);return;}closePlayer();}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setView('library');$('#search-input').focus();}});window.addEventListener('online',updateNetwork);window.addEventListener('offline',updateNetwork);}
window.addEventListener('pagehide',()=>{void captureState('auto');void endSaveSession('pagehide');if(activeEmulator){try{activeEmulator.destroy();}catch{}activeEmulator=null;}});
function updateNetwork(){
  $('#network-label').textContent=navigator.onLine?'Bağlantı mevcut':'Çevrimdışı';
}
const RUNTIME_CACHE_NAME='retroplay-emulatorjs-4.2.3-v1';
let swRegistration=null;
let pendingUpdateWorker=null;
/** Shows which emulator cores are stored on this device for offline play. */
async function updateOfflineStatus(){
  const el=$('#offline-setting');
  if(!el||!('caches'in window))return;
  try{
    const keys=await (await caches.open(RUNTIME_CACHE_NAME)).keys();
    const {runtimeReady,cores}=summarizeRuntimeCache(keys.map(request=>request.url));
    el.textContent=runtimeReady?`Hazır · ${cores.length} çekirdek cihazda`:navigator.serviceWorker?.controller?'Hazırlanıyor…':'İlk açılış bekleniyor';
  }catch{el.textContent='Durum okunamadı';}
}
/** The update banner never appears over a running game; it waits until the player closes. */
function showUpdateBanner(){
  if(!pendingUpdateWorker||!$('#player-modal').classList.contains('hidden'))return;
  const banner=$('#update-banner');
  if(banner)banner.hidden=false;
}
function offerUpdate(worker){pendingUpdateWorker=worker;showUpdateBanner();}
function applyUpdate(){
  const banner=$('#update-banner');
  if(banner)banner.hidden=true;
  if(!activateUpdate(pendingUpdateWorker,{serviceWorker:navigator.serviceWorker,reload:()=>window.location.reload()}))window.location.reload();
}
async function registerSW(){
  if(!('serviceWorker'in navigator)){
    $('#offline-setting').textContent='Çevrimdışı uygulama desteklenmiyor';
    return;
  }
  try{
    swRegistration=await navigator.serviceWorker.register('/service-worker.js');
    watchServiceWorkerUpdates(swRegistration,{serviceWorker:navigator.serviceWorker,onUpdateReady:offerUpdate});
    navigator.serviceWorker.ready.then(()=>updateOfflineStatus());
    navigator.serviceWorker.addEventListener('controllerchange',()=>{void updateOfflineStatus();});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&navigator.onLine)swRegistration?.update().catch(()=>{});});
    updateNetwork();
    void updateOfflineStatus();
  }catch(e){
    $('#offline-setting').textContent='Önbellek kaydı başarısız';
    console.warn('Service worker registration failed:',e);
  }
}
async function init(){try{if(history.state?.retroplayOverlay)history.replaceState(null,'');}catch{}setupEvents();updateNetwork();try{db=await openDB();await refreshGames();void renderBiosList();$('#storage-status').textContent='Bu cihazda saklanır';}catch(e){$('#storage-status').textContent='Depolama kullanılamıyor';showToast(`Yerel kütüphane başlatılamadı: ${e.message}`,'error');games=DEMO_GAMES.map(g=>({...g}));renderAll();}registerSW();if('storage'in navigator&&navigator.storage.persist){navigator.storage.persist().then(granted=>{if(!granted)$('#storage-status').textContent='Tarayıcı depolaması';}).catch(()=>{});}}
init();
