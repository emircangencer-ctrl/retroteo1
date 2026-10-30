import type { ArcadeCatalog } from './arcade.js';
export const ARCADE_INDEX_URL: string;
export function setBucket(name: string, buckets: number): number;
export function crcBucket(crc: string, buckets: number): number;
export function setUrl(coreId: string, bucket: number): string;
export function crcUrl(coreId: string, bucket: number): string;
export function decodeSet(record: unknown[], chain: unknown[][]): unknown[];
export interface ArcadeCatalogs {
  catalogsFor(fileName: string, entries: unknown[]): Promise<Record<string, ArcadeCatalog>>;
  identify(fileName: string, entries: unknown[]): Promise<any>;
  setCatalog(coreId: string, name: string): Promise<ArcadeCatalog | null>;
}
export function createArcadeCatalogs(fetchImpl?: typeof fetch): ArcadeCatalogs;
export function identifyArcade(fileName: string, entries: unknown[]): Promise<any>;
export function arcadeSetCatalog(coreId: string, name: string): Promise<ArcadeCatalog | null>;
