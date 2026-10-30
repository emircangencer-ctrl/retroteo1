// Counts how long a game really runs: only while it is running, not paused and the app visible.
// The player takes the counted time every half minute (and on pause, background and exit); a gap
// much longer than that means the device slept without telling the page; at most maxStep counts.

export class PlayClock {
  #since: number | null = null;
  #pending = 0;
  readonly maxStep: number;

  constructor({ maxStep = 90_000 } = {}) { this.maxStep = maxStep; }

  get running(): boolean { return this.#since !== null; }

  start(now: number) { if (this.#since === null) this.#since = now; }

  stop(now: number) {
    if (this.#since === null) return;
    this.#pending += this.#step(now - this.#since);
    this.#since = null;
  }

  /** Returns the time counted since the last call and keeps counting if running. */
  take(now: number): number {
    if (this.#since !== null) {
      this.#pending += this.#step(now - this.#since);
      this.#since = now;
    }
    const total = this.#pending;
    this.#pending = 0;
    return total;
  }

  #step(ms: number): number {
    if (!Number.isFinite(ms) || ms <= 0) return 0;
    return Math.min(ms, this.maxStep);
  }
}
