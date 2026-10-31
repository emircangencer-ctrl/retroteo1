// Records kept in IndexedDB (database "retroplay-local-v1", version 4). Fields added in Faz 2 are
// optional, so records written by earlier versions stay valid and nothing is migrated.

export interface ArcadeChoice { core: string; set?: string; status?: string }

export interface ArcadeMeta {
  checkedWith?: string;
  core: string;
  set: string;
  status: string; // complete | needs-parent | incomplete
  missing: string[];
  missingCount?: number;
  different?: string[];
  cps2Key?: boolean;
  parent?: string;
  bios?: string;
  vertical?: boolean;
  manufacturer?: string;
  renamedFrom?: string;
  alternatives?: ArcadeChoice[];
}

export interface RomValidation {
  valid: boolean;
  reason?: string;
  mapper?: number | null;
  mapperNumber?: number | null;
  [key: string]: unknown;
}

export interface Game {
  id: string;
  title: string;
  platform: string;
  year?: number | null;
  genre?: string;
  arcade?: ArcadeMeta;
  symbol?: string;
  coverBg?: string;
  coverGlow?: string;
  fileName?: string;
  size?: number;
  sizeLabel?: string;
  contentHash?: string | null;
  blob?: Blob;
  romValidation?: RomValidation | null;
  addedAt?: number;
  favorite?: boolean;
  demo?: boolean;
  playable?: boolean;
  status?: string;
  lastPlayed?: number;
  nesCore?: string;
  /** NES / Mega Drive: the core chosen for this game ("… ile dene"), when it is not the default. */
  consoleCore?: string;
  unverifiedDumpAccepted?: boolean;
  restoredMetadataOnly?: boolean;
  // Faz 2
  /** Total time the game ran (not paused, app visible), in milliseconds. */
  playtimeMs?: number;
  /** CRC32 of the ROM file as 8 upper-case hex digits (computed on demand for files ≤ 16 MB). */
  crc32?: string;
}

/** auto = where the player left off; quick = Hızlı kaydet; 1–3 = save slots. */
export type SlotId = 'auto' | 'quick' | '1' | '2' | '3';
export const SLOT_IDS: readonly SlotId[] = Object.freeze(['auto', 'quick', '1', '2', '3']);
export const MANUAL_SLOTS: readonly SlotId[] = Object.freeze(['1', '2', '3']);

export interface SaveStateRecord {
  id: string;
  gameId: string;
  slot: SlotId;
  platform: string;
  coreId: string | null;
  bytes: Uint8Array;
  byteLength: number;
  createdAt: number;
  /** Faz 2: picture of the game at that moment (PNG from the core), if one could be taken. */
  thumb?: Blob | null;
}

/** What the library needs to know about a stored state without loading its bytes. */
export interface SlotInfo { slot: SlotId; createdAt: number; coreId: string | null; byteLength: number; thumb: Blob | null }

export interface BatterySaveRecord {
  id: string;
  gameId: number;
  platform: string;
  systemId: string;
  contentHash: string | null;
  saveHash: string;
  bytes: Uint8Array;
  byteLength: number;
  updatedAt: number;
}

export interface BiosRecord {
  id: string;
  set: string;
  label: string;
  fileName: string;
  size: number;
  blob: Blob;
  missing: string[];
  addedAt: number;
}
