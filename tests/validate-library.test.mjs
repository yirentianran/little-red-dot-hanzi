import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runValidation } from '../scripts/validate-library.mjs';

async function root(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'hanzi-validate-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'data'), { recursive: true });
  await mkdir(path.join(directory, 'assets/audio'), { recursive: true });
  return directory;
}

const catalog = {
  schemaVersion: 2,
  stages: [{ id: 'g4-fall', setIds: ['g4f-01'] }],
  sets: [{ id: 'g4f-01', entries: [
    { character: '宵', pinyin: 'xiāo', audio: 'xiao1', words: ['元宵', '宵夜'] }
  ] }]
};
const characters = {
  characters: { 宵: { strokeCount: 1, strokes: ['M0 0'], medians: [[[0, 0], [1, 1]]] } }
};

test('validates a complete catalog from an explicit root', async t => {
  const directory = await root(t);
  await writeFile(path.join(directory, 'data/catalog.json'), JSON.stringify(catalog));
  await writeFile(path.join(directory, 'data/characters.json'), JSON.stringify(characters));
  await writeFile(path.join(directory, 'assets/audio/xiao1.mp3'), 'audio');
  const output = [];
  assert.equal(await runValidation({ rootDir: directory, stdout: line => output.push(line) }), 0);
  assert.deepEqual(output, ['Catalog library valid']);
});

test('reports missing and invalid source files without throwing', async t => {
  const directory = await root(t);
  await writeFile(path.join(directory, 'data/catalog.json'), '{ invalid');
  const errors = [];
  assert.equal(await runValidation({ rootDir: directory, stderr: line => errors.push(line) }), 1);
  assert.ok(errors.some(error => /Invalid JSON.*catalog/.test(error)));
  assert.ok(errors.some(error => /Missing source file.*characters/.test(error)));
});
