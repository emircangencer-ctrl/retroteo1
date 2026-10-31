// The player's controls: the console pad on touch screens (and the picture's place around it),
// physical controllers with their players, and the keyboard hints of the current game. The session
// (session.svelte.ts) owns the emulator; it hands this part what it needs through ControlsHost.
import { TouchController } from '../touch-controller.js';
import { computeTouchLayout, padSpecFor, adjustLayout, layoutKey, normalizeAdjust, LAYOUT_SCALE } from '../touch-layout.js';
import { normalizeButtonModes, type ButtonModes } from '../emulatorjs-nes-player.js';
import { GamepadPoller, speedShortcut } from '../gamepad-input.js';
import { PadPlayers, playerCount, padName, type PadPlayer } from '../players.js';
import { inspectGamepads, describeGamepads } from '../gamepad-status.js';
import { arcadeLayout } from '../arcade.js';
import { settings, type TouchSettings } from '../lib/settings.svelte.ts';
import { keyHints, type KeyHint } from '../lib/key-hints.ts';
import { keyboardLabels } from '../lib/keyboard-labels.svelte.ts';
import type { Game } from '../lib/types.ts';

/** An arcade game's pad: the core that runs it and the cabinet's controls (MAME's input data). */
export type ArcadePad = { core?: string; buttons?: number; ways?: number; players?: number };

/** What the controls need from the running session. */
export interface ControlsHost {
  readonly open: boolean;
  pressButton(name: string, source: string, player?: number): void;
  releaseButton(name: string, source: string, player?: number): void;
  /** The picture refits its box after a layout change. */
  fitPicture(): void;
  toggleMenu(): void;
  showNotice(text: string, options?: { timeout?: number }): void;
  /** Controller speed shortcuts (R2, L2 held) on consoles. */
  toggleFastForward(): void;
  setRewinding(active: boolean): void;
}

export class PlayerControls {
  touchPlay = $state(false);
  orientation = $state<'portrait' | 'landscape'>('portrait');
  /** Player 1 plays with a controller (the touch pad may step aside). */
  padInUse = $state(false);
  padHidden = $state(false);
  padLayout = $state('nes');
  fourWay = $state(false);
  /** An arcade game: Select is the coin, Start the player-1 start. */
  isArcade = $state(false);
  /** Keyboard keys for the current game's pad (desktop hints). */
  keyHints = $state.raw<KeyHint[]>([]);
  /** Keyboard keys of each player for the current game (desktop hints): player 1, then player 2. */
  keyHintRows = $state.raw<KeyHint[][]>([]);
  /** Several players: how many the game has, and the connected controllers with their players (0 = player 1). */
  players = $state.raw<{ count: number; pads: PadPlayer[] }>({ count: 2, pads: [] });
  /** This game's button modes (Seri ateş / Basılı tut), shown on the pad and in the menu. */
  buttonModes = $state.raw<ButtonModes>({});
  /** The face and shoulder buttons of the current pad, placed as on the pad (button-mode chooser). */
  modeButtons = $state.raw<ModeButton[]>([]);
  /** "Tuşları yerleştir" is open; the group whose size the slider sets, and that size. */
  editing = $state(false);
  editGroup = $state<'dpad' | 'face' | 'system'>('face');
  editScale = $state(1);
  /** The current pad and orientation have a placement of their own. */
  placed = $state(false);
  gamepadState = $state('unknown');
  gamepadText = $state('Gamepad durumu kontrol ediliyor…');

  #host: ControlsHost;
  #modal: HTMLElement | null = null;
  #touchRoot: HTMLElement | null = null;
  #touch: TouchController | null = null;
  #poller: GamepadPoller | null = null;
  #pads = new PadPlayers();
  #playerCount = 2;
  #padSpec = padSpecFor('NES');
  #padSource: { platform: string; game: Game | null; arcade: ArcadePad | null } = { platform: 'NES', game: null, arcade: null };
  #padAspect = 4 / 3;
  #layoutFrame = 0;
  #layout: ReturnType<typeof adjustLayout> | null = null;
  #liveAdjust: ReturnType<typeof normalizeAdjust> | null = null;
  #editBase: ReturnType<typeof normalizeAdjust> | null = null;
  #touchQuery: MediaQueryList | null = typeof matchMedia === 'function' ? matchMedia('(hover: none) and (pointer: coarse)') : null;

  constructor(host: ControlsHost) { this.#host = host; }

  /** How many players the current game has. */
  get playerCount() { return this.#playerCount; }

  mount(modal: HTMLElement, touchRoot: HTMLElement) {
    this.#modal = modal;
    this.#touchRoot = touchRoot;
    this.#touch = new TouchController(touchRoot, {
      press: (input: string) => this.#host.pressButton(input, 'touch'),
      release: (input: string) => this.#host.releaseButton(input, 'touch'),
      vibrate: typeof navigator.vibrate === 'function' ? (ms: number) => navigator.vibrate(ms) : null
    });
    this.#touch.setSettings(settings.touch);
    this.#pads.onJoin = (pad, player) => this.#padJoined(pad, player);
    this.touchPlay = this.isTouchPlay();
    keyboardLabels.load();
    const relayout = () => { if (this.#host.open) { this.releaseTouch(); this.scheduleLayout(); } };
    window.addEventListener('resize', relayout);
    window.visualViewport?.addEventListener('resize', relayout);
    modal.ownerDocument.defaultView?.screen?.orientation?.addEventListener?.('change', relayout);
    this.#touchQuery?.addEventListener?.('change', relayout);
    window.addEventListener('gamepadconnected', () => { this.updateGamepadStatus(); this.#refreshPlayers(); });
    window.addEventListener('gamepaddisconnected', () => {
      this.updateGamepadStatus();
      // A controller that left gives its player back; the touch pad returns when no controller plays player 1.
      this.#pads.sync(connectedPads());
      this.#refreshPlayers();
      if (!this.#playerOneHasPad()) this.#setPadInUse(false);
    });
    window.addEventListener('focus', () => this.updateGamepadStatus());
    this.updateGamepadStatus();
  }

  isTouchPlay(): boolean {
    return Boolean(this.#touchQuery?.matches) || /[?&]touch=1(&|$)/.test(location.search);
  }

  /** Lets go of every touch button (a layout change, the menu, the app going to the background). */
  releaseTouch() { this.#touch?.releaseAll(); }

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
    this.modeButtons = modeButtonsFor(this.#padSpec);
    const root = this.#touchRoot;
    if (root) { root.dataset.platform = platform; root.dataset.layout = this.#padSpec.id; }
    this.applyLayout();
  }

  /** Lays out the player: picture, pad and buttons for the current screen size and orientation. */
  applyLayout() {
    const modal = this.#modal;
    if (!modal || !this.#host.open || !this.#touch) return;
    const touch = this.isTouchPlay();
    this.touchPlay = touch;
    const width = touch ? modal.clientWidth || innerWidth : 393;
    const height = touch ? modal.clientHeight || innerHeight : 873;
    const base = computeTouchLayout({ width, height, safe: touch ? readSafeArea() : {}, aspect: this.#padAspect, spec: this.#padSpec, settings: settings.touch, padHidden: touch && this.padInUse && settings.touch.hideWithGamepad });
    // The player's own placement for this pad and orientation ("Tuşları yerleştir").
    const stored = settings.touch.layouts[layoutKey(this.#padSpec.id, base.orientation)] || null;
    const layout = adjustLayout(base, this.#liveAdjust || stored);
    this.#layout = layout;
    this.placed = Boolean(stored);
    if (this.editing) this.editScale = layout.adjust[this.editGroup].s;
    if (touch) {
      const vars: Record<string, number> = { '--scr-x': layout.screen.x, '--scr-y': layout.screen.y, '--scr-w': layout.screen.w, '--scr-h': layout.screen.h, '--bar-h': layout.chrome.bar.h, '--bar-pad': layout.chrome.bar.padTop };
      for (const [name, value] of Object.entries(vars)) modal.style.setProperty(name, `${value}px`);
      this.orientation = layout.orientation;
      this.padHidden = Boolean(layout.padHidden);
    } else {
      this.padHidden = false;
    }
    this.#touch.setSettings(settings.touch);
    this.#touch.setModes(this.buttonModes);
    this.#touch.render(layout);
    if (!this.#liveAdjust) requestAnimationFrame(() => this.#host.fitPicture());
  }

  // ---- button modes (Seri ateş / Basılı tut) ---------------------------------------------------------
  /** Shows this game's button modes on the pad. */
  setButtonModes(modes: ButtonModes | null | undefined) {
    this.buttonModes = normalizeButtonModes(modes);
    this.#touch?.setModes(this.buttonModes);
  }

  /** Buttons Basılı tut holds right now (they stay lit on the pad). */
  setLocked(names: string[]) { this.#touch?.setLocked(names); }

  // ---- "Tuşları yerleştir" -----------------------------------------------------------------------
  /** Opens the placement editor over the paused game (the menu steps aside). */
  beginEdit() {
    if (!this.touchPlay || !this.#touch || this.editing) return;
    this.editing = true;
    this.#touch.startEdit({
      selected: this.editGroup,
      begin: group => { this.editGroup = group as 'dpad' | 'face' | 'system'; this.#editBase = this.#layout?.adjust || normalizeAdjust(null); },
      move: (group, { dx, dy, scale }) => {
        const base = this.#editBase || normalizeAdjust(null);
        const width = this.#layout?.width || 1, height = this.#layout?.height || 1;
        const g = group as 'dpad' | 'face' | 'system';
        const next = normalizeAdjust({ ...base, [g]: { x: base[g].x + dx / width, y: base[g].y + dy / height, s: base[g].s * scale } });
        this.#liveAdjust = next;
        this.applyLayout();
      },
      end: () => { this.#storePlacement(this.#layout?.adjust || null); }
    });
    this.applyLayout();
  }

  /** Closes the editor (each change was already stored). */
  endEdit() {
    if (!this.editing) return;
    this.editing = false;
    this.#liveAdjust = null;
    this.#editBase = null;
    this.#touch?.stopEdit();
    this.applyLayout();
  }

  /** Size of the selected group (slider in the editor). */
  setEditScale(value: number) {
    const current = this.#layout?.adjust || normalizeAdjust(null);
    const group = this.editGroup === 'system' ? 'face' : this.editGroup;
    const s = Math.min(LAYOUT_SCALE.max, Math.max(LAYOUT_SCALE.min, value));
    this.#storePlacement(normalizeAdjust({ ...current, [group]: { ...current[group], s } }));
  }

  /** Puts this pad back where RetroPlay places it (this orientation). */
  resetPlacement() {
    if (!this.#layout) return;
    const key = layoutKey(this.#padSpec.id, this.#layout.orientation);
    const layouts = { ...settings.touch.layouts };
    delete layouts[key];
    this.#liveAdjust = null;
    settings.setTouch({ layouts });
    this.applyLayout();
  }

  #storePlacement(adjust: ReturnType<typeof normalizeAdjust> | null) {
    this.#liveAdjust = null;
    this.#editBase = null;
    if (adjust && this.#layout) settings.setTouch({ layouts: { ...settings.touch.layouts, [layoutKey(this.#padSpec.id, this.#layout.orientation)]: adjust } });
    this.applyLayout();
  }

  scheduleLayout() {
    if (this.#layoutFrame) return;
    this.#layoutFrame = requestAnimationFrame(() => { this.#layoutFrame = 0; this.applyLayout(); });
  }

  setTouch(patch: Partial<TouchSettings>) {
    settings.setTouch(patch);
    this.#touch?.setSettings(settings.touch);
    if (this.#host.open) this.renderPad(this.#padSource.platform, this.#padSource.game, this.#padSource.arcade);
  }

  resetTouch() {
    settings.resetTouch();
    this.#touch?.setSettings(settings.touch);
    if (this.#host.open) this.renderPad(this.#padSource.platform, this.#padSource.game, this.#padSource.arcade);
  }

  /** The 🎮 chip: show or hide the touch pad while a controller is in use. */
  togglePadWithGamepad() { this.setTouch({ hideWithGamepad: !settings.touch.hideWithGamepad }); }

  // ---- physical controllers ----------------------------------------------------------------------
  /** Physical controllers drive the game directly (positional RetroPad mapping, left stick = d-pad). */
  startGamepad() {
    if (!this.#poller) {
      this.#poller = new GamepadPoller({
        // Each controller is a player, in the order they are connected (players.js).
        playerFor: (pad, active) => this.#pads.playerFor(pad, { active, count: this.#playerCount }),
        onChange: (pressed: string[], released: string[], player: number) => {
          for (const name of released) {
            if (speedShortcut(name, { arcade: this.isArcade }) === 'rewind') this.#host.setRewinding(false);
            else if (!speedShortcut(name, { arcade: this.isArcade })) this.#host.releaseButton(name, 'gamepad', player);
          }
          for (const name of pressed) {
            const shortcut = speedShortcut(name, { arcade: this.isArcade });
            if (shortcut === 'fastForward') this.#host.toggleFastForward();
            else if (shortcut === 'rewind') this.#host.setRewinding(true);
            else this.#host.pressButton(name, 'gamepad', player);
          }
        },
        // Player 1's controller takes over from the touch pad; another player's does not.
        onActivity: (player: number) => { if (player === 0) this.#setPadInUse(true); },
        onMenu: () => this.#host.toggleMenu()
      });
    }
    this.#poller.start();
  }

  stopGamepad() { this.#poller?.stop(); }
  /** Lets go of every held controller button (the app going to the background). */
  releaseGamepad() { this.#poller?.releaseAll(); }

  updateGamepadStatus() {
    const status = inspectGamepads(navigator);
    this.gamepadState = status.state;
    this.gamepadText = describeGamepads(status);
    this.#refreshPlayers();
  }

  // ---- players -----------------------------------------------------------------------------------
  #refreshPlayers() {
    this.players = { count: this.#playerCount, pads: this.#pads.describe(connectedPads(), this.#playerCount) };
  }

  #playerOneHasPad(): boolean {
    return this.#pads.describe(connectedPads(), this.#playerCount).some(pad => pad.player === 0);
  }

  /** A controller got a player: a second one (or more) says who it plays as. */
  #padJoined(pad: { index: number; id: string }, player: number) {
    queueMicrotask(() => this.#refreshPlayers());
    if (player > 0 && player < this.#playerCount) this.#host.showNotice(`Oyuncu ${player + 1} · ${padName(pad)}`, { timeout: 3000 });
  }

  #setPadInUse(active: boolean) {
    if (this.padInUse === active) return;
    this.padInUse = active;
    if (active) this.releaseTouch();
    this.updateGamepadStatus();
    this.scheduleLayout();
  }
}

/** A button of the pad in the button-mode chooser: where it sits (button diameters) and how it looks. */
export interface ModeButton { input: string; label: string; aria: string; tone: string; kind: 'face' | 'shoulder'; x: number; y: number; size: number; side?: string }

/** The pad's face and shoulder buttons for the button-mode chooser (Seri ateş / Basılı tut). */
export function modeButtonsFor(spec: { face: any[]; shoulders: any[] }): ModeButton[] {
  const seen = new Set<string>();
  const out: ModeButton[] = [];
  for (const b of spec.face) {
    if (seen.has(b.input)) continue;
    seen.add(b.input);
    out.push({ input: b.input, label: b.label || '', aria: b.aria || b.label || b.input, tone: b.tone || '', kind: 'face', x: b.x, y: b.y, size: b.size || 1 });
  }
  for (const b of spec.shoulders) {
    if (seen.has(b.input)) continue;
    seen.add(b.input);
    out.push({ input: b.input, label: b.label || '', aria: b.label || b.input, tone: '', kind: 'shoulder', x: 0, y: 0, size: 1, side: b.side });
  }
  return out;
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
