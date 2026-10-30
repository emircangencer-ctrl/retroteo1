import test from 'node:test';
import assert from 'node:assert/strict';
import { splitTitle, shortTitle } from '../src/lib/title.ts';

test('screens show the game\'s name; versions and regions go to a quieter line', () => {
  assert.deepEqual(splitTitle('Tekken 3 (Japan, TET1/VER.E1)'), { name: 'Tekken 3', detail: 'Japan, TET1/VER.E1' });
  assert.deepEqual(splitTitle('Super Mario Bros. 3 (USA) (Rev 1)'), { name: 'Super Mario Bros. 3', detail: 'USA · Rev 1' });
  assert.deepEqual(splitTitle("Street Fighter II' - Champion Edition (World 920313)"), { name: "Street Fighter II' - Champion Edition", detail: 'World 920313' });
  assert.deepEqual(splitTitle('Game (USA) [b1]'), { name: 'Game', detail: 'USA · b1' });
  assert.deepEqual(splitTitle('Zelda [!]'), { name: 'Zelda', detail: '' }, 'GoodTools "verified" mark is not shown');
  assert.equal(shortTitle('Puck Man (Japan set 1)'), 'Puck Man');
});

test('a name sorted by its article reads naturally', () => {
  assert.deepEqual(splitTitle('Legend of Zelda, The (USA)'), { name: 'The Legend of Zelda', detail: 'USA' });
  assert.equal(shortTitle('Legend of Zelda, The - A Link to the Past (Europe)'), 'The Legend of Zelda - A Link to the Past');
  assert.equal(shortTitle('Adventures of Lolo, The'), 'The Adventures of Lolo');
  assert.equal(shortTitle('Ninja Gaiden II - The Dark Sword of Chaos (USA)'), 'Ninja Gaiden II - The Dark Sword of Chaos');
  assert.equal(shortTitle('Rock, Paper, Scissors'), 'Rock, Paper, Scissors');
});

test('brackets that belong to the name stay', () => {
  for (const title of ['(Kaiser) Knuckle', 'Sonic (the Hedgehog) 2', 'Metal Slug - Super Vehicle-001', 'checkerboard', '']) {
    assert.deepEqual(splitTitle(title), { name: title, detail: '' }, title);
  }
});
