// TV mode: on in the RetroPlay TV app (Android TV / Google TV) or with ?tv=1 in a browser.
import { readBridge, detectTv, createGamepadSource, padKeys, parseJson, INBOX_URL, type TvBridge, type TvInfo, type InboxFile, type UploadInfo } from './tv.ts';

const INBOX_POLL_MS = 2000;

class TvMode {
  /** The page shows the TV layout and the remote moves the focus. */
  readonly active: boolean;
  /** The TV app's bridge (null in a browser, also with ?tv=1). */
  readonly bridge: TvBridge | null;
  info = $state.raw<TvInfo | null>(null);
  inbox = $state.raw<InboxFile[]>([]);
  upload = $state.raw<UploadInfo | null>(null);
  uploadError = $state('');
  #inboxTimer: ReturnType<typeof setInterval> | 0 = 0;
  #started = false;

  constructor() {
    this.bridge = typeof window === 'undefined' ? null : readBridge(window);
    this.active = typeof window === 'undefined' ? false : detectTv(window as never);
  }

  /** Called once at boot, before anything reads controllers. */
  start() {
    if (this.#started || !this.active) return;
    this.#started = true;
    const root = document.documentElement;
    root.classList.add('tv');
    // TV WebViews are about 960×540 CSS px; narrower ones are scaled to that width so the TV
    // layout (sidebar, large picture) always applies.
    if (window.innerWidth < 960) document.querySelector('meta[name="viewport"]')?.setAttribute('content', 'width=960, user-scalable=no');
    if (!this.bridge) return;
    this.info = parseJson<TvInfo | null>(this.bridge.info(), null);
    installGamepadShim(this.bridge);
    // Shows up in the TV's log (adb logcat -s RetroPlayTV) for diagnosing a device.
    console.info(`[RetroPlayTV] ready ${innerWidth}x${innerHeight}@${devicePixelRatio} app ${this.info?.versionName || '?'}`);
  }

  refreshInbox() {
    if (!this.bridge) return;
    this.inbox = parseJson<InboxFile[]>(this.bridge.inbox(), []);
  }

  /** The upload page for phones and computers; polls for arriving files while shown. */
  openUpload() {
    if (!this.bridge) return;
    const result = parseJson<Partial<UploadInfo> & { error?: string }>(this.bridge.startUpload(), { error: 'Yükleme sayfası açılamadı.' });
    if (result.error || !result.url) { this.upload = null; this.uploadError = result.error || 'Yükleme sayfası açılamadı.'; }
    else { this.upload = result as UploadInfo; this.uploadError = ''; }
    this.refreshInbox();
    if (!this.#inboxTimer) this.#inboxTimer = setInterval(() => this.refreshInbox(), INBOX_POLL_MS);
  }

  closeUpload() {
    if (this.#inboxTimer) clearInterval(this.#inboxTimer);
    this.#inboxTimer = 0;
    try { this.bridge?.stopUpload(); } catch {}
    this.upload = null;
  }

  /** The files sent to the TV, as File objects for the import review. */
  async inboxFiles(list: InboxFile[] = this.inbox): Promise<Array<File & { inboxId?: string }>> {
    const files: Array<File & { inboxId?: string }> = [];
    for (const entry of list) {
      const response = await fetch(`${INBOX_URL}${encodeURIComponent(entry.id)}`, { cache: 'no-store' });
      if (!response.ok) continue;
      const file = new File([await response.blob()], entry.name, { lastModified: entry.time || Date.now() }) as File & { inboxId?: string };
      file.inboxId = entry.id;
      files.push(file);
    }
    return files;
  }

  removeFromInbox(ids: string[]) {
    if (!this.bridge) return;
    for (const id of ids) { try { this.bridge.inboxDelete(id); } catch {} }
    this.refreshInbox();
  }

  keepScreenOn(on: boolean) {
    try { this.bridge?.setKeepScreenOn(on); } catch {}
  }

  exit() {
    try { this.bridge?.exit(); } catch {}
  }
}

/** navigator.getGamepads() reads the TV app's controller bridge; connections fire the usual events. */
function installGamepadShim(bridge: TvBridge) {
  const source = createGamepadSource(bridge);
  const getGamepads = () => source();
  try { Object.defineProperty(Navigator.prototype, 'getGamepads', { configurable: true, writable: true, value: getGamepads }); }
  catch { try { (navigator as unknown as { getGamepads: typeof getGamepads }).getGamepads = getGamepads; } catch {} }
  let keys = padKeys(source());
  setInterval(() => {
    const pads = source();
    const next = padKeys(pads);
    if (next === keys) return;
    const more = next.split('|').filter(Boolean).length > keys.split('|').filter(Boolean).length;
    keys = next;
    window.dispatchEvent(new Event(more ? 'gamepadconnected' : 'gamepaddisconnected'));
  }, 400);
}

export const tv = new TvMode();
