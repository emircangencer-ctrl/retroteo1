<script lang="ts">
  import { untrack } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import Cover from '../components/Cover.svelte';
  import { library } from '../lib/library.svelte.ts';
  import { settings } from '../lib/settings.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import { listSlots, deleteSaveState } from '../lib/db.ts';
  import { cardStatus, isPlayable, arcadeParentInstalled } from '../lib/library-view.ts';
  import { gameLook } from '../lib/systems.ts';
  import { formatBytes, formatPlaytime, lastPlayedShort, slotTime, hex32 } from '../lib/format.ts';
  import { blobSrc } from '../lib/blob-src.ts';
  import { confirmDialog } from '../lib/dialog.svelte.ts';
  import { showToast } from '../lib/toast.svelte.ts';
  import { exportRom, exportSram } from '../lib/exports.ts';
  import { importer } from '../lib/importer.svelte.ts';
  import { player, slotName } from '../player/session.svelte.ts';
  import { SYSTEM_CORE_LABELS } from '../player/launch.ts';
  import { crc32, diagnoseSuperMarioBros3Rom, inspectNesRom } from '../nes-rom.js';
  import { ARCADE_CORES, describeArcadeStatus, onlyKeysMissing, missingSummary } from '../arcade.js';
  import { displayLabel } from '../display-modes.js';
  import { SLOT_IDS, type SlotId, type SlotInfo } from '../lib/types.ts';

  const game = $derived(library.get(router.route.id));
  const gameId = $derived(game?.id || '');
  const gameBlob = $derived(game?.blob || null);
  const look = $derived(game ? gameLook(game) : null);
  const ctx = $derived({ biosIds: library.biosIds, games: library.games });
  const status = $derived(game ? cardStatus(game, ctx) : null);
  const playable = $derived(game ? isPlayable(game) : false);
  const hasResume = $derived(game ? library.hasResume(game.id) : false);
  const hasSram = $derived(game ? library.saveIds.has(game.id) : false);
  let slots = $state<SlotInfo[]>([]);
  let menuOpen = $state(false);
  let sheet = $state<SlotInfo | null>(null);
  let dump = $state<'verified' | 'unverified' | null>(null);
  let biosInput: HTMLInputElement | null = $state(null);

  $effect(() => {
    const id = gameId;
    void library.slots;
    if (!id) { slots = []; return; }
    let alive = true;
    listSlots(id).then(list => { if (alive) slots = list; }).catch(() => {});
    return () => { alive = false; };
  });

  // CRC32 for the file line (once, for console ROMs up to 16 MB) and the SMB3 dump check.
  $effect(() => {
    const blob = gameBlob;
    const g = untrack(() => library.get(gameId));
    dump = null;
    if (!g || !blob || g.platform === 'ARCADE' || blob.size > 16 * 1024 * 1024) return;
    let alive = true;
    blob.arrayBuffer().then(buffer => {
      if (!alive) return;
      const bytes = new Uint8Array(buffer);
      if (g.platform === 'NES') {
        const d = diagnoseSuperMarioBros3Rom(bytes, `${g.fileName || ''} ${g.title}`, inspectNesRom(bytes)) as { status: string } | null;
        dump = d ? (d.status === 'reference-match' ? 'verified' : 'unverified') : null;
      }
      if (!g.crc32) void library.patch(g.id, { crc32: hex32(crc32(bytes)) }).catch(() => {});
    }).catch(() => {});
    return () => { alive = false; };
  });

  const slotMap = $derived(new Map(slots.map(s => [s.slot, s])));
  const used = $derived(slots.length);
  const coreLabel = $derived(!game ? '' : game.platform === 'NES' ? (game.nesCore === 'fceumm' ? 'FCEUmm' : 'Nestopia') : game.platform === 'ARCADE' ? ((ARCADE_CORES as Record<string, { label: string }>)[game.arcade?.core || '']?.label || 'Arcade') : SYSTEM_CORE_LABELS[game.platform] || '—');
  const meta = $derived(!game || !look ? '' : [look.label, game.year, game.arcade?.manufacturer, game.arcade?.set ? `${game.arcade.set}.zip` : ''].filter(Boolean).join(' · '));
  const biosMissing = $derived(Boolean(game?.arcade?.bios && !library.biosIds.has(`${game.arcade.bios}.zip`)));
  const parentMissing = $derived(Boolean(game?.arcade && !arcadeParentInstalled(game.arcade, library.games)));
  const controlsHint = $derived(!look ? '' : `${look.label} düzeni · titreşim ${settings.touch.haptics ? 'açık' : 'kapalı'} · ${settings.touch.dpadMode === '4' ? '4 yön' : '8 yön'}`);
  const mapper = $derived(game?.romValidation && Number.isInteger(game.romValidation.mapper) ? ` · Mapper ${game.romValidation.mapper}` : '');

  function play(options: { fresh?: boolean; slot?: SlotId } = {}) { if (game) void player.start(game.id, options); }

  async function remove() {
    if (!game) return;
    menuOpen = false;
    const ok = await confirmDialog({ title: `“${game.title}” kaldırılsın mı?`, message: 'Bu tarayıcıdaki ROM kopyası, kütüphane kaydı, oyun içi kayıtlar ve kayıt yuvaları silinir. Orijinal dosyan değişmez.', confirmLabel: 'Kütüphaneden kaldır', danger: true });
    if (!ok) return;
    try {
      await library.remove(game.id);
      showToast('Oyun bu cihazdan kaldırıldı. Orijinal dosya değiştirilmedi.');
      router.go('library', '', {}, { replace: true });
    } catch (error) {
      showToast(`Kaldırılamadı: ${(error as Error)?.message || error}`, 'error');
    }
  }

  async function removeSlot(info: SlotInfo) {
    if (!game) return;
    sheet = null;
    const ok = await confirmDialog({ title: `${slotName(info.slot)} silinsin mi?`, message: `${slotTime(info.createdAt)} alınan kayıt silinir. Oyun içi kayıtların (SRAM) etkilenmez.`, confirmLabel: 'Kaydı sil', danger: true });
    if (!ok) return;
    try { await deleteSaveState(game.id, info.slot); library.noteSlot(game.id, info.slot, false); showToast(`${slotName(info.slot)} silindi.`); }
    catch (error) { showToast(`Silinemedi: ${(error as Error)?.message || error}`, 'error'); }
  }

  async function addBios(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = input.files ? [...input.files] : [];
    input.value = '';
    if (!files.length) return;
    const result = await importer.importDirect(files);
    if (result.bios) showToast(`${result.bios} BIOS dosyası eklendi.`);
    else showToast('Seçilen dosya bir BIOS olarak tanınmadı.', 'error');
  }
</script>

{#if !game || !look || !status}
  <div class="page">
    <header class="page-head"><a class="icon-btn" href="#/library" aria-label="Kütüphaneye dön"><Icon name="back" size={22} /></a></header>
    <div class="empty">
      <span class="icon-wrap"><Icon name="search" size={26} /></span>
      <h2>{library.ready ? 'Bu oyun kütüphanede yok' : 'Yükleniyor…'}</h2>
      {#if library.ready}<p>Kaldırılmış olabilir. Kütüphaneye dönüp başka bir oyun seç.</p><a class="btn" href="#/library">Kütüphane</a>{/if}
    </div>
  </div>
{:else}
  <div class="page detail" data-game-id={game.id}>
    <header class="page-head">
      <button type="button" class="icon-btn" aria-label="Geri" onclick={() => router.back('library')}><Icon name="back" size={22} /></button>
      <div class="head-actions">
        <button type="button" class="icon-btn fav" aria-label={game.favorite ? 'Favorilerden çıkar' : 'Favorilere ekle'} aria-pressed={Boolean(game.favorite)} data-favorite={game.id} onclick={() => library.toggleFavorite(game.id)}>
          <Icon name={game.favorite ? 'heart-fill' : 'heart'} />
        </button>
        <div class="more-wrap">
          <button type="button" class="icon-btn" aria-label="Diğer seçenekler" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}><Icon name="more" /></button>
          {#if menuOpen}
            <div class="popover" role="menu">
              {#if game.blob}<button type="button" role="menuitem" onclick={() => { menuOpen = false; exportRom(game); }}><Icon name="download" size={18} />ROM'u indir</button>{/if}
              {#if hasSram}<button type="button" role="menuitem" onclick={() => { menuOpen = false; void exportSram(game); }}><Icon name="save" size={18} />Oyun içi kaydı indir (.srm)</button>{/if}
              <button type="button" role="menuitem" class="danger" onclick={remove}><Icon name="trash" size={18} />Kütüphaneden kaldır</button>
            </div>
          {/if}
        </div>
      </div>
    </header>

    <section class="hero">
      <div class="cover-box"><Cover {game} size="md" /></div>
      <div class="hero-text">
        <h1 class="title">{game.title}</h1>
        <p class="meta">{meta}</p>
        <div class="badges">
          {#if dump === 'verified'}<span class="badge ok"><Icon name="check" size={14} stroke={2.2} />Doğrulanmış döküm</span>{/if}
          {#if dump === 'unverified'}<span class="badge warn"><Icon name="warn" size={14} />Doğrulanmamış döküm</span>{/if}
          <span class={`badge ${status.tone === 'ok' ? 'muted' : status.tone === 'warn' ? 'warn' : 'muted'}`} data-status>{status.text}</span>
        </div>
      </div>
    </section>

    {#if playable && !biosMissing && !parentMissing}
      <div class="play">
        <button type="button" class="btn btn-primary btn-block" data-play={game.id} data-nav-default onclick={() => play()}>
          <Icon name="play" size={18} />{hasResume ? 'Devam et' : 'Oyna'}
        </button>
        {#if hasResume}<button type="button" class="btn btn-block" id="play-fresh" onclick={() => play({ fresh: true })}>Baştan başla</button>{/if}
      </div>
    {:else}
      <div class="callout" role="note">
        <Icon name="warn" size={20} />
        <div>
          {#if game.restoredMetadataOnly || !game.blob}
            <strong>ROM dosyası bu cihazda yok</strong>
            <p>Bu kayıt yedekten geri yüklendi. Aynı dosyayı yeniden eklersen bu kayda bağlanır; favorin ve oyun geçmişin korunur.</p>
            <a class="btn btn-sm" href="#/import">ROM'u yeniden ekle</a>
          {:else if !look.playable}
            <strong>{look.label} henüz desteklenmiyor</strong>
            <p>Bu sistem için bir emülatör çekirdeği yok; kayıt kütüphanende saklanır.</p>
          {:else if biosMissing}
            <strong>{game.arcade?.bios}.zip gerekli</strong>
            <p>Bu oyun sistemin BIOS dosyasını istiyor. Bir kez eklemen yeter; dosya bu cihazda kalır.</p>
            <button type="button" class="btn btn-sm" onclick={() => biosInput?.click()}>{game.arcade?.bios}.zip ekle</button>
            <input type="file" hidden accept=".zip,application/zip" bind:this={biosInput} onchange={addBios} />
          {:else if parentMissing}
            <strong>Ana set {game.arcade?.parent}.zip gerekli</strong>
            <p>Bu set bir klon; ana set olmadan açılmaz. {game.arcade?.parent}.zip dosyasını da ekle ya da her zip'in tek başına yettiği "non-merged" seti kullan.</p>
            <a class="btn btn-sm" href="#/import">Dosya ekle</a>
          {/if}
        </div>
      </div>
      {#if playable}<button type="button" class="btn btn-block" data-play={game.id} onclick={() => play()}>Yine de açmayı dene</button>{/if}
    {/if}

    {#if game.arcade && game.arcade.status === 'incomplete'}
      <div class="callout soft">
        <Icon name="info" size={20} />
        <div>
          <strong>{onlyKeysMissing(game.arcade) ? (game.arcade.cps2Key ? 'CPS2 şifre anahtarı eksik' : 'Şifre çözme anahtarı eksik') : `Eksik set · ${missingSummary(game.arcade)}`}</strong>
          <p>{describeArcadeStatus(game.arcade, { biosInstalled: !biosMissing, parentInstalled: !parentMissing })}. {(game.arcade.missing || []).length ? `Eksik: ${(game.arcade.missing || []).slice(0, 6).join(', ')}${(game.arcade.missingCount || 0) > 6 ? '…' : ''}.` : ''} Oynatmayı denersen ne gerektiğini ayrıntılı anlatırım.</p>
        </div>
      </div>
    {/if}

    <dl class="stats">
      <div><dt>Toplam süre</dt><dd>{formatPlaytime(game.playtimeMs)}</dd></div>
      <div><dt>Son oynama</dt><dd>{lastPlayedShort(game.lastPlayed)}</dd></div>
      <div><dt>Kayıtlar</dt><dd>{used} / {SLOT_IDS.length}</dd></div>
    </dl>

    <section class="saves" aria-labelledby="saves-title">
      <h2 id="saves-title" class="eyebrow">Kayıtlar</h2>
      <div class="slot-rail">
        {#each SLOT_IDS as slot (slot)}
          {@const info = slotMap.get(slot)}
          <button type="button" class="slot" class:is-empty={!info} class:current={slot === 'auto' && info} disabled={!info || !playable} data-slot={slot} onclick={() => (sheet = info || null)}>
            <span class="shot">
              {#if info?.thumb}<img alt="" use:blobSrc={info.thumb} />{:else if info}<span class="no-shot"><Cover {game} size="xs" /></span>{/if}
              <b>{slot === 'auto' ? 'OTO' : slot === 'quick' ? 'HIZLI' : slot}</b>
            </span>
            <span class="slot-text">
              <span class="name">{info ? slotName(slot) : 'Boş yuva'}</span>
              <span class="when">{info ? slotTime(info.createdAt) : slot === 'auto' ? 'Oyundan çıkınca alınır' : 'Oyun menüsünden kaydet'}</span>
            </span>
          </button>
        {/each}
      </div>
      {#if hasSram}<p class="note">Oyun içi kayıt (SRAM) da bu cihazda yedekleniyor; ⋯ menüsünden .srm olarak indirebilirsin.</p>{/if}
    </section>

    <section aria-labelledby="details-title" class="details">
      <h2 id="details-title" class="eyebrow">Ayrıntılar</h2>
      <div class="panel">
        <a class="row" href="#/settings?s=controls">
          <span class="grow"><span class="label">Kontroller</span><span class="hint">{controlsHint}</span></span>
          <Icon name="chevron" size={18} class="muted-icon" />
        </a>
        <a class="row" href="#/settings?s=display">
          <span class="grow"><span class="label">Görüntü</span><span class="hint">{displayLabel(settings.display)} · 4:3</span></span>
          <Icon name="chevron" size={18} class="muted-icon" />
        </a>
        <div class="row stack file">
          <span class="label">Dosya</span>
          <span class="hint break">{game.fileName || '—'}</span>
          <span class="value">{formatBytes(game.size)}{game.crc32 ? ` · CRC32 ${game.crc32}` : ''}{mapper}</span>
        </div>
        <div class="row stack">
          <span class="label">Emülatör</span>
          <span class="hint">{coreLabel} · EmulatorJS 4.2.3{game.arcade ? ` · ${describeArcadeStatus(game.arcade, { biosInstalled: !biosMissing, parentInstalled: !parentMissing })}` : ''}</span>
        </div>
      </div>
    </section>

    <div class="downloads">
      <button type="button" class="btn" disabled={!game.blob} data-export-rom={game.id} onclick={() => exportRom(game)}><Icon name="download" size={18} />ROM'u indir</button>
      <button type="button" class="btn" disabled={!hasSram} data-export-sram={game.id} onclick={() => exportSram(game)}><Icon name="save" size={18} />Kayıtları indir</button>
    </div>
    <button type="button" class="btn btn-danger remove" data-remove={game.id} onclick={remove}><Icon name="trash" size={18} />Kütüphaneden kaldır</button>
  </div>

  {#if sheet}
    {@const info = sheet}
    <div class="sheet-backdrop" role="presentation" onclick={() => (sheet = null)}></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label={slotName(info.slot)}>
      <div class="sheet-head">
        <span class="shot big">{#if info.thumb}<img alt="" use:blobSrc={info.thumb} />{/if}</span>
        <div><strong>{slotName(info.slot)}</strong><span>{slotTime(info.createdAt)}</span></div>
      </div>
      <button type="button" class="btn btn-primary btn-block" data-nav-default onclick={() => { const s = info.slot; sheet = null; play(s === 'auto' ? {} : { slot: s }); }}><Icon name="play" size={18} />Bu kayıttan devam et</button>
      {#if info.slot !== 'auto'}<button type="button" class="btn btn-block btn-danger" onclick={() => removeSlot(info)}><Icon name="trash" size={18} />Kaydı sil</button>{/if}
      <button type="button" class="btn btn-block btn-ghost" onclick={() => (sheet = null)}>Vazgeç</button>
    </div>
  {/if}
{/if}

<style>
  .head-actions { display: flex; gap: 8px; }
  .fav[aria-pressed='true'] { color: var(--accent); }
  .more-wrap { position: relative; }
  .popover { position: absolute; right: 0; top: 52px; z-index: 30; min-width: 240px; padding: 6px; border-radius: var(--r-md); background: #16181E; border: 1px solid var(--line); box-shadow: 0 18px 40px rgba(0, 0, 0, 0.55); display: flex; flex-direction: column; }
  .popover button { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 12px; border: 0; border-radius: 10px; background: transparent; color: var(--text); font-weight: 600; font-size: 14px; text-align: left; }
  .popover button:hover { background: var(--surface-3); }
  .popover .danger { color: var(--danger); }
  .hero { display: flex; gap: 16px; align-items: stretch; }
  .cover-box { width: 132px; flex: none; }
  .hero-text { display: flex; flex-direction: column; justify-content: flex-end; gap: 8px; min-width: 0; }
  .title { font-size: 24px; font-weight: 700; line-height: 1.15; letter-spacing: -0.01em; overflow-wrap: anywhere; }
  .meta { font-family: var(--mono); font-size: 13px; color: var(--text-2); overflow-wrap: anywhere; }
  .badges { display: flex; flex-wrap: wrap; gap: 6px; }
  .badges .badge { height: auto; min-height: 26px; padding: 4px 8px; white-space: normal; }
  .play { display: flex; flex-direction: column; gap: 10px; }
  .callout { display: flex; gap: 12px; padding: 14px; border-radius: var(--r-lg); background: var(--warn-bg); border: 1px solid var(--warn-line); color: var(--warn-fg); }
  .callout.soft { background: var(--surface); border-color: var(--line-soft); color: var(--text-2); }
  .callout > div { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
  .callout strong { color: var(--text); font-size: 15px; }
  .callout p { font-size: 13px; line-height: 1.5; color: var(--warn-text); }
  .callout.soft p { color: var(--text-2); }
  .stats { margin: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .stats div { padding: 12px; border-radius: var(--r); background: var(--surface); border: 1px solid var(--line-soft); display: flex; flex-direction: column-reverse; gap: 4px; min-width: 0; }
  .stats dt { font-size: 12px; color: var(--text-2); }
  .stats dd { margin: 0; font-size: 16px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .saves, .details { display: flex; flex-direction: column; gap: 12px; margin-top: 4px; }
  .slot-rail { position: relative; display: flex; gap: 12px; overflow-x: auto; margin: 0 calc(var(--pad-x) * -1); padding: 2px var(--pad-x) 4px; scrollbar-width: none; }
  .slot-rail::-webkit-scrollbar { display: none; }
  .slot { flex: none; width: 150px; padding: 0; border: 0; background: transparent; color: var(--text); text-align: left; display: flex; flex-direction: column; gap: 8px; border-radius: 12px; }
  .slot:disabled { cursor: default; }
  .shot { position: relative; display: block; width: 150px; height: 112px; border-radius: 12px; overflow: hidden; background: #000; border: 1px solid var(--line); }
  .slot.current .shot { border: 2px solid var(--accent); }
  .slot.is-empty .shot { border: 1px dashed #3A3F4A; background: #0F1013; }
  .shot img { width: 100%; height: 100%; object-fit: fill; image-rendering: pixelated; }
  .no-shot { position: absolute; inset: 0; display: grid; place-items: center; background: #101115; }
  .no-shot :global(.cover) { width: 56px; }
  .shot b { position: absolute; left: 6px; top: 6px; padding: 3px 6px; border-radius: 6px; background: rgba(11, 12, 15, 0.82); font-family: var(--mono); font-size: 12px; font-weight: 600; }
  .slot-text { display: flex; flex-direction: column; gap: 2px; }
  .slot-text .name { font-size: 14px; font-weight: 600; }
  .slot-text .when { font-size: 12px; color: var(--text-2); }
  .slot.is-empty .slot-text .name { color: var(--text-2); }
  .note { font-size: 13px; color: var(--text-3); line-height: 1.5; }
  .file .break { word-break: break-word; }
  .details :global(.muted-icon) { color: var(--text-3); }
  .downloads { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .downloads .btn { font-size: 14px; padding: 0 10px; }
  .remove { align-self: center; }
  .sheet-backdrop { position: fixed; inset: 0; z-index: 900; background: rgba(5, 6, 8, 0.6); }
  .sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 901; padding: 18px 20px max(18px, var(--safe-b)); border-radius: var(--r-xl) var(--r-xl) 0 0; background: #121418; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 10px; box-shadow: 0 -20px 50px rgba(0, 0, 0, 0.5); }
  .sheet-head { display: flex; gap: 14px; align-items: center; margin-bottom: 4px; }
  .sheet-head div { display: flex; flex-direction: column; gap: 3px; }
  .sheet-head strong { font-size: 17px; }
  .sheet-head span { font-size: 13px; color: var(--text-2); }
  .shot.big { width: 112px; height: 84px; }
  @media (min-width: 960px) {
    .detail { max-width: 880px; }
    .hero { gap: 24px; }
    .cover-box { width: 168px; }
    .title { font-size: 32px; }
    .play { flex-direction: row; }
    .play .btn { width: auto; flex: none; padding: 0 28px; }
    .slot-rail { margin: 0; padding: 0; flex-wrap: wrap; overflow: visible; }
    .sheet { left: 50%; right: auto; bottom: auto; top: 50%; transform: translate(-50%, -50%); width: 420px; border-radius: var(--r-xl); border: 1px solid var(--line); margin-left: calc(var(--sidebar-w) / 2); }
  }
</style>
