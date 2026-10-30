import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { identifyArcadeZip } from '../src/arcade.js';
import { createArcadeCatalogs, decodeSet, setBucket, crcBucket, ARCADE_INDEX_URL } from '../src/arcade-catalog.js';
import { ARCADE_LISTS, encodeSet, shardCatalog } from '../scripts/arcade-shards.mjs';

const full = {};
for (const [id, file] of Object.entries(ARCADE_LISTS)) full[id] = JSON.parse(await readFile(new URL(`../data/arcade/${file}`, import.meta.url), 'utf8'));
// The served pieces, built in memory exactly as the build writes them.
const served = new Map();
const cores = {};
for (const [id, catalog] of Object.entries(full)) {
  const { meta, files } = shardCatalog(catalog);
  cores[id] = meta;
  for (const [name, content] of Object.entries(files)) served.set(`/assets/arcade/${id}/${name}`, JSON.stringify(content));
}
served.set(ARCADE_INDEX_URL, JSON.stringify({ format: 1, cores }));
function server() {
  const requests = [];
  const fetchImpl = async url => { requests.push(url); return served.has(url) ? new Response(served.get(url)) : new Response('missing', { status: 404 }); };
  return { requests, fetchImpl };
}
const ROMS = 6;
const entriesOf = roms => roms.map(([name, size, crc]) => ({ name, size, crc }));

test('every stored set comes back exactly as in the full lists', () => {
  for (const [id, catalog] of Object.entries(full)) {
    const games = catalog.games;
    const encoded = Object.fromEntries(Object.keys(games).map((name, order) => [name, encodeSet(games, name, order)]));
    const memo = new Map();
    const decode = name => {
      if (!memo.has(name)) {
        const chain = [];
        for (let parent = encoded[name][4], seen = new Set(); parent && encoded[parent] && !seen.has(parent); parent = encoded[parent][4]) { seen.add(parent); chain.push(decode(parent)); }
        memo.set(name, decodeSet(encoded[name], chain));
      }
      return memo.get(name);
    };
    for (const name of Object.keys(games)) assert.deepEqual(decode(name), games[name].slice(0, 7), `${id} ${name}`);
  }
});

test('the pieces are small: each set piece a few dozen KB, the set pieces together half the full lists', () => {
  let sets = 0, fullSize = 0;
  for (const [url, text] of served) {
    if (/\/s\d+\.json$/.test(url)) { sets += text.length; assert.ok(text.length < 64_000, `${url} ${text.length}`); }
    if (/\/c\d+\.json$/.test(url)) assert.ok(text.length < 96_000, `${url} ${text.length}`);
  }
  for (const id of Object.keys(full)) fullSize += JSON.stringify(full[id]).length;
  assert.ok(sets < fullSize * 0.6, `${sets} vs ${fullSize}`);
  assert.equal(setBucket('puckman', 1), 0);
  assert.ok(setBucket('puckman', 64) < 64);
  assert.equal(crcBucket('ff00aa11', 256), 255);
});

async function compare(fileName, roms, label) {
  const { requests, fetchImpl } = server();
  const pieces = createArcadeCatalogs(fetchImpl);
  const fromPieces = await pieces.identify(fileName, entriesOf(roms));
  const fromFull = identifyArcadeZip(fileName, entriesOf(roms), full);
  assert.deepEqual(fromPieces, fromFull, label);
  return { result: fromPieces, requests };
}

test('a zip is recognised exactly as with the full lists: named, renamed, split, incomplete, BIOS', async () => {
  const named = ['puckman', 'mslug', 'neogeo', 'spf2t', 'megaman2', 'megaman2a', 'tekken3', 'tekken3a', 'zigzag', 'sf2', 'kof98', 'pgm', 'dkong', '1942'];
  const sample = [...named];
  for (const id of Object.keys(full)) {
    const names = Object.keys(full[id].games);
    for (let i = 0; i < names.length; i += Math.ceil(names.length / 40)) sample.push(names[i]);
  }
  let checked = 0;
  for (const set of new Set(sample)) {
    const id = Object.keys(full).find(core => full[core].games[set]);
    if (!id) continue;
    const roms = full[id].games[set][ROMS];
    if (!roms.length) continue;
    await compare(`${set}.zip`, roms, `${set} named`);
    await compare('Benim kopyam.zip', roms, `${set} renamed`);
    const own = roms.filter(rom => !rom[3]);
    if (own.length && own.length < roms.length) await compare(`${set}.zip`, own, `${set} split`);
    if (own.length > 1) await compare(`${set}.zip`, roms.filter(rom => rom !== own[0]), `${set} missing one file`);
    checked++;
  }
  assert.ok(checked > 120, `${checked} sets`);
});

test('recognising a named zip reads a handful of small pieces, not the lists', async () => {
  const { result, requests } = await compare('puckman.zip', full.fbneo.games.puckman[ROMS], 'puckman');
  assert.equal(result.core, 'fbneo');
  assert.equal(result.status, 'complete');
  // MAME 2003-Plus has no "puckman": its sets with the same files are looked up (alternatives).
  assert.ok(requests.length <= 60, `${requests.length} requests`);
  const bytes = requests.reduce((sum, url) => sum + (served.get(url)?.length || 0), 0);
  assert.ok(bytes < 400_000, `${bytes} bytes`);
  // A Neo Geo game also reads its BIOS set; the pieces are fetched once per reader.
  const { fetchImpl, requests: again } = server();
  const pieces = createArcadeCatalogs(fetchImpl);
  const mslug = await pieces.identify('mslug.zip', entriesOf(full.fbneo.games.mslug[ROMS]));
  assert.equal(mslug.bios, 'neogeo');
  const first = again.length;
  await pieces.identify('mslug.zip', entriesOf(full.fbneo.games.mslug[ROMS]));
  assert.equal(again.length, first, 'nothing fetched twice');
});

test('one set with its chain for the player (CPS2 key check), and failures are not cached', async () => {
  const { fetchImpl } = server();
  const pieces = createArcadeCatalogs(fetchImpl);
  const catalog = await pieces.setCatalog('fbneo', 'spf2t');
  assert.deepEqual(catalog.games.spf2t, full.fbneo.games.spf2t.slice(0, 7));
  assert.equal(await pieces.setCatalog('fbneo', 'no-such-set'), null);
  let fail = true;
  const flaky = createArcadeCatalogs(async url => (fail ? new Response('', { status: 503 }) : new Response(served.get(url))));
  await assert.rejects(flaky.identify('puckman.zip', entriesOf(full.fbneo.games.puckman[ROMS])), /503/);
  fail = false;
  assert.equal((await flaky.identify('puckman.zip', entriesOf(full.fbneo.games.puckman[ROMS])))?.set, 'puckman');
});
