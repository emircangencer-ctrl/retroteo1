export interface EmulatedSystem {
  platform: string; label: string; shortLabel: string; extensions: readonly string[];
  emulatorJsSystemId: string; emulatorJsCoreId: string; supportsLegacyComparison: boolean;
  actionButtons: ReadonlyArray<{ label: string; input: string; ariaLabel: string }>;
  showSelect: boolean; showStart: boolean; [key: string]: unknown;
}
export const EMULATED_SYSTEMS: Readonly<Record<string, EmulatedSystem>>;
export function getEmulatedSystem(platform: unknown): EmulatedSystem | null;
export function isPlayablePlatform(platform: unknown): boolean;
export function supportsRomExtension(platform: unknown, extension: unknown): boolean;
