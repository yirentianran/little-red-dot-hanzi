import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

import dataStoreModule from '../js/data-store.js';
import practiceProgressModule from '../js/practice-progress-store.js';
import practiceSessionModule from '../js/practice-session.js';

const require = createRequire(import.meta.url);
const { createDataStore } = dataStoreModule;
const { createPracticeProgressStore } = practiceProgressModule;
const { createPracticeSession } = practiceSessionModule;

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

function practiceSnapshot(overrides = {}) {
  return {
    characters: {},
    group: null,
    ...overrides
  };
}

const LESSON_ONE_WRITE_CHARACTERS = Object.freeze([
  '宵', '宴', '扇', '崭', '渗', '凿', '蛛', '焰', '缚', '瞅', '蜘', '僵', '讶', '苏', '驻'
]);

function sessionState(overrides = {}) {
  return {
    status: 'active',
    phase: 'guided',
    character: '宵',
    index: 0,
    total: 15,
    mistakes: 0,
    newlyMasteredCount: 0,
    completedCharacters: [],
    remainingCharacters: LESSON_ONE_WRITE_CHARACTERS.slice(),
    needsPracticeCharacters: [],
    masteredCount: 0,
    ...overrides
  };
}

test('exports the complete frozen view API', () => {
  const views = loadViews();

  assert.deepEqual(Object.keys(views).sort(), [
    'createCharacterModel',
    'createDirectoryModel',
    'createLessonModel',
    'createPracticeModel',
    'renderCharacter',
    'renderDirectory',
    'renderLesson',
    'renderPractice'
  ]);
  assert.ok(Object.isFrozen(views));
});

test('builds an immutable stage directory from the independent catalog', async () => {
  const { createDirectoryModel } = loadViews();
  const store = await createRuntimeStore();
  const before = store.getUnits();
  const model = createDirectoryModel(store);
  const first = model.units[0].lessons[0];

  assert.equal(model.units.length, 1);
  assert.deepEqual(
    {
      kind: first.kind,
      id: first.id,
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
      kind: 'garden',
      id: 'g4f-01',
      title: '第1组',
      recognize: 0,
      recognizeDisplayed: 0,
      recognizeCounted: 0,
      polyphonicReviews: 0,
      write: 15,
      total: 15,
      defaultGroup: 'write'
    }
  );
  assert.equal(first.total, first.recognize + first.write);
  assert.equal(store.getUnits(), before);
  assert.ok(deepFrozen(model));
});

test('builds learning and unavailable supplemental group models', async () => {
  const { createLessonModel } = loadViews();
  const store = await createRuntimeStore();
  const write = createLessonModel(store, { lessonId: 'g4f-01', group: 'write' });
  const recognize = createLessonModel(store, { lessonId: 'g4f-01', group: 'recognize' });
  const second = createLessonModel(store, { lessonId: 'g4f-02', group: 'write' });

  assert.equal(write.unit.title, '四年级上阶段');
  assert.equal(write.lesson.title, '第1组');
  assert.equal(write.group, 'write');
  assert.equal(write.groups.write.count, 15);
  assert.equal(write.groups.write.available, true);
  assert.equal(write.groups.recognize.count, 0);
  assert.equal(write.groups.recognize.counted, 0);
  assert.equal(write.groups.recognize.reviews, 0);
  assert.deepEqual(write.entries[0], {
    character: '宵', pinyin: 'xiāo', audioId: 'xiao1', index: 0, isReview: false,
    mastered: false, completedHere: false
  });
  assert.deepEqual(write.practice, { completed: 0, mastered: 0, total: 15 });
  assert.deepEqual(recognize.entries, []);
  assert.equal(recognize.groups.recognize.available, false);
  assert.equal(second.lesson.kind, 'garden');
  assert.equal(Object.hasOwn(second.lesson, 'number'), false);
  assert.equal(second.groups.write.available, true);
  assert.ok(deepFrozen(write));
});

test('builds first and last character models with real pinyin and strokes', async () => {
  const { createCharacterModel } = loadViews();
  const store = await createRuntimeStore();
  const first = createCharacterModel(store.resolve({
    lessonId: 'g4f-01', group: 'write', character: '宵'
  }));
  const last = createCharacterModel(store.resolve({
    lessonId: 'g4f-01', group: 'write', character: '驻'
  }));

  assert.equal(first.character, '宵');
  assert.equal(first.pinyin, 'xiāo');
  assert.equal(first.audioId, 'xiao1');
  assert.deepEqual(first.words, ['元宵', '宵夜']);
  assert.ok(Object.isFrozen(first.words));
  assert.equal(first.strokeCount, 10);
  assert.equal(first.index, 0);
  assert.equal(first.total, 15);
  assert.equal(first.previous, null);
  assert.equal(first.previousDisabled, true);
  assert.deepEqual(first.next, { character: '宴', pinyin: 'yàn' });
  assert.equal(first.nextDisabled, false);
  assert.equal(last.next, null);
  assert.equal(last.nextDisabled, true);
  assert.equal(first.mastered, false);
  assert.equal(first.completedHere, false);
  assert.ok(deepFrozen(first));
});

test('lesson practice snapshots add independent completed and mastered state without mutation', async () => {
  const { createLessonModel } = loadViews();
  const store = await createRuntimeStore();
  const characters = Object.create(null);
  characters['宵'] = { attemptCount: 2, lastOutcome: 'mastered', mastered: true };
  characters['宴'] = { attemptCount: 1, lastOutcome: 'needs-practice', mastered: false };
  const practice = practiceSnapshot({
    characters,
    group: {
      completedCharacters: ['宵', '宴'],
      remainingCharacters: [],
      needsPracticeCharacters: ['宴'],
      currentCharacter: null,
      currentPhase: null
    }
  });
  const beforeCompleted = practice.group.completedCharacters.slice();

  const model = createLessonModel(
    store,
    { lessonId: 'g4f-01', group: 'write' },
    practice
  );

  assert.deepEqual(model.practice, { completed: 2, mastered: 1, total: 15 });
  assert.deepEqual(
    model.entries.slice(0, 3).map(({ character, mastered, completedHere }) => ({
      character, mastered, completedHere
    })),
    [
      { character: '宵', mastered: true, completedHere: true },
      { character: '宴', mastered: false, completedHere: true },
      { character: '扇', mastered: false, completedHere: false }
    ]
  );
  assert.deepEqual(practice.group.completedCharacters, beforeCompleted);
  assert.notEqual(model.practice, practice.group);
  assert.ok(deepFrozen(model));
});

test('character practice state defaults safely and remains independent when provided', async () => {
  const { createCharacterModel } = loadViews();
  const store = await createRuntimeStore();
  const resolved = store.resolve({ lessonId: 'g4f-01', group: 'write', character: '宵' });
  const defaults = createCharacterModel(resolved);
  const completedOnly = createCharacterModel(resolved, practiceSnapshot({
    characters: { '宵': { mastered: false } },
    group: { completedCharacters: ['宵'] }
  }));
  const masteredOnly = createCharacterModel(resolved, practiceSnapshot({
    characters: { '宵': { mastered: true } },
    group: { completedCharacters: [] }
  }));

  assert.equal(defaults.mastered, false);
  assert.equal(defaults.completedHere, false);
  assert.deepEqual(
    { mastered: completedOnly.mastered, completedHere: completedOnly.completedHere },
    { mastered: false, completedHere: true }
  );
  assert.deepEqual(
    { mastered: masteredOnly.mastered, completedHere: masteredOnly.completedHere },
    { mastered: true, completedHere: false }
  );
});

test('models validate collaborators and selectors without accepting malformed input', async () => {
  const views = loadViews();
  const store = await createRuntimeStore();

  assert.throws(() => views.createDirectoryModel(null), /store/);
  assert.throws(() => views.createLessonModel(store, null), /options/);
  assert.throws(() => views.createLessonModel(store, { lessonId: 'missing', group: 'write' }), /lessonId/);
  assert.throws(() => views.createLessonModel(store, { lessonId: 'g4f-01', group: 'other' }), /group/);
  assert.throws(() => views.createCharacterModel(null), /resolved/);
  assert.throws(() => views.createCharacterModel({}), /resolved/);
});

test('lesson models reject declared counts that disagree with the returned entry arrays', async () => {
  const { createLessonModel } = loadViews();
  const store = await createRuntimeStore();
  const lesson = store.getLesson('g4f-01');
  const withLesson = (overrides) => ({
    getUnits: () => store.getUnits(),
    getUnit: (id) => store.getUnit(id),
    getLesson: (id) => (id === 'g4f-01' ? { ...lesson, ...overrides } : store.getLesson(id)),
    getEntries: (lessonId, group) => store.getEntries(lessonId, group)
  });

  assert.throws(
    () => createLessonModel(withLesson({ write: lesson.write + 1 }), {
      lessonId: 'g4f-01', group: 'write'
    }),
    /write.*match/i
  );
  assert.throws(
    () => createLessonModel(withLesson({ recognizeDisplayed: lesson.recognizeDisplayed + 1 }), {
      lessonId: 'g4f-01', group: 'recognize'
    }),
    /recognizeDisplayed.*match/i
  );
  assert.throws(
    () => createLessonModel(withLesson({ recognizeCounted: lesson.recognizeCounted + 1 }), {
      lessonId: 'g4f-01', group: 'recognize'
    }),
    /recognizeCounted.*polyphonicReviews.*match/i
  );
});

test('creates exact frozen practice models for active, retry, and complete sessions', async () => {
  const { createPracticeModel } = loadViews();
  const store = await createRuntimeStore();
  const resolved = {
    ...store.resolve({ lessonId: 'g4f-01', group: 'write', character: '宵' }),
    scope: 'group'
  };
  const activeState = sessionState();
  const active = createPracticeModel(resolved, activeState, true);
  const retry = createPracticeModel(resolved, sessionState({
    status: 'needs-retry',
    phase: 'independent',
    mistakes: 2,
    completedCharacters: ['宵'],
    remainingCharacters: ['宵', '宴'],
    total: 2,
    masteredCount: 0
  }), true);
  const needsPracticeCharacters = ['宴'];
  const complete = createPracticeModel(resolved, sessionState({
    status: 'complete',
    phase: null,
    character: null,
    index: 15,
    mistakes: 0,
    completedCharacters: LESSON_ONE_WRITE_CHARACTERS.slice(),
    remainingCharacters: [],
    needsPracticeCharacters,
    masteredCount: 1
  }), false);

  assert.deepEqual(active, {
    unit: { id: 'g4-fall', title: '四年级上阶段' },
    lesson: { kind: 'garden', id: 'g4f-01', title: '第1组' },
    group: 'write',
    scope: 'group',
    character: '宵',
    pinyin: 'xiāo',
    strokeCount: 10,
    groupIndex: 0,
    groupTotal: 15,
    previous: null,
    next: { character: '宴', pinyin: 'yàn' },
    status: 'active',
    phase: 'guided',
    index: 0,
    total: 15,
    mistakes: 0,
    completedCount: 0,
    masteredCount: 0,
    newlyMasteredCount: 0,
    needsPracticeCharacters: [],
    persistent: true
  });
  assert.equal(retry.status, 'needs-retry');
  assert.equal(retry.phase, 'independent');
  assert.equal(retry.completedCount, 1);
  assert.equal(retry.mistakes, 2);
  assert.deepEqual(complete, {
    unit: { id: 'g4-fall', title: '四年级上阶段' },
    lesson: { kind: 'garden', id: 'g4f-01', title: '第1组' },
    group: 'write',
    scope: 'group',
    character: '宵',
    pinyin: 'xiāo',
    strokeCount: 10,
    groupIndex: 0,
    groupTotal: 15,
    previous: null,
    next: { character: '宴', pinyin: 'yàn' },
    status: 'complete',
    phase: null,
    index: 15,
    total: 15,
    mistakes: 0,
    completedCount: 15,
    masteredCount: 1,
    newlyMasteredCount: 0,
    needsPracticeCharacters: ['宴'],
    persistent: false
  });
  assert.ok(deepFrozen(active));
  assert.ok(deepFrozen(retry));
  assert.ok(deepFrozen(complete));
  assert.notEqual(complete.needsPracticeCharacters, needsPracticeCharacters);

  activeState.completedCharacters.push('宴');
  needsPracticeCharacters.push('宵');
  assert.equal(active.completedCount, 0);
  assert.deepEqual(complete.needsPracticeCharacters, ['宴']);
});

test('practice models use session positions for filtered group review rounds', async () => {
  const { createPracticeModel } = loadViews();
  const store = await createRuntimeStore();
  const resolved = {
    ...store.resolve({ lessonId: 'g4f-01', group: 'write', character: '宴' }),
    scope: 'group'
  };

  const model = createPracticeModel(resolved, sessionState({
    character: '宴',
    index: 0,
    total: 1,
    remainingCharacters: ['宴']
  }), true);

  assert.equal(resolved.index, 1);
  assert.equal(resolved.total, 15);
  assert.equal(model.index, 0);
  assert.equal(model.total, 1);
});

test('practice state consistency follows session queue and completion invariants', async () => {
  const { createPracticeModel } = loadViews();
  const store = await createRuntimeStore();
  const resolve = (character, scope = 'group') => ({
    ...store.resolve({ lessonId: 'g4f-01', group: 'write', character }),
    scope
  });

  const overlapping = createPracticeModel(resolve('宵'), sessionState({
    phase: 'independent',
    completedCharacters: ['宵']
  }), true);
  assert.equal(overlapping.index, 0);
  assert.equal(overlapping.completedCount, 1);

  assert.throws(() => createPracticeModel(resolve('宵'), sessionState({
    completedCharacters: ['宴']
  }), true), TypeError);
  assert.throws(() => createPracticeModel(resolve('宵'), sessionState({
    phase: 'independent',
    completedCharacters: ['宵', '宴']
  }), true), TypeError);
  assert.throws(() => createPracticeModel(resolve('宵'), sessionState({
    completedCharacters: ['宵']
  }), true), TypeError);
  assert.throws(() => createPracticeModel(resolve('宵'), sessionState({
    phase: 'independent',
    completedCharacters: ['宵'],
    needsPracticeCharacters: ['宵']
  }), true), TypeError);

  assert.throws(() => createPracticeModel(resolve('宴'), sessionState({
    character: '宴',
    completedCharacters: ['宵'],
    remainingCharacters: LESSON_ONE_WRITE_CHARACTERS.slice(1),
    index: 0
  }), true), TypeError);
  assert.throws(() => createPracticeModel(resolve('宴'), sessionState({
    character: '宴',
    completedCharacters: [],
    remainingCharacters: LESSON_ONE_WRITE_CHARACTERS.slice(),
    index: 0
  }), true), TypeError);
  assert.throws(() => createPracticeModel(resolve('宵'), sessionState({
    completedCharacters: [],
    remainingCharacters: LESSON_ONE_WRITE_CHARACTERS.slice(0, -1)
  }), true), TypeError);
  assert.throws(() => createPracticeModel(resolve('宵'), sessionState({
    needsPracticeCharacters: ['宴']
  }), true), TypeError);
  assert.throws(() => createPracticeModel(resolve('宵'), sessionState({
    status: 'needs-retry',
    phase: 'independent',
    mistakes: 1,
    completedCharacters: ['宴']
  }), true), TypeError);
  assert.throws(() => createPracticeModel(resolve('宵'), sessionState({
    status: 'complete',
    phase: null,
    character: null,
    index: 15,
    completedCharacters: LESSON_ONE_WRITE_CHARACTERS.slice(0, -1),
    remainingCharacters: []
  }), true), TypeError);
  assert.throws(() => createPracticeModel(resolve('宵'), sessionState({
    status: 'complete',
    phase: null,
    character: null,
    index: 1,
    total: 1,
    completedCharacters: ['宴'],
    remainingCharacters: []
  }), true), TypeError);
  assert.throws(() => createPracticeModel(resolve('宵', 'single'), sessionState({
    total: 1,
    completedCharacters: ['宵'],
    remainingCharacters: ['宵'],
    needsPracticeCharacters: ['宵']
  }), true), TypeError);
});

test('practice models accept real session snapshots across retry, defer, completion, and filters', async () => {
  const { createPracticeModel } = loadViews();
  const store = await createRuntimeStore();
  const entries = store.getEntries('g4f-01', 'write').slice(0, 2);
  const progress = createPracticeProgressStore(null);
  const session = createPracticeSession({
    lessonId: 'g4f-01',
    group: 'write',
    scope: 'group',
    entries,
    startCharacter: '宵',
    progress
  });
  const models = [];
  const capture = () => {
    const state = session.getState();
    const stableCharacter = state.character
      || state.completedCharacters[state.completedCharacters.length - 1];
    const resolved = {
      ...store.resolve({
        lessonId: 'g4f-01', group: 'write', character: stableCharacter
      }),
      scope: 'group'
    };
    const masteredCount = entries.filter((entry) => (
      progress.getCharacter(entry.character).mastered
    )).length;
    const model = createPracticeModel(resolved, { ...state, masteredCount }, false);
    models.push(model);
    return model;
  };

  assert.deepEqual(
    { status: capture().status, phase: models.at(-1).phase, index: models.at(-1).index },
    { status: 'active', phase: 'guided', index: 0 }
  );
  session.completeCharacter({ totalMistakes: 0 });
  assert.equal(capture().phase, 'independent');
  session.completeCharacter({ totalMistakes: 2 });
  assert.deepEqual(
    { status: capture().status, completed: models.at(-1).completedCount },
    { status: 'needs-retry', completed: 1 }
  );
  session.retry();
  assert.deepEqual(
    { status: capture().status, phase: models.at(-1).phase },
    { status: 'active', phase: 'independent' }
  );
  session.completeCharacter({ totalMistakes: 0 });
  assert.deepEqual(
    { character: capture().character, index: models.at(-1).index },
    { character: '宴', index: 1 }
  );
  session.completeCharacter({ totalMistakes: 0 });
  capture();
  session.completeCharacter({ totalMistakes: 1 });
  assert.equal(capture().status, 'needs-retry');
  session.defer();
  assert.deepEqual(
    {
      status: capture().status,
      completed: models.at(-1).completedCount,
      needs: models.at(-1).needsPracticeCharacters
    },
    { status: 'complete', completed: 2, needs: ['宴'] }
  );

  const filteredProgress = createPracticeProgressStore(null);
  const filtered = createPracticeSession({
    lessonId: 'g4f-01',
    group: 'write',
    scope: 'group',
    entries: store.getEntries('g4f-01', 'write').slice(1, 3),
    startCharacter: '宴',
    progress: filteredProgress,
    resume: false
  });
  const filteredState = filtered.getState();
  const filteredModel = createPracticeModel({
    ...store.resolve({ lessonId: 'g4f-01', group: 'write', character: '宴' }),
    scope: 'group'
  }, { ...filteredState, masteredCount: 0 }, false);
  assert.deepEqual(
    { character: filteredModel.character, index: filteredModel.index, total: filteredModel.total },
    { character: '宴', index: 0, total: 2 }
  );
});

test('practice model and progress inputs reject hostile or inconsistent structures without getters', async () => {
  const { createCharacterModel, createLessonModel, createPracticeModel } = loadViews();
  const store = await createRuntimeStore();
  const resolved = {
    ...store.resolve({ lessonId: 'g4f-01', group: 'write', character: '宵' }),
    scope: 'group'
  };
  let getterCalls = 0;
  const accessorState = sessionState();
  Object.defineProperty(accessorState, 'masteredCount', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 0;
    }
  });
  const accessorCharacters = {};
  Object.defineProperty(accessorCharacters, '宵', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return { mastered: true };
    }
  });
  const symbolState = sessionState();
  symbolState[Symbol('hostile')] = true;
  const spoofedPrototype = Object.create(null);
  const SpoofedObject = function Object() {};
  SpoofedObject.prototype = spoofedPrototype;
  spoofedPrototype.constructor = SpoofedObject;
  const spoofedState = Object.assign(Object.create(spoofedPrototype), sessionState());
  const mismatchedResolved = {
    ...resolved,
    entry: { ...resolved.entry, pinyin: 'cuò' }
  };
  const missingPinyinEntries = resolved.entries.map((entry, index) => (
    index === 1 ? { character: entry.character } : entry
  ));

  assert.throws(() => createPracticeModel(resolved, accessorState, true), TypeError);
  assert.throws(() => createLessonModel(store, {
    lessonId: 'g4f-01', group: 'write'
  }, practiceSnapshot({ characters: accessorCharacters })), TypeError);
  assert.throws(() => createCharacterModel(resolved, {
    ...practiceSnapshot(),
    [Symbol('hostile')]: true
  }), TypeError);
  assert.equal(getterCalls, 0);
  assert.throws(() => createPracticeModel(resolved, Object.create(sessionState()), true), TypeError);
  assert.throws(() => createPracticeModel(resolved, symbolState, true), TypeError);
  assert.throws(() => createPracticeModel(resolved, spoofedState, true), TypeError);
  assert.throws(() => createPracticeModel(mismatchedResolved, sessionState(), true), TypeError);
  assert.throws(() => createPracticeModel({
    ...resolved, entries: missingPinyinEntries
  }, sessionState(), true), TypeError);
  assert.throws(() => createPracticeModel(resolved, sessionState({
    completedCharacters: ['宵', '宵']
  }), true), TypeError);
  assert.throws(() => createPracticeModel(resolved, sessionState({
    completedCharacters: new Array(1)
  }), true), TypeError);
  assert.throws(() => createPracticeModel(resolved, sessionState({
    completedCharacters: ['宴', '宵']
  }), true), TypeError);
  assert.throws(() => createPracticeModel(resolved, sessionState({
    needsPracticeCharacters: ['龘']
  }), true), TypeError);
  assert.throws(() => createPracticeModel(resolved, sessionState({ phase: null }), true), TypeError);
  assert.throws(() => createPracticeModel(resolved, sessionState({ character: '宴' }), true), TypeError);
  assert.throws(() => createPracticeModel(resolved, sessionState({
    status: 'needs-retry', phase: 'independent', mistakes: 0
  }), true), TypeError);
  assert.throws(() => createPracticeModel(resolved, sessionState({
    status: 'complete', phase: null, character: null, remainingCharacters: []
  }), true), TypeError);
  assert.throws(() => createPracticeModel(resolved, sessionState({ masteredCount: 16 }), true), TypeError);
  assert.throws(() => createPracticeModel(resolved, sessionState(), 'yes'), TypeError);
});

test('renders directory bands, accessible lesson actions, and a stable resume handle', async () => {
  const { createDirectoryModel, renderDirectory } = loadViews();
  const store = await createRuntimeStore();
  const { container } = createDom();
  const handle = renderDirectory(container, createDirectoryModel(store));

  assert.equal(container.childNodes.length, 1);
  assert.equal(byAttribute(container, 'data-view', 'directory').length, 1);
  assert.equal(byAttribute(container, 'data-unit-band', 'g4-fall').length, 1);
  assert.equal(byAttribute(container, 'data-unit-band', 'missing').length, 0);
  assert.equal(byTag(container, 'h1').length, 1);
  assert.equal(byTag(container, 'section').length, 1);
  assert.equal(byTag(container, 'ul').length, 1);
  assert.equal(byTag(container, 'li').length, 15);
  byTag(container, 'section').forEach((section) => {
    assert.match(section.getAttribute('aria-labelledby'), /^unit-heading-/);
  });
  assert.equal(byAction(container, 'open-lesson').length, 15);
  const firstLesson = byAction(container, 'open-lesson')[0];
  assert.equal(firstLesson.getAttribute('data-lesson-id'), 'g4f-01');
  assert.equal(firstLesson.getAttribute('data-group'), 'write');
  assert.match(firstLesson.getAttribute('aria-label'), /第1组.*15个字/);
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
  const supplementalDom = createDom();
  const writeHandle = renderLesson(
    writeDom.container,
    createLessonModel(store, { lessonId: 'g4f-01', group: 'write' })
  );
  renderLesson(
    reviewDom.container,
    createLessonModel(store, { lessonId: 'g4f-01', group: 'recognize' })
  );
  renderLesson(
    supplementalDom.container,
    createLessonModel(store, { lessonId: 'g4f-01', group: 'recognize' })
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
    /^从第一个字开始学习.*宵.*xiāo$/
  );
  const firstCard = byAction(writeDom.container, 'open-character')[1];
  assert.equal(firstCard.getAttribute('aria-label'), '宵，xiāo');
  assert.equal(firstCard.getAttribute('data-character'), '宵');
  assert.equal(firstCard.getAttribute('data-lesson-id'), 'g4f-01');
  assert.equal(firstCard.getAttribute('data-group'), 'write');
  assert.equal(byAction(reviewDom.container, 'open-character').length, 0);
  assert.equal(byTag(writeDom.container, 'ul').length, 1);
  assert.equal(byTag(writeDom.container, 'li').length, 15);
  assert.equal(byAction(supplementalDom.container, 'start-group-practice')[0].getAttribute('disabled'), '');
  assert.equal(writeHandle.heading.getAttribute('data-view-heading'), '');
  assert.ok(Object.isFrozen(writeHandle));
});

test('renders group practice summaries, actions, and independent card states in both groups', async () => {
  const { createLessonModel, renderLesson } = loadViews();
  const store = await createRuntimeStore();
  const writeDom = createDom();
  const recognizeDom = createDom();
  const gardenDom = createDom();
  renderLesson(writeDom.container, createLessonModel(
    store,
    { lessonId: 'g4f-01', group: 'write' },
    practiceSnapshot({
      characters: { '宵': { mastered: true }, '宴': { mastered: false } },
      group: { completedCharacters: ['宵', '宴'] }
    })
  ));
  renderLesson(recognizeDom.container, createLessonModel(
    store,
    { lessonId: 'g4f-01', group: 'recognize' },
    practiceSnapshot()
  ));
  renderLesson(gardenDom.container, createLessonModel(
    store,
    { lessonId: 'g4f-02', group: 'recognize' },
    practiceSnapshot()
  ));

  const writePractice = byAction(writeDom.container, 'start-group-practice')[0];
  assert.equal(writePractice.getAttribute('data-lesson-id'), 'g4f-01');
  assert.equal(writePractice.getAttribute('data-group'), 'write');
  assert.equal(writePractice.textContent, '练习本组');
  assert.match(writeDom.container.textContent, /本组已完成 2 \/ 15/);
  assert.match(writeDom.container.textContent, /当前掌握 1 个/);
  const masteredCard = byAction(writeDom.container, 'open-character').find((button) => (
    button.getAttribute('class') === 'character-card'
      && button.getAttribute('data-character') === '宵'
  ));
  const completedOnlyCard = byAction(writeDom.container, 'open-character').find((button) => (
    button.getAttribute('class') === 'character-card'
      && button.getAttribute('data-character') === '宴'
  ));
  assert.equal(masteredCard.getAttribute('data-practice-mastered'), 'true');
  assert.equal(masteredCard.getAttribute('data-practice-completed-here'), 'true');
  assert.match(masteredCard.getAttribute('aria-label'), /已掌握/);
  assert.equal(byAttribute(masteredCard, 'aria-hidden', 'true').some((item) => item.textContent === '✓'), true);
  assert.equal(completedOnlyCard.getAttribute('data-practice-mastered'), 'false');
  assert.equal(completedOnlyCard.getAttribute('data-practice-completed-here'), 'true');
  assert.doesNotMatch(completedOnlyCard.getAttribute('aria-label'), /已掌握/);
  assert.match(completedOnlyCard.getAttribute('aria-label'), /本组已完成/);
  assert.equal(byTag(writeDom.container, 'section').some((element) => (
    element.getAttribute('class') === 'lesson-practice-summary'
  )), true);

  assert.equal(byAction(recognizeDom.container, 'open-character').length, 0);
  assert.equal(byAction(recognizeDom.container, 'start-group-practice')[0].getAttribute('disabled'), '');
  assert.equal(byAction(gardenDom.container, 'start-group-practice')[0].getAttribute('disabled'), '');
});

test('renders character work surface and updates only coarse animation state', async () => {
  const { createCharacterModel, renderCharacter } = loadViews();
  const store = await createRuntimeStore();
  const model = createCharacterModel(store.resolve({
    lessonId: 'g4f-01', group: 'write', character: '宵'
  }));
  const { container } = createDom();
  const handle = renderCharacter(container, model);

  assert.equal(byAction(container, 'back-lesson').length, 1);
  assert.equal(byTag(container, 'h1').length, 1);
  assert.match(byAction(container, 'back-lesson')[0].getAttribute('aria-label'), /返回.*第1组/);
  assert.equal(byAction(container, 'play-audio').length, 1);
  assert.match(
    byAction(container, 'play-audio')[0].getAttribute('aria-label'),
    /^听读音.*宵.*xiāo$/
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
  const vocabulary = byAttribute(container, 'data-slot', 'vocabulary-words');
  assert.equal(vocabulary.length, 1);
  assert.equal(vocabulary[0].textContent, '组词：元宵  宵夜');
  assert.equal(byAction(container, 'previous-character').length, 1);
  assert.equal(byAction(container, 'next-character').length, 1);
  assert.equal(handle.board.getAttribute('data-slot'), 'character-board');
  assert.equal(handle.board.getAttribute('role'), 'img');
  assert.match(handle.board.getAttribute('aria-label'), /宵.*笔顺/);
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
  assert.match(status.textContent, /正在书写.*第 5 \/ 10 笔.*连续播放/);
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
    status: 'completed', mode: 'continuous', strokeIndex: 9, progress: 1, speed: 'fast'
  });
  assert.equal(byAction(container, 'toggle-play')[0].textContent, '⏸');
  assert.equal(byAction(container, 'toggle-play')[0].getAttribute('aria-label'), '暂停笔顺');

  handle.setAnimationState({
    status: 'completed', mode: 'step', strokeIndex: 9, progress: 1, speed: 'slow'
  });
  assert.match(status.textContent, /书写完成.*单笔练习/);
  assert.equal(byAction(container, 'next-stroke')[0].getAttribute('disabled'), '');
  assert.equal(byAction(container, 'set-speed')[0].getAttribute('aria-pressed'), 'true');
  assert.ok(Object.isFrozen(handle));
});

test('renders single-character practice actions and status for write and recognize characters', async () => {
  const { createCharacterModel, renderCharacter } = loadViews();
  const store = await createRuntimeStore();
  const cases = [
    {
      route: { lessonId: 'g4f-01', group: 'write', character: '宵' },
      practice: practiceSnapshot({
        characters: { '宵': { mastered: true } },
        group: { completedCharacters: [] }
      }),
      status: /已掌握/
    },
    {
      route: { lessonId: 'g4f-01', group: 'write', character: '宴' },
      practice: practiceSnapshot({
        characters: { '宴': { mastered: false } },
        group: { completedCharacters: ['宴'] }
      }),
      status: /本组已完成/
    }
  ];

  for (const item of cases) {
    const { container } = createDom();
    const model = createCharacterModel(store.resolve(item.route), item.practice);
    renderCharacter(container, model);
    const button = byAction(container, 'start-character-practice')[0];
    assert.equal(button.textContent, '练习这个字');
    assert.equal(button.getAttribute('data-lesson-id'), item.route.lessonId);
    assert.equal(button.getAttribute('data-group'), item.route.group);
    assert.equal(button.getAttribute('data-character'), item.route.character);
    assert.match(container.textContent, item.status);
  }
});

test('renders active practice as an unframed board with stable live handles and actions', async () => {
  const { createPracticeModel, renderPractice } = loadViews();
  const store = await createRuntimeStore();
  const resolved = {
    ...store.resolve({ lessonId: 'g4f-01', group: 'write', character: '宵' }),
    scope: 'group'
  };
  const model = createPracticeModel(resolved, sessionState(), true);
  const { container } = createDom();
  const handle = renderPractice(container, model);

  assert.equal(byAttribute(container, 'data-view', 'practice').length, 1);
  assert.equal(handle.root.getAttribute('class'), 'view view--practice');
  assert.equal(handle.root.getAttribute('data-practice-status'), 'active');
  assert.equal(
    Object.keys(handle).join(','),
    'root,heading,board,setFeedback,setStrokePosition,setUnavailable'
  );
  assert.ok(Object.isFrozen(handle));
  assert.equal(byAction(container, 'practice-back').length, 1);
  assert.equal(byAction(container, 'practice-back')[0].getAttribute('data-lesson-id'), 'g4f-01');
  assert.equal(byAction(container, 'practice-back')[0].getAttribute('data-group'), 'write');
  assert.match(byAction(container, 'practice-back')[0].getAttribute('aria-label'), /返回.*第1组.*字组/);
  assert.match(byAction(container, 'practice-back')[0].textContent, /第1组/);
  assert.match(container.textContent, /第1组/);
  assert.match(container.textContent, /学习/);
  assert.match(container.textContent, /第 1 \/ 15 个/);
  assert.match(handle.heading.textContent, /宵/);
  assert.equal(handle.board, byAttribute(container, 'data-slot', 'practice-board')[0]);
  assert.equal(handle.board.parentNode, handle.root);
  assert.equal(handle.board.childNodes.length, 0);
  assert.equal(handle.board.getAttribute('role'), 'img');
  assert.equal(handle.board.getAttribute('aria-label'), '宵，引导描写，第1笔，共10笔');
  assert.equal(byAttribute(container, 'data-slot', 'practice-feedback')[0].getAttribute('aria-live'), 'polite');
  assert.equal(byAttribute(container, 'data-slot', 'practice-stroke-position')[0].textContent, '第 1 / 10 笔');
  const progress = byTag(container, 'progress')[0];
  assert.equal(progress.getAttribute('max'), '10');
  assert.equal(progress.getAttribute('value'), '0');
  assert.equal(byAction(container, 'practice-hint')[0].getAttribute('aria-label'), '提示当前笔');
  assert.equal(byAction(container, 'practice-hint')[0].getAttribute('title'), '提示当前笔');
  assert.equal(byAction(container, 'practice-restart')[0].textContent, '重写这个字');

  handle.setFeedback('这一笔写得很好', 'success');
  const feedback = byAttribute(container, 'data-slot', 'practice-feedback')[0];
  assert.equal(feedback.textContent, '这一笔写得很好');
  assert.equal(feedback.getAttribute('data-kind'), 'success');
  handle.setStrokePosition(5, 10);
  assert.equal(byAttribute(container, 'data-slot', 'practice-stroke-position')[0].textContent, '第 5 / 10 笔');
  assert.equal(progress.getAttribute('value'), '4');
  assert.equal(handle.board.getAttribute('aria-label'), '宵，引导描写，第5笔，共10笔');
  const beforeInvalid = handle.board.getAttribute('aria-label');
  assert.throws(() => handle.setFeedback('bad', 'warning'), TypeError);
  assert.throws(() => handle.setStrokePosition(0, 10), TypeError);
  assert.equal(handle.board.getAttribute('aria-label'), beforeInvalid);

  const singleModel = createPracticeModel({ ...resolved, scope: 'single' }, sessionState({
    total: 1,
    remainingCharacters: ['宵']
  }), true);
  const singleDom = createDom();
  renderPractice(singleDom.container, singleModel);
  const singleBack = byAction(singleDom.container, 'practice-back')[0];
  assert.match(singleBack.getAttribute('aria-label'), /返回.*宵.*学习页/);
  assert.doesNotMatch(singleBack.getAttribute('aria-label'), /字表/);
  assert.match(singleBack.textContent, /宵/);
  assert.equal(
    byAttribute(singleDom.container, 'data-slot', 'practice-round-position')[0].textContent,
    '第 1 个，共 15 个'
  );
  assert.equal(byAction(singleDom.container, 'previous-character').length, 1);
  assert.equal(byAction(singleDom.container, 'next-character').length, 1);
  assert.equal(byAction(singleDom.container, 'previous-character')[0].getAttribute('disabled'), '');
  assert.equal(byAction(singleDom.container, 'next-character')[0].getAttribute('disabled'), '');

  const secondResolved = {
    ...store.resolve({ lessonId: 'g4f-01', group: 'write', character: '宴' }),
    scope: 'single'
  };
  const secondComplete = createPracticeModel(secondResolved, sessionState({
    status: 'complete',
    phase: null,
    character: null,
    index: 1,
    total: 1,
    completedCharacters: ['宴'],
    remainingCharacters: [],
    masteredCount: 1
  }), true);
  const secondDom = createDom();
  renderPractice(secondDom.container, secondComplete);
  assert.equal(
    byAttribute(secondDom.container, 'data-slot', 'practice-round-position')[0].textContent,
    '第 2 个，共 15 个'
  );
  assert.equal(
    byAction(secondDom.container, 'previous-character')[0].getAttribute('data-character'),
    '宵'
  );
  assert.equal(
    byAction(secondDom.container, 'next-character')[0].getAttribute('data-character'),
    '扇'
  );
  assert.equal(
    byAction(secondDom.container, 'previous-character')[0].getAttribute('disabled'),
    null
  );
  assert.equal(byAction(secondDom.container, 'next-character')[0].getAttribute('disabled'), null);
});

test('renders retry controls by scope and rejects inactive handle mutations without DOM changes', async () => {
  const { createPracticeModel, renderPractice } = loadViews();
  const store = await createRuntimeStore();
  const baseResolved = store.resolve({ lessonId: 'g4f-01', group: 'write', character: '宵' });
  const groupModel = createPracticeModel({ ...baseResolved, scope: 'group' }, sessionState({
    status: 'needs-retry',
    phase: 'independent',
    mistakes: 3,
    completedCharacters: ['宵'],
    remainingCharacters: ['宵', '宴'],
    total: 2
  }), true);
  const singleModel = createPracticeModel({ ...baseResolved, scope: 'single' }, sessionState({
    status: 'needs-retry',
    phase: 'independent',
    total: 1,
    mistakes: 2,
    completedCharacters: ['宵'],
    remainingCharacters: ['宵']
  }), true);
  const groupDom = createDom();
  const singleDom = createDom();
  const groupHandle = renderPractice(groupDom.container, groupModel);
  renderPractice(singleDom.container, singleModel);

  assert.equal(groupHandle.board, null);
  assert.equal(byAttribute(groupDom.container, 'data-slot', 'practice-board').length, 0);
  assert.match(groupDom.container.textContent, /需要再练/);
  assert.match(groupDom.container.textContent, /3/);
  assert.equal(byAction(groupDom.container, 'practice-retry').length, 1);
  assert.equal(byAction(groupDom.container, 'practice-defer')[0].textContent, '稍后再练');
  assert.equal(byAction(singleDom.container, 'practice-retry').length, 1);
  assert.equal(byAction(singleDom.container, 'practice-defer').length, 0);
  const before = groupDom.container.textContent;
  assert.throws(() => groupHandle.setFeedback('no', 'neutral'), /active/i);
  assert.throws(() => groupHandle.setStrokePosition(1, 15), /active/i);
  assert.equal(groupDom.container.textContent, before);
});

test('active practice unavailable state disables hints and offers skipping only for groups', async () => {
  const { createPracticeModel, renderPractice } = loadViews();
  const store = await createRuntimeStore();
  const resolved = store.resolve({ lessonId: 'g4f-01', group: 'write', character: '宵' });
  const groupDom = createDom();
  const singleDom = createDom();
  const groupHandle = renderPractice(groupDom.container, createPracticeModel(
    { ...resolved, scope: 'group' }, sessionState(), true
  ));
  const singleHandle = renderPractice(singleDom.container, createPracticeModel(
    { ...resolved, scope: 'single' }, sessionState({
      total: 1, remainingCharacters: ['宵']
    }), true
  ));

  groupHandle.setUnavailable();
  singleHandle.setUnavailable();

  assert.equal(
    byAttribute(groupDom.container, 'data-slot', 'practice-feedback')[0].textContent,
    '这个字暂时无法练习'
  );
  assert.equal(byAction(groupDom.container, 'practice-hint')[0].getAttribute('disabled'), '');
  assert.equal(byAction(groupDom.container, 'practice-skip-unavailable')[0].textContent, '跳过这个字');
  assert.equal(byAction(groupDom.container, 'practice-skip-unavailable')[0].getAttribute('hidden'), null);
  assert.equal(byAction(singleDom.container, 'practice-hint')[0].getAttribute('disabled'), '');
  assert.equal(byAction(singleDom.container, 'practice-skip-unavailable').length, 0);
  assert.equal(byAction(singleDom.container, 'practice-restart').length, 1);
  assert.equal(byAction(singleDom.container, 'practice-back').length, 1);
});

test('renders complete summaries, conditional review actions, return action, and persistence warning', async () => {
  const { createPracticeModel, renderPractice } = loadViews();
  const store = await createRuntimeStore();
  const resolved = {
    ...store.resolve({ lessonId: 'g4f-01', group: 'write', character: '宵' }),
    scope: 'group'
  };
  const withNeeds = createPracticeModel(resolved, sessionState({
    status: 'complete',
    phase: null,
    character: null,
    index: 15,
    mistakes: 0,
    completedCharacters: LESSON_ONE_WRITE_CHARACTERS.slice(),
    remainingCharacters: [],
    needsPracticeCharacters: ['宴'],
    masteredCount: 1,
    newlyMasteredCount: 1
  }), false);
  const withoutNeeds = createPracticeModel(resolved, sessionState({
    status: 'complete',
    phase: null,
    character: null,
    index: 15,
    mistakes: 0,
    completedCharacters: LESSON_ONE_WRITE_CHARACTERS.slice(),
    remainingCharacters: [],
    masteredCount: 1
  }), true);
  const needsDom = createDom();
  const cleanDom = createDom();
  const handle = renderPractice(needsDom.container, withNeeds);
  renderPractice(cleanDom.container, withoutNeeds);

  assert.equal(handle.board, null);
  assert.equal(handle.root.getAttribute('data-practice-status'), 'complete');
  assert.equal(byAttribute(needsDom.container, 'data-slot', 'practice-board').length, 0);
  assert.match(needsDom.container.textContent, /本轮完成 15 个/);
  assert.match(needsDom.container.textContent, /当前掌握 1 个/);
  assert.match(needsDom.container.textContent, /本次新掌握 1 个/);
  assert.match(needsDom.container.textContent, /需要再练 1 个/);
  assert.match(needsDom.container.textContent, /本次进度不会保存/);
  assert.equal(byAction(needsDom.container, 'practice-review-needs').length, 1);
  assert.equal(byAction(needsDom.container, 'practice-return-lesson').length, 1);
  assert.equal(byAction(cleanDom.container, 'practice-review-needs').length, 0);
  assert.equal(byAction(cleanDom.container, 'practice-return-lesson').length, 1);
  assert.equal(cleanDom.container.textContent.includes('本次进度不会保存'), false);
});

test('practice rendering rejects accessor and symbol models before creating DOM nodes', async () => {
  const { createPracticeModel, renderPractice } = loadViews();
  const store = await createRuntimeStore();
  const resolved = {
    ...store.resolve({ lessonId: 'g4f-01', group: 'write', character: '宵' }),
    scope: 'group'
  };
  const valid = createPracticeModel(resolved, sessionState(), true);
  const accessorModel = { ...valid };
  const symbolModel = { ...valid, [Symbol('hostile')]: true };
  let getterCalls = 0;
  Object.defineProperty(accessorModel, 'persistent', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return true;
    }
  });
  const accessorDom = createDom();
  const symbolDom = createDom();

  assert.throws(() => renderPractice(accessorDom.container, accessorModel), TypeError);
  assert.throws(() => renderPractice(symbolDom.container, symbolModel), TypeError);
  assert.equal(getterCalls, 0);
  assert.equal(accessorDom.document.created.length, 0);
  assert.equal(symbolDom.document.created.length, 0);
  assert.equal(accessorDom.container.childNodes.length, 0);
  assert.equal(symbolDom.container.childNodes.length, 0);
});

test('omits the vocabulary row when a legacy character model has no words', () => {
  const { renderCharacter } = loadViews();
  const { container } = createDom();
  const model = Object.freeze({
    unit: Object.freeze({ id: 'g4-fall', title: '第一单元' }),
    lesson: Object.freeze({ id: 'g4f-01', title: '第1组', kind: 'lesson', number: 1 }),
    group: 'write',
    character: '宵',
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

test('updates audio feedback and keeps pronunciation and character navigation after board failure', async () => {
  const { createCharacterModel, renderCharacter } = loadViews();
  const store = await createRuntimeStore();
  const model = createCharacterModel(store.resolve({
    lessonId: 'g4f-01', group: 'write', character: '宵'
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
  assert.equal(typeof context.window.HanziApp.createPracticeModel, 'function');
  assert.equal(typeof context.window.HanziApp.renderCharacter, 'function');
  assert.equal(typeof context.window.HanziApp.renderPractice, 'function');
});

test('index is offline-first, accessible, and loads classic scripts in dependency order', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const scripts = Array.from(html.matchAll(/<script defer src="([^"]+)"><\/script>/g), (match) => match[1]);

  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1"/);
  assert.match(html, /<body>\s*<a class="skip-link" href="#app">跳到学习内容<\/a>/);
  assert.match(html, /class="brand-name">小红点识字<\//);
  assert.match(html, /独立编排 · 四年级上阶段/);
  assert.match(html, /<main id="app" tabindex="-1"><\/main>/);
  assert.match(html, /id="announcer" class="visually-hidden" role="status" aria-live="polite" aria-atomic="true"/);
  assert.doesNotMatch(html, /id="announcer"[^>]*\shidden(?:\s|=|>)/);
  assert.match(html, /<noscript>/);
  assert.match(html, /<link rel="stylesheet" href="styles\.css">/);
  assert.deepEqual(scripts, [
    'js/compat.js',
    'data/library-data.js',
    'js/data-store.js',
    'js/router.js',
    'js/svg-renderer.js',
    'js/animation-controller.js',
    'js/audio-controller.js',
    'vendor/hanzi-writer.min.js',
    'js/practice-progress-store.js',
    'js/practice-session.js',
    'js/practice-engine.js',
    'js/views.js',
    'js/app.js'
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
  assert.match(css, /-webkit-text-size-adjust:\s*100%/i);
  assert.match(css, /text-size-adjust:\s*100%/i);
  assert.match(css, /\.character-words\s*\{/i);
  assert.match(css, /max-width:\s*18rem/i);
  assert.match(css, /\.visually-hidden\s*\{/i);
  assert.match(css, /\.skip-link:focus-visible/i);
  assert.match(css, /min-width:\s*0/i);
  for (const inset of [225, 184, 16]) {
    const fallback = `calc(100vh - ${inset}px)`;
    const dynamic = `calc(100dvh - ${inset}px)`;
    assert.ok(css.includes(fallback), `missing legacy WebView viewport fallback: ${fallback}`);
    assert.ok(css.indexOf(fallback) < css.indexOf(dynamic), `${fallback} must precede ${dynamic}`);
  }
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
