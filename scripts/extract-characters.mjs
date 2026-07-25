import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultRootDir = fileURLToPath(new URL('../', import.meta.url));

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function curriculumCharacters(curriculum) {
  return [...new Set(curriculum.units.flatMap(unit => unit.lessons)
    .flatMap(section => [...section.recognize, ...section.write])
    .map(entry => entry.character))].sort();
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

export function extractCharacters(curriculum, upstream) {
  if (!isRecord(upstream)) throw new Error('upstream geometry must be an object');

  return Object.fromEntries(curriculumCharacters(curriculum).map(character => {
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
  const curriculum = JSON.parse(await readFile(path.join(rootDir, 'data/curriculum.json'), 'utf8'));
  const sourceDir = parseSourceDirectory(argv, rootDir);
  const upstream = {};

  await Promise.all(curriculumCharacters(curriculum).map(async character => {
    const sourcePath = path.join(sourceDir, `${character}.json`);
    try {
      upstream[character] = JSON.parse(await readFile(sourcePath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error(`upstream geometry missing: ${character} (${sourcePath})`);
      throw new Error(`unable to read upstream geometry for ${character}: ${error.message}`);
    }
  }));

  const extracted = extractCharacters(curriculum, upstream);
  const outputPath = path.join(rootDir, 'data/characters.json');
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(extracted, null, 2)}\n`, 'utf8');
  stdout(`Extracted ${Object.keys(extracted).length} characters to data/characters.json`);
  return extracted;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await runExtraction();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
