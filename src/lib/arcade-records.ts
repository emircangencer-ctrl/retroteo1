// What the library keeps about a recognised arcade set (the full ROM list stays in the catalog).
import type { ArcadeMeta } from './types.ts';

/** Changes whenever the arcade cores or their game lists change: incomplete sets are checked again. */
export const ARCADE_CATALOG_REV = 'fbneo-dedd04f2+fba2012cps2-3fb5b89+mame2003p-3a72dae';

/**
 * FB Alpha 2012 opens a clone's parent zip even when the clone zip holds every file. Stand-in: a
 * zip with one empty file (a zip with no entries makes its loader close the archive twice).
 */
export const STAND_IN_PARENT_ZIP = Uint8Array.from(atob('UEsDBBQAAAAAAAAAIQAAAAAAAAAAAAAAAAAFAAAAZW1wdHlQSwECFAAUAAAAAAAAACEAAAAAAAAAAAAAAAAABQAAAAAAAAAAAAAAAAAAAAAAZW1wdHlQSwUGAAAAAAEAAQAzAAAAIwAAAAAA'), c => c.charCodeAt(0));

export interface IdentifiedArcade {
  core: string;
  set: string;
  status: string;
  missing?: string[];
  different?: string[];
  cps2Key?: boolean;
  parent?: string;
  bios?: string;
  vertical?: boolean;
  manufacturer?: string;
  renamedFrom?: string;
  alternatives?: ArcadeMeta['alternatives'];
  title?: string;
  year?: string | number;
}

export function arcadeRecord(arcade: IdentifiedArcade): ArcadeMeta {
  return {
    checkedWith: ARCADE_CATALOG_REV,
    core: arcade.core,
    set: arcade.set,
    status: arcade.status,
    missing: (arcade.missing || []).slice(0, 20),
    missingCount: (arcade.missing || []).length,
    different: (arcade.different || []).slice(0, 20),
    cps2Key: Boolean(arcade.cps2Key),
    parent: arcade.parent || '',
    bios: arcade.bios || '',
    vertical: Boolean(arcade.vertical),
    manufacturer: arcade.manufacturer || '',
    renamedFrom: arcade.renamedFrom || '',
    alternatives: arcade.alternatives || []
  };
}
