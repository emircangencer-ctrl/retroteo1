export interface ZipEntry { name: string; path: string; size: number; crc: string; encrypted: boolean }
export function readZipDirectory(file: Blob): Promise<ZipEntry[]>;
export function extractRomFilesFromZip(file: Blob): Promise<File[]>;
