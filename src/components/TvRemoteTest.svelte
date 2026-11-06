<script lang="ts">
  // Settings → Kumanda testi (TV app 1.3+): what the TV's remote and controllers send and where
  // the app sends it. When a remote does not work on some TV, a photo of this says why.
  import { onDestroy } from 'svelte';
  import { tv } from '../lib/tv.svelte.ts';
  import type { TvKey, TvInputDevice } from '../lib/tv.ts';

  let open = $state(false);
  let keys = $state.raw<TvKey[]>([]);
  let devices = $state.raw<TvInputDevice[]>([]);
  let timer: ReturnType<typeof setInterval> | 0 = 0;
  let last = -1;

  function poll() {
    const log = tv.keyLog();
    if (log && log.n !== last) { last = log.n; keys = log.keys.slice(-8).reverse(); }
  }

  function toggle() {
    open = !open;
    if (timer) clearInterval(timer);
    timer = 0;
    if (!open) return;
    devices = tv.inputDevices();
    poll();
    timer = setInterval(poll, 250);
  }

  onDestroy(() => { if (timer) clearInterval(timer); });

  const age = (t: number) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? `${s} sn` : `${Math.round(s / 60)} dk`; };
</script>

<div class="row stack" id="tv-remote-test">
  <span class="label">Kumanda testi</span>
  <p class="hint">Kumandada bir tuşa bas: TV'nin uygulamaya ne gönderdiği ve tuşun nereye gittiği burada görünür. Bir tuş çalışmıyorsa bu ekranın fotoğrafı sorunu gösterir.</p>
  <div class="inline"><button type="button" class="btn btn-sm" id="tv-remote-test-toggle" aria-expanded={open} onclick={toggle}>{open ? 'Testi kapat' : 'Testi aç'}</button></div>
  {#if open}
    <div class="test" id="tv-remote-test-panel">
      <p class="mono head">Aygıtlar</p>
      {#if devices.length}
        <ul class="mono" id="tv-input-devices">
          {#each devices as device, i (i)}<li><b>{device.kind}</b> · {device.name || 'adsız'} · {device.source}{device.virtual ? ' · sanal' : ''}</li>{/each}
        </ul>
      {:else}
        <p class="mono">Aygıt bilgisi yok.</p>
      {/if}
      <p class="mono head">Son tuşlar</p>
      {#if keys.length}
        <ul class="mono" id="tv-key-log">
          {#each keys as key (key.n)}<li><b>{key.key}</b> → {key.route} · {key.device || 'adsız'} · {key.source}{key.gamepadSource ? ' · gamepad kaynağı' : ''}{key.sticks ? ' · çubuk' : ''} · {age(key.t)}</li>{/each}
        </ul>
      {:else}
        <p class="mono" id="tv-key-log-empty">Henüz tuş yok: kumandada bir tuşa bas.</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .inline { display: flex; gap: 8px; }
  .test { margin-top: 6px; padding: 12px 14px; border-radius: var(--r); background: var(--bg); border: 1px solid var(--line); }
  .test ul { list-style: none; margin: 0 0 10px; padding: 0; display: grid; gap: 4px; }
  .test .mono { font-family: var(--mono); font-size: 13px; color: var(--text-2); margin: 0; overflow-wrap: anywhere; }
  .test .head { color: var(--text); font-weight: 700; margin: 4px 0 6px; }
  .test b { color: var(--text); }
</style>
