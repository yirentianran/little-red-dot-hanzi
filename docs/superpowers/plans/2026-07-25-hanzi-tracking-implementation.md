# Hanzi Tracking Learning App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a completely offline, file-openable learning app for every recognize/write character in the 2019 PEP Grade 4 Volume 1 Chinese textbook, with local pronunciation and red-dot stroke tracking.

**Architecture:** Keep audited curriculum and character geometry as source JSON, validate them with Node scripts, and generate a classic-script runtime bundle that works under `file://`. The browser app uses small UMD-style modules for data lookup, hash routing, SVG rendering, animation, audio, views, and orchestration so core logic is testable with Node's built-in test runner.

**Tech Stack:** HTML5, CSS, vanilla JavaScript, SVG, Node.js 20+, `node:test`, Playwright for browser verification, pinned CC BY-SA Mandarin syllable recordings, Hanzi Writer Data-compatible geometry.

---

## File Map

- `package.json`: local validation, build, test, and QA commands.
- `index.html`: semantic application shell and classic-script load order.
- `styles.css`: responsive visual system and all three views.
- `data/curriculum.json`: audited textbook hierarchy and lesson readings.
- `data/characters.json`: versioned geometry document containing an in-file modification notice and a `characters` mapping of extracted stroke outlines and medians.
- `data/library-data.js`: generated `window.HANZI_LIBRARY` runtime payload.
- `data/source-data-license.md`: source, version, and license record for stroke geometry.
- `assets/audio/`: one byte-preserved local MP3 per referenced reading id, plus manifest and attribution.
- `js/data-store.js`: validated curriculum lookup API.
- `js/router.js`: hash parse/serialize/fallback rules.
- `js/svg-renderer.js`: SVG layers, clipping paths, guide grid, and red dot.
- `js/animation-controller.js`: deterministic animation state machine.
- `js/audio-controller.js`: single-active-audio playback and failure state.
- `js/views.js`: directory, lesson, and character view DOM creation.
- `js/app.js`: lifecycle, routing, persistence, and controller wiring.
- `scripts/lib/library-validator.mjs`: reusable source-data validation.
- `scripts/validate-library.mjs`: validation CLI.
- `scripts/build-library.mjs`: deterministic classic-script bundle generator.
- `scripts/extract-characters.mjs`: subset extractor for upstream character data.
- `scripts/sync-audio.mjs`: reproducible importer for the pinned upstream recording set.
- `tests/`: Node tests, data assertions, and browser acceptance tests.

### Task 1: Establish the Validation and Test Harness

**Files:**
- Create: `package.json`
- Create: `scripts/lib/library-validator.mjs`
- Create: `scripts/validate-library.mjs`
- Create: `tests/library-validator.test.mjs`
- Create: `tests/fixtures/valid-curriculum.json`
- Create: `tests/fixtures/valid-characters.json`

- [ ] **Step 1: Write failing validation tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLibrary } from '../scripts/lib/library-validator.mjs';

test('accepts matching curriculum, character geometry, and audio ids', () => {
  const result = validateLibrary(validCurriculum, validCharacters, new Set(['guo1']));
  assert.deepEqual(result, []);
});

test('reports lesson and character for missing geometry', () => {
  const broken = structuredClone(validCharacters);
  broken.characters = {};
  const errors = validateLibrary(validCurriculum, broken, new Set(['guo1']));
  assert.match(errors.join('\n'), /lesson-1.*郭.*geometry/i);
});

test('rejects unequal stroke and median counts', () => {
  const broken = structuredClone(validCharacters);
  broken.characters.郭 = { strokeCount: 2, strokes: ['M0 0L1 1'], medians: [[[0, 0], [1, 1]]] };
  assert.match(validateLibrary(validCurriculum, broken, new Set(['guo1'])).join('\n'), /strokeCount/i);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test tests/library-validator.test.mjs`

Expected: FAIL because `scripts/lib/library-validator.mjs` does not exist.

- [ ] **Step 3: Implement the validator and CLI**

```js
export function validateLibrary(curriculum, characterDocument, audioIds) {
  const errors = [];
  const characters = characterDocument.characters;
  const lessonIds = new Set();
  for (const unit of curriculum.units ?? []) {
    for (const lesson of unit.lessons ?? []) {
      if (lessonIds.has(lesson.id)) errors.push(`duplicate lesson id: ${lesson.id}`);
      lessonIds.add(lesson.id);
      for (const group of ['recognize', 'write']) {
        const seen = new Set();
        for (const entry of lesson[group] ?? []) {
          const label = `${lesson.id} ${entry.character}`;
          if ([...entry.character].length !== 1) errors.push(`${label}: character must be one code point`);
          if (seen.has(entry.character)) errors.push(`${label}: duplicate in ${group}`);
          seen.add(entry.character);
          if (!entry.pinyin?.normalize('NFC')) errors.push(`${label}: missing pinyin`);
          if (!audioIds.has(entry.audio)) errors.push(`${label}: missing audio ${entry.audio}`);
          const geometry = characters[entry.character];
          if (!geometry) {
            errors.push(`${label}: missing geometry`);
            continue;
          }
          if (geometry.strokeCount !== geometry.strokes?.length || geometry.strokeCount !== geometry.medians?.length) {
            errors.push(`${label}: strokeCount does not match strokes and medians`);
          }
        }
      }
    }
  }
  return errors;
}
```

The CLI reads `data/curriculum.json`, `data/characters.json`, and audio basenames under `assets/audio`, prints each error on its own line, and exits with code 1 when errors exist.

- [ ] **Step 4: Add package commands and run tests**

```json
{
  "name": "hanzi-tracking-learning",
  "private": true,
  "scripts": {
    "test": "node --test tests/*.test.mjs",
    "validate": "node scripts/validate-library.mjs",
    "build:data": "node scripts/build-library.mjs",
    "check": "npm test && npm run validate && npm run build:data"
  }
}
```

Run: `npm test`

Expected: all validator tests PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json scripts tests
git commit -m "test: add library validation harness"
```

### Task 2: Add and Audit the 2019 PEP Curriculum

**Files:**
- Create: `data/curriculum.json`
- Create: `tests/curriculum.test.mjs`
- Create: `docs/data-audit.md`

- [ ] **Step 1: Write failing curriculum structure tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import curriculum from '../data/curriculum.json' with { type: 'json' };

const expectedTitles = [
  '观潮', '走月亮', '现代诗二首', '繁星', '一个豆荚里的五粒豆', '夜间飞行的秘密',
  '呼风唤雨的世纪', '蝴蝶的家', '古诗三首', '爬山虎的脚', '蟋蟀的住宅',
  '盘古开天地', '精卫填海', '普罗米修斯', '女娲补天', '麻雀', '爬天都峰',
  '牛和鹅', '一只窝囊的大老虎', '陀螺', '古诗三首', '为中华之崛起而读书',
  '梅兰芳蓄须', '延安，我把你追寻', '王戎不取道旁李', '西门豹治邺', '故事二则'
];

test('identifies the approved textbook edition', () => {
  assert.deepEqual(curriculum.book, {
    publisher: '人民教育出版社', approvalYear: 2019, grade: 4, volume: '上册'
  });
});

test('contains all 8 units and 27 numbered lessons in order', () => {
  assert.equal(curriculum.units.length, 8);
  const numbered = curriculum.units.flatMap(unit => unit.lessons)
    .filter(section => section.kind === 'lesson');
  assert.deepEqual(numbered.map(lesson => lesson.title), expectedTitles);
});

test('includes the four textbook language-garden literacy groups', () => {
  const gardens = curriculum.units.flatMap(unit => unit.lessons)
    .filter(section => section.kind === 'garden');
  assert.deepEqual(gardens.map(section => section.id), ['garden-2', 'garden-4', 'garden-6', 'garden-8']);
  assert.ok(gardens.every(section => section.write.length === 0));
});

test('preserves every displayed reading while matching the appendix totals', () => {
  const sections = curriculum.units.flatMap(unit => unit.lessons);
  const recognize = sections.flatMap(section => section.recognize);
  assert.equal(recognize.length, 271);
  assert.equal(recognize.filter(entry => entry.counted !== false).length, 250);
  assert.equal(recognize.filter(entry => entry.counted === false).length, 21);
  assert.equal(sections.reduce((sum, section) => sum + section.write.length, 0), 250);
});

test('each lesson entry has an explicit textbook classification and tone-marked pinyin', () => {
  for (const lesson of curriculum.units.flatMap(unit => unit.lessons)) {
    for (const group of ['recognize', 'write']) {
      assert.ok(Array.isArray(lesson[group]), `${lesson.id}.${group}`);
      for (const entry of lesson[group]) {
        assert.match(entry.character, /^\p{Script=Han}$/u);
        assert.match(entry.pinyin, /^[a-züāáǎàēéěèīíǐìōóǒòūúǔǜǘǚǜńňǹḿ]+$/iu);
        assert.match(entry.audio, /^[a-z]+[1-5]$/);
      }
    }
  }
});
```

- [ ] **Step 2: Run the curriculum test and verify it fails**

Run: `node --test tests/curriculum.test.mjs`

Expected: FAIL because `data/curriculum.json` does not exist.

- [ ] **Step 3: Create the complete audited curriculum JSON**

Populate all 8 units, 27 numbered lessons, and the language-garden literacy groups in Units 2, 4, 6, and 8 from the user-cover-aligned 2023 printing of the 2019-approved textbook (not the 2024 revision). Mark numbered records with `kind: "lesson"` and language-garden records with `kind: "garden"`; garden records have no lesson number and use an empty `write` array. Preserve all 271 displayed `recognize` readings. Mark the appendix's 21 blue polyphonic readings with `"counted": false`, so the counted-new-character total remains exactly 250; the `write` total is exactly 250. Use normalized tone-marked pinyin and numbered reading ids such as `{ "character": "潮", "pinyin": "cháo", "audio": "chao2" }`. Preserve legitimate reuse across lessons or groups; do not infer a pronunciation from the character alone.

Record the cover URL, the textbook appendix/page used for each transcription pass, reviewer date, and any polyphonic decisions in `docs/data-audit.md`. The audit must contain a per-lesson checkbox table and totals derived from the JSON, not manually typed totals.

- [ ] **Step 4: Run curriculum and validation tests**

Run: `npm test`

Expected: curriculum structure tests PASS; full validation may still report missing geometry and audio until Tasks 3 and 4.

- [ ] **Step 5: Commit**

```bash
git add data/curriculum.json docs/data-audit.md tests/curriculum.test.mjs
git commit -m "data: add grade four volume one curriculum"
```

### Task 3: Extract and Validate Character Geometry

**Files:**
- Create: `scripts/extract-characters.mjs`
- Create: `data/characters.json`
- Create: `data/ARPHICPL.TXT`
- Create: `data/source-data-license.md`
- Create: `tests/extract-characters.test.mjs`
- Modify: `scripts/lib/library-validator.mjs`
- Modify: `tests/fixtures/valid-characters.json`
- Modify: `package.json`
- Create: `package-lock.json`

- [ ] **Step 1: Write a failing extractor test**

```js
test('extracts exactly the unique curriculum characters and preserves stroke order', () => {
  const document = extractCharacters(curriculum, {
    郭: { strokes: ['path-a', 'path-b'], medians: [[[0, 0], [1, 0]], [[1, 0], [1, 1]]] },
    外: { strokes: ['unused'], medians: [[[0, 0], [1, 1]]] }
  });
  assert.deepEqual(Object.keys(document.characters), ['郭']);
  assert.equal(document.characters.郭.strokeCount, 2);
  assert.deepEqual(document.characters.郭.medians[1][1], [1, 1]);
  assert.equal(document.modificationNotice.source, 'hanzi-writer-data@2.0.1');
});
```

- [ ] **Step 2: Run the extractor test and verify it fails**

Run: `node --test tests/extract-characters.test.mjs`

Expected: FAIL because `extractCharacters` is not implemented.

- [ ] **Step 3: Implement extraction and provenance recording**

```js
export function extractCharacters(curriculum, upstream) {
  const wanted = new Set(curriculum.units.flatMap(unit => unit.lessons)
    .flatMap(lesson => [...lesson.recognize, ...lesson.write])
    .map(entry => entry.character));
  const characters = Object.fromEntries([...wanted].sort().map(character => {
    const source = upstream[character];
    if (!source) throw new Error(`upstream geometry missing: ${character}`);
    return [character, {
      strokeCount: source.strokes.length,
      strokes: source.strokes,
      medians: source.medians
    }];
  }));
  return {
    schemaVersion: 1,
    modificationNotice: {
      date: '2026-07-25',
      source: 'hanzi-writer-data@2.0.1',
      license: 'ARPHICPL.TXT',
      changes: [
        'Extracted the 428-character subset used by the PEP Grade 4 Volume 1 curriculum.',
        'Removed radStrokes and all other upstream fields, retaining only strokes and medians.',
        'Added strokeCount to each character record.',
        'Sorted character keys deterministically.',
        'Combined the selected records into this single JSON document.'
      ]
    },
    characters
  };
}
```

Install the pinned source package with `npm install --save-dev --save-exact hanzi-writer-data@2.0.1`. Extract only the required characters from `node_modules/hanzi-writer-data`, copy the bundled `ARPHICPL.TXT` byte-for-byte to `data/ARPHICPL.TXT`, and document package version 2.0.1, the `chanind/hanzi-writer-data` repository, Make Me a Hanzi provenance, and the applicable terms in `data/source-data-license.md`. A regression test must re-read all 428 locked upstream records and compare the complete regenerated document byte-for-byte with `data/characters.json`.

- [ ] **Step 4: Generate real geometry and validate it**

Run: `node scripts/extract-characters.mjs --source node_modules/hanzi-writer-data`

Expected: `data/characters.json.characters` contains every unique curriculum character, its in-file notice fully describes the transformation, and `npm run validate` reports audio-only errors.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json scripts/extract-characters.mjs scripts/lib/library-validator.mjs data/characters.json data/ARPHICPL.TXT data/source-data-license.md tests/extract-characters.test.mjs tests/fixtures/valid-characters.json
git commit -m "data: add textbook character geometry"
```

### Task 4: Import and Audit Offline Pronunciation

**Files:**
- Create: `scripts/sync-audio.mjs`
- Create: `assets/audio/`
- Create: `assets/audio/manifest.json`
- Create: `assets/audio/THIRD_PARTY_NOTICES.md`
- Create: `assets/audio/CC-BY-SA-3.0.html`
- Create: `tests/audio-manifest.test.mjs`
- Modify: `docs/data-audit.md`
- Modify: `scripts/validate-library.mjs`

- [ ] **Step 1: Write a failing manifest coverage test**

```js
test('provides one local asset for every reading id', () => {
  const required = new Set(curriculum.units.flatMap(unit => unit.lessons)
    .flatMap(lesson => [...lesson.recognize, ...lesson.write])
    .map(entry => entry.audio));
  assert.deepEqual(new Set(Object.keys(manifest.readings)), required);
  for (const record of Object.values(manifest.readings)) {
    assert.match(record.file, /^assets\/audio\/[a-z]+[1-5]\.mp3$/);
    assert.match(record.sourceFile, /^64k\/syllabs\/cmn-[a-z]+[1-5]\.mp3$/);
    assert.ok(Number.isInteger(record.bytes) && record.bytes > 0);
    assert.match(record.sha256, /^[a-f0-9]{64}$/);
    assert.equal(record.metadataVerified, true);
    assert.equal(typeof record.auditoryReviewed, 'boolean');
  }
});
```

- [ ] **Step 2: Run the manifest test and verify it fails**

Run: `node --test tests/audio-manifest.test.mjs`

Expected: FAIL because the manifest and files do not exist.

- [ ] **Step 3: Implement reproducible pinned-source import**

The script derives the 335 unique reading ids from the curriculum and copies the corresponding original MP3 files from `hugolpz/audio-cmn` `64k/syllabs`, pinned to commit `ff9ed3d0c631195bd2c06f39450f3264c7124040`. It supports a local `--source` checkout for reproducibility and a pinned raw GitHub URL by default. Files are not transcoded and their ID3 metadata is not rewritten. The only source-name mapping exception is curriculum id `ju4`, which reads upstream `cmn-jv4.mp3` but is stored locally as `ju4.mp3`.

The deterministic manifest records provenance and verification separately from human listening:

```json
{
  "schemaVersion": 1,
  "format": "audio/mpeg",
  "source": {
    "repository": "https://github.com/hugolpz/audio-cmn",
    "commit": "ff9ed3d0c631195bd2c06f39450f3264c7124040",
    "subset": "64k/syllabs",
    "license": "CC-BY-SA-3.0",
    "attribution": "Wang Chen, Hugo Lopez, Nicolas Vion"
  },
  "readings": {
    "chao2": {
      "file": "assets/audio/chao2.mp3",
      "sourceFile": "64k/syllabs/cmn-chao2.mp3",
      "sourceLabel": "chao2",
      "bytes": 0,
      "sha256": "...",
      "metadataVerified": true,
      "auditoryReviewed": false
    }
  }
}
```

The importer verifies the embedded `SWAC_TEXT`, `SWAC_COLL_LICENSE`, author/copyright tags, MP3 decodability, byte size, and hash before writing the manifest. `metadataVerified` may be true only after those machine checks pass. `auditoryReviewed` remains false until a person actually listens; do not infer it from metadata. Reuse one file when multiple curriculum entries intentionally share the same reading id.

Bundle the CC BY-SA 3.0 legal text and a third-party notice naming Wang Chen, Hugo Lopez, Nicolas Vion, the repository, pinned commit, source subset, and whether files were renamed without byte changes. Update `docs/data-audit.md` with the automatic verification scope and the separate listening checklist.

- [ ] **Step 4: Verify every file and audit polyphonic readings**

Run from a local pinned checkout when available:

`node scripts/sync-audio.mjs --source /path/to/audio-cmn`

Or fetch only the required files from the script's pinned raw URL:

`node scripts/sync-audio.mjs`

Run: `npm run validate`

Expected: exactly 335 referenced MP3 files exist, every hash and ID3 label matches the manifest, all files decode, and full library validation returns `Library valid`. The validation CLI must only treat `.mp3` basenames as audio assets; a same-named text or metadata file cannot satisfy a curriculum audio id.

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-audio.mjs scripts/validate-library.mjs assets/audio docs/data-audit.md tests/audio-manifest.test.mjs
git commit -m "data: add offline Mandarin pronunciation"
```

### Task 5: Build the File-Compatible Runtime Data Bundle

**Files:**
- Create: `scripts/build-library.mjs`
- Create: `data/library-data.js`
- Create: `tests/build-library.test.mjs`

- [ ] **Step 1: Write a failing deterministic bundle test**

```js
test('writes a classic script with no network URLs', async () => {
  const output = buildRuntimeSource(curriculum, characterDocument, manifest);
  assert.match(output, /^window\.HANZI_LIBRARY = /);
  assert.doesNotMatch(output, /https?:\/\//);
  const parsed = JSON.parse(output.slice(output.indexOf('{'), -2));
  assert.equal(parsed.curriculum.schemaVersion, 1);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test tests/build-library.test.mjs`

Expected: FAIL because `buildRuntimeSource` does not exist.

- [ ] **Step 3: Implement deterministic bundle generation**

```js
export function buildRuntimeSource(curriculum, characterDocument, audioManifest) {
  const payload = { curriculum, characters: characterDocument.characters, audio: audioManifest };
  return `window.HANZI_LIBRARY = ${JSON.stringify(payload)};\n`;
}
```

Sort generated character and audio keys, write atomically, and report byte size and record counts.

- [ ] **Step 4: Generate and verify stable output**

Run: `npm run build:data && shasum data/library-data.js && npm run build:data && shasum data/library-data.js`

Expected: both checksums are identical.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-library.mjs data/library-data.js tests/build-library.test.mjs
git commit -m "build: generate file compatible library data"
```

### Task 6: Implement Data Store and Hash Routing

**Files:**
- Create: `js/data-store.js`
- Create: `js/router.js`
- Create: `tests/data-store.test.mjs`
- Create: `tests/router.test.mjs`

- [ ] **Step 1: Write failing public-API tests**

```js
test('resolves lesson, group, character, and neighbors', () => {
  const store = createDataStore(library);
  const state = store.resolve({ lessonId: 'lesson-1', group: 'write', character: '潮' });
  assert.equal(state.entry.pinyin, 'cháo');
  assert.equal(state.index, 0);
  assert.equal(state.next.character, '据');
});

test('round-trips a character route without percent-decoding errors', () => {
  const route = { view: 'character', lessonId: 'lesson-1', group: 'write', character: '潮' };
  assert.deepEqual(parseHash(serializeHash(route)), route);
});

test('falls back to directory for an invalid route', () => {
  assert.deepEqual(normalizeRoute({ view: 'character', lessonId: 'missing' }, store), { view: 'directory' });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `node --test tests/data-store.test.mjs tests/router.test.mjs`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement UMD-style modules**

Expose browser globals under `window.HanziApp` and `module.exports` under Node. Keep the public functions exactly: `createDataStore(library)`, `parseHash(hash)`, `serializeHash(route)`, and `normalizeRoute(route, store)`.

The store returns immutable lookup results and derives neighbors from the selected lesson group. The router supports `directory`, `lesson`, and `character` views with `URLSearchParams`-compatible encoding.

- [ ] **Step 4: Run focused and full tests**

Run: `npm test`

Expected: all data store and router tests PASS.

- [ ] **Step 5: Commit**

```bash
git add js/data-store.js js/router.js tests/data-store.test.mjs tests/router.test.mjs
git commit -m "feat: add curriculum store and hash router"
```

### Task 7: Implement SVG Stroke Rendering

**Files:**
- Create: `js/svg-renderer.js`
- Create: `tests/svg-renderer.test.mjs`

- [ ] **Step 1: Write failing geometry-helper tests**

```js
test('converts median points to a scaled SVG path', () => {
  assert.equal(pointsToPath([[0, 0], [512, 512], [1024, 0]]), 'M 0 0 L 512 512 L 1024 0');
});

test('clamps visual progress', () => {
  assert.equal(clampProgress(-1), 0);
  assert.equal(clampProgress(0.4), 0.4);
  assert.equal(clampProgress(2), 1);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `node --test tests/svg-renderer.test.mjs`

Expected: FAIL because the renderer does not exist.

- [ ] **Step 3: Implement the renderer contract**

`createSvgRenderer(container, geometry)` returns:

```js
{
  setStrokeProgress(index, progress),
  showCompletedThrough(index),
  showFullCharacter(),
  getStrokeLength(index),
  destroy()
}
```

Create one outline path and one clipped median reveal path per stroke, use unique clip ids per renderer instance, and create a red dot with a white stroke plus translucent outer ring. `setStrokeProgress` updates dash offset and places both dot elements with `getPointAtLength()`.

- [ ] **Step 4: Run focused tests and a DOM smoke fixture**

Run: `node --test tests/svg-renderer.test.mjs`

Expected: helper tests PASS; browser smoke coverage is added in Task 11.

- [ ] **Step 5: Commit**

```bash
git add js/svg-renderer.js tests/svg-renderer.test.mjs
git commit -m "feat: render tracked SVG strokes"
```

### Task 8: Implement the Animation State Machine

**Files:**
- Create: `js/animation-controller.js`
- Create: `tests/animation-controller.test.mjs`

- [ ] **Step 1: Write failing state-transition tests with a fake clock**

```js
test('pauses and resumes at the same relative stroke progress', () => {
  const controller = createAnimationController(fakeRenderer, { now, requestFrame, cancelFrame });
  controller.play();
  advance(300);
  controller.pause();
  const paused = controller.getState();
  advance(5000);
  controller.play();
  advance(100);
  assert.ok(controller.getState().progress > paused.progress);
  assert.ok(controller.getState().progress < paused.progress + 0.3);
});

test('next stroke enables step mode and stops after that stroke', () => {
  controller.nextStroke();
  runAllFrames();
  assert.equal(controller.getState().mode, 'step');
  assert.equal(controller.getState().status, 'paused');
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `node --test tests/animation-controller.test.mjs`

Expected: FAIL because the controller does not exist.

- [ ] **Step 3: Implement controller commands and injectable timing**

Expose `play`, `pause`, `replay`, `previousStroke`, `nextStroke`, `setSpeed`, `handleVisibilityChange`, `getState`, and `destroy`. Use renderer-reported stroke lengths, clamp durations, apply speed multipliers `{ slow: 1.45, normal: 1, fast: 0.7 }`, and emit state changes only when user-visible state changes.

- [ ] **Step 4: Run transition tests**

Run: `node --test tests/animation-controller.test.mjs`

Expected: all state-machine tests PASS, including background pause and loop restart.

- [ ] **Step 5: Commit**

```bash
git add js/animation-controller.js tests/animation-controller.test.mjs
git commit -m "feat: add stroke animation controller"
```

### Task 9: Implement Local Audio Control

**Files:**
- Create: `js/audio-controller.js`
- Create: `tests/audio-controller.test.mjs`

- [ ] **Step 1: Write failing playback tests**

```js
test('stops active audio before replaying another reading', async () => {
  await controller.play('chao2');
  await controller.play('ju4');
  assert.equal(fakeAudios.chao2.pauseCalls, 1);
  assert.equal(fakeAudios.ju4.currentTime, 0);
});

test('marks only the failed reading unavailable', async () => {
  fakeAudios.chao2.rejectPlay = true;
  await assert.rejects(controller.play('chao2'));
  assert.equal(controller.isAvailable('chao2'), false);
  assert.equal(controller.isAvailable('ju4'), true);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `node --test tests/audio-controller.test.mjs`

Expected: FAIL because the audio controller does not exist.

- [ ] **Step 3: Implement one-active-audio behavior**

`createAudioController(manifest, createAudio)` preloads metadata only, resets `currentTime` before play, pauses previous audio, catches decode/play failure, exposes `stop()`, `play(readingId)`, `isAvailable(readingId)`, and `destroy()`.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/audio-controller.test.mjs`

Expected: all audio-controller tests PASS.

- [ ] **Step 5: Commit**

```bash
git add js/audio-controller.js tests/audio-controller.test.mjs
git commit -m "feat: add offline pronunciation control"
```

### Task 10: Build the Responsive Three-View Interface

**Files:**
- Create: `index.html`
- Create: `styles.css`
- Create: `js/views.js`
- Create: `tests/views.test.mjs`

- [ ] **Step 1: Write failing view-model tests**

```js
test('directory model exposes units and lesson character counts', () => {
  const model = createDirectoryModel(store);
  assert.equal(model.units[0].lessons[0].title, '观潮');
  assert.equal(model.units[0].lessons[0].total, model.units[0].lessons[0].recognize + model.units[0].lessons[0].write);
});

test('character model provides controls and neighbor disabled states', () => {
  const model = createCharacterModel(store.resolve({ lessonId: 'lesson-1', group: 'write', character: '潮' }));
  assert.equal(model.previousDisabled, true);
  assert.equal(model.pinyin, 'cháo');
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `node --test tests/views.test.mjs`

Expected: FAIL because view models do not exist.

- [ ] **Step 3: Create semantic HTML and view rendering**

`index.html` contains a skip link, branded compact header, `main#app`, non-interruptive `#announcer`, and classic scripts in dependency order. `views.js` exposes `renderDirectory`, `renderLesson`, and `renderCharacter`; command buttons use native elements and `data-action` delegation. Familiar actions use symbols plus accessible names, while text remains on lesson and mode commands.

- [ ] **Step 4: Implement responsive visual styling**

Use CSS custom properties for sky blue, white, yellow, ink, action blue, and tracking red. Directory sections are unframed page bands; lesson characters are repeated cards; the character tool uses a two-column work surface at desktop and one column below 760px. Fix the writing board with `aspect-ratio: 1` and constrained width; maintain 44px targets and visible focus.

- [ ] **Step 5: Run unit tests and static markup checks**

Run: `npm test`

Expected: all view-model and existing tests PASS.

- [ ] **Step 6: Commit**

```bash
git add index.html styles.css js/views.js tests/views.test.mjs
git commit -m "feat: build responsive learning views"
```

### Task 11: Integrate Routing, Persistence, Animation, and Audio

**Files:**
- Create: `js/app.js`
- Create: `tests/app.test.mjs`
- Modify: `index.html`

- [ ] **Step 1: Write failing lifecycle tests**

```js
test('switching characters destroys the old renderer, animation, and audio', () => {
  app.navigate(characterRoute('潮'));
  const old = app.debugControllers();
  app.navigate(characterRoute('据'));
  assert.equal(old.renderer.destroyCalls, 1);
  assert.equal(old.animation.destroyCalls, 1);
  assert.equal(old.audio.stopCalls, 1);
});

test('reduced motion prevents autoplay but retains manual play', () => {
  const app = createApp({ reducedMotion: true, initialRoute: characterRoute('潮') });
  assert.equal(app.debugControllers().animation.getState().status, 'idle');
  app.dispatch({ action: 'play' });
  assert.equal(app.debugControllers().animation.getState().status, 'playing');
});
```

- [ ] **Step 2: Run lifecycle tests and verify they fail**

Run: `node --test tests/app.test.mjs`

Expected: FAIL because `js/app.js` does not exist.

- [ ] **Step 3: Implement the application lifecycle**

Initialize from `window.HANZI_LIBRARY`, normalize hash state, render the active view, and create controllers only for the character view. Use one delegated click listener, one hashchange listener, and one visibilitychange listener. Serialize the last valid route to `localStorage` inside `try/catch`; storage failure must not affect navigation.

When a character route changes, call animation `destroy()`, renderer `destroy()`, and audio `stop()` before rendering the next character. Announce stroke number and recoverable errors through the live region without updating it every frame.

- [ ] **Step 4: Run all Node tests and source validation**

Run: `npm run check`

Expected: tests PASS, library reports valid, and regenerated runtime data has no diff.

- [ ] **Step 5: Commit**

```bash
git add js/app.js index.html tests/app.test.mjs
git commit -m "feat: integrate the offline learning app"
```

### Task 12: Verify File-Open, Responsive, and Visual Behavior

**Files:**
- Create: `tests/browser/app.spec.mjs`
- Create: `tests/browser/offline.spec.mjs`
- Create: `scripts/run-browser-tests.mjs`
- Create: `README.md`
- Modify: `package.json`

- [ ] **Step 1: Write browser acceptance tests**

```js
test('navigates directory to lesson to tracked character', async ({ page }) => {
  await page.goto(fileUrl('index.html'));
  await page.getByRole('button', { name: /第 1 课.*观潮/ }).click();
  await page.getByRole('button', { name: /会写/ }).click();
  await page.getByRole('button', { name: /潮 cháo/ }).click();
  await expect(page.getByText('cháo')).toBeVisible();
  await expect(page.locator('[data-tracking-dot]')).toBeVisible();
});

test('uses no network resources', async ({ page }) => {
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto(fileUrl('index.html'));
  await page.waitForTimeout(1000);
  assert.deepEqual(requests.filter(url => /^https?:/.test(url)), []);
});
```

- [ ] **Step 2: Run browser tests and verify any integration failures**

Run: `npm run test:browser`

Expected before fixes: tests identify remaining file URL, accessibility-name, animation, or layout issues.

- [ ] **Step 3: Fix only failures demonstrated by acceptance tests**

Add `test:browser` to `package.json`, keep all runtime resources relative, and adjust DOM/CSS/controller wiring until file-open tests pass. Do not add a production server or runtime dependency.

- [ ] **Step 4: Capture and inspect responsive screenshots**

Run the browser script at 360×800, 768×1024, and 1440×900 for directory, lesson, and character views. Verify nonblank SVG pixels, tracking-dot movement across two samples, stable board dimensions, no overlap, and no horizontal overflow.

- [ ] **Step 5: Perform final verification**

Run: `npm run check`

Run: `npm run test:browser`

Run: `git diff --check && git status --short`

Expected: all checks PASS; only intentional documentation or generated screenshot artifacts remain, and screenshots are excluded unless they are useful fixtures.

- [ ] **Step 6: Document direct use and commit**

`README.md` states: open `index.html`, choose a unit and lesson, switch “会写 / 会认”, select a character, and use the tracking controls. It also documents `npm run check`, source-data provenance, and the fact that audio never autoplays.

```bash
git add README.md package.json scripts/run-browser-tests.mjs tests/browser
git commit -m "test: verify offline learning experience"
```
