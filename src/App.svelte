<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Sidebar from './components/Sidebar.svelte';
  import BottomNav from './components/BottomNav.svelte';
  import Dialog from './components/Dialog.svelte';
  import Toast from './components/Toast.svelte';
  import UpdateBanner from './components/UpdateBanner.svelte';
  import Library from './views/Library.svelte';
  import GameDetail from './views/GameDetail.svelte';
  import Import from './views/Import.svelte';
  import Settings from './views/Settings.svelte';
  import Help from './views/Help.svelte';
  import Player from './player/Player.svelte';
  import { router } from './lib/router.svelte.ts';
  import { library } from './lib/library.svelte.ts';
  import { settings } from './lib/settings.svelte.ts';
  import { app } from './lib/app-state.svelte.ts';
  import { importer } from './lib/importer.svelte.ts';
  import { dialogs } from './lib/dialog.svelte.ts';
  import { gamepadUI } from './lib/gamepad-ui.svelte.ts';
  import { player } from './player/session.svelte.ts';
  import { tv } from './lib/tv.svelte.ts';
  import { coverArt } from './lib/cover-art.svelte.ts';

  const route = $derived(router.route);
  const scrollMemory = new Map<string, number>();

  $effect(() => { document.documentElement.style.setProperty('--accent', settings.prefs.accent); });
  // Cover pictures: stored ones show at once; new games are looked up when no game is running.
  $effect(() => { coverArt.setActive(settings.prefs.covers && !player.open); });
  $effect(() => { if (library.ready) void coverArt.sync(library.games); });
  // On the TV the screen stays on while a game runs (no screensaver over the game).
  $effect(() => { if (tv.bridge) tv.keepScreenOn(player.running && !player.paused); });
  $effect(() => {
    app.playerOpen = player.open;
    document.documentElement.classList.toggle('player-open', player.open);
    if (!player.open) void app.refreshOffline();
  });

  // Each screen opens at the top, except one already visited (back keeps where you were).
  $effect(() => {
    const key = `${route.name}/${route.id}`;
    void tick().then(() => window.scrollTo(0, scrollMemory.get(key) ?? 0));
  });

  onMount(() => {
    try { if (history.state?.retroplayOverlay) history.replaceState(null, ''); } catch {}
    void library.init();
    app.start();
    gamepadUI.start();
    const pop = gamepadUI.push({
      root: () => document.getElementById('app-shell'),
      onAction: action => {
        if (action.type === 'back' && route.name !== 'home') { router.back('home'); return true; }
        return false;
      }
    });
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; if (!player.open) scrollMemory.set(`${router.route.name}/${router.route.id}`, window.scrollY); });
    };
    const onPop = () => { player.handlePopState(); };
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('popstate', onPop);
    return () => { pop(); removeEventListener('scroll', onScroll); removeEventListener('popstate', onPop); };
  });

  function onKey(event: KeyboardEvent) {
    if (event.key !== 'Escape' || dialogs.current || event.defaultPrevented) return;
    if (!player.open) return;
    if (document.fullscreenElement) return;
    event.preventDefault();
    if (player.fullscreenFallback) { void player.toggleFullscreen(); return; }
    if (player.menuOpen) { player.menuBack(); return; }
    if (!player.running) { void player.close(); return; }
    player.openMenu();
  }

  // Files dropped anywhere (desktop) go to the import review.
  function onDragOver(event: DragEvent) { if (!player.open && event.dataTransfer?.types?.includes('Files')) event.preventDefault(); }
  function onDrop(event: DragEvent) {
    if (player.open || route.name === 'import') return;
    const files = event.dataTransfer?.files ? [...event.dataTransfer.files] : [];
    if (!files.length) return;
    event.preventDefault();
    router.go('import');
    void importer.add(files, { source: 'Bırakılan dosyalar' });
  }
</script>

<svelte:window onkeydown={onKey} ondragover={onDragOver} ondrop={onDrop} />

<div class="app-shell" id="app-shell" inert={player.open || undefined}>
  <Sidebar />
  <main class="app-content" class:with-sidebar={true} data-nav-region="page">
    {#if route.name === 'home' || route.name === 'library'}
      <Library />
    {:else if route.name === 'game'}
      {#key route.id}<GameDetail />{/key}
    {:else if route.name === 'import'}
      <Import />
    {:else if route.name === 'settings'}
      <Settings />
    {:else if route.name === 'help'}
      <Help />
    {/if}
  </main>
  <BottomNav />
</div>
{#if tv.preview}<div class="tv-preview-badge" id="tv-preview-badge" role="status">ÖNİZLEME #{tv.preview}</div>{/if}
<Player />
<Dialog />
<Toast />
<UpdateBanner />

<style>
  .app-content { min-height: 100vh; min-height: 100dvh; overflow-x: clip; }
  /* A deploy preview on the TV never passes for the live site. */
  .tv-preview-badge { position: fixed; top: 18px; right: 28px; z-index: 950; padding: 4px 10px; border-radius: 8px; background: var(--warn-bg); border: 1px solid var(--warn-line); color: var(--warn-fg); font-family: var(--mono); font-size: 13px; font-weight: 700; pointer-events: none; }
  @media (min-width: 960px) { .app-content.with-sidebar { margin-left: var(--sidebar-w); } }
</style>
