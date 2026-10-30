<script lang="ts">
  import { toasts } from '../lib/toast.svelte.ts';
</script>

<div id="toast" class="toast" class:show={toasts.visible} data-tone={toasts.tone} role="status" aria-live="polite">{toasts.visible ? toasts.message : ''}</div>

<style>
  .toast {
    position: fixed; left: 50%; bottom: calc(var(--nav-h) + 14px); z-index: 1500; transform: translate(-50%, 12px);
    max-width: min(520px, calc(100vw - 32px)); padding: 12px 16px; border-radius: var(--r-md);
    background: #1C1F26; border: 1px solid #2E323C; color: var(--text); font-size: 14px; line-height: 1.45;
    box-shadow: 0 14px 40px rgba(0, 0, 0, 0.5); opacity: 0; pointer-events: none; transition: opacity 160ms, transform 160ms;
  }
  .toast.show { opacity: 1; transform: translate(-50%, 0); }
  .toast[data-tone='error'] { border-color: #5B2622; background: #2A1517; }
  @media (min-width: 960px) { .toast { bottom: 24px; left: calc(50% + var(--sidebar-w) / 2); } }
  :global(.player-open) .toast { bottom: 24px; left: 50%; z-index: 2500; }
  :global(html.tv) .toast { bottom: calc(var(--tv-y) + 12px); }
</style>
