import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = fileURLToPath(new URL('../', import.meta.url));
const SOURCE_FILE = 'data/sources/Unihan-17.0.0.zip';
const OUTPUT_FILE = 'data/catalog-index.json';
const EXPECTED_SHA256 = 'f7a48b2b545acfaa77b2d607ae28747404ce02baefee16396c5d2d7a8ef34b5e';

export const STAGES = Object.freeze([
  { id: 'g1-fall', grade: 1, term: 'fall', quota: 400 },
  { id: 'g1-spring', grade: 1, term: 'spring', quota: 400 },
  { id: 'g2-fall', grade: 2, term: 'fall', quota: 400 },
  { id: 'g2-spring', grade: 2, term: 'spring', quota: 400 },
  { id: 'g3-fall', grade: 3, term: 'fall', quota: 225 },
  { id: 'g3-spring', grade: 3, term: 'spring', quota: 225 },
  { id: 'g4-fall', grade: 4, term: 'fall', quota: 225 },
  { id: 'g4-spring', grade: 4, term: 'spring', quota: 225 },
  { id: 'g5-fall', grade: 5, term: 'fall', quota: 125 },
  { id: 'g5-spring', grade: 5, term: 'spring', quota: 125 },
  { id: 'g6-fall', grade: 6, term: 'fall', quota: 125 },
  { id: 'g6-spring', grade: 6, term: 'spring', quota: 125 }
]);

function unzipText(zipPath, fileName) {
  return execFileSync('unzip', ['-p', zipPath, fileName], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
}

function parseProperties(source, wanted) {
  const result = new Map();
  for (const line of source.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const [codePoint, property, value] = line.split('\t');
    if (!wanted.has(property) || !codePoint || value === undefined) continue;
    const character = String.fromCodePoint(Number.parseInt(codePoint.slice(2), 16));
    if (!result.has(character)) result.set(character, {});
    result.get(character)[property] = value;
  }
  return result;
}

function mergeProperties(...maps) {
  const result = new Map();
  for (const source of maps) {
    for (const [character, properties] of source) {
      result.set(character, Object.assign(result.get(character) || {}, properties));
    }
  }
  return result;
}

function frequency(value) {
  if (typeof value !== 'string') return 0;
  return [...value.matchAll(/\((\d+)\)/g)]
    .reduce((total, match) => total + Number.parseInt(match[1], 10), 0);
}

function primaryReading(properties) {
  if (properties.kHanyuPinlu) {
    const matches = [...properties.kHanyuPinlu.matchAll(/([^\s(]+)\((\d+)\)/gu)]
      .sort((left, right) => Number.parseInt(right[2], 10) - Number.parseInt(left[2], 10));
    if (matches.length > 0) {
      var pinyin = matches[0][1].normalize('NFC');
      if (readingId(pinyin).endsWith('5') && properties.kMandarin) {
        const markedFallback = properties.kMandarin.trim().split(/\s+/)
          .find(candidate => !readingId(candidate).endsWith('5'));
        if (markedFallback) {
          return {
            pinyin: markedFallback.normalize('NFC'),
            source: 'kHanyuPinlu+kMandarin-tone'
          };
        }
      }
      return { pinyin, source: 'kHanyuPinlu' };
    }
  }
  if (properties.kMandarin) {
    return {
      pinyin: properties.kMandarin.trim().split(/\s+/)[0].normalize('NFC'),
      source: 'kMandarin'
    };
  }
  return null;
}

export function readingId(pinyin) {
  let tone = 5;
  const letters = [];
  for (const character of pinyin.normalize('NFD').toLowerCase()) {
    if (character === '\u0304') tone = 1;
    else if (character === '\u0301') tone = 2;
    else if (character === '\u030c') tone = 3;
    else if (character === '\u0300') tone = 4;
    else if (character === '\u0308') {
      if (letters.at(-1) === 'u') letters[letters.length - 1] = 'v';
    } else if (/^[a-z]$/.test(character)) letters.push(character);
  }
  if (letters.length === 0) throw new Error(`Unable to create audio id for pinyin: ${pinyin}`);
  return `${letters.join('')}${tone}`;
}

export function buildIndex({ otherMappings, readings, irgSources }) {
  const properties = mergeProperties(
    parseProperties(otherMappings, new Set(['kTGH'])),
    parseProperties(readings, new Set(['kHanyuPinlu', 'kMandarin'])),
    parseProperties(irgSources, new Set(['kTotalStrokes']))
  );
  const candidates = [];
  for (const [character, values] of properties) {
    const tghMatch = values.kTGH && values.kTGH.match(/^2013:(\d+)$/);
    if (!tghMatch) continue;
    const tghIndex = Number.parseInt(tghMatch[1], 10);
    if (tghIndex > 3500) continue;
    const reading = primaryReading(values);
    const strokeCount = Number.parseInt(values.kTotalStrokes, 10);
    if (!reading || !Number.isInteger(strokeCount) || strokeCount <= 0) {
      throw new Error(`Incomplete Unicode source properties for ${character}`);
    }
    candidates.push({
      character,
      tghIndex,
      frequency: frequency(values.kHanyuPinlu),
      strokeCount,
      pinyin: reading.pinyin,
      audio: readingId(reading.pinyin),
      readingSource: reading.source
    });
  }
  if (candidates.length !== 3500) {
    throw new Error(`Expected 3500 first-level kTGH candidates, found ${candidates.length}`);
  }
  candidates.sort((left, right) => (
    right.frequency - left.frequency
    || left.strokeCount - right.strokeCount
    || left.tghIndex - right.tghIndex
  ));
  const selected = candidates.slice(0, 3000);
  let position = 0;
  const entries = selected.map((entry, index) => {
    while (position < STAGES.length && index >= STAGES
      .slice(0, position + 1)
      .reduce((total, stage) => total + stage.quota, 0)) position += 1;
    if (!STAGES[position]) throw new Error(`No stage quota for rank ${index + 1}`);
    return { rank: index + 1, stageId: STAGES[position].id, ...entry };
  });
  return {
    schemaVersion: 1,
    methodVersion: '1.0.0',
    source: {
      name: 'Unicode Unihan',
      version: '17.0.0',
      file: SOURCE_FILE,
      sha256: EXPECTED_SHA256,
      license: 'Unicode-3.0',
      properties: ['kTGH', 'kHanyuPinlu', 'kMandarin', 'kTotalStrokes']
    },
    ranking: [
      'sum(kHanyuPinlu frequency) descending',
      'kTotalStrokes ascending',
      'kTGH index ascending'
    ],
    readingRule: 'highest-frequency kHanyuPinlu; if untoned, first tone-marked kMandarin; otherwise first kMandarin',
    stages: STAGES,
    entries
  };
}

export async function runBuild({ sourcePath = path.join(rootDir, SOURCE_FILE), outputPath = path.join(rootDir, OUTPUT_FILE) } = {}) {
  const bytes = await readFile(sourcePath);
  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  if (actualSha256 !== EXPECTED_SHA256) {
    throw new Error(`Unihan SHA-256 mismatch: expected ${EXPECTED_SHA256}, found ${actualSha256}`);
  }
  const document = buildIndex({
    otherMappings: unzipText(sourcePath, 'Unihan_OtherMappings.txt'),
    readings: unzipText(sourcePath, 'Unihan_Readings.txt'),
    irgSources: unzipText(sourcePath, 'Unihan_IRGSources.txt')
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  return document;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const document = await runBuild();
    console.log(`Built ${document.entries.length} independently ranked characters in ${OUTPUT_FILE}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
