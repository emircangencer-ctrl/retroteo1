<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import Cover from '../components/Cover.svelte';
  import GameCard from '../components/GameCard.svelte';
  import { library } from '../lib/library.svelte.ts';
  import { continueCandidate, recentlyPlayed, isPlayable } from '../lib/library-view.ts';
  import { gameLook } from '../lib/systems.ts';
  import { lastPlayedLabel, formatPlaytime, relativeTime } from '../lib/format.ts';
  import { routeHref } from '../lib/route.ts';
  import { blobSrc } from '../lib/blob-src.ts';
  import { listSlots } from '../lib/db.ts';
  import { player } from '../player/session.svelte.ts';
  import type { SlotInfo } from '../lib/types.ts';

  const hero = $derived(continueCandidate(library.games));
  const recent = $derived(recentlyPlayed(library.games, 12).filter(g => g.id !== hero?.id));
  const added = $derived(library.games.slice().sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).slice(0, 12));
  const hasResume = $derived(hero ? library.hasResume(hero.id) : false);
  let auto = $state<SlotInfo | null>(null);

  $effect(() => {
    const id = hero?.id;
    void library.slots;
    auto = null;
    if (!id) return;
    let alive = true;
    listSlots(id).then(slots => { if (alive) auto = slots.find(s => s.slot === 'auto') || null; }).catch(() => {});
    return () => { alive = false; };
  });

  const look = $derived(hero ? gameLook(hero) : null);
  const playline = $derived(hero ? [lastPlayedLabel(hero.lastPlayed), hero.playtimeMs ? `toplam ${formatPlaytime(hero.playtimeMs)}` : ''].filter(Boolean).join(' · ') : '');
</script>

<div class="page home">
  <header class="page-head mobile-head">
    <a class="brand" href="#/" aria-label="RetroPlay"><span class="mark" aria-hidden="true"></span><span>RETROPLAY</span></a>
    <a class="icon-btn" href="#/library?focus=search" aria-label="Oyun ara"><Icon name="search" /></a>
  </header>

  {#if !library.ready}
    <div class="skeleton" aria-hidden="true"></div>
  {:else if library.games.length === 0}
    <section class="welcome" aria-labelledby="welcome-title">
      <span class="eyebrow">Kişisel retro kütüphanen</span>
      <h1 id="welcome-title" class="display-title">Oyunlarını ekle,<br />kaldığın yerden oyna.</h1>
      <p>NES, Super Nintendo, Mega Drive ve arcade oyunların bu cihazda kalır. Hesap yok, internet gerekmez; kayıtların otomatik alınır.</p>
      <div class="cta">
        <a class="btn btn-primary" href="#/import" data-nav-default><Icon name="plus" size={18} stroke={2.2} />Oyun ekle</a>
        <a class="btn" href="#/help">Nasıl çalışır?</a>
      </div>
      <ul class="systems" aria-label="Desteklenen sistemler">
        {#each ['NES', 'SNES', 'MD', 'ARCADE'] as key (key)}
          {@const l = gameLook({ id: key, title: key, platform: key })}
          <li><span class="dot" style:background={l.stripe}></span>{l.label}</li>
        {/each}
      </ul>
    </section>
  {:else}
    {#if hero && look}
      <section class="continue" aria-labelledby="continue-title">
        <a class="shot" href={routeHref('game', hero.id)} aria-label={`${hero.title} ayrıntıları`} tabindex="-1">
          {#if auto?.thumb}
            <img alt="" use:blobSrc={auto.thumb} />
          {:else}
            <span class="shot-art" style:--stripe={look.stripe}><Cover game={hero} size="lg" /></span>
          {/if}
          {#if auto}<span class="chip-time">Son kayıt · {relativeTime(auto.createdAt)}</span>{/if}
        </a>
        <div class="body">
          <span class="kicker eyebrow">Kaldığın yerden</span>
          <div class="badges">
            <span class="badge sys" style:background={look.badgeBg} style:color={look.badgeFg}><span class="dot" style:background={look.stripe}></span>{look.label}</span>
            {#if hero.favorite}<span class="badge muted"><Icon name="heart-fill" size={12} />Favori</span>{/if}
          </div>
          <div>
            <h1 id="continue-title" class="title">{hero.title}</h1>
            {#if playline}<p class="sub">{playline}</p>{/if}
          </div>
          <div class="actions">
            <button type="button" class="btn btn-primary" data-play={hero.id} data-nav-default onclick={() => player.start(hero.id)}>
              <Icon name="play" size={18} />{hasResume ? 'Devam et' : 'Oyna'}
            </button>
            <a class="btn details" href={routeHref('game', hero.id)}>Ayrıntılar</a>
          </div>
        </div>
      </section>
    {/if}

    {#if recent.length}
      <section class="shelf" aria-labelledby="recent-title">
        <div class="shelf-head">
          <h2 id="recent-title" class="eyebrow">Son oynananlar</h2>
          <a class="text-btn" href="#/library?sort=recent">Tümü</a>
        </div>
        <div class="rail">
          {#each recent as game (game.id)}<GameCard {game} layout="row" />{/each}
        </div>
      </section>
    {/if}

    <section class="shelf" aria-labelledby="added-title">
      <div class="shelf-head">
        <h2 id="added-title" class="eyebrow">{hero ? 'Son eklenenler' : 'Kütüphanen'}</h2>
        <a class="text-btn" href="#/library">Kütüphane</a>
      </div>
      {#if !hero}<p class="tip">Bir oyunu seç: ayrıntıları açılır, oradan oynarsın. Kaldığın yer otomatik kaydedilir.</p>{/if}
      <div class="rail">
        {#each added as game (game.id)}<GameCard {game} layout="row" />{/each}
        <a class="add-tile" href="#/import"><Icon name="plus" size={24} /><span>Oyun ekle</span></a>
      </div>
    </section>

    {#if library.games.some(g => !isPlayable(g))}
      <p class="foot-note">Bazı kayıtlar henüz açılamıyor (ROM'u eksik, desteklenmeyen sistem ya da eksik arcade seti). Ayrıntıyı oyunun sayfasında görürsün.</p>
    {/if}
  {/if}
</div>

<style>
  .brand { display: flex; align-items: center; gap: 10px; color: var(--text); text-decoration: none; font-stretch: 125%; font-weight: 800; font-size: 18px; letter-spacing: 0.06em; }
  .mark { width: 10px; height: 10px; border-radius: 2px; background: var(--accent); box-shadow: 0 0 12px var(--accent); }
  .skeleton { height: 360px; border-radius: var(--r-xl); background: linear-gradient(90deg, #121418, #16181E, #121418); background-size: 200% 100%; animation: shimmer 1.4s infinite; }
  @keyframes shimmer { to { background-position: -200% 0; } }

  .welcome { display: flex; flex-direction: column; gap: 14px; padding: 28px 20px; border-radius: var(--r-xl); background: radial-gradient(120% 90% at 100% 0%, color-mix(in srgb, var(--accent) 18%, transparent), transparent 60%), var(--surface); border: 1px solid var(--line); }
  .welcome p { color: var(--text-2); font-size: 15px; line-height: 1.55; max-width: 46ch; }
  .cta { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 4px; }
  .systems { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px 16px; font-family: var(--mono); font-size: 12px; color: var(--text-2); }
  .systems li { display: flex; align-items: center; gap: 6px; }
  .dot { width: 8px; height: 8px; border-radius: 2px; }

  .continue { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-xl); overflow: hidden; display: flex; flex-direction: column; }
  .shot { position: relative; display: block; height: 220px; background: #000; overflow: hidden; }
  .shot img { width: 100%; height: 100%; object-fit: cover; image-rendering: pixelated; }
  .shot-art { position: absolute; inset: 0; display: grid; place-items: center; background: radial-gradient(90% 120% at 50% 100%, color-mix(in srgb, var(--stripe) 30%, transparent), #0B0C0F 70%); }
  .shot-art :global(.cover) { width: 132px; transform: rotate(-4deg); box-shadow: 0 18px 40px rgba(0, 0, 0, 0.5); }
  .chip-time { position: absolute; left: 12px; top: 12px; padding: 6px 10px; border-radius: 999px; background: rgba(11, 12, 15, 0.82); color: var(--text); font-family: var(--mono); font-weight: 500; font-size: 12px; }
  .body { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  .kicker { display: none; }
  .badges { display: flex; gap: 8px; flex-wrap: wrap; }
  .title { font-size: 24px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.2; }
  .sub { margin-top: 4px; font-size: 14px; color: var(--text-2); }
  .actions { display: flex; gap: 10px; }
  .actions .btn-primary { flex: 1; }
  .details { display: none; }

  .shelf { display: flex; flex-direction: column; gap: 12px; margin-top: 4px; }
  .shelf-head { display: flex; justify-content: space-between; align-items: center; min-height: 32px; }
  .rail { position: relative; display: flex; gap: 12px; overflow-x: auto; scroll-snap-type: x proximity; margin: 0 calc(var(--pad-x) * -1); padding: 2px var(--pad-x) 6px; scrollbar-width: none; }
  .rail::-webkit-scrollbar { display: none; }
  .rail > :global(*) { scroll-snap-align: start; }
  .add-tile { width: 108px; height: 144px; flex: none; border-radius: 12px; border: 1px dashed #3A3F4A; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--text-2); text-decoration: none; font-size: 13px; font-weight: 600; }
  .add-tile:hover { color: var(--text); border-color: var(--accent-line); }
  .tip { font-size: 14px; color: var(--text-2); line-height: 1.5; margin-top: -4px; }
  .foot-note { font-size: 13px; color: var(--text-3); line-height: 1.5; }

  @media (min-width: 960px) {
    .mobile-head { display: none; }
    .continue { flex-direction: row; flex-wrap: wrap; gap: 24px; padding: 20px; }
    .shot { flex: 0 1 360px; height: auto; aspect-ratio: 4 / 3; border-radius: 12px; }
    .body { flex: 1 1 280px; padding: 0; justify-content: center; gap: 14px; }
    .kicker { display: block; }
    .title { font-size: 30px; }
    .actions .btn-primary { flex: none; padding: 0 24px; }
    .details { display: inline-flex; }
    .rail { flex-wrap: wrap; overflow: visible; margin: 0; padding: 0; gap: 20px 16px; }
    .rail :global(.game-card.is-row) { width: 150px; }
    .add-tile { display: none; }
  }
</style>
