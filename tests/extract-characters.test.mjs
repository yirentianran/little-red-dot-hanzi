import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { extractCharacters } from '../scripts/extract-characters.mjs';

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

  assert.deepEqual(Object.keys(result), ['郭']);
  assert.deepEqual(result.郭, {
    strokeCount: 2,
    strokes: source.strokes,
    medians: source.medians
  });
  assert.equal(Object.hasOwn(result.郭, 'radStrokes'), false);
});

test('orders output deterministically regardless of curriculum or upstream insertion order', () => {
  const upstreamA = { 汉: sourceGeometry('-han'), 郭: sourceGeometry('-guo') };
  const upstreamB = { 郭: sourceGeometry('-guo'), 汉: sourceGeometry('-han') };

  const first = extractCharacters(curriculum('汉', '郭'), upstreamA);
  const second = extractCharacters(curriculum('郭', '汉'), upstreamB);

  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(Object.keys(first), [...Object.keys(first)].sort());
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

  assert.deepEqual(Object.keys(generated), expected);
  for (const [character, geometry] of Object.entries(generated)) {
    assert.deepEqual(Object.keys(geometry), ['strokeCount', 'strokes', 'medians'], character);
    assert.ok(Number.isInteger(geometry.strokeCount) && geometry.strokeCount > 0, character);
    assert.equal(geometry.strokeCount, geometry.strokes.length, `${character} strokes`);
    assert.equal(geometry.strokeCount, geometry.medians.length, `${character} medians`);
  }
});

test('keeps the upstream ARPHICPL terms byte-for-byte', () => {
  const bundledLicense = readFileSync(new URL('../node_modules/hanzi-writer-data/ARPHICPL.TXT', import.meta.url));
  const redistributedLicense = readFileSync(new URL('../data/ARPHICPL.TXT', import.meta.url));

  assert.deepEqual(redistributedLicense, bundledLicense);
});
