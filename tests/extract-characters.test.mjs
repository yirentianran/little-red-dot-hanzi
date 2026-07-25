import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { extractCharacters, runExtraction } from '../scripts/extract-characters.mjs';

const expectedModificationNotice = characterCount => ({
  date: '2026-07-25',
  source: 'hanzi-writer-data@2.0.1',
  license: 'ARPHICPL.TXT',
  changes: [
    `Extracted the ${characterCount}-character subset used by the PEP Grade 4 Volume 1 curriculum.`,
    'Removed radStrokes and all other upstream fields, retaining only strokes and medians.',
    'Added strokeCount to each character record.',
    'Sorted character keys deterministically.',
    'Combined the selected records into this single JSON document.'
  ]
});

const curriculum = (...characters) => ({
  units: [{
    lessons: [{
      recognize: characters.map(character => ({ character })),
      write: characters.length === 0 ? [] : [{ character: characters[0] }]
    }]
  }]
});

const sourceGeometry = (suffix = '') => ({
  strokes: [`M 0 0 L 1 1${suffix}`, `M 1 0 L 0 1${suffix}`],
  medians: [
    [[0, 0], [1, 1]],
    [[1, 0], [0, 1]]
  ],
  radStrokes: [0]
});

test('extracts only unique curriculum characters and preserves ordered geometry', () => {
  const source = sourceGeometry();
  const result = extractCharacters(curriculum('郭', '郭'), {
    郭: source,
    外: sourceGeometry('-unused')
  });

  assert.deepEqual(Object.keys(result), ['schemaVersion', 'modificationNotice', 'characters']);
  assert.equal(result.schemaVersion, 1);
  assert.deepEqual(result.modificationNotice, expectedModificationNotice(1));
  assert.deepEqual(Object.keys(result.characters), ['郭']);
  assert.deepEqual(result.characters.郭, {
    strokeCount: 2,
    strokes: source.strokes,
    medians: source.medians
  });
  assert.equal(Object.hasOwn(result.characters.郭, 'radStrokes'), false);
});

test('orders output deterministically regardless of curriculum or upstream insertion order', () => {
  const upstreamA = { 汉: sourceGeometry('-han'), 郭: sourceGeometry('-guo') };
  const upstreamB = { 郭: sourceGeometry('-guo'), 汉: sourceGeometry('-han') };

  const first = extractCharacters(curriculum('汉', '郭'), upstreamA);
  const second = extractCharacters(curriculum('郭', '汉'), upstreamB);

  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(Object.keys(first.characters), [...Object.keys(first.characters)].sort());
});

test('reports data/curriculum.json locations for malformed curriculum boundaries', () => {
  const cases = [
    [null, /data\/curriculum\.json: must be an object/i],
    [{}, /data\/curriculum\.json\.units: must be an array/i],
    [{ units: [null] }, /data\/curriculum\.json\.units\[0\]: must be an object/i],
    [{ units: [{}] }, /data\/curriculum\.json\.units\[0\]\.lessons: must be an array/i],
    [{ units: [{ lessons: [null] }] }, /units\[0\]\.lessons\[0\]: must be an object/i],
    [{ units: [{ lessons: [{}] }] }, /lessons\[0\]\.recognize: must be an array/i],
    [{ units: [{ lessons: [{ recognize: [], write: null }] }] }, /lessons\[0\]\.write: must be an array/i],
    [{ units: [{ lessons: [{ recognize: [{}], write: [] }] }] }, /recognize\[0\]\.character: must be one code point/i]
  ];

  for (const [candidate, expected] of cases) {
    assert.throws(() => extractCharacters(candidate, {}), expected);
  }
});

test('reports the character when upstream geometry is missing', () => {
  assert.throws(
    () => extractCharacters(curriculum('郭'), {}),
    /upstream geometry missing.*郭/i
  );
});

test('reports the character for malformed upstream geometry', () => {
  const malformedRecords = [
    null,
    { strokes: 'bad', medians: [] },
    { strokes: [], medians: [] },
    { strokes: ['M 0 0'], medians: [] },
    { strokes: [42], medians: [[[0, 0], [1, 1]]] },
    { strokes: ['M 0 0'], medians: ['bad'] }
  ];

  for (const source of malformedRecords) {
    assert.throws(
      () => extractCharacters(curriculum('郭'), { 郭: source }),
      /malformed upstream geometry.*郭/i
    );
  }
});

test('the textbook curriculum has 428 unique characters', () => {
  const realCurriculum = JSON.parse(readFileSync(new URL('../data/curriculum.json', import.meta.url), 'utf8'));
  const characters = realCurriculum.units.flatMap(unit => unit.lessons)
    .flatMap(section => [...section.recognize, ...section.write])
    .map(entry => entry.character);

  assert.equal(new Set(characters).size, 428);
});

test('the generated geometry file exactly covers the textbook characters', () => {
  const realCurriculum = JSON.parse(readFileSync(new URL('../data/curriculum.json', import.meta.url), 'utf8'));
  const generated = JSON.parse(readFileSync(new URL('../data/characters.json', import.meta.url), 'utf8'));
  const expected = [...new Set(realCurriculum.units.flatMap(unit => unit.lessons)
    .flatMap(section => [...section.recognize, ...section.write])
    .map(entry => entry.character))].sort();

  assert.equal(generated.schemaVersion, 1);
  assert.deepEqual(generated.modificationNotice, expectedModificationNotice(428));
  assert.deepEqual(Object.keys(generated.characters), expected);
  for (const [character, geometry] of Object.entries(generated.characters)) {
    assert.deepEqual(Object.keys(geometry), ['strokeCount', 'strokes', 'medians'], character);
    assert.ok(Number.isInteger(geometry.strokeCount) && geometry.strokeCount > 0, character);
    assert.equal(geometry.strokeCount, geometry.strokes.length, `${character} strokes`);
    assert.equal(geometry.strokeCount, geometry.medians.length, `${character} medians`);
  }
});

test('matches every generated path and median to hanzi-writer-data 2.0.1', () => {
  const realCurriculum = JSON.parse(readFileSync(new URL('../data/curriculum.json', import.meta.url), 'utf8'));
  const packageMetadata = JSON.parse(readFileSync(
    new URL('../node_modules/hanzi-writer-data/package.json', import.meta.url),
    'utf8'
  ));
  const generatedSource = readFileSync(new URL('../data/characters.json', import.meta.url), 'utf8');
  const expectedCharacters = [...new Set(realCurriculum.units.flatMap(unit => unit.lessons)
    .flatMap(section => [...section.recognize, ...section.write])
    .map(entry => entry.character))].sort();
  const upstream = Object.fromEntries(expectedCharacters.map(character => [
    character,
    JSON.parse(readFileSync(
      new URL(`../node_modules/hanzi-writer-data/${character}.json`, import.meta.url),
      'utf8'
    ))
  ]));

  assert.equal(packageMetadata.version, '2.0.1');
  const expectedSource = `${JSON.stringify(extractCharacters(realCurriculum, upstream), null, 2)}\n`;
  assert.ok(
    Buffer.from(generatedSource).equals(Buffer.from(expectedSource)),
    'data/characters.json must be byte-identical to a fresh extraction from hanzi-writer-data@2.0.1'
  );
});

test('runExtraction reports missing and invalid curriculum files with file context', async t => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'hanzi-extraction-'));
  t.after(() => rm(rootDir, { force: true, recursive: true }));

  await assert.rejects(
    runExtraction({ rootDir, argv: [] }),
    /unable to read data\/curriculum\.json/i
  );

  await mkdir(path.join(rootDir, 'data'), { recursive: true });
  await writeFile(path.join(rootDir, 'data/curriculum.json'), '{ invalid JSON');
  await assert.rejects(
    runExtraction({ rootDir, argv: [] }),
    /invalid JSON in data\/curriculum\.json/i
  );

  for (const [source, expected] of [
    ['null', /data\/curriculum\.json: must be an object/i],
    ['{}', /data\/curriculum\.json\.units: must be an array/i]
  ]) {
    await writeFile(path.join(rootDir, 'data/curriculum.json'), source);
    await assert.rejects(runExtraction({ rootDir, argv: [] }), expected);
  }
});

test('keeps the upstream ARPHICPL terms byte-for-byte', () => {
  const bundledLicense = readFileSync(new URL('../node_modules/hanzi-writer-data/ARPHICPL.TXT', import.meta.url));
  const redistributedLicense = readFileSync(new URL('../data/ARPHICPL.TXT', import.meta.url));

  assert.deepEqual(redistributedLicense, bundledLicense);
});
