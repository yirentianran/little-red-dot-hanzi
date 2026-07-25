import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const defaultRootDir = fileURLToPath(new URL('../', import.meta.url));
const audioIdPattern = /^[a-z]+[1-5]$/;

export const AUDIO_SOURCE = Object.freeze({
  repository: 'https://github.com/hugolpz/audio-cmn',
  commit: 'ff9ed3d0c631195bd2c06f39450f3264c7124040',
  subset: '64k/syllabs',
  license: 'CC-BY-SA-3.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/legalcode.en',
  attribution: 'Wang Chen (王琛), Hugo Lopez, Nicolas Vion',
  rawBaseUrl: 'https://raw.githubusercontent.com/hugolpz/audio-cmn/ff9ed3d0c631195bd2c06f39450f3264c7124040'
});

function manifestSource() {
  const { rawBaseUrl: _rawBaseUrl, ...source } = AUDIO_SOURCE;
  return source;
}

export function collectAudioIds(curriculum) {
  if (!curriculum || typeof curriculum !== 'object' || !Array.isArray(curriculum.units)) {
    throw new Error('Curriculum must contain a units array');
  }

  const ids = new Set();
  for (const unit of curriculum.units) {
    for (const section of unit.lessons ?? []) {
      for (const group of ['recognize', 'write']) {
        for (const entry of section[group] ?? []) {
          sourceRecordForId(entry.audio);
          ids.add(entry.audio);
        }
      }
    }
  }
  return [...ids].sort();
}

export function sourceRecordForId(id) {
  if (typeof id !== 'string' || !audioIdPattern.test(id)) {
    throw new Error(`Invalid audio id: ${String(id)}`);
  }
  const sourceLabel = id === 'ju4' ? 'jv4' : id;
  return {
    id,
    sourceFile: `${AUDIO_SOURCE.subset}/cmn-${sourceLabel}.mp3`,
    sourceLabel
  };
}

export function validateAudioMetadata(expectedLabel, inspection) {
  const streams = Array.isArray(inspection?.streams) ? inspection.streams : [];
  const stream = streams.find(candidate => candidate?.codec_type === 'audio');
  if (!stream || stream.codec_name !== 'mp3') {
    throw new Error(`${expectedLabel}: source is not a decodable MP3 audio stream`);
  }
  if (stream.channels !== 1) {
    throw new Error(`${expectedLabel}: source must contain a single-channel mono stream`);
  }

  const tags = inspection?.format?.tags ?? {};
  if (tags.SWAC_TEXT !== expectedLabel) {
    throw new Error(`${expectedLabel}: SWAC_TEXT must equal ${expectedLabel}, received ${String(tags.SWAC_TEXT)}`);
  }
  if (tags.SWAC_COLL_LICENSE !== AUDIO_SOURCE.license) {
    throw new Error(`${expectedLabel}: SWAC_COLL_LICENSE must equal ${AUDIO_SOURCE.license}`);
  }
  if (typeof tags.SWAC_COLL_AUTHORS !== 'string' || tags.SWAC_COLL_AUTHORS.trim() === '') {
    throw new Error(`${expectedLabel}: source author metadata is missing`);
  }
  if (typeof tags.SWAC_COLL_COPYRIGHT !== 'string' || tags.SWAC_COLL_COPYRIGHT.trim() === '') {
    throw new Error(`${expectedLabel}: source copyright metadata is missing`);
  }

  return {
    authors: tags.SWAC_COLL_AUTHORS,
    copyright: tags.SWAC_COLL_COPYRIGHT
  };
}

export async function inspectAudioFile(filePath, { execFileImpl = execFileAsync } = {}) {
  let probeOutput;
  try {
    const result = await execFileImpl('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=codec_name,codec_type,channels:format_tags',
      '-of', 'json',
      filePath
    ], { maxBuffer: 1024 * 1024 });
    probeOutput = result.stdout;
  } catch (error) {
    throw new Error(`ffprobe could not inspect ${path.basename(filePath)}: ${error.stderr || error.message}`);
  }

  let inspection;
  try {
    inspection = JSON.parse(probeOutput);
  } catch (error) {
    throw new Error(`ffprobe returned invalid JSON for ${path.basename(filePath)}: ${error.message}`);
  }

  try {
    await execFileImpl('ffmpeg', [
      '-v', 'error',
      '-i', filePath,
      '-map', '0:a:0',
      '-f', 'null',
      '-'
    ], { maxBuffer: 1024 * 1024 });
  } catch (error) {
    throw new Error(`ffmpeg could not fully decode ${path.basename(filePath)}: ${error.stderr || error.message}`);
  }

  return inspection;
}

export function parseArguments(arguments_) {
  const result = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--source') {
      const value = arguments_[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--source requires a path');
      result.sourceDir = value;
      index += 1;
      continue;
    }
    if (argument === '--verify') {
      result.verify = true;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (result.verify && result.sourceDir !== undefined) {
    throw new Error('Cannot combine --verify with --source');
  }
  return result;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  let firstError;

  async function worker() {
    while (firstError === undefined) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      try {
        results[index] = await mapper(items[index], index);
      } catch (error) {
        firstError ??= error;
      }
    }
  }

  const workerCount = Math.min(concurrency, Math.max(items.length, 1));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (firstError !== undefined) throw firstError;
  return results;
}

async function readSourceBytes({ sourceDir, sourceFile, fetchImpl }) {
  if (sourceDir !== undefined) {
    try {
      return await readFile(path.join(sourceDir, ...sourceFile.split('/')));
    } catch (error) {
      throw new Error(`Unable to read source audio ${sourceFile}: ${error.message}`);
    }
  }

  const url = `${AUDIO_SOURCE.rawBaseUrl}/${sourceFile}`;
  let response;
  try {
    response = await fetchImpl(url);
  } catch (error) {
    throw new Error(`Unable to fetch source audio ${url}: ${error.message}`);
  }
  if (!response?.ok) {
    throw new Error(`Unable to fetch source audio ${url}: HTTP ${response?.status ?? 'unknown'}`);
  }
  try {
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    throw new Error(`Unable to read fetched source audio ${url}: ${error.message}`);
  }
}

function createManifest(records) {
  return {
    schemaVersion: 1,
    format: 'audio/mpeg',
    source: manifestSource(),
    readings: Object.fromEntries(records.map(({ id, ...record }) => [id, record]))
  };
}

function validateManifestDocument(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Audio manifest must be an object');
  }
  if (manifest.schemaVersion !== 1) throw new Error('Audio manifest schemaVersion must equal 1');
  if (manifest.format !== 'audio/mpeg') throw new Error('Audio manifest format must equal audio/mpeg');
  if (JSON.stringify(manifest.source) !== JSON.stringify(manifestSource())) {
    throw new Error('Audio manifest source does not match the pinned upstream source');
  }
  if (!manifest.readings || typeof manifest.readings !== 'object' || Array.isArray(manifest.readings)) {
    throw new Error('Audio manifest readings must be an object');
  }

  const ids = Object.keys(manifest.readings);
  if (ids.length === 0) throw new Error('Audio manifest readings must not be empty');
  if (JSON.stringify(ids) !== JSON.stringify([...ids].sort())) {
    throw new Error('Audio manifest reading ids must be sorted');
  }

  for (const id of ids) {
    const expectedSource = sourceRecordForId(id);
    const record = manifest.readings[id];
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error(`${id}: audio manifest record must be an object`);
    }
    if (record.file !== `assets/audio/${id}.mp3`) {
      throw new Error(`${id}: manifest file path is invalid`);
    }
    if (record.sourceFile !== expectedSource.sourceFile || record.sourceLabel !== expectedSource.sourceLabel) {
      throw new Error(`${id}: manifest source mapping is invalid`);
    }
    if (!Number.isInteger(record.bytes) || record.bytes < 1) {
      throw new Error(`${id}: manifest byte count must be a positive integer`);
    }
    if (typeof record.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.sha256)) {
      throw new Error(`${id}: manifest SHA-256 is invalid`);
    }
    if (record.metadataVerified !== true) {
      throw new Error(`${id}: metadataVerified must be true`);
    }
    if (typeof record.auditoryReviewed !== 'boolean') {
      throw new Error(`${id}: auditoryReviewed must be boolean`);
    }
  }

  return ids;
}

export async function verifyAudioDirectory({
  audioDir = path.join(defaultRootDir, 'assets/audio'),
  inspectFile = inspectAudioFile,
  concurrency = 6
} = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('Audio verification concurrency must be a positive integer');
  }

  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(audioDir, 'manifest.json'), 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read audio manifest: ${error.message}`);
  }
  const ids = validateManifestDocument(manifest);

  let directoryEntries;
  try {
    directoryEntries = await readdir(audioDir, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Unable to read audio directory: ${error.message}`);
  }
  const mp3Entries = directoryEntries.filter(entry => entry.name.toLowerCase().endsWith('.mp3'));
  for (const entry of mp3Entries) {
    if (!entry.isFile()) throw new Error(`${entry.name}: MP3 path must be a regular file`);
  }
  const actualFiles = mp3Entries.map(entry => entry.name).sort();
  const expectedFiles = ids.map(id => `${id}.mp3`);
  const missingFiles = expectedFiles.filter(file => !actualFiles.includes(file));
  const extraFiles = actualFiles.filter(file => !expectedFiles.includes(file));
  if (missingFiles.length > 0) throw new Error(`Missing MP3 files: ${missingFiles.join(', ')}`);
  if (extraFiles.length > 0) throw new Error(`Unexpected MP3 files: ${extraFiles.join(', ')}`);

  const verified = await mapWithConcurrency(ids, concurrency, async id => {
    const record = manifest.readings[id];
    const filePath = path.join(audioDir, `${id}.mp3`);
    let bytes;
    try {
      bytes = await readFile(filePath);
    } catch (error) {
      throw new Error(`${id}: unable to read MP3: ${error.message}`);
    }
    if (bytes.length !== record.bytes) {
      throw new Error(`${id}: byte count ${bytes.length} does not match manifest ${record.bytes}`);
    }
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== record.sha256) {
      throw new Error(`${id}: SHA-256 does not match manifest`);
    }

    const inspection = await inspectFile(filePath);
    validateAudioMetadata(record.sourceLabel, inspection);
    return record.bytes;
  });

  return {
    fileCount: ids.length,
    totalBytes: verified.reduce((sum, bytes) => sum + bytes, 0)
  };
}

async function publishAudio(stagingDir, outputDir, records, manifest) {
  await mkdir(outputDir, { recursive: true });
  const temporaryFiles = [];
  try {
    for (const { id } of records) {
      const temporaryPath = path.join(outputDir, `.${id}.mp3.sync-${process.pid}`);
      temporaryFiles.push(temporaryPath);
      await copyFile(path.join(stagingDir, `${id}.mp3`), temporaryPath);
      await rename(temporaryPath, path.join(outputDir, `${id}.mp3`));
    }

    const wanted = new Set(records.map(record => `${record.id}.mp3`));
    for (const entry of await readdir(outputDir, { withFileTypes: true })) {
      if (entry.isFile() && /^[a-z]+[1-5]\.mp3$/.test(entry.name) && !wanted.has(entry.name)) {
        await unlink(path.join(outputDir, entry.name));
      }
    }

    const manifestTemporaryPath = path.join(outputDir, `.manifest.json.sync-${process.pid}`);
    temporaryFiles.push(manifestTemporaryPath);
    await writeFile(manifestTemporaryPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await rename(manifestTemporaryPath, path.join(outputDir, 'manifest.json'));
  } finally {
    await Promise.all(temporaryFiles.map(file => rm(file, { force: true })));
  }
}

export async function syncAudio({
  curriculum,
  outputDir = path.join(defaultRootDir, 'assets/audio'),
  sourceDir,
  fetchImpl = globalThis.fetch,
  inspectFile = inspectAudioFile,
  concurrency = 6
} = {}) {
  if (curriculum === undefined) {
    try {
      curriculum = JSON.parse(await readFile(path.join(defaultRootDir, 'data/curriculum.json'), 'utf8'));
    } catch (error) {
      throw new Error(`Unable to read curriculum: ${error.message}`);
    }
  }
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('Audio sync concurrency must be a positive integer');
  }
  if (sourceDir === undefined && typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required when --source is not used');
  }

  const ids = collectAudioIds(curriculum);
  await mkdir(path.dirname(outputDir), { recursive: true });
  const stagingDir = await mkdtemp(path.join(path.dirname(outputDir), '.audio-sync-'));
  try {
    const records = await mapWithConcurrency(ids, concurrency, async id => {
      const source = sourceRecordForId(id);
      const bytes = await readSourceBytes({ sourceDir, sourceFile: source.sourceFile, fetchImpl });
      if (bytes.length === 0) throw new Error(`${source.sourceFile}: source audio is empty`);

      const stagingPath = path.join(stagingDir, `${id}.mp3`);
      await writeFile(stagingPath, bytes);
      const inspection = await inspectFile(stagingPath);
      validateAudioMetadata(source.sourceLabel, inspection);

      return {
        id,
        file: `assets/audio/${id}.mp3`,
        sourceFile: source.sourceFile,
        sourceLabel: source.sourceLabel,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        metadataVerified: true,
        auditoryReviewed: false
      };
    });

    const manifest = createManifest(records);
    await publishAudio(stagingDir, outputDir, records, manifest);
    return {
      fileCount: records.length,
      totalBytes: records.reduce((sum, record) => sum + record.bytes, 0),
      manifest
    };
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.verify) {
      const result = await verifyAudioDirectory();
      console.log(`Verified ${result.fileCount} audio files (${result.totalBytes} bytes)`);
    } else {
      const result = await syncAudio(options);
      console.log(`Synced ${result.fileCount} audio files (${result.totalBytes} bytes)`);
    }
  } catch (error) {
    console.error(`Audio operation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
