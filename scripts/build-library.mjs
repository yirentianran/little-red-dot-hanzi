import { createHash, randomUUID } from 'node:crypto';
import { access, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateLibrary } from './lib/library-validator.mjs';

const rootDir = fileURLToPath(new URL('../', import.meta.url));
const OUTPUT = 'data/library-data.js';
const NOTICES = Object.freeze({
  projectLicense: 'LICENSE',
  hanziWriterLicense: 'vendor/HANZI_WRITER_LICENSE.txt',
  geometryLicense: 'data/ARPHICPL.TXT',
  geometrySource: 'data/source-data-license.md',
  audioAttribution: 'assets/audio/THIRD_PARTY_NOTICES.md',
  audioLicense: 'assets/audio/CC-BY-SA-3.0.html',
  unicodeLicense: 'data/UNICODE_LICENSE.txt',
  catalogProvenance: 'data/catalog-provenance.md'
});

async function readJson(base, relative, read = readFile) {
  try { return JSON.parse(await read(path.join(base, relative), 'utf8')); }
  catch (error) { throw new Error(`Unable to read ${relative}: ${error.message}`); }
}
function sorted(mapping, transform) {
  return Object.fromEntries(Object.keys(mapping).sort().map(key => [key, transform(mapping[key])]));
}
function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
function entries(catalog) { return catalog.sets.flatMap(set => set.entries); }

function createRuntimeCurriculum(catalog) {
  const setsById = new Map(catalog.sets.map(set => [set.id, set]));
  return {
    schemaVersion: 1,
    book: {
      publisher: '独立编排',
      approvalYear: 2026,
      grade: 4,
      volume: '上阶段'
    },
    units: catalog.stages.map(stage => ({
      id: stage.id,
      title: stage.title,
      lessons: stage.setIds.map(setId => {
        const set = setsById.get(setId);
        return {
          kind: 'garden',
          id: set.id,
          title: set.title,
          recognize: [],
          write: set.entries
        };
      })
    }))
  };
}

export function buildRuntimeSource(catalog, characters, manifest) {
  const errors = validateLibrary(catalog, characters, new Set(Object.keys(manifest.readings || {})));
  if (errors.length) throw new TypeError(`Source validation failed:\n${errors.join('\n')}`);
  const wanted = new Set(entries(catalog).map(entry => entry.audio));
  const payload = {
    schemaVersion: 1,
    geometryNotice: characters.modificationNotice,
    curriculum: createRuntimeCurriculum(catalog),
    characters: sorted(characters.characters, value => value),
    audio: { format: manifest.format, readings: sorted(manifest.readings, value => ({ file: value.file })) },
    notices: NOTICES
  };
  const source = `/* Character geometry: ARPHICPL; see data/ARPHICPL.TXT. */\nwindow.HANZI_LIBRARY = ${safeJson(payload)};\n`;
  if (/https?:\/\//i.test(source) || /\bfetch\b/i.test(source) || /<\/script/i.test(source)) {
    throw new TypeError('Generated runtime source contains a forbidden network or script token');
  }
  if (Object.keys(manifest.readings).some(id => !wanted.has(id))) throw new TypeError('Audio manifest contains unreferenced readings');
  return source;
}
async function cleanup(file, unlinkImpl) { try { await unlinkImpl(file); } catch (error) { if (error.code !== 'ENOENT') return error; } }
export async function runBuild({
  rootDir: base = rootDir, stdout = console.log, readFileImpl = readFile, accessImpl = access,
  writeFileImpl = writeFile, renameImpl = rename, unlinkImpl = unlink,
  candidateNameFactory = () => `${process.pid}-${randomUUID()}`
} = {}) {
  const [catalog, characters, manifest] = await Promise.all([
    readJson(base, 'data/catalog.json', readFileImpl), readJson(base, 'data/characters.json', readFileImpl),
    readJson(base, 'assets/audio/manifest.json', readFileImpl)
  ]);
  const source = buildRuntimeSource(catalog, characters, manifest);
  await Promise.all([
    ...Object.values(manifest.readings).map(record => accessImpl(path.join(base, record.file))),
    ...Object.values(NOTICES).map(notice => accessImpl(path.join(base, notice)))
  ]);
  const output = path.join(base, OUTPUT);
  const candidate = `${output}.candidate-${candidateNameFactory()}`;
  try { await writeFileImpl(candidate, source, { encoding: 'utf8', flag: 'wx' }); await renameImpl(candidate, output); }
  catch (error) { await cleanup(candidate, unlinkImpl); throw new Error(`Unable to publish ${OUTPUT}: ${error.message}`); }
  const counts = {
    stages: catalog.stages.length,
    sets: catalog.sets.length,
    entries: entries(catalog).length,
    characters: Object.keys(characters.characters).length,
    audioReadings: Object.keys(manifest.readings).length
  };
  const bytes = Buffer.byteLength(source); const sha256 = createHash('sha256').update(source).digest('hex');
  stdout(`Built ${OUTPUT}: ${counts.stages} stages, ${counts.sets} sets, ${counts.entries} entries, ${counts.audioReadings} audio readings; SHA-256 ${sha256}`);
  return { outputPath: output, bytes, sha256, counts };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await runBuild(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
