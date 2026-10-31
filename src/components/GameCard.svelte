<script lang="ts">
  // A game in the library: a tap plays it (a record that cannot start yet opens its page, which
  // says why); the ⋯ corner opens the game's page. Controllers: A plays, Y opens the page; keyboard:
  // Enter plays, I or the context-menu key opens the page.
  import Cover from './Cover.svelte';
  import Icon from './Icon.svelte';
  import { routeHref } from '../lib/route.ts';
  import { cardStatus, cardMeta, isPlayable } from '../lib/library-view.ts';
  import { gameLook } from '../lib/systems.ts';
  import { splitTitle } from '../lib/title.ts';
  import { library } from '../lib/library.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import { player } from '../player/session.svelte.ts';
  import type { Game } from '../lib/types.ts';

  interface Props { game: Game; layout?: 'grid' | 'list' | 'row'; resume?: boolean; navDefault?: boolean }
  let { game, layout = 'grid', resume = false, navDefault = false }: Props = $props();
  const ctx = $derived({ biosIds: library.biosIds, games: library.games });
  const status = $derived(cardStatus(game, ctx));
  const parts = $derived(splitTitle(game.title));
  // Versions of one game (Japan / USA, set revisions) differ by the bracketed detail, so it leads.
  const meta = $derived(status.tone === 'ok' && parts.detail ? parts.detail : cardMeta(game, ctx));
  const look = $derived(gameLook(game));
  const playable = $derived(isPlayable(game) && status.tone === 'ok');
  const detailHref = $derived(routeHref('game', game.id));

  function open(event: MouseEvent) {
    if (!playable || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void player.start(game.id);
  }
  function onKey(event: KeyboardEvent) {
    if (event.key === 'i' || event.key === 'I' || event.key === 'ContextMenu') { event.preventDefault(); router.go('game', game.id); }
  }
</script>

<div
  class={`game-card is-${layout}`}
  data-game-id={game.id}
  data-play-id={isPlayable(game) ? game.id : undefined}
  data-tone={status.tone}
>
  <a
    class="card-main"
    href={detailHref}
    data-nav-default={navDefault ? '' : undefined}
    aria-label={`${game.title}, ${look.label}${game.favorite ? ', favori' : ''}. ${status.text}${playable ? '. Oynamak için seç' : ''}`}
    onclick={open}
    onkeydown={onKey}
  >
    {#if layout === 'list'}
      <span class="thumb"><Cover {game} size="xs" /></span>
      <span class="info">
        <span class="game-title">{parts.name}</span>
        <span class="game-foot" class:warn={status.tone === 'warn'}>{status.text}</span>
      </span>
      {#if game.favorite}<span class="fav-mark"><Icon name="heart-fill" size={16} /></span>{/if}
      {#if resume}<span class="badge muted resume">Devam</span>{/if}
    {:else}
      <Cover {game} size={layout === 'row' ? 'sm' : 'md'} favorite={game.favorite} />
      <span class="info">
        <span class="game-title">{parts.name}</span>
        {#if layout === 'grid'}<span class="meta" class:warn={status.tone === 'warn'}>{meta}</span>{/if}
        <span class="game-foot sr-only">{status.text}</span>
      </span>
    {/if}
  </a>
  <a class="card-more" href={detailHref} tabindex="-1" aria-label={`${parts.name} ayrıntıları`} title="Ayrıntılar"><Icon name="more" size={layout === 'list' ? 20 : 18} /></a>
</div>

<style>
  .game-card { position: relative; min-width: 0; }
  .card-main { position: relative; display: flex; flex-direction: column; gap: 8px; color: var(--text); text-decoration: none; min-width: 0; border-radius: 16px; }
  .card-main:hover :global(.cover) { border-color: #3A3F4A; }
  .info { display: flex; flex-direction: column; gap: 2px; min-width: 0; padding: 0 2px; }
  .game-title { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { font-family: var(--mono); font-size: 12px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta.warn { color: var(--warn-fg); }
  .is-row { width: 108px; flex: none; }
  .is-row .game-title { font-size: 13px; }
  /* ⋯ sits on the cover's top-right corner, below the system stripe, in a thumb-sized target. */
  .card-more { position: absolute; top: 32px; right: 4px; width: 36px; height: 36px; display: grid; place-items: center; border-radius: 999px; background: rgba(11, 12, 15, 0.72); color: var(--text); text-decoration: none; }
  .card-more:hover { background: rgba(11, 12, 15, 0.92); }
  .is-row .card-more { top: 26px; width: 32px; height: 32px; }

  .is-list .card-main { flex-direction: row; align-items: center; gap: 12px; padding: 8px 52px 8px 8px; border-radius: var(--r-md); background: var(--surface); border: 1px solid var(--line-soft); }
  .is-list .card-main:hover { background: var(--surface-3); }
  .is-list .card-more { top: 50%; right: 8px; transform: translateY(-50%); background: transparent; color: var(--text-3); }
  .is-list .card-more:hover { color: var(--text); background: var(--surface-3); }
  .thumb { width: 48px; flex: none; }
  .is-list .info { flex: 1; gap: 3px; }
  .is-list .game-title { font-size: 15px; }
  .is-list .game-foot { font-size: 13px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .is-list .game-foot.warn { color: var(--warn-fg); }
  .fav-mark { color: var(--accent); }
  .resume { flex: none; }
</style>
