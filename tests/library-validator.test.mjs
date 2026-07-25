import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { validateLibrary } from '../scripts/lib/library-validator.mjs';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const validCurriculum = fixture('valid-curriculum.json');
const validCharacters = fixture('valid-characters.json');
const validAudioIds = new Set(['guo1']);

const clone = value => structuredClone(value);

test('accepts matching curriculum, character geometry, and audio ids', () => {
  assert.deepEqual(validateLibrary(validCurriculum, validCharacters, validAudioIds), []);
});

test('rejects malformed curriculum containers, identifiers, and lesson groups', () => {
  const malformedCurriculum = {
    units: [
      { id: 'unit-1', lessons: [{ id: 'lesson-1', recognize: [], write: [] }] },
      { id: 'unit-1', lessons: [] },
      { id: ' ', lessons: {} },
      {
        id: 'unit-2',
        lessons: [null, { id: ' ', recognize: {}, write: null }]
      },
      null
    ]
  };

  const errors = validateLibrary(malformedCurriculum, validCharacters, validAudioIds);
  assert.match(errors.join('\n'), /duplicate unit id: unit-1/i);
  assert.match(errors.join('\n'), /unit.*blank id/i);
  assert.match(errors.join('\n'), /unit.*lessons.*array/i);
  assert.match(errors.join('\n'), /unit.*must be an object/i);
  assert.match(errors.join('\n'), /lesson.*must be an object/i);
  assert.match(errors.join('\n'), /lesson.*blank id/i);
  assert.match(errors.join('\n'), /recognize.*array/i);
  assert.match(errors.join('\n'), /write.*array/i);
});

test('rejects a null curriculum and a non-array units field', () => {
  assert.match(validateLibrary(null, validCharacters, validAudioIds).join('\n'), /curriculum.*object/i);
  assert.match(validateLibrary({ units: {} }, validCharacters, validAudioIds).join('\n'), /units.*array/i);
});

test('reports lesson and character for missing geometry', () => {
  const errors = validateLibrary(validCurriculum, {}, validAudioIds);

  assert.match(errors.join('\n'), /lesson-1.*郭.*geometry/i);
});

test('reports a mismatched stroke count', () => {
  const characters = clone(validCharacters);
  characters.郭.strokes.pop();

  const errors = validateLibrary(validCurriculum, characters, validAudioIds);
  assert.match(errors.join('\n'), /lesson-1.*郭.*strokeCount/i);
});

test('requires array geometry and a positive integer strokeCount', () => {
  const characters = clone(validCharacters);
  characters.郭 = { strokeCount: 0, strokes: 'bad', medians: 'bad' };

  const errors = validateLibrary(validCurriculum, characters, validAudioIds);
  assert.match(errors.join('\n'), /lesson-1.*郭.*strokes.*array/i);
  assert.match(errors.join('\n'), /lesson-1.*郭.*medians.*array/i);
  assert.match(errors.join('\n'), /lesson-1.*郭.*strokeCount.*positive integer/i);
});

test('requires strokeCount to be an integer matching both geometry arrays', () => {
  const characters = clone(validCharacters);
  characters.郭.strokeCount = 1.5;

  const errors = validateLibrary(validCurriculum, characters, validAudioIds);
  assert.match(errors.join('\n'), /lesson-1.*郭.*strokeCount.*positive integer/i);
  assert.match(errors.join('\n'), /lesson-1.*郭.*strokeCount.*strokes.*medians/i);
});

test('accumulates duplicate lesson and group character errors', () => {
  const curriculum = clone(validCurriculum);
  curriculum.units[0].lessons[0].write.push(clone(curriculum.units[0].lessons[0].write[0]));
  curriculum.units[0].lessons.push(clone(curriculum.units[0].lessons[0]));

  const errors = validateLibrary(curriculum, validCharacters, validAudioIds);
  assert.match(errors.join('\n'), /duplicate lesson id: lesson-1/i);
  assert.match(errors.join('\n'), /lesson-1.*郭.*duplicate.*write/i);
  assert.ok(errors.length >= 3, 'validation should retain every discovered error');
});

test('reports non-single-code-point characters, blank pinyin, and missing audio', () => {
  const curriculum = clone(validCurriculum);
  const entry = curriculum.units[0].lessons[0].write[0];
  entry.character = '郭家';
  entry.pinyin = '   ';
  entry.audio = 'missing-audio';

  const errors = validateLibrary(curriculum, validCharacters, validAudioIds);
  assert.match(errors.join('\n'), /lesson-1.*郭家.*one code point/i);
  assert.match(errors.join('\n'), /lesson-1.*郭家.*pinyin/i);
  assert.match(errors.join('\n'), /lesson-1.*郭家.*missing audio.*missing-audio/i);
});

test('reports pinyin that is not NFC-normalized', () => {
  const curriculum = clone(validCurriculum);
  curriculum.units[0].lessons[0].write[0].pinyin = 'guo\u0304';

  const errors = validateLibrary(curriculum, validCharacters, validAudioIds);
  assert.match(errors.join('\n'), /lesson-1.*郭.*normalized pinyin/i);
});

test('reports malformed stroke paths', () => {
  const characters = clone(validCharacters);
  characters.郭.strokes[1] = 'not a path';

  const errors = validateLibrary(validCurriculum, characters, validAudioIds);
  assert.match(errors.join('\n'), /lesson-1.*郭.*stroke 2.*path/i);
});

test('reports SVG arc paths with non-binary flags', () => {
  const characters = clone(validCharacters);
  characters.郭.strokes[0] = 'M0 0 A1 1 0 2 2 5 5';

  const errors = validateLibrary(validCurriculum, characters, validAudioIds);
  assert.match(errors.join('\n'), /lesson-1.*郭.*stroke 1.*path/i);
});

test('reports decimal and exponent SVG arc flag spellings', () => {
  for (const path of [
    'M0 0 A1 1 0 1.0 0 5 5',
    'M0 0 a1 1 0 1 1e0 5 5'
  ]) {
    const characters = clone(validCharacters);
    characters.郭.strokes[0] = path;

    const errors = validateLibrary(validCurriculum, characters, validAudioIds);
    assert.match(errors.join('\n'), /lesson-1.*郭.*stroke 1.*path/i, path);
  }
});

test('accepts SVG arc paths with binary flags', () => {
  const characters = clone(validCharacters);
  characters.郭.strokes[0] = 'M0 0 A1 1 0 1 0 5 5';

  assert.deepEqual(validateLibrary(validCurriculum, characters, validAudioIds), []);
});

test('reports SVG arcs with negative radii', () => {
  for (const path of [
    'M0 0 A-1 1 0 0 0 5 5',
    'M0 0 a1 -1 0 0 0 5 5'
  ]) {
    const characters = clone(validCharacters);
    characters.郭.strokes[0] = path;

    const errors = validateLibrary(validCurriculum, characters, validAudioIds);
    assert.match(errors.join('\n'), /lesson-1.*郭.*stroke 1.*path/i, path);
  }
});

test('reports medians without two numeric coordinate points', () => {
  const characters = clone(validCharacters);
  characters.郭.medians[1] = [[50, 0], ['x', 100]];

  const errors = validateLibrary(validCurriculum, characters, validAudioIds);
  assert.match(errors.join('\n'), /lesson-1.*郭.*median 2/i);
});

test('reports median points that contain extra coordinates', () => {
  const characters = clone(validCharacters);
  characters.郭.medians[0] = [[0, 0, 1], [100, 0]];

  const errors = validateLibrary(validCurriculum, characters, validAudioIds);
  assert.match(errors.join('\n'), /lesson-1.*郭.*median 1/i);
});
