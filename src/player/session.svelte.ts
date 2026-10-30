// The player: starts a game in EmulatorJS, keeps its saves, the pause menu, the handheld layout
// on phones, physical controllers and play time. Ported from the earlier app.js player with the
// same rules (SRAM backup every 30 s, on pause, background and exit; resume point on exit; the
// unverified-dump consent before any emulator is created; FCEUmm offered, never switched to
// silently) plus Faz 2: save slots with pictures, play time, controller menu navigation.
import { EmulatorJsPlayer } from '../emulatorjs-nes-player.js';
import { getEmulatedSystem, supportsRomExtension } from '../emulator-systems.js';
import { inspectNesRom, diagnoseSuperMarioBros3Rom, isSuperMarioBros3LaunchAllowed } from '../nes-rom.js';
import { emulatorGameId, createBatterySaveRecord } from '../save-data.js';
import { createSaveCapture, decideSaveRestore } from '../save-sync.js';
import { loadArcadeInput, arcadeLayout, arcadeInputInfo, ARCADE_CORES, missingSummary } from '../arcade.js';
import { arcadeSetCatalog } from '../arcade-catalog.js';
import { needsArcadeRecheck } from '../lib/arcade-records.ts';
import { readZipDirectory } from '../zip-rom.js';
import { TouchController } from '../touch-controller.js';
import { computeTouchLayout, padSpecFor } from '../touch-layout.js';
import { GamepadPoller } from '../gamepad-input.js';
import { PadPlayers, playerCount, padName, type PadPlayer } from '../players.js';
import { inspectGamepads, describeGamepads } from '../gamepad-status.js';
import { fullscreenElement, isFullscreen, enterFullscreen, leaveFullscreen } from '../fullscreen.js';
import { displayStart, displayShader, displayLabel, DISPLAY_SCALES } from '../display-modes.js';
import { describeResult, paceWarning, deviceSummary, addToHistory } from '../performance-meter.js';
import * as db from '../lib/db.ts';
import { library } from '../lib/library.svelte.ts';
import { settings, type DisplayChoice, type TouchSettings } from '../lib/settings.svelte.ts';
import { showToast } from '../lib/toast.svelte.ts';
import { gamepadUI } from '../lib/gamepad-ui.svelte.ts';
import { isPlayable } from '../lib/library-view.ts';
import { fileExt } from '../lib/format.ts';
import { shortTitle } from '../lib/title.ts';
import { PlayClock } from '../lib/playtime.ts';
import { importer } from '../lib/importer.svelte.ts';
import { resolveLaunch, rememberCore, type ExtraFile } from './launch.ts';
import { keyHints, PRIMARY_SYSTEM_KEY, type KeyHint } from '../lib/key-hints.ts';
import { keyboardLabels } from '../lib/keyboard-labels.svelte.ts';
import { tv } from '../lib/tv.svelte.ts';
import type { Game, SaveStateRecord, SlotId, SlotInfo } from '../lib/types.ts';

export const SAVE_CAPTURE_INTERVAL_MS = 30_000;
/** RetroArch rewind for the consoles: a state every 2nd frame (Super Nintendo: ~15 % more work per frame). */
export const REWIND_CONFIG = Object.freeze({ rewind_enable: 'true', rewind_granularity: '2' });
export type MenuPanel = 'main' | 'slots' | 'display' | 'controls';
export interface PlayerAction { label: string; run: () => void }
interface StartOptions { coreOverride?: string; fresh?: boolean; slot?: SlotId }

/** An arcade game's pad: the core that runs it and the cabinet's controls (MAME's input data). */
type ArcadePad = { core?: string; buttons?: number; ways?: number; players?: number };
type Player = InstanceType<typeof EmulatorJsPlayer> & { romInfo?: { mapper?: number | null; mapperNumber?: number | null } | null; romDiagnostic?: unknown };

const SLOT_NAMES: Record<SlotId, string> = { auto: 'Devam noktası', quick: 'Hızlı kayıt', '1': 'Yuva 1', '2': 'Yuva 2', '3': 'Yuva 3' };
export const slotName = (slot: SlotId) => SLOT_NAMES[slot];

class PlayerSession {
  open = $state(false);
  gameId = $state<string | null>(null);
  title = $state('Oyun');
  platform = $state('NES');
  status = $state('Hazırlanıyor…');
  error = $state('');
  /** The game is loaded and its emulator runs (or is paused). */
  running = $state(false);
  paused = $state(false);
  menuOpen = $state(false);
  panel = $state<MenuPanel>('main');
  consent = $state<{ detail: string } | null>(null);
  blocked = $state<{ status: string; message: string; action: PlayerAction | null } | null>(null);
  notice = $state<{ text: string; action: PlayerAction | null; id: number } | null>(null);
  canSave = $state(false);
  canLoad = $state(false);
  slots = $state.raw<SlotInfo[]>([]);
  touchPlay = $state(false);
  orientation = $state<'portrait' | 'landscape'>('portrait');
  padInUse = $state(false);
  padHidden = $state(false);
  fullscreen = $state(false);
  fullscreenFallback = $state(false);
  perfRunning = $state(false);
  coreId = $state<string | null>(null);
  coreName = $state('');
  vertical = $state(false);
  padLayout = $state('nes');
  fourWay = $state(false);
  /** An arcade game: Select is the coin, Start the player-1 start. */
  isArcade = $state(false);
  /** Keyboard keys for the current game's pad (desktop hints). */
  keyHints = $state.raw<KeyHint[]>([]);
  /** Several players: how many the game has, and the connected controllers with their players (0 = player 1). */
  players = $state.raw<{ count: number; pads: PadPlayer[] }>({ count: 2, pads: [] });
  /** Fast forward on; the game running backwards (rewind held); whether this game can rewind. */
  fastForward = $state(false);
  rewinding = $state(false);
  canRewind = $state(false);
  /** Keyboard keys of each player for the current game (desktop hints): player 1, then player 2. */
  keyHintRows = $state.raw<KeyHint[][]>([]);
  gamepadState = $state('unknown');
  gamepadText = $state('Gamepad durumu kontrol ediliyor…');
  /** Integer scaling chosen at start (changing it applies on the next start). */
  startedDisplay = $state<DisplayChoice | null>(null);

  #modal: HTMLElement | null = null;
  #screen: HTMLElement | null = null;
  #touchRoot: HTMLElement | null = null;
  #biosInput: HTMLInputElement | null = null;
  #emulator: Player | null = null;
  #session = 0;
  #autoPaused = false;
  #menuPausedGame = false;
  #saveCapture: ReturnType<typeof createSaveCapture> | null = null;
  #saveTimer: ReturnType<typeof setInterval> | 0 = 0;
  #extraFiles: ExtraFile[] = [];
  #touch: TouchController | null = null;
  #poller: GamepadPoller | null = null;
  #pads = new PadPlayers();
  #playerCount = 2;
  #padSpec = padSpecFor('NES');
  #padSource: { platform: string; game: Game | null; arcade: ArcadePad | null } = { platform: 'NES', game: null, arcade: null };
  #padAspect = 4 / 3;
  #layoutFrame = 0;
  #noticeTimer: ReturnType<typeof setTimeout> | 0 = 0;
  #noticeId = 0;
  #consentResolve: ((ok: boolean) => void) | null = null;
  #biosWaitingGameId: string | null = null;
  #clock = new PlayClock();
  #lastShot: { blob: Blob; at: number } | null = null;
  #pausedShot: Blob | null = null;
  #closing: Promise<void> | null = null;
  #navPop: (() => void) | null = null;
  #panelPop: (() => void) | null = null;
  #menuTicket = 0;
  #arcadeNoticeId = 0;
  #touchQuery: MediaQueryList | null = typeof matchMedia === 'function' ? matchMedia('(hover: none) and (pointer: coarse)') : null;

  // ---- set-up ------------------------------------------------------------------------------------
  mount({ modal, screen, touchRoot, biosInput }: { modal: HTMLElement; screen: HTMLElement; touchRoot: HTMLElement; biosInput: HTMLInputElement }) {
    this.#modal = modal;
    this.#screen = screen;
    this.#touchRoot = touchRoot;
    this.#biosInput = biosInput;
    this.#touch = new TouchController(touchRoot, {
      press: (input: string) => this.#emulator?.pressButton?.(input, 'touch'),
      release: (input: string) => this.#emulator?.releaseButton?.(input, 'touch'),
      vibrate: typeof navigator.vibrate === 'function' ? (ms: number) => navigator.vibrate(ms) : null
    });
    this.#touch.setSettings(settings.touch);
    this.#pads.onJoin = (pad, player) => this.#padJoined(pad, player);
    this.touchPlay = this.isTouchPlay();
    keyboardLabels.load();
    const relayout = () => { if (this.open) { this.#touch?.releaseAll(); this.scheduleLayout(); } };
    window.addEventListener('resize', relayout);
    window.visualViewport?.addEventListener('resize', relayout);
    screen.ownerDocument.defaultView?.screen?.orientation?.addEventListener?.('change', relayout);
    this.#touchQuery?.addEventListener?.('change', relayout);
    const onFullscreen = () => {
      if (fullscreenElement(document) !== this.#modal && this.fullscreenFallback) this.#setFallback(false);
      this.fullscreen = isFullscreen(document, this.#modal);
      this.#touch?.releaseAll();
      this.scheduleLayout();
    };
    document.addEventListener('fullscreenchange', onFullscreen);
    document.addEventListener('webkitfullscreenchange', onFullscreen);
    document.addEventListener('visibilitychange', () => { void this.#handleVisibility(); });
    window.addEventListener('pagehide', () => this.#pageHide());
    window.addEventListener('gamepadconnected', () => { this.updateGamepadStatus(); this.#refreshPlayers(); });
    window.addEventListener('gamepaddisconnected', () => {
      this.updateGamepadStatus();
      // A controller that left gives its player back; the touch pad returns when no controller plays player 1.
      this.#pads.sync(connectedPads());
      this.#refreshPlayers();
      if (!this.#playerOneHasPad()) this.#setPadInUse(false);
    });
    window.addEventListener('focus', () => this.updateGamepadStatus());
    biosInput.addEventListener('change', () => {
      const files = biosInput.files ? [...biosInput.files] : [];
      biosInput.value = '';
      if (files.length) void this.#importBiosForGame(files);
    });
    this.updateGamepadStatus();
  }

  isTouchPlay(): boolean {
    return Boolean(this.#touchQuery?.matches) || /[?&]touch=1(&|$)/.test(location.search);
  }

  // ---- notices -----------------------------------------------------------------------------------
  showNotice(text: string, { action = null, timeout = 2200 }: { action?: PlayerAction | null; timeout?: number } = {}) {
    if (this.#noticeTimer) clearTimeout(this.#noticeTimer);
    this.notice = { text, action, id: ++this.#noticeId };
    this.#noticeTimer = setTimeout(() => this.hideNotice(), timeout);
  }

  hideNotice() {
    if (this.#noticeTimer) clearTimeout(this.#noticeTimer);
    this.#noticeTimer = 0;
    this.notice = null;
  }

  /** A message panel over the picture (consent, blocked start, error) takes the controller. */
  #focusPanel(selector: string) {
    this.#panelPop?.();
    gamepadUI.suspend(false);
    this.#panelPop = gamepadUI.push({
      root: () => this.#modal?.querySelector<HTMLElement>(selector) || this.#modal,
      modal: true,
      onAction: action => { if (action.type === 'back') { void this.close(); return true; } return false; }
    });
    setTimeout(() => this.#modal?.querySelector<HTMLElement>(`${selector} [data-nav-default], ${selector} button`)?.focus({ preventScroll: true }), 0);
  }

  #releasePanel() {
    this.#panelPop?.();
    this.#panelPop = null;
  }

  #statusLine(label: string): string {
    const engine = this.#emulator?.engineName || 'Emülatör';
    const info = this.#emulator?.romInfo;
    const mapper = Number.isInteger(info?.mapper) ? ` · Mapper ${info!.mapper}` : Number.isInteger(info?.mapperNumber) ? ` · Mapper ${info!.mapperNumber}` : '';
    return `${label} · ${engine}${mapper}`;
  }

  // ---- start -------------------------------------------------------------------------------------
  async start(id: string, options: StartOptions = {}) {
    if (this.#closing) await this.#closing;
    let game = library.get(id);
    if (!game || !isPlayable(game)) {
      showToast('Bu kayıt için henüz desteklenen bir sistemde oynatılabilir ROM bulunamadı.', 'error');
      return;
    }
    // A set checked with older cores is checked again first (it may start with a better core now).
    if (needsArcadeRecheck(game)) game = await library.recheckArcadeGame(game);
    const session = ++this.#session;
    this.#stopClock();
    void this.#endSaveSession('switch');
    this.#destroyEmulator();
    this.#releaseExtraFiles();

    this.gameId = game.id;
    this.title = shortTitle(game.title);
    this.platform = game.platform;
    this.paused = false;
    this.running = false;
    this.#autoPaused = false;
    this.#lastShot = null;
    this.#pausedShot = null;
    this.status = 'ROM yükleniyor…';
    this.error = '';
    this.blocked = null;
    this.consent = null;
    this.coreId = null;
    this.coreName = '';
    this.canSave = false;
    this.canLoad = false;
    this.slots = [];
    this.hideNotice();
    if (!this.open) {
      this.open = true;
      pushOverlayState('player');
    }
    this.#closeMenuNow();
    this.#releasePanel();
    this.touchPlay = this.isTouchPlay();
    gamepadUI.suspend(true);
    this.updateGamepadStatus();
    this.renderPad(game.platform, game);
    this.#startGamepadInput();
    this.#screen?.replaceChildren();
    // Vertical arcade games (1944, Galaga…) get a portrait picture instead of a small 4:3 box.
    this.vertical = game.platform === 'ARCADE' && Boolean(game.arcade?.vertical);

    try {
      const system = getEmulatedSystem(game.platform) as { shortLabel: string; emulatorJsCoreId: string; emulatorJsSystemId: string } | null;
      if (!system) throw new Error('Bu sistem için emülatör kaydı bulunamadı.');
      const extension = fileExt(game.fileName || game.title);
      if (!supportsRomExtension(game.platform, extension)) throw new Error(`${system.shortLabel} sistemi için desteklenmeyen dosya uzantısı: .${extension || 'bilinmiyor'}`);
      // Arcade zips go to the core as they are (no copy into memory here; sets can be ~100 MB).
      const bytes = game.platform === 'ARCADE' ? null : new Uint8Array(await game.blob!.arrayBuffer());
      const validation = game.platform === 'NES' ? inspectNesRom(bytes) : { valid: game.blob!.size > 0, system: game.platform, mapper: null };
      if (session !== this.#session) return;
      if (!validation.valid) throw new Error(validation.reason || 'ROM başlığı veya dosya uzunluğu geçersiz.');
      const smb3Diagnostic = game.platform === 'NES' ? diagnoseSuperMarioBros3Rom(bytes, `${game.fileName || ''} ${game.title}`, validation) : null;
      let unverifiedDump = false;
      if (!isSuperMarioBros3LaunchAllowed(smb3Diagnostic)) {
        // Not a recognised clean retail dump (often a ROM hack). It is never started silently:
        // the player decides once per game, after being told why graphics may differ.
        const accepted = game.unverifiedDumpAccepted === true || await this.#askConsent(smb3Diagnostic);
        if (session !== this.#session) return;
        if (!accepted) {
          this.#showBlocked('Başlatılmadı · doğrulanmamış döküm', 'Oyun başlatılmadı. Temiz bir Super Mario Bros. 3 kopyası eklersen doğrudan açılır.');
          return;
        }
        if (game.unverifiedDumpAccepted !== true) {
          try { game = (await library.patch(game.id, { unverifiedDumpAccepted: true })) || game; } catch (error) { console.warn('[RetroPlay] Seçim kaydedilemedi:', error); }
        }
        unverifiedDump = true;
      }

      const launch = await resolveLaunch(game, system, options, {
        games: library.games,
        getBios: db.getBios,
        arcadeSetCatalog,
        readZipDirectory,
        forcedNesCore: new URLSearchParams(location.search).get('nescore')
      });
      if (session !== this.#session) { revokeAll(launch.extraFiles); return; }
      if (launch.blocked) {
        // Missing BIOS: offer to add it right here and start the game as soon as it is imported.
        const bios = launch.blocked.bios;
        const gameId = game.id;
        this.#showBlocked(launch.blocked.status, launch.blocked.message, bios ? { label: `${bios} ekle`, run: () => { this.#biosWaitingGameId = gameId; this.#biosInput?.click(); } } : null);
        return;
      }
      this.#extraFiles = launch.extraFiles;

      const reportError = (error: unknown) => {
        if (session !== this.#session) return;
        const message = (error as Error)?.message || String(error || 'Bilinmeyen emülatör hatası');
        this.error = `Oyun motoru hatası: ${message}`;
        this.status = 'Oturum durduruldu';
        this.running = false;
        this.#stopClock();
      };

      // The preferred core starts. If it cannot open the file at all (for example an NES mapper
      // Nestopia lacks), the player is offered the next core instead of switching silently: a core
      // given a file it cannot handle may crash the page, so that is the player's choice.
      const candidate = launch.cores[0];
      if (game.platform === 'ARCADE') {
        let input: { buttons?: number; ways?: number; players?: number } | null = null;
        try { input = arcadeInputInfo(game.arcade, { input: await loadArcadeInput() }); } catch {}
        if (session !== this.#session) { this.#releaseExtraFiles(); return; }
        this.renderPad(game.platform, game, { core: candidate.coreId, buttons: input?.buttons, ways: input?.ways, players: input?.players });
      }
      const display = settings.display;
      const start = displayStart(display);
      const player = new EmulatorJsPlayer(this.#screen, {
        onError: reportError,
        systemId: candidate.systemId,
        coreId: candidate.coreId,
        systemLabel: candidate.label,
        gameId: emulatorGameId(game),
        shader: start.shader,
        // Consoles keep RetroArch's rewind buffer (a state every 2nd frame: about 15 % more work per
        // frame on Super Nintendo, measured); arcade boards' states are too large for it.
        retroarchConfig: { ...start.retroarchConfig, ...(game.platform === 'ARCADE' ? {} : REWIND_CONFIG) },
        extraFiles: launch.extraFiles,
        // Non-fatal runtime messages (for example a denied screen wake lock) are logged only.
        onWarning: (message: string) => console.warn('[RetroPlay] EmulatorJS uyarısı:', message),
        onHotkey: (key: string, pressed?: boolean) => {
          if (key === 'Escape') this.toggleMenu();
          else if (key === 'FastForward' && pressed) this.toggleFastForward();
          else if (key === 'Rewind') this.setRewinding(Boolean(pressed));
        }
      }) as Player;
      this.#emulator = player;
      this.fastForward = false;
      this.rewinding = false;
      this.canRewind = player.supportsRewind?.() ?? false;
      this.startedDisplay = { ...display };
      player.romInfo = validation;
      player.romDiagnostic = smb3Diagnostic;
      try {
        await player.loadROM(bytes || game.blob, candidate.gameName || launch.gameName);
      } catch (error) {
        if (session !== this.#session) { player.destroy(); return; }
        const next = launch.cores[1];
        if ((error as { code?: string })?.code !== 'content-not-loaded' || !next) throw error;
        player.destroy();
        this.#emulator = null;
        this.#releaseExtraFiles();
        const gameId = game.id;
        this.#showBlocked(`${candidate.name} bu oyunu açamadı`, `${candidate.name} bu dosyayı açamadı. ${next.name} ile denemek ister misin? Seçimin bu oyun için hatırlanır.`, { label: `${next.name} ile dene`, run: () => { void this.start(gameId, { coreOverride: next.coreId }); } });
        return;
      }
      if (session !== this.#session) { player.destroy(); return; }
      const used = candidate;
      if (options.coreOverride) {
        const remembered = rememberCore(game, used.coreId);
        try { await library.save(remembered); game = remembered; } catch (error) { console.warn('[RetroPlay] Çekirdek seçimi kaydedilemedi:', error); }
        this.showNotice(`${used.name} ile açıldı · bu oyun için hatırlandı`, { timeout: 4000 });
      }
      const saveSync = await this.#syncSaveOnStart(game, player);
      if (session !== this.#session) { player.destroy(); return; }
      if (saveSync.ok) this.#beginSaveSession(game, player, saveSync.primed);
      else this.error = `${saveSync.reason}. Mevcut kaydın korunması için bu oturumda oyun içi kayıt yedeği alınmıyor.`;
      this.coreId = used.coreId;
      this.coreName = used.name;
      player.setVolume?.(settings.prefs.volume);
      // Where to begin: a chosen slot, the resume point, or the beginning.
      const canStates = player.supportsStates?.() !== false && typeof player.saveState === 'function';
      this.canSave = canStates;
      await this.refreshSlots();
      if (session !== this.#session) { player.destroy(); return; }
      let resumed = false;
      if (options.slot) resumed = await this.#loadSlotInto(game, player, options.slot, { notice: true });
      else if (!options.fresh && settings.prefs.autoResume) resumed = await this.#resumeFromAutoState(game, player);
      if (unverifiedDump && !resumed) this.showNotice('Doğrulanmamış döküm · grafikler orijinalden farklı olabilir', { timeout: 4000 });
      if (session !== this.#session) { player.destroy(); return; }
      // Arcade games wait for a coin. Without a touch pad, say which keys insert it and start.
      if (game.platform === 'ARCADE' && !this.isTouchPlay() && !resumed && !this.notice) this.#showArcadeKeys();
      else if (tv.active && !this.notice) this.showNotice('Oyun menüsü: kumandanın Geri tuşu', { timeout: 3500 });

      this.running = true;
      this.status = this.#statusLine('Çalışıyor');
      // RetroPlay draws its own bar and menu; EmulatorJS's own menus stay hidden.
      player.setImmersive?.(true);
      this.#clock.start(performance.now());
      try { await library.patch(game.id, { lastPlayed: Date.now() }); } catch (error) { console.warn('[RetroPlay] Son oynama kaydedilemedi:', error); }
      this.scheduleLayout();
    } catch (error) {
      if (session !== this.#session) return;
      void this.#endSaveSession('error');
      this.#destroyEmulator();
      this.running = false;
      this.status = 'Başlatılamadı';
      const message = String((error as Error)?.message || error).replace(/[.\s]+$/, '');
      this.error = game.platform === 'ARCADE'
        ? `Arcade seti açılamadı: ${message}. ${game.arcade?.status === 'incomplete' ? `Set bu çekirdek sürümüyle uyuşmuyor (${missingSummary(game.arcade)}): ${(game.arcade.missing || []).slice(0, 5).join(', ')}. ${(ARCADE_CORES as Record<string, { label: string }>)[game.arcade.core]?.label || ''} için doğru ROM seti sürümünü kullan.` : 'Set ve BIOS dosyalarını kontrol et.'}`
        : `Bu ROM çalıştırılamadı: ${message}. ROM biçimi ve mapper desteği kontrol edilmeli.`;
      showToast('Oyun başlatılamadı. Ayrıntı oynatıcı penceresinde.', 'error');
      this.#focusPanel('.player-fail');
    }
  }

  #showArcadeKeys() {
    if (tv.active) {
      this.showNotice('Kontrolcüde Select jeton atar, Start başlatır · menü: Geri tuşu', { timeout: 7000 });
      this.#arcadeNoticeId = this.notice?.id ?? 0;
      return;
    }
    const coin = keyboardLabels.cap(PRIMARY_SYSTEM_KEY.arcade.BUTTON_SELECT);
    const start = keyboardLabels.cap(PRIMARY_SYSTEM_KEY.arcade.BUTTON_START);
    const two = this.#playerCount > 1 ? ` · 2. oyuncu ${keyboardLabels.cap(PRIMARY_SYSTEM_KEY.player2.BUTTON_SELECT)} / ${keyboardLabels.cap(PRIMARY_SYSTEM_KEY.player2.BUTTON_START)}` : '';
    const pad = gamepadUI.connected ? ' · kumandada Select / Start' : '';
    this.showNotice(`Jeton: ${coin} · Başla: ${start}${two}${pad}`, { action: { label: 'Jeton at', run: () => this.tapInput('BUTTON_SELECT') }, timeout: 9000 });
    this.#arcadeNoticeId = this.notice?.id ?? 0;
  }

  /** Jeton / Başla from the pause menu: the menu closes, the game resumes, then the press. */
  async tapFromMenu(name: 'BUTTON_SELECT' | 'BUTTON_START') {
    await this.closeMenu();
    // The emulator needs a frame or two after resuming before it reads input.
    setTimeout(() => this.tapInput(name), 120);
  }

  /** Jeton / Başla from the bar or a notice: a short press the game is sure to see (for the player of the screen or keyboard). */
  tapInput(name: 'BUTTON_SELECT' | 'BUTTON_START'): boolean {
    if (!this.running || this.paused || !this.#emulator) return false;
    return this.#emulator.tapButton?.(name) ?? false;
  }

  #showBlocked(status: string, message: string, action: PlayerAction | null = null) {
    this.status = status;
    this.error = '';
    this.running = false;
    this.canSave = false;
    this.canLoad = false;
    this.blocked = { status, message, action };
    this.#focusPanel('.player-blocked');
  }

  /** Runs a blocked screen's action (BIOS ekle, FCEUmm ile dene …). */
  runBlockedAction() {
    const action = this.blocked?.action;
    if (action) action.run();
  }

  async #importBiosForGame(files: File[]) {
    const waiting = this.#biosWaitingGameId;
    this.#biosWaitingGameId = null;
    const result = await importer.importDirect(files);
    if (result.bios) showToast(`${result.bios} BIOS dosyası eklendi.`);
    else showToast(result.failed ? 'BIOS eklenemedi.' : 'Seçilen dosya bir BIOS olarak tanınmadı.', 'error');
    const game = library.get(waiting);
    if (waiting && waiting === this.gameId && this.open && game?.arcade?.bios && library.biosIds.has(`${game.arcade.bios}.zip`)) void this.start(waiting);
  }

  #askConsent(diagnostic: unknown): Promise<boolean> {
    this.#consentResolve?.(false);
    const d = diagnostic as { payloadCrc32?: number; mapper?: number; message?: string } | null;
    const crc = Number.isInteger(d?.payloadCrc32) ? (d!.payloadCrc32! >>> 0).toString(16).toUpperCase().padStart(8, '0') : '';
    this.status = 'Onayın bekleniyor';
    this.consent = { detail: crc ? `PRG+CHR CRC32 ${crc}${Number.isInteger(d?.mapper) ? ` · Mapper ${d!.mapper}` : ''}` : String(d?.message || '') };
    this.#focusPanel('#player-consent');
    return new Promise(resolve => {
      this.#consentResolve = ok => { this.#consentResolve = null; this.consent = null; this.#releasePanel(); gamepadUI.suspend(true); resolve(ok); };
    });
  }

  answerConsent(ok: boolean) { this.#consentResolve?.(ok); }

  // ---- battery saves (SRAM) ----------------------------------------------------------------------
  /**
   * Loads the app-owned battery save into the core when it differs from what EmulatorJS loaded,
   * or adopts the emulator's own copy when the app has none yet. ok=false means an existing app
   * save could not be loaded; capturing is then disabled so that copy is never overwritten.
   */
  async #syncSaveOnStart(game: Game, player: Player): Promise<{ ok: boolean; primed: Uint8Array | null; reason?: string }> {
    let record = null;
    try { record = await db.getBatterySave(game.id); } catch (error) { console.warn('[RetroPlay] Kayıt okunamadı:', error); return { ok: false, primed: null, reason: 'Kayıt veritabanı okunamadı' }; }
    const appBytes = record?.bytes ? (record.bytes instanceof Uint8Array ? record.bytes : new Uint8Array(record.bytes)) : null;
    const coreBytes = player.readSaveData({ flush: false });
    const decision = decideSaveRestore({ appBytes, coreBytes });
    if (decision === 'restore-app') {
      let restored = false;
      try { restored = player.writeSaveData(appBytes) && player.restartGame(); } catch (error) { console.warn('[RetroPlay] Kayıt geri yüklenemedi:', error); }
      return restored ? { ok: true, primed: appBytes } : { ok: false, primed: null, reason: 'Kayıt emülatöre yüklenemedi' };
    }
    if (decision === 'adopt-core') {
      try { if (await this.#persistBattery(game, coreBytes)) library.noteSave(game.id); } catch (error) { console.warn('[RetroPlay] Emülatör kaydı uygulamaya alınamadı:', error); }
      return { ok: true, primed: coreBytes };
    }
    if (decision === 'in-sync') return { ok: true, primed: appBytes };
    // No save anywhere yet: remember the initial SRAM so only real in-game saves are stored.
    return { ok: true, primed: player.readSaveData({ flush: true }) };
  }

  async #persistBattery(game: Game, bytes: Uint8Array | null): Promise<boolean> {
    const record = createBatterySaveRecord(game, { bytes, updatedAt: Date.now() }, getEmulatedSystem(game.platform)?.emulatorJsSystemId);
    if (!record) return false;
    await db.putBatterySave(record);
    return true;
  }

  #beginSaveSession(game: Game, player: Player, primed: Uint8Array | null) {
    this.#saveCapture = createSaveCapture({
      read: () => (this.#emulator === player ? player.readSaveData({ flush: true }) : null),
      persist: (bytes: Uint8Array) => this.#persistBattery(game, bytes).then(saved => { if (saved) library.noteSave(game.id); return saved; })
    });
    this.#saveCapture.prime(primed);
    if (this.#saveTimer) clearInterval(this.#saveTimer);
    this.#saveTimer = setInterval(() => {
      if (!this.paused && document.visibilityState === 'visible') {
        void this.#captureSave('interval');
        void this.#flushPlaytime();
      }
    }, SAVE_CAPTURE_INTERVAL_MS);
  }

  /** Copies the live SRAM out of the core synchronously, then persists it asynchronously. */
  #captureSave(reason: string) {
    if (!this.#saveCapture) return Promise.resolve(null);
    return this.#saveCapture.capture(reason).then(result => {
      if (result?.status === 'failed' && this.open) this.error = `Oyun içi kayıt yerel yedeğe yazılamadı: ${(result.error as Error)?.message || result.error}`;
      return result;
    });
  }

  #endSaveSession(reason: string) {
    const pending = this.#captureSave(reason);
    if (this.#saveTimer) { clearInterval(this.#saveTimer); this.#saveTimer = 0; }
    this.#saveCapture = null;
    return pending;
  }

  // ---- play time ---------------------------------------------------------------------------------
  #stopClock() { this.#clock.stop(performance.now()); void this.#flushPlaytime(); }

  async #flushPlaytime() {
    const id = this.gameId;
    const ms = this.#clock.take(performance.now());
    if (!id || ms <= 0) return;
    const game = library.get(id);
    if (!game) return;
    try { await library.patch(id, { playtimeMs: (Number(game.playtimeMs) || 0) + ms }); } catch (error) { console.warn('[RetroPlay] Oyun süresi kaydedilemedi:', error); }
  }

  // ---- save states (slots) -----------------------------------------------------------------------
  async refreshSlots() {
    const id = this.gameId;
    if (!id) { this.slots = []; return; }
    let slots: SlotInfo[] = [];
    try { slots = await db.listSlots(id); } catch (error) { console.warn('[RetroPlay] Kayıt noktaları okunamadı:', error); }
    if (id !== this.gameId) return;
    this.slots = slots;
    const quick = slots.find(s => s.slot === 'quick');
    this.canLoad = Boolean(quick && quick.coreId === this.coreId && this.coreId);
  }

  slotInfo(slot: SlotId): SlotInfo | null { return this.slots.find(s => s.slot === slot) || null; }

  /** The state of the running game as a record; the picture is added when one is ready. */
  #takeState(slot: SlotId): { record: SaveStateRecord; game: Game } | null {
    const game = library.get(this.gameId);
    const player = this.#emulator;
    if (!game || !this.coreId || typeof player?.saveState !== 'function') return null;
    const bytes = player.saveState();
    if (!bytes) return null;
    return { game, record: { id: db.stateKey(game.id, slot), gameId: game.id, slot, platform: game.platform, coreId: this.coreId, bytes, byteLength: bytes.byteLength, createdAt: Date.now(), thumb: null } };
  }

  /** A picture for a state taken now: exact while paused (taken when the pause began), drawn by the core otherwise. */
  async #pictureNow(timeout = 1200): Promise<Blob | null> {
    if (this.paused) return this.#pausedShot || this.#recentShot();
    const shot = await this.#emulator?.screenshot?.({ timeout }).catch(() => null);
    if (shot) this.#lastShot = { blob: shot, at: Date.now() };
    return shot || null;
  }

  #recentShot(maxAge = 5 * 60_000): Blob | null {
    return this.#lastShot && Date.now() - this.#lastShot.at <= maxAge ? this.#lastShot.blob : null;
  }

  async saveToSlot(slot: SlotId): Promise<boolean> {
    if (!this.#emulator || !this.open || !this.canSave) return false;
    const taken = this.#takeState(slot);
    if (!taken) { this.showNotice('Kayıt noktası alınamadı'); return false; }
    const { game, record } = taken;
    if (this.paused) record.thumb = this.#pausedShot || this.#recentShot();
    try {
      await db.putSaveState(record);
    } catch (error) {
      console.warn('[RetroPlay] Kayıt noktası yazılamadı:', error);
      this.showNotice('Kayıt noktası yazılamadı');
      return false;
    }
    library.noteSlot(game.id, slot);
    this.showNotice(slot === 'quick' ? 'Kaydedildi' : `${slotName(slot)} kaydedildi`);
    if (!record.thumb) {
      const shot = await this.#pictureNow();
      if (shot) { try { await db.attachStateThumb(game.id, slot, record.createdAt, shot); } catch {} }
    }
    await this.refreshSlots();
    return true;
  }

  async loadSlot(slot: SlotId): Promise<boolean> {
    const game = library.get(this.gameId);
    if (!game || !this.#emulator) return false;
    const ok = await this.#loadSlotInto(game, this.#emulator, slot, { notice: true });
    return ok;
  }

  async #loadSlotInto(game: Game, player: Player, slot: SlotId, { notice = false } = {}): Promise<boolean> {
    let record: SaveStateRecord | null = null;
    try { record = await db.getSaveState(game.id, slot); } catch {}
    if (!record?.bytes) { if (notice) this.showNotice(slot === 'quick' ? 'Henüz kayıt noktası yok' : `${slotName(slot)} boş`); return false; }
    if (record.coreId !== this.coreId) {
      if (notice) this.showNotice(`Bu kayıt başka bir çekirdekle alınmış (${record.coreId || 'bilinmiyor'}); bu oturumda yüklenemez`, { timeout: 4000 });
      return false;
    }
    if (!player.loadState(record.bytes)) { if (notice) this.showNotice('Kayıt noktası yüklenemedi'); return false; }
    // The paused picture is now the loaded moment (a save made right after gets the same picture).
    if (this.paused) this.#pausedShot = record.thumb instanceof Blob ? record.thumb : null;
    if (notice) this.showNotice(slot === 'quick' ? 'Kayıt noktası yüklendi' : `${slotName(slot)} yüklendi`);
    return true;
  }

  async deleteSlot(slot: SlotId) {
    const id = this.gameId;
    if (!id) return;
    try { await db.deleteSaveState(id, slot); library.noteSlot(id, slot, false); } catch (error) { showToast(`Silinemedi: ${(error as Error)?.message || error}`, 'error'); }
    await this.refreshSlots();
  }

  quickSave() { return this.saveToSlot('quick'); }

  async quickLoad() {
    const game = library.get(this.gameId);
    if (!game || !this.#emulator?.loadState) return;
    await this.#loadSlotInto(game, this.#emulator, 'quick', { notice: true });
  }

  /** Continues from where the player last left this game (same core only). */
  async #resumeFromAutoState(game: Game, player: Player): Promise<boolean> {
    let resume: SaveStateRecord | null = null;
    try { resume = await db.getSaveState(game.id, 'auto'); } catch (error) { console.warn('[RetroPlay] Kayıt noktaları okunamadı:', error); }
    if (!resume?.bytes || resume.coreId !== this.coreId) return false;
    if (!player.loadState(resume.bytes)) return false;
    this.showNotice('Kaldığın yerden devam ediliyor', { action: { label: 'Baştan başla', run: () => this.restartFromBeginning() }, timeout: 7000 });
    return true;
  }

  restartFromBeginning() {
    if (!this.#emulator?.restartGame?.()) return;
    this.showNotice('Oyun baştan başladı');
  }

  /** The resume point taken synchronously (safe right before teardown); stored asynchronously. */
  #storeAuto(thumb: Blob | null): Promise<boolean> {
    if (!settings.prefs.autoResume) return Promise.resolve(false);
    const taken = this.#takeState('auto');
    if (!taken) return Promise.resolve(false);
    taken.record.thumb = thumb;
    return db.putSaveState(taken.record).then(() => { library.noteSlot(taken.game.id, 'auto'); return true; }).catch(error => {
      console.warn('[RetroPlay] Kayıt noktası yazılamadı:', error);
      return false;
    });
  }

  // ---- pause and the menu ------------------------------------------------------------------------
  async #pause({ picture = true, stillWanted = () => true }: { picture?: boolean; stillWanted?: () => boolean } = {}) {
    const player = this.#emulator;
    if (!player || !this.running || this.paused) return;
    this.#stopSpeedModes();
    if (picture) {
      const shot = await player.screenshot?.({ timeout: 400 }).catch(() => null);
      // The menu may have closed while the picture was taken: then the game keeps running.
      if (player !== this.#emulator || this.paused || !stillWanted()) return;
      if (shot) this.#lastShot = { blob: shot, at: Date.now() };
      this.#pausedShot = shot || this.#recentShot();
    } else {
      this.#pausedShot = this.#recentShot();
    }
    try {
      await player.pause();
      this.paused = true;
      this.status = this.#statusLine('Duraklatıldı');
      this.#clock.stop(performance.now());
      void this.#captureSave('pause');
      void this.#flushPlaytime();
    } catch (error) {
      this.error = `Duraklatma/devam hatası: ${(error as Error)?.message || error}`;
    }
  }

  async #resume() {
    const player = this.#emulator;
    if (!player || !this.paused) return;
    try {
      await player.resume();
      this.paused = false;
      this.#autoPaused = false;
      this.#pausedShot = null;
      this.status = this.#statusLine('Çalışıyor');
      if (document.visibilityState === 'visible') this.#clock.start(performance.now());
    } catch (error) {
      this.error = `Duraklatma/devam hatası: ${(error as Error)?.message || error}`;
    }
  }

  togglePause() { return this.paused ? this.#resume() : this.#pause(); }

  openMenu() {
    if (this.menuOpen || !this.open) return;
    this.menuOpen = true;
    this.panel = 'main';
    // The coin hint's "Jeton at" cannot act on a paused game.
    if (this.notice && this.notice.id === this.#arcadeNoticeId) this.hideNotice();
    this.#touch?.releaseAll();
    this.#poller?.stop();
    gamepadUI.suspend(false);
    this.#navPop?.();
    this.#navPop = gamepadUI.push({ root: () => this.#modal?.querySelector<HTMLElement>('#player-menu') || null, modal: true, onAction: action => this.#menuAction(action.type) });
    void this.refreshSlots();
    if (this.running && !this.paused) {
      const ticket = ++this.#menuTicket;
      this.#menuPausedGame = true;
      void this.#pause({ stillWanted: () => this.menuOpen && this.#menuTicket === ticket });
    }
  }

  #menuAction(type: string): boolean {
    if (type === 'back') { this.menuBack(); return true; }
    if (type === 'start' || type === 'guide') { void this.closeMenu(); return true; }
    return false;
  }

  /** B / back: a sub-panel goes back to the menu, the menu closes. */
  menuBack() {
    if (this.panel !== 'main') { this.panel = 'main'; return; }
    void this.closeMenu();
  }

  #closeMenuNow() {
    this.#menuTicket++;
    this.menuOpen = false;
    this.panel = 'main';
    this.#menuPausedGame = false;
    this.#navPop?.();
    this.#navPop = null;
  }

  async closeMenu() {
    if (!this.menuOpen) return;
    const resume = this.#menuPausedGame;
    this.#closeMenuNow();
    gamepadUI.suspend(true);
    if (this.open) this.#startGamepadInput();
    if (resume && this.paused) await this.#resume();
  }

  toggleMenu() { if (this.menuOpen) void this.closeMenu(); else this.openMenu(); }

  setPanel(panel: MenuPanel) { this.panel = panel; }

  // ---- leaving -----------------------------------------------------------------------------------
  close({ viaHistory = false } = {}): Promise<void> {
    if (!this.open) return Promise.resolve();
    if (this.#closing) return this.#closing;
    const wasOpen = this.open;
    this.#consentResolve?.(false);
    this.#touch?.releaseAll();
    this.#stopGamepadInput();
    const running = this.running && !this.paused && Boolean(this.#emulator);
    this.#closeMenuNow();
    this.#releasePanel();
    this.#clock.stop(performance.now());
    // Read the resume point and SRAM before the emulator goes away; the writes continue afterwards.
    const takenAuto = settings.prefs.autoResume ? this.#takeState('auto') : null;
    const pendingSave = this.#endSaveSession('close');
    const player = this.#emulator;
    const knownShot = this.paused ? this.#pausedShot || this.#recentShot() : null;
    this.#closing = (async () => {
      let shot = knownShot;
      // While playing, the core draws the picture for the resume point (one or two frames).
      if (!shot && running && player) shot = (await player.screenshot?.({ timeout: 300 }).catch(() => null)) || this.#recentShot();
      const pendingState = takenAuto
        ? db.putSaveState({ ...takenAuto.record, thumb: shot }).then(() => { library.noteSlot(takenAuto.game.id, 'auto'); return true; }).catch(() => false)
        : Promise.resolve(false);
      this.hideNotice();
      this.#session += 1;
      void this.#flushPlaytime();
      this.#destroyEmulator();
      this.coreId = null;
      this.running = false;
      this.paused = false;
      this.#autoPaused = false;
      this.#releaseExtraFiles();
      if (isFullscreen(document, this.#modal)) void leaveFullscreen(document);
      if (this.fullscreenFallback) this.#setFallback(false);
      this.open = false;
      this.blocked = null;
      this.consent = null;
      this.error = '';
      this.#screen?.replaceChildren();
      this.gameId = null;
      gamepadUI.suspend(false);
      if (wasOpen && !viaHistory) leaveOverlayState('player');
      await Promise.all([pendingState, pendingSave]);
    })().finally(() => { this.#closing = null; });
    return this.#closing;
  }

  /** Browser back while playing: the menu closes first, then the game. */
  handlePopState(): boolean {
    if (!this.open) return false;
    if (this.menuOpen) { void this.closeMenu(); pushOverlayState('player'); return true; }
    void this.close({ viaHistory: true });
    return true;
  }

  #pageHide() {
    if (!this.#emulator) return;
    const thumb = this.paused ? this.#pausedShot || this.#recentShot() : this.#recentShot();
    void this.#storeAuto(thumb);
    void this.#endSaveSession('pagehide');
    this.#clock.stop(performance.now());
    void this.#flushPlaytime();
    this.#destroyEmulator();
  }

  /** Backgrounding (app switch, screen off) saves and pauses; returning resumes an auto-pause. */
  async #handleVisibility() {
    this.updateGamepadStatus();
    if (!this.#emulator || !this.open) return;
    try {
      if (document.visibilityState === 'hidden') {
        this.#touch?.releaseAll();
        this.#poller?.releaseAll();
        void this.#captureSave('hidden');
        void this.#storeAuto(this.paused ? this.#pausedShot || this.#recentShot() : this.#recentShot());
        this.#clock.stop(performance.now());
        void this.#flushPlaytime();
        if (!this.paused && this.running) {
          await this.#pause({ picture: false });
          this.#autoPaused = true;
        }
      } else if (this.#autoPaused) {
        this.#autoPaused = false;
        if (!this.menuOpen) await this.#resume();
      }
    } catch (error) {
      console.warn('[RetroPlay] Arka plan duraklatma hatası:', error);
    }
  }

  // ---- speed: fast forward and rewind --------------------------------------------------------------
  /** ⏩ in the bar or Space: fast forward on or off. */
  toggleFastForward() {
    if (!this.running || this.paused || !this.#emulator) return;
    const next = !this.fastForward;
    if (this.#emulator.setFastForward?.(next)) this.fastForward = next;
  }

  /** ⏪ held in the bar or Backspace held: the game runs backwards. */
  setRewinding(active: boolean) {
    if (active && (!this.running || this.paused || !this.canRewind)) return;
    if (!active && !this.rewinding) return;
    if (this.#emulator?.setRewind?.(active)) this.rewinding = active;
    else this.rewinding = false;
  }

  #stopSpeedModes() {
    if (this.rewinding) { try { this.#emulator?.setRewind?.(false); } catch {} }
    this.rewinding = false;
  }

  #destroyEmulator() {
    this.#stopSpeedModes();
    this.fastForward = false;
    this.canRewind = false;
    if (!this.#emulator) return;
    try { this.#emulator.destroy(); } catch {}
    this.#emulator = null;
  }

  #releaseExtraFiles() { revokeAll(this.#extraFiles); this.#extraFiles = []; }

  // ---- display, sound, performance ---------------------------------------------------------------
  setDisplay(patch: Partial<DisplayChoice>) {
    settings.setDisplay(patch);
    const display = settings.display;
    if (!this.#emulator?.setShader || !this.open) return;
    this.#emulator.setShader(displayShader(display));
    const integerNow = DISPLAY_SCALES[display.scale as keyof typeof DISPLAY_SCALES].integer;
    const integerAtStart = this.startedDisplay ? DISPLAY_SCALES[this.startedDisplay.scale as keyof typeof DISPLAY_SCALES].integer : integerNow;
    const label = displayLabel(display);
    this.showNotice(integerNow !== integerAtStart ? `Görüntü: ${label} · tam sayı ölçek oyun yeniden açılınca değişir` : `Görüntü: ${label}`, { timeout: integerNow !== integerAtStart ? 3500 : 1600 });
  }

  setVolume(volume: number) {
    settings.setPrefs({ volume });
    this.#emulator?.setVolume?.(settings.prefs.volume);
  }

  /** Runs the performance meter on the running game and keeps the result for Settings. */
  async runPerformanceTest() {
    const game = library.get(this.gameId);
    const player = this.#emulator;
    if (!game || this.perfRunning || typeof player?.benchmark !== 'function') return;
    if (this.menuOpen) await this.closeMenu();
    if (this.paused) { this.showNotice('Ölçüm için önce oyunu devam ettir'); return; }
    this.perfRunning = true;
    this.showNotice('Performans ölçülüyor… yaklaşık 7 saniye', { timeout: 9000 });
    try {
      const normalFps = await player.measurePace({ ms: 2000 });
      const result = this.#emulator === player ? await player.benchmark({ seconds: 4 }) : null;
      if (this.#emulator !== player) return;
      if (!result) { this.showNotice('Performans ölçülemedi'); return; }
      const entry = { at: Date.now(), title: game.title, platform: game.platform, core: this.coreId || '', headroom: result.headroom, fps: result.fps, normalFps, ...deviceSummary() };
      addToHistory(entry);
      const warning = paceWarning(normalFps);
      this.showNotice(warning ? `${describeResult(entry)} · ${warning}` : describeResult(entry), { timeout: 10000 });
    } finally {
      this.perfRunning = false;
    }
  }

  // ---- fullscreen --------------------------------------------------------------------------------
  #setFallback(active: boolean) {
    this.fullscreenFallback = active;
    if (active) showToast('Geniş ekran görünümü açıldı. Tarayıcı tam ekran API’sini desteklemediği için adres çubuğu gizlenmeyebilir.');
    this.scheduleLayout();
  }

  async toggleFullscreen() {
    const modal = this.#modal;
    if (!modal || !this.open) return;
    if (this.menuOpen) await this.closeMenu();
    if (this.fullscreenFallback) { this.#setFallback(false); return; }
    if (isFullscreen(document, modal)) {
      const result = await leaveFullscreen(document);
      if (result.error) showToast('Tam ekrandan çıkılamadı. Esc tuşunu deneyebilirsin.', 'error');
      return;
    }
    const result = await enterFullscreen(modal, document);
    if (!result.supported) {
      // The player already fills the window; only the browser bars stay.
      if (this.touchPlay) { this.showNotice('Bu tarayıcı tam ekranı desteklemiyor'); return; }
      this.#setFallback(true);
      return;
    }
    if (result.error || !result.entered) {
      if (this.touchPlay) { this.showNotice('Tarayıcı tam ekrana izin vermedi'); return; }
      this.#setFallback(true);
      return;
    }
    this.fullscreen = true;
    this.scheduleLayout();
  }

  // ---- the handheld layout -----------------------------------------------------------------------
  /**
   * Chooses the console's pad (and the picture shape) for the game about to start. Arcade:
   * `arcade` = { core, buttons, ways, players } — the core that runs it and the cabinet's controls.
   */
  renderPad(platform: string, game: Game | null = null, arcade: ArcadePad | null = null) {
    this.#padSource = { platform, game, arcade };
    this.#playerCount = playerCount(platform, arcade);
    this.#refreshPlayers();
    this.#padSpec = padSpecFor(platform, platform === 'ARCADE' ? arcadeLayout(game?.arcade) : 'six', arcade, settings.touch);
    this.#padAspect = platform === 'ARCADE' && game?.arcade?.vertical ? 3 / 4 : 4 / 3;
    this.padLayout = this.#padSpec.id;
    this.fourWay = Boolean(this.#padSpec.fourWay);
    this.isArcade = platform === 'ARCADE';
    const systemId = platform === 'MD' ? 'segaMD' : platform.toLowerCase();
    this.keyHints = keyHints(this.#padSpec, { arcade: this.isArcade, systemId });
    this.keyHintRows = this.#playerCount > 1 ? [this.keyHints, keyHints(this.#padSpec, { arcade: this.isArcade, systemId, player: 1 })] : [this.keyHints];
    const root = this.#touchRoot;
    if (root) { root.dataset.platform = platform; root.dataset.layout = this.#padSpec.id; }
    this.applyLayout();
  }

  /** Lays out the player: picture, pad and buttons for the current screen size and orientation. */
  applyLayout() {
    const modal = this.#modal;
    if (!modal || !this.open || !this.#touch) return;
    const touch = this.isTouchPlay();
    this.touchPlay = touch;
    const width = touch ? modal.clientWidth || innerWidth : 393;
    const height = touch ? modal.clientHeight || innerHeight : 873;
    const layout = computeTouchLayout({ width, height, safe: touch ? readSafeArea() : {}, aspect: this.#padAspect, spec: this.#padSpec, settings: settings.touch, padHidden: touch && this.padInUse && settings.touch.hideWithGamepad });
    if (touch) {
      const vars: Record<string, number> = { '--scr-x': layout.screen.x, '--scr-y': layout.screen.y, '--scr-w': layout.screen.w, '--scr-h': layout.screen.h, '--bar-h': layout.chrome.bar.h, '--bar-pad': layout.chrome.bar.padTop };
      for (const [name, value] of Object.entries(vars)) modal.style.setProperty(name, `${value}px`);
      this.orientation = layout.orientation;
      this.padHidden = Boolean(layout.padHidden);
    } else {
      this.padHidden = false;
    }
    this.#touch.setSettings(settings.touch);
    this.#touch.render(layout);
    requestAnimationFrame(() => { try { this.#emulator?.fitInParent?.(); } catch {} });
  }

  scheduleLayout() {
    if (this.#layoutFrame) return;
    this.#layoutFrame = requestAnimationFrame(() => { this.#layoutFrame = 0; this.applyLayout(); });
  }

  setTouch(patch: Partial<TouchSettings>) {
    settings.setTouch(patch);
    this.#touch?.setSettings(settings.touch);
    if (this.open) this.renderPad(this.#padSource.platform, this.#padSource.game, this.#padSource.arcade);
  }

  resetTouch() {
    settings.resetTouch();
    this.#touch?.setSettings(settings.touch);
    if (this.open) this.renderPad(this.#padSource.platform, this.#padSource.game, this.#padSource.arcade);
  }

  // ---- physical controllers ----------------------------------------------------------------------
  /** Physical controllers drive the game directly (positional RetroPad mapping, left stick = d-pad). */
  #startGamepadInput() {
    if (!this.#poller) {
      this.#poller = new GamepadPoller({
        // Each controller is a player, in the order they are connected (players.js).
        playerFor: (pad, active) => this.#pads.playerFor(pad, { active, count: this.#playerCount }),
        onChange: (pressed: string[], released: string[], player: number) => {
          for (const name of released) this.#emulator?.releaseButton?.(name, 'gamepad', player);
          for (const name of pressed) this.#emulator?.pressButton?.(name, 'gamepad', player);
        },
        // Player 1's controller takes over from the touch pad; another player's does not.
        onActivity: (player: number) => { if (player === 0) this.#setPadInUse(true); },
        onMenu: () => this.toggleMenu()
      });
    }
    this.#poller.start();
  }

  #stopGamepadInput() { this.#poller?.stop(); }

  // ---- players ---------------------------------------------------------------------------------
  #refreshPlayers() {
    this.players = { count: this.#playerCount, pads: this.#pads.describe(connectedPads(), this.#playerCount) };
  }

  #playerOneHasPad(): boolean {
    return this.#pads.describe(connectedPads(), this.#playerCount).some(pad => pad.player === 0);
  }

  /** A controller got a player: a second one (or more) says who it plays as. */
  #padJoined(pad: { index: number; id: string }, player: number) {
    queueMicrotask(() => this.#refreshPlayers());
    if (player > 0 && player < this.#playerCount) this.showNotice(`Oyuncu ${player + 1} · ${padName(pad)}`, { timeout: 3000 });
  }

  #setPadInUse(active: boolean) {
    if (this.padInUse === active) return;
    this.padInUse = active;
    if (active) this.#touch?.releaseAll();
    this.updateGamepadStatus();
    this.scheduleLayout();
  }

  /** The 🎮 chip: show or hide the touch pad while a controller is in use. */
  togglePadWithGamepad() { this.setTouch({ hideWithGamepad: !settings.touch.hideWithGamepad }); }

  updateGamepadStatus() {
    const status = inspectGamepads(navigator);
    this.gamepadState = status.state;
    this.gamepadText = describeGamepads(status);
    this.#refreshPlayers();
  }
}

/** Connected controllers (the TV app's bridge included). */
function connectedPads(): Array<{ index: number; id: string; connected?: boolean }> {
  try { return typeof navigator.getGamepads === 'function' ? ([...navigator.getGamepads()].filter(Boolean) as Array<{ index: number; id: string; connected?: boolean }>) : []; } catch { return []; }
}

let safeAreaProbe: HTMLDivElement | null = null;
function readSafeArea() {
  if (!safeAreaProbe) {
    safeAreaProbe = document.createElement('div');
    safeAreaProbe.setAttribute('aria-hidden', 'true');
    safeAreaProbe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.appendChild(safeAreaProbe);
  }
  const style = getComputedStyle(safeAreaProbe);
  return { top: parseFloat(style.paddingTop) || 0, right: parseFloat(style.paddingRight) || 0, bottom: parseFloat(style.paddingBottom) || 0, left: parseFloat(style.paddingLeft) || 0 };
}

function revokeAll(files: ExtraFile[] | undefined) {
  for (const file of files || []) { try { URL.revokeObjectURL(file.url); } catch {} }
}

export function pushOverlayState(kind: string) {
  try { history.pushState({ retroplayOverlay: kind }, ''); } catch {}
}
export function leaveOverlayState(kind: string) {
  try { if (history.state?.retroplayOverlay === kind) history.back(); } catch {}
}

export const player = new PlayerSession();
