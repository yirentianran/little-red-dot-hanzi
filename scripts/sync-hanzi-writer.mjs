import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const expectedVersion = '3.7.3';
const vendorFiles = [
  ['dist/hanzi-writer.min.js', 'hanzi-writer.min.js'],
  ['LICENSE', 'HANZI_WRITER_LICENSE.txt']
];

export async function syncHanziWriter({ rootDir = projectRoot, verify = false } = {}) {
  const packageDir = path.join(rootDir, 'node_modules', 'hanzi-writer');
  const metadata = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'));
  if (metadata.version !== expectedVersion) {
    throw new Error(`Expected hanzi-writer ${expectedVersion}; installed ${String(metadata.version)}`);
  }

  const vendorDir = path.join(rootDir, 'vendor');
  if (verify) {
    for (const [sourceName, outputName] of vendorFiles) {
      const [source, output] = await Promise.all([
        readFile(path.join(packageDir, sourceName)),
        readFile(path.join(vendorDir, outputName))
      ]);
      if (!source.equals(output)) throw new Error(`${outputName} is not synchronized`);
    }
    return { version: metadata.version, verified: true };
  }

  await mkdir(vendorDir, { recursive: true });
  await Promise.all(vendorFiles.map(([sourceName, outputName]) => copyFile(
    path.join(packageDir, sourceName),
    path.join(vendorDir, outputName)
  )));
  return { version: metadata.version, verified: false };
}

function parseArguments(arguments_) {
  if (arguments_.length === 0) return { verify: false };
  if (arguments_.length === 1 && arguments_[0] === '--verify') return { verify: true };
  throw new Error(`Unknown argument: ${arguments_.join(' ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await syncHanziWriter(parseArguments(process.argv.slice(2)));
    console.log(`${result.verified ? 'Verified' : 'Synchronized'} Hanzi Writer ${result.version} vendor files`);
  } catch (error) {
    console.error(`Hanzi Writer vendor operation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
