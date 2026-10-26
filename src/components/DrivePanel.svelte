<script lang="ts">
  // Optional Google Drive source: browse folders read-only and pick files; a picked file joins the
  // import review like any other file. The access token lives only in memory for this visit.
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { getDriveClientId, loadGoogleIdentity, requestDriveAccessToken, listDriveFiles, downloadDriveFile, isDriveFolder, isSupportedDriveGame } from '../google-drive.js';
  import { importer } from '../lib/importer.svelte.ts';
  import { formatBytes, fileExt } from '../lib/format.ts';
  import { showToast } from '../lib/toast.svelte.ts';

  interface DriveFile { id: string; name: string; size?: string | number; mimeType?: string; modifiedTime?: string; capabilities?: { canDownload?: boolean } }

  let status = $state('İsteğe bağlı bulut arşivi · Oyunlar yalnızca seçtiğinde indirilir.');
  let driveState = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  let token = $state('');
  let files = $state<DriveFile[]>([]);
  let stack = $state<Array<{ id: string; name: string }>>([{ id: 'root', name: 'Drive' }]);
  let nextPage = $state('');
  let connecting = $state(false);
  let busy = $state<string>('');
  let generation = 0;
  const configured = Boolean(getDriveClientId());
  const visible = $derived(files.filter(file => isDriveFolder(file) || isSupportedDriveGame(file)));

  onMount(() => {
    // Preload Google Identity before the user clicks so the OAuth popup is opened from a real gesture.
    if (!configured) return;
    connecting = true;
    driveState = 'loading';
    status = 'Google bağlantı hizmeti hazırlanıyor…';
    loadGoogleIdentity().then(() => { connecting = false; driveState = 'ready'; status = 'Google Drive bağlantıya hazır.'; })
      .catch((error: Error) => { driveState = 'error'; status = `${error?.message || 'Google kimlik kitaplığı yüklenemedi.'} Sayfayı yenileyip tekrar dene.`; });
  });

  async function connect() {
    const clientId = getDriveClientId();
    if (!clientId) {
      driveState = 'error';
      status = 'Bağlantı hazır değil. Netlify ortam değişkenlerine VITE_GOOGLE_CLIENT_ID eklenmeli; Google Cloud Console’da Drive API ve OAuth Web istemcisi oluşturulup bu alan adı yetkili JavaScript kaynağına eklenmeli.';
      showToast('Google Drive için OAuth istemci kimliği yapılandırılmalı.', 'error');
      return;
    }
    const google = (globalThis as { google?: { accounts?: { oauth2?: unknown } } }).google;
    if (!google?.accounts?.oauth2) { driveState = 'error'; status = 'Google kimlik kitaplığı hazır değil. Sayfayı yenileyip tekrar dene.'; return; }
    connecting = true;
    driveState = 'loading';
    status = 'Google izin penceresi bekleniyor…';
    // Start the token request directly inside the click gesture (popup blockers).
    const tokenPromise = requestDriveAccessToken({ clientId, googleLike: google });
    try {
      token = await tokenPromise;
      stack = [{ id: 'root', name: 'Drive' }];
      await load('root');
    } catch (error) {
      token = '';
      driveState = 'error';
      status = (error as Error)?.message || 'Google Drive bağlantısı başarısız.';
    } finally { connecting = false; }
  }

  async function load(folderId: string, { append = false } = {}) {
    if (!token) return;
    const run = ++generation;
    driveState = 'loading';
    status = 'Drive klasörü yükleniyor…';
    if (!append) { files = []; nextPage = ''; }
    try {
      const result = await listDriveFiles({ accessToken: token, folderId, pageToken: append ? nextPage : '' });
      if (run !== generation) return;
      files = append ? [...files, ...result.files] : result.files;
      nextPage = result.nextPageToken;
      driveState = 'ready';
      status = `${visible.length} klasör/oyun bulundu. Dosyalar seçilene kadar indirilmez.`;
    } catch (error) {
      if (run !== generation) return;
      driveState = 'error';
      status = (error as Error)?.message || 'Drive klasörü okunamadı.';
    }
  }

  function open(file: DriveFile) { stack = [...stack, { id: file.id, name: file.name || 'Klasör' }]; void load(file.id); }
  function up() { if (stack.length <= 1) return; stack = stack.slice(0, -1); void load(stack[stack.length - 1].id); }

  async function pick(file: DriveFile) {
    if (file.capabilities?.canDownload === false) { showToast('Bu dosyanın indirilmesine Google Drive izin vermiyor.', 'error'); return; }
    const limit = fileExt(file.name) === 'zip' ? 512 * 1024 * 1024 : 256 * 1024 * 1024;
    if (Number(file.size) > limit) { showToast(`Dosya boyutu ${formatBytes(limit)} sınırını aşıyor.`, 'error'); return; }
    busy = file.id;
    status = `İndiriliyor: ${file.name}`;
    try {
      const blob = await downloadDriveFile({ accessToken: token, fileId: file.id, maxBytes: limit });
      if (!blob.size) throw new Error('Drive dosyası boş.');
      const picked = new File([blob], file.name, { type: blob.type || 'application/octet-stream', lastModified: file.modifiedTime ? Date.parse(file.modifiedTime) || Date.now() : Date.now() });
      status = `İndirildi: ${file.name} · incelemeye eklendi`;
      await importer.add([picked], { source: 'Google Drive' });
    } catch (error) {
      status = (error as Error)?.message || 'Dosya indirilemedi.';
      showToast(status, 'error');
    } finally { busy = ''; }
  }
</script>

<section class="drive" aria-labelledby="drive-title" id="drive-import-panel">
  <div class="head">
    <div>
      <strong id="drive-title">Google Drive</strong>
      <p id="drive-status" data-state={driveState} role="status" aria-live="polite">{status}</p>
    </div>
    {#if !token}
      <button type="button" class="btn btn-sm" id="drive-connect" disabled={connecting && configured} onclick={connect}>Drive'a bağlan</button>
    {/if}
  </div>
  {#if token}
    <div class="crumbs">
      {#if stack.length > 1}<button type="button" class="text-btn" id="drive-up" onclick={up}><Icon name="back" size={16} />Üst klasör</button>{/if}
      <span id="drive-breadcrumb">{stack.map(item => item.name).join(' / ')}</span>
    </div>
    <div class="files" id="drive-files" aria-live="polite">
      {#each visible as file (file.id)}
        {@const folder = isDriveFolder(file)}
        <div class="file">
          <Icon name={folder ? 'folder' : 'file'} size={20} />
          <span class="copy"><strong title={file.name}>{file.name}</strong><small>{folder ? 'Klasör' : Number(file.size) > 0 ? formatBytes(Number(file.size)) : 'Oyun dosyası'}</small></span>
          {#if folder}
            <button type="button" class="btn btn-sm" onclick={() => open(file)}>Aç</button>
          {:else}
            <button type="button" class="btn btn-sm" disabled={busy === file.id || file.capabilities?.canDownload === false} onclick={() => pick(file)}>{busy === file.id ? 'İndiriliyor…' : 'Ekle'}</button>
          {/if}
        </div>
      {:else}
        {#if driveState === 'ready'}<p class="none">Bu klasörde desteklenen oyun dosyası veya alt klasör yok.</p>{/if}
      {/each}
      {#if nextPage}<button type="button" class="btn btn-sm more" id="drive-load-more" onclick={() => load(stack[stack.length - 1].id, { append: true })}>Daha fazla</button>{/if}
    </div>
  {/if}
  <p class="privacy">Salt okunur erişim kullanılır. Erişim anahtarı yalnızca bu oturumda bellekte tutulur; dosyalar yalnızca “Ekle” dediğinde bu cihaza indirilir.</p>
</section>

<style>
  .drive { display: flex; flex-direction: column; gap: 12px; padding: 14px; border-radius: var(--r-lg); background: var(--surface); border: 1px solid var(--line-soft); }
  .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .head strong { font-size: 15px; }
  .head p { margin-top: 4px; font-size: 13px; color: var(--text-2); line-height: 1.5; }
  .head p[data-state='error'] { color: var(--danger); }
  .head p[data-state='ready'] { color: #A7DCCC; }
  .crumbs { display: flex; align-items: center; gap: 10px; min-height: 36px; font-size: 13px; color: var(--text-2); }
  #drive-breadcrumb { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .files { display: flex; flex-direction: column; gap: 6px; max-height: 320px; overflow: auto; }
  .file { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: var(--r); background: var(--bg); border: 1px solid var(--line-faint); color: var(--text-2); }
  .copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .copy strong { color: var(--text); font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .copy small { font-size: 12px; }
  .none { font-size: 13px; color: var(--text-3); padding: 8px 2px; }
  .more { align-self: center; }
  .privacy { font-size: 12px; color: var(--text-3); line-height: 1.5; }
</style>
