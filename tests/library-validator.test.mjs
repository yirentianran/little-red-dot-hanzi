import assert from 'node:assert/strict';
import test from 'node:test';

import { validateLibrary } from '../scripts/lib/library-validator.mjs';

const entry = { character: '宵', pinyin: 'xiāo', audio: 'xiao1', words: ['元宵', '宵夜'] };
const catalog = {
  schemaVersion: 2,
  stages: [{ id: 'g4-fall', setIds: ['g4f-01'] }],
  sets: [{ id: 'g4f-01', entries: [entry] }]
};
const characters = {
  characters: { 宵: { strokeCount: 1, strokes: ['M0 0'], medians: [[[0, 0], [1, 1]]] } }
};

test('accepts a complete independent catalog and resource subset', () => {
  assert.deepEqual(validateLibrary(catalog, characters, new Set(['xiao1'])), []);
});

test('reports missing resources, duplicate characters, malformed words, and set references', () => {
  const invalid = structuredClone(catalog);
  invalid.stages[0].setIds.push('missing-set');
  invalid.sets[0].entries.push({ ...entry, words: ['不含目标字', '宵夜'], audio: 'missing1' });
  const errors = validateLibrary(invalid, { characters: {} }, new Set());
  assert.ok(errors.some(error => /duplicate in set/.test(error)));
  assert.ok(errors.some(error => /two words/.test(error)));
  assert.ok(errors.some(error => /missing audio|missing missing1/.test(error)));
  assert.ok(errors.some(error => /missing geometry/.test(error)));
  assert.ok(errors.some(error => /missing set/.test(error)));
});

test('rejects malformed roots without throwing', () => {
  assert.deepEqual(validateLibrary(null, characters, new Set()), ['catalog.schemaVersion: must equal 2']);
  assert.deepEqual(validateLibrary(catalog, null, new Set()), ['characters.characters: must be an object']);
});
