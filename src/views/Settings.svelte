<script lang="ts">
  import { tick, untrack } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import TouchSettings from '../components/TouchSettings.svelte';
  import { settings, ACCENTS } from '../lib/settings.svelte.ts';
  import { library } from '../lib/library.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import { app, APP_VERSION } from '../lib/app-state.svelte.ts';
  import { gamepadUI } from '../lib/gamepad-ui.svelte.ts';
  import { importer } from '../lib/importer.svelte.ts';
  import { exportLibraryBackup, restoreLibraryBackup } from '../lib/backup.ts';
  import { confirmDialog } from '../lib/dialog.svelte.ts';
  import { showToast } from '../lib/toast.svelte.ts';
  import { deleteBios, savesFootprint } from '../lib/db.ts';
  import { formatBytes } from '../lib/format.ts';
  import { player } from '../player/session.svelte.ts';
  import { DISPLAY_SCALES, DISPLAY_FILTERS, type DisplayScale, type DisplayFilter } from '../display-modes.js';
  import { loadHistory, historyReport, PERF_HISTORY_KEY } from '../performance-meter.js';
  import { inspectGamepads, describeGamepads } from '../gamepad-status.js';
  import { tv } from '../lib/tv.svelte.ts';
  import { TV_APK_URL } from '../lib/tv.ts';
  const tvInstallUrl = typeof location !== 'undefined' ? `${location.host}/tv` : 'retroplay/tv';

  const scales = Object.entries(DISPLAY_SCALES) as Array<[DisplayScale, { label: string; hint: string }]>;
  const filters = Object.entries(DISPLAY_FILTERS) as Array<[DisplayFilter, { label: string; hint: string }]>;
  let perf = $state(historyReport(loadHistory()));
  let backupInput: HTMLInputElement | null = $state(null);
  let biosInput: HTMLInputElement | null = $state(null);
  let usage = $state<{ games: number; bios: number; saves: number | null; caches: number | null; used: number | null; quota: number | null } | null>(null);
  let padText = $state(describeGamepads(inspectGamepads(navigator)));

  // #/settings?s=controls opens at that section.
  $effect(() => {
    const section = router.route.name === 'settings' ? router.route.query.s : '';
    if (!section) return;
    void tick().then(() => document.getElementById(`settings-${section}`)?.scrollIntoView({ block: 'start' }));
  });

  $effect(() => {
    let alive = true;
    const games = library.games.reduce((n, g) => n + (g.blob instanceof Blob ? g.blob.size : 0), 0);
    const bios = library.bios.reduce((n, b) => n + (Number(b.size) || 0), 0);
    const previous = untrack(() => usage);
    usage = { games, bios, saves: previous?.saves ?? null, caches: previous?.caches ?? null, used: previous?.used ?? null, quota: previous?.quota ?? null };
    Promise.all([savesFootprint().catch(() => null), navigator.storage?.estimate?.().catch(() => null)]).then(([saves, estimate]) => {
      if (!alive) return;
      const details = (estimate as (StorageEstimate & { usageDetails?: { caches?: number } }) | null)?.usageDetails;
      usage = { games, bios, saves, caches: typeof details?.caches === 'number' ? details.caches : null, used: estimate?.usage ?? null, quota: estimate?.quota ?? null };
    });
    return () => { alive = false; };
  });

  const total = $derived(usage ? usage.games + usage.bios + (usage.saves || 0) + (usage.caches || 0) : 0);
  const share = (n: number | null | undefined) => (total > 0 && n ? `${Math.max(1, Math.round((n / total) * 100))}%` : '0%');

  async function addBios(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = input.files ? [...input.files] : [];
    input.value = '';
    if (!files.length) return;
    const result = await importer.importDirect(files);
    if (result.bios) showToast(`${result.bios} BIOS dosyası eklendi.`);
    else showToast(result.added ? 'Dosya oyun olarak eklendi; BIOS olarak tanınmadı.' : 'Seçilen dosya bir BIOS olarak tanınmadı.', 'error');
  }

  async function removeBios(id: string) {
    if (!(await confirmDialog({ title: `${id} silinsin mi?`, message: "Bu BIOS'u kullanan oyunlar, dosyayı yeniden ekleyene kadar açılmaz.", confirmLabel: 'Sil', danger: true }))) return;
    try { await deleteBios(id); await library.refreshBios(); showToast(`${id} silindi.`); }
    catch (error) { showToast(`Silinemedi: ${(error as Error)?.message || error}`, 'error'); }
  }

  async function copyPerf() {
    try { await navigator.clipboard.writeText(historyReport(loadHistory())); showToast('Performans ölçümleri panoya kopyalandı.'); }
    catch { showToast('Kopyalanamadı; metni seçip kopyalayabilirsin.', 'error'); }
  }
  function clearPerf() { try { localStorage.removeItem(PERF_HISTORY_KEY); } catch {} perf = historyReport(loadHistory()); }
</script>

<div class="page settings" id="view-settings">
  <header class="page-head"><h1 class="display-title">Ayarlar</h1></header>

  <h2 class="eyebrow section" id="settings-display">Görüntü</h2>
  <div class="panel">
    <div class="row stack">
      <span class="label">Ölçekleme</span>
      <div class="seg" role="group" aria-label="Ölçekleme" id="display-scale">
        {#each scales as [key, scale] (key)}
          <button type="button" data-value={key} aria-pressed={settings.display.scale === key} onclick={() => player.setDisplay({ scale: key })}>{scale.label}</button>
        {/each}
      </div>
      <p class="hint">{DISPLAY_SCALES[settings.display.scale as keyof typeof DISPLAY_SCALES].hint}</p>
    </div>
    <div class="row stack">
      <span class="label">Ekran filtresi</span>
      <div class="seg" role="group" aria-label="Ekran filtresi" id="display-filter">
        {#each filters as [key, filter] (key)}
          <button type="button" data-value={key} aria-pressed={settings.display.filter === key} onclick={() => player.setDisplay({ filter: key })}>{filter.label}</button>
        {/each}
      </div>
      <p class="hint">{DISPLAY_FILTERS[settings.display.filter as keyof typeof DISPLAY_FILTERS].hint}</p>
    </div>
    <label class="row stack">
      <span class="head"><span class="label">Ses</span><output class="value">%{Math.round(settings.prefs.volume * 100)}</output></span>
      <input type="range" min="0" max="100" step="5" value={Math.round(settings.prefs.volume * 100)} oninput={e => player.setVolume(Number((e.currentTarget as HTMLInputElement).value) / 100)} />
    </label>
    <div class="row stack">
      <span class="label">Vurgu rengi</span>
      <div class="swatches" role="radiogroup" aria-label="Vurgu rengi">
        {#each ACCENTS as accent (accent.value)}
          <button type="button" role="radio" aria-checked={settings.prefs.accent === accent.value} aria-label={accent.label} style:--swatch={accent.value} onclick={() => settings.setPrefs({ accent: accent.value })}></button>
        {/each}
      </div>
    </div>
    <div class="row">
      <span class="grow"><span class="label">Kapak resimleri</span><span class="hint">Oyunların kutu resimleri RetroArch'ın kapak arşivinden (GitHub) bir kez indirilir ve bu cihazda saklanır. Arşive yalnızca oyunun adı gider, dosyası gitmez.</span></span>
      <button type="button" class="switch" role="switch" aria-checked={settings.prefs.covers} aria-label="Kapak resimleri" id="setting-covers" onclick={() => settings.setPrefs({ covers: !settings.prefs.covers })}></button>
    </div>
  </div>

  <h2 class="eyebrow section" id="settings-controls">Kontroller</h2>
  <div class="panel">
    <TouchSettings prefix="set" />
  </div>
  <div class="panel">
    <div class="row">
      <Icon name="gamepad" size={22} />
      <span class="grow"><span class="label">Kontrolcü (gamepad)</span><span class="hint">{padText}</span></span>
      <button type="button" class="btn btn-sm" onclick={() => (padText = describeGamepads(inspectGamepads(navigator)))}>Yeniden tara</button>
    </div>
    <div class="row stack">
      <p class="hint">USB veya Bluetooth kontrolcü bağla ve bir tuşa bas. Oyunda düğmeler konumlarına göre eşlenir (alt = B, sağ = A, sol = Y, üst = X), sol çubuk yön tuşudur; konsol oyunlarında <b>R2</b> hızlı ileri sarar, <b>L2</b> basılı tutulunca geri sarar; oyun menüsü ortadaki ana düğme ya da <b>Select + Start</b> ile açılır. Menülerde yön tuşu gezer, <b>A</b> seçer, <b>B</b> geri döner; kütüphanede <b>X</b> favori, <b>Y</b> ayrıntılar, <b>L/R</b> sistem değiştirir.</p>
    </div>
  </div>

  <h2 class="eyebrow section" id="settings-saves">Kayıtlar</h2>
  <div class="panel">
    <div class="row">
      <span class="grow"><span class="label">Çıkışta devam noktası</span><span class="hint">Oyundan çıkınca kaldığın an kaydedilir; oyun bir dahaki sefere oradan açılır</span></span>
      <button type="button" class="switch" role="switch" aria-checked={settings.prefs.autoResume} aria-label="Çıkışta devam noktası" id="setting-auto-resume" onclick={() => settings.setPrefs({ autoResume: !settings.prefs.autoResume })}></button>
    </div>
    <div class="row">
      <span class="grow"><span class="label">Oyun içi kayıt yedeği</span><span class="hint">Her 30 saniyede, duraklatınca, uygulama arka plana geçince ve çıkışta; oyunun sayfasından .srm olarak indirilebilir</span></span>
      <Icon name="check" size={20} stroke={2.2} class="ok-icon" />
    </div>
    <div class="row">
      <span class="grow"><span class="label">Kayıt yuvaları</span><span class="hint">Oyun menüsünden 3 yuvaya resmiyle kaydet; hızlı kayıt üst çubukta. Hepsi oyunun sayfasında listelenir.</span></span>
    </div>
  </div>

  <h2 class="eyebrow section" id="settings-bios">BIOS dosyaları</h2>
  <div class="panel">
    <div class="row stack">
      <p class="hint">Bazı arcade oyunları sistemin kendi BIOS dosyasını ister; en önemlisi Neo Geo oyunları için neogeo.zip. Zip'i ekle; RetroPlay onu BIOS olarak tanır, gerekli dosyaları kontrol eder ve bu cihazda saklar.</p>
    </div>
    <div class="bios-list" id="bios-list">
      {#each library.bios as record (record.id)}
        <div class="row bios-row">
          <span class="grow"><span class="label">{record.id}</span><span class="hint">{record.label || 'BIOS'} · {formatBytes(record.size)} · {record.missing?.length ? `eksik dosya: ${record.missing.join(', ')}` : 'kullanıma hazır'}</span></span>
          <button type="button" class="btn btn-sm btn-danger" data-remove-bios={record.id} onclick={() => removeBios(record.id)}>Kaldır</button>
        </div>
      {/each}
      {#if !library.biosIds.has('neogeo.zip')}
        <div class="row bios-row missing"><span class="grow"><span class="label">neogeo.zip</span><span class="hint">Neo Geo oyunları için gerekli · henüz eklenmedi</span></span></div>
      {/if}
    </div>
    <div class="row">
      <button type="button" class="btn btn-sm" id="bios-add" onclick={() => biosInput?.click()}><Icon name="plus" size={16} />BIOS ekle</button>
      <input bind:this={biosInput} type="file" id="bios-input" hidden accept=".zip,application/zip" onchange={addBios} />
    </div>
  </div>

  <h2 class="eyebrow section" id="settings-storage">Depolama</h2>
  <div class="panel storage">
    <div class="row stack">
      <span class="head"><span class="label">Kullanılan alan</span><span class="value">{usage?.used != null ? formatBytes(usage.used) : formatBytes(total)}{usage?.quota ? ` / ${formatBytes(usage.quota)}` : ''}</span></span>
      <div class="meter" aria-hidden="true">
        <span style:width={share(usage?.games)} class="m-games"></span>
        <span style:width={share((usage?.saves || 0) + (usage?.bios || 0))} class="m-saves"></span>
        <span style:width={share(usage?.caches)} class="m-cores"></span>
      </div>
      <ul class="legend">
        <li><span class="sw m-games"></span><span class="grow">Oyun dosyaları</span><span class="value">{formatBytes(usage?.games)}</span></li>
        <li><span class="sw m-saves"></span><span class="grow">Kayıtlar, devam noktaları ve BIOS</span><span class="value">{usage?.saves == null ? '…' : formatBytes((usage.saves || 0) + (usage.bios || 0))}</span></li>
        <li><span class="sw m-cores"></span><span class="grow">Emülatörler (çevrimdışı)</span><span class="value">{usage?.caches == null ? app.offline : formatBytes(usage.caches)}</span></li>
      </ul>
      <p class="hint" id="storage-persist">Dosyalar bu tarayıcı profilinde saklanır{app.persisted ? '; tarayıcı bu alanı kalıcı olarak ayırdı, yer daralsa da silmez' : app.persisted === false ? '; tarayıcı şimdilik yer darlığında silebilir' : ''}.</p>
      {#if app.persisted === false}
        <div class="persist-row">
          <button type="button" class="btn btn-sm" id="persist-storage" onclick={async () => { if (await app.requestPersistence()) showToast('Depolama kalıcı oldu.'); else showToast(tv.bridge ? 'TV bu alanı kalıcı yapmadı.' : 'Tarayıcı henüz izin vermedi. Uygulamayı ana ekrana yükleyince Chrome kalıcı tutar.'); }}>Kalıcı yap</button>
          <span class="hint">Ana ekrana yüklenmiş uygulamada Chrome bunu kendisi açar. Yine de yedek almayı unutma.</span>
        </div>
      {/if}
    </div>
    <div class="row">
      <span class="grow"><span class="label">Çevrimdışı kullanım</span><span class="hint">Uygulama ve NES, SNES, Mega Drive çekirdekleri ilk açılışta cihaza kaydedilir; arcade çekirdekleri ilk kullanımda.</span></span>
      <span class="value" id="offline-setting">{app.offline}</span>
    </div>
  </div>

  <h2 class="eyebrow section" id="settings-backup">Yedekleme</h2>
  {#if tv.bridge}
    <p class="hint plain" id="tv-backup-note">TV uygulaması dosya kaydedemediği için yedek alma ve ROM indirme burada yok. Kütüphane bu TV'de saklanır; uygulamayı kaldırırsan TV'deki oyunlar ve kayıtlar da silinir.</p>
  {:else}
  <div class="backup">
    <button type="button" class="tile" id="export-library" onclick={exportLibraryBackup}>
      <Icon name="download" size={20} /><span><b>Yedek al</b><small>Oyun listesi, favoriler, süreler (ROM'suz)</small></span>
    </button>
    <button type="button" class="tile" id="import-library-trigger" onclick={() => backupInput?.click()}>
      <Icon name="upload" size={20} /><span><b>Geri yükle</b><small>Önce önizleme · üzerine yazmaz</small></span>
    </button>
    <input bind:this={backupInput} type="file" id="library-backup-input" hidden accept="application/json,.json" onchange={e => { const input = e.currentTarget as HTMLInputElement; void restoreLibraryBackup(input.files?.[0]); input.value = ''; }} />
  </div>
  <p class="hint plain">ROM dosyalarını ve oyun içi kayıtları oyunların sayfasından tek tek indirebilirsin. Tam yedek (ROM, kayıt ve ayarlar tek dosyada) sonraki aşamada geliyor.</p>
  {/if}

  <h2 class="eyebrow section" id="settings-perf">Performans ölçümleri</h2>
  <div class="panel">
    <div class="row stack">
      <p class="hint">Oyunda menü → “Performansı ölç”, bu cihazın oyunu gerçek hızın kaç katı çalıştırabildiğini ölçer. 1,0× altı oyun yavaşlar; 2× üstü rahattır.</p>
      <pre class="perf-history" id="perf-history">{perf}</pre>
      <div class="inline">
        <button type="button" class="btn btn-sm" id="perf-copy" onclick={copyPerf}>Kopyala</button>
        <button type="button" class="btn btn-sm btn-ghost" id="perf-clear" onclick={clearPerf}>Temizle</button>
      </div>
    </div>
  </div>

  <h2 class="eyebrow section" id="settings-tv" lang="en">Google TV / Android TV</h2>
  <div class="panel">
    {#if tv.bridge}
      <div class="row stack">
        <span class="label">RetroPlay TV {tv.info?.versionName || ''}{tv.info?.model ? ` · ${tv.info.model}` : ''}</span>
        <p class="hint">Oyun eklemek için Oyun ekle → Telefondan gönder. Kontrolcüyü TV'nin Bluetooth ayarlarından eşle; düğmeler konumlarına göre eşlenir. Oyun menüsü: kumandanın Geri tuşu. Kütüphane ve kayıtlar bu TV'de saklanır.</p>
        <div class="inline"><button type="button" class="btn btn-sm" id="tv-exit" onclick={() => tv.exit()}>Uygulamadan çık</button></div>
      </div>
    {:else}
      <div class="row stack">
        <span class="label">RetroPlay'i televizyonda oyna</span>
        <ol class="tv-steps hint">
          <li>TV'de Google Play'den <b>Downloader</b> uygulamasını kur; Ayarlar → Sistem → Hakkında'da "Android TV OS derlemesi"ne 7 kez basıp geliştirici seçeneklerini aç, Downloader'a "bilinmeyen uygulama yükleme" izni ver.</li>
          <li>Downloader'a şu adresi yaz: <b class="mono">{tvInstallUrl}</b></li>
          <li>İnen RetroPlay TV'yi kur ve aç; oyunları Oyun ekle → Telefondan gönder ile ekle.</li>
        </ol>
        <div class="inline"><a class="btn btn-sm" href={TV_APK_URL} id="tv-apk">APK'yı indir</a></div>
      </div>
    {/if}
  </div>

  <h2 class="eyebrow section" id="settings-about">Hakkında</h2>
  <div class="panel">
    <a class="row" href="#/help"><Icon name="help" size={20} /><span class="grow"><span class="label">Nasıl çalışır?</span><span class="hint">Oyun ekleme, kayıtlar, dokunmatik tuşlar, kontrolcü</span></span><Icon name="chevron" size={18} /></a>
    <div class="row">
      <span class="grow"><span class="label">Emülatörler</span><span class="hint">NES: Nestopia (açamadığında FCEUmm önerilir) · SNES: Snes9x · Mega Drive: Genesis Plus GX · Arcade: FinalBurn Neo, .key'siz eski CPS2 setleri için FB Alpha 2012 CPS2, gerekirse MAME 2003-Plus; Namco System 12 oyunları (Tekken 3, Tekken Tag, Soul Calibur…) için RetroPlay'in derlediği güncel MAME 2003-Plus. Hepsi EmulatorJS 4.2.3 ile bu siteden sunulur.</span></span>
    </div>
  </div>
  <div class="about">
    <span>RetroPlay {APP_VERSION} · EmulatorJS 4.2.3{gamepadUI.connected ? ' · kontrolcü bağlı' : ''}</span>
    <a class="text-btn" href="/THIRD-PARTY-NOTICES.txt" target="_blank" rel="noopener">Lisanslar</a>
  </div>
</div>

<style>
  .section { margin-top: 12px; }
  .head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .swatches { display: flex; gap: 12px; }
  .swatches button { width: 40px; height: 40px; border-radius: 12px; border: 2px solid transparent; background: var(--swatch); padding: 0; box-shadow: inset 0 0 0 3px var(--surface); }
  .swatches button[aria-checked='true'] { border-color: var(--text); }
  .settings :global(.ok-icon) { color: var(--ok-fg); }
  .bios-row.missing .label { color: var(--text-2); }
  .meter { display: flex; height: 10px; border-radius: 999px; overflow: hidden; background: var(--line-soft); gap: 2px; }
  .meter span { height: 100%; }
  .m-games { background: var(--text); }
  .m-saves { background: var(--accent); }
  .m-cores { background: var(--ok-fg); }
  .persist-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 4px; }
  .persist-row .hint { flex: 1 1 200px; }
  .legend { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
  .legend li { display: flex; align-items: center; gap: 8px; }
  .legend .grow { flex: 1; }
  .sw { width: 8px; height: 8px; border-radius: 2px; }
  .tv-steps { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; line-height: 1.5; }
  .mono { font-family: var(--mono); color: var(--text); }
  .backup { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .tile { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; min-height: 84px; padding: 12px; border-radius: var(--r-md); border: 1px solid var(--line); background: var(--surface); color: var(--text); text-align: left; }
  .tile:hover { background: var(--surface-3); }
  .tile span { display: flex; flex-direction: column; gap: 2px; }
  .tile b { font-size: 14px; font-weight: 700; }
  .tile small { font-size: 12px; color: var(--text-2); }
  .plain { font-size: 13px; color: var(--text-3); line-height: 1.5; }
  .perf-history { margin: 0; padding: 10px 12px; max-height: 180px; overflow: auto; border-radius: var(--r); background: var(--bg); border: 1px solid var(--line-faint); font-family: var(--mono); font-size: 12px; line-height: 1.6; color: #C2C7D0; white-space: pre-wrap; }
  .inline { display: flex; gap: 8px; }
  .about { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 4px; font-family: var(--mono); font-size: 12px; color: var(--text-2); }
  @media (min-width: 960px) { .settings { max-width: 820px; } }
</style>
