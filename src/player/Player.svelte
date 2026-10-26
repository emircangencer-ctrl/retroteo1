<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import PauseMenu from './PauseMenu.svelte';
  import { player } from './session.svelte.ts';
  import { gamepadUI } from '../lib/gamepad-ui.svelte.ts';
  import KeyHints from '../components/KeyHints.svelte';
  import { keyboardLabels } from '../lib/keyboard-labels.svelte.ts';
  import { PRIMARY_SYSTEM_KEY } from '../lib/key-hints.ts';

  let modal: HTMLElement;
  let screen: HTMLElement;
  let touchRoot: HTMLElement;
  let biosInput: HTMLInputElement;
  let idle = $state(false);
  let idleTimer: ReturnType<typeof setTimeout> | 0 = 0;

  onMount(() => { player.mount({ modal, screen, touchRoot, biosInput }); });

  const loading = $derived(player.open && !player.running && !player.blocked && !player.consent && !player.error);
  const showPadChip = $derived(player.touchPlay && player.padInUse);

  // Desktop: the bar steps away while playing in fullscreen and comes back on mouse movement.
  function wake() {
    idle = false;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (player.running && !player.paused && !player.menuOpen && player.fullscreen && !player.touchPlay) idle = true; }, 2500);
  }
  $effect(() => { if (!player.fullscreen || player.menuOpen) idle = false; else wake(); });

  // Arcade on a computer: Jeton and Başla in the bar. Focus leaves the button afterwards, so Space or
  // Enter keep going to the game instead of pressing the button again.
  function tap(event: MouseEvent, name: 'BUTTON_SELECT' | 'BUTTON_START') {
    player.tapInput(name);
    (event.currentTarget as HTMLElement).blur();
  }
</script>

<div
  bind:this={modal}
  id="player-modal"
  class="player"
  class:hidden={!player.open}
  class:touch-play={player.touchPlay}
  class:menu-open={player.menuOpen}
  class:settings-view={player.menuOpen && player.panel === 'controls'}
  class:pad-hidden={player.padHidden}
  class:pad-in-use={player.padInUse}
  class:is-vertical={player.vertical}
  class:is-fallback={player.fullscreenFallback}
  class:idle
  data-orientation={player.touchPlay ? player.orientation : 'desktop'}
  role="dialog"
  aria-modal="true"
  aria-labelledby="player-title"
  aria-hidden={player.open ? undefined : 'true'}
  onpointermove={wake}
>
  <header class="play-bar" id="play-bar">
    <button type="button" class="play-chip play-menu-button" id="play-menu" aria-label="Menü" aria-expanded={player.menuOpen} aria-controls="player-menu" onclick={() => player.toggleMenu()}>
      <span class="bars" aria-hidden="true"></span><span class="desk-label">Menü</span>
    </button>
    <div class="play-title">
      <strong id="player-title">{player.title}</strong>
      <span class="status-line" id="player-status" role="status">{player.status}</span>
    </div>
    <button type="button" class="play-chip play-pad-chip" id="play-pad-chip" hidden={!showPadChip} title="Kontrolcü bağlı · dokunmatik tuşları göster/gizle" aria-label="Kontrolcü bağlı · dokunmatik tuşları göster veya gizle" onclick={() => player.togglePadWithGamepad()}>🎮</button>
    {#if player.isArcade}
      <button type="button" class="play-chip desk-only arcade-chip coin" id="play-coin" disabled={!player.running || player.paused} title="Jeton at" onclick={event => tap(event, 'BUTTON_SELECT')}>Jeton<kbd>{keyboardLabels.cap(PRIMARY_SYSTEM_KEY.arcade.BUTTON_SELECT)}</kbd></button>
      <button type="button" class="play-chip desk-only arcade-chip" id="play-start" disabled={!player.running || player.paused} title="Başla (1. oyuncu)" onclick={event => tap(event, 'BUTTON_START')}>Başla<kbd>{keyboardLabels.cap(PRIMARY_SYSTEM_KEY.arcade.BUTTON_START)}</kbd></button>
    {/if}
    <button type="button" class="play-chip" id="play-save" disabled={!player.canSave || !player.running} onclick={() => player.quickSave()}>Kaydet</button>
    <button type="button" class="play-chip" id="play-load" disabled={!player.canLoad || !player.running} onclick={() => player.quickLoad()}>Yükle</button>
    <button type="button" class="play-chip desk-only" id="bar-fullscreen" aria-label={player.fullscreen || player.fullscreenFallback ? 'Tam ekrandan çık' : 'Tam ekran'} title={player.fullscreen || player.fullscreenFallback ? 'Tam ekrandan çık' : 'Tam ekran'} onclick={() => player.toggleFullscreen()}><Icon name={player.fullscreen || player.fullscreenFallback ? 'fullscreen-exit' : 'fullscreen'} size={18} /></button>
    <button type="button" class="play-chip desk-only close" id="player-close" aria-label="Oyunu kapat" title="Kaydedip çık" onclick={() => player.close()}><Icon name="close" size={18} /></button>
  </header>

  <div class="stage">
    <div class="player-screen-frame">
      <div id="player-screen" class="player-screen" class:is-vertical={player.vertical} aria-label="Oyun görüntüsü" bind:this={screen}></div>
      {#if loading}
        <div class="loading" aria-hidden="true"><span class="spinner"></span><span>{player.status}</span></div>
      {/if}
    </div>
  </div>

  <div class="touch-controls" id="touch-controls" aria-label="Dokunmatik oyun kontrolleri" bind:this={touchRoot}></div>

  {#if player.notice}
    {#key player.notice.id}
      <div class="player-notice" id="player-notice" role="status" aria-live="polite">
        <span id="player-notice-text">{player.notice.text}</span>
        {#if player.notice.action}
          <button type="button" id="player-notice-action" onclick={() => { const run = player.notice?.action?.run; player.hideNotice(); run?.(); }}>{player.notice.action.label}</button>
        {/if}
      </div>
    {/key}
  {:else}
    <div class="player-notice" id="player-notice" hidden><span id="player-notice-text"></span></div>
  {/if}

  <div class="player-consent" id="player-consent" role="alertdialog" aria-labelledby="player-consent-title" aria-describedby="player-consent-text" hidden={!player.consent}>
    <span class="tag warn"><Icon name="warn" size={16} />Doğrulanmamış döküm</span>
    <strong id="player-consent-title">Bu dosya temiz bir Super Mario Bros. 3 kopyası değil</strong>
    <p id="player-consent-text">Dosya, oyunun bilinen temiz sürümlerinin hiçbiriyle eşleşmiyor. Büyük olasılıkla değiştirilmiş (hack) bir kopya; grafikler veya oynanış orijinalden farklı olabilir. Seçimin bu oyun için hatırlanır.</p>
    <p class="player-consent-detail" id="player-consent-detail">{player.consent?.detail || ''}</p>
    <div class="actions">
      <button class="btn btn-primary" id="consent-play" type="button" data-nav-default onclick={() => player.answerConsent(true)}>Yine de oyna</button>
      <button class="btn" id="consent-cancel" type="button" onclick={() => player.answerConsent(false)}>Vazgeç</button>
    </div>
  </div>

  {#if player.blocked}
    <div class="player-blocked" role="alert">
      <strong>{player.blocked.status}</strong>
      <p>{player.blocked.message}</p>
      <div class="actions">
        {#if player.blocked.action}
          <button class="btn btn-primary player-retry" id="player-retry" type="button" data-nav-default onclick={() => player.runBlockedAction()}>{player.blocked.action.label}</button>
        {/if}
        <button class="btn" type="button" id="player-blocked-exit" onclick={() => player.close()}>Kütüphaneye dön</button>
      </div>
    </div>
  {/if}

  <p class="player-error" id="player-error" role="alert">{player.blocked ? '' : player.error}</p>
  {#if player.error && !player.blocked && !player.running}
    <div class="player-fail"><button class="btn player-error-exit" type="button" data-nav-default onclick={() => player.close()}>Kütüphaneye dön</button></div>
  {/if}

  {#if player.menuOpen}
    <div class="play-menu-backdrop" id="play-menu-backdrop" role="presentation" onclick={() => player.closeMenu()}></div>
  {/if}
  <PauseMenu />

  {#if !player.touchPlay && player.open && player.running && !player.menuOpen}
    <p class="desk-hints" aria-hidden="true">
      <KeyHints hints={player.keyHints} />
      {#if gamepadUI.connected}<span class="pad"><Icon name="gamepad" size={16} /> kontrolcü hazır · {player.isArcade ? 'Select jeton · Start başla · ' : ''}Select+Start menü</span>{/if}
    </p>
  {/if}
  <input type="file" id="player-bios-input" hidden accept=".zip,application/zip" bind:this={biosInput} />
</div>
