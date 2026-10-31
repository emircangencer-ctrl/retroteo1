<script lang="ts">
  // "Kaldığın yerden": the last game played, with its last picture and one button to go on.
  import Icon from './Icon.svelte';
  import Cover from './Cover.svelte';
  import { library } from '../lib/library.svelte.ts';
  import { gameLook } from '../lib/systems.ts';
  import { splitTitle } from '../lib/title.ts';
  import { lastPlayedLabel, formatPlaytime, relativeTime } from '../lib/format.ts';
  import { routeHref } from '../lib/route.ts';
  import { blobSrc } from '../lib/blob-src.ts';
  import { listSlots } from '../lib/db.ts';
  import { player } from '../player/session.svelte.ts';
  import type { Game, SlotInfo } from '../lib/types.ts';

  interface Props { game: Game }
  let { game }: Props = $props();
  const hasResume = $derived(library.hasResume(game.id));
  const look = $derived(gameLook(game));
  const parts = $derived(splitTitle(game.title));
  const playline = $derived([lastPlayedLabel(game.lastPlayed), game.playtimeMs ? `toplam ${formatPlaytime(game.playtimeMs)}` : ''].filter(Boolean).join(' · '));
  let auto = $state<SlotInfo | null>(null);

  $effect(() => {
    const id = game.id;
    void library.slots;
    auto = null;
    let alive = true;
    listSlots(id).then(slots => { if (alive) auto = slots.find(s => s.slot === 'auto') || null; }).catch(() => {});
    return () => { alive = false; };
  });
</script>

<section class="continue" aria-labelledby="continue-title">
  <button type="button" class="shot" aria-label={`${parts.name} · ${hasResume ? 'devam et' : 'oyna'}`} tabindex="-1" onclick={() => player.start(game.id)}>
    {#if auto?.thumb}
      <img alt="" use:blobSrc={auto.thumb} />
    {:else}
      <span class="shot-art" style:--stripe={look.stripe}><Cover {game} size="lg" /></span>
    {/if}
    {#if auto}<span class="chip-time">Son kayıt · {relativeTime(auto.createdAt)}</span>{/if}
  </button>
  <div class="body">
    <span class="eyebrow">Kaldığın yerden</span>
    <div>
      <h2 id="continue-title" class="title">{parts.name}</h2>
      <p class="sub">{[look.label, playline].filter(Boolean).join(' · ')}</p>
    </div>
    <div class="actions">
      <button type="button" class="btn btn-primary" data-play={game.id} onclick={() => player.start(game.id)}>
        <Icon name="play" size={18} />{hasResume ? 'Devam et' : 'Oyna'}
      </button>
      <a class="btn details" href={routeHref('game', game.id)}>Ayrıntılar</a>
    </div>
  </div>
</section>

<style>
  .continue { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-xl); overflow: hidden; display: flex; align-items: stretch; }
  .shot { position: relative; display: block; flex: 0 0 38%; max-width: 200px; min-height: 140px; padding: 0; border: 0; background: #000; overflow: hidden; cursor: pointer; }
  .shot img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; image-rendering: pixelated; }
  .shot-art { position: absolute; inset: 0; display: grid; place-items: center; background: radial-gradient(90% 120% at 50% 100%, color-mix(in srgb, var(--stripe) 30%, transparent), #0B0C0F 70%); }
  .shot-art :global(.cover) { width: 76px; transform: rotate(-4deg); box-shadow: 0 12px 30px rgba(0, 0, 0, 0.5); }
  .chip-time { position: absolute; left: 8px; bottom: 8px; padding: 4px 8px; border-radius: 999px; background: rgba(11, 12, 15, 0.82); color: var(--text); font-family: var(--mono); font-weight: 500; font-size: 11px; }
  .body { flex: 1; min-width: 0; padding: 14px; display: flex; flex-direction: column; justify-content: center; gap: 8px; }
  .title { font-size: 19px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sub { margin-top: 2px; font-size: 13px; color: var(--text-2); }
  .actions { display: flex; gap: 10px; }
  .actions .btn-primary { flex: 1; }
  .details { display: none; }
  @media (min-width: 960px) {
    .shot { flex-basis: 280px; max-width: 280px; aspect-ratio: 4 / 3; min-height: 0; }
    .shot-art :global(.cover) { width: 110px; }
    .body { padding: 20px 24px; gap: 12px; }
    .title { font-size: 26px; }
    .actions .btn-primary { flex: none; padding: 0 24px; }
    .details { display: inline-flex; }
  }
</style>
