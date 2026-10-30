export interface ArcadeCore { id: string; label: string; systemId: string; catalog: string; opensParentZip?: boolean; supersedes?: string; requiresSimd?: boolean }
export const ARCADE_CORES: Readonly<Record<string, ArcadeCore>>;
export const KNOWN_BIOS_LABELS: Readonly<Record<string, string>>;
export interface ArcadeCatalog { games: Record<string, any[]> }
export function loadCatalog(coreId: string, fetchImpl?: typeof fetch): Promise<ArcadeCatalog>;
export function loadCatalogs(fetchImpl?: typeof fetch): Promise<Record<string, ArcadeCatalog>>;
export function biosOf(catalog: ArcadeCatalog, setName: string): string;
export function onlyKeysMissing(arcade: { missing?: string[]; status?: string } | null | undefined): boolean;
export function isCps2KeyMissing(catalog: unknown, setName: string, missing: string[]): boolean;
export function keyFindings(missing: string[], entries: Array<{ name: string; crc?: string; size?: number }>): { absent: string[]; different: string[] };
export function validateSet(catalog: ArcadeCatalog, setName: string, entries: unknown[]): any;
export function validateBios(catalog: ArcadeCatalog, biosName: string, entries: unknown[]): string[];
export function identifyArcadeZip(fileName: string, entries: unknown[], catalogs: unknown): any;
export function arcadeLayout(arcade: { bios?: string } | null | undefined): 'neogeo' | 'six';
export function describeArcadeStatus(arcade: any, options?: { biosInstalled?: boolean; parentInstalled?: boolean }): string;
export function missingSummary(arcade: any): string;
export function arcadeInputInfo(arcade: any, catalogs: unknown): { buttons: number; ways: number; players: number } | null;
export const ARCADE_INPUT_URL: string;
export function loadArcadeInput(fetchImpl?: typeof fetch): Promise<Record<string, [number, number, number]>>;
export function wasmSimdSupported(wasm?: { validate(bytes: Uint8Array): boolean }): boolean;
export function arcadeCoreSupported(coreId: string, env?: { simd?: boolean }): boolean;
