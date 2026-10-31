import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyHeadroom, describeResult, paceWarning, deviceSummary, loadHistory, addToHistory, historyReport, refreshNote, nominalRate, PERF_HISTORY_KEY } from '../src/performance-meter.js';

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

test('on the TV the result names the screen refresh rate and how much slower games play below 60 Hz', () => {
  assert.equal(refreshNote(60), ' · TV ekranı 60 Hz');
  assert.equal(refreshNote(59.94), ' · TV ekranı 60 Hz');
  assert.equal(refreshNote(50), ' · TV ekranı 50 Hz: oyunlar %17 yavaş oynar');
  assert.equal(refreshNote(undefined), '');
  assert.match(describeResult({ headroom: 1.4, fps: 84, normalFps: 50, refresh: 50 }), /normal oyun 50 kare\/sn · TV ekranı 50 Hz: oyunlar %17 yavaş oynar$/);
  const report = historyReport([{ at: 0, title: 'Oyun', platform: 'MD', core: 'picodrive', headroom: 2, fps: 120, normalFps: 60, picture: '1920×1080', refresh: 60, device: 'Mi Box' }]);
  assert.match(report, /görüntü 1920×1080 · ekran 60 Hz$/);
});

test('a PAL game (normal pace about 50, the device faster) is measured against 50 and named; picture sizes and start time are listed', () => {
  assert.equal(nominalRate(50, 62), 50);
  assert.equal(nominalRate(50, 51), 60, 'a device that cannot go faster than 50 is slow, not a PAL game');
  assert.equal(nominalRate(60, 200), 60);
  const text = describeResult({ headroom: 98 / 50, fps: 98, normalFps: 50, rate: 50, pictures: [{ lines: 1080, fps: 62 }, { lines: 720, fps: 98 }, { lines: 480, fps: 130 }], chosen: 720, startMs: 6200, refresh: 60 });
  assert.match(text, /^Hız payı 2,0× \(98 kare\/sn\)/);
  assert.match(text, /Avrupa \(PAL\) sürümü: oyun 50 Hz, ABD sürümünden %17 yavaş · görüntü 720 satır \(1080: 62 · 720: 98 · 480: 130 kare\/sn\) · açılış 6,2 sn · TV ekranı 60 Hz$/);
  const report = historyReport([{ at: 0, title: 'UMK3', platform: 'MD', core: 'picodrive', headroom: 1.96, fps: 98, normalFps: 50, rate: 50, picture: '960×720', pictures: [{ lines: 1080, fps: 62 }, { lines: 720, fps: 98 }], chosen: 720, startMs: 6200, refresh: 60 }]);
  assert.match(report, /PAL 50 Hz · görüntü 960×720 \(1080:62\/720:98 → 720\) · açılış 6,2 sn · ekran 60 Hz$/);
});
