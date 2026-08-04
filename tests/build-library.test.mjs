import assert from 'node:assert/strict';
import vm from 'node:vm';
import test from 'node:test';

import { buildRuntimeSource } from '../scripts/build-library.mjs';

const entry = { character: '宵', pinyin: 'xiāo', audio: 'xiao1', words: ['元宵', '宵夜'] };
const catalog = {
  schemaVersion: 2,
  stages: [{ id: 'g4-fall', grade: 4, title: '四年级上阶段', setIds: ['g4f-01'] }],
  sets: [{ id: 'g4f-01', number: 1, title: '第1组', entries: [entry] }]
};
const characters = {
  schemaVersion: 1,
  modificationNotice: {
    date: '2026-08-03', source: 'hanzi-writer-data@2.0.1', license: 'ARPHICPL.TXT',
    changes: ['Extracted independent subset.']
  },
  characters: { 宵: { strokeCount: 1, strokes: ['M0 0'], medians: [[[0, 0], [1, 1]]] } }
};
const manifest = {
  format: 'audio/mpeg',
  readings: { xiao1: { file: 'assets/audio/xiao1.mp3', sha256: 'a'.repeat(64) } }
};

function payload(source) {
  const context = { window: {} };
  vm.runInNewContext(source, context);
  return JSON.parse(JSON.stringify(context.window.HANZI_LIBRARY));
}

test('builds a schema-1 compatibility payload for the unchanged application runtime', () => {
  const source = buildRuntimeSource(catalog, characters, manifest);
  const runtime = payload(source);
  assert.equal(runtime.schemaVersion, 1);
  assert.deepEqual(runtime.curriculum.book, {
    publisher: '独立编排', approvalYear: 2026, grade: 4, volume: '上阶段'
  });
  assert.equal(runtime.curriculum.units[0].id, 'g4-fall');
  assert.deepEqual(runtime.curriculum.units[0].lessons[0], {
    kind: 'garden', id: 'g4f-01', title: '第1组', recognize: [], write: [entry]
  });
  assert.deepEqual(runtime.audio.readings, { xiao1: { file: 'assets/audio/xiao1.mp3' } });
  assert.doesNotMatch(source, /https?:\/\/|\bfetch\b|<\/script/i);
});

test('rejects incomplete catalog resources and extra audio readings', () => {
  assert.throws(() => buildRuntimeSource(catalog, { ...characters, characters: {} }, manifest), /missing geometry/);
  assert.throws(() => buildRuntimeSource(catalog, characters, {
    ...manifest,
    readings: { ...manifest.readings, extra1: { file: 'assets/audio/extra1.mp3' } }
  }), /unreferenced readings/);
});

test('escapes script-breaking catalog text in the generated classic script', () => {
  const hostile = structuredClone(catalog);
  hostile.sets[0].title = '</script><script>alert(1)</script>';
  const source = buildRuntimeSource(hostile, characters, manifest);
  assert.doesNotMatch(source, /<\/script/i);
  assert.equal(payload(source).curriculum.units[0].lessons[0].title,
    '</script><script>alert(1)</script>');
});
