// Every press and every let-go of a button reaches the game, and turbo buttons fire on whole frames.
//
// A core reads its buttons once per frame. A tap whose press and release both land between two
// frames never reaches the game: measured on the real core, a short tap that arrives while the page
// is busy with a slow frame (both events then come one after the other, ~1 ms apart) was missed 20
// times out of 20. Here a button changes at most once every LATCH_FRAMES frames of the core: a
// change that comes sooner waits, in order, for the next frames. Such a tap reaches the game a
// frame or two later instead of not at all; ordinary presses are passed on at once.
//
// Turbo ("Seri ateş"): while held, the button is down for TURBO_ON frames and up for TURBO_OFF
// frames (15 presses a second at 60 frames a second), counted on the core's own frames so every
// press is seen.

/** Frames of the core between two changes of one button (two: also safe when the browser runs
 * between the core reading its input and finishing the frame). */
export const LATCH_FRAMES = 2;
export const TURBO_ON = 2;
export const TURBO_OFF = 2;

export class InputLatch {
  /**
   * send(slot, value): passes a change to the core. frame(): the core's frame counter, or null when
   * it is not known (then every change is passed on at once). schedule(fn): runs fn at the next
   * display frame.
   */
  constructor({ send, frame = () => null, schedule = fn => globalThis.setTimeout(fn, 16) } = {}) {
    this.send = send || (() => {});
    this.frame = frame;
    this.schedule = schedule;
    this.slots = new Map();
    this.turbo = new Set();
    this.ticking = false;
    this.tick = this.tick.bind(this);
  }

  #frame() {
    try { const value = this.frame(); return Number.isFinite(value) ? value : null; } catch { return null; }
  }

  #state(slot) {
    let s = this.slots.get(slot);
    if (!s) { s = { out: 0, at: -Infinity, queue: [], want: 0, firing: false, since: 0 }; this.slots.set(slot, s); }
    return s;
  }

  /** The button in `slot` should be down (1) or up (0). */
  set(slot, value) {
    const s = this.#state(slot);
    const v = value ? 1 : 0;
    s.want = v;
    if (!this.turbo.has(slot)) {
      const last = s.queue.length ? s.queue[s.queue.length - 1] : s.out;
      if (v === last) return;
      // Changes alternate, so dropping the newest waiting one keeps the final state right; more than
      // two changes within two frames are more than a thumb can do.
      if (s.queue.length >= 2) s.queue.pop();
      else s.queue.push(v);
    }
    this.#step(slot, s, this.#frame());
    this.#keepTicking();
  }

  /** Slots whose buttons fire repeatedly while held. */
  setTurbo(slots) {
    const next = new Set(slots);
    const changed = new Set([...this.turbo, ...next].filter(slot => this.turbo.has(slot) !== next.has(slot)));
    this.turbo = next;
    const f = this.#frame();
    for (const slot of changed) {
      const s = this.slots.get(slot);
      if (!s) continue;
      s.firing = false;
      s.queue = s.want !== s.out ? [s.want] : [];
      this.#step(slot, s, f);
    }
    this.#keepTicking();
  }

  #step(slot, s, f) {
    if (f === null) {
      // No frame counter: as before, every change goes straight to the core.
      const target = this.turbo.has(slot) ? s.want : null;
      if (target !== null) { if (target !== s.out) { s.out = target; this.send(slot, target); } return; }
      while (s.queue.length) { const v = s.queue.shift(); s.out = v; this.send(slot, v); }
      return;
    }
    const ready = f - s.at >= LATCH_FRAMES;
    if (this.turbo.has(slot)) {
      let target = 0;
      if (s.want) target = !s.firing ? 1 : (f - s.since) % (TURBO_ON + TURBO_OFF) < TURBO_ON ? 1 : 0;
      else s.firing = false;
      if (target !== s.out && ready) {
        if (target && !s.firing) { s.firing = true; s.since = f; }
        s.out = target; s.at = f; this.send(slot, target);
      }
      return;
    }
    if (s.queue.length && ready) {
      const v = s.queue.shift();
      s.out = v; s.at = f; this.send(slot, v);
    }
  }

  #pending() {
    for (const [slot, s] of this.slots) {
      if (s.queue.length) return true;
      if (this.turbo.has(slot) && (s.want || s.out)) return true;
    }
    return false;
  }

  #keepTicking() {
    if (this.ticking || !this.#pending() || this.#frame() === null) return;
    this.ticking = true;
    this.schedule(this.tick);
  }

  /** One display frame: passes on what may go now. */
  tick() {
    this.ticking = false;
    const f = this.#frame();
    for (const [slot, s] of this.slots) this.#step(slot, s, f);
    this.#keepTicking();
  }

  /** Slots that are down or about to change (to be let go by the caller). */
  active() {
    return [...this.slots].filter(([, s]) => s.out || s.queue.length || s.want).map(([slot]) => slot);
  }

  /** Forgets every button (the caller lets them go in the core). */
  reset() {
    const slots = this.active();
    this.slots.clear();
    return slots;
  }
}
