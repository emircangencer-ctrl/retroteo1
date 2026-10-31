export interface EditCallbacks {
  begin?: (group: string) => void;
  move?: (group: string, change: { dx: number; dy: number; scale: number }) => void;
  end?: (group: string) => void;
  selected?: string;
}
export class TouchController {
  constructor(root: HTMLElement, options?: { press?: (input: string) => void; release?: (input: string) => void; vibrate?: ((ms: number) => unknown) | null; now?: () => number });
  setSettings(settings: unknown): void;
  setModes(modes: Partial<Record<string, string>> | null | undefined): void;
  setLocked(names: string[]): void;
  render(layout: unknown): void;
  startEdit(callbacks?: EditCallbacks): void;
  stopEdit(): void;
  releaseAll(): void;
}
