<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import GameCard from '../components/GameCard.svelte';
  import { library } from '../lib/library.svelte.ts';
  import { settings } from '../lib/settings.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import { routeHref } from '../lib/route.ts';
  import { filterGames, sortGames, systemCounts, SORTS, normalizeSort, type SortKey } from '../lib/library-view.ts';
  import { systemLook } from '../lib/systems.ts';
  import { gamepadUI } from '../lib/gamepad-ui.svelte.ts';
  import { player } from '../player/session.svelte.ts';

  const PAGE_SIZE = 48;

  let query = $state('');
  let system = $state('ALL');
  let favorites = $state(false);
  let withSaves = $state(false);
  let limit = $state(PAGE_SIZE);
  let search: HTMLInputElement | null = $state(null);
  let sentinel: HTMLElement | null = $state(null);

  // Links like #/library?fav=1, ?sort=recent, ?system=NES or ?focus=search set the view once.
  $effect(() => {
    const route = router.route;
    if (route.name !== 'library') return;
    const q = route.query;
    untrack(() => {
      favorites = q.fav === '1';
      withSaves = q.saves === '1';
      system = q.system || 'ALL';
      if (q.sort && q.sort !== settings.prefs.sort) settings.setPrefs({ sort: normalizeSort(q.sort) });
      if (q.q !== undefined) query = q.q;
      limit = PAGE_SIZE;
      if (q.focus === 'search') void tick().then(() => search?.focus());
    });
  });

  const counts = $derived(systemCounts(library.games));
  const savedIds = $derived(library.savedIds());
  const filtered = $derived(sortGames(filterGames(library.games, { query, system, favorites, withSaves, saveIds: savedIds }), settings.prefs.sort));
  const visible = $derived(filtered.slice(0, limit));
  const favoriteCount = $derived(library.games.filter(g => g.favorite).length);

  function pick(next: string) { system = next; favorites = false; withSaves = false; limit = PAGE_SIZE; syncUrl(); }
  function pickFavorites() { favorites = !favorites; if (favorites) { system = 'ALL'; withSaves = false; } limit = PAGE_SIZE; syncUrl(); }
  function pickSaves() { withSaves = !withSaves; if (withSaves) { system = 'ALL'; favorites = false; } limit = PAGE_SIZE; syncUrl(); }
  function syncUrl() { router.go('library', '', { system: system !== 'ALL' ? system : undefined, fav: favorites || undefined, saves: withSaves || undefined }, { replace: true }); }

  // Endless scrolling: the next page appears before the end is reached.
  $effect(() => {
    if (!sentinel || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting) && limit < filtered.length) limit += PAGE_SIZE; }, { rootMargin: '600px 0px' });
    io.observe(sentinel);
    return () => io.disconnect();
  });

  // Controller: A plays the focused game, Y opens it, X favourites it, L/R change the system.
  onMount(() => gamepadUI.push({
    root: () => document.getElementById('app-shell') || document.body,
    onAction: (action, focused) => {
      const card = focused?.closest<HTMLElement>('.game-card');
      if (action.type === 'confirm' && card?.dataset.playId) { void player.start(card.dataset.playId); return true; }
      if (action.type === 'y' && card?.dataset.gameId) { router.go('game', card.dataset.gameId); return true; }
      if (action.type === 'x' && card?.dataset.gameId) { void library.toggleFavorite(card.dataset.gameId); return true; }
      if (action.type === 'l' || action.type === 'r') {
        const keys = ['ALL', ...counts.map(c => c.key), 'FAV'];
        const current = favorites ? 'FAV' : system;
        const next = keys[(keys.indexOf(current) + (action.type === 'r' ? 1 : -1) + keys.length) % keys.length];
        if (next === 'FAV') pickFavorites(); else pick(next);
        return true;
      }
      if (action.type === 'back' && (query || system !== 'ALL' || favorites || withSaves)) { query = ''; pick('ALL'); return true; }
      return false;
    }
  }));

  function onKey(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); search?.focus(); search?.select(); }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="page library" id="view-library">
  <header class="page-head">
    <div class="titles">
      <h1 class="display-title">{favorites ? 'Favoriler' : settings.prefs.sort === 'recent' && router.route.query.sort === 'recent' ? 'Son oynananlar' : 'Kütüphane'}</h1>
      <span class="count" id="results-label">{filtered.length === library.games.length ? `${library.games.length} oyun` : `${filtered.length} / ${library.games.length}`}</span>
    </div>
    <a class="icon-btn accent add" href="#/import" aria-label="Oyun ekle" data-action="add"><Icon name="plus" size={22} stroke={2.2} /><span class="add-label">Oyun ekle</span></a>
  </header>

  <div class="tools">
    <label class="search">
      <Icon name="search" />
      <span class="sr-only">Oyun ara</span>
      <input bind:this={search} id="search-input" type="search" placeholder="Oyun, sistem veya dosya ara" autocomplete="off" enterkeyhint="search" bind:value={query} oninput={() => (limit = PAGE_SIZE)} />
      <kbd class="kbd tv-hide">Ctrl K</kbd>
    </label>

    <div class="chips" role="group" aria-label="Sisteme göre süz" id="platform-filters">
      <button type="button" class="chip" aria-pressed={system === 'ALL' && !favorites && !withSaves} data-filter="ALL" onclick={() => pick('ALL')}>Tümü <span class="n">{library.games.length}</span></button>
      {#each counts as entry (entry.key)}
        {@const look = systemLook(entry.key)}
        <button type="button" class="chip" aria-pressed={system === entry.key} data-filter={entry.key} onclick={() => pick(entry.key)}><span class="dot" style:background={look.stripe}></span>{look.label} <span class="n">{entry.count}</span></button>
      {/each}
      <button type="button" class="chip" aria-pressed={favorites} data-filter="FAV" onclick={pickFavorites}><Icon name={favorites ? 'heart-fill' : 'heart'} size={16} />Favoriler{#if favoriteCount}<span class="n">{favoriteCount}</span>{/if}</button>
      <button type="button" class="chip" aria-pressed={withSaves} data-filter="SAVES" onclick={pickSaves}><Icon name="save" size={16} />Kaydı olanlar</button>
    </div>

    <div class="bar">
      <label class="sort">
        <Icon name="sort" size={18} />
        <span class="sr-only">Sıralama</span>
        <select id="sort-select" value={settings.prefs.sort} onchange={e => { settings.setPrefs({ sort: (e.currentTarget as HTMLSelectElement).value as SortKey }); limit = PAGE_SIZE; }}>
          {#each SORTS as sort (sort.key)}<option value={sort.key}>{sort.label}</option>{/each}
        </select>
      </label>
      <div class="view-toggle" role="group" aria-label="Görünüm">
        <button type="button" aria-label="Izgara görünümü" aria-pressed={settings.prefs.layout === 'grid'} data-layout="grid" onclick={() => settings.setPrefs({ layout: 'grid' })}><Icon name="grid" size={18} /></button>
        <button type="button" aria-label="Liste görünümü" aria-pressed={settings.prefs.layout === 'list'} data-layout="list" onclick={() => settings.setPrefs({ layout: 'list' })}><Icon name="list" size={18} /></button>
      </div>
    </div>
  </div>

  {#if !library.ready}
    <div class="grid" aria-hidden="true">{#each Array(6) as _, i (i)}<span class="ghost"></span>{/each}</div>
  {:else if library.games.length === 0}
    <div class="empty" id="empty-state">
      <span class="icon-wrap"><Icon name="plus" size={26} /></span>
      <h2>Burada henüz oyun yok</h2>
      <p>Bir ROM ya da ZIP dosyası ekleyerek kütüphaneni oluştur. Dosyalar bu cihazda kalır.</p>
      <a class="btn btn-primary" href="#/import">Oyun ekle</a>
    </div>
  {:else if filtered.length === 0}
    <div class="empty" id="empty-state">
      <span class="icon-wrap"><Icon name="search" size={26} /></span>
      <h2>{favorites ? 'Henüz favorin yok' : withSaves ? 'Henüz kaydı olan oyun yok' : 'Eşleşen oyun yok'}</h2>
      <p>{favorites ? 'Bir oyunun sayfasındaki kalp ile favorilerine ekle.' : withSaves ? 'Bir oyun oynayıp kaydettiğinde burada görünür.' : 'Aramayı ya da süzgeci değiştir.'}</p>
      <button type="button" class="btn" onclick={() => { query = ''; pick('ALL'); }}>Tümünü göster</button>
    </div>
  {:else}
    <div class={settings.prefs.layout === 'list' ? 'list' : 'grid'} id="library-games">
      {#each visible as game, i (game.id)}
        <GameCard {game} layout={settings.prefs.layout === 'list' ? 'list' : 'grid'} resume={library.hasResume(game.id)} navDefault={i === 0} />
      {/each}
    </div>
    {#if visible.length < filtered.length}
      <div bind:this={sentinel} class="sentinel" aria-hidden="true"></div>
      <button type="button" class="btn more" id="library-load-more" data-load-more="library" onclick={() => (limit += PAGE_SIZE)}>Daha fazla göster ({Math.min(PAGE_SIZE, filtered.length - visible.length)})</button>
    {/if}
  {/if}

  {#if gamepadUI.connected}
    <div class="pad-legend" aria-hidden="true">
      <span><b>A</b>Oyna</span><span><b>Y</b>Ayrıntılar</span><span><b>X</b>Favori</span><span><b class="wide">L / R</b>Sistem değiştir</span>
    </div>
  {/if}
</div>

<style>
  .add .add-label { display: none; }
  .tools { display: flex; flex-direction: column; gap: 14px; }
  .search { display: flex; align-items: center; gap: 10px; height: 48px; padding: 0 14px; border-radius: var(--r-md); background: var(--surface); border: 1px solid var(--line); color: var(--text-2); }
  .search:focus-within { border-color: var(--accent-line); }
  .search input { flex: 1; min-width: 0; height: 44px; border: 0; background: transparent; color: var(--text); font-size: 15px; outline: none; }
  .search input::placeholder { color: var(--text-3); }
  .kbd { display: none; font-family: var(--mono); font-size: 12px; padding: 2px 6px; border-radius: 6px; border: 1px solid var(--line); }
  .chips { position: relative; display: flex; gap: 8px; overflow-x: auto; margin: 0 calc(var(--pad-x) * -1); padding: 2px var(--pad-x); scrollbar-width: none; }
  .chips::-webkit-scrollbar { display: none; }
  .bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .sort { position: relative; display: flex; align-items: center; gap: 8px; height: 44px; color: var(--text); font-weight: 600; font-size: 14px; }
  .sort select { appearance: none; -webkit-appearance: none; height: 44px; padding: 0 22px 0 0; border: 0; background: transparent; color: var(--text); font-weight: 600; font-size: 14px; cursor: pointer; }
  .sort::after { content: ''; position: absolute; right: 4px; top: 19px; width: 6px; height: 6px; border-right: 2px solid var(--text-2); border-bottom: 2px solid var(--text-2); transform: rotate(45deg); pointer-events: none; }
  .sort select option { background: #14161B; color: var(--text); }
  .view-toggle { display: flex; gap: 4px; padding: 3px; border-radius: var(--r); background: var(--surface); border: 1px solid var(--line); }
  .view-toggle button { width: 40px; height: 36px; border-radius: 9px; border: 0; background: transparent; color: var(--text-2); display: grid; place-items: center; padding: 0; }
  .view-toggle button[aria-pressed='true'] { background: var(--line); color: var(--text); }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 12px; }
  .list { display: flex; flex-direction: column; gap: 8px; }
  .ghost { aspect-ratio: 3 / 4; border-radius: 14px; background: #121418; }
  .sentinel { height: 1px; }
  .more { align-self: center; }
  .pad-legend { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px; padding: 12px 16px; border-radius: var(--r); background: #101115; border: 1px solid #1C1F25; font-size: 13px; color: #C2C7D0; }
  .pad-legend span { display: flex; align-items: center; gap: 8px; }
  .pad-legend b { min-width: 24px; height: 24px; padding: 0 6px; border-radius: 999px; border: 1px solid #3A3F4A; display: grid; place-items: center; font-weight: 800; font-size: 12px; }
  @media (min-width: 560px) { .grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); } }
  @media (min-width: 960px) {
    .page-head { flex-wrap: wrap; }
    .add { display: inline-flex; align-items: center; width: auto; padding: 0 16px; gap: 8px; height: 46px; font-weight: 700; font-size: 14px; }
    .add .add-label { display: inline; }
    .tools { flex-direction: row; flex-wrap: wrap; align-items: center; gap: 12px 16px; }
    .search { flex: 1 1 280px; max-width: 460px; height: 46px; }
    .kbd { display: inline; }
    .chips { order: 3; flex-basis: 100%; flex-wrap: wrap; margin: 0; padding: 0; overflow: visible; }
    .chips .chip { height: 36px; font-size: 13px; }
    .bar { gap: 16px; margin-left: auto; }
    .grid { grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 24px 20px; }
    .grid :global(.cover .stripe) { height: 30px; padding: 0 10px 0 12px; }
    .grid :global(.cover .t) { font-size: 20px; }
  }
</style>
