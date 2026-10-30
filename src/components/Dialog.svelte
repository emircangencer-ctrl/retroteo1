<script lang="ts">
  import { dialogs } from '../lib/dialog.svelte.ts';
  import { gamepadUI } from '../lib/gamepad-ui.svelte.ts';

  const current = $derived(dialogs.current);
  let box: HTMLElement | null = $state(null);

  $effect(() => {
    if (!current || !box) return;
    const previous = document.activeElement as HTMLElement | null;
    box.querySelector<HTMLElement>('[data-nav-default]')?.focus();
    const pop = gamepadUI.push({ root: () => box, modal: true, onAction: action => { if (action.type === 'back') { dialogs.answer(false); return true; } return false; } });
    return () => { pop(); previous?.focus?.(); };
  });

  function onKey(event: KeyboardEvent) {
    if (!current) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dialogs.answer(false); }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if current}
  <div class="backdrop" role="presentation" onclick={() => dialogs.answer(false)}></div>
  <div class="dialog" role={current.alert ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-text" bind:this={box}>
    <h2 id="dialog-title">{current.title}</h2>
    <p id="dialog-text">{current.message}</p>
    {#if current.details?.length}
      <ul class="details">
        {#each current.details as line, i (i)}<li>{line}</li>{/each}
      </ul>
    {/if}
    <div class="actions">
      {#if !current.alert}
        <button type="button" class="btn" id="dialog-cancel" onclick={() => dialogs.answer(false)}>{current.cancelLabel || 'Vazgeç'}</button>
      {/if}
      <button type="button" class={`btn ${current.danger ? 'danger' : 'btn-primary'}`} id="dialog-confirm" data-nav-default onclick={() => dialogs.answer(true)}>{current.confirmLabel || 'Tamam'}</button>
    </div>
  </div>
{/if}

<style>
  .backdrop { position: fixed; inset: 0; z-index: 2000; background: rgba(5, 6, 8, 0.72); backdrop-filter: blur(2px); }
  .dialog {
    position: fixed; z-index: 2001; left: 50%; top: 50%; transform: translate(-50%, -50%);
    width: min(440px, calc(100vw - 32px)); max-height: calc(100dvh - 48px); overflow: auto;
    padding: 22px 20px 18px; border-radius: var(--r-xl); background: #121418; border: 1px solid var(--line);
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6); display: flex; flex-direction: column; gap: 12px;
  }
  h2 { font-size: 19px; font-weight: 700; line-height: 1.25; }
  p { font-size: 14px; color: var(--text-2); line-height: 1.55; white-space: pre-line; }
  .details { margin: 0; padding: 12px 14px; list-style: none; border-radius: var(--r); background: var(--bg); display: flex; flex-direction: column; gap: 6px; font-family: var(--mono); font-size: 12px; color: #C2C7D0; }
  .actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 6px; flex-wrap: wrap; }
  .actions .btn { min-height: 46px; }
  .danger { background: #3A1715; border-color: #5B2622; color: #FFB4AD; font-weight: 700; }
  .danger:hover { background: #4A1D1A !important; }
</style>
