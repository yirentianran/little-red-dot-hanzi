import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const catalog = JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url), 'utf8'));
const index = JSON.parse(await readFile(new URL('../data/catalog-index.json', import.meta.url), 'utf8'));
const checklist = JSON.parse(await readFile(new URL('../data/review-checklist.json', import.meta.url), 'utf8'));

const entries = catalog.sets.flatMap(set => set.entries);

test('uses the independent catalog and fixed fourth-grade fall allocation', () => {
  assert.equal(catalog.schemaVersion, 2);
  assert.equal(catalog.framework.nonAligned, true);
  assert.match(catalog.framework.disclaimer, /独立编排/);
  assert.equal(catalog.stages.length, 1);
  assert.deepEqual(catalog.stages[0].setIds, catalog.sets.map(set => set.id));
  assert.equal(catalog.sets.length, 15);
  assert.ok(catalog.sets.every((set, position) => (
    set.id === `g4f-${String(position + 1).padStart(2, '0')}`
      && set.title === `第${position + 1}组`
      && set.entries.length === 15
  )));
});

test('contains 225 unique entries with two original word examples and complete review rows', () => {
  assert.equal(entries.length, 225);
  assert.equal(new Set(entries.map(entry => entry.character)).size, 225);
  for (const entry of entries) {
    assert.match(entry.pinyin, /^[a-züāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜńňǹḿ]+$/iu);
    assert.match(entry.audio, /^[a-z]+[1-5]$/);
    assert.equal(entry.words.length, 2);
    assert.ok(entry.words.every(word => word.includes(entry.character)));
    assert.ok(checklist.entries[entry.character]);
  }
});

test('selects exactly ranks 2051 through 2275 from the fixed 3000-character index', () => {
  const selected = index.entries.filter(entry => entry.stageId === 'g4-fall');
  assert.equal(index.entries.length, 3000);
  assert.equal(new Set(index.entries.map(entry => entry.character)).size, 3000);
  assert.deepEqual(selected.map(entry => entry.rank),
    Array.from({ length: 225 }, (_, position) => position + 2051));
  assert.deepEqual(selected.map(entry => entry.character), entries.map(entry => entry.character));
});
