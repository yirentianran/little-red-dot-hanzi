import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  AUDIO_SOURCE,
  collectAudioIds,
  parseArguments,
  sourceRecordForId,
  syncAudio,
  validateAudioMetadata,
  verifyAudioDirectory,
  verifySourceCheckout
} from '../scripts/sync-audio.mjs';

const catalog = JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url), 'utf8'));

const expectedSource = {
  repository: 'https://github.com/hugolpz/audio-cmn',
  commit: 'ff9ed3d0c631195bd2c06f39450f3264c7124040',
  subset: '64k/syllabs',
  license: 'CC-BY-SA-3.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/legalcode.en',
  attribution: 'Wang Chen (王琛), Hugo Lopez, Nicolas Vion'
};

const criticalReadings = [
  ['宵', 'xiāo', 'xiao1'],
  ['宴', 'yàn', 'yan4'],
  ['扇', 'shàn', 'shan4'],
  ['崭', 'zhǎn', 'zhan3'],
  ['渗', 'shèn', 'shen4'],
  ['凿', 'záo', 'zao2'],
  ['蛛', 'zhū', 'zhu1'],
  ['缚', 'fù', 'fu4'],
  ['瞅', 'chǒu', 'chou3'],
  ['僵', 'jiāng', 'jiang1'],
  ['讶', 'yà', 'ya4'],
  ['苏', 'sū', 'su1']
];

function allEntries(document = catalog) {
  return document.sets.flatMap(set => set.entries);
}

function fixtureCatalog(ids) {
  return {
    sets: [{ entries: ids.map(audio => ({ character: '字', pinyin: 'zì', audio })) }]
  };
}

function inspection(label) {
  return {
    streams: [{ codec_name: 'mp3', codec_type: 'audio', channels: 1 }],
    format: {
      tags: {
        SWAC_TEXT: label,
        SWAC_COLL_LICENSE: 'CC-BY-SA-3.0',
        SWAC_COLL_AUTHORS: 'Wang Chen, Lopez Hugo, Vion Nicolas',
        SWAC_COLL_COPYRIGHT: 'Copyright© 2013 Wang Chen, Lopez Hugo, Vion Nicolas'
      }
    }
  };
}

async function temporaryDirectory(t, prefix) {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

const acceptTestSourceRevision = async () => {};

async function snapshotDirectory(directory) {
  const snapshot = {};
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return snapshot;
    throw error;
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await snapshotDirectory(entryPath);
      for (const [name, bytes] of Object.entries(nested)) snapshot[`${entry.name}/${name}`] = bytes;
    } else {
      snapshot[entry.name] = (await readFile(entryPath)).toString('base64');
    }
  }
  return snapshot;
}

async function assertNoPublishTemps(parentDirectory) {
  const leftovers = (await readdir(parentDirectory))
    .filter(name => /\.audio-(candidate|backup)-/.test(name));
  assert.deepEqual(leftovers, [], `unexpected publish temporary paths: ${leftovers.join(', ')}`);
}

function gitInspection({ sourceDir, head = AUDIO_SOURCE.commit, status = '' }) {
  return async (command, arguments_) => {
    assert.equal(command, 'git');
    if (arguments_.includes('--show-toplevel')) return { stdout: `${sourceDir}\n`, stderr: '' };
    if (arguments_.at(-1) === 'HEAD') return { stdout: `${head}\n`, stderr: '' };
    if (arguments_.includes('--porcelain=v1')) return { stdout: status, stderr: '' };
    throw new Error(`unexpected git arguments: ${arguments_.join(' ')}`);
  };
}

test('collects the 187 unique catalog audio ids in deterministic order', () => {
  const ids = collectAudioIds(catalog);

  assert.equal(ids.length, 187);
  assert.deepEqual(ids, [...ids].sort());
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every(id => /^[a-z]+[1-5]$/.test(id)));
});

test('rejects missing catalog structure with exact data locations', () => {
  const invalidDocuments = [
    [null, /catalog.*object/i],
    [{}, /catalog\.sets.*array/i],
    [{ sets: [] }, /catalog\.sets.*non-empty/i],
    [{ sets: [null] }, /catalog\.sets\[0\].*object/i],
    [{ sets: [{}] }, /catalog\.sets\[0\]\.entries.*array/i],
    [{ sets: [{ entries: [null] }] }, /entries\[0\].*object/i],
    [{ sets: [{ entries: [{ audio: 'bad' }] }] }, /entries\[0\]\.audio.*invalid/i],
    [{ sets: [{ entries: [] }] }, /at least one audio id/i]
  ];

  for (const [document, expected] of invalidDocuments) {
    assert.throws(() => collectAudioIds(document), expected);
  }
});

test('maps ju4 to the upstream jv4 spelling and leaves other ids unchanged', () => {
  assert.deepEqual(sourceRecordForId('ju4'), {
    id: 'ju4',
    sourceFile: '64k/syllabs/cmn-jv4.mp3',
    sourceLabel: 'jv4'
  });
  assert.deepEqual(sourceRecordForId('chao2'), {
    id: 'chao2',
    sourceFile: '64k/syllabs/cmn-chao2.mp3',
    sourceLabel: 'chao2'
  });
});

test('rejects unsafe or malformed audio ids before building source paths', () => {
  for (const id of ['', '../chao2', 'CHAO2', 'chao2.mp3', 'chao0']) {
    assert.throws(() => sourceRecordForId(id), /audio id/i);
  }
});

test('accepts only decodable mono MP3 metadata with the expected SWAC fields', () => {
  assert.deepEqual(validateAudioMetadata('chao2', inspection('chao2')), {
    authors: 'Wang Chen, Lopez Hugo, Vion Nicolas',
    copyright: 'Copyright© 2013 Wang Chen, Lopez Hugo, Vion Nicolas'
  });

  const invalidCases = [
    [inspection('wrong2'), /SWAC_TEXT.*chao2/i],
    [{ ...inspection('chao2'), streams: [{ codec_name: 'aac', codec_type: 'audio', channels: 1 }] }, /MP3/i],
    [{ ...inspection('chao2'), streams: [{ codec_name: 'mp3', codec_type: 'audio', channels: 2 }] }, /mono|single.channel/i],
    [{ ...inspection('chao2'), format: { tags: { ...inspection('chao2').format.tags, SWAC_COLL_LICENSE: 'unknown' } } }, /CC-BY-SA-3.0/i],
    [{ ...inspection('chao2'), format: { tags: { ...inspection('chao2').format.tags, SWAC_COLL_AUTHORS: '' } } }, /author/i],
    [{ ...inspection('chao2'), format: { tags: { ...inspection('chao2').format.tags, SWAC_COLL_COPYRIGHT: '' } } }, /copyright/i]
  ];

  for (const [candidate, expected] of invalidCases) {
    assert.throws(() => validateAudioMetadata('chao2', candidate), expected);
  }
});

test('parses local-source usage and reports invalid command lines clearly', () => {
  assert.deepEqual(parseArguments([]), {});
  assert.deepEqual(parseArguments(['--source', '/tmp/audio-cmn']), { sourceDir: '/tmp/audio-cmn' });
  assert.deepEqual(parseArguments(['--verify']), { verify: true });
  assert.throws(() => parseArguments(['--source']), /--source.*path/i);
  assert.throws(() => parseArguments(['--verify', '--source', '/tmp/audio-cmn']), /cannot.*--verify.*--source/i);
  assert.throws(() => parseArguments(['--unknown']), /unknown argument.*--unknown/i);
});

test('requires the local source checkout to match the pinned revision', async () => {
  const sourceDir = '/tmp/audio-cmn-wrong-revision';
  await assert.rejects(() => verifySourceCheckout(sourceDir, {
    execFileImpl: gitInspection({ sourceDir, head: '0123456789abcdef' })
  }), new RegExp(`expected.*${AUDIO_SOURCE.commit}.*actual.*0123456789abcdef`, 'i'));
});

test('rejects tracked and untracked changes in the pinned source subset', async () => {
  const sourceDir = '/tmp/audio-cmn-dirty';
  const status = ' M 64k/syllabs/cmn-chao2.mp3\n?? 64k/syllabs/untracked.mp3\n';
  await assert.rejects(() => verifySourceCheckout(sourceDir, {
    execFileImpl: gitInspection({ sourceDir, status })
  }), /64k\/syllabs.*(modified|dirty).*cmn-chao2\.mp3.*untracked\.mp3/is);
});

test('rejects a non-git local source before touching existing output', async t => {
  const directory = await temporaryDirectory(t, 'hanzi-audio-non-git-');
  const sourceDir = path.join(directory, 'source');
  const outputDir = path.join(directory, 'output');
  await mkdir(path.join(sourceDir, '64k/syllabs'), { recursive: true });
  await writeFile(path.join(sourceDir, '64k/syllabs/cmn-chao2.mp3'), 'source');
  await mkdir(outputDir);
  await writeFile(path.join(outputDir, 'sentinel.txt'), 'unchanged');
  const before = await snapshotDirectory(outputDir);

  await assert.rejects(() => syncAudio({
    catalog: fixtureCatalog(['chao2']),
    outputDir,
    sourceDir,
    inspectFile: async () => inspection('chao2')
  }), /git checkout/i);

  assert.deepEqual(await snapshotDirectory(outputDir), before);
});

test('copies a local source byte-for-byte and writes a deterministic manifest', async t => {
  const directory = await temporaryDirectory(t, 'hanzi-audio-local-');
  const sourceDir = path.join(directory, 'source');
  const outputDir = path.join(directory, 'output');
  const sourceFile = path.join(sourceDir, '64k/syllabs/cmn-chao2.mp3');
  const sourceBytes = Buffer.from('fixture-source-mp3-bytes');
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, 'NOTICE.txt'), 'preserve this notice');
  await mkdir(path.dirname(sourceFile), { recursive: true });
  await writeFile(sourceFile, sourceBytes);

  const result = await syncAudio({
    catalog: fixtureCatalog(['chao2']),
    outputDir,
    sourceDir,
    inspectFile: async () => inspection('chao2'),
    verifySourceRevision: acceptTestSourceRevision
  });

  assert.equal(result.fileCount, 1);
  assert.equal(result.totalBytes, sourceBytes.length);
  assert.deepEqual(await readFile(path.join(outputDir, 'chao2.mp3')), sourceBytes);
  assert.equal(await readFile(path.join(outputDir, 'NOTICE.txt'), 'utf8'), 'preserve this notice');
  const manifestText = await readFile(path.join(outputDir, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(manifestText);
  assert.equal(manifestText, `${JSON.stringify(manifest, null, 2)}\n`);
  assert.deepEqual(manifest.source, expectedSource);
  assert.deepEqual(manifest.readings.chao2, {
    file: 'assets/audio/chao2.mp3',
    sourceFile: '64k/syllabs/cmn-chao2.mp3',
    sourceLabel: 'chao2',
    bytes: sourceBytes.length,
    sha256: createHash('sha256').update(sourceBytes).digest('hex'),
    metadataVerified: true,
    auditoryReviewed: false
  });
});

test('fetches from the pinned raw URL with bounded concurrency', async t => {
  const directory = await temporaryDirectory(t, 'hanzi-audio-fetch-');
  const ids = ['ai1', 'chao2', 'ju4'];
  let active = 0;
  let maximumActive = 0;
  const urls = [];

  await syncAudio({
    catalog: fixtureCatalog(ids),
    outputDir: path.join(directory, 'output'),
    concurrency: 2,
    fetchImpl: async url => {
      urls.push(url);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise(resolve => setImmediate(resolve));
      active -= 1;
      return { ok: true, arrayBuffer: async () => Buffer.from(url) };
    },
    inspectFile: async file => inspection(path.basename(file, '.mp3') === 'ju4' ? 'jv4' : path.basename(file, '.mp3'))
  });

  assert.equal(maximumActive, 2);
  assert.deepEqual(urls, ids.map(id => {
    const { sourceFile } = sourceRecordForId(id);
    return `${AUDIO_SOURCE.rawBaseUrl}/${sourceFile}`;
  }));
  assert.ok(urls.every(url => url.includes(AUDIO_SOURCE.commit)));
});

test('reports a missing local source without writing a partial manifest', async t => {
  const directory = await temporaryDirectory(t, 'hanzi-audio-missing-');
  const outputDir = path.join(directory, 'output');

  await assert.rejects(() => syncAudio({
    catalog: fixtureCatalog(['chao2']),
    outputDir,
    sourceDir: path.join(directory, 'missing'),
    inspectFile: async () => inspection('chao2'),
    verifySourceRevision: acceptTestSourceRevision
  }), /read source audio.*cmn-chao2\.mp3/i);

  await assert.rejects(readFile(path.join(outputDir, 'manifest.json')), /ENOENT/);
  await assertNoPublishTemps(directory);
});

test('rejects malformed catalog before fetching or changing existing output', async t => {
  const directory = await temporaryDirectory(t, 'hanzi-audio-catalog-');
  const outputDir = path.join(directory, 'output');
  await mkdir(outputDir);
  await writeFile(path.join(outputDir, 'manifest.json'), 'previous manifest\n');
  await writeFile(path.join(outputDir, 'old1.mp3'), 'previous audio');
  const before = await snapshotDirectory(outputDir);
  const invalidDocuments = [
    { sets: [] },
    { sets: [{}] },
    { sets: [{ entries: [null] }] },
    { sets: [{ entries: [] }] }
  ];

  for (const invalidCatalog of invalidDocuments) {
    let fetched = false;
    await assert.rejects(() => syncAudio({
      catalog: invalidCatalog,
      outputDir,
      fetchImpl: async () => {
        fetched = true;
        throw new Error('fetch must not run');
      },
      inspectFile: async () => inspection('chao2')
    }), /catalog\.sets|at least one audio id/);
    assert.equal(fetched, false);
    assert.deepEqual(await snapshotDirectory(outputDir), before);
  }
});

test('preserves the prior manifest and publishes no partial file when a fetch fails', async t => {
  const directory = await temporaryDirectory(t, 'hanzi-audio-partial-');
  const outputDir = path.join(directory, 'output');
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, 'manifest.json'), 'previous manifest\n');

  await assert.rejects(() => syncAudio({
    catalog: fixtureCatalog(['ai1', 'chao2']),
    outputDir,
    concurrency: 1,
    fetchImpl: async url => url.endsWith('cmn-ai1.mp3')
      ? { ok: true, arrayBuffer: async () => Buffer.from('first') }
      : { ok: false, status: 404 },
    inspectFile: async file => inspection(path.basename(file, '.mp3'))
  }), /fetch source audio.*404/i);

  assert.equal(await readFile(path.join(outputDir, 'manifest.json'), 'utf8'), 'previous manifest\n');
  assert.deepEqual((await readdir(outputDir)).sort(), ['manifest.json']);
  await assertNoPublishTemps(directory);
});

test('does not publish files when source metadata does not match the requested reading', async t => {
  const directory = await temporaryDirectory(t, 'hanzi-audio-metadata-');
  const outputDir = path.join(directory, 'output');

  await assert.rejects(() => syncAudio({
    catalog: fixtureCatalog(['chao2']),
    outputDir,
    fetchImpl: async () => ({ ok: true, arrayBuffer: async () => Buffer.from('bytes') }),
    inspectFile: async () => inspection('wrong2')
  }), /SWAC_TEXT.*chao2/i);

  await assert.rejects(readFile(path.join(outputDir, 'manifest.json')), /ENOENT/);
  await assertNoPublishTemps(directory);
});

test('restores the complete prior directory when the candidate directory rename fails', async t => {
  const directory = await temporaryDirectory(t, 'hanzi-audio-rollback-');
  const sourceDir = path.join(directory, 'source');
  const outputDir = path.join(directory, 'output');
  const sourceFile = path.join(sourceDir, '64k/syllabs/cmn-chao2.mp3');
  await mkdir(path.dirname(sourceFile), { recursive: true });
  await writeFile(sourceFile, Buffer.from('new source bytes'));
  await mkdir(path.join(outputDir, 'nested'), { recursive: true });
  await writeFile(path.join(outputDir, 'old1.mp3'), Buffer.from('old audio bytes'));
  await writeFile(path.join(outputDir, 'manifest.json'), 'old manifest\n');
  await writeFile(path.join(outputDir, 'THIRD_PARTY_NOTICES.md'), 'old notice\n');
  await writeFile(path.join(outputDir, 'nested/license.txt'), 'old nested license\n');
  const before = await snapshotDirectory(outputDir);
  let renameCalls = 0;

  await assert.rejects(() => syncAudio({
    catalog: fixtureCatalog(['chao2']),
    outputDir,
    sourceDir,
    inspectFile: async () => inspection('chao2'),
    verifySourceRevision: acceptTestSourceRevision,
    renamePath: async (from, to) => {
      renameCalls += 1;
      if (renameCalls === 2) throw new Error('injected candidate rename failure');
      return rename(from, to);
    }
  }), /injected candidate rename failure/i);

  assert.equal(renameCalls, 3, 'move old directory, fail candidate move, restore old directory');
  assert.deepEqual(await snapshotDirectory(outputDir), before);
  await assertNoPublishTemps(directory);
});

test('re-verifies a synced directory from its manifest without network access', async t => {
  const directory = await temporaryDirectory(t, 'hanzi-audio-verify-');
  const sourceDir = path.join(directory, 'source');
  const outputDir = path.join(directory, 'output');
  const sourceFile = path.join(sourceDir, '64k/syllabs/cmn-chao2.mp3');
  await mkdir(path.dirname(sourceFile), { recursive: true });
  await writeFile(sourceFile, Buffer.from('fixture-source-mp3-bytes'));
  await syncAudio({
    catalog: fixtureCatalog(['chao2']),
    outputDir,
    sourceDir,
    inspectFile: async () => inspection('chao2'),
    verifySourceRevision: acceptTestSourceRevision
  });
  let inspected = 0;

  const result = await verifyAudioDirectory({
    audioDir: outputDir,
    catalog: fixtureCatalog(['chao2']),
    inspectFile: async () => {
      inspected += 1;
      return inspection('chao2');
    }
  });

  assert.deepEqual(result, { fileCount: 1, totalBytes: 24 });
  assert.equal(inspected, 1);
});

test('verification rejects byte tampering before accepting the manifest', async t => {
  const directory = await temporaryDirectory(t, 'hanzi-audio-tamper-');
  const sourceDir = path.join(directory, 'source');
  const outputDir = path.join(directory, 'output');
  const sourceFile = path.join(sourceDir, '64k/syllabs/cmn-chao2.mp3');
  await mkdir(path.dirname(sourceFile), { recursive: true });
  await writeFile(sourceFile, Buffer.from('fixture-source-mp3-bytes'));
  await syncAudio({
    catalog: fixtureCatalog(['chao2']),
    outputDir,
    sourceDir,
    inspectFile: async () => inspection('chao2'),
    verifySourceRevision: acceptTestSourceRevision
  });
  await writeFile(path.join(outputDir, 'chao2.mp3'), Buffer.from('tampered'));

  await assert.rejects(() => verifyAudioDirectory({
    audioDir: outputDir,
    catalog: fixtureCatalog(['chao2']),
    inspectFile: async () => inspection('chao2')
  }), /chao2.*byte count|chao2.*SHA-256/i);
});

test('verification rejects extra MP3 files and changed embedded labels', async t => {
  const directory = await temporaryDirectory(t, 'hanzi-audio-extra-');
  const sourceDir = path.join(directory, 'source');
  const outputDir = path.join(directory, 'output');
  const sourceFile = path.join(sourceDir, '64k/syllabs/cmn-chao2.mp3');
  await mkdir(path.dirname(sourceFile), { recursive: true });
  await writeFile(sourceFile, Buffer.from('fixture-source-mp3-bytes'));
  await syncAudio({
    catalog: fixtureCatalog(['chao2']),
    outputDir,
    sourceDir,
    inspectFile: async () => inspection('chao2'),
    verifySourceRevision: acceptTestSourceRevision
  });
  await writeFile(path.join(outputDir, 'extra1.mp3'), Buffer.from('extra'));

  await assert.rejects(() => verifyAudioDirectory({
    audioDir: outputDir,
    catalog: fixtureCatalog(['chao2']),
    inspectFile: async () => inspection('chao2')
  }), /unexpected MP3.*extra1\.mp3/i);

  await rm(path.join(outputDir, 'extra1.mp3'));
  await assert.rejects(() => verifyAudioDirectory({
    audioDir: outputDir,
    catalog: fixtureCatalog(['chao2']),
    inspectFile: async () => inspection('wrong2')
  }), /SWAC_TEXT.*chao2/i);
});

test('verification rejects a self-consistent manifest that omits a catalog reading', async t => {
  const directory = await temporaryDirectory(t, 'hanzi-audio-coverage-');
  const sourceDir = path.join(directory, 'source');
  const outputDir = path.join(directory, 'output');
  const sourceFile = path.join(sourceDir, '64k/syllabs/cmn-chao2.mp3');
  await mkdir(path.dirname(sourceFile), { recursive: true });
  await writeFile(sourceFile, Buffer.from('fixture-source-mp3-bytes'));
  await syncAudio({
    catalog: fixtureCatalog(['chao2']),
    outputDir,
    sourceDir,
    inspectFile: async () => inspection('chao2'),
    verifySourceRevision: acceptTestSourceRevision
  });

  await assert.rejects(() => verifyAudioDirectory({
    audioDir: outputDir,
    catalog: fixtureCatalog(['ai1', 'chao2']),
    inspectFile: async () => inspection('chao2')
  }), /manifest.*catalog.*missing.*ai1/i);
});

test('the committed manifest exactly covers the catalog and byte-preserved MP3 files', async () => {
  const manifestText = await readFile(new URL('../assets/audio/manifest.json', import.meta.url), 'utf8');
  const manifest = JSON.parse(manifestText);
  const required = collectAudioIds(catalog);
  const readingIds = Object.keys(manifest.readings);

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.format, 'audio/mpeg');
  assert.deepEqual(manifest.source, expectedSource);
  assert.deepEqual(readingIds, required);
  assert.equal(manifestText, `${JSON.stringify(manifest, null, 2)}\n`);

  const directoryEntries = (await readdir(new URL('../assets/audio/', import.meta.url), { withFileTypes: true }))
    .filter(entry => entry.isFile() && /^[a-z]+[1-5]\.mp3$/.test(entry.name))
    .map(entry => entry.name)
    .sort();
  assert.deepEqual(directoryEntries, required.map(id => `${id}.mp3`));

  let totalBytes = 0;
  for (const id of readingIds) {
    const record = manifest.readings[id];
    const expectedSourceRecord = sourceRecordForId(id);
    assert.deepEqual({ id, sourceFile: record.sourceFile, sourceLabel: record.sourceLabel }, expectedSourceRecord);
    assert.equal(record.file, `assets/audio/${id}.mp3`);
    assert.ok(!record.file.includes('..'));
    assert.ok(Number.isInteger(record.bytes) && record.bytes > 0);
    assert.match(record.sha256, /^[a-f0-9]{64}$/);
    assert.equal(record.metadataVerified, true);
    assert.equal(record.auditoryReviewed, false);

    const bytes = await readFile(new URL(`../assets/audio/${id}.mp3`, import.meta.url));
    assert.equal(bytes.length, record.bytes, `${id} byte count`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256, `${id} SHA-256`);
    assert.equal(bytes.subarray(0, 3).toString('ascii'), 'ID3', `${id} MP3 ID3 marker`);
    totalBytes += bytes.length;
  }
  assert.equal(totalBytes, 1_840_362);
});

test('keeps representative catalog readings linked to available audio ids', async () => {
  const manifest = JSON.parse(await readFile(new URL('../assets/audio/manifest.json', import.meta.url), 'utf8'));
  const entries = allEntries();

  for (const [character, pinyin, audio] of criticalReadings) {
    assert.ok(entries.some(entry => entry.character === character && entry.pinyin === pinyin && entry.audio === audio), `${character} ${pinyin}`);
    assert.ok(manifest.readings[audio], `${audio} manifest record`);
  }
});

test('bundles attribution and the official CC BY-SA 3.0 legal text', async () => {
  const notice = await readFile(new URL('../assets/audio/THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8');
  const legalText = await readFile(new URL('../assets/audio/CC-BY-SA-3.0.html', import.meta.url), 'utf8');

  for (const expected of ['Wang Chen', '王琛', 'Hugo Lopez', 'Nicolas Vion', '© 2013', expectedSource.repository, expectedSource.commit, expectedSource.subset, 'Attribution-ShareAlike 3.0', 'byte-for-byte']) {
    assert.match(notice, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
  assert.match(legalText, /Attribution-ShareAlike 3\.0 Unported/i);
  assert.match(legalText, /Creative Commons/i);
  assert.match(legalText, /https:\/\/creativecommons\.org\/licenses\/by-sa\/3\.0\/legalcode\.en/i);
});

test('marks MP3 assets as binary and documents machine verification separately from listening', async () => {
  const attributes = await readFile(new URL('../.gitattributes', import.meta.url), 'utf8');
  const notice = await readFile(new URL('../assets/audio/THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8');
  const checklist = JSON.parse(await readFile(new URL('../data/review-checklist.json', import.meta.url), 'utf8'));
  const packageDocument = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

  assert.match(attributes, /^assets\/audio\/\*\.mp3 binary$/m);
  assert.match(notice, /187 selected MP3 files/);
  assert.match(notice, /byte-for-byte/);
  assert.ok(Object.values(checklist.entries).every(entry => entry.audio === 'pending-auditory-review'));
  assert.equal(packageDocument.scripts['verify:audio'], 'node scripts/sync-audio.mjs --verify');
});
