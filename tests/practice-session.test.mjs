import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

import dataStoreModule from '../js/data-store.js';
import practiceProgressStoreModule from '../js/practice-progress-store.js';
import practiceSessionModule from '../js/practice-session.js';

const require = createRequire(import.meta.url);
const { createDataStore } = dataStoreModule;
const { PRACTICE_STORAGE_KEY, createPracticeProgressStore } = practiceProgressStoreModule;
const { createPracticeSession } = practiceSessionModule;
const { createPracticeModel } = require('../js/views.js');

async function createRuntimeStore() {
  const source = await readFile(new URL('../data/library-data.js', import.meta.url), 'utf8');
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename: 'data/library-data.js' });
  return createDataStore(context.window.HANZI_LIBRARY);
}

function groupProgress(overrides = {}) {
  const result = {
    completedCharacters: [],
    roundCharacters: [],
    roundCompletedCharacters: [],
    remainingCharacters: [],
    needsPracticeCharacters: [],
    roundInitialMasteredCharacters: [],
    roundNewlyMasteredCharacters: [],
    currentCharacter: null,
    currentPhase: null,
    ...overrides
  };
  if (!Object.hasOwn(overrides, 'roundCompletedCharacters')) {
    result.roundCompletedCharacters = result.completedCharacters.slice();
  }
  if (!Object.hasOwn(overrides, 'roundCharacters')) {
    result.roundCharacters = [...new Set([
      ...result.roundCompletedCharacters,
      ...result.remainingCharacters,
      ...result.needsPracticeCharacters
    ])];
  }
  return result;
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
  function applyCharacterOutcome(character, outcome) {
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
  }
  function applyGroupSave(next) {
    const prior = savedGroup || groupProgress();
    savedGroup = {
      ...clone(next),
      completedCharacters: [...new Set([
        ...prior.completedCharacters,
        ...next.completedCharacters,
        ...next.roundCompletedCharacters
      ])]
    };
  }
  function applyGroupOutcome(character, outcome) {
    const prior = savedGroup || groupProgress();
    savedGroup = {
      ...clone(prior),
      completedCharacters: [...new Set([...prior.completedCharacters, character])]
    };
    if (prior.remainingCharacters.length === 0
        || !prior.roundCharacters.includes(character)) return;
    savedGroup.roundCompletedCharacters = prior.roundCharacters.filter((item) => (
      item === character || prior.roundCompletedCharacters.includes(item)
    ));
    if (outcome === 'needs-practice') {
      savedGroup.roundNewlyMasteredCharacters = prior.roundNewlyMasteredCharacters.filter(
        (item) => item !== character
      );
    }
    if (outcome === 'needs-practice' && prior.currentCharacter === character) {
      savedGroup.needsPracticeCharacters = prior.needsPracticeCharacters.filter(
        (item) => item !== character
      );
      savedGroup.currentPhase = 'independent';
      return;
    }
    savedGroup.remainingCharacters = prior.remainingCharacters.filter(
      (item) => item !== character
    );
    savedGroup.needsPracticeCharacters = outcome === 'mastered'
      ? prior.needsPracticeCharacters.filter((item) => item !== character)
      : prior.roundCharacters.filter((item) => (
        item === character || prior.needsPracticeCharacters.includes(item)
      ));
    if (savedGroup.remainingCharacters.length === 0) {
      savedGroup.currentCharacter = null;
      savedGroup.currentPhase = null;
    } else if (prior.currentCharacter === character) {
      savedGroup.currentCharacter = savedGroup.remainingCharacters[0];
      savedGroup.currentPhase = characterState.get(savedGroup.currentCharacter)?.mastered
        ? 'independent'
        : 'guided';
    }
  }
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
      applyCharacterOutcome(character, outcome);
    },
    saveGroup(lessonId, name, next) {
      calls.push(['saveGroup', lessonId, name, clone(next)]);
      applyGroupSave(next);
    },
    markGroupCharacterCompleted(lessonId, name, character, outcome) {
      calls.push(['markGroupCharacterCompleted', lessonId, name, character, outcome]);
      applyGroupOutcome(character, outcome);
    },
    recordPracticeOutcome(lessonId, name, scope, character, outcome, next) {
      calls.push([
        'recordPracticeOutcome', lessonId, name, scope, character, outcome,
        next === null ? null : clone(next)
      ]);
      applyCharacterOutcome(character, outcome);
      if (scope === 'group') applyGroupSave(next);
      else applyGroupOutcome(character, outcome);
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

function outcomeCalls(progress) {
  return progress.calls
    .filter(([name]) => name === 'recordPracticeOutcome')
    .map(([, lessonId, group, scope, character, outcome]) => (
      [lessonId, group, scope, character, outcome]
    ));
}

test('a new single character progresses from guided to independent before a mastered completion', () => {
  const progress = createFakeProgress();
  const session = createPracticeSession(options(progress, { scope: 'single' }));

  assert.deepEqual(session.getState(), {
    status: 'active', phase: 'guided', character: '潮', index: 0, total: 1,
    mistakes: 0, newlyMasteredCount: 0, completedCharacters: [], remainingCharacters: ['潮'], needsPracticeCharacters: []
  });
  session.recordStrokeMistake();
  session.completeCharacter({ totalMistakes: 8 });
  assert.equal(session.getState().phase, 'independent');
  assert.equal(session.getState().mistakes, 0);
  assert.deepEqual(outcomeCalls(progress), []);

  session.completeCharacter({ totalMistakes: 0 });
  assert.deepEqual(session.getState(), {
    status: 'complete', phase: null, character: null, index: 1, total: 1,
    mistakes: 0, newlyMasteredCount: 1, completedCharacters: ['潮'], remainingCharacters: [], needsPracticeCharacters: []
  });
  assert.deepEqual(outcomeCalls(progress), [
    ['lesson-1', 'write', 'single', '潮', 'mastered']
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
    mistakes: 3, newlyMasteredCount: 0, completedCharacters: ['潮'], remainingCharacters: ['潮', '据'], needsPracticeCharacters: []
  });
  assert.deepEqual(outcomeCalls(progress), [
    ['lesson-1', 'write', 'group', '潮', 'needs-practice']
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
    mistakes: 0, newlyMasteredCount: 0, completedCharacters: ['潮'], remainingCharacters: ['据', '熟'], needsPracticeCharacters: ['潮']
  });
  assert.deepEqual(progress.group(), groupProgress({
    completedCharacters: ['潮'], remainingCharacters: ['据', '熟'], needsPracticeCharacters: ['潮'],
    roundInitialMasteredCharacters: ['潮'],
    currentCharacter: '据', currentPhase: 'guided'
  }));
});

test('single retries coordinate every outcome without directly saving group progress', () => {
  const progress = createFakeProgress();
  const session = createPracticeSession(options(progress, { scope: 'single' }));

  session.completeCharacter({ totalMistakes: 0 });
  session.completeCharacter({ totalMistakes: 1 });
  session.retry();
  session.completeCharacter({ totalMistakes: 0 });

  assert.deepEqual(progress.calls.filter(([name]) => name === 'saveGroup'), []);
  assert.deepEqual(outcomeCalls(progress), [
    ['lesson-1', 'write', 'single', '潮', 'needs-practice'],
    ['lesson-1', 'write', 'single', '潮', 'mastered']
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
    mistakes: 0, newlyMasteredCount: 0, completedCharacters: ['潮'], remainingCharacters: ['据'], needsPracticeCharacters: []
  });
  session.completeCharacter({ totalMistakes: 0 });

  assert.deepEqual(progress.group(), groupProgress({
    completedCharacters: ['潮', '据'], remainingCharacters: [], needsPracticeCharacters: [],
    roundInitialMasteredCharacters: ['潮', '据'],
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
    mistakes: 0, newlyMasteredCount: 0, completedCharacters: ['潮'], remainingCharacters: ['据'], needsPracticeCharacters: ['潮']
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
      completedCharacters: ['据', '潮'], roundCharacters: ['潮', '据'],
      roundCompletedCharacters: ['潮', '据'], remainingCharacters: [], needsPracticeCharacters: [],
      currentCharacter: null, currentPhase: null
    })
  });
  const normalizedComplete = createPracticeSession(options(reversedCompleted));
  assert.deepEqual(normalizedComplete.getState(), {
    status: 'complete', phase: null, character: null, index: 2, total: 2,
    mistakes: 0, newlyMasteredCount: 0, completedCharacters: ['潮', '据'], remainingCharacters: [], needsPracticeCharacters: []
  });
});

test('restores only semantically complete queues and preserves current independent retry overlap', () => {
  const invalidGroups = [
    groupProgress({
      roundCharacters: ['潮', '据'], remainingCharacters: ['据'],
      currentCharacter: '据', currentPhase: 'guided'
    }),
    groupProgress({
      completedCharacters: ['潮'], roundCharacters: ['潮', '据'],
      roundCompletedCharacters: ['潮'], remainingCharacters: [],
      currentCharacter: null, currentPhase: null
    }),
    groupProgress({
      completedCharacters: ['潮'], remainingCharacters: ['潮', '据'], needsPracticeCharacters: ['潮'],
      currentCharacter: '潮', currentPhase: 'independent'
    }),
    groupProgress({
      completedCharacters: ['潮'], remainingCharacters: ['据'], needsPracticeCharacters: ['据'],
      currentCharacter: '据', currentPhase: 'guided'
    }),
    groupProgress({
      completedCharacters: ['潮'], remainingCharacters: ['潮', '据'], needsPracticeCharacters: ['潮'],
      currentCharacter: '潮', currentPhase: 'guided'
    }),
  ];
  invalidGroups.forEach((group) => {
    const session = createPracticeSession(options(createFakeProgress({ group })));
    assert.deepEqual(session.getState(), {
      status: 'active', phase: 'guided', character: '潮', index: 0, total: 2,
      mistakes: 0, newlyMasteredCount: 0, completedCharacters: [], remainingCharacters: ['潮', '据'], needsPracticeCharacters: []
    });
  });

  const retry = createPracticeSession(options(createFakeProgress({
    group: groupProgress({
      completedCharacters: ['潮'], remainingCharacters: ['潮', '据'],
      currentCharacter: '潮', currentPhase: 'independent'
    })
  })));
  assert.deepEqual(retry.getState(), {
    status: 'active', phase: 'independent', character: '潮', index: 0, total: 2,
    mistakes: 0, newlyMasteredCount: 0, completedCharacters: ['潮'], remainingCharacters: ['潮', '据'], needsPracticeCharacters: []
  });

  const complete = createPracticeSession(options(createFakeProgress({
    group: groupProgress({ completedCharacters: ['潮', '据'] })
  })));
  assert.deepEqual(complete.getState(), {
    status: 'complete', phase: null, character: null, index: 2, total: 2,
    mistakes: 0, newlyMasteredCount: 0, completedCharacters: ['潮', '据'], remainingCharacters: [], needsPracticeCharacters: []
  });
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
    mistakes: 0, newlyMasteredCount: 0, completedCharacters: [], remainingCharacters: ['据'], needsPracticeCharacters: []
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
    mistakes: 0, newlyMasteredCount: 0, completedCharacters: [], remainingCharacters: ['潮', '据'], needsPracticeCharacters: []
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
    mistakes: 0, newlyMasteredCount: 0, completedCharacters: ['潮'], remainingCharacters: [], needsPracticeCharacters: ['潮']
  });
  assert.deepEqual(progress.group(), groupProgress({
    completedCharacters: ['潮'], remainingCharacters: [], needsPracticeCharacters: ['潮'],
    roundInitialMasteredCharacters: ['潮'],
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
  const recordOutcome = outcomeProgress.recordPracticeOutcome;
  let outcomeSession;
  outcomeProgress.recordPracticeOutcome = function () {
    recordOutcome.apply(this, arguments);
    assert.deepEqual(outcomeSession.getState(), {
      status: 'active', phase: 'independent', character: '潮', index: 0, total: 2,
      mistakes: 0, newlyMasteredCount: 0, completedCharacters: [], remainingCharacters: ['潮', '据'], needsPracticeCharacters: []
    });
    assert.throws(() => outcomeSession.recordStrokeMistake(), /mutation/i);
  };
  outcomeSession = createPracticeSession(options(outcomeProgress));
  assert.deepEqual(Object.keys(outcomeSession).sort(), [
    'completeCharacter', 'defer', 'destroy', 'getState', 'recordStrokeMistake', 'restart',
    'retry', 'skipCurrent'
  ]);
  outcomeSession.completeCharacter({ totalMistakes: 0 });
  assert.equal(outcomeCalls(outcomeProgress).length, 1);
  assert.equal(outcomeProgress.calls.filter(([name]) => name === 'saveGroup').length, 0);

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
  const markComplete = markProgress.recordPracticeOutcome;
  let markSession;
  markProgress.recordPracticeOutcome = function () {
    markComplete.apply(this, arguments);
    assert.throws(() => markSession.completeCharacter({ totalMistakes: 0 }), /mutation/i);
  };
  markSession = createPracticeSession(options(markProgress, { scope: 'single' }));
  markSession.completeCharacter({ totalMistakes: 0 });
  assert.equal(outcomeCalls(markProgress).length, 1);
  assert.equal(markProgress.calls.filter(([name]) => name === 'saveGroup').length, 0);

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
  assert.equal(retryProgress.calls.filter(([name]) => name === 'saveGroup').length, 1);

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
  assert.equal(deferProgress.calls.filter(([name]) => name === 'saveGroup').length, 1);
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
  const recordOutcome = recordProgress.recordPracticeOutcome;
  shouldThrow = true;
  recordProgress.recordPracticeOutcome = function () {
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
      schemaVersion: 2,
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

test('atomic outcome writes expose only valid group retry success to reentrant readers', () => {
  let storedValue = null;
  let inspectWrite = null;
  const observed = [];
  const storage = {
    getItem: () => storedValue,
    setItem(_key, value) {
      storedValue = value;
      if (inspectWrite) inspectWrite();
    }
  };
  const progress = createPracticeProgressStore(storage);
  const session = createPracticeSession(options(progress));
  session.completeCharacter({ totalMistakes: 0 });
  session.completeCharacter({ totalMistakes: 1 });
  session.retry();
  inspectWrite = () => {
    const reader = createPracticeProgressStore({
      getItem: () => storedValue,
      setItem() {}
    });
    observed.push(createPracticeSession(options(reader)).getState());
  };

  session.completeCharacter({ totalMistakes: 0 });

  assert.equal(observed.length, 1);
  assert.deepEqual(observed[0], {
    status: 'active', phase: 'guided', character: '据', index: 1, total: 2,
    mistakes: 0, newlyMasteredCount: 1,
    completedCharacters: ['潮'], remainingCharacters: ['据'], needsPracticeCharacters: []
  });
});

test('atomic single failure and success expose reconciled current round states to reentrant readers', () => {
  let storedValue = null;
  let inspectWrite = null;
  const observed = [];
  const storage = {
    getItem: () => storedValue,
    setItem(_key, value) {
      storedValue = value;
      if (inspectWrite) inspectWrite();
    }
  };
  const progress = createPracticeProgressStore(storage);
  progress.saveGroup('lesson-1', 'write', groupProgress({
    roundCharacters: ['潮', '据'],
    remainingCharacters: ['潮', '据'],
    currentCharacter: '潮',
    currentPhase: 'guided'
  }));
  const single = createPracticeSession(options(progress, { scope: 'single' }));
  single.completeCharacter({ totalMistakes: 0 });
  inspectWrite = () => {
    const reader = createPracticeProgressStore({
      getItem: () => storedValue,
      setItem() {}
    });
    observed.push(createPracticeSession(options(reader)).getState());
  };

  single.completeCharacter({ totalMistakes: 1 });
  single.retry();
  single.completeCharacter({ totalMistakes: 0 });

  assert.deepEqual(observed, [
    {
      status: 'active', phase: 'independent', character: '潮', index: 0, total: 2,
      mistakes: 0, newlyMasteredCount: 0,
      completedCharacters: ['潮'], remainingCharacters: ['潮', '据'],
      needsPracticeCharacters: []
    },
    {
      status: 'active', phase: 'guided', character: '据', index: 1, total: 2,
      mistakes: 0, newlyMasteredCount: 0,
      completedCharacters: ['潮'], remainingCharacters: ['据'], needsPracticeCharacters: []
    }
  ]);
});

test('normalizes a future single completion into queue progress accepted by the practice model', async () => {
  const progress = createPracticeProgressStore(createStorage());
  progress.saveGroup('lesson-1', 'write', groupProgress({
    remainingCharacters: ['潮', '据'], currentCharacter: '潮', currentPhase: 'guided'
  }));

  const singleLater = createPracticeSession(options(progress, { scope: 'single', startCharacter: '据' }));
  singleLater.completeCharacter({ totalMistakes: 0 });
  singleLater.completeCharacter({ totalMistakes: 0 });
  assert.deepEqual(progress.getGroup('lesson-1', 'write').completedCharacters, ['据']);

  const group = createPracticeSession(options(progress));
  assert.deepEqual(group.getState(), {
    status: 'active', phase: 'guided', character: '潮', index: 1, total: 2,
    mistakes: 0, newlyMasteredCount: 0, completedCharacters: ['据'], remainingCharacters: ['潮'], needsPracticeCharacters: []
  });
  const store = await createRuntimeStore();
  const resolved = {
    ...store.resolve({ lessonId: 'lesson-1', group: 'write', character: '潮' }),
    scope: 'group'
  };
  assert.doesNotThrow(() => createPracticeModel(
    resolved,
    { ...group.getState(), masteredCount: 1 },
    true
  ));

  group.completeCharacter({ totalMistakes: 0 });
  group.completeCharacter({ totalMistakes: 0 });
  assert.deepEqual(progress.getGroup('lesson-1', 'write'), groupProgress({
    completedCharacters: ['据', '潮'], roundCharacters: ['潮', '据'],
    roundCompletedCharacters: ['潮', '据'], remainingCharacters: [], needsPracticeCharacters: [],
    roundNewlyMasteredCharacters: ['潮'],
    currentCharacter: null, currentPhase: null
  }));

  const resumed = createPracticeSession(options(progress));
  assert.deepEqual(resumed.getState(), {
    status: 'complete', phase: null, character: null, index: 2, total: 2,
    mistakes: 0, newlyMasteredCount: 1, completedCharacters: ['潮', '据'], remainingCharacters: [], needsPracticeCharacters: []
  });
});

test('advances a saved group when its guided current character completes in single scope', () => {
  const progress = createPracticeProgressStore(createStorage());
  progress.saveGroup('lesson-1', 'write', groupProgress({
    remainingCharacters: ['潮', '据'], currentCharacter: '潮', currentPhase: 'guided'
  }));

  const singleCurrent = createPracticeSession(options(progress, { scope: 'single' }));
  singleCurrent.completeCharacter({ totalMistakes: 0 });
  singleCurrent.completeCharacter({ totalMistakes: 0 });
  progress.recordCharacterOutcome('据', 'mastered');

  const group = createPracticeSession(options(progress));
  assert.deepEqual(group.getState(), {
    status: 'active', phase: 'independent', character: '据', index: 1, total: 2,
    mistakes: 0, newlyMasteredCount: 0, completedCharacters: ['潮'], remainingCharacters: ['据'], needsPracticeCharacters: []
  });
});

test('single current failure remains a group retry and a later single success advances it', () => {
  const progress = createPracticeProgressStore(createStorage());
  progress.saveGroup('lesson-1', 'write', groupProgress({
    roundCharacters: ['潮', '据'],
    remainingCharacters: ['潮', '据'],
    currentCharacter: '潮',
    currentPhase: 'guided'
  }));
  const single = createPracticeSession(options(progress, { scope: 'single' }));

  single.completeCharacter({ totalMistakes: 0 });
  single.completeCharacter({ totalMistakes: 2 });
  const retryingGroup = createPracticeSession(options(progress));
  assert.deepEqual(retryingGroup.getState(), {
    status: 'active', phase: 'independent', character: '潮', index: 0, total: 2,
    mistakes: 0, newlyMasteredCount: 0,
    completedCharacters: ['潮'], remainingCharacters: ['潮', '据'],
    needsPracticeCharacters: []
  });
  retryingGroup.destroy();

  single.retry();
  single.completeCharacter({ totalMistakes: 0 });
  const advancedGroup = createPracticeSession(options(progress));
  assert.deepEqual(advancedGroup.getState(), {
    status: 'active', phase: 'guided', character: '据', index: 1, total: 2,
    mistakes: 0, newlyMasteredCount: 0,
    completedCharacters: ['潮'], remainingCharacters: ['据'], needsPracticeCharacters: []
  });
});

test('single future failure defers it into group needs and later success clears the need', () => {
  const progress = createPracticeProgressStore(createStorage());
  progress.saveGroup('lesson-1', 'write', groupProgress({
    roundCharacters: ['潮', '据'],
    remainingCharacters: ['潮', '据'],
    currentCharacter: '潮',
    currentPhase: 'guided'
  }));
  const single = createPracticeSession(options(progress, {
    scope: 'single', startCharacter: '据'
  }));

  single.completeCharacter({ totalMistakes: 0 });
  single.completeCharacter({ totalMistakes: 1 });
  let group = createPracticeSession(options(progress));
  assert.deepEqual(group.getState(), {
    status: 'active', phase: 'guided', character: '潮', index: 1, total: 2,
    mistakes: 0, newlyMasteredCount: 0,
    completedCharacters: ['据'], remainingCharacters: ['潮'], needsPracticeCharacters: ['据']
  });
  group.destroy();

  single.retry();
  single.completeCharacter({ totalMistakes: 0 });
  group = createPracticeSession(options(progress));
  assert.deepEqual(group.getState(), {
    status: 'active', phase: 'guided', character: '潮', index: 1, total: 2,
    mistakes: 0, newlyMasteredCount: 0,
    completedCharacters: ['据'], remainingCharacters: ['潮'], needsPracticeCharacters: []
  });
});

test('resumes a genuine failed independent group attempt at the current character', () => {
  const progress = createPracticeProgressStore(createStorage());
  const group = createPracticeSession(options(progress));

  group.completeCharacter({ totalMistakes: 0 });
  group.completeCharacter({ totalMistakes: 2 });
  assert.deepEqual(progress.getCharacter('潮'), {
    attemptCount: 1, lastOutcome: 'needs-practice', mastered: false
  });

  const resumed = createPracticeSession(options(progress));
  assert.deepEqual(resumed.getState(), {
    status: 'active', phase: 'independent', character: '潮', index: 0, total: 2,
    mistakes: 0, newlyMasteredCount: 0, completedCharacters: ['潮'], remainingCharacters: ['潮', '据'],
    needsPracticeCharacters: []
  });
});

test('advances an independent saved current after a later single-scope mastery', () => {
  const progress = createPracticeProgressStore(createStorage());
  const group = createPracticeSession(options(progress));
  group.completeCharacter({ totalMistakes: 0 });
  group.destroy();

  const singleCurrent = createPracticeSession(options(progress, { scope: 'single' }));
  singleCurrent.completeCharacter({ totalMistakes: 0 });
  singleCurrent.completeCharacter({ totalMistakes: 0 });

  const resumed = createPracticeSession(options(progress));
  assert.deepEqual(resumed.getState(), {
    status: 'active', phase: 'guided', character: '据', index: 1, total: 2,
    mistakes: 0, newlyMasteredCount: 0, completedCharacters: ['潮'], remainingCharacters: ['据'],
    needsPracticeCharacters: []
  });
});

test('completes an independent saved group after every character is mastered in single scope', () => {
  const progress = createPracticeProgressStore(createStorage());
  const group = createPracticeSession(options(progress));
  group.completeCharacter({ totalMistakes: 0 });
  group.destroy();

  const singleLater = createPracticeSession(options(progress, {
    scope: 'single', startCharacter: '据'
  }));
  singleLater.completeCharacter({ totalMistakes: 0 });
  singleLater.completeCharacter({ totalMistakes: 0 });
  const singleCurrent = createPracticeSession(options(progress, { scope: 'single' }));
  singleCurrent.completeCharacter({ totalMistakes: 0 });
  singleCurrent.completeCharacter({ totalMistakes: 0 });

  const resumed = createPracticeSession(options(progress));
  assert.deepEqual(resumed.getState(), {
    status: 'complete', phase: null, character: null, index: 2, total: 2,
    mistakes: 0, newlyMasteredCount: 0, completedCharacters: ['潮', '据'], remainingCharacters: [],
    needsPracticeCharacters: []
  });
});

test('restores append-order cross-scope completions but rejects reversed needs lists', () => {
  const progress = createPracticeProgressStore(createStorage());
  progress.saveGroup('lesson-1', 'write', groupProgress({
    remainingCharacters: ['潮', '据'], currentCharacter: '潮', currentPhase: 'guided'
  }));

  const singleLater = createPracticeSession(options(progress, { scope: 'single', startCharacter: '据' }));
  singleLater.completeCharacter({ totalMistakes: 0 });
  singleLater.completeCharacter({ totalMistakes: 0 });
  const singleCurrent = createPracticeSession(options(progress, { scope: 'single' }));
  singleCurrent.completeCharacter({ totalMistakes: 0 });
  singleCurrent.completeCharacter({ totalMistakes: 0 });
  assert.deepEqual(progress.getGroup('lesson-1', 'write').completedCharacters, ['据', '潮']);

  const complete = createPracticeSession(options(progress));
  assert.deepEqual(complete.getState(), {
    status: 'complete', phase: null, character: null, index: 2, total: 2,
    mistakes: 0, newlyMasteredCount: 0, completedCharacters: ['潮', '据'], remainingCharacters: [], needsPracticeCharacters: []
  });

  progress.saveGroup('lesson-2', 'write', groupProgress({
    completedCharacters: ['据', '潮'], remainingCharacters: [], needsPracticeCharacters: ['据', '潮'],
    currentCharacter: null, currentPhase: null
  }));
  const reversedNeeds = createPracticeSession(options(progress, { lessonId: 'lesson-2' }));
  assert.deepEqual(reversedNeeds.getState(), {
    status: 'active', phase: 'independent', character: '潮', index: 0, total: 2,
    mistakes: 0, newlyMasteredCount: 0, completedCharacters: [], remainingCharacters: ['潮', '据'],
    needsPracticeCharacters: []
  });

  progress.saveGroup('lesson-3', 'write', groupProgress({
    completedCharacters: ['据'], roundCharacters: ['潮', '据'],
    roundCompletedCharacters: ['据'], remainingCharacters: ['潮'],
    needsPracticeCharacters: ['据'],
    currentCharacter: '潮', currentPhase: 'independent'
  }));
  const deferred = createPracticeSession(options(progress, { lessonId: 'lesson-3' }));
  deferred.completeCharacter({ totalMistakes: 1 });
  deferred.defer();
  assert.deepEqual(progress.getGroup('lesson-3', 'write'), groupProgress({
    completedCharacters: ['据', '潮'], roundCharacters: ['潮', '据'],
    roundCompletedCharacters: ['潮', '据'], remainingCharacters: [],
    needsPracticeCharacters: ['潮', '据'],
    currentCharacter: null, currentPhase: null
  }));
  const resumedDeferred = createPracticeSession(options(progress, { lessonId: 'lesson-3' }));
  assert.deepEqual(resumedDeferred.getState().needsPracticeCharacters, ['潮', '据']);
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

test('resume counts only explicitly persisted newly-mastered round characters', () => {
  const progress = createFakeProgress({
    characters: {
      '潮': { attemptCount: 1, lastOutcome: 'mastered', mastered: true }
    },
    group: groupProgress({
      completedCharacters: ['潮'],
      roundCharacters: ['潮', '据'],
      roundCompletedCharacters: ['潮'],
      remainingCharacters: ['据'],
      roundInitialMasteredCharacters: [],
      roundNewlyMasteredCharacters: ['潮'],
      currentCharacter: '据',
      currentPhase: 'guided'
    })
  });

  const session = createPracticeSession(options(progress));

  assert.deepEqual(session.getState(), {
    status: 'active', phase: 'guided', character: '据', index: 1, total: 2,
    mistakes: 0, newlyMasteredCount: 1,
    completedCharacters: ['潮'], remainingCharacters: ['据'], needsPracticeCharacters: []
  });
  session.destroy();
  assert.deepEqual(progress.group().roundNewlyMasteredCharacters, ['潮']);
});

test('resume never infers newly-mastered count from global character mastery', () => {
  const progress = createFakeProgress({
    characters: {
      '据': { attemptCount: 1, lastOutcome: 'mastered', mastered: true }
    },
    group: groupProgress({
      completedCharacters: ['据'],
      roundCharacters: ['据'],
      remainingCharacters: ['据'],
      currentCharacter: '据',
      currentPhase: 'independent'
    })
  });

  const session = createPracticeSession(options(progress));

  assert.equal(session.getState().newlyMasteredCount, 0);
});

test('fresh rounds baseline existing mastery and count only mastery gained this round', () => {
  const progress = createFakeProgress({
    characters: {
      '潮': { attemptCount: 1, lastOutcome: 'mastered', mastered: true }
    },
    group: groupProgress({
      completedCharacters: ['潮', '据'],
      roundCharacters: ['潮', '据'],
      roundCompletedCharacters: ['潮', '据']
    })
  });
  const session = createPracticeSession(options(progress, { resume: false }));

  assert.equal(session.getState().newlyMasteredCount, 0);
  session.completeCharacter({ totalMistakes: 0 });
  session.completeCharacter({ totalMistakes: 0 });
  session.completeCharacter({ totalMistakes: 0 });

  assert.equal(session.getState().newlyMasteredCount, 1);
  assert.deepEqual(progress.group().completedCharacters, ['潮', '据']);
  assert.deepEqual(progress.group().roundInitialMasteredCharacters, ['潮']);
});

test('group unavailable skips advance without attempts or cumulative completion', () => {
  const progress = createFakeProgress();
  const session = createPracticeSession(options(progress));

  session.skipCurrent();
  assert.deepEqual(session.getState(), {
    status: 'active', phase: 'guided', character: '据', index: 1, total: 2,
    mistakes: 0, newlyMasteredCount: 0,
    completedCharacters: [], remainingCharacters: ['据'], needsPracticeCharacters: ['潮']
  });
  session.skipCurrent();
  assert.deepEqual(session.getState(), {
    status: 'complete', phase: null, character: null, index: 2, total: 2,
    mistakes: 0, newlyMasteredCount: 0,
    completedCharacters: [], remainingCharacters: [], needsPracticeCharacters: ['潮', '据']
  });
  assert.deepEqual(progress.calls.filter(([name]) => (
    name === 'recordPracticeOutcome'
  )), []);
  assert.deepEqual(progress.group().completedCharacters, []);

  const single = createPracticeSession(options(createFakeProgress(), { scope: 'single' }));
  assert.throws(() => single.skipCurrent(), /group/i);
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
