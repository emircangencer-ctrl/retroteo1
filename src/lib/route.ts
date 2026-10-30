// Hash routes (the app is one static page; the service worker serves it offline for any path).
export type RouteName = 'home' | 'library' | 'game' | 'import' | 'settings' | 'help';
export interface Route { name: RouteName; id: string; query: Record<string, string> }

const NAMES: ReadonlySet<string> = new Set(['library', 'game', 'import', 'settings', 'help']);

/** "#/game/rom-1?x=1" → { name: 'game', id: 'rom-1', query: { x: '1' } }. Unknown → home. */
export function parseRoute(hash: string): Route {
  const text = String(hash || '').replace(/^#/, '');
  const [path, search = ''] = text.split('?');
  const parts = path.split('/').filter(Boolean).map(part => { try { return decodeURIComponent(part); } catch { return part; } });
  const query: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(search)) query[key] = value;
  const name = parts[0] && NAMES.has(parts[0]) ? (parts[0] as RouteName) : 'home';
  const id = name === 'game' ? parts[1] || '' : '';
  if (name === 'game' && !id) return { name: 'library', id: '', query };
  return { name, id, query };
}

export function routeHref(name: RouteName, id = '', query: Record<string, string | number | boolean | undefined> = {}): string {
  const path = name === 'home' ? '#/' : name === 'game' ? `#/game/${encodeURIComponent(id)}` : `#/${name}`;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== '' && value !== false) search.set(key, String(value));
  const text = search.toString();
  return text ? `${path}?${text}` : path;
}
