<script lang="ts">
  import { app } from '../lib/app-state.svelte.ts';
</script>

{#if app.updateReady && !app.updateDismissed && !app.playerOpen}
  <div class="update-banner" id="update-banner" role="status" aria-live="polite">
    <span>Yeni sürüm hazır.</span>
    <button type="button" class="btn btn-sm btn-primary" id="update-reload" onclick={() => app.applyUpdate()}>Yenile</button>
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
</style>
