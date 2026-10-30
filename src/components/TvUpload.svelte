<script lang="ts">
  // On the TV: game files come from a phone or computer on the same network (QR code + address +
  // 4-digit code), wait in the TV app's inbox and are added through the usual review.
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import QrCode from './QrCode.svelte';
  import { tv } from '../lib/tv.svelte.ts';
  import { TV_APK_URL } from '../lib/tv.ts';
  import { formatBytes } from '../lib/format.ts';

  interface Props { onadd: () => void; busy?: boolean }
  let { onadd, busy = false }: Props = $props();

  onMount(() => {
    tv.openUpload();
    return () => tv.closeUpload();
  });
</script>

<section class="tv-upload" id="tv-upload" aria-labelledby="tv-upload-title">
  <div class="how">
    {#if !tv.bridge}
      <h2 id="tv-upload-title">Telefondan gönder</h2>
      <p>Bu özellik Google TV / Android TV'deki RetroPlay TV uygulamasında çalışır. Uygulama: <a href={TV_APK_URL}>RetroPlayTV.apk</a></p>
    {:else if tv.uploadError}
      <h2 id="tv-upload-title">Telefondan gönder</h2>
      <p class="bad">{tv.uploadError}</p>
      <button type="button" class="btn btn-sm" onclick={() => tv.openUpload()}><Icon name="refresh" size={16} />Tekrar dene</button>
    {:else if tv.upload}
      <div class="qr-wrap"><QrCode text={tv.upload.url} size={168} label="Telefonun kamerasıyla tara" /></div>
      <div class="steps">
        <h2 id="tv-upload-title">Telefondan veya bilgisayardan gönder</h2>
        <ol>
          <li>Telefon ya da bilgisayar TV ile aynı ağda olsun.</li>
          <li>Kodu kamerayla tara ya da tarayıcıda aç: <b class="addr" id="tv-upload-address">{tv.upload.address}</b></li>
          <li>Kod <b class="code" id="tv-upload-code">{tv.upload.code}</b> · dosyaları seç; buraya gelirler.</li>
        </ol>
      </div>
    {:else}
      <p>Yükleme sayfası hazırlanıyor…</p>
    {/if}
  </div>

  {#if tv.bridge}
    <div class="arrived" aria-live="polite">
      <div class="head"><h3>Gelen dosyalar</h3><span class="n">{tv.inbox.length}</span></div>
      {#if tv.inbox.length}
        <ul id="tv-inbox">
          {#each tv.inbox as file (file.id)}
            <li><span class="name">{file.name}</span><span class="size">{formatBytes(file.size)}</span></li>
          {/each}
        </ul>
        <button type="button" class="btn btn-primary btn-block" id="tv-inbox-add" data-nav-default disabled={busy} onclick={onadd}>Gelenleri incele ve ekle ({tv.inbox.length})</button>
      {:else}
        <p class="empty-line">Henüz dosya gelmedi. Gönderdiklerin burada belirir.</p>
      {/if}
    </div>
  {/if}
</section>

<style>
  .tv-upload { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .how, .arrived { display: flex; flex-direction: column; gap: 12px; padding: 16px; border-radius: var(--r-lg); background: var(--surface); border: 1px solid var(--line-soft); }
  .how { flex-direction: row; align-items: center; gap: 18px; }
  .how > p, .how > h2 { margin: 0; }
  .how:has(> p:only-child) { flex-direction: column; align-items: flex-start; }
  .qr-wrap { flex: none; padding: 6px; border-radius: 16px; background: #fff; }
  .steps { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  h2 { font-size: 17px; font-weight: 700; margin: 0; }
  ol { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; font-size: 14px; line-height: 1.45; color: var(--text-2); }
  .addr, .code { font-family: var(--mono); color: var(--text); font-weight: 600; }
  .code { letter-spacing: 0.18em; font-size: 16px; color: var(--accent); }
  .bad { color: #FFB4AD; font-size: 14px; }
  .head { display: flex; align-items: baseline; justify-content: space-between; }
  h3 { margin: 0; font-size: 14px; font-weight: 700; }
  .n { font-family: var(--mono); color: var(--text-2); font-size: 13px; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 160px; overflow-y: auto; }
  ul li { display: flex; justify-content: space-between; gap: 10px; font-size: 13px; padding: 8px 10px; border-radius: 10px; background: #101216; }
  ul li .name { overflow-wrap: anywhere; }
  ul li .size { font-family: var(--mono); color: var(--text-2); white-space: nowrap; }
  .empty-line { margin: 0; font-size: 13px; color: var(--text-2); line-height: 1.5; }
  @media (max-width: 560px) { .how { flex-direction: column; align-items: flex-start; } }
</style>
