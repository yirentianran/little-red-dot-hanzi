# 汉字描写练习 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有完全离线的汉字学习应用中，为“会写”和“会认”增加单字及整组描写练习、逐笔判断、引导/独立两阶段和本地双层进度。

**Architecture:** 保留现有自研 SVG 小红点动画作为学习系统，新增 `practice-engine` 把本地 Hanzi Writer Quiz 封装为窄事件接口。纯状态的 `practice-session` 管理阶段与队列，`practice-progress-store` 管理全局汉字掌握和课文分类完成，现有路由、视图和 `app` 只通过这些公开接口协调练习。

**Tech Stack:** 经典浏览器脚本、SVG、Hanzi Writer 3.7.3、Pointer Events、`localStorage`、Node.js `node:test`、现有 Playwright browser runner。

---

## 文件结构

新增文件：

- `vendor/hanzi-writer.min.js`：固定版本的离线浏览器构建。
- `vendor/HANZI_WRITER_LICENSE.txt`：Hanzi Writer MIT 许可原文。
- `scripts/sync-hanzi-writer.mjs`：从固定 npm 包同步或校验 vendor 文件。
- `js/practice-progress-store.js`：版本化双层进度及内存降级。
- `js/practice-session.js`：无 DOM 的练习状态机和单轮队列。
- `js/practice-engine.js`：Hanzi Writer Quiz、起笔红点和错误笔迹适配层。
- `tests/vendor-hanzi-writer.test.mjs`：vendor 同步与固定版本测试。
- `tests/practice-progress-store.test.mjs`：进度读写、降级和校验测试。
- `tests/practice-session.test.mjs`：引导、独立、重练和结果状态测试。
- `tests/practice-engine.test.mjs`：第三方适配和生命周期测试。
- `tests/styles-practice.test.mjs`：练习布局的稳定尺寸和响应式规则测试。
- `tests/browser/practice.spec.mjs`：真实离线练习流程及笔画匹配验收。

修改文件：

- `package.json`、`package-lock.json`：固定依赖与 vendor 命令。
- `index.html`：按顺序加载 Hanzi Writer 和三个练习模块。
- `js/router.js`：增加严格的 `practice` 路由。
- `js/views.js`：增加入口、进度模型、练习页和结果页。
- `js/app.js`：协调路由、存储、会话、引擎和用户命令。
- `styles.css`：练习工作区、叠加层、响应式和减少动态效果样式。
- `tests/router.test.mjs`、`tests/views.test.mjs`、`tests/app.test.mjs`：扩展现有契约。
- `tests/browser/offline.spec.mjs`：练习页响应式与触控目标验收。
- `scripts/run-browser-tests.mjs`：注册练习 browser spec。
- `README.md`：说明两类练习入口、判定和本地进度。

## Task 1: 固定并离线分发 Hanzi Writer

**Files:**
- Create: `scripts/sync-hanzi-writer.mjs`
- Create: `tests/vendor-hanzi-writer.test.mjs`
- Create: `vendor/hanzi-writer.min.js`
- Create: `vendor/HANZI_WRITER_LICENSE.txt`
- Modify: `package.json:5-16`
- Modify: `package-lock.json`

- [ ] **Step 1: 安装固定依赖**

Run:

```bash
npm install --save-exact hanzi-writer@3.7.3
```

Expected: `package.json` 出现 `"dependencies": { "hanzi-writer": "3.7.3" }`，lockfile 记录相同版本。

- [ ] **Step 2: 写 vendor 同步失败测试**

```js
// tests/vendor-hanzi-writer.test.mjs
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { syncHanziWriter } from '../scripts/sync-hanzi-writer.mjs';

test('copies exactly version 3.7.3 browser bundle and license', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hanzi-vendor-'));
  const source = path.join(root, 'node_modules/hanzi-writer');
  const output = path.join(root, 'vendor');
  await mkdir(path.join(source, 'dist'), { recursive: true });
  await writeFile(path.join(source, 'package.json'), JSON.stringify({ version: '3.7.3' }));
  await writeFile(path.join(source, 'dist/hanzi-writer.min.js'), 'window.HanziWriter = {};\n');
  await writeFile(path.join(source, 'LICENSE'), 'MIT fixture\n');

  await syncHanziWriter({ rootDir: root });

  assert.equal(await readFile(path.join(output, 'hanzi-writer.min.js'), 'utf8'), 'window.HanziWriter = {};\n');
  assert.equal(await readFile(path.join(output, 'HANZI_WRITER_LICENSE.txt'), 'utf8'), 'MIT fixture\n');
});

test('rejects any installed version other than 3.7.3', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hanzi-vendor-version-'));
  const source = path.join(root, 'node_modules/hanzi-writer');
  await mkdir(path.join(source, 'dist'), { recursive: true });
  await writeFile(path.join(source, 'package.json'), JSON.stringify({ version: '3.7.2' }));
  await assert.rejects(() => syncHanziWriter({ rootDir: root }), /3\.7\.3/);
});
```

- [ ] **Step 3: 运行测试并确认失败**

Run: `node --test tests/vendor-hanzi-writer.test.mjs`

Expected: FAIL，原因是 `scripts/sync-hanzi-writer.mjs` 不存在。

- [ ] **Step 4: 实现可重复的同步与校验脚本**

```js
// scripts/sync-hanzi-writer.mjs
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EXPECTED_VERSION = '3.7.3';
const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export async function syncHanziWriter({ rootDir = projectRoot, verify = false } = {}) {
  const packageRoot = path.join(rootDir, 'node_modules/hanzi-writer');
  const metadata = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  if (metadata.version !== EXPECTED_VERSION) {
    throw new Error(`hanzi-writer must equal ${EXPECTED_VERSION}; received ${metadata.version}`);
  }
  const pairs = [
    ['dist/hanzi-writer.min.js', 'vendor/hanzi-writer.min.js'],
    ['LICENSE', 'vendor/HANZI_WRITER_LICENSE.txt']
  ];
  await mkdir(path.join(rootDir, 'vendor'), { recursive: true });
  for (const [sourceName, outputName] of pairs) {
    const source = path.join(packageRoot, sourceName);
    const output = path.join(rootDir, outputName);
    if (verify) {
      const [expected, actual] = await Promise.all([readFile(source), readFile(output)]);
      if (!expected.equals(actual)) throw new Error(`${outputName} is not synchronized`);
    } else {
      await copyFile(source, output);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const verify = process.argv.slice(2).includes('--verify');
  await syncHanziWriter({ verify });
  console.log(`Hanzi Writer ${EXPECTED_VERSION} vendor files ${verify ? 'verified' : 'synchronized'}`);
}
```

在 `package.json` 增加：

```json
"vendor:hanzi-writer": "node scripts/sync-hanzi-writer.mjs",
"verify:vendor": "node scripts/sync-hanzi-writer.mjs --verify",
"check": "npm test && npm run validate && npm run build:data && npm run verify:vendor"
```

- [ ] **Step 5: 生成 vendor 文件并验证**

Run:

```bash
npm run vendor:hanzi-writer
node --test tests/vendor-hanzi-writer.test.mjs
npm run verify:vendor
```

Expected: 三条命令全部 PASS；浏览器构建约 37 KB，许可文件非空。

- [ ] **Step 6: 提交**

```bash
git add package.json package-lock.json scripts/sync-hanzi-writer.mjs tests/vendor-hanzi-writer.test.mjs vendor
git commit -m "build: vendor Hanzi Writer for offline use"
```

## Task 2: 实现版本化练习进度存储

**Files:**
- Create: `js/practice-progress-store.js`
- Create: `tests/practice-progress-store.test.mjs`

- [ ] **Step 1: 写双层进度和降级测试**

```js
// tests/practice-progress-store.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import progressModule from '../js/practice-progress-store.js';

const { createPracticeProgressStore, PRACTICE_STORAGE_KEY } = progressModule;

function memoryStorage(initial) {
  const values = new Map(initial ? [[PRACTICE_STORAGE_KEY, initial]] : []);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
}

test('records global outcomes separately from lesson-group completion', () => {
  const storage = memoryStorage();
  const store = createPracticeProgressStore(storage);
  store.recordCharacterOutcome('潮', 'mastered');
  store.saveGroup('lesson-1', 'write', {
    completedCharacters: ['潮'], remainingCharacters: ['据'],
    needsPracticeCharacters: [], currentCharacter: '据', currentPhase: 'guided'
  });

  assert.deepEqual(store.getCharacter('潮'), {
    attemptCount: 1, lastOutcome: 'mastered', mastered: true
  });
  assert.deepEqual(store.getGroup('lesson-1', 'write').completedCharacters, ['潮']);
  assert.equal(store.getGroup('lesson-1', 'recognize'), null);
});

test('accepts a completed group with no current character or phase', () => {
  const store = createPracticeProgressStore(memoryStorage());
  store.saveGroup('lesson-1', 'write', {
    completedCharacters: ['潮'], remainingCharacters: [],
    needsPracticeCharacters: [], currentCharacter: null, currentPhase: null
  });
  assert.equal(store.getGroup('lesson-1', 'write').currentCharacter, null);
});

test('single-character completion does not overwrite an active group queue', () => {
  const store = createPracticeProgressStore(memoryStorage());
  store.saveGroup('lesson-1', 'write', {
    completedCharacters: [], remainingCharacters: ['潮', '据'],
    needsPracticeCharacters: [], currentCharacter: '潮', currentPhase: 'guided'
  });
  store.markGroupCharacterCompleted('lesson-1', 'write', '据');
  assert.deepEqual(store.getGroup('lesson-1', 'write'), {
    completedCharacters: ['据'], remainingCharacters: ['潮', '据'],
    needsPracticeCharacters: [], currentCharacter: '潮', currentPhase: 'guided'
  });
});

test('a later failed independent round downgrades global mastery', () => {
  const store = createPracticeProgressStore(memoryStorage());
  store.recordCharacterOutcome('潮', 'mastered');
  store.recordCharacterOutcome('潮', 'needs-practice');
  assert.deepEqual(store.getCharacter('潮'), {
    attemptCount: 2, lastOutcome: 'needs-practice', mastered: false
  });
});

test('invalid JSON resets only the practice key', () => {
  const storage = memoryStorage('{bad json');
  const store = createPracticeProgressStore(storage);
  assert.deepEqual(store.getSnapshot(), { schemaVersion: 1, characters: {}, groups: {} });
  assert.equal(store.isPersistent(), true);
});

test('write failures fall back to memory without breaking mutations', () => {
  const storage = { getItem: () => null, setItem: () => { throw new Error('denied'); }, removeItem() {} };
  const store = createPracticeProgressStore(storage);
  store.recordCharacterOutcome('盐', 'mastered');
  assert.equal(store.getCharacter('盐').mastered, true);
  assert.equal(store.isPersistent(), false);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test tests/practice-progress-store.test.mjs`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现严格、不可变的进度 API**

`js/practice-progress-store.js` 沿用现有 UMD 工厂模式，导出：

```js
var PRACTICE_STORAGE_KEY = 'hanzi-tracking:practice-progress:v1';

function createPracticeProgressStore(storage) {
  var persistent = Boolean(storage);
  var state = loadState(storage); // 只接受 schemaVersion 1、单字键和合法数组

  function commit(next) {
    state = freezeTree(next);
    if (persistent) {
      try { storage.setItem(PRACTICE_STORAGE_KEY, JSON.stringify(state)); }
      catch (_error) { persistent = false; }
    }
    return state;
  }

  function getCharacter(character) {
    var value = state.characters[character];
    return value || Object.freeze({ attemptCount: 0, lastOutcome: null, mastered: false });
  }

  function recordCharacterOutcome(character, outcome) {
    requireCharacter(character);
    if (outcome !== 'mastered' && outcome !== 'needs-practice') throw new TypeError('outcome');
    var previous = getCharacter(character);
    var characters = Object.assign({}, state.characters);
    characters[character] = {
      attemptCount: previous.attemptCount + 1,
      lastOutcome: outcome,
      mastered: outcome === 'mastered'
    };
    commit({ schemaVersion: 1, characters: characters, groups: state.groups });
    return getCharacter(character);
  }

  function getGroup(lessonId, group) {
    return state.groups[groupKey(lessonId, group)] || null;
  }

  function saveGroup(lessonId, group, progress) {
    var groups = Object.assign({}, state.groups);
    groups[groupKey(lessonId, group)] = validateGroupProgress(progress);
    commit({ schemaVersion: 1, characters: state.characters, groups: groups });
    return getGroup(lessonId, group);
  }

  function markGroupCharacterCompleted(lessonId, group, character) {
    requireCharacter(character);
    var previous = getGroup(lessonId, group) || {
      completedCharacters: [], remainingCharacters: [],
      needsPracticeCharacters: [], currentCharacter: null, currentPhase: null
    };
    var completed = previous.completedCharacters.includes(character)
      ? previous.completedCharacters
      : previous.completedCharacters.concat(character);
    return saveGroup(lessonId, group, Object.assign({}, previous, {
      completedCharacters: completed
    }));
  }

  function clearGroup(lessonId, group) {
    var groups = Object.assign({}, state.groups);
    delete groups[groupKey(lessonId, group)];
    commit({ schemaVersion: 1, characters: state.characters, groups: groups });
  }

  return Object.freeze({
    getCharacter, recordCharacterOutcome, getGroup, saveGroup,
    markGroupCharacterCompleted, clearGroup,
    getSnapshot: function () { return state; },
    isPersistent: function () { return persistent; }
  });
}
```

`validateGroupProgress` 只接受唯一单字数组；`currentCharacter` 和 `currentPhase` 在 `remainingCharacters` 非空时必须分别是队列中的单字和 `guided|independent`，队列为空时二者必须同时为 `null`。`markGroupCharacterCompleted` 只合并 `completedCharacters`，必须原样保留正在进行的整组队列、当前字、阶段和未掌握列表。`loadState` 必须捕获 `getItem`、JSON 解析和字段校验错误并返回 `{schemaVersion: 1, characters: {}, groups: {}}`；不得清除其他 localStorage 键。所有返回对象和数组递归冻结。

- [ ] **Step 4: 运行测试**

Run: `node --test tests/practice-progress-store.test.mjs`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add js/practice-progress-store.js tests/practice-progress-store.test.mjs
git commit -m "feat: store writing practice progress"
```

## Task 3: 实现练习会话状态机

**Files:**
- Create: `js/practice-session.js`
- Create: `tests/practice-session.test.mjs`

- [ ] **Step 1: 写阶段、重练和单轮队列测试**

```js
// tests/practice-session.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import sessionModule from '../js/practice-session.js';

const { createPracticeSession } = sessionModule;
const entries = Object.freeze([
  Object.freeze({ character: '潮', pinyin: 'cháo' }),
  Object.freeze({ character: '据', pinyin: 'jù' })
]);

function progress(mastered = []) {
  const outcomes = [];
  const groups = [];
  const groupCompletions = [];
  return {
    outcomes, groups, groupCompletions,
    getCharacter: (character) => ({ mastered: mastered.includes(character) }),
    getGroup: () => null,
    recordCharacterOutcome: (character, outcome) => outcomes.push([character, outcome]),
    saveGroup: (_lesson, _group, value) => groups.push(value),
    markGroupCharacterCompleted: (lesson, group, character) => (
      groupCompletions.push([lesson, group, character])
    )
  };
}

test('new character requires guided then zero-mistake independent practice', () => {
  const store = progress();
  const session = createPracticeSession({
    lessonId: 'lesson-1', group: 'write', scope: 'single', entries, startCharacter: '潮', progress: store
  });
  assert.equal(session.getState().phase, 'guided');
  session.completeCharacter({ totalMistakes: 4 });
  assert.equal(session.getState().phase, 'independent');
  session.completeCharacter({ totalMistakes: 0 });
  assert.equal(session.getState().status, 'complete');
  assert.deepEqual(store.outcomes, [['潮', 'mastered']]);
});

test('mastered characters skip guided and a mistake creates retry choice', () => {
  const store = progress(['潮']);
  const session = createPracticeSession({
    lessonId: 'lesson-1', group: 'write', scope: 'group', entries, startCharacter: '潮', progress: store
  });
  assert.equal(session.getState().phase, 'independent');
  session.completeCharacter({ totalMistakes: 1 });
  assert.equal(session.getState().status, 'needs-retry');
  session.retry();
  assert.equal(session.getState().phase, 'independent');
});

test('defer records needs-practice and advances without readding to this round', () => {
  const store = progress(['潮']);
  const session = createPracticeSession({
    lessonId: 'lesson-1', group: 'recognize', scope: 'group', entries, startCharacter: '潮', progress: store
  });
  session.completeCharacter({ totalMistakes: 1 });
  session.defer();
  assert.equal(session.getState().character, '据');
  assert.deepEqual(session.getState().needsPracticeCharacters, ['潮']);
  assert.deepEqual(store.outcomes, [['潮', 'needs-practice']]);
});

test('a failed single-character independent attempt still marks that lesson entry completed', () => {
  const store = progress();
  const session = createPracticeSession({
    lessonId: 'lesson-1', group: 'write', scope: 'single', entries,
    startCharacter: '潮', progress: store
  });
  session.completeCharacter({ totalMistakes: 0 });
  session.completeCharacter({ totalMistakes: 1 });
  assert.equal(session.getState().status, 'needs-retry');
  assert.deepEqual(store.groupCompletions, [['lesson-1', 'write', '潮']]);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test tests/practice-session.test.mjs`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现纯状态机**

`createPracticeSession(options)` 校验 `lessonId`、`group`、`scope`、非空 `entries`、`startCharacter` 和可选 `resume`。`scope === 'single'` 时把活动队列过滤为当前字；`resume` 默认 `true`，结果页开始“再练未掌握字”时传入过滤后的 entries 和 `resume: false`。状态为：

```js
{
  status: 'active',
  phase: 'guided',
  character: '潮',
  index: 0,
  total: 2,
  mistakes: 0,
  completedCharacters: [],
  remainingCharacters: ['潮', '据'],
  needsPracticeCharacters: []
}
```

公开方法必须固定为：

```js
return Object.freeze({
  getState: snapshot,
  recordStrokeMistake: function () { state.mistakes += 1; publish(); },
  completeCharacter: completeCharacter,
  retry: retry,
  defer: defer,
  restart: restart,
  destroy: destroy
});
```

`completeCharacter({totalMistakes})` 的确定性规则：

```js
if (state.phase === 'guided') {
  state.phase = 'independent';
  state.mistakes = 0;
} else if (totalMistakes === 0) {
  markCurrentCompletedHere();
  progress.recordCharacterOutcome(state.character, 'mastered');
  finishCurrentCharacter();
} else {
  markCurrentCompletedHere();
  progress.recordCharacterOutcome(state.character, 'needs-practice');
  state.status = 'needs-retry';
  state.mistakes = totalMistakes;
}
saveAndPublish();
```

`markCurrentCompletedHere()` 以集合语义把当前字加入 `completedCharacters`，所以失败、重试和成功不会产生重复项。`scope === 'group'` 时，`saveAndPublish()` 保存完整队列以支持恢复；`scope === 'single'` 时绝不覆盖整组队列，而是在第一次独立完成后调用一次 `progress.markGroupCharacterCompleted(lessonId, group, character)`。`defer()` 仅允许 `scope === 'group' && status === 'needs-retry'`：失败结果已由 `completeCharacter` 记录，因此这里只把当前字加入 `needsPracticeCharacters`，从本轮 `remainingCharacters` 移除，然后进入下一个字。队列为空时状态变为 `complete`，保存的 `currentCharacter` 和 `currentPhase` 均为 `null`。`retry()` 保留当前字并从独立阶段开头重来；再次完成独立阶段会记录新的 outcome 和 attempt，但单字课文完成合并不重复。`restart()` 重置当前阶段但不改变队列。

- [ ] **Step 4: 扩展恢复与结果测试并运行**

增加测试：整组 scope 从 `progress.getGroup()` 恢复当前字和阶段；单字 scope 忽略整组恢复队列且不调用 `saveGroup()`；结果页使用 `needsPracticeCharacters` 创建新 session；所有快照递归冻结；`destroy()` 后命令抛错。

Run: `node --test tests/practice-session.test.mjs`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add js/practice-session.js tests/practice-session.test.mjs
git commit -m "feat: add writing practice session state"
```

## Task 4: 增加严格的练习路由

**Files:**
- Modify: `js/router.js:12-159`
- Modify: `tests/router.test.mjs:19-248`

- [ ] **Step 1: 写练习路由失败测试**

在 canonical route 表中增加：

```js
[
  {
    view: 'practice', lessonId: 'lesson-1', group: 'write',
    scope: 'group', character: '潮'
  },
  '#/practice?lesson=lesson-1&group=write&scope=group&character=%E6%BD%AE'
]
```

增加 normalize 断言：

```js
assert.deepEqual(normalizeRoute({
  view: 'practice', lessonId: 'lesson-1', group: 'recognize',
  scope: 'single', character: '盐'
}, store), {
  view: 'practice', lessonId: 'lesson-1', group: 'recognize',
  scope: 'single', character: '盐'
});

assert.deepEqual(normalizeRoute({
  view: 'practice', lessonId: 'lesson-1', group: 'write',
  scope: 'group', character: '盐'
}, store), {
  view: 'practice', lessonId: 'lesson-1', group: 'write',
  scope: 'group', character: '潮'
});
```

并覆盖未知 `scope`、空分类、无效课文、重复参数和继承字段。

- [ ] **Step 2: 运行路由测试并确认失败**

Run: `node --test tests/router.test.mjs`

Expected: FAIL，`practice` 被序列化或规范化为目录。

- [ ] **Step 3: 扩展路由映射和规范化**

```js
var PARAMETER_FIELDS = Object.freeze({
  lesson: 'lessonId', group: 'group', scope: 'scope', character: 'character'
});
var PATH_VIEWS = Object.freeze({
  '/': 'directory', '/lesson': 'lesson', '/character': 'character', '/practice': 'practice'
});
```

`serializeHash` 对 `practice` 只接受 `view, lessonId, group, scope, character`，按 `lesson`、`group`、`scope`、`character` 固定顺序写参数。`normalizeRoute` 在 group 可用后执行：

```js
if (view === 'practice') {
  if (route.scope !== 'single' && route.scope !== 'group') {
    return Object.freeze({ view: 'lesson', lessonId, group });
  }
  var resolved = store.resolve({ lessonId, group, character: route.character });
  if (!resolved && route.scope === 'single') {
    return Object.freeze({ view: 'lesson', lessonId, group });
  }
  return Object.freeze({
    view: 'practice', lessonId, group, scope: route.scope,
    character: resolved ? route.character : selectedEntries[0].character
  });
}
```

- [ ] **Step 4: 运行完整路由测试**

Run: `node --test tests/router.test.mjs`

Expected: PASS，包括 521 条现有字符路由回归。

- [ ] **Step 5: 提交**

```bash
git add js/router.js tests/router.test.mjs
git commit -m "feat: route offline writing practice"
```

## Task 5: 封装 Hanzi Writer Quiz 和提示叠加层

**Files:**
- Create: `js/practice-engine.js`
- Create: `tests/practice-engine.test.mjs`

- [ ] **Step 1: 写 fake writer 契约测试**

```js
// tests/practice-engine.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import engineModule from '../js/practice-engine.js';

const { createPracticeEngine } = engineModule;

function fakeTarget() {
  const makeElement = (tagName) => ({
    tagName,
    attributes: new Map(),
    childNodes: [],
    style: {},
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    appendChild(child) { this.childNodes.push(child); return child; },
    replaceChildren(...children) { this.childNodes = children; },
    remove() { this.removed = true; }
  });
  const listeners = new Map();
  const target = makeElement('div');
  target.ownerDocument = { createElementNS: (_namespace, tagName) => makeElement(tagName) };
  target.getBoundingClientRect = () => ({ width: 300, height: 300, left: 0, top: 0 });
  target.addEventListener = (name, listener) => listeners.set(name, listener);
  target.removeEventListener = (name) => listeners.delete(name);
  target.listeners = listeners;
  return target;
}

test('loads local geometry and converts quiz callbacks to stable events', () => {
  const calls = [];
  const writer = {
    quiz(options) { this.options = options; },
    cancelQuiz() { calls.push('cancel'); },
    highlightStroke(index) { calls.push(['hint', index]); },
    updateDimensions() {}, setCharacter() {}
  };
  const HanziWriter = {
    create(_target, character, options) {
      assert.equal(character, '潮');
      assert.deepEqual(options.charDataLoader(), {
        strokes: ['M0 0'], medians: [[[0, 0], [10, 10]]]
      });
      return writer;
    },
    getScalingTransform: () => ({ transform: 'translate(0, 100) scale(0.1, -0.1)' })
  };
  const events = [];
  const engine = createPracticeEngine({
    target: fakeTarget(), HanziWriter, character: '潮',
    geometry: { strokeCount: 1, strokes: ['M0 0'], medians: [[[0, 0], [10, 10]]] },
    onEvent: (event) => events.push(event)
  });
  engine.start({ phase: 'independent', strokeIndex: 0 });
  writer.options.onMistake({
    strokeNum: 0, mistakesOnStroke: 1, totalMistakes: 1, strokesRemaining: 1,
    isBackwards: true, drawnPath: { pathString: 'M1 1 L2 2', points: [[1, 1], [2, 2]] }
  });
  assert.equal(events[0].type, 'stroke-mistake');
  assert.equal(events[0].isBackwards, true);
  engine.destroy();
  assert.deepEqual(calls, ['cancel']);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test tests/practice-engine.test.mjs`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现公开适配接口**

`createPracticeEngine(options)` 校验 target、HanziWriter、单字、几何和回调，创建一次 writer：

```js
var writer = HanziWriter.create(target, character, {
  width: size.width,
  height: size.height,
  padding: 24,
  showCharacter: false,
  showOutline: true,
  drawingColor: '#1769aa',
  strokeColor: '#20252b',
  highlightColor: '#d92d20',
  acceptBackwardsStrokes: false,
  leniency: 1,
  highlightOnComplete: false,
  charDataLoader: function () {
    return { strokes: geometry.strokes, medians: geometry.medians };
  }
});
```

`start({phase, strokeIndex})` 更新 outline 可见性并调用：

```js
writer.quiz({
  quizStartStrokeNum: strokeIndex,
  showHintAfterMisses: 2,
  acceptBackwardsStrokes: false,
  leniency: 1,
  highlightOnComplete: false,
  onCorrectStroke: function (data) { currentStroke = data.strokeNum + 1; emit('stroke-correct', data); updateStartDot(); },
  onMistake: function (data) { emit('stroke-mistake', data); renderMistakePath(data.drawnPath); },
  onComplete: function (data) { emit('character-complete', data); }
});
```

叠加 SVG 设置 `pointer-events="none"`，起笔圆点使用 `geometry.medians[currentStroke][0]` 和 `HanziWriter.getScalingTransform`；错误路径使用 callback 的外部坐标 `pathString`，红色显示后按减少动态效果设置立即清除或在 240 ms 后清除。

公开 API 固定为：

```js
return Object.freeze({ start, restart, showHint, resize, cancel, destroy });
```

- [ ] **Step 4: 增加生命周期和输入取消测试**

覆盖：连续 `start` 先取消旧 Quiz；`showHint` 使用当前笔；`resize` 同时更新 writer 和 overlay；第二根 pointer 取消当前 Quiz 并从当前笔重开且不发 mistake；`destroy` 幂等、清除 timeout/listener/DOM；destroy 后命令抛错。

Run: `node --test tests/practice-engine.test.mjs`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add js/practice-engine.js tests/practice-engine.test.mjs
git commit -m "feat: adapt Hanzi Writer quiz engine"
```

## Task 6: 增加练习模型、入口和结果视图

**Files:**
- Modify: `js/views.js:12-760`
- Modify: `tests/views.test.mjs`

- [ ] **Step 1: 写视图模型和 DOM 失败测试**

增加导出契约：

```js
assert.equal(typeof views.createPracticeModel, 'function');
assert.equal(typeof views.renderPractice, 'function');
```

为课文模型传入进度快照并断言：

```js
const model = createLessonModel(store, {
  lessonId: 'lesson-1', group: 'write'
}, {
  characters: { 潮: { mastered: true } },
  group: { completedCharacters: ['潮'] }
});
assert.deepEqual(model.practice, { completed: 1, mastered: 1, total: 15 });
assert.equal(model.entries[0].mastered, true);
assert.equal(model.entries[0].completedHere, true);
```

渲染断言：

```js
assert.equal(byAction(container, 'start-group-practice').length, 1);
assert.equal(byAction(characterContainer, 'start-character-practice').length, 1);
assert.equal(byAttribute(container, 'data-practice-mastered', 'true').length, 1);
```

练习视图分别覆盖 `active`、`needs-retry`、`complete`，并断言固定 action：`practice-back`、`practice-hint`、`practice-restart`、`practice-retry`、`practice-defer`、`practice-review-needs`、`practice-return-lesson`。

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test tests/views.test.mjs`

Expected: FAIL，练习 API 和 action 不存在。

- [ ] **Step 3: 扩展现有模型且保持旧调用兼容**

`createLessonModel(store, options, practice)` 的第三参数可省略；生成：

```js
practice: freezeTree({
  completed: selected.filter(function (entry) { return completed.has(entry.character); }).length,
  mastered: selected.filter(function (entry) { return mastered.has(entry.character); }).length,
  total: selected.length
})
```

每个 entry 增加 `mastered` 和 `completedHere` 布尔值。`createCharacterModel(resolved, practice)` 增加同名状态但不改变原有字段。

新增 `createPracticeModel(resolved, state, persistent)`，严格复制以下字段：

```js
{
  unit, lesson, group, scope,
  character, pinyin, strokeCount,
  status, phase, index, total, mistakes,
  completedCount, masteredCount, needsPracticeCharacters,
  persistent
}
```

- [ ] **Step 4: 渲染入口、练习工作区和结果页**

课文入口使用：

```html
<button data-action="start-group-practice" data-lesson-id="lesson-1" data-group="write">练习本组</button>
```

单字入口带 `data-character`。练习 active 视图创建空的 `[data-slot="practice-board"]` 供 engine 挂载，固定高度 `[data-slot="practice-feedback"]`，以及提示/重写按钮。`needs-retry` 只显示立即重练；整组额外显示稍后再练。`complete` 不渲染 board，显示汇总和结果命令。

所有按钮使用现有 `node()` 创建，不使用 `innerHTML`，返回 handle：

```js
return Object.freeze({
  root, heading, board,
  setFeedback: function (message, kind) {
    feedback.textContent = message;
    feedback.setAttribute('data-kind', kind);
  },
  setStrokePosition: function (current, total) {
    strokePosition.textContent = '第 ' + current + ' / ' + total + ' 笔';
    board.setAttribute('aria-label', model.character + '，' + model.phaseLabel
      + '，第' + current + '笔，共' + total + '笔');
  }
});
```

- [ ] **Step 5: 运行视图测试并提交**

Run: `node --test tests/views.test.mjs`

Expected: PASS，旧目录、课文和单字测试无回归。

```bash
git add js/views.js tests/views.test.mjs
git commit -m "feat: render writing practice views"
```

## Task 7: 增加练习布局和响应式样式

**Files:**
- Modify: `styles.css:127-end`
- Create: `tests/styles-practice.test.mjs`

- [ ] **Step 1: 写稳定布局规则失败测试**

```js
// tests/styles-practice.test.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('practice CSS fixes the square board, input gestures, and responsive columns', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.practice-board\s*\{[^}]*aspect-ratio:\s*1/s);
  assert.match(css, /\.practice-board\s*\{[^}]*touch-action:\s*none/s);
  assert.match(css, /\.practice-feedback\s*\{[^}]*min-height:/s);
  assert.match(css, /@media\s*\(min-width:\s*760px\)[\s\S]*\.practice-work-surface/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test tests/styles-practice.test.mjs`

Expected: FAIL，练习 CSS 规则不存在。

- [ ] **Step 3: 实现稳定布局**

增加以下核心规则，并沿用现有颜色变量：

```css
.practice-work-surface {
  display: grid;
  gap: 20px;
  align-items: start;
}
.practice-board {
  position: relative;
  width: min(100%, 620px);
  aspect-ratio: 1;
  background: var(--paper);
  border: 2px solid #9fb6c7;
  border-radius: 4px;
  overflow: hidden;
  touch-action: none;
}
.practice-board > svg,
.practice-board > canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.practice-feedback { min-height: 48px; }
.practice-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
@media (min-width: 760px) {
  .practice-work-surface { grid-template-columns: minmax(0, 1fr) minmax(240px, 320px); }
}
@media (prefers-reduced-motion: reduce) {
  .practice-error-path { transition: none; }
}
```

工具栏使用全宽黄色信息带而非嵌套卡片；长课名、反馈和按钮文字允许换行。

- [ ] **Step 4: 运行样式和视图测试**

Run:

```bash
node --test tests/styles-practice.test.mjs
node --test tests/views.test.mjs
git diff --check
```

Expected: PASS。真实几何、截图和触控目标在 Task 10 的浏览器测试中验证。

- [ ] **Step 5: 提交**

```bash
git add styles.css tests/styles-practice.test.mjs
git commit -m "style: add responsive writing practice surface"
```

## Task 8: 把练习模块接入应用生命周期

**Files:**
- Modify: `index.html:21-28`
- Modify: `js/app.js:12-940`
- Modify: `tests/app.test.mjs`

- [ ] **Step 1: 扩展 app fake collaborators 和失败测试**

`API_METHODS` fake 增加：

```js
createPracticeProgressStore,
createPracticeSession,
createPracticeEngine,
createPracticeModel,
renderPractice
```

写两个流程测试：

```js
test('starts group practice from both groups and replaces hashes between characters', () => {
  const state = createHarness();
  state.app.start();
  state.clickAction('open-lesson', { lessonId: 'lesson-1', group: 'recognize' });
  state.clickAction('start-group-practice', { lessonId: 'lesson-1', group: 'recognize' });
  assert.equal(state.views.at(-1), 'practice');
  assert.equal(state.practiceSessions.at(-1).scope, 'group');
  assert.equal(
    state.location.hash,
    '#/practice?lesson=lesson-1&group=recognize&scope=group&character=%E7%9B%90'
  );
});

test('quiz completion drives guided, independent, retry and result rendering', () => {
  const state = createHarness();
  state.openPractice('lesson-1', 'write', '潮');
  state.practiceEngines.at(-1).emit({ type: 'character-complete', totalMistakes: 0 });
  assert.equal(state.practiceSessions.at(-1).state.phase, 'independent');
  state.practiceEngines.at(-1).emit({ type: 'stroke-mistake', totalMistakes: 1 });
  state.practiceEngines.at(-1).emit({ type: 'character-complete', totalMistakes: 1 });
  assert.equal(state.views.at(-1), 'practice');
  assert.equal(state.practiceSessions.at(-1).state.status, 'needs-retry');
});

test('practice preserves the last learned character and back returns to its origin', () => {
  const state = createHarness();
  state.openCharacter('lesson-1', 'recognize', '盐');
  const savedLearningRoute = state.storage.getItem('hanzi-tracking:last-route:v1');
  state.clickAction('start-character-practice', {
    lessonId: 'lesson-1', group: 'recognize', character: '盐'
  });
  assert.equal(state.storage.getItem('hanzi-tracking:last-route:v1'), savedLearningRoute);
  state.clickAction('practice-back');
  assert.equal(state.views.at(-1), 'character');
});
```

- [ ] **Step 2: 运行 app test 并确认失败**

Run: `node --test tests/app.test.mjs`

Expected: FAIL，缺少协作者和 action。

- [ ] **Step 3: 按经典脚本顺序加载依赖**

`index.html` 在 `app.js` 前使用：

```html
<script defer src="vendor/hanzi-writer.min.js"></script>
<script defer src="js/practice-progress-store.js"></script>
<script defer src="js/practice-session.js"></script>
<script defer src="js/practice-engine.js"></script>
```

`bootstrapApp` 把 `window.HanziWriter` 作为显式选项传给 `createApp`，测试环境继续注入 fake。

- [ ] **Step 4: 接入路由 action 和练习渲染**

扩展 `ROUTE_ACTIONS`：

```js
'start-group-practice': ['lessonId', 'group'],
'start-character-practice': ['lessonId', 'group', 'character']
```

非路由 action 增加：`practice-hint`、`practice-restart`、`practice-retry`、`practice-defer`、`practice-review-needs`、`practice-return-lesson`。

应用初始化一次：

```js
var practiceProgress = api.createPracticeProgressStore(storage);
```

`renderRoute` 对 `practice` 执行：解析 entry 列表和当前字、创建或恢复 session、渲染 model、创建 engine。engine 事件处理规则固定为：

```js
if (event.type === 'stroke-mistake') {
  session.recordStrokeMistake(event);
  handle.setFeedback(event.isBackwards ? '方向反了，再试一次' : '这一笔不对，再试一次', 'error');
} else if (event.type === 'character-complete') {
  session.completeCharacter(event);
  renderCurrentPracticeState(true);
}
```

进入练习时保存一个内存 `practiceOrigin`：`scope === 'single'` 指向原单字 route，`scope === 'group'` 指向原课文字表 route。`practice-back` 使用该 route；直接打开练习 URL 时按 scope 构造相同回退。阶段或汉字改变时销毁旧 engine 后重建；仅字符改变时用 `replaceHash` 更新 practice hash，避免历史膨胀。practice route 永远不写入现有 `hanzi-tracking:last-route:v1`。退出练习时销毁 engine 和 session，但保留 progress store。

`practice-review-needs` 从当前结果的 `needsPracticeCharacters` 过滤 entries，使用 `resume: false` 创建新一轮；空列表时隐藏该按钮。`practice-return-lesson` 始终回到当前课文和分类。

- [ ] **Step 5: 注入进度到现有课文和单字模型**

创建 helper 从 progress store 与当前 entries 生成：

```js
{
  characters: Object.fromEntries(entries.map(function (entry) {
    return [entry.character, practiceProgress.getCharacter(entry.character)];
  })),
  group: practiceProgress.getGroup(lessonId, group)
}
```

传给 `createLessonModel` 和 `createCharacterModel`。存储降级时调用 `announce('本次进度不会保存')`，同一会话只宣布一次。

- [ ] **Step 6: 运行 app 与完整单元测试并提交**

Run:

```bash
node --test tests/app.test.mjs
npm test
```

Expected: PASS；目录、发音、学习动画和最近位置测试无回归。

```bash
git add index.html js/app.js tests/app.test.mjs
git commit -m "feat: integrate offline writing practice"
```

## Task 9: 补齐真实笔画判断与练习浏览器流程

**Files:**
- Create: `tests/browser/practice.spec.mjs`
- Modify: `scripts/run-browser-tests.mjs`

- [ ] **Step 1: 注册练习 spec 并写中心线输入 helper**

```js
// scripts/run-browser-tests.mjs
const suitePaths = [
  path.join(repoRoot, 'tests/browser/app.spec.mjs'),
  path.join(repoRoot, 'tests/browser/offline.spec.mjs'),
  path.join(repoRoot, 'tests/browser/practice.spec.mjs')
];

// tests/browser/practice.spec.mjs
export function registerBrowserTests({ test }) {
  // 本任务后续步骤中的 practice cases 全部在这里注册。
}

function practiceHash(lessonId, group, scope, character) {
  return `#/practice?${new URLSearchParams({ lesson: lessonId, group, scope, character })}`;
}

async function drawMedian(page, strokeIndex, { reverse = false, offset = 0 } = {}) {
  const mapped = await page.evaluate(({ character, strokeIndex, offset }) => {
    const board = document.querySelector('[data-slot="practice-board"]');
    const box = board.getBoundingClientRect();
    const transform = window.HanziWriter.getScalingTransform(box.width, box.height, 24);
    return window.HANZI_LIBRARY.characters[character].medians[strokeIndex].map(([x, y]) => ({
      x: box.left + transform.x + (x * transform.scale) + offset,
      y: box.top + box.height - transform.y - (y * transform.scale) + offset
    }));
  }, { character: '潮', strokeIndex, offset });
  if (reverse) mapped.reverse();
  await page.mouse.move(mapped[0].x, mapped[0].y);
  await page.mouse.down();
  for (const point of mapped.slice(1)) await page.mouse.move(point.x, point.y, { steps: 2 });
  await page.mouse.up();
}
```

helper 必须继续只使用 `getBoundingClientRect()`、公开的 `HanziWriter.getScalingTransform()` 和项目字符数据；不得读取 writer 私有对象，也不得用扩大 `leniency` 掩盖坐标错误。

- [ ] **Step 2: 写核心离线流程测试**

覆盖：

```js
test('practices recognize characters through guided and independent rounds', async ({ indexUrl, openPage }) => {
  const page = await openPage({ reducedMotion: true });
  await page.goto(withHash(indexUrl, practiceHash('lesson-1', 'recognize', 'single', '盐')));
  await page.locator('[data-view="practice"]').waitFor();
  assert.equal(await page.locator('[data-practice-phase]').getAttribute('data-practice-phase'), 'guided');
  // 对每个 median 调用 drawMedian，等待阶段切换，再完成 independent。
  assert.match(await page.locator('[data-view="practice"]').textContent(), /已掌握/);
});
```

另写：反方向第一笔失败并显示“方向反了”；明显偏移失败；同一笔错误两次出现提示；单字完成更新 storage；整组 `defer` 后结果包含未掌握字；“再练未掌握字”只创建该子集。

- [ ] **Step 3: 运行 browser test 并修复真实集成差异**

Run: `npm run test:browser`

Expected: 所有 practice 和既有 browser tests PASS；请求监听器确认没有 `http:` 或 `https:` 请求。

只修复测试证明的 API、坐标或生命周期问题。不得读取 Hanzi Writer 私有对象，也不得为了通过错误轨迹测试而放宽 `leniency`。

- [ ] **Step 4: 增加代表性匹配矩阵**

至少选 `一`、`亿`、`潮`、`肃`、`戴`、`藏`、`凿`、`鼎`，对中心线、轻微抖动、反向、过短和错误后续笔画运行自动测试。复杂字可只抽取具有代表性的笔画，整字 happy path 至少覆盖一个 15 笔以上汉字。

Run: `npm run test:browser`

Expected: 合法输入全部通过，明确错误输入全部失败。

- [ ] **Step 5: 提交**

```bash
git add tests/browser/practice.spec.mjs scripts/run-browser-tests.mjs
git commit -m "test: verify offline writing practice"
```

## Task 10: 完成视觉、触控和无障碍验收

**Files:**
- Modify: `tests/browser/offline.spec.mjs`
- Modify: `styles.css`
- Modify: `js/views.js`

- [ ] **Step 1: 写并运行练习响应式几何 case**

在 `offline.spec.mjs` 增加 `practiceHash()`，对三个 viewport 打开 `lesson-22/write/肃` 的 practice 页并断言：

```js
const board = await page.locator('[data-slot="practice-board"]').boundingBox();
const tools = await page.locator('.practice-tools').boundingBox();
assert.ok(Math.abs(board.width - board.height) <= 1.5);
assert.equal(intersects(board, tools), false);
if (viewport.width < 760) assert.ok(board.bottom <= tools.top + 1);
else assert.ok(board.right <= tools.left + 1);
```

三个 viewport 都捕获课文字表入口、引导练习、独立练习、needs-retry 和结果页截图。每张图继续执行 PNG、颜色方差、横向溢出、44 px 目标和关键区域不重叠断言。

Run: `npm run test:browser`

Expected: PASS。

- [ ] **Step 2: 增加交互与无障碍断言**

```js
assert.equal(await page.locator('[data-slot="practice-board"]').getAttribute('role'), 'img');
assert.match(await page.locator('[data-slot="practice-board"]').getAttribute('aria-label'), /潮.*第1笔/);
assert.equal(await page.locator('[data-action="practice-hint"]').getAttribute('aria-label'), '提示当前笔');
assert.equal(await page.locator('[data-slot="practice-feedback"]').getAttribute('aria-live'), 'polite');
```

通过 `page.emulateMedia({ reducedMotion: 'reduce' })` 断言错误笔迹没有 transition；模拟第二 pointer 时当前笔取消且 mistake 计数不变；米字格外拖动页面仍可滚动。

- [ ] **Step 3: 运行并检查截图**

Run: `npm run test:browser`

Expected: PASS，runner 打印系统临时截图目录。人工检查全部练习截图：米字格不空白、红点位于字形内、反馈不遮挡控件、长课名不溢出、桌面双列与移动单列正确。

- [ ] **Step 4: 真实设备校准**

在真实平板上分别使用手指和手写笔完成 `一`、`亿`、`潮`、`肃`、`戴`、`藏`、`凿`、`鼎`。记录误拒和误收；只有中心轨迹测试与真实试写共同显示问题时，才在 `practice-engine.js` 的单一 `QUIZ_LENIENCY` 常量调整并重跑所有匹配矩阵。

Expected: 正常书写无需刻意贴线，反向、错笔顺和明显偏离稳定失败；页面不随书写滚动。

- [ ] **Step 5: 提交自动化修复**

```bash
git add tests/browser/offline.spec.mjs styles.css js/views.js
git commit -m "test: verify responsive practice experience"
```

真实设备验收本身不提交截图或日志，除非发现问题需要增加回归 fixture。

## Task 11: 文档与最终验证

**Files:**
- Modify: `README.md:1-46`

- [ ] **Step 1: 更新使用说明**

在“直接使用”中加入：

```markdown
课文字表中的“会写”和“会认”都可以选择“练习本组”，单字页可以选择“练习这个字”。未掌握的字先进行一遍引导描写，再进行一遍只显示起笔点的独立描写；独立描写零错误完成后标记为已掌握。

练习次数、最近结果、汉字掌握状态和课文分类进度仅保存在当前浏览器。浏览器禁止本地存储时，描写仍可使用，但关闭页面后不保留本次进度。
```

在数据与许可部分注明 Hanzi Writer 3.7.3、MIT 许可文件路径和运行时完全本地。

- [ ] **Step 2: 运行完整验证**

Run:

```bash
npm run check
npm run test:browser
git diff --check
```

Expected: 全部 PASS；browser runner 输出截图目录；没有网络请求、未处理 rejection 或 console error。

- [ ] **Step 3: 检查构建与工作树范围**

Run:

```bash
npm run build:data
npm run verify:vendor
git status --short
```

Expected: 数据构建无差异；vendor 校验通过；status 只包含本任务的 README 或用户原有未提交内容，不包含临时截图、缓存或测试输出。

- [ ] **Step 4: 提交文档**

```bash
git add README.md
git commit -m "docs: explain offline writing practice"
```

- [ ] **Step 5: 最终人工检查**

直接通过 `file://` 打开 `index.html`，完成以下 smoke flow：目录 → 观潮 → 会认 → 盐 → 练习这个字 → 引导 → 独立 → 返回字表 → 练习本组 → 稍后再练 → 结果 → 再练未掌握字。确认学习页小红点、发音和浏览器返回仍正常。

Expected: 功能与 `docs/superpowers/specs/2026-07-26-writing-practice-design.md` 全部验收项一致。
