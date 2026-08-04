import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const index = JSON.parse(await readFile('data/catalog-index.json', 'utf8'));
const catalog = JSON.parse(await readFile('data/catalog.json', 'utf8'));
const characters = JSON.parse(await readFile('data/characters.json', 'utf8'));
const manifest = JSON.parse(await readFile('assets/audio/manifest.json', 'utf8'));
const checklist = JSON.parse(await readFile('data/review-checklist.json', 'utf8'));

test('fixed Unicode 17 index has 3000 unique characters and exact stage quotas', async () => {
  assert.equal(index.entries.length, 3000);
  assert.equal(new Set(index.entries.map(entry => entry.character)).size, 3000);
  assert.deepEqual(index.stages.map(stage => stage.quota), [400, 400, 400, 400, 225, 225, 225, 225, 125, 125, 125, 125]);
  const bytes = await readFile('data/sources/Unihan-17.0.0.zip');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), index.source.sha256);
});

test('g4-fall contains 225 unique characters in 15 sets of 15', () => {
  const stage = catalog.stages.find(candidate => candidate.id === 'g4-fall');
  assert.equal(catalog.schemaVersion, 2);
  assert.equal(catalog.sets.length, 15);
  assert.equal(stage.setIds.length, 15);
  assert.ok(catalog.sets.every(set => set.entries.length === 15));
  const entries = catalog.sets.flatMap(set => set.entries);
  assert.equal(entries.length, 225);
  assert.equal(new Set(entries.map(entry => entry.character)).size, 225);
  assert.deepEqual(index.entries.filter(entry => entry.stageId === 'g4-fall').map(entry => entry.rank),
    Array.from({ length: 225 }, (_, position) => position + 2051));
  for (const entry of entries) {
    assert.equal(entry.words.length, 2);
    assert.ok(entry.words.every(word => word.includes(entry.character)));
    assert.ok(characters.characters[entry.character]);
    assert.ok(manifest.readings[entry.audio]);
    assert.ok(checklist.entries[entry.character]);
  }
});

test('audio and geometry subsets exactly cover the catalog', () => {
  const entries = catalog.sets.flatMap(set => set.entries);
  assert.deepEqual(new Set(Object.keys(characters.characters)), new Set(entries.map(entry => entry.character)));
  assert.deepEqual(new Set(Object.keys(manifest.readings)), new Set(entries.map(entry => entry.audio)));
});
