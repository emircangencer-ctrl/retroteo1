import { inspectNesRom, diagnoseSuperMarioBros3Rom } from './nes-rom.js';
import { PLATFORM, platformInfo } from './platforms.js';
import { safeCoverColor, validBackup } from './library-backup.js';
import { extractRomFilesFromZip } from './zip-rom.js';
import { EmulatorJsPlayer } from './emulatorjs-nes-player.js';
import { getEmulatedSystem, isPlayablePlatform, supportsRomExtension } from './emulator-systems.js';
import { createBatterySaveRecord, emulatorGameId } from './save-data.js';
import { inspectGamepads, describeGamepads } from './gamepad-status.js';
import { fullscreenElement, isFullscreen, enterFullscreen, leaveFullscreen } from './fullscreen.js';
import { getDriveClientId, loadGoogleIdentity, requestDriveAccessToken, listDriveFiles, downloadDriveFile, isDriveFolder, isSupportedDriveGame } from './google-drive.js';
import './styles.css';
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const DB_NAME = 'retroplay-local-v1';
const DB_VERSION = 2;
const STORE = 'games';
const SAVE_STORE = 'batterySaves';
const DEMO_GAMES = [
  {id:'demo-mario',title:'Super Mario Bros. 3',platform:'NES',year:1988,genre:'Platform',symbol:'M',coverBg:'#244a78',coverGlow:'#e15b45',sizeLabel:'384 KB',demo:true,favorite:true,addedAt:5},
  {id:'demo-zelda',title:'The Legend of Zelda',platform:'NES',year:1986,genre:'Adventure',symbol:'Z',coverBg:'#5b4525',coverGlow:'#e2b65c',sizeLabel:'128 KB',demo:true,favorite:false,addedAt:4},
  {id:'demo-sonic',title:'Sonic the Hedgehog 2',platform:'MD',year:1992,genre:'Platform',symbol:'S',coverBg:'#1e4777',coverGlow:'#39a9e9',sizeLabel:'1 MB',demo:true,favorite:true,addedAt:3},
  {id:'demo-street',title:'Street Fighter II',platform:'SNES',year:1992,genre:'Fighting',symbol:'Ⅱ',coverBg:'#762f37',coverGlow:'#ef9d4d',sizeLabel:'2 MB',demo:true,favorite:false,addedAt:2},
  {id:'demo-goldeneye',title:'GoldenEye 007',platform:'N64',year:1997,genre:'Shooter',symbol:'007',coverBg:'#5a4930',coverGlow:'#b9a16a',sizeLabel:'12 MB',demo:true,favorite:false,addedAt:1},
  {id:'demo-metal',title:'Metal Slug',platform:'NEOGEO',year:1996,genre:'Run & gun',symbol:'MS',coverBg:'#354b3a',coverGlow:'#b3bd55',sizeLabel:'—',demo:true,favorite:false,addedAt:0}
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
let libraryRenderFrame = 0;
let driveAccessToken = '';
let driveCurrentFolder = 'root';
let driveFolderStack = [{ id: 'root', name: 'Drive' }];
let driveNextPageToken = '';
let driveVisibleFiles = [];
let driveListingGeneration = 0;

function openDB(){return new Promise((resolve,reject)=>{if(!('indexedDB' in window)){reject(new Error('Bu tarayıcı IndexedDB desteklemiyor.'));return;}const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=()=>{const d=req.result;if(!d.objectStoreNames.contains(STORE)){const st=d.createObjectStore(STORE,{keyPath:'id'});st.createIndex('addedAt','addedAt');st.createIndex('platform','platform');}if(!d.objectStoreNames.contains(SAVE_STORE))d.createObjectStore(SAVE_STORE,{keyPath:'id'});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||new Error('Yerel veritabanı açılamadı.'));});}
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
function deleteGame(id){return new Promise((resolve,reject)=>{const tx=db.transaction([STORE,SAVE_STORE],'readwrite');tx.objectStore(STORE).delete(id);tx.objectStore(SAVE_STORE).delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('Oyun ve yedek kayıtları silinemedi.'));tx.onabort=()=>reject(tx.error||new Error('Silme işlemi iptal edildi.'));});}
function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function showToast(message,type='success'){const el=$('#toast');el.textContent=message;el.className=`toast show ${type}`;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.className='toast',3600);}

function getFileExt(name){const i=name.lastIndexOf('.');return i>=0?name.slice(i+1).toLowerCase():'';}
async function sha256File(file){if(!globalThis.crypto?.subtle||file.size>256*1024*1024)return null;const bytes=await file.arrayBuffer();const digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');}
function storageErrorMessage(error){if(error?.name==='QuotaExceededError')return 'Tarayıcı depolama alanı dolu';if(error?.name==='DataCloneError')return 'Dosya tarayıcı depolamasına aktarılamadı';return error?.message||'Bilinmeyen depolama hatası';}
function guessPlatform(file){const ext=getFileExt(file.name);return Object.entries(PLATFORM).find(([,p])=>p.ext.includes(ext))?.[0]||'UNKNOWN';}
function renderCard(g){const p=platformInfo(g.platform);const bg=safeCoverColor(g.coverBg,p.color);const glow=safeCoverColor(g.coverGlow,p.glow);const fav=g.favorite?' favorited':'';const size=g.sizeLabel||formatBytes(g.size||0);const canPlay=!g.demo&&isPlayablePlatform(g.platform)&&!g.restoredMetadataOnly&&g.blob instanceof Blob;const actions=g.demo?'':`<div class="game-card-actions">${canPlay?`<button class="button primary small" data-play="${esc(g.id)}">▶ Oyna</button>`:''}${batterySaveIds.has(g.id)?`<button class="text-button" data-export-sram="${esc(g.id)}">SRAM yedeği indir</button>`:''}${g.restoredMetadataOnly?'':`<button class="text-button" data-export-rom="${esc(g.id)}">ROM dışa aktar</button>`}<button class="text-button remove-game" data-remove="${esc(g.id)}">Kütüphaneden kaldır</button></div>`;const fileLabel=g.demo?'Örnek içerik':g.restoredMetadataOnly?'Yedek kaydı · ROM yok':canPlay?`${p.short} · Oynatılabilir dosya`:'Yerel dosya';return `<article class="game-card" data-game-id="${esc(g.id)}"><div class="game-cover" style="--cover-bg:${esc(bg)};--cover-glow:${esc(glow)}"><span class="cover-tag">${esc(p.short.toUpperCase())}</span><span class="cover-symbol">${esc(g.symbol||p.logo)}</span><button class="favorite-button${fav}" data-favorite="${esc(g.id)}" aria-label="${g.favorite?'Favorilerden çıkar':'Favorilere ekle'}" title="${g.favorite?'Favorilerden çıkar':'Favorilere ekle'}">${g.favorite?'♥':'♡'}</button></div><div class="game-info"><h3 class="game-title" title="${esc(g.title)}">${esc(g.title)}</h3><div class="game-meta"><span>${esc(g.year||'Yıl bilinmiyor')}</span><span class="platform-pill">${esc(p.short)}</span></div><div class="game-foot"><span>${fileLabel}</span><span class="status">${esc(size)}</span></div>${actions}</div></article>`;}
function formatBytes(n){if(!Number.isFinite(n)||n<=0)return '—';const units=['B','KB','MB','GB'];const i=Math.min(Math.floor(Math.log(n)/Math.log(1024)),units.length-1);return `${(n/Math.pow(1024,i)).toFixed(i?1:0)} ${units[i]}`;}
function renderSystemTile(key){const p=platformInfo(key);const count=games.filter(g=>g.platform===key).length;return `<button class="system-tile" data-system-filter="${key}"><span class="system-logo">${esc(p.logo)}</span><span><strong>${esc(p.short)}</strong><small>${count?`${count} kütüphane kaydı`:'Platform hazır değil'}</small></span></button>`;}
function renderSystemRow(key){const p=platformInfo(key);const count=games.filter(g=>g.platform===key&&!g.demo).length;return `<article class="system-row"><span class="system-logo">${esc(p.logo)}</span><div class="system-row-copy"><strong>${esc(p.short)} <span style="color:#8291aa;font-weight:500">· ${esc(p.label)}</span></strong><p>${key==='N64'?'Uyumluluk oyun ve cihaz bazında ayrıca test edilecek.':key==='CPS1'||key==='CPS2'||key==='NEOGEO'?'Arcade dosyaları için çekirdek ve doğru dosya seti gereklidir.':'İlk sürüm platform adayı; emülatör entegrasyonu henüz eklenmedi.'}</p></div><span class="system-row-count">${count} yerel oyun</span></article>`;}
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
  $('#home-systems').innerHTML=['NES','SNES','MD','N64','CPS1','CPS2','NEOGEO'].map(renderSystemTile).join('');
  $('#systems-list').innerHTML=['NES','SNES','MD','N64','CPS1','CPS2','NEOGEO'].map(renderSystemRow).join('');
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
function openImport(){const m=$('#import-modal');m.classList.remove('hidden');$('#import-results').textContent='';$('#import-progress').classList.add('hidden');$('#modal-file-input').value='';$('#choose-files').focus();}
function closeImport(){ $('#import-modal').classList.add('hidden'); }
async function handleFiles(fileList){
  const selected=[...fileList];if(!selected.length)return;
  $('#import-modal').classList.remove('hidden');$('#import-progress').classList.remove('hidden');$('#import-results').textContent='';
  const files=[];let archiveSkipped=0,archiveFailed=0;const archiveMessages=[];
  for(const source of selected){
    if(getFileExt(source.name)!=='zip'){files.push(source);continue;}
    try{
      const extracted=await extractRomFilesFromZip(source);
      files.push(...extracted);
      archiveMessages.push(`ZIP açıldı: ${source.name} — ${extracted.length} desteklenen ROM bulundu\n`);
    }catch(error){archiveFailed++;archiveMessages.push(`ZIP hatası: ${source.name} — ${error?.message||error}\n`);}
  }
  if(!files.length){
    $('#import-progress').classList.add('hidden');
    $('#import-results').textContent=`Tamamlandı: 0 · Atlandı: ${archiveSkipped} · Hata: ${archiveFailed}\n`+archiveMessages.join('');
    showToast(archiveFailed?'ZIP açılamadı. Ayrıntılar içe aktarma penceresinde.':'ZIP içinde içe aktarılabilir ROM bulunamadı.','error');
    return;
  }
  const progress=$('#progress-bar');let done=0,success=0,skipped=archiveSkipped,failed=archiveFailed;const total=files.reduce((n,f)=>n+f.size,0);
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
  for(const file of files){
    try{
      const ext=getFileExt(file.name);
      if(!supported.includes(ext)){skipped++;$('#import-results').textContent+=`Atlandı: ${file.name} — tanınmayan uzantı\n`;continue;}
      if(file.size===0){skipped++;$('#import-results').textContent+=`Atlandı: ${file.name} — dosya boş\n`;continue;}
      let romValidation=null;
      if(ext==='nes'){
        const header=await file.slice(0,16).arrayBuffer();
        romValidation=inspectNesRom(header,{totalSize:file.size});
        if(!romValidation.valid){skipped++;$('#import-results').textContent+=`Atlandı: ${file.name} — NES doğrulaması başarısız: ${romValidation.reason}\n`;continue;}
      }
      const hash=await sha256File(file);
      if(hash&&games.some(g=>!g.demo&&g.contentHash===hash)){
        skipped++;$('#import-results').textContent+=`Atlandı: ${file.name} — aynı içerik kütüphanede zaten var\n`;continue;
      }
      const platform=guessPlatform(file);
      const id=`rom-${crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(16).slice(2)}`;
      const title=file.name.replace(/\.[^.]+$/,'').replace(/[._-]+/g,' ').trim()||file.name;
      const game={id,title,platform,year:null,genre:'Bilinmiyor',symbol:platformInfo(platform).logo,coverBg:platformInfo(platform).color,coverGlow:platformInfo(platform).glow,fileName:file.name,size:file.size,sizeLabel:formatBytes(file.size),contentHash:hash,blob:file,romValidation,addedAt:Date.now(),favorite:false,demo:false,playable:false,status:platform==='UNKNOWN'?'platform-unknown':'imported'};
      await saveGame(game);games.push(game);success++;
      $('#import-results').textContent+=`Eklendi: ${file.name}${hash?' — içerik parmak izi alındı':''}\n`;
    }catch(e){failed++;$('#import-results').textContent+=`Hata: ${file.name} — ${storageErrorMessage(e)}\n`;}
    finally{done++;const pct=Math.round(done/files.length*100);$('#progress-percent').textContent=`${pct}%`;progress.style.width=`${pct}%`;$('#progress-label').textContent=`İşlenen ${done}/${files.length} · ${formatBytes(Math.min(total,files.slice(0,done).reduce((n,f)=>n+f.size,0)))}`;}
  }
  await refreshGames();$('#progress-label').textContent='İçe aktarma tamamlandı';$('#progress-percent').textContent=`${success}/${files.length}`;
  $('#import-results').textContent=`Tamamlandı: ${success} · Atlandı: ${skipped} · Hata: ${failed}\n`+$('#import-results').textContent;
  showToast(`${success} ROM dosyası içe aktarıldı. Oynatma desteği NES, SNES ve Mega Drive için etkin.`,success?'success':'error');setView('library');
}

async function requestedNesCore() {
  const { resolveNesCore } = await import('./nes-engine.js');
  return resolveNesCore(window.location.search);
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
async function startGame(id) {
  const game = games.find(g => g.id === id && !g.demo);
  if (!game || !isPlayablePlatform(game.platform) || !(game.blob instanceof Blob)) {
    showToast('Bu kayıt için henüz desteklenen bir sistemde oynatılabilir ROM bulunamadı.', 'error');
    return;
  }
  const session = ++emulatorSession;
  if (activeEmulator) {
    try { activeEmulator.destroy(); } catch {}
    activeEmulator = null;
  }

  activeGameId = game.id;
  emulatorPaused = false;
  $('#player-title').textContent = game.title;
  renderTouchControls(game.platform);
  updateGamepadStatus();
  $('#player-status').textContent = 'ROM yükleniyor…';
  $('#player-error').textContent = '';
  $('#player-modal').classList.remove('hidden');
  $('#player-screen').replaceChildren();
  $('#pause-game').textContent = 'Ⅱ Duraklat';
  $('#pause-game').disabled = true;

  try {
    const bytes = new Uint8Array(await game.blob.arrayBuffer());
    const system = getEmulatedSystem(game.platform);
    if (!system) throw new Error('Bu sistem için emülatör kaydı bulunamadı.');
    const extension = getFileExt(game.fileName || game.title);
    if (!supportsRomExtension(game.platform, extension)) {
      throw new Error(`${system.shortLabel} sistemi için desteklenmeyen dosya uzantısı: .${extension || 'bilinmiyor'}`);
    }
    const validation = game.platform === 'NES'
      ? inspectNesRom(bytes)
      : { valid: bytes.byteLength > 0, system: game.platform, mapper: null };
    if (session !== emulatorSession || activeGameId !== game.id) return;
    if (!validation.valid) {
      throw new Error(validation.reason || 'ROM başlığı veya dosya uzunluğu geçersiz.');
    }
    const smb3Diagnostic = game.platform === 'NES'
      ? diagnoseSuperMarioBros3Rom(bytes, `${game.fileName || ''} ${game.title}`, validation)
      : null;
    if (smb3Diagnostic?.status === 'review') {
      $('#player-error').textContent = `ROM denetimi uyarısı: ${smb3Diagnostic.message}`;
    }

    const reportError = error => {
      if (session !== emulatorSession || activeGameId !== game.id) return;
      const message = error?.message || String(error || 'Bilinmeyen emülatör hatası');
      $('#player-error').textContent = `Oyun motoru hatası: ${message}`;
      $('#player-status').textContent = 'Oturum durduruldu';
    };

    const engine = game.platform === 'NES' ? await requestedNesCore() : 'emulatorjs';
    if (engine === 'emulatorjs') {
      const player = new EmulatorJsPlayer($('#player-screen'), {
        onError: reportError,
        systemId: system.emulatorJsSystemId,
        coreId: system.emulatorJsCoreId,
        systemLabel: system.shortLabel,
        gameId: emulatorGameId(game),
        onSaveUpdate: update => {
          saveBatteryBackup(game, update).then(saved => {
            if (!saved) return;
            batterySaveIds.add(game.id);
            if (session === emulatorSession && activeGameId === game.id) renderAll();
          }).catch(error => {
            if (session !== emulatorSession || activeGameId !== game.id) return;
            $('#player-error').textContent = `Oyun içi batarya kaydı yerel yedeğe yazılamadı: ${error?.message || error}`;
          });
        }
      });
      activeEmulator = player;
      activeEmulator.romInfo = validation;
      activeEmulator.romDiagnostic = smb3Diagnostic;
      await player.loadROM(bytes, game.title);
      if (session !== emulatorSession || activeGameId !== game.id) {
        player.destroy();
        return;
      }
    } else if (engine === 'jsnes') {
      // Legacy engine retained only for explicit A/B comparison.
      const { Browser: NesBrowser, Controller: NesController } = await import('jsnes');
      const browser = new NesBrowser({ container: $('#player-screen'), onError: reportError });
      if (browser._speakers) browser._speakers.onBufferUnderrun = null;
      activeEmulator = {
        engineName: 'JSNES (karşılaştırma)', romInfo: validation,
        destroy: () => browser.destroy(),
        pause: () => browser.stop(), resume: () => browser.start(),
        fitInParent: () => browser.fitInParent(),
        pressButton: name => { const button = NesController[name]; if (button !== undefined) browser.nes.buttonDown(1, button); },
        releaseButton: name => { const button = NesController[name]; if (button !== undefined) browser.nes.buttonUp(1, button); }
      };
      browser.loadROM(bytes);
    } else {
      const { BrowserNesPlayer } = await import('./nes-core-player.js');
      const player = new BrowserNesPlayer($('#player-screen'), {
        onError: reportError,
        onAudioError: error => {
          const message = error?.message || String(error);
          $('#player-error').textContent = `Oyun çalışıyor ancak ses başlatılamadı: ${message}`;
        }
      });
      activeEmulator = player;
      activeEmulator.romInfo = validation;
      await player.loadROM(bytes);
      if (session !== emulatorSession || activeGameId !== game.id) { player.destroy(); return; }
      activeEmulator.romInfo = player.romInfo || validation;
      await player.start();
      if (session !== emulatorSession || activeGameId !== game.id) { player.destroy(); return; }
    }

    $('#player-status').textContent = playerStatus('Çalışıyor');
    $('#pause-game').disabled = false;
    game.lastPlayed = Date.now();
    await saveGame(game);
    await refreshGames();
  } catch (error) {
    if (session !== emulatorSession || activeGameId !== game.id) return;
    if (activeEmulator) {
      try { activeEmulator.destroy(); } catch {}
      activeEmulator = null;
    }
    $('#player-status').textContent = 'Başlatılamadı';
    $('#player-error').textContent = `Bu ROM çalıştırılamadı: ${error?.message || error}. ROM biçimi ve mapper desteği kontrol edilmeli.`;
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
  if (result.error) {
    showToast('Tarayıcı tam ekrana geçişi engelledi. Tarayıcı izinlerini kontrol et.', 'error');
    return;
  }
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
    updateFullscreenButton();
    requestAnimationFrame(() => {
      try { activeEmulator?.fitInParent?.(); } catch {}
    });
  };
  document.addEventListener('fullscreenchange', onChange);
  document.addEventListener('webkitfullscreenchange', onChange);
  updateFullscreenButton();
}

function closePlayer() {
  emulatorSession += 1;
  if (activeEmulator) {
    try { activeEmulator.destroy(); } catch {}
    activeEmulator = null;
  }
  activeGameId = null;
  emulatorPaused = false;
  if (isFullscreen(document, $('#player-modal'))) void leaveFullscreen(document);
  if (fullscreenFallback) setFullscreenFallback(false);
  $('#player-modal').classList.add('hidden');
  $('#player-screen').replaceChildren();
}
async function togglePause() {
  if (!activeEmulator) return;
  try {
    if (emulatorPaused) {
      await activeEmulator.resume();
      emulatorPaused = false;
      $('#pause-game').textContent = 'Ⅱ Duraklat';
      $('#player-status').textContent = playerStatus('Çalışıyor');
    } else {
      await activeEmulator.pause();
      emulatorPaused = true;
      $('#pause-game').textContent = '▶ Devam et';
      $('#player-status').textContent = playerStatus('Duraklatıldı');
    }
  } catch (error) {
    $('#player-error').textContent = `Duraklatma/devam hatası: ${error?.message || error}`;
  }
}
function renderTouchControls(platform) {
  const root = $('#touch-controls');
  const system = getEmulatedSystem(platform);
  if (!root || !system) return;
  const button = ({ label, input, ariaLabel = label }) => `<button data-nes-button="${esc(input)}" aria-label="${esc(ariaLabel)}">${esc(label)}</button>`;
  root.dataset.platform = platform;
  root.innerHTML = `<div class="dpad"><button data-nes-button="BUTTON_UP" aria-label="Yukarı">▲</button><div><button data-nes-button="BUTTON_LEFT" aria-label="Sola">◀</button><button data-nes-button="BUTTON_DOWN" aria-label="Aşağı">▼</button><button data-nes-button="BUTTON_RIGHT" aria-label="Sağa">▶</button></div></div><div class="action-pad">${system.actionButtons.map(button).join('')}</div><div class="system-pad">${system.showSelect ? button({label:'SELECT',input:'BUTTON_SELECT'}) : ''}${system.showStart ? button({label:'START',input:'BUTTON_START'}) : ''}</div>`;
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

async function refreshGames(){const [stored,saves]=await Promise.all([allStored(),allBatterySaves()]);batterySaveIds=new Set(saves.map(save=>save.id));games=[...DEMO_GAMES.map(g=>({...g})),...stored];renderAll();}
async function toggleFavorite(id){const game=games.find(g=>g.id===id);if(!game)return;game.favorite=!game.favorite;if(!game.demo){try{await saveGame(game);}catch(e){game.favorite=!game.favorite;showToast(`Favori kaydedilemedi: ${e.message}`,'error');return;}}renderAll();showToast(game.favorite?'Favorilere eklendi.':'Favorilerden çıkarıldı.');}
async function removeFromLibrary(id){const game=games.find(g=>g.id===id);if(!game||game.demo)return;const ok=confirm(`“${game.title}” kaydını kütüphaneden kaldırmak istiyor musun?\n\nBu işlem bu tarayıcıdaki ROM kopyasını, kütüphane kaydını ve varsa SRAM yedeğini de siler. Orijinal dosya değiştirilmez.`);if(!ok)return;try{await deleteGame(id);await refreshGames();showToast('Kayıt bu tarayıcıdan kaldırıldı. Orijinal dosya değiştirilmedi.');}catch(e){showToast(`Kaldırılamadı: ${e.message}`,'error');}}
function downloadBlob(blob,filename){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function exportBatterySave(id){const game=games.find(g=>g.id===id&&!g.demo);if(!game)return;try{const record=await getBatterySave(id);if(!record?.bytes||!record.byteLength){showToast('Bu oyun için henüz SRAM/batarya kaydı yok. Bir oyun içi kayıt yaptıktan sonra tekrar dene.','error');return;}const bytes=record.bytes instanceof Uint8Array?record.bytes:new Uint8Array(record.bytes);downloadBlob(new Blob([bytes],{type:'application/octet-stream'}),`${safeFilename(game.title||game.fileName||'retroplay-save')}.srm`);showToast(`SRAM yedeği indirildi (${formatBytes(bytes.byteLength)}).`);}catch(error){showToast(`SRAM yedeği indirilemedi: ${error?.message||error}`,'error');}}
function safeFilename(name){return String(name||'retroplay').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(0,140)||'retroplay';}
async function exportROM(id){const game=games.find(g=>g.id===id&&!g.demo);if(!game)return;if(!(game.blob instanceof Blob)){showToast('Bu oyun için yerel ROM içeriği bulunamadı. Dosyayı yeniden içe aktar.','error');return;}try{downloadBlob(game.blob,safeFilename(game.fileName||`${game.title}.rom`));showToast('ROM dışa aktarma başlatıldı.');}catch(e){showToast(`ROM dışa aktarılamadı: ${storageErrorMessage(e)}`,'error');}}
function backupMetadata(game){const {blob,...metadata}=game;return metadata;}
function exportLibraryBackup(){try{const payload={app:'RetroPlay',backupType:'library-metadata',schemaVersion:1,appVersion:'0.3.0',createdAt:new Date().toISOString(),gameCount:games.filter(g=>!g.demo).length,games:games.filter(g=>!g.demo).map(backupMetadata)};const json=JSON.stringify(payload,null,2);downloadBlob(new Blob([json],{type:'application/json'}),`RetroPlay-Library-${new Date().toISOString().slice(0,10)}-v0.3.0.json`);showToast('Kütüphane yedeği hazırlandı. ROM içerikleri bu dosyaya dahil değildir.');}catch(e){showToast(`Yedek oluşturulamadı: ${e.message}`,'error');}}

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

function setupEvents(){document.addEventListener('click',async e=>{const view=e.target.closest('[data-view]');if(view){setView(view.dataset.view);return;}if(e.target.closest('[data-action="add"]')||e.target.closest('#add-top')){openImport();return;}const play=e.target.closest('[data-play]');if(play){await startGame(play.dataset.play);return;}const fav=e.target.closest('[data-favorite]');if(fav){await toggleFavorite(fav.dataset.favorite);return;}const exportRom=e.target.closest('[data-export-rom]');if(exportRom){await exportROM(exportRom.dataset.exportRom);return;}const exportSram=e.target.closest('[data-export-sram]');if(exportSram){await exportBatterySave(exportSram.dataset.exportSram);return;}const remove=e.target.closest('[data-remove]');if(remove){await removeFromLibrary(remove.dataset.remove);return;}const filter=e.target.closest('[data-filter]');if(filter){selectedPlatform=filter.dataset.filter;libraryVisibleLimit=GRID_PAGE_SIZE;renderAll();return;}const more=e.target.closest('[data-load-more]');if(more){if(more.dataset.loadMore==='library'){libraryVisibleLimit+=GRID_PAGE_SIZE;renderLibraryResults();}else if(more.dataset.loadMore==='favorites'){favoriteVisibleLimit+=GRID_PAGE_SIZE;renderAll();}else if(more.dataset.loadMore==='recent'){recentVisibleLimit+=GRID_PAGE_SIZE;renderAll();}return;}const system=e.target.closest('[data-system-filter]');if(system){selectedPlatform=system.dataset.systemFilter;setView('library');renderAll();return;}const layout=e.target.closest('[data-layout]');if(layout){layoutMode=layout.dataset.layout;$$('[data-layout]').forEach(b=>b.classList.toggle('selected',b===layout));renderAll();return;}});$('#search-input').addEventListener('input',()=>{if($('#view-library').classList.contains('active')){libraryVisibleLimit=GRID_PAGE_SIZE;scheduleLibraryRender();}});$('#sort-select').addEventListener('change',()=>{libraryVisibleLimit=GRID_PAGE_SIZE;renderLibraryResults();});$('#modal-close').addEventListener('click',closeImport);$('#player-close').addEventListener('click',closePlayer);$('#player-modal').addEventListener('click',e=>{if(e.target===$('#player-modal'))closePlayer();});$('#pause-game').addEventListener('click',togglePause);$('#player-exit').addEventListener('click',closePlayer);wireTouchControls();setupGamepadStatus();setupFullscreen();setupDrive();window.addEventListener('resize',()=>{if(activeEmulator&&!$('#player-modal').classList.contains('hidden')){try{activeEmulator.fitInParent();}catch(error){console.warn('Emulator canvas resize failed:',error);}}});$('#import-modal').addEventListener('click',e=>{if(e.target===$('#import-modal'))closeImport();});$('#choose-files').addEventListener('click',e=>{e.preventDefault();$('#modal-file-input').click();});$('#modal-file-input').addEventListener('change',e=>handleFiles(e.target.files));$('#rom-input').addEventListener('change',e=>handleFiles(e.target.files));$('#clear-demo').addEventListener('click',clearDemo);$('#export-library').addEventListener('click',exportLibraryBackup);$('#import-library-trigger').addEventListener('click',()=>$('#library-backup-input').click());$('#library-backup-input').addEventListener('change',e=>{restoreLibraryBackup(e.target.files?.[0]);e.target.value='';});const dz=$('#dropzone');dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('dragover');});dz.addEventListener('dragleave',()=>dz.classList.remove('dragover'));dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('dragover');handleFiles(e.dataTransfer.files);});document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeImport();if(isFullscreen(document,$('#player-modal')))return;if(fullscreenFallback){setFullscreenFallback(false);return;}closePlayer();}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setView('library');$('#search-input').focus();}});window.addEventListener('online',updateNetwork);window.addEventListener('offline',updateNetwork);}
window.addEventListener('pagehide',()=>{if(activeEmulator){try{activeEmulator.destroy();}catch{}activeEmulator=null;}});
function updateNetwork(){
  const online=navigator.onLine;
  $('#network-label').textContent=online?'Bağlantı mevcut':'Çevrimdışı';
  $('#offline-setting').textContent=online
    ? 'Oyunlar için internet gerekebilir'
    : 'Uygulama hazır; oyun motoru bağlantı isteyebilir';
}
async function registerSW(){
  if(!('serviceWorker'in navigator)){
    $('#offline-setting').textContent='Çevrimdışı uygulama desteklenmiyor';
    return;
  }
  try{
    await navigator.serviceWorker.register('/service-worker.js');
    updateNetwork();
  }catch(e){
    $('#offline-setting').textContent='Önbellek kaydı başarısız';
    console.warn('Service worker registration failed:',e);
  }
}
async function init(){setupEvents();updateNetwork();try{db=await openDB();await refreshGames();$('#storage-status').textContent='Bu cihazda saklanır';}catch(e){$('#storage-status').textContent='Depolama kullanılamıyor';showToast(`Yerel kütüphane başlatılamadı: ${e.message}`,'error');games=DEMO_GAMES.map(g=>({...g}));renderAll();}registerSW();if('storage'in navigator&&navigator.storage.persist){navigator.storage.persist().then(granted=>{if(!granted)$('#storage-status').textContent='Tarayıcı depolaması';}).catch(()=>{});}}
init();
