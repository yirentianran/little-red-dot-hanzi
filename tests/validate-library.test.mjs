import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runValidation } from '../scripts/validate-library.mjs';

const fixture = name => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

async function createLibrary(t, { curriculum, characters, audio = true } = {}) {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'hanzi-library-validation-'));
  t.after(() => rm(rootDir, { force: true, recursive: true }));

  if (curriculum !== undefined || characters !== undefined) {
    await mkdir(path.join(rootDir, 'data'), { recursive: true });
  }
  if (curriculum !== undefined) await writeFile(path.join(rootDir, 'data/curriculum.json'), curriculum);
  if (characters !== undefined) await writeFile(path.join(rootDir, 'data/characters.json'), characters);
  if (audio) {
    await mkdir(path.join(rootDir, 'assets/audio'), { recursive: true });
    await writeFile(path.join(rootDir, 'assets/audio/guo1.m4a'), '');
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
