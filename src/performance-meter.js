// Performance meter: how much faster than real time this device runs a game.
// headroom = unthrottled frames per second / the system's normal frame rate (60).
//   < 1.0  the game cannot reach full speed (slowdown, crackling sound)
//   < 1.3  borderline: full speed most of the time, heavy scenes may drop
//   < 2.0  good
//   ≥ 2.0  comfortable: extras such as run-ahead (lower input lag) become possible

export const PERF_HISTORY_KEY = 'retroplay-performance-history';
const HISTORY_LIMIT = 30;

export function classifyHeadroom(headroom) {
  if (!Number.isFinite(headroom) || headroom <= 0) return { level: 'unknown', label: 'Ölçülemedi' };
  if (headroom < 1) return { level: 'insufficient', label: 'Yetersiz · oyun yavaşlar' };
  if (headroom < 1.3) return { level: 'borderline', label: 'Sınırda · yoğun sahnelerde düşebilir' };
  if (headroom < 2) return { level: 'good', label: 'İyi' };
  return { level: 'comfortable', label: 'Rahat · gecikme azaltma için pay var' };
}

const number = (value, digits = 1) => Number(value).toLocaleString('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** One-line summary shown in the player after a measurement. */
export function describeResult(result) {
  if (!result || !Number.isFinite(result.headroom)) return 'Performans ölçülemedi';
  const verdict = classifyHeadroom(result.headroom).label;
  const pace = Number.isFinite(result.normalFps) && result.normalFps > 0 ? ` · normal oyun ${number(result.normalFps, 0)} kare/sn` : '';
  // A PAL cartridge runs at 50 Hz on its own console: slower game and music, not a slow device.
  const pal = result.rate === 50 ? ' · Avrupa (PAL) sürümü: oyun 50 Hz, ABD sürümünden %17 yavaş' : '';
  const pictures = Array.isArray(result.pictures) && result.pictures.length
    ? ` · görüntü ${result.chosen || result.pictures[0].lines} satır (${result.pictures.map(p => `${p.lines}: ${number(p.fps, 0)}`).join(' · ')} kare/sn)`
    : '';
  const start = Number.isFinite(result.startMs) && result.startMs > 0 ? ` · açılış ${number(result.startMs / 1000)} sn` : '';
  // No usable GPU: the browser draws the picture on the processor (worth knowing on a TV box).
  const gpu = result.gpu === 'software' ? ' · görüntü ekran kartı olmadan çiziliyor' : '';
  return `Hız payı ${number(result.headroom)}× (${number(result.fps, 0)} kare/sn) · ${verdict}${pace}${pal}${pictures}${start}${gpu}${refreshNote(result.refresh)}`;
}

/**
 * The game's own rate: 50 for a PAL game (its normal pace is about 50 while the machine runs it
 * clearly faster), else 60. A device too slow for a 60 Hz game also shows a pace near 50, but then
 * it cannot run faster than that either.
 */
export function nominalRate(normalFps, fps) {
  return Number.isFinite(normalFps) && normalFps >= 47 && normalFps <= 52.5 && Number.isFinite(fps) && fps >= normalFps * 1.1 ? 50 : 60;
}

/**
 * The TV's refresh rate (from the TV app). The emulator advances one frame per refresh, so below
 * 60 Hz every game plays slower by the same share.
 */
export function refreshNote(refresh) {
  if (!Number.isFinite(refresh) || refresh <= 0) return '';
  const slower = Math.abs(refresh - 60) <= 0.5 ? 0 : Math.round((1 - refresh / 60) * 100);
  return ` · TV ekranı ${number(refresh, 0)} Hz${slower > 0 ? `: oyunlar %${slower} yavaş oynar` : ''}`;
}

/**
 * A game normally runs at its system rate (~60 fps). Far more than that during normal play means
 * the emulator follows a high refresh rate screen (for example 120 Hz) and the game runs too fast.
 */
export function paceWarning(normalFps, nominalFps = 60) {
  if (!Number.isFinite(normalFps) || normalFps <= 0) return '';
  if (normalFps > nominalFps * 1.25) return `Oyun normalden hızlı çalışıyor (${number(normalFps, 0)} kare/sn); ekran yenileme hızı 60 Hz'e alınırsa düzelir.`;
  return '';
}

export function deviceSummary(nav = globalThis.navigator) {
  const cores = Number(nav?.hardwareConcurrency) || null;
  const memory = Number(nav?.deviceMemory) || null;
  const model = String(nav?.userAgentData?.platform || '').slice(0, 40);
  const ua = String(nav?.userAgent || '');
  const android = ua.match(/Android [\d.]+; ([^;)]+)/);
  return { cores, memory, device: (android?.[1] || model || '').trim().slice(0, 60) };
}

export function loadHistory(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem(PERF_HISTORY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(entry => entry && Number.isFinite(entry.headroom)).slice(0, HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

export function addToHistory(entry, storage = globalThis.localStorage) {
  const history = [entry, ...loadHistory(storage)].slice(0, HISTORY_LIMIT);
  try { storage?.setItem(PERF_HISTORY_KEY, JSON.stringify(history)); } catch {}
  return history;
}

/** Plain-text report the player can copy and send. */
export function historyReport(history) {
  if (!history.length) return 'Henüz performans ölçümü yok.';
  const device = history[0].device || 'Cihaz bilinmiyor';
  const lines = history.map(entry => `${new Date(entry.at).toLocaleString('tr-TR')} · ${entry.title} · ${entry.platform}/${entry.core} · ${number(entry.headroom)}× (${number(entry.fps, 0)} kare/sn)${Number.isFinite(entry.normalFps) ? ` · normal ${number(entry.normalFps, 0)}` : ''}${entry.rate === 50 ? ' · PAL 50 Hz' : ''}${entry.picture ? ` · görüntü ${entry.picture}` : ''}${Array.isArray(entry.pictures) && entry.pictures.length ? ` (${entry.pictures.map(p => `${p.lines}:${p.fps}`).join('/')} → ${entry.chosen})` : ''}${Number.isFinite(entry.startMs) ? ` · açılış ${number(entry.startMs / 1000)} sn` : ''}${entry.gpu === 'software' ? ' · yazılım WebGL' : ''}${Number.isFinite(entry.refresh) ? ` · ekran ${number(entry.refresh, 0)} Hz` : ''}`);
  return [`RetroPlay performans ölçümleri · ${device}${history[0].cores ? ` · ${history[0].cores} çekirdek` : ''}${history[0].memory ? ` · ${history[0].memory} GB` : ''}`, ...lines].join('\n');
}
