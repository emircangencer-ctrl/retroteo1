<script lang="ts">
  // On-screen pad settings, shared by Settings → Kontroller and the pause menu (where the pad
  // underneath changes while the sliders move).
  import { settings } from '../lib/settings.svelte.ts';
  import { player } from '../player/session.svelte.ts';

  interface Props { prefix?: string; arcade?: boolean; fourWay?: boolean; compact?: boolean }
  let { prefix = 'set', arcade = true, fourWay = false, compact = false }: Props = $props();
  const t = $derived(settings.touch);
  const id = (name: string) => `${prefix}-${name}`;
  const pct = (v: number) => `%${Math.round(v * 100)}`;
  const set = (patch: Record<string, unknown>) => player.controls.setTouch(patch);
</script>

<div class="ts" class:compact>
  <div class="row">
    <span class="grow"><span class="label">Titreşim</span><span class="hint">Dokunmatik tuşa basınca kısa titreşim</span></span>
    <button type="button" class="switch" role="switch" id={id('haptics')} aria-checked={t.haptics} aria-label="Titreşim" onclick={() => set({ haptics: !t.haptics })}></button>
  </div>
  <div class="row">
    <span class="grow"><span class="label">Kontrolcüde dokunmatiği gizle</span><span class="hint">Gamepad kullanılınca tuşlar çekilir; 🎮 ile geri gelir</span></span>
    <button type="button" class="switch" role="switch" id={id('hide-pad')} aria-checked={t.hideWithGamepad} aria-label="Kontrolcü kullanılınca dokunmatik tuşları gizle" onclick={() => set({ hideWithGamepad: !t.hideWithGamepad })}></button>
  </div>
  <label class="row stack">
    <span class="head"><span class="label">Tuş boyutu</span><output id={id('scale-out')} for={id('scale')} class="value">{pct(t.scale)}</output></span>
    <input type="range" id={id('scale')} min="80" max="130" step="5" value={Math.round(t.scale * 100)} oninput={e => set({ scale: Number((e.currentTarget as HTMLInputElement).value) / 100 })} />
  </label>
  <label class="row stack">
    <span class="head"><span class="label">Tuş saydamlığı <small>(tuşlar oyunun üstündeyken)</small></span><output id={id('opacity-out')} for={id('opacity')} class="value">{pct(t.opacity)}</output></span>
    <input type="range" id={id('opacity')} min="30" max="100" step="5" value={Math.round(t.opacity * 100)} oninput={e => set({ opacity: Number((e.currentTarget as HTMLInputElement).value) / 100 })} />
  </label>
  <div class="row stack">
    <span class="label">Yön tuşu</span>
    <div class="seg" id={id('dpad-mode')} role="group" aria-label="Yön tuşu">
      <button type="button" data-value="8" aria-pressed={t.dpadMode === '8'} onclick={() => set({ dpadMode: '8' })}>8 yön</button>
      <button type="button" data-value="4" aria-pressed={t.dpadMode === '4'} onclick={() => set({ dpadMode: '4' })}>4 yön</button>
    </div>
    {#if fourWay}<p class="note" id={id('four-way-note')}>Bu oyunun kolu 4 yönlü; yön tuşu da çapraz basmadan çalışıyor (Pac-Man, Donkey Kong gibi).</p>{/if}
  </div>
  <div class="row stack">
    <span class="label">Çapraz basma</span>
    <div class="seg" id={id('diagonal')} role="group" aria-label="Çapraz basma kolaylığı">
      <button type="button" data-value="az" aria-pressed={t.diagonal === 'az'} onclick={() => set({ diagonal: 'az' })}>Zor</button>
      <button type="button" data-value="normal" aria-pressed={t.diagonal === 'normal'} onclick={() => set({ diagonal: 'normal' })}>Normal</button>
      <button type="button" data-value="cok" aria-pressed={t.diagonal === 'cok'} onclick={() => set({ diagonal: 'cok' })}>Kolay</button>
    </div>
  </div>
  <div class="row stack">
    <span class="label">Yön tuşunun yeri</span>
    <div class="seg" id={id('floating')} role="group" aria-label="Yön tuşunun yeri">
      <button type="button" data-value="fixed" aria-pressed={!t.floating} onclick={() => set({ floating: false })}>Sabit</button>
      <button type="button" data-value="floating" aria-pressed={t.floating} onclick={() => set({ floating: true })}>Parmağın değdiği yer</button>
    </div>
  </div>
  {#if arcade}
    <div class="row stack" id={id('arcade-row')}>
      <span class="label">Arcade düğmeleri</span>
      <div class="seg" id={id('arcade-buttons')} role="group" aria-label="Arcade düğmeleri">
        <button type="button" data-value="game" aria-pressed={t.arcadeButtons === 'game'} onclick={() => set({ arcadeButtons: 'game' })}>Oyundaki kadar</button>
        <button type="button" data-value="all" aria-pressed={t.arcadeButtons === 'all'} onclick={() => set({ arcadeButtons: 'all' })}>Altısı da</button>
      </div>
    </div>
  {/if}
  <div class="row reset-row">
    <button type="button" class="text-btn" id={id('reset')} onclick={() => player.controls.resetTouch()}>Varsayılan ayarlara dön</button>
  </div>
</div>

<style>
  .ts { display: flex; flex-direction: column; }
  .ts > * + * { border-top: 1px solid var(--line-soft); }
  .head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
  .label small { font-weight: 500; color: var(--text-3); font-size: 12px; }
  .note { font-size: 12px; line-height: 1.45; color: var(--text-2); }
  .reset-row { min-height: 52px; }
  .compact .row { min-height: 54px; padding-top: 8px; padding-bottom: 8px; }
  .compact .row.stack { gap: 8px; padding: 10px 14px; }
  .compact .hint { display: none; }
  .compact .seg button { min-height: 38px; }
</style>
