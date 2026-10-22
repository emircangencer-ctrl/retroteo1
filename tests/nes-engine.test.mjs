import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveNesCore } from '../src/nes-engine.js';

test('fast JSNES engine is selected by default', () => {
  assert.equal(resolveNesCore(''), 'jsnes');
  assert.equal(resolveNesCore('?view=game'), 'jsnes');
  assert.equal(resolveNesCore('?nescore=jsnes'), 'jsnes');
});

test('new NES core requires explicit opt-in for A/B testing', () => {
  assert.equal(resolveNesCore('?nescore=nesjs'), 'nesjs');
  assert.equal(resolveNesCore('?nescore=nesjs&view=game'), 'nesjs');
  assert.equal(resolveNesCore('?nescore=unknown'), 'jsnes');
});
