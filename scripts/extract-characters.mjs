import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultRootDir = fileURLToPath(new URL('../', import.meta.url));

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function catalogCharacters(catalog) {
  const source = 'data/catalog.json';
  if (!isRecord(catalog)) throw new Error(`${source}: must be an object`);
  if (!Array.isArray(catalog.sets)) throw new Error(`${source}.sets: must be an array`);

  const characters = new Set();
  for (const [setIndex, set] of catalog.sets.entries()) {
      const setLocation = `${source}.sets[${setIndex}]`;
      if (!isRecord(set)) throw new Error(`${setLocation}: must be an object`);
      if (!Array.isArray(set.entries)) throw new Error(`${setLocation}.entries: must be an array`);
      for (const [entryIndex, entry] of set.entries.entries()) {
        const location = `${setLocation}.entries[${entryIndex}].character`;
        const character = isRecord(entry) ? entry.character : undefined;
        if (typeof character !== 'string' || Array.from(character).length !== 1) {
          throw new Error(`${location}: must be one code point`);
        }
        characters.add(character);
      }
  }

  return [...characters].sort();
}

function modificationNotice(characterCount) {
  return {
    date: '2026-08-03',
    source: 'hanzi-writer-data@2.0.1',
    license: 'ARPHICPL.TXT',
    changes: [
      `Extracted the ${characterCount}-character subset used by the independently ranked g4-fall catalog.`,
      'Removed radStrokes and all other upstream fields, retaining only strokes and medians.',
      'Added strokeCount to each character record.',
      'Sorted character keys deterministically.',
      'Combined the selected records into this single JSON document.'
    ]
  };
}

function malformedReason(source) {
  if (!isRecord(source)) return 'record must be an object';
  if (!Array.isArray(source.strokes) || source.strokes.length === 0) {
    return 'strokes must be a non-empty array';
  }
  if (!Array.isArray(source.medians)) return 'medians must be an array';
  if (source.strokes.length !== source.medians.length) {
    return 'strokes and medians must have matching lengths';
  }
  if (!source.strokes.every(stroke => typeof stroke === 'string' && stroke.trim() !== '')) {
    return 'every stroke must be a non-blank SVG path string';
  }
  if (!source.medians.every(median => Array.isArray(median)
    && median.length >= 2
    && median.every(point => Array.isArray(point)
      && point.length === 2
      && Number.isFinite(point[0])
      && Number.isFinite(point[1])))) {
    return 'every median must contain at least two numeric coordinate pairs';
  }
  return undefined;
}

export function extractCharacters(catalog, upstream) {
  const wantedCharacters = catalogCharacters(catalog);
  if (!isRecord(upstream)) throw new Error('upstream geometry must be an object');

  const characters = Object.fromEntries(wantedCharacters.map(character => {
    if (!Object.hasOwn(upstream, character)) {
      throw new Error(`upstream geometry missing: ${character}`);
    }

    const source = upstream[character];
    const reason = malformedReason(source);
    if (reason) throw new Error(`malformed upstream geometry for ${character}: ${reason}`);

    return [character, {
      strokeCount: source.strokes.length,
      strokes: source.strokes,
      medians: source.medians
    }];
  }));

  return {
    schemaVersion: 1,
    modificationNotice: modificationNotice(wantedCharacters.length),
    characters
  };
}

function parseSourceDirectory(argv, rootDir) {
  if (argv.length === 0) return path.join(rootDir, 'node_modules/hanzi-writer-data');
  if (argv.length !== 2 || argv[0] !== '--source' || !argv[1]) {
    throw new Error('usage: node scripts/extract-characters.mjs [--source <directory>]');
  }
  return path.resolve(rootDir, argv[1]);
}

export async function runExtraction({
  argv = process.argv.slice(2),
  rootDir = defaultRootDir,
  stdout = message => console.log(message)
} = {}) {
  const catalogPath = path.join(rootDir, 'data/catalog.json');
  let catalogSource;
  try {
    catalogSource = await readFile(catalogPath, 'utf8');
  } catch (error) {
    throw new Error(`unable to read data/catalog.json: ${error.message}`);
  }

  let catalog;
  try {
    catalog = JSON.parse(catalogSource);
  } catch (error) {
    throw new Error(`invalid JSON in data/catalog.json: ${error.message}`);
  }

  const wantedCharacters = catalogCharacters(catalog);
  const sourceDir = parseSourceDirectory(argv, rootDir);
  const upstream = {};

  await Promise.all(wantedCharacters.map(async character => {
    const sourcePath = path.join(sourceDir, `${character}.json`);
    let source;
    try {
      source = await readFile(sourcePath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error(`upstream geometry missing: ${character} (${sourcePath})`);
      throw new Error(`unable to read upstream geometry for ${character}: ${error.message}`);
    }
    try {
      upstream[character] = JSON.parse(source);
    } catch (error) {
      throw new Error(`invalid JSON in upstream geometry for ${character} (${sourcePath}): ${error.message}`);
    }
  }));

  const document = extractCharacters(catalog, upstream);
  const outputPath = path.join(rootDir, 'data/characters.json');
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  stdout(`Extracted ${Object.keys(document.characters).length} characters to data/characters.json`);
  return document;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await runExtraction();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
