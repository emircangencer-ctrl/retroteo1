<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import TouchSettings from '../components/TouchSettings.svelte';
  import KeyHints from '../components/KeyHints.svelte';
  import { tv } from '../lib/tv.svelte.ts';
  import { player, slotName } from './session.svelte.ts';
  import { settings } from '../lib/settings.svelte.ts';
  import { gamepadUI, moveFocus } from '../lib/gamepad-ui.svelte.ts';
  import { confirmDialog } from '../lib/dialog.svelte.ts';
  import { slotTime } from '../lib/format.ts';
  import { blobSrc } from '../lib/blob-src.ts';
  import { DISPLAY_SCALES, DISPLAY_FILTERS, displayLabel, type DisplayScale, type DisplayFilter } from '../display-modes.js';
  import { MANUAL_SLOTS, type SlotId } from '../lib/types.ts';

  let menu: HTMLElement | null = $state(null);
  const quick = $derived(player.slotInfo('quick'));
  const auto = $derived(player.slotInfo('auto'));
  const display = $derived(settings.display);
  const scales = Object.entries(DISPLAY_SCALES) as Array<[DisplayScale, { label: string; hint: string }]>;
  const filters = Object.entries(DISPLAY_FILTERS) as Array<[DisplayFilter, { label: string; hint: string }]>;
  const fullscreenLabel = $derived(player.fullscreen || player.fullscreenFallback ? 'Tam ekrandan çık' : 'Tam ekran');

  // Focus the first control of each view (controller and keyboard users land on it).
  $effect(() => {
    if (!player.menuOpen || !menu) return;
    void player.panel;
    queueMicrotask(() => {
      // The menu starts on "Oyuna dön"; a sub-panel on its first setting (not on its header).
      const content = menu?.querySelector<HTMLElement>('.items, .slots, .panel-body');
      const target = content?.querySelector<HTMLElement>('[data-nav-default]') || content?.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled])') || menu?.querySelector<HTMLElement>('button:not([disabled])');
      target?.focus({ preventScroll: true });
      if (menu) menu.scrollTop = 0;
    });
  });

  // A closed menu keeps no focus: the next key (Esc to reopen, game keys) must reach the app.
  $effect(() => {
    if (player.menuOpen || !menu) return;
    const active = document.activeElement as HTMLElement | null;
    if (active && menu.contains(active)) active.blur();
  });

  function onKey(event: KeyboardEvent) {
    if (!menu || !player.menuOpen) return;
    const tag = (event.target as HTMLElement)?.tagName;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (tag === 'INPUT' && (event.target as HTMLInputElement).type === 'range') return;
      event.preventDefault();
      moveFocus(menu, event.key === 'ArrowDown' ? 'down' : 'up');
    } else if (event.key === 'Escape' || event.key === 'Backspace') {
      if (tag === 'INPUT' && event.key === 'Backspace') return;
      event.preventDefault();
      event.stopPropagation();
      player.menuBack();
    }
  }

  async function saveSlot(slot: SlotId) {
    const existing = player.slotInfo(slot);
    if (existing && !(await confirmDialog({ title: `${slotName(slot)} değişsin mi?`, message: `${slotName(slot)} ${slotTime(existing.createdAt)} kaydedildi. Oyunun şu anki hâli onun yerine kaydedilir.`, confirmLabel: 'Üzerine kaydet' }))) return;
    await player.saveToSlot(slot);
  }

  async function loadSlot(slot: SlotId) {
    if (await player.loadSlot(slot)) await player.closeMenu();
  }

  async function restart() {
    if (!(await confirmDialog({ title: 'Oyun yeniden başlasın mı?', message: 'Oyun en başından açılır. Kaydedilmemiş ilerleme gider; oyun içi kayıtların ve kayıt yuvaların kalır.', confirmLabel: 'Yeniden başlat', danger: true }))) return;
    await player.closeMenu();
    player.restartFromBeginning();
  }
</script>

<div
  bind:this={menu}
  class="player-menu"
  id="player-menu"
  role="dialog"
  tabindex="-1"
  aria-modal="true"
  aria-label="Oyun menüsü"
  hidden={!player.menuOpen}
  data-panel={player.panel}
  onkeydown={onKey}
>
  {#if player.panel === 'main'}
    <div class="menu-head">
      <span class="eyebrow-accent">{player.paused ? 'DURAKLATILDI' : 'MENÜ'}</span>
      <h2>{player.title}</h2>
      <p class="play-menu-status" id="play-menu-status">{player.status.replace(/^Duraklatıldı\s*·\s*/, '')}</p>
    </div>
    <div class="items">
      <button type="button" class="item primary" id="play-menu-close" data-nav-default onclick={() => player.closeMenu()}><Icon name="play" size={18} /><span class="grow">Oyuna dön</span></button>
      {#if player.controls.isArcade}
        <div class="item-pair">
          <button type="button" class="item" id="menu-coin" disabled={!player.running} onclick={() => player.tapFromMenu('BUTTON_SELECT')}><Icon name="plus" size={18} /><span class="grow">Jeton at</span></button>
          <button type="button" class="item" id="menu-start" disabled={!player.running} onclick={() => player.tapFromMenu('BUTTON_START')}><Icon name="play" size={18} /><span class="grow">Başla</span></button>
        </div>
      {/if}
      {#if tv.active}<button type="button" class="item" id="menu-ff" aria-pressed={player.fastForward} disabled={!player.running} onclick={() => player.toggleFastForwardFromMenu()}><Icon name="forward" size={18} /><span class="grow">Hızlı ileri</span><span class="aside">{player.fastForward ? 'açık' : 'kapalı'}</span></button>{/if}
      <button type="button" class="item" id="quick-save" disabled={!player.canSave || !player.running} onclick={async () => { await player.quickSave(); }}><Icon name="save" size={18} /><span class="grow">Hızlı kaydet</span></button>
      <button type="button" class="item" id="quick-load" disabled={!player.canLoad || !player.running} onclick={async () => { await player.quickLoad(); await player.closeMenu(); }}><Icon name="load" size={18} /><span class="grow">Hızlı yükle</span>{#if quick}<span class="aside">{slotTime(quick.createdAt)}</span>{/if}</button>
      <button type="button" class="item" id="menu-slots" disabled={!player.running || !player.canSave} onclick={() => player.setPanel('slots')}><Icon name="slots" size={18} /><span class="grow">Kayıt yuvaları</span><Icon name="chevron" size={16} class="chev" /></button>
      <button type="button" class="item" id="menu-display" onclick={() => player.setPanel('display')}><Icon name="monitor" size={18} /><span class="grow">Ekran ve ses</span><span class="aside" id="display-mode">{displayLabel(display)}</span><Icon name="chevron" size={16} class="chev" /></button>
      <button type="button" class="item" id="touch-settings-open" aria-haspopup="true" onclick={() => player.setPanel('controls')}><Icon name="gamepad" size={18} /><span class="grow">Kontroller ve oyuncular</span><Icon name="chevron" size={16} class="chev" /></button>
      {#if !tv.active}<button type="button" class="item" id="fullscreen-game" aria-pressed={player.fullscreen || player.fullscreenFallback} onclick={() => player.toggleFullscreen()}><Icon name="fullscreen" size={18} /><span class="grow">{fullscreenLabel}</span></button>{/if}
      <button type="button" class="item" id="perf-test" disabled={!player.running || player.perfRunning} title="Bu cihazın bu oyunu ne kadar rahat çalıştırdığını ölç" onclick={() => player.runPerformanceTest()}><Icon name="gauge" size={18} /><span class="grow">Performansı ölç</span><span class="aside">~7 sn</span></button>
      <button type="button" class="item" id="menu-restart" disabled={!player.running} onclick={restart}><Icon name="restart" size={18} /><span class="grow">Yeniden başlat</span></button>
      <button type="button" class="item danger" id="player-exit" onclick={() => player.close()}><Icon name="exit" size={18} /><span class="grow">Oyundan çık</span><span class="aside">{settings.prefs.autoResume ? 'kaydedip çıkar' : 'çıkar'}</span></button>
    </div>
  {:else}
    <div class="sub-head">
      <button type="button" class="back" id="ts-back" onclick={() => player.menuBack()}><Icon name="back" size={18} />Menü</button>
      <strong>{player.panel === 'slots' ? 'Kayıt yuvaları' : player.panel === 'display' ? 'Ekran ve ses' : 'Kontroller ve oyuncular'}</strong>
      <button type="button" class="btn btn-sm btn-primary" id="ts-done" onclick={() => player.closeMenu()}>Oyuna dön</button>
    </div>

    {#if player.panel === 'slots'}
      <div class="slots">
        {#if auto}
          <div class="slot">
            <span class="shot"><img alt="" use:blobSrc={auto.thumb} class:none={!auto.thumb} /><b>OTO</b></span>
            <span class="slot-text"><span class="name">Devam noktası</span><span class="when">{slotTime(auto.createdAt)}</span></span>
            <span class="slot-actions"><button type="button" class="btn btn-sm" onclick={() => loadSlot('auto')}>Yükle</button></span>
          </div>
        {/if}
        {#each MANUAL_SLOTS as slot (slot)}
          {@const info = player.slotInfo(slot)}
          <div class="slot" class:is-empty={!info} data-slot={slot}>
            <span class="shot">{#if info}<img alt="" use:blobSrc={info.thumb} class:none={!info.thumb} />{/if}<b>{slot}</b></span>
            <span class="slot-text"><span class="name">{slotName(slot)}</span><span class="when">{info ? slotTime(info.createdAt) : 'Boş'}</span></span>
            <span class="slot-actions">
              <button type="button" class="btn btn-sm" data-slot-save={slot} onclick={() => saveSlot(slot)} data-nav-default={slot === '1' ? true : undefined}>Kaydet</button>
              <button type="button" class="btn btn-sm" data-slot-load={slot} disabled={!info} onclick={() => loadSlot(slot)}>Yükle</button>
            </span>
          </div>
        {/each}
        <p class="note">Yuvalar bu cihazda saklanır ve oyun sayfasında da görünür. Hızlı kayıt üst çubuktaki “Kaydet” ile alınır.</p>
      </div>
    {:else if player.panel === 'display'}
      <div class="panel-body">
        <div class="field">
          <span class="label">Ölçekleme</span>
          <div class="seg" role="group" aria-label="Ölçekleme">
            {#each scales as [key, scale] (key)}
              <button type="button" data-value={key} aria-pressed={display.scale === key} data-nav-default={display.scale === key ? true : undefined} onclick={() => player.setDisplay({ scale: key })}>{scale.label}</button>
            {/each}
          </div>
          <p class="note">{DISPLAY_SCALES[display.scale as keyof typeof DISPLAY_SCALES].hint}</p>
        </div>
        <div class="field">
          <span class="label">Ekran filtresi</span>
          <div class="seg" role="group" aria-label="Ekran filtresi">
            {#each filters as [key, filter] (key)}
              <button type="button" data-value={key} aria-pressed={display.filter === key} onclick={() => player.setDisplay({ filter: key })}>{filter.label}</button>
            {/each}
          </div>
          <p class="note">{DISPLAY_FILTERS[display.filter as keyof typeof DISPLAY_FILTERS].hint}</p>
        </div>
        <label class="field">
          <span class="head"><span class="label">Ses</span><output class="value" for="volume">%{Math.round(settings.prefs.volume * 100)}</output></span>
          <input type="range" id="volume" min="0" max="100" step="5" value={Math.round(settings.prefs.volume * 100)} oninput={e => player.setVolume(Number((e.currentTarget as HTMLInputElement).value) / 100)} />
        </label>
      </div>
    {:else}
      <div class="panel-body controls">
        <div class="field players" id="players" data-count={player.controls.players.count}>
          <span class="label">Oyuncular</span>
          {#each player.controls.players.pads.filter(pad => pad.player !== null) as pad (pad.key)}
            <div class="player-row" data-pad={pad.index} data-player={pad.player! + 1}><b>{pad.player! + 1}P</b><span>{pad.name}</span></div>
          {/each}
          <p class="note" id="players-note">{player.controls.players.count < 2 ? 'Bu oyun tek oyunculu: bütün kontroller 1. oyuncuyu oynatır.' : `Kumandalar takıldıkları sırayla 1., 2. … oyuncu olur.${player.controls.touchPlay ? ' Dokunmatik tuşlar 1. oyuncudur.' : tv.active ? '' : ' Klavyede iki oyuncu birden oynar: 1. oyuncu sağda (ok tuşları), 2. oyuncu solda (WASD).'}${player.controls.isArcade ? ' Her oyuncu kendi Select tuşuyla jeton atar, Start ile başlar.' : ''}`}</p>
        </div>
        {#if player.controls.touchPlay}
          <div class="touch-settings" id="touch-settings">
            <TouchSettings prefix="ts" compact arcade={player.platform === 'ARCADE'} fourWay={player.controls.fourWay} />
          </div>
        {/if}
        <div class="gamepad-status" id="gamepad-status" data-state={player.controls.gamepadState} role="status" aria-live="polite">
          <span class="gamepad-status-dot" aria-hidden="true"></span>
          <span id="gamepad-status-text">{player.controls.gamepadText}</span>
          <button id="refresh-gamepads" class="text-btn" type="button" onclick={() => player.controls.updateGamepadStatus()}>Yeniden tara</button>
        </div>
        <p class="note">Kontrolcü: tuşlar konumlarına göre eşlenir (alt = B, sağ = A, sol = Y, üst = X), sol çubuk yön tuşu gibi çalışır.{player.controls.isArcade ? ' Select jeton atar, Start başlatır.' : ' R2 hızlı ileri sarmayı açıp kapatır, L2 basılı tutulunca geri sarar.'} Menü: ortadaki ana düğme ya da Select + Start birlikte. Menüde A seçer, B geri döner.</p>
        {#if !player.controls.touchPlay && !tv.active}
          <div class="note keys" id="menu-key-hints"><span class="keys-title">Klavye</span>{#each player.controls.keyHintRows as hints, i (i)}<span class="hint-row" data-player={i + 1}>{#if player.controls.keyHintRows.length > 1}<b class="who">{i + 1}P</b>{/if}<KeyHints {hints} /></span>{/each}</div>
          <p class="note">{player.controls.isArcade ? '1. oyuncu: jeton 5 veya Sağ Shift, başla 1 veya Enter.' : '1. oyuncu: Start Enter ya da 1, Select Sağ Shift ya da 5.'}{player.controls.keyHintRows.length > 1 ? (player.controls.isArcade ? ' 2. oyuncu: jeton 6, başla 2.' : ' 2. oyuncu: Start 2, Select 6.') : ''} Boşluk hızlı ileri sarar{player.canRewind ? ', Backspace basılı tutulunca geri sarar' : ''}.</p>
        {/if}
      </div>
    {/if}
  {/if}
  {#if gamepadUI.navigating || gamepadUI.connected}
    <div class="pad-hints" aria-hidden="true"><span><b>A</b>Seç</span><span><b>B</b>{player.panel === 'main' ? 'Oyuna dön' : 'Geri'}</span></div>
  {/if}
</div>
