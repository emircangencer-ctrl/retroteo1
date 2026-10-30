export function sameBytes(a: unknown, b: unknown): boolean;
export function decideSaveRestore(options?: { appBytes?: Uint8Array | null; coreBytes?: Uint8Array | null }): 'in-sync' | 'restore-app' | 'adopt-core' | 'none';
export interface SaveCapture {
  prime(bytes: Uint8Array | null): void;
  capture(reason?: string): Promise<{ status: 'empty' | 'unchanged' | 'saved' | 'failed'; reason: string; error?: unknown; byteLength?: number }>;
  readonly lastBytes: Uint8Array | null;
}
export function createSaveCapture(options: { read: () => Uint8Array | null; persist: (bytes: Uint8Array, reason: string) => Promise<unknown> }): SaveCapture;
