import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { validateLibrary } from './lib/library-validator.mjs';

const defaultRootDir = fileURLToPath(new URL('../', import.meta.url));

async function readJson(rootDir, relativePath, errors) {
  const sourcePath = path.join(rootDir, relativePath);
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

async function readAudioIds(rootDir, errors) {
  const relativePath = 'assets/audio';
  try {
    const entries = await readdir(path.join(rootDir, relativePath), { withFileTypes: true });
    return new Set(entries
      .filter(entry => entry.isFile() && /^[a-z]+[1-5]\.mp3$/.test(entry.name))
      .map(entry => entry.name.slice(0, -'.mp3'.length)));
  } catch (error) {
    if (error.code === 'ENOENT') errors.push(`Missing source directory: ${relativePath}`);
    else errors.push(`Unable to read source directory ${relativePath}: ${error.message}`);
    return new Set();
  }
}

export async function runValidation({
  rootDir = defaultRootDir,
  stdout = message => console.log(message),
  stderr = message => console.error(message)
} = {}) {
  const errors = [];
  const [curriculum, characterDocument, audioIds] = await Promise.all([
    readJson(rootDir, 'data/curriculum.json', errors),
    readJson(rootDir, 'data/characters.json', errors),
    readAudioIds(rootDir, errors)
  ]);

  if (curriculum !== undefined && characterDocument !== undefined) {
    errors.push(...validateLibrary(curriculum, characterDocument, audioIds));
  }

  if (errors.length > 0) {
    errors.forEach(error => stderr(error));
    return 1;
  }

  stdout('Library valid');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runValidation();
}
