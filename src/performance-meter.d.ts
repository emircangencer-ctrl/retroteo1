export const PERF_HISTORY_KEY: string;
export function classifyHeadroom(headroom: number): string;
export function describeResult(result: unknown): string;
export function paceWarning(normalFps: number | null, nominalFps?: number): string;
export function deviceSummary(nav?: unknown): Record<string, unknown>;
export function loadHistory(storage?: Storage): any[];
export function addToHistory(entry: unknown, storage?: Storage): any[];
export function historyReport(history: unknown[]): string;
