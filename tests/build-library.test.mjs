import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

import { buildRuntimeSource, runBuild } from '../scripts/build-library.mjs';

const execFile = promisify(execFileCallback);

const geometryNotice = {
  date: '2026-07-25',
  source: 'hanzi-writer-data@2.0.1',
  license: 'ARPHICPL.TXT',
  changes: [
    'Extracted the 1-character curriculum subset.',
    'Removed unused upstream fields.'
  ]
};

const curriculum = {
  schemaVersion: 1,
  book: {
    publisher: '人民教育出版社',
    approvalYear: 2019,
    grade: 4,
    volume: '上册'
  },
  units: [{
    id: 'unit-1',
    title: '第一单元',
    lessons: [{
      kind: 'lesson',
      id: 'lesson-1',
      number: 1,
      title: '示例',
      recognize: [{ character: '郭', pinyin: 'guō', audio: 'guo1' }],
      write: []
    }]
  }]
};

const characterDocument = {
  schemaVersion: 1,
  modificationNotice: geometryNotice,
  characters: {
    郭: {
      strokeCount: 1,
      strokes: ['M 0 0 L 1 1'],
      medians: [[[0, 0], [1, 1]]]
    }
  }
};

const audioRecord = id => ({
  file: `assets/audio/${id}.mp3`,
  sourceFile: `64k/syllabs/cmn-${id}.mp3`,
  sourceLabel: id,
  bytes: 123,
  sha256: 'a'.repeat(64),
  metadataVerified: true,
  auditoryReviewed: false
});

const audioManifest = {
  schemaVersion: 1,
  format: 'audio/mpeg',
  source: {
    repository: 'https://example.invalid/upstream-audio',
    commit: 'fixture-commit',
    subset: '64k/syllabs',
    license: 'CC-BY-SA-3.0',
    licenseUrl: 'https://example.invalid/license',
    attribution: 'Fixture speaker'
  },
  readings: {
    guo1: audioRecord('guo1')
  }
};

function runtimePayload(source) {
  const context = { window: {} };
  vm.runInNewContext(source, context);
  return JSON.parse(JSON.stringify(context.window.HANZI_LIBRARY));
}

async function fixtureRoot(t) {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'hanzi-library-build-'));
  t.after(() => rm(rootDir, { force: true, recursive: true }));
  await mkdir(path.join(rootDir, 'data'), { recursive: true });
  await mkdir(path.join(rootDir, 'assets/audio'), { recursive: true });
  await writeFile(path.join(rootDir, 'data/curriculum.json'), `${JSON.stringify(curriculum, null, 2)}\n`);
  await writeFile(path.join(rootDir, 'data/characters.json'), `${JSON.stringify(characterDocument, null, 2)}\n`);
  await writeFile(path.join(rootDir, 'assets/audio/manifest.json'), `${JSON.stringify(audioManifest, null, 2)}\n`);
  await writeFile(path.join(rootDir, 'assets/audio/guo1.mp3'), 'fixture mp3 bytes');
  await writeFile(path.join(rootDir, 'data/ARPHICPL.TXT'), 'fixture geometry license');
  await writeFile(path.join(rootDir, 'data/source-data-license.md'), 'fixture geometry source notice');
  await writeFile(path.join(rootDir, 'assets/audio/THIRD_PARTY_NOTICES.md'), 'fixture audio attribution');
  await writeFile(path.join(rootDir, 'assets/audio/CC-BY-SA-3.0.html'), 'fixture audio license');
  return rootDir;
}

async function candidateFiles(rootDir) {
  return (await readdir(path.join(rootDir, 'data'))).filter(name => name.includes('.candidate-'));
}

test('builds a classic offline script with structured provenance and slim audio data', () => {
  const output = buildRuntimeSource(curriculum, characterDocument, audioManifest);

  assert.match(output, /^\/\*[\s\S]*CHARACTER GEOMETRY MODIFICATION NOTICE/);
  for (const value of [geometryNotice.date, geometryNotice.source, geometryNotice.license, ...geometryNotice.changes]) {
    assert.match(output, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(output, /data\/ARPHICPL\.TXT/);
  assert.match(output, /data\/source-data-license\.md/);
  assert.match(output, /window\.HANZI_LIBRARY = /);
  assert.doesNotMatch(output, /https?:\/\//);
  for (const field of ['sourceFile', 'sourceLabel', 'sha256', 'bytes', 'metadataVerified', 'auditoryReviewed']) {
    assert.doesNotMatch(output, new RegExp(`"${field}"`));
  }

  const payload = runtimePayload(output);
  assert.equal(payload.schemaVersion, 1);
  assert.deepEqual(payload.geometryNotice, geometryNotice);
  assert.deepEqual(payload.curriculum, curriculum);
  assert.deepEqual(payload.characters, characterDocument.characters);
  assert.deepEqual(payload.audio, {
    format: 'audio/mpeg',
    readings: { guo1: { file: 'assets/audio/guo1.mp3' } }
  });
  assert.deepEqual(payload.notices, {
    geometryLicense: 'data/ARPHICPL.TXT',
    geometrySource: 'data/source-data-license.md',
    audioAttribution: 'assets/audio/THIRD_PARTY_NOTICES.md',
    audioLicense: 'assets/audio/CC-BY-SA-3.0.html'
  });
});

test('rejects malformed source documents and missing cross-references with source locations', () => {
  const cases = [
    [null, characterDocument, audioManifest, /data\/curriculum\.json.*object/i],
    [{ ...curriculum, schemaVersion: 2 }, characterDocument, audioManifest, /data\/curriculum\.json\.schemaVersion.*1/i],
    [{ ...curriculum, book: {} }, characterDocument, audioManifest, /data\/curriculum\.json\.book\.publisher/i],
    [{ ...curriculum, units: [] }, characterDocument, audioManifest, /data\/curriculum\.json\.units.*non-empty/i],
    [{ ...curriculum, units: [{ id: 'unit-1', title: '第一单元' }] }, characterDocument, audioManifest, /data\/curriculum\.json\.units\[0\]\.lessons/i],
    [{ ...curriculum, units: [{ ...curriculum.units[0], lessons: [{ kind: 'lesson', id: 'lesson-1', number: 1, title: '示例' }] }] }, characterDocument, audioManifest, /data\/curriculum\.json\.units\[0\]\.lessons\[0\]\.recognize/i],
    [{ ...curriculum, units: [{ ...curriculum.units[0], lessons: [{ ...curriculum.units[0].lessons[0], recognize: [{}] }] }] }, characterDocument, audioManifest, /data\/curriculum\.json.*recognize\[0\]\.character/i],
    [{ ...curriculum, units: [{ ...curriculum.units[0], lessons: [{ ...curriculum.units[0].lessons[0], recognize: [{ character: '郭', pinyin: 'guo1', audio: 'guo1' }] }] }] }, characterDocument, audioManifest, /data\/curriculum\.json.*recognize\[0\]\.pinyin.*tone-marked/i],
    [curriculum, null, audioManifest, /data\/characters\.json.*object/i],
    [curriculum, { ...characterDocument, schemaVersion: 2 }, audioManifest, /data\/characters\.json\.schemaVersion.*1/i],
    [curriculum, { ...characterDocument, modificationNotice: { ...geometryNotice, changes: [] } }, audioManifest, /data\/characters\.json\.modificationNotice\.changes/i],
    [curriculum, { ...characterDocument, characters: { 外: characterDocument.characters.郭 } }, audioManifest, /data\/characters\.json[\s\S]*郭.*missing geometry/i],
    [curriculum, {
      ...characterDocument,
      characters: { 郭: { ...characterDocument.characters.郭, strokeCount: 2 } }
    }, audioManifest, /data\/characters\.json\.characters\.郭.*strokeCount/i],
    [curriculum, characterDocument, null, /assets\/audio\/manifest\.json.*object/i],
    [curriculum, characterDocument, { ...audioManifest, schemaVersion: 2 }, /assets\/audio\/manifest\.json\.schemaVersion.*1/i],
    [curriculum, characterDocument, { ...audioManifest, format: '' }, /assets\/audio\/manifest\.json\.format/i],
    [curriculum, characterDocument, { ...audioManifest, source: null }, /assets\/audio\/manifest\.json\.source.*object/i],
    [curriculum, characterDocument, {
      ...audioManifest,
      readings: { guo1: { file: 'assets/audio/guo1.mp3' } }
    }, /assets\/audio\/manifest\.json\.readings\.guo1\.sourceFile/i],
    [curriculum, characterDocument, {
      ...audioManifest,
      readings: { wai4: audioRecord('wai4') }
    }, /assets\/audio\/manifest\.json[\s\S]*missing audio.*guo1/i],
    [curriculum, characterDocument, {
      ...audioManifest,
      readings: { guo1: { ...audioRecord('guo1'), file: '../guo1.mp3' } }
    }, /assets\/audio\/manifest\.json\.readings\.guo1\.file.*relative.*MP3/i]
  ];

  for (const [badCurriculum, badCharacters, badAudio, expected] of cases) {
    assert.throws(
      () => buildRuntimeSource(badCurriculum, badCharacters, badAudio),
      expected
    );
  }
});

test('requires exact curriculum geometry and audio mappings plus MP3 format', () => {
  const extraGeometry = {
    ...characterDocument,
    characters: {
      ...characterDocument.characters,
      外: characterDocument.characters.郭
    }
  };
  assert.throws(
    () => buildRuntimeSource(curriculum, extraGeometry, audioManifest),
    /data\/characters\.json.*unreferenced character.*外/i
  );

  const extraAudio = {
    ...audioManifest,
    readings: {
      ...audioManifest.readings,
      wai4: audioRecord('wai4')
    }
  };
  assert.throws(
    () => buildRuntimeSource(curriculum, characterDocument, extraAudio),
    /assets\/audio\/manifest\.json.*unreferenced audio.*wai4/i
  );
  assert.throws(
    () => buildRuntimeSource(curriculum, characterDocument, {
      ...audioManifest,
      format: 'audio/ogg'
    }),
    /assets\/audio\/manifest\.json\.format.*audio\/mpeg/i
  );
});

test('refuses any network URL or fetch token that survives into generated source', () => {
  for (const publisher of ['https://example.invalid/data', 'fetch']) {
    assert.throws(
      () => buildRuntimeSource({
        ...curriculum,
        book: { ...curriculum.book, publisher }
      }, characterDocument, audioManifest),
      /generated runtime source.*forbidden.*(?:network URL|fetch)/i
    );
  }
});

test('accepts standard tone marks for u and u-diaeresis finals', () => {
  for (const pinyin of ['dùn', 'lǖ']) {
    const markedCurriculum = structuredClone(curriculum);
    markedCurriculum.units[0].lessons[0].recognize[0].pinyin = pinyin;
    assert.doesNotThrow(
      () => buildRuntimeSource(markedCurriculum, characterDocument, audioManifest),
      pinyin
    );
  }
});

test('sorts character and audio keys deterministically without mutating inputs or lesson order', () => {
  const expandedCurriculum = structuredClone(curriculum);
  expandedCurriculum.units[0].lessons[0].recognize.push({
    character: '外', pinyin: 'wài', audio: 'wai4'
  });
  const outsideGeometry = {
    strokeCount: 1,
    strokes: ['M 1 1 L 2 2'],
    medians: [[[1, 1], [2, 2]]]
  };
  const outsideAudio = audioRecord('wai4');
  const charactersA = {
    ...characterDocument,
    characters: { 外: outsideGeometry, 郭: characterDocument.characters.郭 }
  };
  const charactersB = {
    ...characterDocument,
    characters: { 郭: characterDocument.characters.郭, 外: outsideGeometry }
  };
  const audioA = {
    ...audioManifest,
    readings: { wai4: outsideAudio, guo1: audioManifest.readings.guo1 }
  };
  const audioB = {
    ...audioManifest,
    readings: { guo1: audioManifest.readings.guo1, wai4: outsideAudio }
  };
  const before = structuredClone({ expandedCurriculum, charactersA, audioA });

  const first = buildRuntimeSource(expandedCurriculum, charactersA, audioA);
  const second = buildRuntimeSource(expandedCurriculum, charactersB, audioB);

  assert.equal(first, second);
  assert.deepEqual({ expandedCurriculum, charactersA, audioA }, before);
  const payload = runtimePayload(first);
  assert.deepEqual(Object.keys(payload.characters), [...Object.keys(payload.characters)].sort());
  assert.deepEqual(Object.keys(payload.audio.readings), [...Object.keys(payload.audio.readings)].sort());
  assert.deepEqual(
    payload.curriculum.units[0].lessons[0].recognize.map(entry => entry.character),
    ['郭', '外']
  );
});

test('escapes script-breaking characters while preserving their runtime values', () => {
  const unsafeCurriculum = structuredClone(curriculum);
  unsafeCurriculum.book.publisher = '出版\u2028社\u2029</script><script>bad()</script>';
  const unsafeCharacters = structuredClone(characterDocument);
  unsafeCharacters.modificationNotice.changes[0] = 'Changed safely */\nwithout ending the notice.';

  const output = buildRuntimeSource(unsafeCurriculum, unsafeCharacters, audioManifest);

  assert.doesNotMatch(output, /\u2028|\u2029|<\/script/i);
  assert.match(output, /\\u2028/);
  assert.match(output, /\\u2029/);
  assert.doesNotMatch(output.slice(0, output.indexOf('window.HANZI_LIBRARY')), /\*\/\s*without/);
  assert.equal(runtimePayload(output).curriculum.book.publisher, unsafeCurriculum.book.publisher);
});

test('runBuild reads one repository root and atomically publishes a complete bundle', async t => {
  const rootDir = await fixtureRoot(t);
  const destination = path.join(rootDir, 'data/library-data.js');
  await writeFile(destination, 'old bundle');
  const messages = [];
  let publishedCandidate;

  const result = await runBuild({
    rootDir,
    stdout: message => messages.push(message),
    renameImpl: async (candidate, outputPath) => {
      publishedCandidate = candidate;
      assert.equal(path.dirname(candidate), path.dirname(destination));
      assert.equal(outputPath, destination);
      assert.notEqual(candidate, destination);
      await rename(candidate, outputPath);
    }
  });

  const output = await readFile(destination, 'utf8');
  const expected = buildRuntimeSource(curriculum, characterDocument, audioManifest);
  assert.equal(output, expected);
  assert.equal(result.outputPath, destination);
  assert.equal(result.bytes, Buffer.byteLength(expected));
  assert.equal(result.sha256, createHash('sha256').update(expected).digest('hex'));
  assert.deepEqual(result.counts, {
    units: 1,
    sections: 1,
    entries: 1,
    characters: 1,
    strokes: 1,
    audioReadings: 1
  });
  assert.match(messages.join('\n'), /1 unit.*1 section.*1 entr.*1 character.*1 stroke.*1 audio/i);
  assert.match(messages.join('\n'), new RegExp(`${result.bytes} bytes`, 'i'));
  assert.match(messages.join('\n'), new RegExp(result.sha256));
  assert.ok(publishedCandidate);
  assert.deepEqual(
    (await readdir(path.join(rootDir, 'data'))).filter(name => name.includes('.candidate-')),
    []
  );
});

test('source read, JSON, and schema failures retain the previous bundle', async t => {
  const rootDir = await fixtureRoot(t);
  const destination = path.join(rootDir, 'data/library-data.js');
  const previous = 'stable previous bundle';
  await writeFile(destination, previous);

  await writeFile(path.join(rootDir, 'data/curriculum.json'), '{ bad JSON');
  await assert.rejects(
    runBuild({ rootDir, stdout: () => {} }),
    /Invalid JSON in data\/curriculum\.json/i
  );
  assert.equal(await readFile(destination, 'utf8'), previous);
  assert.deepEqual(await candidateFiles(rootDir), []);

  await writeFile(path.join(rootDir, 'data/curriculum.json'), `${JSON.stringify(curriculum)}\n`);
  await writeFile(path.join(rootDir, 'data/characters.json'), `${JSON.stringify({
    ...characterDocument,
    schemaVersion: 2
  })}\n`);
  await assert.rejects(
    runBuild({ rootDir, stdout: () => {} }),
    /data\/characters\.json\.schemaVersion.*1/i
  );
  assert.equal(await readFile(destination, 'utf8'), previous);
  assert.deepEqual(await candidateFiles(rootDir), []);

  await rm(path.join(rootDir, 'data/curriculum.json'));
  await assert.rejects(
    runBuild({ rootDir, stdout: () => {} }),
    /Unable to read data\/curriculum\.json/i
  );
  assert.equal(await readFile(destination, 'utf8'), previous);
});

test('a missing local MP3 fails before publication and names its manifest record', async t => {
  const rootDir = await fixtureRoot(t);
  const destination = path.join(rootDir, 'data/library-data.js');
  const previous = 'stable previous bundle';
  await writeFile(destination, previous);
  await rm(path.join(rootDir, 'assets/audio/guo1.mp3'));

  await assert.rejects(
    runBuild({ rootDir, stdout: () => {} }),
    /assets\/audio\/manifest\.json\.readings\.guo1\.file.*local MP3 does not exist/i
  );
  assert.equal(await readFile(destination, 'utf8'), previous);
  assert.deepEqual(await candidateFiles(rootDir), []);
});

test('runBuild verifies every bundled license and attribution target before publishing', async t => {
  const rootDir = await fixtureRoot(t);
  const expectedPaths = [
    'assets/audio/guo1.mp3',
    'data/ARPHICPL.TXT',
    'data/source-data-license.md',
    'assets/audio/THIRD_PARTY_NOTICES.md',
    'assets/audio/CC-BY-SA-3.0.html'
  ];
  const accessed = [];
  await runBuild({
    rootDir,
    stdout: () => {},
    accessImpl: async absolutePath => {
      accessed.push(path.relative(rootDir, absolutePath));
      await access(absolutePath);
    }
  });
  assert.deepEqual(accessed.sort(), expectedPaths.sort());

  const destination = path.join(rootDir, 'data/library-data.js');
  const previous = await readFile(destination, 'utf8');
  await rm(path.join(rootDir, 'data/source-data-license.md'));
  await assert.rejects(
    runBuild({ rootDir, stdout: () => {} }),
    /data\/source-data-license\.md.*notice.*does not exist/i
  );
  assert.equal(await readFile(destination, 'utf8'), previous);
  assert.deepEqual(await candidateFiles(rootDir), []);
});

test('a partial candidate write failure is cleaned up without replacing the old bundle', async t => {
  const rootDir = await fixtureRoot(t);
  const destination = path.join(rootDir, 'data/library-data.js');
  const previous = 'stable previous bundle';
  await writeFile(destination, previous);

  await assert.rejects(
    runBuild({
      rootDir,
      stdout: () => {},
      candidateNameFactory: () => 'write-failure',
      writeFileImpl: async (candidate, source, options) => {
        await writeFile(candidate, source.slice(0, 100), options);
        throw new Error('simulated disk failure');
      }
    }),
    /Unable to write candidate for data\/library-data\.js.*simulated disk failure/i
  );
  assert.equal(await readFile(destination, 'utf8'), previous);
  assert.deepEqual(await candidateFiles(rootDir), []);
});

test('a rename failure removes the complete candidate and retains the old bundle', async t => {
  const rootDir = await fixtureRoot(t);
  const destination = path.join(rootDir, 'data/library-data.js');
  const previous = 'stable previous bundle';
  await writeFile(destination, previous);

  await assert.rejects(
    runBuild({
      rootDir,
      stdout: () => {},
      candidateNameFactory: () => 'rename-failure',
      renameImpl: async () => {
        throw new Error('simulated rename failure');
      }
    }),
    /Unable to rename candidate to data\/library-data\.js.*simulated rename failure/i
  );
  assert.equal(await readFile(destination, 'utf8'), previous);
  assert.deepEqual(await candidateFiles(rootDir), []);
});

test('the committed runtime bundle exactly represents every audited source record', async () => {
  const rootDir = fileURLToPath(new URL('../', import.meta.url));
  const realCurriculum = JSON.parse(await readFile(path.join(rootDir, 'data/curriculum.json'), 'utf8'));
  const realCharacters = JSON.parse(await readFile(path.join(rootDir, 'data/characters.json'), 'utf8'));
  const realAudio = JSON.parse(await readFile(path.join(rootDir, 'assets/audio/manifest.json'), 'utf8'));
  const expectedSource = buildRuntimeSource(realCurriculum, realCharacters, realAudio);
  const committedSource = await readFile(path.join(rootDir, 'data/library-data.js'), 'utf8');

  assert.equal(committedSource, expectedSource);
  assert.doesNotMatch(committedSource, /https?:\/\//i);
  assert.doesNotMatch(committedSource, /<\/script/i);
  for (const field of ['sourceFile', 'sourceLabel', 'sha256', 'bytes', 'metadataVerified', 'auditoryReviewed']) {
    assert.doesNotMatch(committedSource, new RegExp(`"${field}"`));
  }
  const header = committedSource.slice(0, committedSource.indexOf('window.HANZI_LIBRARY'));
  for (const value of [
    realCharacters.modificationNotice.date,
    realCharacters.modificationNotice.source,
    realCharacters.modificationNotice.license,
    ...realCharacters.modificationNotice.changes,
    'data/ARPHICPL.TXT',
    'data/source-data-license.md'
  ]) {
    assert.ok(header.includes(value), `header must include ${value}`);
  }

  const payload = runtimePayload(committedSource);
  const sections = payload.curriculum.units.flatMap(unit => unit.lessons);
  assert.equal(payload.curriculum.units.length, 8);
  assert.equal(sections.length, 31);
  assert.equal(
    sections.reduce((total, section) => total + section.recognize.length + section.write.length, 0),
    521
  );
  assert.equal(Object.keys(payload.characters).length, 428);
  assert.equal(
    Object.values(payload.characters).reduce((total, geometry) => total + geometry.strokeCount, 0),
    4349
  );
  assert.equal(Object.keys(payload.audio.readings).length, 335);
  assert.deepEqual(payload.geometryNotice, realCharacters.modificationNotice);
  assert.deepEqual(payload.curriculum, realCurriculum);
  assert.deepEqual(Object.keys(payload.characters), [...Object.keys(payload.characters)].sort());
  assert.deepEqual(Object.keys(payload.audio.readings), [...Object.keys(payload.audio.readings)].sort());

  for (const [id, record] of Object.entries(payload.audio.readings)) {
    assert.deepEqual(Object.keys(record), ['file'], id);
    assert.equal(record.file, `assets/audio/${id}.mp3`);
    assert.equal(path.isAbsolute(record.file), false);
    assert.equal(record.file.includes('..'), false);
    await access(path.join(rootDir, record.file));
  }
});

test('the CLI builds the repository deterministically from an unrelated working directory', async t => {
  const rootDir = fileURLToPath(new URL('../', import.meta.url));
  const cwd = await mkdtemp(path.join(tmpdir(), 'hanzi-library-cli-cwd-'));
  t.after(() => rm(cwd, { force: true, recursive: true }));
  const scriptPath = path.join(rootDir, 'scripts/build-library.mjs');
  const outputPath = path.join(rootDir, 'data/library-data.js');

  const firstRun = await execFile(process.execPath, [scriptPath], { cwd });
  const first = await readFile(outputPath);
  const secondRun = await execFile(process.execPath, [scriptPath], { cwd });
  const second = await readFile(outputPath);
  const firstHash = createHash('sha256').update(first).digest('hex');
  const secondHash = createHash('sha256').update(second).digest('hex');

  assert.equal(firstRun.stderr, '');
  assert.equal(secondRun.stderr, '');
  assert.match(firstRun.stdout, /8 units.*31 sections.*521 entries.*428 characters.*4349 strokes.*335 audio readings/i);
  assert.deepEqual(second, first);
  assert.equal(second.length, first.length);
  assert.equal(secondHash, firstHash);
});
