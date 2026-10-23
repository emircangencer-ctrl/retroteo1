import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const mapperPath = resolve(scriptDir, '../node_modules/jsnes/src/mappers/mapper4.js');

const bank0Old = [
  '      case Mapper4.CMD_SEL_2_1K_VROM_0000:',
  '        // Select 2 1KB VROM pages at 0x0000:',
  '        if (this.chrAddressSelect === 0) {',
  '          this.load1kVromBank(arg, 0x0000);',
  '          this.load1kVromBank(arg + 1, 0x0400);',
  '        } else {',
  '          this.load1kVromBank(arg, 0x1000);',
  '          this.load1kVromBank(arg + 1, 0x1400);',
  '        }',
  '        break;',
].join('\n');
const bank0New = [
  '      case Mapper4.CMD_SEL_2_1K_VROM_0000: {',
  '        // MMC3 R0 selects an aligned 2KB CHR bank; bit 0 is ignored by hardware.',
  '        const bank0 = arg & 0xfe;',
  '        if (this.chrAddressSelect === 0) {',
  '          this.load1kVromBank(bank0, 0x0000);',
  '          this.load1kVromBank(bank0 + 1, 0x0400);',
  '        } else {',
  '          this.load1kVromBank(bank0, 0x1000);',
  '          this.load1kVromBank(bank0 + 1, 0x1400);',
  '        }',
  '        break;',
  '      }',
].join('\n');

const bank1Old = [
  '      case Mapper4.CMD_SEL_2_1K_VROM_0800:',
  '        // Select 2 1KB VROM pages at 0x0800:',
  '        if (this.chrAddressSelect === 0) {',
  '          this.load1kVromBank(arg, 0x0800);',
  '          this.load1kVromBank(arg + 1, 0x0c00);',
  '        } else {',
  '          this.load1kVromBank(arg, 0x1800);',
  '          this.load1kVromBank(arg + 1, 0x1c00);',
  '        }',
  '        break;',
].join('\n');
const bank1New = [
  '      case Mapper4.CMD_SEL_2_1K_VROM_0800: {',
  '        // MMC3 R1 selects an aligned 2KB CHR bank; bit 0 is ignored by hardware.',
  '        const bank1 = arg & 0xfe;',
  '        if (this.chrAddressSelect === 0) {',
  '          this.load1kVromBank(bank1, 0x0800);',
  '          this.load1kVromBank(bank1 + 1, 0x0c00);',
  '        } else {',
  '          this.load1kVromBank(bank1, 0x1800);',
  '          this.load1kVromBank(bank1 + 1, 0x1c00);',
  '        }',
  '        break;',
  '      }',
].join('\n');

export function patchMapper4Source(source) {
  let result = source;
  for (const [label, original, patched] of [
    ['MMC3 R0', bank0Old, bank0New],
    ['MMC3 R1', bank1Old, bank1New],
  ]) {
    const oldCount = result.split(original).length - 1;
    const newCount = result.split(patched).length - 1;
    if (oldCount === 1 && newCount === 0) {
      result = result.replace(original, patched);
    } else if (oldCount === 0 && newCount === 1) {
      // Already patched: this makes postinstall repeatable.
    } else {
      throw new Error(
        'Cannot safely patch JSNES mapper4.js (' + label + '): expected exactly one known upstream block or its patched equivalent. Check the pinned JSNES version before changing this patch.',
      );
    }
  }
  return result;
}

async function main() {
  let source;
  try {
    source = await readFile(mapperPath, 'utf8');
  } catch (error) {
    throw new Error(
      'Pinned dependency jsnes@2.1.0 mapper source was not found at ' + mapperPath +
      '. Install dependencies before running the compatibility patch. Original error: ' + error.message,
    );
  }
  const result = patchMapper4Source(source);
  if (result !== source) {
    await writeFile(mapperPath, result, 'utf8');
    process.stdout.write('Applied RetroPlay MMC3 CHR bank alignment patch to jsnes@2.1.0.\n');
  } else {
    process.stdout.write('RetroPlay MMC3 CHR bank alignment patch already present.\n');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
