// Turkish formatting for sizes, times and durations. Pure functions (unit-tested).

const number1 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
const number0 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });

/** 1468006 → "1,4 MB". Zero, negative or unknown sizes → "—". */
export function formatBytes(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const value = n / Math.pow(1024, i);
  return `${(i === 0 ? number0 : number1).format(value)} ${units[i]}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Calendar days between two moments in local time (0 = same day, 1 = yesterday …). */
export function dayDistance(then: number, now: number): number {
  return Math.round((startOfDay(now) - startOfDay(then)) / DAY);
}

const shortDate = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' });
const shortDateYear = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
const clock = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' });

function calendarDate(then: number, now: number): string {
  return new Date(then).getFullYear() === new Date(now).getFullYear() ? shortDate.format(then) : shortDateYear.format(then);
}

/** "az önce", "14 dk önce", "3 sa önce", "Dün", "4 gün önce", "12 Eki". */
export function relativeTime(then: number | null | undefined, now: number = Date.now()): string {
  if (typeof then !== 'number' || !Number.isFinite(then) || then <= 0) return '';
  const diff = Math.max(0, now - then);
  if (diff < MINUTE) return 'az önce';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} dk önce`;
  const days = dayDistance(then, now);
  if (days === 0) return `${Math.floor(diff / HOUR)} sa önce`;
  if (days === 1) return 'Dün';
  if (days < 7) return `${days} gün önce`;
  return calendarDate(then, now);
}

/** When a save was made: "14 dk önce", "Bugün 22:41", "Dün 22:41", "3 gün önce", "12 Eki". */
export function slotTime(then: number | null | undefined, now: number = Date.now()): string {
  if (typeof then !== 'number' || !Number.isFinite(then) || then <= 0) return '';
  const diff = Math.max(0, now - then);
  if (diff < HOUR) return relativeTime(then, now);
  const days = dayDistance(then, now);
  if (days === 0) return `Bugün ${clock.format(then)}`;
  if (days === 1) return `Dün ${clock.format(then)}`;
  if (days < 7) return `${days} gün önce`;
  return calendarDate(then, now);
}

/** "Bugün oynandı", "Dün oynandı", "3 gün önce oynandı", "12 Eki'de oynandı" (empty if never). */
export function lastPlayedLabel(then: number | null | undefined, now: number = Date.now()): string {
  if (typeof then !== 'number' || !Number.isFinite(then) || then <= 0) return '';
  const days = dayDistance(then, now);
  if (days <= 0) return 'Bugün oynandı';
  if (days === 1) return 'Dün oynandı';
  if (days < 7) return `${days} gün önce oynandı`;
  return `${calendarDate(then, now)} oynandı`;
}

/** Short form for stats: "Bugün", "Dün", "3 gün önce", "12 Eki"; "—" if never. */
export function lastPlayedShort(then: number | null | undefined, now: number = Date.now()): string {
  if (typeof then !== 'number' || !Number.isFinite(then) || then <= 0) return '—';
  const days = dayDistance(then, now);
  if (days <= 0) return 'Bugün';
  if (days === 1) return 'Dün';
  if (days < 7) return `${days} gün önce`;
  return calendarDate(then, now);
}

/** Total play time: "—", "1 dk'dan az", "42 dk", "3 sa 12 dk", "5 sa". */
export function formatPlaytime(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '—';
  if (ms < MINUTE) return "1 dk'dan az";
  const minutes = Math.floor(ms / MINUTE);
  if (minutes < 60) return `${minutes} dk`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} sa ${rest} dk` : `${hours} sa`;
}

export function fileExt(name: string | null | undefined): string {
  const text = String(name || '');
  const i = text.lastIndexOf('.');
  return i >= 0 ? text.slice(i + 1).toLowerCase() : '';
}

export function safeFilename(name: string | null | undefined): string {
  return String(name || 'retroplay').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 140) || 'retroplay';
}

/**
 * A title from a file name. Names written with spaces are kept as they are ("Super Mario Bros. 3
 * (USA).nes" → "Super Mario Bros. 3 (USA)"); names using separators instead get spaces
 * ("super_mario-bros.nes" → "super mario bros").
 */
export function titleFromFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '');
  const title = /\s/.test(base.trim()) ? base.replace(/\s+/g, ' ') : base.replace(/[._-]+/g, ' ');
  return title.trim() || name;
}

export function hex32(value: number): string {
  return (value >>> 0).toString(16).toUpperCase().padStart(8, '0');
}
