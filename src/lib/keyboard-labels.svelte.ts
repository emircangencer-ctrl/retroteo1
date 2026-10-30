import { keyCap } from './key-hints.ts';

// Key caps as printed on this keyboard. Keys are matched by position (KeyboardEvent.code); Chrome
// tells which character each position carries on the current layout (a Turkish F keyboard prints
// other letters there than a Q keyboard), so the hints name the key the player actually sees.
type LayoutMap = { forEach(callback: (value: string, key: string) => void): void };

class KeyboardLabels {
  layout = $state.raw<ReadonlyMap<string, string> | null>(null);
  #loading = false;

  load() {
    if (this.#loading) return;
    this.#loading = true;
    const keyboard = (globalThis.navigator as Navigator & { keyboard?: { getLayoutMap?: () => Promise<LayoutMap> } } | undefined)?.keyboard;
    if (typeof keyboard?.getLayoutMap !== 'function') return;
    keyboard.getLayoutMap().then(map => {
      const layout = new Map<string, string>();
      map.forEach((value, key) => layout.set(key, value));
      this.layout = layout;
    }).catch(() => {});
  }

  cap(code: string): string { return keyCap(code, this.layout); }
}

export const keyboardLabels = new KeyboardLabels();
