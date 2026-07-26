import { createHash, randomUUID } from 'node:crypto';
import { access, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { validateLibrary } from './lib/library-validator.mjs';

const CURRICULUM_SOURCE = 'data/curriculum.json';
const CHARACTER_SOURCE = 'data/characters.json';
const AUDIO_SOURCE = 'assets/audio/manifest.json';
const OUTPUT_FILE = 'data/library-data.js';
const defaultRootDir = fileURLToPath(new URL('../', import.meta.url));
const PINYIN_PATTERN = /^[a-züāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜńňǹḿ]+$/iu;

const RUNTIME_NOTICES = Object.freeze({
  geometryLicense: 'data/ARPHICPL.TXT',
  geometrySource: 'data/source-data-license.md',
  audioAttribution: 'assets/audio/THIRD_PARTY_NOTICES.md',
  audioLicense: 'assets/audio/CC-BY-SA-3.0.html'
});

function commentText(value) {
  return String(value)
    .replace(/\*\//g, '* /')
    .replace(/[\r\n\u2028\u2029]+/g, ' ')
    .replace(/:\/\//g, ':\\/\\/')
    .replace(/</g, '\\u003c');
}

function formatGeometryLicenseHeader(notice) {
  const changes = notice.changes.map(change => ` *   - ${commentText(change)}`).join('\n');
  return [
    '/*',
    ' * ============================================================================',
    ' * CHARACTER GEOMETRY MODIFICATION NOTICE',
    ' * ============================================================================',
    ` * Date: ${commentText(notice.date)}`,
    ` * Source: ${commentText(notice.source)}`,
    ` * License: ${commentText(notice.license)}`,
    ' * Changes:',
    changes,
    ' *',
    ` * Bundled license: ${RUNTIME_NOTICES.geometryLicense}`,
    ` * Source and modification details: ${RUNTIME_NOTICES.geometrySource}`,
    ' * ============================================================================',
    ' */'
  ].join('\n');
}

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNonBlankString = value => typeof value === 'string' && value.trim() !== '';

function reject(location, requirement) {
  throw new TypeError(`${location}: ${requirement}`);
}

function requireRecord(value, location) {
  if (!isRecord(value)) reject(location, 'must be an object');
}

function requireNonBlankString(value, location) {
  if (!isNonBlankString(value)) reject(location, 'must be a non-blank string');
}

function requireOwn(record, field, location) {
  if (!Object.hasOwn(record, field)) reject(`${location}.${field}`, 'must be an own property');
  return record[field];
}

function requireHttpsUrl(value, location) {
  requireNonBlankString(value, location);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    reject(location, 'must be a valid HTTPS URL');
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) {
    reject(location, 'must be a valid HTTPS URL without credentials');
  }
}

function requireWords(value, character, location) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
    reject(location, 'must be an array with 1 to 3 words');
  }
  value.forEach((word, index) => {
    const wordLocation = `${location}[${index}]`;
    requireNonBlankString(word, wordLocation);
    if (!word.includes(character)) reject(wordLocation, `must include ${character}`);
  });
}

function isSafeRelativePath(value) {
  return isNonBlankString(value)
    && !path.posix.isAbsolute(value)
    && !value.includes('\\')
    && !value.split('/').some(segment => segment === '' || segment === '.' || segment === '..');
}

function requireExactKeys(value, allowedKeys, location) {
  const allowed = new Set(allowedKeys);
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) reject(`${location}.${field}`, 'unknown field');
  }
}

function validateCurriculum(curriculum) {
  requireRecord(curriculum, CURRICULUM_SOURCE);
  requireExactKeys(curriculum, ['schemaVersion', 'book', 'units'], CURRICULUM_SOURCE);
  if (curriculum.schemaVersion !== 1) reject(`${CURRICULUM_SOURCE}.schemaVersion`, 'must equal 1');
  requireRecord(curriculum.book, `${CURRICULUM_SOURCE}.book`);
  requireExactKeys(
    curriculum.book,
    ['publisher', 'approvalYear', 'grade', 'volume'],
    `${CURRICULUM_SOURCE}.book`
  );
  requireNonBlankString(curriculum.book.publisher, `${CURRICULUM_SOURCE}.book.publisher`);
  if (!Number.isInteger(curriculum.book.approvalYear)) {
    reject(`${CURRICULUM_SOURCE}.book.approvalYear`, 'must be an integer');
  }
  if (!Number.isInteger(curriculum.book.grade)) {
    reject(`${CURRICULUM_SOURCE}.book.grade`, 'must be an integer');
  }
  requireNonBlankString(curriculum.book.volume, `${CURRICULUM_SOURCE}.book.volume`);
  if (!Array.isArray(curriculum.units) || curriculum.units.length === 0) {
    reject(`${CURRICULUM_SOURCE}.units`, 'must be a non-empty array');
  }

  for (const [unitIndex, unit] of curriculum.units.entries()) {
    const unitLocation = `${CURRICULUM_SOURCE}.units[${unitIndex}]`;
    requireRecord(unit, unitLocation);
    requireExactKeys(unit, ['id', 'title', 'lessons'], unitLocation);
    requireNonBlankString(unit.id, `${unitLocation}.id`);
    requireNonBlankString(unit.title, `${unitLocation}.title`);
    if (!Array.isArray(unit.lessons) || unit.lessons.length === 0) {
      reject(`${unitLocation}.lessons`, 'must be a non-empty array');
    }

    for (const [lessonIndex, lesson] of unit.lessons.entries()) {
      const lessonLocation = `${unitLocation}.lessons[${lessonIndex}]`;
      requireRecord(lesson, lessonLocation);
      if (lesson.kind !== 'lesson' && lesson.kind !== 'garden') {
        reject(`${lessonLocation}.kind`, 'must equal lesson or garden');
      }
      requireExactKeys(
        lesson,
        lesson.kind === 'lesson'
          ? ['kind', 'id', 'number', 'title', 'recognize', 'write']
          : ['kind', 'id', 'title', 'recognize', 'write'],
        lessonLocation
      );
      requireNonBlankString(lesson.id, `${lessonLocation}.id`);
      requireNonBlankString(lesson.title, `${lessonLocation}.title`);
      if (lesson.kind === 'lesson' && (!Number.isInteger(lesson.number) || lesson.number <= 0)) {
        reject(`${lessonLocation}.number`, 'must be a positive integer for a lesson');
      }

      for (const group of ['recognize', 'write']) {
        if (!Array.isArray(lesson[group])) reject(`${lessonLocation}.${group}`, 'must be an array');
        for (const [entryIndex, entry] of lesson[group].entries()) {
          const entryLocation = `${lessonLocation}.${group}[${entryIndex}]`;
          requireRecord(entry, entryLocation);
          requireExactKeys(
            entry,
            group === 'recognize'
              ? ['character', 'pinyin', 'audio', 'words', 'counted']
              : ['character', 'pinyin', 'audio', 'words'],
            entryLocation
          );
          if (typeof entry.character !== 'string' || Array.from(entry.character).length !== 1) {
            reject(`${entryLocation}.character`, 'must be one code point');
          }
          requireNonBlankString(entry.pinyin, `${entryLocation}.pinyin`);
          if (entry.pinyin !== entry.pinyin.normalize('NFC')) {
            reject(`${entryLocation}.pinyin`, 'must be NFC-normalized');
          }
          if (!PINYIN_PATTERN.test(entry.pinyin)) {
            reject(`${entryLocation}.pinyin`, 'must be tone-marked pinyin without digits or separators');
          }
          if (typeof entry.audio !== 'string' || !/^[a-z]+[1-5]$/.test(entry.audio)) {
            reject(`${entryLocation}.audio`, 'must be a numbered lowercase reading id');
          }
          requireWords(requireOwn(entry, 'words', entryLocation), entry.character, `${entryLocation}.words`);
          if (Object.hasOwn(entry, 'counted') && entry.counted !== false) {
            reject(`${entryLocation}.counted`, 'must equal false when present');
          }
        }
      }
    }
  }
}

function validateCharacterDocument(characterDocument) {
  requireRecord(characterDocument, CHARACTER_SOURCE);
  requireExactKeys(
    characterDocument,
    ['schemaVersion', 'modificationNotice', 'characters'],
    CHARACTER_SOURCE
  );
  if (characterDocument.schemaVersion !== 1) reject(`${CHARACTER_SOURCE}.schemaVersion`, 'must equal 1');
  const notice = characterDocument.modificationNotice;
  requireRecord(notice, `${CHARACTER_SOURCE}.modificationNotice`);
  requireExactKeys(
    notice,
    ['date', 'source', 'license', 'changes'],
    `${CHARACTER_SOURCE}.modificationNotice`
  );
  for (const field of ['date', 'source', 'license']) {
    requireNonBlankString(notice[field], `${CHARACTER_SOURCE}.modificationNotice.${field}`);
  }
  if (!Array.isArray(notice.changes)
    || notice.changes.length === 0
    || !notice.changes.every(isNonBlankString)) {
    reject(`${CHARACTER_SOURCE}.modificationNotice.changes`, 'must be a non-empty array of non-blank strings');
  }
  requireRecord(characterDocument.characters, `${CHARACTER_SOURCE}.characters`);
  const entries = Object.entries(characterDocument.characters);
  if (entries.length === 0) reject(`${CHARACTER_SOURCE}.characters`, 'must not be empty');

  for (const [character, geometry] of entries) {
    const location = `${CHARACTER_SOURCE}.characters.${character}`;
    if (Array.from(character).length !== 1) reject(location, 'key must be one code point');
    requireRecord(geometry, location);
    requireExactKeys(geometry, ['strokeCount', 'strokes', 'medians'], location);
    if (!Number.isInteger(geometry.strokeCount) || geometry.strokeCount <= 0) {
      reject(`${location}.strokeCount`, 'must be a positive integer');
    }
    if (!Array.isArray(geometry.strokes) || !geometry.strokes.every(isNonBlankString)) {
      reject(`${location}.strokes`, 'must be an array of non-blank SVG paths');
    }
    if (!Array.isArray(geometry.medians)) reject(`${location}.medians`, 'must be an array');
    if (geometry.strokeCount !== geometry.strokes.length
      || geometry.strokeCount !== geometry.medians.length) {
      reject(`${location}.strokeCount`, 'must match strokes and medians');
    }
    for (const [medianIndex, median] of geometry.medians.entries()) {
      if (!Array.isArray(median)
        || median.length < 2
        || !median.every(point => Array.isArray(point)
          && point.length === 2
          && point.every(Number.isFinite))) {
        reject(`${location}.medians[${medianIndex}]`, 'must contain at least two numeric coordinate pairs');
      }
    }
  }
}

function validateAudioManifest(audioManifest) {
  requireRecord(audioManifest, AUDIO_SOURCE);
  requireExactKeys(audioManifest, ['schemaVersion', 'format', 'source', 'readings'], AUDIO_SOURCE);
  if (audioManifest.schemaVersion !== 1) reject(`${AUDIO_SOURCE}.schemaVersion`, 'must equal 1');
  if (audioManifest.format !== 'audio/mpeg') {
    reject(`${AUDIO_SOURCE}.format`, 'must equal audio/mpeg');
  }
  requireRecord(audioManifest.source, `${AUDIO_SOURCE}.source`);
  requireExactKeys(
    audioManifest.source,
    ['repository', 'commit', 'subset', 'license', 'licenseUrl', 'attribution'],
    `${AUDIO_SOURCE}.source`
  );
  requireHttpsUrl(audioManifest.source.repository, `${AUDIO_SOURCE}.source.repository`);
  if (typeof audioManifest.source.commit !== 'string'
    || !/^[a-f0-9]{40}$/.test(audioManifest.source.commit)) {
    reject(`${AUDIO_SOURCE}.source.commit`, 'must be a lowercase 40-digit hexadecimal commit');
  }
  if (!isSafeRelativePath(audioManifest.source.subset)) {
    reject(`${AUDIO_SOURCE}.source.subset`, 'must be a safe relative path');
  }
  requireNonBlankString(audioManifest.source.license, `${AUDIO_SOURCE}.source.license`);
  requireHttpsUrl(audioManifest.source.licenseUrl, `${AUDIO_SOURCE}.source.licenseUrl`);
  requireNonBlankString(audioManifest.source.attribution, `${AUDIO_SOURCE}.source.attribution`);
  requireRecord(audioManifest.readings, `${AUDIO_SOURCE}.readings`);
  if (Object.keys(audioManifest.readings).length === 0) {
    reject(`${AUDIO_SOURCE}.readings`, 'must not be empty');
  }

  for (const [id, record] of Object.entries(audioManifest.readings)) {
    const location = `${AUDIO_SOURCE}.readings.${id}`;
    if (!/^[a-z]+[1-5]$/.test(id)) reject(location, 'key must be a numbered lowercase reading id');
    requireRecord(record, location);
    requireExactKeys(
      record,
      ['file', 'sourceFile', 'sourceLabel', 'bytes', 'sha256', 'metadataVerified', 'auditoryReviewed'],
      location
    );
    if (typeof record.file !== 'string'
      || record.file !== `assets/audio/${id}.mp3`
      || record.file.includes('..')) {
      reject(`${location}.file`, 'must be the relative local MP3 path assets/audio/<id>.mp3');
    }
    if (!isSafeRelativePath(record.sourceFile) || !record.sourceFile.endsWith('.mp3')) {
      reject(`${location}.sourceFile`, 'must be a safe relative MP3 path');
    }
    if (typeof record.sourceLabel !== 'string' || !/^[a-z]+[1-5]$/.test(record.sourceLabel)) {
      reject(`${location}.sourceLabel`, 'must be a numbered lowercase reading id');
    }
    if (!Number.isInteger(record.bytes) || record.bytes <= 0) {
      reject(`${location}.bytes`, 'must be a positive integer');
    }
    if (typeof record.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.sha256)) {
      reject(`${location}.sha256`, 'must be a lowercase 64-digit hexadecimal string');
    }
    if (record.metadataVerified !== true) {
      reject(`${location}.metadataVerified`, 'must equal true');
    }
    if (typeof record.auditoryReviewed !== 'boolean') {
      reject(`${location}.auditoryReviewed`, 'must be a boolean');
    }
  }
}

function validateSources(curriculum, characterDocument, audioManifest) {
  validateCurriculum(curriculum);
  validateCharacterDocument(characterDocument);
  validateAudioManifest(audioManifest);
  const entries = curriculum.units.flatMap(unit => unit.lessons)
    .flatMap(section => [...section.recognize, ...section.write]);
  const referencedCharacters = new Set(entries.map(entry => entry.character));
  const referencedAudio = new Set(entries.map(entry => entry.audio));
  const validationErrors = validateLibrary(
    curriculum,
    characterDocument,
    new Set(Object.keys(audioManifest.readings))
  );
  if (validationErrors.length > 0) {
    throw new TypeError(
      `Source validation failed for ${CURRICULUM_SOURCE}, ${CHARACTER_SOURCE}, and ${AUDIO_SOURCE}:\n${validationErrors.join('\n')}`
    );
  }
  const extraCharacters = Object.keys(characterDocument.characters)
    .filter(character => !referencedCharacters.has(character));
  if (extraCharacters.length > 0) {
    reject(`${CHARACTER_SOURCE}.characters`, `contains unreferenced character(s): ${extraCharacters.join(', ')}`);
  }
  const extraAudio = Object.keys(audioManifest.readings).filter(id => !referencedAudio.has(id));
  if (extraAudio.length > 0) {
    reject(`${AUDIO_SOURCE}.readings`, `contains unreferenced audio id(s): ${extraAudio.join(', ')}`);
  }
}

function sortedMapping(mapping, selectValue) {
  return Object.fromEntries(Object.keys(mapping).sort().map(key => [key, selectValue(mapping[key])]));
}

function scriptSafeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function buildRuntimeSource(curriculum, characterDocument, audioManifest) {
  validateSources(curriculum, characterDocument, audioManifest);
  const payload = {
    schemaVersion: 1,
    geometryNotice: characterDocument.modificationNotice,
    curriculum,
    characters: sortedMapping(characterDocument.characters, value => value),
    audio: {
      format: audioManifest.format,
      readings: sortedMapping(audioManifest.readings, record => ({ file: record.file }))
    },
    notices: RUNTIME_NOTICES
  };

  const source = `${formatGeometryLicenseHeader(characterDocument.modificationNotice)}\nwindow.HANZI_LIBRARY = ${scriptSafeJson(payload)};\n`;
  if (/https?:\/\//i.test(source)) {
    throw new TypeError('Generated runtime source contains a forbidden network URL from retained source data');
  }
  if (/\bfetch\b/i.test(source)) {
    throw new TypeError('Generated runtime source contains a forbidden fetch token from retained source data');
  }
  if (/<\/script/i.test(source)) {
    throw new TypeError('Generated runtime source contains a forbidden closing script token');
  }
  return source;
}

async function readJsonDocument(rootDir, relativePath, readFileImpl) {
  let source;
  try {
    source = await readFileImpl(path.join(rootDir, relativePath), 'utf8');
  } catch (error) {
    throw new Error(`Unable to read ${relativePath}: ${error.message}`, { cause: error });
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid JSON in ${relativePath}: ${error.message}`, { cause: error });
  }
}

function libraryCounts(curriculum, characterDocument, audioManifest) {
  const sections = curriculum.units.flatMap(unit => unit.lessons);
  return {
    units: curriculum.units.length,
    sections: sections.length,
    entries: sections.reduce((total, section) => total + section.recognize.length + section.write.length, 0),
    characters: Object.keys(characterDocument.characters).length,
    strokes: Object.values(characterDocument.characters)
      .reduce((total, geometry) => total + geometry.strokeCount, 0),
    audioReadings: Object.keys(audioManifest.readings).length
  };
}

async function removeCandidate(candidatePath, unlinkImpl) {
  try {
    await unlinkImpl(candidatePath);
  } catch (error) {
    if (error.code !== 'ENOENT') return error;
  }
  return undefined;
}

export async function runBuild({
  rootDir = defaultRootDir,
  stdout = message => console.log(message),
  readFileImpl = readFile,
  accessImpl = access,
  writeFileImpl = writeFile,
  renameImpl = rename,
  unlinkImpl = unlink,
  candidateNameFactory = () => `${process.pid}-${randomUUID()}`
} = {}) {
  const resolvedRoot = path.resolve(rootDir);
  const [curriculum, characterDocument, audioManifest] = await Promise.all([
    readJsonDocument(resolvedRoot, CURRICULUM_SOURCE, readFileImpl),
    readJsonDocument(resolvedRoot, CHARACTER_SOURCE, readFileImpl),
    readJsonDocument(resolvedRoot, AUDIO_SOURCE, readFileImpl)
  ]);
  const source = buildRuntimeSource(curriculum, characterDocument, audioManifest);

  for (const [id, record] of Object.entries(audioManifest.readings)) {
    try {
      await accessImpl(path.join(resolvedRoot, record.file));
    } catch (error) {
      throw new Error(`${AUDIO_SOURCE}.readings.${id}.file: local MP3 does not exist (${record.file}): ${error.message}`, {
        cause: error
      });
    }
  }
  for (const [noticeName, relativePath] of Object.entries(RUNTIME_NOTICES)) {
    try {
      await accessImpl(path.join(resolvedRoot, relativePath));
    } catch (error) {
      throw new Error(`${relativePath}: ${noticeName} notice does not exist: ${error.message}`, { cause: error });
    }
  }

  const outputPath = path.join(resolvedRoot, OUTPUT_FILE);
  const candidatePath = path.join(
    path.dirname(outputPath),
    `${path.basename(outputPath)}.candidate-${candidateNameFactory()}`
  );
  try {
    await writeFileImpl(candidatePath, source, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    const cleanupError = await removeCandidate(candidatePath, unlinkImpl);
    const cleanup = cleanupError ? `; candidate cleanup also failed: ${cleanupError.message}` : '';
    throw new Error(`Unable to write candidate for ${OUTPUT_FILE}: ${error.message}${cleanup}`, { cause: error });
  }
  try {
    await renameImpl(candidatePath, outputPath);
  } catch (error) {
    const cleanupError = await removeCandidate(candidatePath, unlinkImpl);
    const cleanup = cleanupError ? `; candidate cleanup also failed: ${cleanupError.message}` : '';
    throw new Error(`Unable to rename candidate to ${OUTPUT_FILE}: ${error.message}${cleanup}`, { cause: error });
  }

  const counts = libraryCounts(curriculum, characterDocument, audioManifest);
  const bytes = Buffer.byteLength(source);
  const sha256 = createHash('sha256').update(source).digest('hex');
  stdout(
    `Built ${OUTPUT_FILE}: ${counts.units} units, ${counts.sections} sections, ${counts.entries} entries, `
    + `${counts.characters} characters, ${counts.strokes} strokes, ${counts.audioReadings} audio readings; `
    + `${bytes} bytes; SHA-256 ${sha256}`
  );
  return { outputPath, bytes, sha256, counts };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runBuild();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
