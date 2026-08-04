import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
const ignored = new Set([
  '.git', '.claude', '.vscode', '.superpowers', '.worktrees', 'node_modules', 'build', '.gradle'
]);
const textExtensions = new Set(['.html', '.js', '.json', '.kt', '.kts', '.md', '.mjs', '.properties', '.txt', '.xml', '.gradle']);
const forbidden = [
  '\u4eba\u6559\u7248',
  '\u4eba\u6c11\u6559\u80b2\u51fa\u7248\u793e',
  '2019\u5e74\u5ba1\u5b9a',
  ['PEP Grade 4', 'Volume 1'].join(' '),
  '\u89c2\u6f6e.*\u8d70\u6708\u4eae.*\u73b0\u4ee3\u8bd7\u4e8c\u9996',
  '\u4e3a\u4e2d\u534e\u4e4b\u5d1b\u8d77\u800c\u8bfb\u4e66',
  '\u897f\u95e8\u8c79\u6cbb\u90ba'
].map(source => new RegExp(source, 'su'));

async function filesUnder(root) {
  const result = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else result.push(target);
    }
  }
  await visit(root); return result;
}

export async function scanSensitiveContent(root = defaultRoot) {
  const findings = [];
  for (const file of await filesUnder(path.resolve(root))) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (path.basename(file).toLowerCase() === ['curri', 'culum.json'].join('')) findings.push(`${relative}: forbidden legacy filename`);
    if (!textExtensions.has(path.extname(file).toLowerCase())) continue;
    const source = await readFile(file, 'utf8');
    forbidden.forEach((pattern, index) => { if (pattern.test(source)) findings.push(`${relative}: sensitive pattern ${index + 1}`); });
  }
  return findings;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const findings = await scanSensitiveContent(process.argv[2] || defaultRoot);
  if (findings.length) { console.error(findings.join('\n')); process.exitCode = 1; }
  else console.log('Sensitive-content scan passed');
}
