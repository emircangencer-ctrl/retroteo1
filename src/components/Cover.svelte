<script lang="ts">
  // Typographic cover from the design: the system's colour stripe and the title on scan lines.
  import { gameLook } from '../lib/systems.ts';
  import Icon from './Icon.svelte';
  import type { Game } from '../lib/types.ts';

  interface Props { game: Game; size?: 'xs' | 'sm' | 'md' | 'lg'; favorite?: boolean }
  let { game, size = 'md', favorite = false }: Props = $props();
  const look = $derived(gameLook(game));
</script>

<span class={`cover ${size}`} style:--stripe={look.stripe} aria-hidden="true">
  <span class="stripe"><span class="sys">{look.stripeLabel}</span>{#if favorite}<span class="fav"><Icon name="heart-fill" size={size === 'xs' ? 10 : 14} /></span>{/if}</span>
  <!-- Game titles are mostly English or Japanese: upper-cased without Turkish dotted İ. -->
  <span class="art"><span class="t" lang="en">{game.title}</span></span>
</span>

<style>
  .cover { position: relative; display: flex; flex-direction: column; aspect-ratio: 3 / 4; width: 100%; border-radius: 14px; overflow: hidden; background: #16181E; border: 1px solid var(--line); }
  .stripe { flex: none; height: 28px; display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 0 8px 0 10px; background: var(--stripe); color: #0B0C0F; font-family: var(--mono); font-weight: 600; font-size: 12px; letter-spacing: 0.08em; white-space: nowrap; }
  .sys { min-width: 0; overflow: hidden; text-overflow: clip; }
  .art { flex: 1; min-height: 0; display: flex; align-items: flex-end; padding: 12px 10px; background: var(--scanlines); }
  .t { font-stretch: 115%; font-weight: 800; font-size: 19px; line-height: 1.04; text-transform: uppercase; overflow-wrap: break-word; hyphens: manual; display: -webkit-box; -webkit-line-clamp: 5; line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; }
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
