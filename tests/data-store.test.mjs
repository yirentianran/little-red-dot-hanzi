import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

import dataStoreModule from '../js/data-store.js';

const { createDataStore } = dataStoreModule;

function geometry(strokeCount = 1) {
  return {
    strokeCount,
    strokes: Array.from({ length: strokeCount }, () => 'M 0 0 L 1 1'),
    medians: Array.from({ length: strokeCount }, () => [[0, 0], [1, 1]])
  };
}

function fixtureLibrary() {
  const characters = {
    重: geometry(9),
    薄: geometry(16),
    郭: geometry(10),
    潮: geometry(15),
    巢: geometry(11),
    驻: geometry(8)
  };

  return {
    schemaVersion: 1,
    geometryNotice: {
      date: '2026-07-25',
      source: 'fixture',
      license: 'fixture',
      changes: ['fixture subset']
    },
    curriculum: {
      schemaVersion: 1,
      book: {
        publisher: '人民教育出版社',
        approvalYear: 2019,
        grade: 4,
        volume: '上册'
      },
      units: [
        {
          id: 'unit-1',
          title: '第一单元',
          lessons: [
            {
              kind: 'lesson',
              id: 'lesson-1',
              number: 1,
              title: '示例课文',
              recognize: [
                { character: '重', pinyin: 'zhòng', audio: 'zhong4' },
                { character: '薄', pinyin: 'bó', audio: 'bo2', counted: false }
              ],
              write: [
                { character: '郭', pinyin: 'guō', audio: 'guo1' },
                { character: '潮', pinyin: 'cháo', audio: 'chao2' },
                { character: '重', pinyin: 'chóng', audio: 'chong2' }
              ]
            },
            {
              kind: 'lesson',
              id: 'lesson-3',
              number: 3,
              title: '现代诗二首',
              recognize: [{ character: '巢', pinyin: 'cháo', audio: 'chao2' }],
              write: []
            }
          ]
        },
        {
          id: 'unit-2',
          title: '第二单元',
          lessons: [
            {
              kind: 'garden',
              id: 'garden-2',
              title: '语文园地二',
              recognize: [{ character: '驻', pinyin: 'zhù', audio: 'zhu4' }],
              write: []
            }
          ]
        }
      ]
    },
    characters,
    audio: {
      format: 'audio/mpeg',
      readings: {
        zhong4: { file: 'assets/audio/zhong4.mp3' },
        bo2: { file: 'assets/audio/bo2.mp3' },
        guo1: { file: 'assets/audio/guo1.mp3' },
        chao2: { file: 'assets/audio/chao2.mp3' },
        chong2: { file: 'assets/audio/chong2.mp3' },
        zhu4: { file: 'assets/audio/zhu4.mp3' }
      }
    },
    notices: {
      geometryLicense: 'data/ARPHICPL.TXT',
      geometrySource: 'data/source-data-license.md',
      audioAttribution: 'assets/audio/THIRD_PARTY_NOTICES.md',
      audioLicense: 'assets/audio/CC-BY-SA-3.0.html'
    }
  };
}

async function loadRuntimeLibrary() {
  const source = await readFile(new URL('../data/library-data.js', import.meta.url), 'utf8');
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename: 'data/library-data.js' });
  return context.window.HANZI_LIBRARY;
}

test('builds cached frozen directory and section view models with distinct counts', () => {
  const library = fixtureLibrary();
  const store = createDataStore(library);
  const units = store.getUnits();
  const firstUnit = units[0];
  const lesson = firstUnit.sections[0];

  assert.equal(store.getUnits(), units);
  assert.equal(store.getUnit('unit-1'), firstUnit);
  assert.equal(store.getLesson('lesson-1'), lesson);
  assert.equal(firstUnit.sectionCount, 2);
  assert.deepEqual(
    {
      recognizeDisplayed: lesson.recognizeDisplayed,
      recognizeCounted: lesson.recognizeCounted,
      polyphonicReviews: lesson.polyphonicReviews,
      write: lesson.write
    },
    { recognizeDisplayed: 2, recognizeCounted: 1, polyphonicReviews: 1, write: 3 }
  );
  assert.deepEqual(
    {
      recognizeDisplayed: firstUnit.recognizeDisplayed,
      recognizeCounted: firstUnit.recognizeCounted,
      polyphonicReviews: firstUnit.polyphonicReviews,
      write: firstUnit.write
    },
    { recognizeDisplayed: 3, recognizeCounted: 2, polyphonicReviews: 1, write: 3 }
  );
  assert.ok(Object.isFrozen(store));
  assert.ok(Object.isFrozen(units));
  assert.ok(Object.isFrozen(firstUnit));
  assert.ok(Object.isFrozen(firstUnit.sections));
  assert.ok(Object.isFrozen(lesson));
  assert.equal(store.getUnit('missing'), null);
  assert.equal(store.getLesson('missing'), null);
});

test('copies and freezes small entries without changing the input library', () => {
  const library = fixtureLibrary();
  const before = structuredClone(library);
  const inputEntry = library.curriculum.units[0].lessons[0].recognize[0];
  const store = createDataStore(library);
  const entries = store.getEntries('lesson-1', 'recognize');

  assert.notEqual(entries, library.curriculum.units[0].lessons[0].recognize);
  assert.notEqual(entries[0], inputEntry);
  assert.deepEqual(entries[0], inputEntry);
  assert.ok(Object.isFrozen(entries));
  assert.ok(Object.isFrozen(entries[0]));
  assert.throws(() => {
    entries[0].pinyin = 'changed';
  }, TypeError);
  assert.deepEqual(library, before);
  assert.equal(store.getEntries('missing', 'write'), null);
  assert.equal(store.getEntries('lesson-1', 'missing'), null);
});

test('resolves a character or index with group-specific reading and immutable neighbors', () => {
  const store = createDataStore(fixtureLibrary());
  const first = store.resolve({ lessonId: 'lesson-1', group: 'write', character: '郭' });
  const middle = store.resolve({ lessonId: 'lesson-1', group: 'write', index: 1 });
  const recognizeReading = store.resolve({ lessonId: 'lesson-1', group: 'recognize', character: '重' });
  const writeReading = store.resolve({ lessonId: 'lesson-1', group: 'write', character: '重' });

  assert.equal(first.entry.pinyin, 'guō');
  assert.equal(first.index, 0);
  assert.equal(first.total, 3);
  assert.equal(first.previous, null);
  assert.equal(first.next.character, '潮');
  assert.equal(middle.entry.character, '潮');
  assert.equal(middle.previous.character, '郭');
  assert.equal(middle.next.character, '重');
  assert.equal(writeReading.next, null);
  assert.equal(recognizeReading.entry.audio, 'zhong4');
  assert.equal(writeReading.entry.audio, 'chong2');
  assert.equal(writeReading.audio.file, 'assets/audio/chong2.mp3');
  assert.equal(first.unit, store.getUnit('unit-1'));
  assert.equal(first.lesson, store.getLesson('lesson-1'));
  assert.equal(first.entries, store.getEntries('lesson-1', 'write'));
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.audio));
});

test('character selection takes precedence and invalid selectors return null', () => {
  const store = createDataStore(fixtureLibrary());

  assert.equal(store.resolve({ lessonId: 'lesson-1', group: 'write', character: 'missing', index: 0 }), null);
  assert.equal(store.resolve({ lessonId: 'lesson-1', group: 'write', index: -1 }), null);
  assert.equal(store.resolve({ lessonId: 'lesson-1', group: 'write', index: 1.5 }), null);
  assert.equal(store.resolve({ lessonId: 'lesson-1', group: 'write', index: 3 }), null);
  assert.equal(store.resolve({ lessonId: 'lesson-1', group: 'write' }), null);
  assert.equal(store.resolve({ lessonId: 'missing', group: 'write', index: 0 }), null);
  assert.equal(store.resolve({ lessonId: 'lesson-1', group: 'missing', index: 0 }), null);
  assert.equal(store.resolve(null), null);
});

test('prefers non-empty write groups and falls back to recognize for lessons and gardens', () => {
  const store = createDataStore(fixtureLibrary());

  assert.equal(store.getDefaultGroup('lesson-1'), 'write');
  assert.equal(store.getDefaultGroup('lesson-3'), 'recognize');
  assert.equal(store.getDefaultGroup('garden-2'), 'recognize');
  assert.equal(store.getDefaultGroup('missing'), null);
  assert.equal(store.hasLesson('lesson-1'), true);
  assert.equal(store.hasLesson('garden-2'), true);
  assert.equal(store.hasLesson('toString'), false);
  assert.equal(store.resolve({ lessonId: 'lesson-3', group: 'write', index: 0 }), null);
});

test('shares geometry identity while keeping resolve read-only and exposes frozen metadata copies', () => {
  const library = fixtureLibrary();
  const originalGeometry = library.characters['潮'];
  const originalGeometrySnapshot = structuredClone(originalGeometry);
  const store = createDataStore(library);
  const state = store.resolve({ lessonId: 'lesson-1', group: 'write', character: '潮' });

  assert.equal(store.getGeometry('潮'), originalGeometry);
  assert.equal(state.geometry, originalGeometry);
  assert.deepEqual(originalGeometry, originalGeometrySnapshot);
  assert.equal(store.getGeometry('missing'), null);
  assert.deepEqual(store.getAudio('chao2'), { file: 'assets/audio/chao2.mp3' });
  assert.equal(store.getAudio('missing'), null);
  assert.deepEqual(store.getNotices(), library.notices);
  assert.notEqual(store.getNotices(), library.notices);
  assert.ok(Object.isFrozen(store.getAudio('chao2')));
  assert.ok(Object.isFrozen(store.getNotices()));
});

test('validates runtime shape, duplicate ids, duplicate group characters, and own references with paths', () => {
  assert.throws(() => createDataStore(null), /library.*object/i);

  const badSchema = fixtureLibrary();
  badSchema.schemaVersion = 2;
  assert.throws(() => createDataStore(badSchema), /library\.schemaVersion.*1/i);

  const duplicateUnit = fixtureLibrary();
  duplicateUnit.curriculum.units.push({ ...duplicateUnit.curriculum.units[0] });
  assert.throws(() => createDataStore(duplicateUnit), /curriculum\.units\[2\]\.id.*duplicate.*unit-1/i);

  const duplicateSection = fixtureLibrary();
  duplicateSection.curriculum.units[1].lessons[0].id = 'lesson-1';
  assert.throws(() => createDataStore(duplicateSection), /curriculum\.units\[1\]\.lessons\[0\]\.id.*duplicate.*lesson-1/i);

  const duplicateCharacter = fixtureLibrary();
  duplicateCharacter.curriculum.units[0].lessons[0].write.push({
    character: '潮', pinyin: 'cháo', audio: 'chao2'
  });
  assert.throws(() => createDataStore(duplicateCharacter), /write\[3\]\.character.*duplicate.*潮/i);

  const missingGeometry = fixtureLibrary();
  delete missingGeometry.characters['郭'];
  assert.throws(() => createDataStore(missingGeometry), /write\[0\]\.character.*geometry.*郭/i);

  const malformedGeometry = fixtureLibrary();
  malformedGeometry.characters['郭'] = null;
  assert.throws(() => createDataStore(malformedGeometry), /library\.characters\.郭.*object/i);

  const missingAudio = fixtureLibrary();
  delete missingAudio.audio.readings.guo1;
  assert.throws(() => createDataStore(missingAudio), /write\[0\]\.audio.*guo1/i);

  const inheritedGeometry = fixtureLibrary();
  inheritedGeometry.characters = Object.create({ 郭: inheritedGeometry.characters['郭'] });
  Object.assign(inheritedGeometry.characters, {
    重: geometry(), 薄: geometry(), 潮: geometry(), 巢: geometry(), 驻: geometry()
  });
  assert.throws(() => createDataStore(inheritedGeometry), /write\[0\]\.character.*geometry.*郭/i);
});

test('copies only known notice fields without allowing prototype-shaped keys to alter the result', () => {
  const library = fixtureLibrary();
  library.notices = JSON.parse(`{
    "geometryLicense":"data/ARPHICPL.TXT",
    "geometrySource":"data/source-data-license.md",
    "audioAttribution":"assets/audio/THIRD_PARTY_NOTICES.md",
    "audioLicense":"assets/audio/CC-BY-SA-3.0.html",
    "__proto__":{"polluted":true}
  }`);

  const notices = createDataStore(library).getNotices();

  assert.equal(Object.getPrototypeOf(notices), Object.prototype);
  assert.equal(Object.hasOwn(notices, '__proto__'), false);
  assert.equal({}.polluted, undefined);
});

test('loads the real bundle with 8 units, 31 ordered sections, gardens, and shared geometry', async () => {
  const library = await loadRuntimeLibrary();
  const store = createDataStore(library);
  const units = store.getUnits();
  const sections = units.flatMap(unit => unit.sections);
  const state = store.resolve({ lessonId: 'lesson-1', group: 'write', character: '潮' });

  assert.equal(units.length, 8);
  assert.equal(sections.length, 31);
  assert.deepEqual(units.map(unit => unit.id), [
    'unit-1', 'unit-2', 'unit-3', 'unit-4', 'unit-5', 'unit-6', 'unit-7', 'unit-8'
  ]);
  assert.equal(store.getLesson('garden-2').kind, 'garden');
  assert.equal(store.getDefaultGroup('lesson-3'), 'recognize');
  assert.equal(state.entry.pinyin, 'cháo');
  assert.equal(state.next.character, '据');
  assert.equal(state.geometry, library.characters['潮']);
  assert.equal(store.getGeometry('郭'), null);
  assert.equal(store.resolve({ lessonId: 'lesson-1', group: 'write', character: '郭' }), null);
});

test('classic scripts merge the store API into window.HanziApp without DOM or fetch', async () => {
  const source = await readFile(new URL('../js/data-store.js', import.meta.url), 'utf8');
  const context = { window: { HanziApp: { existing: true } } };

  vm.runInNewContext(source, context, { filename: 'js/data-store.js' });

  assert.equal(context.window.HanziApp.existing, true);
  assert.equal(typeof context.window.HanziApp.createDataStore, 'function');
  assert.doesNotMatch(source, /\b(?:fetch|document)\b/);
});
