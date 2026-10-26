export function crc32(input: Uint8Array | ArrayBuffer): number;
export function identifySuperMarioBros3Release(inspection: unknown, payloadCrc32: number | null): { label: string; region: string; payloadCrc32: number } | null;
export function diagnoseSuperMarioBros3Rom(input: Uint8Array | ArrayBuffer | null, name: string, inspection?: unknown): any;
export function isSuperMarioBros3LaunchAllowed(diagnostic: unknown): boolean;
export function inspectNesRom(input: Uint8Array | ArrayBuffer | null, options?: { totalSize?: number }): { valid: boolean; reason?: string; mapper?: number | null; [key: string]: any };
