import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import practiceProgressStoreModule from '../js/practice-progress-store.js';
import practiceSessionModule from '../js/practice-session.js';

const { PRACTICE_STORAGE_KEY, createPracticeProgressStore } = practiceProgressStoreModule;
const { createPracticeSession } = practiceSessionModule;

function groupProgress(overrides = {}) {
  return {
    completedCharacters: [],
    remainingCharacters: [],
    needsPracticeCharacters: [],
    currentCharacter: null,
    currentPhase: null,
    ...overrides
  };
}

function clone(value) {
  return structuredClone(value);
}

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    }
  };
}

function createFakeProgress({ characters = {}, group = null } = {}) {
  const characterState = new Map(Object.entries(clone(characters)));
  let savedGroup = group === null ? null : clone(group);
  const calls = [];
  const api = {
    calls,
    getCharacter(character) {
      calls.push(['getCharacter', character]);
      return clone(characterState.get(character) || {
        attemptCount: 0,
        lastOutcome: null,
        mastered: false
      });
    },
    getGroup(lessonId, name) {
      calls.push(['getGroup', lessonId, name]);
      return savedGroup === null ? null : clone(savedGroup);
    },
    recordCharacterOutcome(character, outcome) {
      calls.push(['recordCharacterOutcome', character, outcome]);
      const prior = characterState.get(character) || {
        attemptCount: 0,
        lastOutcome: null,
        mastered: false
      };
      characterState.set(character, {
        attemptCount: prior.attemptCount + 1,
        lastOutcome: outcome,
        mastered: outcome === 'mastered'
      });
    },
    saveGroup(lessonId, name, next) {
      calls.push(['saveGroup', lessonId, name, clone(next)]);
      savedGroup = clone(next);
    },
    markGroupCharacterCompleted(lessonId, name, character) {
      calls.push(['markGroupCharacterCompleted', lessonId, name, character]);
      const prior = savedGroup || groupProgress();
      savedGroup = {
        ...clone(prior),
        completedCharacters: [...new Set([...prior.completedCharacters, character])]
      };
    },
    group: () => savedGroup === null ? null : clone(savedGroup)
  };
  return api;
}

function entries(characters = ['潮', '据']) {
  return characters.map((character, index) => ({
    character,
    pinyin: index === 0 ? 'chao2' : 'ju4'
  }));
}

function options(progress, overrides = {}) {
  return {
    lessonId: 'lesson-1',
    group: 'write',
    scope: 'group',
    entries: entries(),
    startCharacter: '潮',
    progress,
    ...overrides
  };
}

function assertFrozen(value) {
  if (value && typeof value === 'object') {
    assert.ok(Object.isFrozen(value));
    Object.values(value).forEach(assertFrozen);
  }
}

test('a new single character progresses from guided to independent before a mastered completion', () => {
  const progress = createFakeProgress();
  const session = createPracticeSession(options(progress, { scope: 'single' }));

  assert.deepEqual(session.getState(), {
    status: 'active', phase: 'guided', character: '潮', index: 0, total: 1,
    mistakes: 0, completedCharacters: [], remainingCharacters: ['潮'], needsPracticeCharacters: []
  });
  session.recordStrokeMistake();
  session.completeCharacter({ totalMistakes: 8 });
  assert.equal(session.getState().phase, 'independent');
  assert.equal(session.getState().mistakes, 0);
  assert.deepEqual(progress.calls.filter(([name]) => name === 'recordCharacterOutcome'), []);

  session.completeCharacter({ totalMistakes: 0 });
  assert.deepEqual(session.getState(), {
    status: 'complete', phase: null, character: null, index: 1, total: 1,
    mistakes: 0, completedCharacters: ['潮'], remainingCharacters: [], needsPracticeCharacters: []
  });
  assert.deepEqual(progress.calls.filter(([name]) => name === 'recordCharacterOutcome'), [
    ['recordCharacterOutcome', '潮', 'mastered']
  ]);
  assert.deepEqual(progress.calls.filter(([name]) => name === 'markGroupCharacterCompleted'), [
    ['markGroupCharacterCompleted', 'lesson-1', 'write', '潮']
  ]);
});

test('a mastered group character starts independent and a failed attempt can retry independently', () => {
  const progress = createFakeProgress({
    characters: { 潮: { attemptCount: 2, lastOutcome: 'mastered', mastered: true } }
  });
  const session = createPracticeSession(options(progress));

  assert.equal(session.getState().phase, 'independent');
  session.recordStrokeMistake();
  session.completeCharacter({ totalMistakes: 3 });
  assert.deepEqual(session.getState(), {
    status: 'needs-retry', phase: 'independent', character: '潮', index: 0, total: 2,
    mistakes: 3, completedCharacters: ['潮'], remainingCharacters: ['潮', '据'], needsPracticeCharacters: []
  });
  assert.deepEqual(progress.calls.filter(([name]) => name === 'recordCharacterOutcome'), [
    ['recordCharacterOutcome', '潮', 'needs-practice']
  ]);

  session.retry();
  assert.equal(session.getState().status, 'active');
  assert.equal(session.getState().phase, 'independent');
  assert.equal(session.getState().mistakes, 0);
});

test('deferring a failed group character records it once and advances without reordering', () => {
  const progress = createFakeProgress({
    characters: { 潮: { attemptCount: 1, lastOutcome: 'mastered', mastered: true } }
  });
  const session = createPracticeSession(options(progress, { entries: entries(['潮', '据', '熟']) }));

  session.completeCharacter({ totalMistakes: 1 });
  session.defer();

  assert.deepEqual(session.getState(), {
    status: 'active', phase: 'guided', character: '据', index: 1, total: 3,
    mistakes: 0, completedCharacters: ['潮'], remainingCharacters: ['据', '熟'], needsPracticeCharacters: ['潮']
  });
  assert.deepEqual(progress.group(), groupProgress({
    completedCharacters: ['潮'], remainingCharacters: ['据', '熟'], needsPracticeCharacters: ['潮'],
    currentCharacter: '据', currentPhase: 'guided'
  }));
});

test('a failed single attempt merges its lesson completion once and never writes group progress', () => {
  const progress = createFakeProgress();
  const session = createPracticeSession(options(progress, { scope: 'single' }));

  session.completeCharacter({ totalMistakes: 0 });
  session.completeCharacter({ totalMistakes: 1 });
  session.retry();
  session.completeCharacter({ totalMistakes: 0 });

  assert.deepEqual(progress.calls.filter(([name]) => name === 'markGroupCharacterCompleted'), [
    ['markGroupCharacterCompleted', 'lesson-1', 'write', '潮']
  ]);
  assert.deepEqual(progress.calls.filter(([name]) => name === 'saveGroup'), []);
  assert.deepEqual(progress.calls.filter(([name]) => name === 'recordCharacterOutcome'), [
    ['recordCharacterOutcome', '潮', 'needs-practice'],
    ['recordCharacterOutcome', '潮', 'mastered']
  ]);
});

test('group successes advance to the next character phase and persist a null current state at completion', () => {
  const progress = createFakeProgress({
    characters: {
      潮: { attemptCount: 1, lastOutcome: 'mastered', mastered: true },
      据: { attemptCount: 1, lastOutcome: 'mastered', mastered: true }
    }
  });
  const session = createPracticeSession(options(progress));

  session.completeCharacter({ totalMistakes: 0 });
  assert.deepEqual(session.getState(), {
    status: 'active', phase: 'independent', character: '据', index: 1, total: 2,
    mistakes: 0, completedCharacters: ['潮'], remainingCharacters: ['据'], needsPracticeCharacters: []
  });
  session.completeCharacter({ totalMistakes: 0 });

  assert.deepEqual(progress.group(), groupProgress({
    completedCharacters: ['潮', '据'], remainingCharacters: [], needsPracticeCharacters: [],
    currentCharacter: null, currentPhase: null
  }));
  assert.equal(session.getState().status, 'complete');
});

test('group resume restores compatible state and ignores incompatible saved queues', () => {
  const resumable = createFakeProgress({
    group: groupProgress({
      completedCharacters: ['潮'], remainingCharacters: ['据'], needsPracticeCharacters: ['潮'],
      currentCharacter: '据', currentPhase: 'independent'
    })
  });
  const restored = createPracticeSession(options(resumable));
  assert.deepEqual(restored.getState(), {
    status: 'active', phase: 'independent', character: '据', index: 1, total: 2,
    mistakes: 0, completedCharacters: ['潮'], remainingCharacters: ['据'], needsPracticeCharacters: ['潮']
  });

  const stale = createFakeProgress({
    group: groupProgress({ remainingCharacters: ['据', '潮'], currentCharacter: '据', currentPhase: 'guided' })
  });
  const fresh = createPracticeSession(options(stale));
  assert.deepEqual(fresh.getState().remainingCharacters, ['潮', '据']);
  assert.equal(fresh.getState().character, '潮');

  const currentWithinQueue = createFakeProgress({
    group: groupProgress({ remainingCharacters: ['潮', '据'], currentCharacter: '据', currentPhase: 'independent' })
  });
  const ignoredCurrent = createPracticeSession(options(currentWithinQueue));
  assert.equal(ignoredCurrent.getState().character, '潮');
  assert.deepEqual(ignoredCurrent.getState().remainingCharacters, ['潮', '据']);

  const reversedNeeds = createFakeProgress({
    group: groupProgress({
      completedCharacters: ['潮'], remainingCharacters: ['据'], needsPracticeCharacters: ['据', '潮'],
      currentCharacter: '据', currentPhase: 'guided'
    })
  });
  const ignoredReversedNeeds = createPracticeSession(options(reversedNeeds));
  assert.equal(ignoredReversedNeeds.getState().character, '潮');
  assert.deepEqual(ignoredReversedNeeds.getState().needsPracticeCharacters, []);

  const foreignNeeds = createFakeProgress({
    group: groupProgress({ remainingCharacters: ['据'], needsPracticeCharacters: ['熟'], currentCharacter: '据', currentPhase: 'guided' })
  });
  const ignoredForeignNeeds = createPracticeSession(options(foreignNeeds));
  assert.equal(ignoredForeignNeeds.getState().character, '潮');
  assert.deepEqual(ignoredForeignNeeds.getState().needsPracticeCharacters, []);

  const reversedCompleted = createFakeProgress({
    group: groupProgress({
      completedCharacters: ['据', '潮'], remainingCharacters: [], needsPracticeCharacters: [],
      currentCharacter: null, currentPhase: null
    })
  });
  const ignoredReversedCompleted = createPracticeSession(options(reversedCompleted));
  assert.equal(ignoredReversedCompleted.getState().character, '潮');
  assert.deepEqual(ignoredReversedCompleted.getState().completedCharacters, []);
});

test('single scope filters to the start character and never reads a group resume', () => {
  const progress = createFakeProgress({
    group: groupProgress({ remainingCharacters: ['据'], currentCharacter: '据', currentPhase: 'independent' })
  });
  const session = createPracticeSession(options(progress, { scope: 'single', startCharacter: '据' }));

  assert.deepEqual(session.getState().remainingCharacters, ['据']);
  assert.equal(session.getState().character, '据');
  assert.deepEqual(progress.calls.filter(([name]) => name === 'getGroup'), []);
});

test('resume false starts a fresh filtered group round with no needs-practice history', () => {
  const progress = createFakeProgress({
    group: groupProgress({
      completedCharacters: ['潮'], remainingCharacters: ['据'], needsPracticeCharacters: ['潮'],
      currentCharacter: '据', currentPhase: 'independent'
    })
  });
  const session = createPracticeSession(options(progress, {
    entries: entries(['据']), startCharacter: '据', resume: false
  }));

  assert.deepEqual(session.getState(), {
    status: 'active', phase: 'guided', character: '据', index: 0, total: 1,
    mistakes: 0, completedCharacters: [], remainingCharacters: ['据'], needsPracticeCharacters: []
  });
  assert.deepEqual(progress.calls.filter(([name]) => name === 'getGroup'), []);
});

test('snapshots are recursively frozen and entry options remain detached', () => {
  const progress = createFakeProgress();
  const suppliedEntries = entries();
  const before = clone(suppliedEntries);
  const session = createPracticeSession(options(progress, { entries: suppliedEntries }));
  const first = session.getState();
  const second = session.getState();

  assertFrozen(session);
  assertFrozen(first);
  assert.notEqual(first, second);
  assert.notEqual(first.remainingCharacters, second.remainingCharacters);
  assert.deepEqual(suppliedEntries, before);
  assert.throws(() => { first.remainingCharacters.push('熟'); }, TypeError);
});

test('restart clears only active mistakes without changing queue state or persistence', () => {
  const progress = createFakeProgress();
  const session = createPracticeSession(options(progress));
  const beforeCalls = clone(progress.calls);

  session.recordStrokeMistake();
  session.recordStrokeMistake();
  session.restart();

  assert.deepEqual(session.getState(), {
    status: 'active', phase: 'guided', character: '潮', index: 0, total: 2,
    mistakes: 0, completedCharacters: [], remainingCharacters: ['潮', '据'], needsPracticeCharacters: []
  });
  assert.deepEqual(progress.calls, beforeCalls);
});

test('deferring the last failed group character completes the session with a null saved current state', () => {
  const progress = createFakeProgress({
    characters: { 潮: { attemptCount: 1, lastOutcome: 'mastered', mastered: true } }
  });
  const session = createPracticeSession(options(progress, { entries: entries(['潮']) }));

  session.completeCharacter({ totalMistakes: 1 });
  session.defer();

  assert.deepEqual(session.getState(), {
    status: 'complete', phase: null, character: null, index: 1, total: 1,
    mistakes: 0, completedCharacters: ['潮'], remainingCharacters: [], needsPracticeCharacters: ['潮']
  });
  assert.deepEqual(progress.group(), groupProgress({
    completedCharacters: ['潮'], remainingCharacters: [], needsPracticeCharacters: ['潮'],
    currentCharacter: null, currentPhase: null
  }));
});

test('destroy saves an active group once and all late calls except repeated destroy fail without mutation', () => {
  const progress = createFakeProgress();
  const session = createPracticeSession(options(progress));
  session.recordStrokeMistake();

  session.destroy();
  const callsAfterDestroy = clone(progress.calls);
  assert.deepEqual(progress.group(), groupProgress({
    remainingCharacters: ['潮', '据'], currentCharacter: '潮', currentPhase: 'guided'
  }));
  assert.doesNotThrow(() => session.destroy());
  ['getState', 'recordStrokeMistake', 'completeCharacter', 'retry', 'defer', 'restart'].forEach((method) => {
    assert.throws(() => method === 'completeCharacter'
      ? session[method]({ totalMistakes: 0 })
      : session[method](), /destroyed/i);
  });
  assert.deepEqual(progress.calls, callsAfterDestroy);
});

test('single-scope destroy never saves group progress and makes later calls inert', () => {
  const progress = createFakeProgress();
  const session = createPracticeSession(options(progress, { scope: 'single' }));

  session.destroy();
  const callsAfterDestroy = clone(progress.calls);
  assert.doesNotThrow(() => session.destroy());
  assert.throws(() => session.completeCharacter({ totalMistakes: 0 }), /destroyed/i);
  assert.throws(() => session.recordStrokeMistake(), /destroyed/i);
  assert.deepEqual(progress.calls.filter(([name]) => name === 'saveGroup'), []);
  assert.deepEqual(progress.calls, callsAfterDestroy);
});

test('guards reentrant collaborator callbacks without duplicating mutations', () => {
  const outcomeProgress = createFakeProgress({
    characters: { 潮: { attemptCount: 1, lastOutcome: 'mastered', mastered: true } }
  });
  const recordOutcome = outcomeProgress.recordCharacterOutcome;
  let outcomeSession;
  outcomeProgress.recordCharacterOutcome = function (character, outcome) {
    recordOutcome.call(this, character, outcome);
    assert.deepEqual(outcomeSession.getState(), {
      status: 'active', phase: 'independent', character: '潮', index: 0, total: 2,
      mistakes: 0, completedCharacters: [], remainingCharacters: ['潮', '据'], needsPracticeCharacters: []
    });
    assert.throws(() => outcomeSession.recordStrokeMistake(), /mutation/i);
  };
  outcomeSession = createPracticeSession(options(outcomeProgress));
  assert.deepEqual(Object.keys(outcomeSession).sort(), [
    'completeCharacter', 'defer', 'destroy', 'getState', 'recordStrokeMistake', 'restart', 'retry'
  ]);
  outcomeSession.completeCharacter({ totalMistakes: 0 });
  assert.equal(outcomeProgress.calls.filter(([name]) => name === 'recordCharacterOutcome').length, 1);
  assert.equal(outcomeProgress.calls.filter(([name]) => name === 'saveGroup').length, 1);

  const saveProgress = createFakeProgress();
  const saveGroup = saveProgress.saveGroup;
  let saveSession;
  saveProgress.saveGroup = function () {
    saveGroup.apply(this, arguments);
    assert.throws(() => saveSession.restart(), /mutation/i);
  };
  saveSession = createPracticeSession(options(saveProgress));
  saveSession.completeCharacter({ totalMistakes: 0 });
  assert.equal(saveProgress.calls.filter(([name]) => name === 'saveGroup').length, 1);

  const markProgress = createFakeProgress({
    characters: { 潮: { attemptCount: 1, lastOutcome: 'mastered', mastered: true } }
  });
  const markComplete = markProgress.markGroupCharacterCompleted;
  let markSession;
  markProgress.markGroupCharacterCompleted = function () {
    markComplete.apply(this, arguments);
    assert.throws(() => markSession.completeCharacter({ totalMistakes: 0 }), /mutation/i);
  };
  markSession = createPracticeSession(options(markProgress, { scope: 'single' }));
  markSession.completeCharacter({ totalMistakes: 0 });
  const outcomePosition = markProgress.calls.findIndex(([name]) => name === 'recordCharacterOutcome');
  const markPosition = markProgress.calls.findIndex(([name]) => name === 'markGroupCharacterCompleted');
  assert.equal(markProgress.calls.filter(([name]) => name === 'recordCharacterOutcome').length, 1);
  assert.equal(markProgress.calls.filter(([name]) => name === 'markGroupCharacterCompleted').length, 1);
  assert.ok(outcomePosition < markPosition);

  const destroyProgress = createFakeProgress();
  const destroySave = destroyProgress.saveGroup;
  let destroySession;
  destroyProgress.saveGroup = function () {
    destroySave.apply(this, arguments);
    assert.throws(() => destroySession.destroy(), /mutation/i);
  };
  destroySession = createPracticeSession(options(destroyProgress));
  destroySession.destroy();
  assert.doesNotThrow(() => destroySession.destroy());
  assert.equal(destroyProgress.calls.filter(([name]) => name === 'saveGroup').length, 1);

  const retryProgress = createFakeProgress({
    characters: { 潮: { attemptCount: 1, lastOutcome: 'mastered', mastered: true } }
  });
  const retrySession = createPracticeSession(options(retryProgress));
  retrySession.completeCharacter({ totalMistakes: 1 });
  const retrySave = retryProgress.saveGroup;
  retryProgress.saveGroup = function () {
    retrySave.apply(this, arguments);
    assert.throws(() => retrySession.retry(), /mutation/i);
  };
  retrySession.retry();
  assert.equal(retryProgress.calls.filter(([name]) => name === 'saveGroup').length, 2);

  const deferProgress = createFakeProgress({
    characters: { 潮: { attemptCount: 1, lastOutcome: 'mastered', mastered: true } }
  });
  const deferSession = createPracticeSession(options(deferProgress));
  deferSession.completeCharacter({ totalMistakes: 1 });
  const deferSave = deferProgress.saveGroup;
  deferProgress.saveGroup = function () {
    deferSave.apply(this, arguments);
    assert.throws(() => deferSession.defer(), /mutation/i);
  };
  deferSession.defer();
  assert.equal(deferProgress.calls.filter(([name]) => name === 'saveGroup').length, 2);
});

test('clears the mutation guard after throwing collaborators so later commands remain usable', () => {
  const progress = createFakeProgress();
  const saveGroup = progress.saveGroup;
  let shouldThrow = true;
  progress.saveGroup = function () {
    if (shouldThrow) {
      shouldThrow = false;
      throw new Error('save failed');
    }
    return saveGroup.apply(this, arguments);
  };
  const session = createPracticeSession(options(progress));

  assert.throws(() => session.completeCharacter({ totalMistakes: 0 }), /save failed/);
  assert.equal(session.getState().phase, 'guided');
  assert.doesNotThrow(() => session.completeCharacter({ totalMistakes: 0 }));
  assert.equal(session.getState().phase, 'independent');

  const recordProgress = createFakeProgress({
    characters: { 潮: { attemptCount: 1, lastOutcome: 'mastered', mastered: true } }
  });
  const recordOutcome = recordProgress.recordCharacterOutcome;
  shouldThrow = true;
  recordProgress.recordCharacterOutcome = function () {
    if (shouldThrow) {
      shouldThrow = false;
      throw new Error('record failed');
    }
    return recordOutcome.apply(this, arguments);
  };
  const independent = createPracticeSession(options(recordProgress, { scope: 'single' }));
  assert.throws(() => independent.completeCharacter({ totalMistakes: 0 }), /record failed/);
  assert.doesNotThrow(() => independent.completeCharacter({ totalMistakes: 0 }));
  assert.equal(independent.getState().status, 'complete');
});

test('preflights official progress-store attempt overflow before single completion side effects', () => {
  const storage = createStorage({
    [PRACTICE_STORAGE_KEY]: JSON.stringify({
      schemaVersion: 1,
      characters: {
        潮: { attemptCount: Number.MAX_SAFE_INTEGER, lastOutcome: 'mastered', mastered: true }
      },
      groups: {}
    })
  });
  const progress = createPracticeProgressStore(storage);
  const session = createPracticeSession(options(progress, { scope: 'single' }));
  const before = session.getState();

  assert.throws(() => session.completeCharacter({ totalMistakes: 0 }), /safe integer/i);
  assert.deepEqual(session.getState(), before);
  assert.equal(progress.getGroup('lesson-1', 'write'), null);
  assert.deepEqual(progress.getCharacter('潮'), {
    attemptCount: Number.MAX_SAFE_INTEGER, lastOutcome: 'mastered', mastered: true
  });
});

test('invalid options, totals, and transitions are rejected atomically', () => {
  const progress = createFakeProgress();
  const invalidOptions = [
    null,
    { ...options(progress), lessonId: 'Lesson 1' },
    { ...options(progress), group: 'other' },
    { ...options(progress), scope: 'all' },
    { ...options(progress), entries: [{ character: '潮', pinyin: '' }] },
    { ...options(progress), entries: [{ character: '潮', pinyin: 'chao2' }, { character: '潮', pinyin: 'other' }] },
    { ...options(progress), startCharacter: '熟' },
    { ...options(progress), progress: {} }
  ];
  invalidOptions.forEach((candidate) => assert.throws(() => createPracticeSession(candidate), TypeError));
  const prototypeOptions = Object.create(options(progress));
  assert.throws(() => createPracticeSession(prototypeOptions), TypeError);

  const session = createPracticeSession(options(progress, { scope: 'single' }));
  const beforeState = session.getState();
  const beforeCalls = clone(progress.calls);
  assert.throws(() => session.completeCharacter({ totalMistakes: -1 }), TypeError);
  assert.throws(() => session.completeCharacter({ totalMistakes: Number.MAX_SAFE_INTEGER + 1 }), TypeError);
  assert.throws(() => session.retry(), /needs-retry/);
  assert.throws(() => session.defer(), /group/);
  assert.deepEqual(session.getState(), beforeState);
  assert.deepEqual(progress.calls, beforeCalls);
});

test('rejects hostile public input without invoking getters and ignores malformed stored groups', () => {
  const progress = createFakeProgress();
  const base = options(progress);
  let getterCalls = 0;
  const accessorOptions = { ...base };
  Object.defineProperty(accessorOptions, 'entries', {
    get() {
      getterCalls += 1;
      throw new Error('must not read getter');
    }
  });
  const symbolOptions = { ...base, [Symbol('unexpected')]: true };
  const extraOptions = { ...base, unexpected: true };
  const sparseEntries = new Array(1);
  const inheritedEntry = Object.assign(Object.create({ character: '潮' }), { pinyin: 'chao2' });
  const inheritedProgress = Object.create(progress);
  const hostileCompletion = {};
  Object.defineProperty(hostileCompletion, 'totalMistakes', {
    get() {
      getterCalls += 1;
      throw new Error('must not read getter');
    }
  });

  [
    accessorOptions,
    symbolOptions,
    extraOptions,
    { ...base, entries: sparseEntries },
    { ...base, entries: [inheritedEntry] },
    { ...base, progress: inheritedProgress }
  ].forEach((candidate) => assert.throws(() => createPracticeSession(candidate), TypeError));
  assert.equal(getterCalls, 0);

  const session = createPracticeSession(options(progress, { scope: 'single' }));
  const beforeState = session.getState();
  const beforeCalls = clone(progress.calls);
  assert.throws(() => session.completeCharacter(hostileCompletion), TypeError);
  assert.equal(getterCalls, 0);
  assert.deepEqual(session.getState(), beforeState);
  assert.deepEqual(progress.calls, beforeCalls);

  const malformedProgress = createFakeProgress();
  const malformedGroup = groupProgress({ remainingCharacters: ['潮'], currentCharacter: '潮', currentPhase: 'guided' });
  Object.defineProperty(malformedGroup, 'remainingCharacters', {
    get() {
      getterCalls += 1;
      throw new Error('must not read getter');
    }
  });
  malformedProgress.getGroup = () => malformedGroup;
  const fresh = createPracticeSession(options(malformedProgress));
  assert.deepEqual(fresh.getState().remainingCharacters, ['潮', '据']);
  assert.equal(getterCalls, 0);
});

test('classic browser UMD loading preserves HanziApp without DOM or fetch', async () => {
  const source = await readFile(new URL('../js/practice-session.js', import.meta.url), 'utf8');
  const sentinel = Object.freeze({ preserved: true });
  const context = { window: { HanziApp: { sentinel } } };

  vm.runInNewContext(source, context, { filename: 'js/practice-session.js' });

  assert.equal(context.window.HanziApp.sentinel, sentinel);
  assert.equal(typeof context.window.HanziApp.createPracticeSession, 'function');
});
