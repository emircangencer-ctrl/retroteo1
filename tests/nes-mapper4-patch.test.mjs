import test from 'node:test';
import assert from 'node:assert/strict';
import { patchMapper4Source } from '../scripts/patch-jsnes-mapper4.mjs';

const upstreamMapperSwitch = [
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

test('MMC3 2KB CHR bank registers ignore bit 0 in both inversion modes', () => {
  const patched = patchMapper4Source(upstreamMapperSwitch);
  assert.match(patched, /const bank0 = arg & 0xfe;/);
  assert.match(patched, /const bank1 = arg & 0xfe;/);
  assert.match(patched, /load1kVromBank\(bank0 \+ 1, 0x0400\)/);
  assert.match(patched, /load1kVromBank\(bank0 \+ 1, 0x1400\)/);
  assert.match(patched, /load1kVromBank\(bank1 \+ 1, 0x0c00\)/);
  assert.match(patched, /load1kVromBank\(bank1 \+ 1, 0x1c00\)/);
  assert.doesNotMatch(patched, /load1kVromBank\(arg \+ 1, 0x(?:0400|1400|0c00|1c00)\)/);
});

test('MMC3 patch is idempotent on repeated installs', () => {
  const once = patchMapper4Source(upstreamMapperSwitch);
  assert.equal(patchMapper4Source(once), once);
});

test('patch fails closed when upstream mapper code is unknown', () => {
  assert.throws(() => patchMapper4Source('class Mapper4 {}'), /Cannot safely patch JSNES mapper4\.js/);
});
