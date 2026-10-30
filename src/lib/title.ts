// Game titles from DATs and arcade lists carry versions and regions in brackets:
// "Tekken 3 (Japan, TET1/VER.E1)", "Super Mario Bros. 3 (USA) (Rev 1)". Screens show the name and
// put the rest on a quieter line; the stored title (and search) keep the full text.

export interface TitleParts { name: string; detail: string }

/** No-Intro sorts by name: "Legend of Zelda, The - A Link to the Past" reads "The Legend of Zelda - A Link to the Past". */
const articleFirst = (name: string): string => name.replace(/^(.+?), (The|A|An)(?=$| - )/, '$2 $1');

/** "Tekken 3 (Japan, TET1/VER.E1)" → { name: 'Tekken 3', detail: 'Japan, TET1/VER.E1' }. */
export function splitTitle(title: string): TitleParts {
  const text = String(title || '').trim();
  const match = /^(.+?)\s+((?:[([][^)\]]*[)\]]\s*)+)$/.exec(text);
  if (!match) return { name: articleFirst(text), detail: '' };
  // ("[!]" is a GoodTools "verified dump" mark, not something to show.)
  const groups = [...match[2].matchAll(/[([]([^)\]]*)[)\]]/g)].map(group => group[1].trim()).filter(group => group && group !== '!');
  return { name: articleFirst(match[1].trim()), detail: groups.join(' · ') };
}

/** The name alone, for covers, cards and the player bar. */
export const shortTitle = (title: string): string => splitTitle(title).name;
