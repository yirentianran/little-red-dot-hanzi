import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateLibrary } from './lib/library-validator.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

async function readJson(relativePath, errors) {
  const sourcePath = path.join(projectRoot, relativePath);
  let source;
  try {
    source = await readFile(sourcePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') errors.push(`Missing source file: ${relativePath}`);
    else errors.push(`Unable to read source file ${relativePath}: ${error.message}`);
    return undefined;
  }

  try {
    return JSON.parse(source);
  } catch (error) {
    errors.push(`Invalid JSON in ${relativePath}: ${error.message}`);
    return undefined;
  }
}

async function readAudioIds(errors) {
  const relativePath = 'assets/audio';
  try {
    const entries = await readdir(path.join(projectRoot, relativePath), { withFileTypes: true });
    return new Set(entries.filter(entry => entry.isFile()).map(entry => path.parse(entry.name).name));
  } catch (error) {
    if (error.code === 'ENOENT') errors.push(`Missing source directory: ${relativePath}`);
    else errors.push(`Unable to read source directory ${relativePath}: ${error.message}`);
    return new Set();
  }
}

async function main() {
  const errors = [];
  const [curriculum, characters, audioIds] = await Promise.all([
    readJson('data/curriculum.json', errors),
    readJson('data/characters.json', errors),
    readAudioIds(errors)
  ]);

  if (curriculum && characters) errors.push(...validateLibrary(curriculum, characters, audioIds));

  if (errors.length > 0) {
    errors.forEach(error => console.error(error));
    return 1;
  }

  console.log('Library valid');
  return 0;
}

process.exitCode = await main();
