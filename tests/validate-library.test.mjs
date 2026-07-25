import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runValidation } from '../scripts/validate-library.mjs';

const fixture = name => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

async function createLibrary(t, { curriculum, characters, audio = true, audioFiles = ['guo1.mp3'] } = {}) {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'hanzi-library-validation-'));
  t.after(() => rm(rootDir, { force: true, recursive: true }));

  if (curriculum !== undefined || characters !== undefined) {
    await mkdir(path.join(rootDir, 'data'), { recursive: true });
  }
  if (curriculum !== undefined) await writeFile(path.join(rootDir, 'data/curriculum.json'), curriculum);
  if (characters !== undefined) await writeFile(path.join(rootDir, 'data/characters.json'), characters);
  if (audio) {
    await mkdir(path.join(rootDir, 'assets/audio'), { recursive: true });
    for (const file of audioFiles) {
      await writeFile(path.join(rootDir, `assets/audio/${file}`), '');
    }
  }

  return rootDir;
}

function createWriters() {
  const stdout = [];
  const stderr = [];
  return {
    stderr,
    stdout,
    writers: {
      stderr: message => stderr.push(message),
      stdout: message => stdout.push(message)
    }
  };
}

test('validates a complete library from its supplied root directory', async t => {
  const rootDir = await createLibrary(t, {
    characters: await fixture('valid-characters.json'),
    curriculum: await fixture('valid-curriculum.json')
  });
  const { stderr, stdout, writers } = createWriters();

  const exitCode = await runValidation({ rootDir, ...writers });

  assert.equal(exitCode, 0);
  assert.deepEqual(stdout, ['Library valid']);
  assert.deepEqual(stderr, []);
});

test('reports missing source files without throwing', async t => {
  const rootDir = await createLibrary(t, { audio: false });
  const { stderr, stdout, writers } = createWriters();

  const exitCode = await runValidation({ rootDir, ...writers });

  assert.equal(exitCode, 1);
  assert.deepEqual(stdout, []);
  assert.match(stderr.join('\n'), /Missing source file: data\/curriculum\.json/);
  assert.match(stderr.join('\n'), /Missing source file: data\/characters\.json/);
  assert.match(stderr.join('\n'), /Missing source directory: assets\/audio/);
});

test('reports invalid JSON from its supplied root directory', async t => {
  const rootDir = await createLibrary(t, {
    characters: await fixture('valid-characters.json'),
    curriculum: '{ invalid JSON'
  });
  const { stderr, stdout, writers } = createWriters();

  const exitCode = await runValidation({ rootDir, ...writers });

  assert.equal(exitCode, 1);
  assert.deepEqual(stdout, []);
  assert.match(stderr.join('\n'), /Invalid JSON in data\/curriculum\.json/);
});

test('validates a parsed null curriculum instead of treating it as a missing input', async t => {
  const rootDir = await createLibrary(t, {
    characters: await fixture('valid-characters.json'),
    curriculum: 'null'
  });
  const { stderr, stdout, writers } = createWriters();

  const exitCode = await runValidation({ rootDir, ...writers });

  assert.equal(exitCode, 1);
  assert.deepEqual(stdout, []);
  assert.match(stderr.join('\n'), /curriculum.*object/i);
});

test('reports a malformed character document through the validation CLI contract', async t => {
  const rootDir = await createLibrary(t, {
    characters: 'null',
    curriculum: await fixture('valid-curriculum.json')
  });
  const { stderr, stdout, writers } = createWriters();

  const exitCode = await runValidation({ rootDir, ...writers });

  assert.equal(exitCode, 1);
  assert.deepEqual(stdout, []);
  assert.match(stderr.join('\n'), /characters.*object/i);
});

test('only regular lowercase .mp3 files satisfy curriculum audio ids', async t => {
  for (const file of ['guo1.txt', 'guo1.json', 'guo1.m4a', 'guo1.MP3']) {
    const rootDir = await createLibrary(t, {
      characters: await fixture('valid-characters.json'),
      curriculum: await fixture('valid-curriculum.json'),
      audioFiles: [file]
    });
    const { stderr, stdout, writers } = createWriters();

    const exitCode = await runValidation({ rootDir, ...writers });

    assert.equal(exitCode, 1, file);
    assert.deepEqual(stdout, [], file);
    assert.match(stderr.join('\n'), /missing audio guo1/i, file);
  }
});

test('metadata and license files are never treated as audio ids', async t => {
  const rootDir = await createLibrary(t, {
    characters: await fixture('valid-characters.json'),
    curriculum: await fixture('valid-curriculum.json'),
    audioFiles: ['manifest.json', 'THIRD_PARTY_NOTICES.md', 'CC-BY-SA-3.0.html']
  });
  const { stderr, stdout, writers } = createWriters();

  const exitCode = await runValidation({ rootDir, ...writers });

  assert.equal(exitCode, 1);
  assert.deepEqual(stdout, []);
  assert.match(stderr.join('\n'), /missing audio guo1/i);
});
