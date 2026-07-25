import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

import dataStoreModule from '../js/data-store.js';

const require = createRequire(import.meta.url);
const { createDataStore } = dataStoreModule;

function loadViews() {
  return require('../js/views.js');
}

async function createRuntimeStore() {
  const source = await readFile(new URL('../data/library-data.js', import.meta.url), 'utf8');
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename: 'data/library-data.js' });
  return createDataStore(context.window.HANZI_LIBRARY);
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
    this.attributes = new Map();
    this.childNodes = [];
    this.parentNode = null;
    this.attributeWrites = 0;
  }

  setAttribute(name, value) {
    this.attributeWrites += 1;
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    this.attributeWrites += 1;
    this.attributes.delete(name);
  }

  replaceChildren(...children) {
    this.childNodes.forEach((child) => {
      if (child && typeof child === 'object') child.parentNode = null;
    });
    this.childNodes = children;
    children.forEach((child) => {
      if (child && typeof child === 'object') child.parentNode = this;
    });
  }

  set textContent(value) {
    this.childNodes = [String(value)];
  }

  get textContent() {
    return this.childNodes.map((child) => (
      typeof child === 'string' ? child : child.textContent
    )).join('');
  }

  set innerHTML(_value) {
    throw new Error('views must not use innerHTML');
  }

  addEventListener() {
    throw new Error('views must not register events');
  }
}

class FakeDocument {
  constructor() {
    this.created = [];
  }

  createElement(tagName) {
    const element = new FakeElement(tagName, this);
    this.created.push(element);
    return element;
  }
}

function createDom() {
  const document = new FakeDocument();
  return { document, container: new FakeElement('main', document) };
}

function descendants(root) {
  const result = [];
  function visit(node) {
    if (!node || typeof node === 'string') return;
    result.push(node);
    node.childNodes.forEach(visit);
  }
  visit(root);
  return result;
}

function byAttribute(root, name, value) {
  return descendants(root).filter((element) => (
    element.getAttribute(name) === String(value)
  ));
}

function byAction(root, action) {
  return byAttribute(root, 'data-action', action);
}

function byTag(root, tagName) {
  return descendants(root).filter((element) => element.tagName === tagName);
}

function deepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  if (!Object.isFrozen(value)) return false;
  return Object.values(value).every((child) => deepFrozen(child, seen));
}

test('exports the complete frozen view API', () => {
  const views = loadViews();

  assert.deepEqual(Object.keys(views).sort(), [
    'createCharacterModel',
    'createDirectoryModel',
    'createLessonModel',
    'renderCharacter',
    'renderDirectory',
    'renderLesson'
  ]);
  assert.ok(Object.isFrozen(views));
});

test('builds an immutable eight-unit directory from the real curriculum', async () => {
  const { createDirectoryModel } = loadViews();
  const store = await createRuntimeStore();
  const before = store.getUnits();
  const model = createDirectoryModel(store);
  const first = model.units[0].lessons[0];

  assert.equal(model.units.length, 8);
  assert.deepEqual(
    {
      kind: first.kind,
      id: first.id,
      number: first.number,
      title: first.title,
      recognize: first.recognize,
      recognizeDisplayed: first.recognizeDisplayed,
      recognizeCounted: first.recognizeCounted,
      polyphonicReviews: first.polyphonicReviews,
      write: first.write,
      total: first.total,
      defaultGroup: first.defaultGroup
    },
    {
      kind: 'lesson',
      id: 'lesson-1',
      number: 1,
      title: '观潮',
      recognize: 13,
      recognizeDisplayed: 13,
      recognizeCounted: 12,
      polyphonicReviews: 1,
      write: 15,
      total: 28,
      defaultGroup: 'write'
    }
  );
  assert.equal(first.total, first.recognize + first.write);
  assert.equal(store.getUnits(), before);
  assert.ok(deepFrozen(model));
});

test('builds write, recognize, garden, and review-aware lesson models', async () => {
  const { createLessonModel } = loadViews();
  const store = await createRuntimeStore();
  const write = createLessonModel(store, { lessonId: 'lesson-1', group: 'write' });
  const recognize = createLessonModel(store, { lessonId: 'lesson-1', group: 'recognize' });
  const garden = createLessonModel(store, { lessonId: 'garden-2', group: 'recognize' });

  assert.equal(write.unit.title, '第一单元');
  assert.equal(write.lesson.title, '观潮');
  assert.equal(write.group, 'write');
  assert.equal(write.groups.write.count, 15);
  assert.equal(write.groups.write.available, true);
  assert.equal(write.groups.recognize.count, 13);
  assert.equal(write.groups.recognize.counted, 12);
  assert.equal(write.groups.recognize.reviews, 1);
  assert.deepEqual(write.entries[0], {
    character: '潮', pinyin: 'cháo', audioId: 'chao2', index: 0, isReview: false
  });
  assert.equal(recognize.entries[1].character, '薄');
  assert.equal(recognize.entries[1].isReview, true);
  assert.equal(Object.hasOwn(recognize.entries[1], 'audio'), false);
  assert.equal(garden.lesson.kind, 'garden');
  assert.equal(Object.hasOwn(garden.lesson, 'number'), false);
  assert.equal(garden.groups.write.available, false);
  assert.equal(garden.groups.write.count, 0);
  assert.ok(deepFrozen(write));
});

test('builds first, last, and review character models with real pinyin and strokes', async () => {
  const { createCharacterModel } = loadViews();
  const store = await createRuntimeStore();
  const first = createCharacterModel(store.resolve({
    lessonId: 'lesson-1', group: 'write', character: '潮'
  }));
  const last = createCharacterModel(store.resolve({
    lessonId: 'lesson-1', group: 'write', character: '余'
  }));
  const review = createCharacterModel(store.resolve({
    lessonId: 'lesson-1', group: 'recognize', character: '薄'
  }));

  assert.equal(first.character, '潮');
  assert.equal(first.pinyin, 'cháo');
  assert.equal(first.audioId, 'chao2');
  assert.equal(first.strokeCount, 15);
  assert.equal(first.index, 0);
  assert.equal(first.total, 15);
  assert.equal(first.previous, null);
  assert.equal(first.previousDisabled, true);
  assert.deepEqual(first.next, { character: '据', pinyin: 'jù' });
  assert.equal(first.nextDisabled, false);
  assert.equal(last.next, null);
  assert.equal(last.nextDisabled, true);
  assert.equal(review.isReview, true);
  assert.ok(deepFrozen(first));
});

test('models validate collaborators and selectors without accepting malformed input', async () => {
  const views = loadViews();
  const store = await createRuntimeStore();

  assert.throws(() => views.createDirectoryModel(null), /store/);
  assert.throws(() => views.createLessonModel(store, null), /options/);
  assert.throws(() => views.createLessonModel(store, { lessonId: 'missing', group: 'write' }), /lessonId/);
  assert.throws(() => views.createLessonModel(store, { lessonId: 'lesson-1', group: 'other' }), /group/);
  assert.throws(() => views.createCharacterModel(null), /resolved/);
  assert.throws(() => views.createCharacterModel({}), /resolved/);
});

test('lesson models reject declared counts that disagree with the returned entry arrays', async () => {
  const { createLessonModel } = loadViews();
  const store = await createRuntimeStore();
  const lesson = store.getLesson('lesson-1');
  const withLesson = (overrides) => ({
    getUnits: () => store.getUnits(),
    getUnit: (id) => store.getUnit(id),
    getLesson: (id) => (id === 'lesson-1' ? { ...lesson, ...overrides } : store.getLesson(id)),
    getEntries: (lessonId, group) => store.getEntries(lessonId, group)
  });

  assert.throws(
    () => createLessonModel(withLesson({ write: lesson.write + 1 }), {
      lessonId: 'lesson-1', group: 'write'
    }),
    /write.*match/i
  );
  assert.throws(
    () => createLessonModel(withLesson({ recognizeDisplayed: lesson.recognizeDisplayed + 1 }), {
      lessonId: 'lesson-1', group: 'recognize'
    }),
    /recognizeDisplayed.*match/i
  );
  assert.throws(
    () => createLessonModel(withLesson({ recognizeCounted: lesson.recognizeCounted + 1 }), {
      lessonId: 'lesson-1', group: 'recognize'
    }),
    /recognizeCounted.*polyphonicReviews.*match/i
  );
});

test('renders directory bands, accessible lesson actions, and a stable resume handle', async () => {
  const { createDirectoryModel, renderDirectory } = loadViews();
  const store = await createRuntimeStore();
  const { container } = createDom();
  const handle = renderDirectory(container, createDirectoryModel(store));

  assert.equal(container.childNodes.length, 1);
  assert.equal(byAttribute(container, 'data-view', 'directory').length, 1);
  assert.equal(byAttribute(container, 'data-unit-band', 'unit-1').length, 1);
  assert.equal(byAttribute(container, 'data-unit-band', 'unit-8').length, 1);
  assert.equal(byTag(container, 'h1').length, 1);
  assert.equal(byTag(container, 'section').length, 8);
  assert.equal(byTag(container, 'ul').length, 8);
  assert.equal(byTag(container, 'li').length, 31);
  byTag(container, 'section').forEach((section) => {
    assert.match(section.getAttribute('aria-labelledby'), /^unit-heading-/);
  });
  assert.equal(byAction(container, 'open-lesson').length, 31);
  const firstLesson = byAction(container, 'open-lesson')[0];
  assert.equal(firstLesson.getAttribute('data-lesson-id'), 'lesson-1');
  assert.equal(firstLesson.getAttribute('data-group'), 'write');
  assert.match(firstLesson.getAttribute('aria-label'), /1.*观潮.*会认13.*会写15/);
  assert.equal(byAttribute(container, 'data-view-heading', '')[0].getAttribute('tabindex'), '-1');
  assert.equal(handle.root, container.childNodes[0]);
  assert.equal(handle.resumeButton.getAttribute('hidden'), '');

  handle.setResumeAvailable(true);
  assert.equal(handle.resumeButton.hasAttribute('hidden'), false);
  handle.setResumeAvailable(false);
  assert.equal(handle.resumeButton.getAttribute('hidden'), '');
  assert.ok(Object.isFrozen(handle));
});

test('renders lesson segmented groups, review labels, character routes, and start action', async () => {
  const { createLessonModel, renderLesson } = loadViews();
  const store = await createRuntimeStore();
  const writeDom = createDom();
  const reviewDom = createDom();
  const gardenDom = createDom();
  const writeHandle = renderLesson(
    writeDom.container,
    createLessonModel(store, { lessonId: 'lesson-1', group: 'write' })
  );
  renderLesson(
    reviewDom.container,
    createLessonModel(store, { lessonId: 'lesson-1', group: 'recognize' })
  );
  renderLesson(
    gardenDom.container,
    createLessonModel(store, { lessonId: 'garden-2', group: 'recognize' })
  );

  const groupButtons = byAction(writeDom.container, 'select-group');
  assert.equal(byTag(writeDom.container, 'h1').length, 1);
  assert.equal(byAttribute(writeDom.container, 'role', 'group').length >= 1, true);
  assert.deepEqual(groupButtons.map((button) => button.getAttribute('data-group')), ['write', 'recognize']);
  assert.deepEqual(groupButtons.map((button) => button.getAttribute('aria-pressed')), ['true', 'false']);
  assert.equal(byAction(writeDom.container, 'go-directory').length, 1);
  assert.equal(byAction(writeDom.container, 'open-character').length, 16);
  assert.match(
    byAction(writeDom.container, 'open-character')[0].getAttribute('aria-label'),
    /^从第一个字开始学习.*潮.*cháo$/
  );
  const firstCard = byAction(writeDom.container, 'open-character')[1];
  assert.equal(firstCard.getAttribute('aria-label'), '潮，cháo');
  assert.equal(firstCard.getAttribute('data-character'), '潮');
  assert.equal(firstCard.getAttribute('data-lesson-id'), 'lesson-1');
  assert.equal(firstCard.getAttribute('data-group'), 'write');
  const reviewButton = byAction(reviewDom.container, 'open-character').find((button) => (
    button.getAttribute('data-character') === '薄' && button.textContent.includes('复习')
  ));
  assert.ok(reviewButton);
  assert.match(reviewButton.getAttribute('aria-label'), /复习/);
  assert.equal(byTag(writeDom.container, 'ul').length, 1);
  assert.equal(byTag(writeDom.container, 'li').length, 15);
  assert.equal(byAction(gardenDom.container, 'select-group')[0].getAttribute('disabled'), '');
  assert.equal(writeHandle.heading.getAttribute('data-view-heading'), '');
  assert.ok(Object.isFrozen(writeHandle));
});

test('renders character work surface and updates only coarse animation state', async () => {
  const { createCharacterModel, renderCharacter } = loadViews();
  const store = await createRuntimeStore();
  const model = createCharacterModel(store.resolve({
    lessonId: 'lesson-1', group: 'write', character: '潮'
  }));
  const { container } = createDom();
  const handle = renderCharacter(container, model);

  assert.equal(byAction(container, 'back-lesson').length, 1);
  assert.equal(byTag(container, 'h1').length, 1);
  assert.match(byAction(container, 'back-lesson')[0].getAttribute('aria-label'), /返回.*观潮/);
  assert.equal(byAction(container, 'play-audio').length, 1);
  assert.match(
    byAction(container, 'play-audio')[0].getAttribute('aria-label'),
    /^听读音.*潮.*cháo$/
  );
  assert.equal(byAction(container, 'previous-stroke').length, 1);
  assert.equal(byAction(container, 'toggle-play').length, 1);
  assert.equal(byAction(container, 'replay').length, 1);
  assert.equal(byAction(container, 'next-stroke').length, 1);
  assert.equal(byAction(container, 'set-speed').length, 3);
  assert.deepEqual(byAction(container, 'set-speed').map((button) => button.textContent), [
    '慢速', '适中', '快速'
  ]);
  assert.equal(byAttribute(container, 'data-slot', 'speed-group')[0].getAttribute('role'), 'group');
  assert.equal(byAction(container, 'previous-character').length, 1);
  assert.equal(byAction(container, 'next-character').length, 1);
  assert.equal(handle.board.getAttribute('data-slot'), 'character-board');
  assert.equal(handle.board.getAttribute('role'), 'img');
  assert.match(handle.board.getAttribute('aria-label'), /潮.*笔顺/);
  assert.match(byAttribute(container, 'data-slot', 'character-position')[0].textContent, /第 1 个，共 15 个/);
  assert.equal(byAttribute(container, 'data-slot', 'board-error')[0].getAttribute('hidden'), '');
  assert.equal(byAttribute(container, 'data-slot', 'audio-feedback')[0].getAttribute('hidden'), '');
  assert.equal(byAttribute(container, 'data-slot', 'audio-feedback')[0].getAttribute('aria-live'), null);
  assert.equal(byAttribute(container, 'data-slot', 'animation-status')[0].getAttribute('aria-live'), null);
  assert.equal(byAction(container, 'previous-stroke')[0].getAttribute('disabled'), '');
  assert.equal(byAction(container, 'toggle-play')[0].textContent, '▶');
  assert.equal(byAction(container, 'toggle-play')[0].childNodes[0].getAttribute('aria-hidden'), 'true');

  handle.setAnimationState({
    status: 'playing', mode: 'continuous', strokeIndex: 4, progress: 0.25, speed: 'fast'
  });
  const status = byAttribute(container, 'data-slot', 'animation-status')[0];
  assert.match(status.textContent, /正在书写.*第 5 \/ 15 笔.*连续播放/);
  assert.equal(byAction(container, 'toggle-play')[0].textContent, '⏸');
  assert.equal(byAction(container, 'toggle-play')[0].getAttribute('aria-label'), '暂停笔顺');
  assert.equal(byAction(container, 'set-speed')[2].getAttribute('aria-pressed'), 'true');
  assert.equal(byAction(container, 'previous-stroke')[0].hasAttribute('disabled'), false);
  const writes = descendants(container).reduce((sum, element) => sum + element.attributeWrites, 0);

  handle.setAnimationState({
    status: 'playing', mode: 'continuous', strokeIndex: 4, progress: 0.75, speed: 'fast'
  });
  assert.equal(
    descendants(container).reduce((sum, element) => sum + element.attributeWrites, 0),
    writes
  );

  handle.setAnimationState({
    status: 'completed', mode: 'continuous', strokeIndex: 14, progress: 1, speed: 'fast'
  });
  assert.equal(byAction(container, 'toggle-play')[0].textContent, '⏸');
  assert.equal(byAction(container, 'toggle-play')[0].getAttribute('aria-label'), '暂停笔顺');

  handle.setAnimationState({
    status: 'completed', mode: 'step', strokeIndex: 14, progress: 1, speed: 'slow'
  });
  assert.match(status.textContent, /书写完成.*单笔练习/);
  assert.equal(byAction(container, 'next-stroke')[0].getAttribute('disabled'), '');
  assert.equal(byAction(container, 'set-speed')[0].getAttribute('aria-pressed'), 'true');
  assert.ok(Object.isFrozen(handle));
});

test('updates audio feedback and keeps pronunciation and character navigation after board failure', async () => {
  const { createCharacterModel, renderCharacter } = loadViews();
  const store = await createRuntimeStore();
  const model = createCharacterModel(store.resolve({
    lessonId: 'lesson-1', group: 'write', character: '潮'
  }));
  const { container } = createDom();
  const handle = renderCharacter(container, model);
  const audioButton = byAction(container, 'play-audio')[0];
  const feedback = byAttribute(container, 'data-slot', 'audio-feedback')[0];

  handle.setAudioState('loading');
  assert.equal(audioButton.getAttribute('disabled'), '');
  assert.equal(audioButton.getAttribute('aria-busy'), 'true');
  assert.equal(feedback.hasAttribute('hidden'), false);
  assert.equal(feedback.textContent, '正在准备读音…');
  handle.setAudioState('ready');
  assert.equal(audioButton.hasAttribute('disabled'), false);
  assert.equal(audioButton.hasAttribute('aria-busy'), false);
  assert.equal(feedback.getAttribute('hidden'), '');
  handle.setAudioState('unavailable');
  assert.equal(feedback.textContent, '该字读音暂不可用');
  handle.setAudioState('error');
  assert.equal(feedback.textContent, '读音播放失败');
  assert.equal(audioButton.hasAttribute('disabled'), false);

  handle.showBoardError();
  assert.match(handle.board.textContent, /该字数据待补充/);
  assert.equal(byAttribute(container, 'data-slot', 'board-error')[0].hasAttribute('hidden'), false);
  ['previous-stroke', 'toggle-play', 'replay', 'next-stroke', 'set-speed'].forEach((action) => {
    byAction(container, action).forEach((button) => assert.equal(button.getAttribute('disabled'), ''));
  });
  assert.equal(byAction(container, 'play-audio').length, 1);
  assert.equal(byAction(container, 'next-character').length, 1);
  assert.throws(() => handle.setAudioState('bad'), /audio state/);
  assert.throws(() => handle.setAnimationState({ status: 'bad' }), /animation state/);
});

test('uses a classic browser merge without reading the DOM at module load', async () => {
  const source = await readFile(new URL('../js/views.js', import.meta.url), 'utf8');
  const prior = function prior() {};
  const context = { window: { HanziApp: { prior } } };

  vm.runInNewContext(source, context, { filename: 'js/views.js' });

  assert.equal(context.window.HanziApp.prior, prior);
  assert.equal(typeof context.window.HanziApp.createDirectoryModel, 'function');
  assert.equal(typeof context.window.HanziApp.renderCharacter, 'function');
});

test('index is offline-first, accessible, and loads classic scripts in dependency order', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const scripts = Array.from(html.matchAll(/<script defer src="([^"]+)"><\/script>/g), (match) => match[1]);

  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1"/);
  assert.match(html, /<body>\s*<a class="skip-link" href="#app">跳到学习内容<\/a>/);
  assert.match(html, /class="brand-name">汉字追踪小课堂<\//);
  assert.match(html, /人教版四年级上册·2019年审定/);
  assert.match(html, /<main id="app" tabindex="-1"><\/main>/);
  assert.match(html, /id="announcer" class="visually-hidden" role="status" aria-live="polite" aria-atomic="true"/);
  assert.doesNotMatch(html, /id="announcer"[^>]*\shidden(?:\s|=|>)/);
  assert.match(html, /<noscript>/);
  assert.match(html, /<link rel="stylesheet" href="styles\.css">/);
  assert.deepEqual(scripts, [
    'data/library-data.js',
    'js/data-store.js',
    'js/router.js',
    'js/svg-renderer.js',
    'js/animation-controller.js',
    'js/audio-controller.js',
    'js/views.js'
  ]);
  assert.doesNotMatch(html, /https?:\/\//i);
  assert.doesNotMatch(html, /type="module"/i);
});

test('styles define the responsive bright-classroom system without unsafe visual patterns', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

  assert.match(css, /--sky:\s*#eaf2f8/i);
  assert.match(css, /--tracking-red:/i);
  assert.match(css, /--sunny-yellow:/i);
  assert.match(css, /min-height:\s*44px/i);
  assert.match(css, /min-width:\s*44px/i);
  assert.match(css, /grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(76px,\s*96px\)\)/i);
  assert.match(css, /aspect-ratio:\s*1(?:\s*\/\s*1)?/i);
  assert.match(css, /width:\s*min\(100%,\s*620px\)/i);
  assert.match(css, /@media\s*\(min-width:\s*760px\)/i);
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1\.15fr\)\s+minmax\(260px,\s*\.85fr\)/i);
  assert.match(css, /max-width:\s*1120px/i);
  assert.match(css, /focus-visible/i);
  assert.match(css, /touch-action:\s*manipulation/i);
  assert.match(css, /prefers-reduced-motion:\s*reduce/i);
  assert.match(css, /overflow-wrap:\s*anywhere/i);
  assert.match(css, /\.visually-hidden\s*\{/i);
  assert.match(css, /\.skip-link:focus-visible/i);
  assert.match(css, /min-width:\s*0/i);
  assert.doesNotMatch(css, /gradient\s*\(/i);
  assert.doesNotMatch(css, /(?:^|[^a-z-])-?\d*\.?\d+vw\b/im);
  assert.doesNotMatch(css, /letter-spacing:\s*-/i);
  assert.doesNotMatch(css, /border-radius:\s*(?:[9-9]|[1-9]\d)px/i);
  assert.match(
    css,
    /\.character-grid\s*\{[^}]*padding:\s*0[^}]*margin:\s*0[^}]*list-style:\s*none/is
  );
  assert.match(
    css,
    /\.character-card:hover:not\(:disabled\)\s*\{[^}]*border-color:\s*var\(--action-blue\)/is
  );
  assert.doesNotMatch(
    css,
    /\.character-card:hover:not\(:disabled\)\s*\{[^}]*var\(--tracking-red\)/is
  );
  assert.doesNotMatch(css, /\.back-button\s*\{[^}]*margin:\s*-/is);
});
