import test from 'node:test';
import assert from 'node:assert/strict';
import { REMOTE_KEYS, remoteKey, OkGate, isTextField, caretStep } from '../src/lib/tv-remote.ts';

test('the remote keys the TV app sends stand for the arrow keys and Enter', () => {
  assert.deepEqual(Object.keys(REMOTE_KEYS), ['up', 'down', 'left', 'right', 'ok']);
  assert.deepEqual(REMOTE_KEYS.left, { key: 'ArrowLeft', keyCode: 37 });
  assert.equal(remoteKey('ok'), 'ok');
  assert.equal(remoteKey('toString'), null, 'nothing from the object prototype');
  assert.equal(remoteKey(undefined), null);
});

test('OK: the real key press is used when it arrives; otherwise the page presses once, and a late real press is dropped', () => {
  // The real Enter reached the page just before the app's message: no second press.
  let gate = new OkGate(160);
  assert.equal(gate.real(1000), true);
  assert.equal(gate.shouldPress(1004, 1164), false);
  // … or just after it.
  gate = new OkGate(160);
  assert.equal(gate.real(1050), true);
  assert.equal(gate.shouldPress(1004, 1164), false);
  // A TV whose WebView drops the key: the page presses itself, every time.
  gate = new OkGate(160);
  assert.equal(gate.shouldPress(1000, 1160), true);
  assert.equal(gate.shouldPress(2000, 2160), true);
  // The real press arrives after the page has pressed: dropped once, not a second press …
  assert.equal(gate.real(2300), false);
  // … and the next real press counts again, even soon after.
  assert.equal(gate.real(2500), true);
  assert.equal(gate.shouldPress(2502, 2662), false);
  // A real press a while after a page press is a new press.
  gate = new OkGate(160);
  assert.equal(gate.shouldPress(1000, 1160), true);
  assert.equal(gate.real(2100), true);
  // An old real press does not stand in for a new OK.
  assert.equal(gate.shouldPress(9000, 9160), true);
});

test('text fields are told apart from checkboxes, sliders and buttons', () => {
  assert.equal(isTextField({ tagName: 'INPUT', type: 'search' }), true);
  assert.equal(isTextField({ tagName: 'input', type: 'text' }), true);
  assert.equal(isTextField({ tagName: 'TEXTAREA' }), true);
  for (const type of ['checkbox', 'radio', 'range', 'button', 'submit', 'file']) assert.equal(isTextField({ tagName: 'INPUT', type }), false, type);
  assert.equal(isTextField({ tagName: 'BUTTON' }), false);
  assert.equal(isTextField(null), false);
});

test('left and right move the caret while typing, within the text', () => {
  assert.equal(caretStep('mario', 5, 'left'), 4);
  assert.equal(caretStep('mario', 5, 'right'), 5);
  assert.equal(caretStep('mario', 0, 'left'), 0);
  assert.equal(caretStep('mario', null, 'left'), 4);
});
