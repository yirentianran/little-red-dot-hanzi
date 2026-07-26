import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { syncHanziWriter } from '../scripts/sync-hanzi-writer.mjs';

async function temporaryDirectory(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'hanzi-writer-vendor-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function writeFixturePackage(rootDir, version = '3.7.3') {
  const packageDir = path.join(rootDir, 'node_modules', 'hanzi-writer');
  await mkdir(path.join(packageDir, 'dist'), { recursive: true });
  await writeFile(path.join(packageDir, 'package.json'), JSON.stringify({ name: 'hanzi-writer', version }));
  await writeFile(path.join(packageDir, 'dist', 'hanzi-writer.min.js'), 'fixture browser bundle');
  await writeFile(path.join(packageDir, 'LICENSE'), 'fixture license');
}

test('copies the pinned browser bundle and license from the installed package', async t => {
  const rootDir = await temporaryDirectory(t);
  await writeFixturePackage(rootDir);

  const result = await syncHanziWriter({ rootDir });

  assert.equal(result.version, '3.7.3');
  assert.equal(await readFile(path.join(rootDir, 'vendor', 'hanzi-writer.min.js'), 'utf8'), 'fixture browser bundle');
  assert.equal(await readFile(path.join(rootDir, 'vendor', 'HANZI_WRITER_LICENSE.txt'), 'utf8'), 'fixture license');
});

test('rejects an installed Hanzi Writer version other than the pinned version', async t => {
  const rootDir = await temporaryDirectory(t);
  await writeFixturePackage(rootDir, '3.7.2');

  await assert.rejects(() => syncHanziWriter({ rootDir }), /hanzi-writer.*3\.7\.3.*3\.7\.2/i);
});
