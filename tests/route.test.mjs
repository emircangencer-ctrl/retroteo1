import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, routeHref } from '../src/lib/route.ts';

test('hash routes', () => {
  assert.deepEqual(parseRoute(''), { name: 'home', id: '', query: {} });
  assert.deepEqual(parseRoute('#/'), { name: 'home', id: '', query: {} });
  assert.deepEqual(parseRoute('#/library?fav=1&system=NES'), { name: 'library', id: '', query: { fav: '1', system: 'NES' } });
  assert.deepEqual(parseRoute('#/game/rom-1%3Ab'), { name: 'game', id: 'rom-1:b', query: {} });
  assert.equal(parseRoute('#/game').name, 'library', 'a game route without an id falls back to the library');
  assert.equal(parseRoute('#/nowhere').name, 'home');
  assert.equal(parseRoute('#home').name, 'home', 'old in-page anchors land on the home screen');
  assert.equal(parseRoute('#/settings?s=controls').query.s, 'controls');
});

test('links', () => {
  assert.equal(routeHref('home'), '#/');
  assert.equal(routeHref('game', 'rom 1'), '#/game/rom%201');
  assert.equal(routeHref('library', '', { system: 'NES', fav: false, q: '' }), '#/library?system=NES');
  assert.equal(routeHref('library', '', { fav: true }), '#/library?fav=true');
  for (const href of ['#/', '#/library?system=MD', '#/game/rom-abc', '#/import', '#/settings', '#/help']) assert.equal(routeHref(parseRoute(href).name, parseRoute(href).id, parseRoute(href).query), href);
});
