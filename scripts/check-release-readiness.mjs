import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = fileURLToPath(new URL('../', import.meta.url));

export async function checkReleaseReadiness({ baseDir = rootDir } = {}) {
  const [catalog, checklist, manifest] = await Promise.all([
    readFile(path.join(baseDir, 'data/catalog.json'), 'utf8').then(JSON.parse),
    readFile(path.join(baseDir, 'data/review-checklist.json'), 'utf8').then(JSON.parse),
    readFile(path.join(baseDir, 'assets/audio/manifest.json'), 'utf8').then(JSON.parse)
  ]);
  const entries = catalog.sets.flatMap(set => set.entries);
  const errors = [];
  for (const entry of entries) {
    const review = checklist.entries?.[entry.character];
    if (review?.pinyin !== 'human-reviewed') errors.push(`${entry.character}: pinyin not human-reviewed`);
    if (review?.words !== 'human-reviewed') errors.push(`${entry.character}: words not human-reviewed`);
    if (review?.audio !== 'auditory-reviewed') errors.push(`${entry.character}: audio not auditory-reviewed`);
    if (manifest.readings?.[entry.audio]?.auditoryReviewed !== true) errors.push(`${entry.audio}: manifest auditoryReviewed is false`);
  }
  if (errors.length) throw new Error(`Release review gate failed (${errors.length} checks):\n${errors.slice(0, 20).join('\n')}`);
  return { entries: entries.length, audioReadings: Object.keys(manifest.readings).length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await checkReleaseReadiness();
    console.log(`Release review complete: ${result.entries} entries, ${result.audioReadings} recordings`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
