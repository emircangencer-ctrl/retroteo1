import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayClock } from '../src/lib/playtime.ts';

test('the clock counts only while running and hands out what it counted', () => {
  const clock = new PlayClock();
  assert.equal(clock.take(1000), 0);
  clock.start(1000);
  clock.start(2000); // already running: ignored
  assert.equal(clock.running, true);
  assert.equal(clock.take(31_000), 30_000);
  clock.stop(41_000);
  assert.equal(clock.running, false);
  assert.equal(clock.take(99_000), 10_000, 'paused time is not counted');
  assert.equal(clock.take(100_000), 0);
});

test('a gap far longer than the half-minute heartbeat (device slept) counts at most maxStep', () => {
  const clock = new PlayClock({ maxStep: 90_000 });
  clock.start(0);
  assert.equal(clock.take(2 * 3_600_000), 90_000);
  assert.equal(clock.take(2 * 3_600_000 + 5_000), 5_000);
  clock.stop(Number.NaN);
  assert.equal(clock.take(0), 0);
});
