<script lang="ts">
  // Seri ateş / Basılı tut for this game's buttons: a small picture of the pad, one tap on a button
  // goes Normal → Seri ateş → Basılı tut → Normal. Works with a finger, a controller and the keyboard.
  import { player } from '../player/session.svelte.ts';

  const MODES = [null, 'turbo', 'hold'] as const;
  const NAMES = { turbo: 'Seri ateş', hold: 'Basılı tut' } as const;
  const TAGS = { turbo: 'SERİ', hold: 'BASILI' } as const;
  const buttons = $derived(player.controls.modeButtons);
  const face = $derived(buttons.filter(b => b.kind === 'face'));
  const shoulders = $derived(buttons.filter(b => b.kind === 'shoulder'));
  // Face buttons drawn where they sit on the pad.
  const box = $derived.by(() => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const b of face) { x0 = Math.min(x0, b.x - b.size / 2); x1 = Math.max(x1, b.x + b.size / 2); y0 = Math.min(y0, b.y - b.size / 2); y1 = Math.max(y1, b.y + b.size / 2); }
    if (!face.length) return { x0: 0, y0: 0, w: 1, h: 1, unit: 44 };
    const w = x1 - x0, h = y1 - y0;
    return { x0, y0, w, h, unit: Math.min(46, 220 / w, 124 / h) };
  });
  const modeOf = (input: string) => player.controls.buttonModes[input] || null;
  const next = (input: string) => MODES[(MODES.indexOf(modeOf(input)) + 1) % MODES.length];
  const label = (b: { label: string; aria: string }) => b.label || '';
  const aria = (b: { aria: string; input: string }) => {
    const mode = modeOf(b.input), then = next(b.input);
    return `${b.aria}: ${mode ? NAMES[mode] : 'normal'}. Dokun: ${then ? NAMES[then] : 'normal'}`;
  };
</script>

<div class="bm" id="button-modes">
  {#if shoulders.length}
    <div class="bm-shoulders">
      {#each shoulders as b (b.input)}
        <button type="button" class="bm-btn bm-shoulder" data-input={b.input} data-mode={modeOf(b.input) || undefined} aria-label={aria(b)} onclick={() => player.setButtonMode(b.input, next(b.input))}><span>{label(b)}</span>{#if modeOf(b.input)}<small>{TAGS[modeOf(b.input)!]}</small>{/if}</button>
      {/each}
    </div>
  {/if}
  <div class="bm-face" style="width:{Math.round(box.w * box.unit)}px;height:{Math.round(box.h * box.unit) + 16}px">
    {#each face as b (b.input)}
      {@const d = b.size * box.unit}
      <button type="button" class="bm-btn bm-round" data-input={b.input} data-tone={b.tone} data-mode={modeOf(b.input) || undefined} aria-label={aria(b)} style="left:{Math.round((b.x - box.x0) * box.unit - d / 2)}px;top:{Math.round((b.y - box.y0) * box.unit - d / 2)}px;width:{Math.round(d)}px;height:{Math.round(d)}px" onclick={() => player.setButtonMode(b.input, next(b.input))}><span>{label(b)}</span>{#if modeOf(b.input)}<small>{TAGS[modeOf(b.input)!]}</small>{/if}</button>
    {/each}
  </div>
  <p class="note">Bir düğmeye dokun: <b>Seri ateş</b> (basılı tutunca saniyede 15 kez basar, nişancı oyunları için) → <b>Basılı tut</b> (bir dokunuş basılı bırakır, sonraki bırakır: koşu, gaz) → normal. Bu oyun için hatırlanır; kumanda ve klavyede de geçerli.</p>
</div>

<style>
  .bm { display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .bm-shoulders { display: flex; justify-content: space-between; width: min(100%, 260px); }
  .bm-face { position: relative; margin: 2px auto 0; }
  .bm-btn { position: relative; display: grid; place-items: center; border: 1px solid var(--line); background: var(--bg); color: var(--text); font: 800 14px/1 var(--font); padding: 0; }
  .bm-round { position: absolute; border-radius: 50%; }
  .bm-shoulder { min-width: 76px; height: 36px; border-radius: 10px; }
  /* The pad's own colours, so an unlabelled arcade button is found by its colour and place. */
  .bm-round { color: #fff; border-color: rgba(0, 0, 0, 0.35); }
  .bm-round[data-tone='nes'], .bm-round[data-tone='snes-a'], .bm-round[data-tone='arcade-top'], .bm-round[data-tone='neo-a'] { background: #c9262c; }
  .bm-round[data-tone='snes-x'], .bm-round[data-tone='arcade-bottom'], .bm-round[data-tone='neo-d'] { background: #3f5bcc; }
  .bm-round[data-tone='snes-y'], .bm-round[data-tone='neo-c'] { background: #2b9d59; }
  .bm-round[data-tone='snes-b'], .bm-round[data-tone='neo-b'] { background: #e3ad24; color: #3d2b00; }
  .bm-round[data-tone='md'] { background: #272b34; }
  .bm-round[data-tone='md-small'] { background: #353a45; }
  .bm-btn[data-mode] { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent); }
  .bm-btn[data-mode='hold'] { background: color-mix(in srgb, var(--accent) 22%, var(--bg)); }
  .bm-btn small { position: absolute; left: 50%; bottom: -15px; transform: translateX(-50%); font: 700 9px/1 var(--mono); letter-spacing: 0.6px; color: var(--accent); white-space: nowrap; }
  .bm-shoulder small { bottom: -13px; }
  .note b { color: var(--text); font-weight: 700; }
</style>
