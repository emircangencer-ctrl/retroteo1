export interface PlatformInfo { label: string; short: string; logo: string; color: string; glow: string; ext: readonly string[] }
export const PLATFORM: Readonly<Record<string, PlatformInfo>>;
export function platformInfo(key: unknown): PlatformInfo;
