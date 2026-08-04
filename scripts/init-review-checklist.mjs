import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = fileURLToPath(new URL('../', import.meta.url));

export async function run({ baseDir = rootDir } = {}) {
  const catalog = JSON.parse(await readFile(path.join(baseDir, 'data/catalog.json'), 'utf8'));
  const entries = catalog.sets.flatMap(set => set.entries);
  const checklist = {
    schemaVersion: 1,
    releaseRule: 'Every field must be reviewed before a release build.',
    entries: Object.fromEntries(entries.map(entry => [entry.character, {
      pinyin: 'source-verified', words: 'pending-human-review', audio: 'pending-auditory-review'
    }]))
  };
  await writeFile(path.join(baseDir, 'data/review-checklist.json'), `${JSON.stringify(checklist, null, 2)}\n`, 'utf8');
  return entries.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(`Initialized ${await run()} review checklist entries`);
}
