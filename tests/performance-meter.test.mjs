import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyHeadroom, describeResult, paceWarning, deviceSummary, loadHistory, addToHistory, historyReport, PERF_HISTORY_KEY } from '../src/performance-meter.js';

function memoryStorage() {
  const map = new Map();
  return { getItem: key => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key) };
}

test('headroom is classified for the player in plain words', () => {
  assert.equal(classifyHeadroom(0.8).level, 'insufficient');
  assert.equal(classifyHeadroom(1.1).level, 'borderline');
  assert.equal(classifyHeadroom(1.6).level, 'good');
  assert.equal(classifyHeadroom(3.4).level, 'comfortable');
  assert.equal(classifyHeadroom(NaN).level, 'unknown');
});

test('a result is summarised with the speed factor and frame rate', () => {
  assert.match(describeResult({ headroom: 3.4, fps: 204, normalFps: 60 }), /^Hız payı 3,4× \(204 kare\/sn\) · Rahat.* · normal oyun 60 kare\/sn$/);
  assert.equal(describeResult(null), 'Performans ölçülemedi');
});

test('a game running at a 120 Hz pace is reported as too fast', () => {
  assert.equal(paceWarning(60), '');
  assert.equal(paceWarning(61), '');
  assert.match(paceWarning(119), /normalden hızlı/);
});

test('the device summary reads the Android model and hardware hints', () => {
  const summary = deviceSummary({ hardwareConcurrency: 8, deviceMemory: 8, userAgent: 'Mozilla/5.0 (Linux; Android 14; 23078RKD5C Build/UKQ1) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36' });
  assert.deepEqual(summary, { cores: 8, memory: 8, device: '23078RKD5C Build/UKQ1' });
});

test('measurements are kept newest first, capped, and survive bad stored data', () => {
  const storage = memoryStorage();
  storage.setItem(PERF_HISTORY_KEY, '{broken');
  assert.deepEqual(loadHistory(storage), []);
  for (let i = 0; i < 35; i++) addToHistory({ at: i, title: `G${i}`, platform: 'NES', core: 'nestopia', headroom: 2, fps: 120 }, storage);
  const history = loadHistory(storage);
  assert.equal(history.length, 30);
  assert.equal(history[0].title, 'G34');
  assert.match(historyReport(history), /^RetroPlay performans ölçümleri/);
  assert.equal(historyReport([]), 'Henüz performans ölçümü yok.');
});
