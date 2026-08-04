import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = fileURLToPath(new URL('../', import.meta.url));

export function buildCatalog(indexDocument, editorial) {
  if (indexDocument.schemaVersion !== 1 || editorial.schemaVersion !== 1) {
    throw new Error('Unsupported catalog source schema');
  }
  const selected = indexDocument.entries.filter(entry => entry.stageId === editorial.stageId);
  if (selected.length !== 225) throw new Error(`Expected 225 g4-fall entries, found ${selected.length}`);
  const selectedCharacters = new Set(selected.map(entry => entry.character));
  const editorialCharacters = Object.keys(editorial.words);
  if (editorialCharacters.length !== 225 || editorialCharacters.some(character => !selectedCharacters.has(character))) {
    throw new Error('Editorial word keys must exactly match the g4-fall character set');
  }
  const sets = [];
  for (let offset = 0; offset < selected.length; offset += 15) {
    const number = offset / 15 + 1;
    const entries = selected.slice(offset, offset + 15).map(source => {
      const words = editorial.words[source.character];
      if (!Array.isArray(words) || words.length !== 2
          || words.some(word => typeof word !== 'string' || !word.includes(source.character))) {
        throw new Error(`Invalid editorial words for ${source.character}`);
      }
      return {
        character: source.character,
        pinyin: source.pinyin,
        audio: source.audio,
        words
      };
    });
    sets.push({
      id: `g4f-${String(number).padStart(2, '0')}`,
      number,
      title: `第${number}组`,
      entries
    });
  }
  return {
    schemaVersion: 2,
    framework: {
      id: 'independent-primary-hanzi-v1',
      title: '小学汉字独立分级',
      methodVersion: indexDocument.methodVersion,
      nonAligned: true,
      disclaimer: '本应用内容为独立编排，非教材同步，与任何教材出版社不存在隶属、授权或背书关系。'
    },
    reviewStatus: editorial.reviewStatus,
    stages: [{
      id: 'g4-fall',
      grade: 4,
      term: 'fall',
      title: '四年级上阶段',
      subtitle: '独立编排',
      setIds: sets.map(set => set.id)
    }],
    sets
  };
}

export async function runBuild({ baseDir = rootDir } = {}) {
  const [indexDocument, editorial] = await Promise.all([
    readFile(path.join(baseDir, 'data/catalog-index.json'), 'utf8').then(JSON.parse),
    readFile(path.join(baseDir, 'data/catalog-editorial.json'), 'utf8').then(JSON.parse)
  ]);
  const catalog = buildCatalog(indexDocument, editorial);
  await writeFile(path.join(baseDir, 'data/catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  return catalog;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const catalog = await runBuild();
    console.log(`Built ${catalog.sets.length} sets in data/catalog.json`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
