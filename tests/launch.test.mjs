import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLaunch, keyBlock, rememberCore } from '../src/player/launch.ts';

const NES = { shortLabel: 'NES', emulatorJsCoreId: 'nestopia', emulatorJsSystemId: 'nes' };
const ARC = { shortLabel: 'Arcade', emulatorJsCoreId: 'fbneo', emulatorJsSystemId: 'arcade' };
const blob = () => new Blob([new Uint8Array(4)]);
const deps = (extra = {}) => {
  const urls = [];
  return { urls, games: [], getBios: async () => null, loadCatalogs: async () => ({}), readZipDirectory: async () => [], makeUrl: b => { urls.push(b); return `blob:${urls.length}`; }, revokeUrl: () => {}, ...extra };
};

test('NES: Nestopia first, FCEUmm offered next; a remembered FCEUmm or ?nescore=fceumm goes first', async () => {
  const game = { id: 'g', title: 'Game', platform: 'NES', blob: blob() };
  assert.deepEqual((await resolveLaunch(game, NES, {}, deps())).cores.map(c => c.coreId), ['nestopia', 'fceumm']);
  assert.deepEqual((await resolveLaunch({ ...game, nesCore: 'fceumm' }, NES, {}, deps())).cores.map(c => c.coreId), ['fceumm', 'nestopia']);
  const forced = await resolveLaunch(game, NES, {}, deps({ forcedNesCore: 'fceumm' }));
  assert.deepEqual(forced.cores.map(c => c.coreId), ['fceumm']);
  assert.match(forced.cores[0].label, /karşılaştırma/);
  assert.deepEqual((await resolveLaunch(game, NES, { coreOverride: 'fceumm' }, deps())).cores.map(c => c.coreId), ['fceumm'], '"FCEUmm ile dene" starts only FCEUmm');
});

test('arcade: a missing BIOS blocks before any core loads and names the file', async () => {
  const game = { id: 'm', title: 'Metal Slug', platform: 'ARCADE', blob: blob(), arcade: { core: 'fbneo', set: 'mslug', status: 'complete', missing: [], bios: 'neogeo', parent: '' } };
  const blocked = await resolveLaunch(game, ARC, {}, deps());
  assert.equal(blocked.blocked.bios, 'neogeo.zip');
  assert.match(blocked.blocked.status, /neogeo\.zip gerekli/);
  const ok = await resolveLaunch(game, ARC, {}, deps({ getBios: async () => ({ blob: blob() }) }));
  assert.deepEqual(ok.extraFiles.map(f => f.name), ['neogeo.zip']);
  assert.equal(ok.cores[0].gameName, 'mslug.zip');
});

test('arcade: a clone needs its parent; a complete clone on FB Alpha 2012 gets a stand-in parent zip', async () => {
  const clone = { id: 'c', title: 'Clone', platform: 'ARCADE', blob: blob(), arcade: { core: 'fbneo', set: 'clone', status: 'needs-parent', parent: 'parent', missing: [] } };
  assert.match((await resolveLaunch(clone, ARC, {}, deps())).blocked.status, /parent\.zip gerekli/);
  const withParent = await resolveLaunch(clone, ARC, {}, deps({ games: [{ id: 'p', title: 'P', platform: 'ARCADE', blob: blob(), arcade: { set: 'parent' } }] }));
  assert.deepEqual(withParent.extraFiles.map(f => f.name), ['parent.zip']);
  const fba = { id: 'f', title: 'MM2', platform: 'ARCADE', blob: blob(), arcade: { core: 'fbalpha2012_cps2', set: 'megaman2a', status: 'complete', parent: 'megaman2', missing: [] } };
  const d = deps();
  const launch = await resolveLaunch(fba, ARC, {}, d);
  assert.deepEqual(launch.extraFiles.map(f => f.name), ['megaman2.zip']);
  assert.ok(d.urls[0].size > 22, 'the stand-in zip holds one (empty) file');
});

test('arcade: other cores that know the set are offered in order; incomplete ones are left out', async () => {
  const game = { id: 'x', title: 'X', platform: 'ARCADE', blob: blob(), arcade: { core: 'fbneo', set: 'x', status: 'complete', missing: [], alternatives: [{ core: 'mame2003_plus', set: 'xm', status: 'complete' }, { core: 'fbalpha2012_cps2', set: 'x', status: 'incomplete' }] } };
  const launch = await resolveLaunch(game, ARC, {}, deps());
  assert.deepEqual(launch.cores.map(c => [c.coreId, c.gameName]), [['fbneo', 'x.zip'], ['mame2003_plus', 'xm.zip']]);
  assert.equal(launch.cores[1].systemId, 'mame');
});

test('a set missing only its CPS2 key is explained, not started', async () => {
  const game = { id: 'k', title: 'SPF2T', platform: 'ARCADE', blob: blob(), arcade: { core: 'fbneo', set: 'spf2t', status: 'incomplete', missing: ['spf2t.key'], different: [], cps2Key: true } };
  const launch = await resolveLaunch(game, ARC, {}, deps());
  assert.match(launch.blocked.status, /CPS2 şifre anahtarı eksik/);
  assert.match(launch.blocked.message, /Bu zip'te spf2t\.key yok\. CPS2 oyunlarının programı şifreli/);
  assert.doesNotMatch(launch.blocked.message, /\.\./);
  const different = await keyBlock({ ...game, arcade: { ...game.arcade, different: ['spf2t.key'] } }, { loadCatalogs: async () => ({}), readZipDirectory: async () => [{ name: 'spf2t.key', crc: '00000000', size: 20 }] });
  assert.match(different.status, /uyuşmuyor/);
});

test('the core that opened a game is remembered with it', () => {
  assert.equal(rememberCore({ id: 'n', title: 'N', platform: 'NES' }, 'fceumm').nesCore, 'fceumm');
  const arcade = rememberCore({ id: 'a', title: 'A', platform: 'ARCADE', arcade: { core: 'fbneo', set: 'a', status: 'complete', missing: [], alternatives: [{ core: 'mame2003_plus', set: 'am', status: 'complete' }] } }, 'mame2003_plus');
  assert.deepEqual([arcade.arcade.core, arcade.arcade.set, arcade.arcade.alternatives[0].core], ['mame2003_plus', 'am', 'fbneo']);
});

test('library records: MAME 2003-Plus sets and incomplete sets are checked again once per catalog revision', async () => {
  const { needsArcadeRecheck, ARCADE_CATALOG_REV } = await import('../src/lib/arcade-records.ts');
  const blob = new Blob(['x']);
  const record = (arcade, extra = {}) => ({ platform: 'ARCADE', blob, arcade: { core: 'fbneo', set: 's', status: 'complete', missing: [], ...arcade }, ...extra });
  assert.equal(needsArcadeRecheck(record({ core: 'mame2003_plus', checkedWith: 'fbneo-dedd04f2+fba2012cps2-3fb5b89+mame2003p-3a72dae' })), true, 'a MAME 2003-Plus set from before the current build');
  assert.equal(needsArcadeRecheck(record({ status: 'incomplete' })), true);
  assert.equal(needsArcadeRecheck(record({ core: 'mame2003_plus', checkedWith: ARCADE_CATALOG_REV })), false, 'checked with these catalogs already');
  assert.equal(needsArcadeRecheck(record({})), false, 'a complete FinalBurn Neo set is left alone');
  assert.equal(needsArcadeRecheck(record({ core: 'mame2003_plus' }, { blob: undefined })), false, 'no file to read');
  assert.equal(needsArcadeRecheck({ platform: 'NES', blob, arcade: null }), false);
});

test('arcade: a System 12 game starts with the current MAME 2003-Plus build under its set name; the 2025 build is offered next', async () => {
  const game = { id: 't3', title: 'Tekken 3', platform: 'ARCADE', blob: blob(), arcade: { core: 'mame2003_plus_next', set: 'tekken3je1', status: 'complete', parent: 'tekken3', missing: [], alternatives: [{ core: 'mame2003_plus', status: 'complete', set: 'tekken3' }] } };
  const launch = await resolveLaunch(game, ARC, {}, deps());
  assert.deepEqual(launch.cores.map(c => [c.coreId, c.systemId, c.gameName, c.name]), [['mame2003_plus_next', 'mame', 'tekken3je1.zip', 'MAME 2003-Plus (2026)'], ['mame2003_plus', 'mame', 'tekken3.zip', 'MAME 2003-Plus']]);
  assert.deepEqual(launch.extraFiles, [], 'a complete clone needs no parent zip on MAME');
  assert.deepEqual((await resolveLaunch(game, ARC, { coreOverride: 'mame2003_plus' }, deps())).cores.map(c => c.gameName), ['tekken3.zip']);
});

test('arcade: without WebAssembly SIMD the 2026 MAME build is left out; the 2025 build starts the game, or the player is told to update the browser', async () => {
  const game = { id: 't3', title: 'Tekken 3', platform: 'ARCADE', blob: blob(), arcade: { core: 'mame2003_plus_next', set: 'tekken3je1', status: 'complete', parent: 'tekken3', missing: [], alternatives: [{ core: 'mame2003_plus', status: 'complete', set: 'tekken3' }] } };
  const noSimd = id => id !== 'mame2003_plus_next';
  const launch = await resolveLaunch(game, ARC, {}, deps({ coreSupported: noSimd }));
  assert.deepEqual(launch.cores.map(c => [c.coreId, c.gameName]), [['mame2003_plus', 'tekken3.zip']]);
  const only = { ...game, arcade: { ...game.arcade, alternatives: [] } };
  const blocked = await resolveLaunch(only, ARC, {}, deps({ coreSupported: noSimd }));
  assert.match(blocked.blocked.status, /tarayıcı güncel değil/);
  assert.match(blocked.blocked.message, /MAME 2003-Plus \(2026\).*SIMD.*Safari 16\.4/);
  assert.equal((await resolveLaunch(only, ARC, {}, deps({ coreSupported: () => true }))).cores[0].coreId, 'mame2003_plus_next');
});
