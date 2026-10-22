export const DRIVE_READ_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
export const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
export const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';

export function getDriveClientId(env = import.meta.env) {
  return typeof env?.VITE_GOOGLE_CLIENT_ID === 'string'
    ? env.VITE_GOOGLE_CLIENT_ID.trim()
    : '';
}

export function isDriveFolder(file) {
  return file?.mimeType === DRIVE_FOLDER_MIME;
}

export function isSupportedDriveGame(file) {
  if (!file || isDriveFolder(file) || typeof file.name !== 'string') return false;
  return /\.(nes|sfc|smc|md|gen|bin|z64|n64|v64|cue|iso|zip)$/i.test(file.name);
}

export async function loadGoogleIdentity({
  documentLike = globalThis.document,
  googleLike = () => globalThis.google
} = {}) {
  if (googleLike()?.accounts?.oauth2) return googleLike();
  if (!documentLike?.createElement || !documentLike?.head) {
    throw new Error('Google hesabı bağlantısı bu ortamda kullanılamıyor.');
  }

  await new Promise((resolve, reject) => {
    let script = documentLike.querySelector?.('script[data-retroplay-google-identity]');
    if (script) {
      script.addEventListener('load', resolve, { once: true });
      script.addEventListener('error', () => reject(new Error('Google kimlik kitaplığı yüklenemedi.')), { once: true });
      return;
    }
    script = documentLike.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.retroplayGoogleIdentity = 'true';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Google kimlik kitaplığı yüklenemedi.'));
    documentLike.head.appendChild(script);
  });

  const google = googleLike();
  if (!google?.accounts?.oauth2) throw new Error('Google kimlik kitaplığı başlatılamadı.');
  return google;
}

export function requestDriveAccessToken({ clientId, googleLike = globalThis.google } = {}) {
  if (!clientId) return Promise.reject(new Error('Google Drive bağlantısı yapılandırılmamış. Netlify ortam değişkenine VITE_GOOGLE_CLIENT_ID eklenmeli.'));
  const oauth = googleLike?.accounts?.oauth2;
  if (!oauth?.initTokenClient) return Promise.reject(new Error('Google giriş hizmeti hazır değil.'));

  return new Promise((resolve, reject) => {
    let settled = false;
    const client = oauth.initTokenClient({
      client_id: clientId,
      scope: DRIVE_READ_SCOPE,
      callback: response => {
        if (settled) return;
        settled = true;
        if (response?.error || !response?.access_token) {
          reject(new Error(response?.error_description || response?.error || 'Google Drive erişim izni alınamadı.'));
          return;
        }
        resolve(response.access_token);
      },
      error_callback: error => {
        if (settled) return;
        settled = true;
        reject(new Error(error?.message || error?.type || 'Google giriş penceresi açılamadı.'));
      }
    });
    try {
      client.requestAccessToken();
    } catch (error) {
      settled = true;
      reject(error instanceof Error ? error : new Error('Google Drive bağlantısı başlatılamadı.'));
    }
  });
}

function escapeDriveQueryValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function driveRequest(url, accessToken, fetchImpl) {
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.error?.message || '';
    } catch {}
    if (response.status === 401) throw new Error('Google Drive oturumu sona erdi. Yeniden bağlan.');
    if (response.status === 403) throw new Error(detail || 'Google Drive erişimi reddedildi. İzinleri kontrol et.');
    throw new Error(detail || `Google Drive isteği başarısız (HTTP ${response.status}).`);
  }
  return response;
}

export async function listDriveFiles({
  accessToken,
  folderId = 'root',
  pageToken = '',
  fetchImpl = globalThis.fetch
} = {}) {
  if (!accessToken) throw new Error('Önce Google Drive bağlantısı kur.');
  if (typeof fetchImpl !== 'function') throw new Error('Bu ortamda ağ isteği yapılamıyor.');
  const safeFolderId = escapeDriveQueryValue(folderId || 'root');
  const params = new URLSearchParams({
    q: `'${safeFolderId}' in parents and trashed = false`,
    pageSize: '100',
    orderBy: 'name',
    fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime,capabilities(canDownload))',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true'
  });
  if (pageToken) params.set('pageToken', pageToken);
  const response = await driveRequest(`${DRIVE_API_BASE}/files?${params.toString()}`, accessToken, fetchImpl);
  const payload = await response.json();
  return {
    files: Array.isArray(payload?.files) ? payload.files.filter(file =>
      typeof file?.id === 'string' && typeof file?.name === 'string'
    ) : [],
    nextPageToken: typeof payload?.nextPageToken === 'string' ? payload.nextPageToken : ''
  };
}

export async function downloadDriveFile({
  accessToken,
  fileId,
  maxBytes = 256 * 1024 * 1024,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!accessToken) throw new Error('Önce Google Drive bağlantısı kur.');
  if (typeof fileId !== 'string' || !fileId.trim()) throw new Error('Google Drive dosya kimliği geçersiz.');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('İndirme boyutu sınırı geçersiz.');
  if (typeof fetchImpl !== 'function') throw new Error('Bu ortamda ağ isteği yapılamıyor.');
  const url = `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`;
  const response = await driveRequest(url, accessToken, fetchImpl);
  const reader = response.body?.getReader?.();
  if (!reader) throw new Error('Güvenli akışlı indirme bu tarayıcıda desteklenmiyor.');
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try { await reader.cancel(); } catch {}
        throw new Error(`Dosya boyutu ${maxBytes} bayt indirme sınırını aşıyor.`);
      }
      chunks.push(value);
    }
  } catch (error) {
    try { await reader.cancel(); } catch {}
    throw error;
  }
  return new Blob(chunks, { type: response.headers?.get?.('content-type') || 'application/octet-stream' });
}
