# Vocabulary Words Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add offline vocabulary word examples for every `write` and `recognize` curriculum entry, then show them on each character detail page.

**Architecture:** Keep vocabulary on the existing curriculum entries so source JSON, runtime data, data store, and view models all follow the current unit/lesson/group structure. Extend existing strict validators first, then add data, then pass immutable `words` arrays through `data-store.js` and `views.js` into a small rendered vocabulary row.

**Tech Stack:** Static JSON data, classic browser JavaScript, Node.js build scripts, Node.js test runner, offline Playwright browser harness.

---

### Task 1: Enforce the vocabulary data contract

**Files:**
- Modify: `scripts/build-library.mjs`
- Modify: `scripts/lib/library-validator.mjs`
- Modify: `js/data-store.js`
- Modify: `tests/build-library.test.mjs`
- Modify: `tests/data-store.test.mjs`

- [ ] **Step 1: Write failing build-time validator tests**

In `tests/build-library.test.mjs`, update the top-level `curriculum` fixture entries so every entry has `words`. Use these exact fixture entries:

```js
recognize: [
  { character: '郭', pinyin: 'guō', audio: 'guo1', words: ['城郭', '郭外'] }
],
write: [
  { character: '郭', pinyin: 'guō', audio: 'guo1', words: ['城郭', '郭外'] }
]
```

Add malformed cases to the existing source validation table:

```js
[
  {
    ...curriculum,
    units: [{
      ...curriculum.units[0],
      lessons: [{
        ...curriculum.units[0].lessons[0],
        recognize: [{ character: '郭', pinyin: 'guō', audio: 'guo1' }]
      }]
    }]
  },
  characterDocument,
  audioManifest,
  /data\/curriculum\.json.*recognize\[0\]\.words.*own property/i
],
[
  {
    ...curriculum,
    units: [{
      ...curriculum.units[0],
      lessons: [{
        ...curriculum.units[0].lessons[0],
        write: [{ character: '郭', pinyin: 'guō', audio: 'guo1', words: ['城郭', '郭外', '郭家', '郭城'] }]
      }]
    }]
  },
  characterDocument,
  audioManifest,
  /data\/curriculum\.json.*write\[0\]\.words.*1 to 3/i
],
[
  {
    ...curriculum,
    units: [{
      ...curriculum.units[0],
      lessons: [{
        ...curriculum.units[0].lessons[0],
        write: [{ character: '郭', pinyin: 'guō', audio: 'guo1', words: ['城墙'] }]
      }]
    }]
  },
  characterDocument,
  audioManifest,
  /data\/curriculum\.json.*write\[0\]\.words\[0\].*include 郭/i
]
```

Update the unknown-field test expectations so `words` is allowed on both `recognize` and `write` entries.

- [ ] **Step 2: Write failing runtime validator tests**

In `tests/data-store.test.mjs`, update `fixtureLibrary()` entries to include:

```js
words: ['潮水', '浪潮', '涨潮']
```

Extend the entry-copy test to assert the runtime copy preserves and freezes words:

```js
assert.deepEqual(entries[0].words, ['潮水', '浪潮', '涨潮']);
assert.ok(Object.isFrozen(entries[0].words));
assert.notEqual(entries[0].words, inputEntry.words);
```

Add malformed runtime cases in the existing validation test:

```js
const missingWords = fixtureLibrary();
delete missingWords.curriculum.units[0].lessons[0].write[0].words;
assert.throws(() => createDataStore(missingWords), /write\[0\]\.words.*own property/i);

const tooManyWords = fixtureLibrary();
tooManyWords.curriculum.units[0].lessons[0].write[0].words = ['潮水', '浪潮', '涨潮', '潮湿'];
assert.throws(() => createDataStore(tooManyWords), /write\[0\]\.words.*1 to 3/i);

const unrelatedWord = fixtureLibrary();
unrelatedWord.curriculum.units[0].lessons[0].write[0].words = ['浪花'];
assert.throws(() => createDataStore(unrelatedWord), /write\[0\]\.words\[0\].*include 潮/i);
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
node --test tests/build-library.test.mjs tests/data-store.test.mjs
```

Expected: FAIL because `words` is still rejected as an unknown field or is not copied.

- [ ] **Step 4: Implement strict word validation in `scripts/build-library.mjs`**

Add this helper near the other validators:

```js
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
```

Update the allowed entry keys:

```js
group === 'recognize'
  ? ['character', 'pinyin', 'audio', 'words', 'counted']
  : ['character', 'pinyin', 'audio', 'words']
```

After validating `entry.audio`, add:

```js
requireWords(entry.words, entry.character, `${entryLocation}.words`);
```

- [ ] **Step 5: Implement strict word validation in `scripts/lib/library-validator.mjs`**

Inside each candidate entry validation, after audio validation, add:

```js
if (!Array.isArray(entry.words) || entry.words.length < 1 || entry.words.length > 3) {
  errors.push(`${label}: words must be an array with 1 to 3 words`);
} else {
  entry.words.forEach((word, index) => {
    if (!hasNonBlankString(word)) {
      errors.push(`${label}: words[${index}] must be a non-blank string`);
    } else if (!word.includes(character)) {
      errors.push(`${label}: words[${index}] must include ${character}`);
    }
  });
}
```

- [ ] **Step 6: Copy and freeze words in `js/data-store.js`**

Add this helper near `copyEntry`:

```js
function copyWords(value, character, path) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
    reject(path, 'must be an array with 1 to 3 words');
  }
  var copy = [];
  for (var index = 0; index < value.length; index += 1) {
    var word = requireOwnArrayElement(value, index, path);
    requireNonBlankString(word, path + '[' + index + ']');
    if (word.indexOf(character) === -1) reject(path + '[' + index + ']', 'must include ' + character);
    copy.push(word);
  }
  return Object.freeze(copy);
}
```

In `copyEntry`, require and copy words:

```js
var words = copyWords(requireOwn(entry, 'words', path), character, path + '.words');
var copy = { character: character, pinyin: pinyin, audio: audio, words: words };
```

- [ ] **Step 7: Run focused tests and verify GREEN**

Run:

```bash
node --test tests/build-library.test.mjs tests/data-store.test.mjs
```

Expected: all build-library and data-store tests PASS.

- [ ] **Step 8: Commit the data-contract change**

Run:

```bash
git add scripts/build-library.mjs scripts/lib/library-validator.mjs js/data-store.js tests/build-library.test.mjs tests/data-store.test.mjs
git commit -m "feat: validate vocabulary words"
```

Expected: one focused commit that changes validation and runtime copying only.

### Task 2: Add vocabulary words to the full curriculum source

**Files:**
- Modify: `data/curriculum.json`
- Modify: `data/library-data.js`
- Modify: `tests/curriculum.test.mjs`

- [ ] **Step 1: Write the failing curriculum coverage test**

In `tests/curriculum.test.mjs`, add:

```js
test('every curriculum entry has one to three age-appropriate vocabulary words containing the character', () => {
  for (const section of sections()) {
    for (const group of ['recognize', 'write']) {
      for (const [index, entry] of section[group].entries()) {
        const label = `${section.id}.${group}[${index}] ${entry.character}`;
        assert.ok(Array.isArray(entry.words), `${label}: words must be an array`);
        assert.ok(entry.words.length >= 1 && entry.words.length <= 3, `${label}: expected 1 to 3 words`);
        for (const [wordIndex, word] of entry.words.entries()) {
          assert.equal(typeof word, 'string', `${label}.words[${wordIndex}] must be a string`);
          assert.notEqual(word.trim(), '', `${label}.words[${wordIndex}] must not be blank`);
          assert.ok(word.includes(entry.character), `${label}.words[${wordIndex}] must include ${entry.character}`);
        }
      }
    }
  }
});
```

- [ ] **Step 2: Run the coverage test and verify RED**

Run:

```bash
node --test tests/curriculum.test.mjs
```

Expected: FAIL at the first entry without `words`.

- [ ] **Step 3: Add `words` arrays to `data/curriculum.json`**

Edit every entry in both `recognize` and `write` groups. Use this format and keep the existing entry order:

```json
{
  "character": "潮",
  "pinyin": "cháo",
  "audio": "chao2",
  "words": ["潮水", "浪潮", "涨潮"]
}
```

For review entries that already contain `"counted": false`, keep `counted` and add `words` before it:

```json
{
  "character": "薄",
  "pinyin": "bó",
  "audio": "bo2",
  "words": ["薄雾", "薄片", "单薄"],
  "counted": false
}
```

Word selection rules:

- Use 2 or 3 words for most entries.
- Use 1 word only when every additional candidate would be obscure, adult, or misleading for a primary-school learner.
- Prefer lesson-context words when clear, such as `观潮`, `潮水`, `葡萄`, `稻谷`, `蝙蝠`, `豌豆`, `住宅`, `世纪`, `科学`.
- Otherwise choose common words children are likely to know.
- Every word must contain the current character exactly as written in the entry.
- Do not add definitions, sentence text, punctuation, or slash-separated alternatives inside a word string.

- [ ] **Step 4: Rebuild runtime data**

Run:

```bash
npm run build:data
```

Expected: `data/library-data.js` is regenerated successfully and the output still reports `8 units`, `31 sections`, `521 entries`, and `428 characters`; the byte count and SHA-256 hash will change because vocabulary data is now included.

- [ ] **Step 5: Run data-focused validation**

Run:

```bash
npm run validate
node --test tests/curriculum.test.mjs tests/build-library.test.mjs tests/data-store.test.mjs
```

Expected: validation succeeds and all focused tests PASS.

- [ ] **Step 6: Review the vocabulary data diff**

Run:

```bash
git diff -- data/curriculum.json | rg -n "\"words\"|\"character\"|\"counted\""
```

Expected: each of the 521 curriculum entries has one `words` array, and every `counted: false` review entry is still present.

- [ ] **Step 7: Commit the vocabulary data**

Run:

```bash
git add data/curriculum.json data/library-data.js tests/curriculum.test.mjs
git commit -m "feat: add curriculum vocabulary words"
```

Expected: one data-focused commit containing source vocabulary, regenerated runtime data, and the coverage test.

### Task 3: Pass vocabulary into character models and render it

**Files:**
- Modify: `js/views.js`
- Modify: `styles.css`
- Modify: `tests/views.test.mjs`

- [ ] **Step 1: Write failing character model tests**

In `tests/views.test.mjs`, update the first-character assertion in `builds first, last, and review character models with real pinyin and strokes`:

```js
assert.deepEqual(first.words, ['潮水', '浪潮', '涨潮']);
assert.ok(Object.isFrozen(first.words));
```

Add a fallback rendering test:

```js
test('omits the vocabulary row when a legacy character model has no words', () => {
  const { renderCharacter } = loadViews();
  const { document, container } = createDom();
  const model = Object.freeze({
    unit: Object.freeze({ id: 'unit-1', title: '第一单元' }),
    lesson: Object.freeze({ id: 'lesson-1', title: '观潮', kind: 'lesson', number: 1 }),
    group: 'write',
    character: '潮',
    pinyin: 'cháo',
    audioId: 'chao2',
    strokeCount: 15,
    index: 0,
    total: 15,
    isReview: false,
    previous: null,
    next: null,
    previousDisabled: true,
    nextDisabled: true
  });

  renderCharacter(container, model);

  assert.equal(byAttribute(container, 'data-slot', 'vocabulary-words').length, 0);
  assert.equal(container.textContent.includes('组词'), false);
});
```

- [ ] **Step 2: Write failing render test for visible words**

In the existing character render test, use a model containing:

```js
words: Object.freeze(['潮水', '浪潮', '涨潮'])
```

Then assert:

```js
const vocabulary = byAttribute(container, 'data-slot', 'vocabulary-words');
assert.equal(vocabulary.length, 1);
assert.equal(vocabulary[0].textContent, '组词：潮水  浪潮  涨潮');
```

- [ ] **Step 3: Run focused views tests and verify RED**

Run:

```bash
node --test tests/views.test.mjs
```

Expected: FAIL because `createCharacterModel` does not expose `words` and `renderCharacter` does not render the vocabulary row.

- [ ] **Step 4: Add words to the character view model**

In `js/views.js`, add this helper near neighbor copying:

```js
function copyWords(value, character, path) {
  if (!Array.isArray(value)) return null;
  var copy = value.map(function (word, index) {
    requireNonBlankString(word, path + '[' + index + ']');
    if (word.indexOf(character) === -1) reject(path + '[' + index + ']', 'must include ' + character);
    return word;
  });
  return Object.freeze(copy);
}
```

Inside `createCharacterModel`, compute and include:

```js
var words = copyWords(entry.words, character, 'resolved.entry.words');
```

Then add to the returned model:

```js
words: words,
```

- [ ] **Step 5: Render the vocabulary row**

In `renderCharacter`, after the `pinyin` node and before `hanzi`, add:

```js
var vocabulary = Array.isArray(model.words) && model.words.length > 0
  ? node(documentObject, 'p', {
    'class': 'character-words',
    'data-slot': 'vocabulary-words'
  }, '组词：' + model.words.join('  '))
  : null;
```

Build the `character-tools` child list with `vocabulary` included only when present:

```js
var toolChildren = [
  pinyin
];
if (vocabulary) toolChildren.push(vocabulary);
toolChildren.push(
  hanzi,
  strokeCount,
  audioButton,
  audioFeedback,
  animationStatus,
  controls,
  speedGroup
);
var tools = node(documentObject, 'section', {
  'class': 'character-tools',
  'aria-label': model.character + '的读音和笔顺控制'
}, undefined, toolChildren);
```

- [ ] **Step 6: Style the vocabulary row**

Add to `styles.css` near the character detail typography:

```css
.character-words {
  color: var(--muted);
  font-size: 1rem;
  line-height: 1.55;
  margin: 0;
  max-width: 18rem;
  overflow-wrap: anywhere;
}
```

- [ ] **Step 7: Run focused views tests and verify GREEN**

Run:

```bash
node --test tests/views.test.mjs
```

Expected: all view tests PASS.

- [ ] **Step 8: Commit the UI model and render change**

Run:

```bash
git add js/views.js styles.css tests/views.test.mjs
git commit -m "feat: show vocabulary words"
```

Expected: one focused commit containing view-model, renderer, styles, and tests.

### Task 4: Verify app integration and offline browser behavior

**Files:**
- Modify: `tests/app.test.mjs`
- Modify: `tests/browser/app.spec.mjs`

- [ ] **Step 1: Add app-level model plumbing assertion**

In `tests/app.test.mjs`, update the fake entries in `createHarness()`:

```js
Object.freeze({ character: '郭', pinyin: 'guō', audio: 'guo1', words: Object.freeze(['城郭', '郭外']) })
```

When the harness creates a character model, include:

```js
words: resolved.entry.words,
```

In an existing character navigation test, assert the model passed to `renderCharacter` contains:

```js
const latestHandle = harness.renderHandles[harness.renderHandles.length - 1];
assert.deepEqual(latestHandle.model.words, ['城郭', '郭外']);
```

- [ ] **Step 2: Add browser-level visible vocabulary assertion**

In `tests/browser/app.spec.mjs`, after opening a real character such as `潮`, add:

```js
await assertText(page.locator('[data-slot="vocabulary-words"]'), '组词：潮水  浪潮  涨潮');
```

Use the same route and loading pattern as the existing character-detail test.

- [ ] **Step 3: Run integration tests and verify GREEN**

Run:

```bash
node --test tests/app.test.mjs
npm run test:browser
```

Expected: app tests PASS, browser tests PASS, and the character detail view shows the vocabulary row without affecting audio or stroke controls.

- [ ] **Step 4: Run full project verification**

Run:

```bash
npm run check
node --check js/data-store.js
node --check js/views.js
node --check scripts/build-library.mjs
node --check scripts/lib/library-validator.mjs
node --check tests/curriculum.test.mjs
node --check tests/views.test.mjs
node --check tests/app.test.mjs
node --check tests/browser/app.spec.mjs
git diff --check
```

Expected: every command exits zero; `npm run check` reports all unit tests passing, source validation passing, and both runtime builds succeeding.

- [ ] **Step 5: Review final scope**

Run:

```bash
git status --short
git diff --stat HEAD
```

Expected: only vocabulary-related files are dirty or committed since this plan began. Pre-existing unrelated dirty files from other active work must not be reverted.

- [ ] **Step 6: Commit integration assertions**

Run:

```bash
git add tests/app.test.mjs tests/browser/app.spec.mjs
git commit -m "test: verify vocabulary words in app"
```

Expected: one focused test commit.
