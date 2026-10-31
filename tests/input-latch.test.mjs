import test from 'node:test';
import assert from 'node:assert/strict';
import { InputLatch, LATCH_FRAMES, TURBO_ON, TURBO_OFF } from '../src/input-latch.js';

/** A core whose frame counter the test advances; every display frame runs the scheduled tick. */
function rig() {
  const sent = [];
  let frame = 100;
  let queued = null;
  const latch = new InputLatch({ send: (slot, value) => sent.push(`${slot}:${value}@${frame}`), frame: () => frame, schedule: fn => { queued = fn; } });
  const step = (frames = 1) => { for (let i = 0; i < frames; i++) { frame += 1; const fn = queued; queued = null; fn?.(); } };
  return { latch, sent, step, frame: () => frame, idle: () => queued === null };
}

test('an ordinary press and release go to the core at once', () => {
  const { latch, sent, step } = rig();
  latch.set(8, 1);
  assert.deepEqual(sent, ['8:1@100']);
  step(5);
  latch.set(8, 0);
  assert.deepEqual(sent, ['8:1@100', '8:0@105']);
});

test('a tap shorter than a frame still reaches the game: the release waits for the core', () => {
  const { latch, sent, step, idle } = rig();
  latch.set(8, 1);
  latch.set(8, 0); // both between two frames
  assert.deepEqual(sent, ['8:1@100'], 'the release is held back');
  step(LATCH_FRAMES - 1);
  assert.deepEqual(sent, ['8:1@100']);
  step(1);
  assert.deepEqual(sent, ['8:1@100', `8:0@${100 + LATCH_FRAMES}`]);
  assert.equal(idle(), true, 'nothing left to do: no more display-frame work');
});

test('more changes than a thumb can make within two frames: the press is seen, the button ends up', () => {
  const { latch, sent, step, idle } = rig();
  latch.set(0, 1); latch.set(0, 0); latch.set(0, 1); latch.set(0, 0);
  step(10);
  assert.deepEqual(sent, ['0:1@100', '0:0@102']);
  assert.equal(idle(), true);
});

test('press, release, press again between frames: the game sees the release and the new press', () => {
  const { latch, sent, step } = rig();
  latch.set(8, 1);
  step(4);
  latch.set(8, 0); latch.set(8, 1); // a re-press within a frame
  step(6);
  assert.deepEqual(sent, ['8:1@100', '8:0@104', '8:1@106']);
});

test('buttons are independent: one waiting button never holds another back', () => {
  const { latch, sent } = rig();
  latch.set(8, 1); latch.set(8, 0);
  latch.set(0, 1);
  assert.deepEqual(sent, ['8:1@100', '0:1@100']);
});

test('turbo: held, the button fires on whole frames; let go, it is up', () => {
  const { latch, sent, step } = rig();
  latch.setTurbo([8]);
  latch.set(8, 1);
  step(11);
  const period = TURBO_ON + TURBO_OFF;
  assert.deepEqual(sent, ['8:1@100', '8:0@102', '8:1@104', '8:0@106', '8:1@108', '8:0@110'].slice(0, sent.length));
  assert.equal(sent.length, Math.floor(12 / TURBO_ON), `${12 / period} presses in 12 frames`);
  latch.set(8, 0);
  step(3);
  assert.equal(sent.at(-1).startsWith('8:0'), true);
  const count = sent.length;
  step(10);
  assert.equal(sent.length, count, 'no more presses after letting go');
});

test('turbo can be switched off while held: the button simply stays down', () => {
  const { latch, sent, step } = rig();
  latch.setTurbo([8]);
  latch.set(8, 1);
  step(2); // now up (turbo off-phase)
  latch.setTurbo([]);
  step(3);
  assert.equal(sent.at(-1).startsWith('8:1'), true);
  const count = sent.length;
  step(10);
  assert.equal(sent.length, count);
});

test('without a frame counter every change goes through at once (as before)', () => {
  const sent = [];
  const latch = new InputLatch({ send: (slot, value) => sent.push(`${slot}:${value}`), frame: () => null, schedule: () => assert.fail('no frame work') });
  latch.set(8, 1); latch.set(8, 0); latch.set(8, 1);
  assert.deepEqual(sent, ['8:1', '8:0', '8:1']);
});

test('reset forgets everything and names what was down or waiting', () => {
  const { latch, step } = rig();
  latch.set(8, 1); latch.set(8, 0);
  latch.set(3, 1);
  step(0);
  assert.deepEqual(latch.reset().sort((a, b) => a - b), [3, 8]);
  assert.deepEqual(latch.active(), []);
});
