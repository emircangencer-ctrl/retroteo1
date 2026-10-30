export class TouchController {
  constructor(root: HTMLElement, options?: { press?: (input: string) => void; release?: (input: string) => void; vibrate?: ((ms: number) => unknown) | null; now?: () => number });
  setSettings(settings: unknown): void;
  render(layout: unknown): void;
  releaseAll(): void;
}
