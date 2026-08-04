import assert from 'node:assert/strict';
import test from 'node:test';

import { extractCharacters } from '../scripts/extract-characters.mjs';

const geometry = character => ({
  strokes: [`M ${character.codePointAt(0)} 0 L 1 1`],
  medians: [[[0, 0], [1, 1]]],
  radStrokes: [0]
});

test('extracts only catalog characters in deterministic key order', () => {
  const catalog = {
    sets: [{ entries: [{ character: '宴' }, { character: '宵' }, { character: '宴' }] }]
  };
  const document = extractCharacters(catalog, { 宵: geometry('宵'), 宴: geometry('宴'), 外: geometry('外') });
  assert.equal(document.schemaVersion, 1);
  assert.deepEqual(Object.keys(document.characters), ['宴', '宵']);
  assert.deepEqual(Object.keys(document.characters.宵), ['strokeCount', 'strokes', 'medians']);
  assert.match(document.modificationNotice.changes[0], /2-character subset/);
});

test('reports malformed catalog boundaries and missing upstream geometry', () => {
  assert.throws(() => extractCharacters(null, {}), /catalog\.json.*object/);
  assert.throws(() => extractCharacters({ sets: [{}] }, {}), /entries.*array/);
  assert.throws(() => extractCharacters({ sets: [{ entries: [{ character: '宵宵' }] }] }, {}), /one code point/);
  assert.throws(() => extractCharacters({ sets: [{ entries: [{ character: '宵' }] }] }, {}), /missing: 宵/);
});

test('rejects malformed paths and medians before publishing geometry', () => {
  const catalog = { sets: [{ entries: [{ character: '宵' }] }] };
  assert.throws(() => extractCharacters(catalog, { 宵: { strokes: [], medians: [] } }), /strokes/);
  assert.throws(() => extractCharacters(catalog, { 宵: { strokes: ['M0 0'], medians: [] } }), /matching lengths/);
});
