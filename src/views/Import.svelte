<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import DrivePanel from '../components/DrivePanel.svelte';
  import { importer } from '../lib/importer.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import { formatBytes } from '../lib/format.ts';
  import { tv } from '../lib/tv.svelte.ts';

  let fileInput: HTMLInputElement | null = $state(null);
  let folderInput: HTMLInputElement | null = $state(null);
  // On a TV files come from a phone or computer; there is rarely a file picker and never a folder one.
  let source = $state<'files' | 'folder' | 'drive' | 'phone' | ''>(tv.active ? 'phone' : '');
  const filePicker = !tv.active || !tv.bridge || tv.info?.filePicker !== false;
  let inboxIds: string[] = [];
  let fetchingInbox = $state(false);
  let dragging = $state(false);
  const folderSupported = !tv.active && typeof HTMLInputElement !== 'undefined' && 'webkitdirectory' in HTMLInputElement.prototype;
  const ACCEPT = '.nes,.sfc,.smc,.md,.gen,.bin,.zip,.z64,.n64,.v64,.cue,.iso';

  const selected = $derived(importer.selected);
  const gamesSelected = $derived(selected.filter(item => item.kind !== 'bios').length);
  const biosSelected = $derived(selected.filter(item => item.kind === 'bios').length);
  const addLabel = $derived(!selected.length ? 'Eklenecek dosya yok' : gamesSelected && biosSelected ? `${gamesSelected} oyun ve ${biosSelected} BIOS ekle` : gamesSelected ? `${gamesSelected} oyunu ekle` : `${biosSelected} BIOS dosyasını ekle`);
  const tight = $derived(importer.freeBytes !== null && importer.selectedBytes * 1.1 > importer.freeBytes);
  const selectable = $derived(importer.items.filter(item => item.selectable));
  const allOn = $derived(selectable.length > 0 && selectable.every(item => item.selected));

  function chooseFiles() { source = 'files'; fileInput?.click(); }
  function chooseFolder() { source = 'folder'; folderInput?.click(); }
  function onFiles(event: Event, folder = false) {
    const input = event.currentTarget as HTMLInputElement;
    const files = input.files ? [...input.files] : [];
    input.value = '';
    if (files.length) void importer.add(files, { folder, source: folder ? `Klasör · ${folderName(files)}` : 'Seçilen dosyalar' });
  }
  function folderName(files: File[]) {
    const path = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath || '';
    return path.split('/')[0] || 'klasör';
  }
  function onDrop(event: DragEvent) {
    event.preventDefault();
    dragging = false;
    const files = event.dataTransfer?.files ? [...event.dataTransfer.files] : [];
    if (files.length) void importer.add(files, { source: 'Bırakılan dosyalar' });
  }
  function toggleAll() { for (const item of selectable) importer.toggle(item.key, !allOn); }
  /** The files sent to the TV go through the same review; they leave the inbox once added. */
  async function addInbox() {
    if (fetchingInbox) return;
    fetchingInbox = true;
    try {
      const entries = [...tv.inbox];
      const files = await tv.inboxFiles(entries);
      inboxIds = entries.map(entry => entry.id);
      if (files.length) await importer.add(files, { source: "TV'ye gönderilenler" });
    } finally { fetchingInbox = false; }
  }
  async function commit() {
    const summary = await importer.commit();
    // Kept when something failed, so it can be tried again.
    if (inboxIds.length && summary && !summary.failed) tv.removeFromInbox(inboxIds);
    inboxIds = [];
  }
  function close() { if (importer.phase === 'done') importer.reset(); router.back('library'); }
  function again() { importer.reset(); }
</script>

<div
  class="page import"
  class:dragging
  role="region"
  aria-label="Oyun ekle"
  ondragover={e => { e.preventDefault(); dragging = true; }}
  ondragleave={e => { if (e.currentTarget === e.target) dragging = false; }}
  ondrop={onDrop}
>
  <header class="page-head">
    <div class="titles left">
      <button type="button" class="icon-btn" aria-label="Kapat" id="modal-close" onclick={close}><Icon name="close" /></button>
      <h1 class="display-title small">Oyun ekle</h1>
    </div>
  </header>

  <div class="sources" class:tv-hide={tv.active && !filePicker}>
    {#if tv.active}
      <button type="button" class="source" class:on={source === 'phone'} id="choose-phone" data-nav-default onclick={() => (source = 'phone')}>
        <Icon name="upload" size={22} /><span><b>Telefondan gönder</b><small>Aynı ağdaki telefon veya bilgisayar</small></span>
      </button>
    {/if}
    {#if filePicker}
      <button type="button" class="source" class:on={source === 'files'} id="choose-files" data-nav-default={tv.active ? undefined : true} onclick={chooseFiles}>
        <Icon name="file" size={22} /><span><b>Dosya seç</b><small>{tv.active ? 'USB bellek veya TV\'deki dosyalar' : 'ROM veya ZIP'}</small></span>
      </button>
    {/if}
    {#if folderSupported}
      <button type="button" class="source" class:on={source === 'folder'} id="choose-folder" onclick={chooseFolder}>
        <Icon name="folder" size={22} /><span><b>Klasör tara</b><small>Alt klasörler dahil</small></span>
      </button>
    {/if}
    {#if !tv.active}
      <button type="button" class="source" class:on={source === 'drive'} id="choose-drive" aria-expanded={source === 'drive'} onclick={() => (source = source === 'drive' ? '' : 'drive')}>
        <Icon name="cloud" size={22} /><span><b>Google Drive</b><small>Salt okunur</small></span>
      </button>
    {/if}
  </div>
  <input bind:this={fileInput} type="file" id="import-file-input" hidden multiple accept={ACCEPT} onchange={e => onFiles(e)} />
  <input bind:this={folderInput} type="file" id="import-folder-input" hidden multiple webkitdirectory onchange={e => onFiles(e, true)} />

  {#if source === 'drive'}<DrivePanel />{/if}
  {#if source === 'phone' && (importer.phase === 'idle' || importer.phase === 'done')}
    <!-- Loaded only on a TV (it carries the QR code generator). -->
    {#await import('../components/TvUpload.svelte') then upload}<upload.default onadd={addInbox} busy={fetchingInbox} />{/await}
  {/if}

  {#if importer.phase === 'idle' && !tv.active}
    <div class="drop" class:active={dragging}>
      <Icon name="upload" size={26} />
      <strong>Dosyaları buraya bırak ya da yukarıdan seç</strong>
      <p>Önce her dosyanın ne olduğu gösterilir; sen onaylayınca eklenir. Dosyalar bu cihazda kalır.</p>
      <ul>
        <li><span class="dot" style:background="#E5484D"></span>NES · .nes</li>
        <li><span class="dot" style:background="#9B8AFB"></span>Super Nintendo · .sfc .smc</li>
        <li><span class="dot" style:background="#2BC4B0"></span>Mega Drive · .md .gen, SEGA başlıklı .bin</li>
        <li><span class="dot" style:background="#F472B6"></span>Arcade · FinalBurn Neo, FB Alpha 2012 CPS2 veya MAME 2003-Plus seti (.zip, açılmadan saklanır); Neo Geo için neogeo.zip</li>
        <li><span class="dot zip"></span>İçinde ROM olan .zip dosyaları açılır</li>
      </ul>
    </div>
  {:else if importer.phase === 'scanning'}
    <div class="progress-card" role="status">
      <span class="spinner" aria-hidden="true"></span>
      <span>Dosyalar inceleniyor… {importer.scanDone}/{importer.scanTotal}</span>
    </div>
  {/if}

  {#if importer.phase === 'review' || importer.phase === 'importing' || (importer.phase === 'scanning' && importer.items.length)}
    <div class="review-head">
      <h2 class="eyebrow">İnceleme · {importer.source}</h2>
      <span class="n">{importer.items.length} dosya{importer.ignored ? ` · ${importer.ignored} başka dosya atlandı` : ''}</span>
    </div>
    {#if selectable.length > 3}
      <button type="button" class="text-btn select-all" onclick={toggleAll}>{allOn ? 'Hiçbirini seçme' : 'Hepsini seç'}</button>
    {/if}
    <ul class="items" id="import-review">
      {#each importer.items as item (item.key)}
        <li>
          <label class="item" data-tone={item.tone} data-kind={item.kind}>
            <span class="mark" aria-hidden="true">
              {#if item.tone === 'ok'}<Icon name="check" size={18} stroke={2.2} />{:else if item.tone === 'warn'}<Icon name="warn" size={18} stroke={2} />{:else}<Icon name="close" size={16} stroke={2} />{/if}
            </span>
            <span class="text">
              <span class="name">{item.name}</span>
              <span class="headline">{item.headline}</span>
              {#if item.note}<span class="note">{item.note}</span>{/if}
              <span class="meta">{item.meta}</span>
            </span>
            <input type="checkbox" checked={item.selected} disabled={!item.selectable || importer.phase === 'importing'} aria-label={`${item.name} eklensin`} onchange={e => importer.toggle(item.key, (e.currentTarget as HTMLInputElement).checked)} />
          </label>
        </li>
      {/each}
    </ul>
    <div class="more-row">
      {#if filePicker}<button type="button" class="btn btn-sm" onclick={chooseFiles} disabled={importer.phase === 'importing'}><Icon name="plus" size={16} />Başka dosya</button>{/if}
      <button type="button" class="btn btn-sm btn-ghost" onclick={() => importer.reset()} disabled={importer.phase === 'importing'}>Temizle</button>
    </div>
  {/if}

  {#if importer.phase === 'done' && importer.summary}
    <section class="done" aria-labelledby="done-title">
      <span class="done-icon" class:bad={!importer.summary.added}><Icon name={importer.summary.added ? 'check' : 'info'} size={26} stroke={2.2} /></span>
      <h2 id="done-title">{importer.summary.added ? `${importer.summary.added} dosya eklendi` : 'Yeni dosya eklenmedi'}</h2>
      <p>{[importer.summary.skipped ? `${importer.summary.skipped} atlandı` : '', importer.summary.failed ? `${importer.summary.failed} eklenemedi` : ''].filter(Boolean).join(' · ') || 'Hepsi kütüphanende.'}</p>
      <div class="done-actions">
        <a class="btn btn-primary" href="#/library" data-nav-default onclick={() => importer.reset()}>Kütüphaneye git</a>
        <button type="button" class="btn" onclick={again}>Başka dosya ekle</button>
      </div>
      <details open={importer.summary.failed > 0}>
        <summary>Ayrıntılar</summary>
        <pre class="import-results" id="import-results" aria-live="polite">{importer.results}</pre>
      </details>
    </section>
  {:else}
    <pre class="import-results sr-only" id="import-results" aria-live="polite">{importer.results}</pre>
  {/if}

  {#if importer.phase === 'review' || importer.phase === 'importing'}
    <div class="add-bar">
      {#if importer.phase === 'importing'}
        <div class="bar-line"><span id="progress-label">{importer.progressLabel}</span><span id="progress-percent">{Math.round(importer.progress * 100)}%</span></div>
        <div class="track"><span style:width={`${Math.round(importer.progress * 100)}%`}></span></div>
      {:else}
        <div class="bar-line">
          <span>{selected.length} dosya · {formatBytes(importer.selectedBytes)}</span>
          {#if importer.freeBytes !== null}<span class:warn={tight}>Tarayıcıda {formatBytes(importer.freeBytes)} boş</span>{/if}
        </div>
        {#if tight}<p class="tight">Boş alan bu dosyalar için yetmeyebilir; dosyalar tek tek eklenir, sığmayan bildirilir.</p>{/if}
        <button type="button" class="btn btn-primary btn-block" id="import-commit" disabled={!selected.length} onclick={commit}>{addLabel}</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .left { gap: 12px; align-items: center; }
  .display-title.small { font-size: 22px; }
  .sources { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .source { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; min-height: 96px; padding: 12px; border-radius: var(--r-md); border: 1px solid var(--line); background: var(--surface); color: var(--text); text-align: left; }
  .source:hover { background: var(--surface-3); }
  .source.on { border: 2px solid var(--accent); background: var(--accent-soft); padding: 11px; }
  .source span { display: flex; flex-direction: column; gap: 2px; }
  .source b { font-weight: 700; font-size: 14px; }
  .source small { font-size: 12px; color: var(--text-2); }
  .drop { display: flex; flex-direction: column; gap: 10px; padding: 22px 18px; border-radius: var(--r-xl); border: 1px dashed #3A3F4A; background: #101115; color: var(--text-2); }
  .drop.active, .dragging .drop { border-color: var(--accent); background: var(--accent-soft); }
  .drop strong { color: var(--text); font-size: 15px; }
  .drop p { font-size: 14px; line-height: 1.5; }
  .drop ul { margin: 4px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; font-size: 13px; line-height: 1.45; }
  .drop li { display: flex; gap: 8px; align-items: baseline; }
  .dot { flex: none; width: 8px; height: 8px; border-radius: 2px; transform: translateY(-1px); }
  .dot.zip { background: #5D6470; }
  .progress-card { display: flex; align-items: center; gap: 12px; padding: 16px; border-radius: var(--r-lg); background: var(--surface); border: 1px solid var(--line-soft); font-size: 14px; color: var(--text-2); }
  .spinner { width: 22px; height: 22px; border-radius: 50%; border: 3px solid #2A2E37; border-top-color: var(--accent); animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .review-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-top: 8px; }
  .review-head .n { font-size: 13px; color: var(--text-2); white-space: nowrap; }
  .select-all { align-self: flex-end; margin-top: -8px; min-height: 36px; }
  .items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .item { display: flex; gap: 12px; padding: 14px; border-radius: var(--r-md); background: var(--surface); border: 1px solid var(--line-soft); cursor: pointer; }
  .item[data-tone='warn'] { background: var(--warn-bg); border-color: var(--warn-line); }
  .item[data-tone='skip'] { background: #101115; border-color: #1C1F25; cursor: default; }
  .mark { width: 32px; height: 32px; flex: none; border-radius: 10px; display: grid; place-items: center; background: var(--ok-bg); color: var(--ok-fg); }
  .item[data-tone='warn'] .mark { background: var(--warn-icon); color: var(--warn-fg); }
  .item[data-tone='skip'] .mark { background: #1C1F25; color: var(--text-3); }
  .text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .name { font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
  .item[data-tone='skip'] .name { color: var(--text-2); }
  .headline { font-size: 13px; color: var(--ok-fg); }
  .item[data-tone='warn'] .headline { color: var(--warn-fg); }
  .item[data-tone='skip'] .headline { color: var(--text-3); }
  .note { font-size: 13px; color: var(--warn-text); line-height: 1.4; }
  .item[data-tone='ok'] .note, .item[data-tone='skip'] .note { color: var(--text-2); }
  .meta { font-family: var(--mono); font-size: 12px; color: var(--text-2); overflow-wrap: anywhere; }
  .item input { width: 22px; height: 22px; margin: 4px 0 0; flex: none; accent-color: var(--accent); }
  .more-row { display: flex; gap: 8px; }
  .add-bar { position: sticky; bottom: var(--nav-h); z-index: 20; margin: 8px calc(var(--pad-x) * -1) 0; padding: 14px var(--pad-x) 16px; background: rgba(11, 12, 15, 0.96); border-top: 1px solid var(--line-faint); display: flex; flex-direction: column; gap: 10px; backdrop-filter: blur(10px); }
  .bar-line { display: flex; justify-content: space-between; gap: 12px; font-family: var(--mono); font-size: 12px; color: var(--text-2); }
  .bar-line .warn { color: var(--warn-fg); }
  .tight { font-size: 12px; color: var(--warn-fg); line-height: 1.4; }
  .track { height: 8px; border-radius: 999px; background: var(--line-soft); overflow: hidden; }
  .track span { display: block; height: 100%; background: var(--accent); transition: width 160ms; }
  .done { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 10px; padding: 28px 18px; border-radius: var(--r-xl); background: var(--surface); border: 1px solid var(--line); }
  .done-icon { width: 56px; height: 56px; border-radius: 16px; display: grid; place-items: center; background: var(--ok-bg); color: var(--ok-fg); }
  .done-icon.bad { background: var(--surface-4); color: var(--text-2); }
  .done h2 { font-size: 20px; font-weight: 700; }
  .done p { font-size: 14px; color: var(--text-2); }
  .done-actions { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-top: 6px; }
  details { width: 100%; margin-top: 8px; text-align: left; }
  summary { cursor: pointer; font-size: 13px; font-weight: 600; color: var(--text-2); padding: 6px 0; }
  .import-results { margin: 6px 0 0; padding: 12px; border-radius: var(--r); background: var(--bg); border: 1px solid var(--line-faint); font-family: var(--mono); font-size: 12px; line-height: 1.6; color: #C2C7D0; white-space: pre-wrap; word-break: break-word; max-height: 320px; overflow: auto; }
  @media (min-width: 960px) {
    .import { max-width: 860px; }
    .add-bar { bottom: 0; margin: 8px 0 0; border-radius: var(--r-lg) var(--r-lg) 0 0; border: 1px solid var(--line-faint); }
  }
</style>
