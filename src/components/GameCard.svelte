<script lang="ts">
  import Cover from './Cover.svelte';
  import Icon from './Icon.svelte';
  import { routeHref } from '../lib/route.ts';
  import { cardStatus, cardMeta, isPlayable } from '../lib/library-view.ts';
  import { gameLook } from '../lib/systems.ts';
  import { library } from '../lib/library.svelte.ts';
  import type { Game } from '../lib/types.ts';

  interface Props { game: Game; layout?: 'grid' | 'list' | 'row'; resume?: boolean; navDefault?: boolean }
  let { game, layout = 'grid', resume = false, navDefault = false }: Props = $props();
  const ctx = $derived({ biosIds: library.biosIds, games: library.games });
  const status = $derived(cardStatus(game, ctx));
  const meta = $derived(cardMeta(game, ctx));
  const look = $derived(gameLook(game));
</script>

<a
  class={`game-card ${layout}`}
  href={routeHref('game', game.id)}
  data-game-id={game.id}
  data-nav-x={game.id}
  data-nav-y={game.id}
  data-play-id={isPlayable(game) ? game.id : undefined}
  data-tone={status.tone}
  data-nav-default={navDefault ? '' : undefined}
  aria-label={`${game.title}, ${look.label}${game.favorite ? ', favori' : ''}. ${status.text}`}
>
  {#if layout === 'list'}
    <span class="thumb"><Cover {game} size="xs" /></span>
    <span class="info">
      <span class="game-title">{game.title}</span>
      <span class="game-foot" class:warn={status.tone === 'warn'}>{status.text}</span>
    </span>
    {#if game.favorite}<span class="fav-mark"><Icon name="heart-fill" size={16} /></span>{/if}
    {#if resume}<span class="badge muted resume">Devam</span>{/if}
    <Icon name="chevron" size={18} class="chev" />
  {:else}
    <Cover {game} size={layout === 'row' ? 'sm' : 'md'} favorite={game.favorite} />
    <span class="info">
      <span class="game-title">{game.title}</span>
      {#if layout === 'grid'}<span class="meta" class:warn={status.tone === 'warn'}>{meta}</span>{/if}
      <span class="game-foot sr-only">{status.text}</span>
    </span>
  {/if}
</a>

<style>
  .game-card { display: flex; flex-direction: column; gap: 8px; color: var(--text); text-decoration: none; min-width: 0; border-radius: 16px; }
  .game-card:hover :global(.cover) { border-color: #3A3F4A; }
  .info { display: flex; flex-direction: column; gap: 2px; min-width: 0; padding: 0 2px; }
  .game-title { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { font-family: var(--mono); font-size: 12px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta.warn { color: var(--warn-fg); }
  .row { width: 108px; flex: none; }
  .row .game-title { font-size: 13px; }

  .list { flex-direction: row; align-items: center; gap: 12px; padding: 8px 10px 8px 8px; border-radius: var(--r-md); background: var(--surface); border: 1px solid var(--line-soft); }
  .list:hover { background: var(--surface-3); }
  .thumb { width: 48px; flex: none; }
  .list .info { flex: 1; gap: 3px; }
  .list .game-title { font-size: 15px; }
  .list .game-foot { font-size: 13px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .list .game-foot.warn { color: var(--warn-fg); }
  .fav-mark { color: var(--accent); }
  .list :global(.chev) { color: var(--text-3); }
  .resume { flex: none; }
</style>
