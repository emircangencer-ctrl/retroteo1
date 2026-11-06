<script lang="ts">
  import { untrack } from 'svelte';
  import { app } from '../lib/app-state.svelte.ts';
  import { tv } from '../lib/tv.svelte.ts';
  import { dialogs } from '../lib/dialog.svelte.ts';
  import { router } from '../lib/router.svelte.ts';
  import { importer } from '../lib/importer.svelte.ts';

  /** On the TV an update found this soon after the app opens is applied at once. */
  const TV_AUTO_UPDATE_MS = 30_000;

  const shown = $derived(app.updateReady && !app.updateDismissed && !app.playerOpen);
  let reload = $state<HTMLButtonElement>();

  // TV: right after the app opens nothing is under way yet, so the new version loads without
  // asking (the TV always runs the newest one). Later the banner asks, as on other devices.
  $effect(() => {
    if (!tv.active || !app.updateReady || app.updateDismissed || app.playerOpen || dialogs.current) return;
    if (performance.now() - app.startedAt > TV_AUTO_UPDATE_MS) return;
    if (router.route.name === 'import' || importer.phase !== 'idle') return;
    app.applyUpdate();
  });

  // TV: the banner takes the focus when it appears, so OK reloads; "Sonra" gives the focus back.
  $effect(() => {
    const button = reload;
    if (!button || !tv.active) return;
    const previous = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    if (!untrack(() => dialogs.current)) button.focus({ preventScroll: true });
    return () => {
      const active = document.activeElement;
      if ((!active || active === document.body || !active.isConnected) && previous?.isConnected) previous.focus({ preventScroll: true });
    };
  });
</script>

{#if shown}
  <div class="update-banner" id="update-banner" role="status" aria-live="polite">
    <span>Yeni sürüm hazır.</span>
    <button type="button" class="btn btn-sm btn-primary" id="update-reload" bind:this={reload} onclick={() => app.applyUpdate()}>Yenile</button>
    <button type="button" class="text-btn" id="update-later" onclick={() => (app.updateDismissed = true)}>Sonra</button>
  </div>
{/if}

<style>
  .update-banner {
    position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(var(--nav-h) + 14px); z-index: 1400;
    display: flex; align-items: center; gap: 12px; padding: 10px 12px 10px 16px; border-radius: var(--r-lg);
    background: #1C1F26; border: 1px solid var(--accent-line); box-shadow: 0 14px 40px rgba(0, 0, 0, 0.5); font-size: 14px; font-weight: 600;
    width: max-content; max-width: calc(100vw - 24px);
  }
  .update-banner .btn { min-height: 38px; font-size: 14px; }
  @media (min-width: 960px) { .update-banner { bottom: 24px; left: calc(50% + var(--sidebar-w) / 2); } }
  /* Inside the TV's safe area, larger for the distance. */
  :global(html.tv) .update-banner { bottom: calc(var(--tv-y) + 12px); font-size: 16px; padding: 12px 14px 12px 20px; }
  :global(html.tv) .update-banner .btn, :global(html.tv) .update-banner .text-btn { min-height: 44px; font-size: 16px; padding-inline: 18px; }
</style>
