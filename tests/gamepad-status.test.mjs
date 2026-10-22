import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectGamepads, describeGamepads } from '../src/gamepad-status.js';

test('reports unsupported when the browser has no Gamepad API', () => {
  const status = inspectGamepads({});
  assert.equal(status.state, 'unsupported');
  assert.equal(status.supported, false);
  assert.match(describeGamepads(status), /emülatör menüsündeki kontrolcü ayarını/);
});

test('handles a Gamepad API that throws without crashing the UI', () => {
  const status = inspectGamepads({
    getGamepads() {
      throw new Error('Permission denied');
    }
  });
  assert.equal(status.state, 'unavailable');
  assert.equal(status.supported, true);
  assert.deepEqual(status.connected, []);
  assert.match(describeGamepads(status), /Yeniden tara/);
});

test('ignores empty/disconnected slots and reports connected gamepads', () => {
  const status = inspectGamepads({
    getGamepads() {
      return [
        null,
        { connected: false, index: 1, id: 'Disconnected controller' },
        { connected: true, index: 0, id: 'USB Gamepad', mapping: 'standard' },
        { connected: true, index: 2, id: '', mapping: '' }
      ];
    }
  });
  assert.equal(status.state, 'connected');
  assert.equal(status.connected.length, 2);
  assert.deepEqual(status.connected[0], {
    index: 0,
    id: 'USB Gamepad',
    mapping: 'standard'
  });
  assert.equal(status.connected[1].mapping, 'custom');
  assert.equal(describeGamepads(status), 'Gamepad bağlı (2) · USB Gamepad, Gamepad 3');
});

test('bounds controller names and reports additional controllers without dumping them all', () => {
  const longId = 'C'.repeat(500);
  const status = inspectGamepads({
    getGamepads() {
      return Array.from({ length: 4 }, (_, index) => ({
        connected: true,
        index,
        id: index === 0 ? longId : `Pad ${index + 1}`,
        mapping: 'standard'
      }));
    }
  });
  assert.equal(status.connected[0].id.length, 80);
  assert.match(describeGamepads(status), /\+2$/);
});
