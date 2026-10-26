import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes, relativeTime, slotTime, lastPlayedLabel, lastPlayedShort, formatPlaytime, titleFromFileName, safeFilename, fileExt, dayDistance, hex32 } from '../src/lib/format.ts';

const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();

test('sizes use Turkish decimals', () => {
  assert.equal(formatBytes(0), '—');
  assert.equal(formatBytes(-5), '—');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1,5 KB');
  assert.equal(formatBytes(1468006), '1,4 MB');
  assert.equal(formatBytes(5.2 * 1024 ** 3), '5,2 GB');
});

test('relative times read like the design ("14 dk önce", "Dün")', () => {
  const now = at(2026, 10, 26, 15, 0);
  assert.equal(relativeTime(now - 20_000, now), 'az önce');
  assert.equal(relativeTime(now - 14 * 60_000, now), '14 dk önce');
  assert.equal(relativeTime(at(2026, 10, 26, 11, 30), now), '3 sa önce');
  assert.equal(relativeTime(at(2026, 10, 25, 23, 50), now), 'Dün');
  assert.equal(relativeTime(at(2026, 10, 22), now), '4 gün önce');
  assert.match(relativeTime(at(2026, 9, 1), now), /^1 Eyl/);
  assert.match(relativeTime(at(2025, 9, 1), now), /2025/);
  assert.equal(relativeTime(0, now), '');
  assert.equal(dayDistance(at(2026, 10, 25, 23, 59), at(2026, 10, 26, 0, 1)), 1, 'calendar days, not 24-hour blocks');
});

test('save times: "Bugün 22:41", "Dün 22:41", "3 gün önce"', () => {
  const now = at(2026, 10, 26, 23, 0);
  assert.equal(slotTime(now - 5 * 60_000, now), '5 dk önce');
  assert.equal(slotTime(at(2026, 10, 26, 9, 5), now), 'Bugün 09:05');
  assert.equal(slotTime(at(2026, 10, 25, 22, 41), now), 'Dün 22:41');
  assert.equal(slotTime(at(2026, 10, 23), now), '3 gün önce');
});

test('last played and play time', () => {
  const now = at(2026, 10, 26, 15);
  assert.equal(lastPlayedLabel(undefined, now), '');
  assert.equal(lastPlayedLabel(at(2026, 10, 26, 9), now), 'Bugün oynandı');
  assert.equal(lastPlayedLabel(at(2026, 10, 25, 9), now), 'Dün oynandı');
  assert.equal(lastPlayedLabel(at(2026, 10, 21), now), '5 gün önce oynandı');
  assert.equal(lastPlayedShort(null, now), '—');
  assert.equal(lastPlayedShort(at(2026, 10, 25, 9), now), 'Dün');
  assert.equal(formatPlaytime(undefined), '—');
  assert.equal(formatPlaytime(30_000), "1 dk'dan az");
  assert.equal(formatPlaytime(42 * 60_000), '42 dk');
  assert.equal(formatPlaytime((3 * 60 + 12) * 60_000), '3 sa 12 dk');
  assert.equal(formatPlaytime(5 * 3_600_000), '5 sa');
});

test('titles from file names keep written names and space out separator names', () => {
  assert.equal(titleFromFileName('Super Mario Bros. 3 (USA) (Rev 1).nes'), 'Super Mario Bros. 3 (USA) (Rev 1)');
  assert.equal(titleFromFileName('super_mario-bros.nes'), 'super mario bros');
  assert.equal(titleFromFileName('battery-test.nes'), 'battery test');
  assert.equal(titleFromFileName('Sonic.The.Hedgehog.md'), 'Sonic The Hedgehog');
  assert.equal(titleFromFileName('snes  pad.sfc'), 'snes pad');
  assert.equal(titleFromFileName('.nes'), '.nes');
  assert.equal(fileExt('A.B.ZIP'), 'zip');
  assert.equal(fileExt('noext'), '');
  assert.equal(safeFilename('a/b:c*?.srm'), 'a_b_c__.srm');
  assert.equal(hex32(0x2e6301ed), '2E6301ED');
  assert.equal(hex32(5), '00000005');
});
