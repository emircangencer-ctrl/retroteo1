<script lang="ts">
  // The system's colour stripe over the game's box art (or title screen) when one was found, else
  // the typographic cover from the design: the title on scan lines. Box art comes in many shapes, so
  // the picture is shown whole on its own average colour.
  import { gameLook } from '../lib/systems.ts';
  import { shortTitle } from '../lib/title.ts';
  import { coverArt } from '../lib/cover-art.svelte.ts';
  import Icon from './Icon.svelte';
  import type { Game } from '../lib/types.ts';

  interface Props { game: Game; size?: 'xs' | 'sm' | 'md' | 'lg'; favorite?: boolean }
  let { game, size = 'md', favorite = false }: Props = $props();
  const look = $derived(gameLook(game));
  const picture = $derived(coverArt.picture(game.id));
  let broken = $state('');
</script>

<span class={`cover ${size}`} style:--stripe={look.stripe} aria-hidden="true">
  <span class="stripe"><span class="sys">{look.stripeLabel}</span>{#if favorite}<span class="fav"><Icon name="heart-fill" size={size === 'xs' ? 10 : 14} /></span>{/if}</span>
  <!-- Game titles are mostly English or Japanese: upper-cased without Turkish dotted İ. -->
  {#if picture && broken !== picture.url}
    <span class="art pic" data-cover="picture" style:--tone={picture.tone || null}>
      <img src={picture.url} alt="" decoding="async" onerror={() => (broken = picture.url)} />
    </span>
  {:else}
    <span class="art"><span class="t" lang="en">{shortTitle(game.title)}</span></span>
  {/if}
</span>

<style>
  .cover { position: relative; display: flex; flex-direction: column; aspect-ratio: 3 / 4; width: 100%; border-radius: 14px; overflow: hidden; background: #16181E; border: 1px solid var(--line); }
  .stripe { flex: none; height: 28px; display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 0 8px 0 10px; background: var(--stripe); color: #0B0C0F; font-family: var(--mono); font-weight: 600; font-size: 12px; letter-spacing: 0.08em; white-space: nowrap; }
  .sys { min-width: 0; overflow: hidden; text-overflow: clip; }
  .art { flex: 1; min-height: 0; display: flex; align-items: flex-end; padding: 12px 10px; background: var(--scanlines); }
  .t { font-stretch: 115%; font-weight: 800; font-size: 19px; line-height: 1.04; text-transform: uppercase; overflow-wrap: break-word; hyphens: manual; display: -webkit-box; -webkit-line-clamp: 5; line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; }
  .pic { position: relative; padding: 0; background: var(--tone, #0B0C0F); }
  .pic img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
  .fav { flex: none; display: grid; place-items: center; color: #0B0C0F; }
  .xs { border-radius: 10px; }
  .xs .stripe { height: 18px; padding: 0 5px 0 6px; font-size: 10px; }
  .xs .art { padding: 6px; }
  .xs .t { font-size: 11px; font-stretch: 100%; -webkit-line-clamp: 4; line-clamp: 4; }
  .sm { border-radius: 12px; }
  .sm .stripe { height: 22px; padding: 0 6px 0 8px; }
  .sm .art { padding: 10px 8px; }
  .sm .t { font-size: 15px; font-stretch: 100%; }
  .lg .stripe { height: 30px; padding: 0 10px 0 12px; }
  .lg .art { padding: 14px 12px; }
  .lg .t { font-size: 20px; }
</style>
