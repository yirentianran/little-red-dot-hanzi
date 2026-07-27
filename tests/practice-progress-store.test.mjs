import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

import practiceProgressModule from '../js/practice-progress-store.js';

const { PRACTICE_STORAGE_KEY, createPracticeProgressStore } = practiceProgressModule;

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
  if (!Object.hasOwn(overrides, 'roundCharacters')) {
    result.roundCharacters = [...new Set([
      ...result.roundCompletedCharacters,
      ...result.remainingCharacters,
      ...result.needsPracticeCharacters
    ])];
  }
  return result;
}

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  const calls = [];
  return {
    calls,
    getItem(key) {
      calls.push(['getItem', key]);
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      calls.push(['setItem', key, value]);
      values.set(key, value);
    },
    value(key) {
      return values.get(key);
    }
  };
}

function assertFrozen(value) {
  if (!value || typeof value !== 'object') return;
  assert.ok(Object.isFrozen(value));
  Object.values(value).forEach(assertFrozen);
}

test('records global outcomes separately from lesson group completion', () => {
  const store = createPracticeProgressStore(createStorage());

  const character = store.recordCharacterOutcome('潮', 'mastered');
  store.saveGroup('lesson-1', 'write', groupProgress({ completedCharacters: ['据'] }));

  assert.deepEqual(character, { attemptCount: 1, lastOutcome: 'mastered', mastered: true });
  assert.deepEqual(store.getCharacter('潮'), character);
  assert.deepEqual(store.getGroup('lesson-1', 'write'), groupProgress({ completedCharacters: ['据'] }));
  assert.deepEqual(store.getCharacter('据'), { attemptCount: 0, lastOutcome: null, mastered: false });
});

test('v2 filtered round saves preserve monotonic cumulative completion', () => {
  const store = createPracticeProgressStore(createStorage());
  store.saveGroup('lesson-1', 'write', groupProgress({
    completedCharacters: ['潮', '据', '熟'],
    roundCharacters: ['潮', '据', '熟'],
    roundCompletedCharacters: ['潮', '据', '熟']
  }));

  store.saveGroup('lesson-1', 'write', groupProgress({
    completedCharacters: [],
    roundCharacters: ['据'],
    remainingCharacters: ['据'],
    needsPracticeCharacters: [],
    roundInitialMasteredCharacters: ['据'],
    currentCharacter: '据',
    currentPhase: 'independent'
  }));

  assert.deepEqual(store.getGroup('lesson-1', 'write'), groupProgress({
    completedCharacters: ['潮', '据', '熟'],
    roundCharacters: ['据'],
    remainingCharacters: ['据'],
    roundInitialMasteredCharacters: ['据'],
    currentCharacter: '据',
    currentPhase: 'independent'
  }));
});

test('marking completion reconciles an active round and leaves outside characters cumulative only', () => {
  const store = createPracticeProgressStore(createStorage());
  store.saveGroup('lesson-1', 'write', groupProgress({
    roundCharacters: ['潮', '据'],
    remainingCharacters: ['潮', '据'],
    currentCharacter: '潮',
    currentPhase: 'guided'
  }));
  store.recordCharacterOutcome('潮', 'mastered');

  store.markGroupCharacterCompleted('lesson-1', 'write', '潮', 'mastered');
  store.markGroupCharacterCompleted('lesson-1', 'write', '熟', 'mastered');

  assert.deepEqual(store.getGroup('lesson-1', 'write'), groupProgress({
    completedCharacters: ['潮', '熟'],
    roundCharacters: ['潮', '据'],
    roundCompletedCharacters: ['潮'],
    remainingCharacters: ['据'],
    currentCharacter: '据',
    currentPhase: 'guided'
  }));
});

test('cross-scope outcomes reconcile current retries and future needs without losing cumulative completion', () => {
  const currentStore = createPracticeProgressStore(createStorage());
  currentStore.saveGroup('lesson-1', 'write', groupProgress({
    roundCharacters: ['潮', '据'],
    remainingCharacters: ['潮', '据'],
    currentCharacter: '潮',
    currentPhase: 'guided'
  }));
  currentStore.recordCharacterOutcome('潮', 'needs-practice');
  currentStore.markGroupCharacterCompleted('lesson-1', 'write', '潮', 'needs-practice');

  assert.deepEqual(currentStore.getGroup('lesson-1', 'write'), groupProgress({
    completedCharacters: ['潮'],
    roundCharacters: ['潮', '据'],
    roundCompletedCharacters: ['潮'],
    remainingCharacters: ['潮', '据'],
    currentCharacter: '潮',
    currentPhase: 'independent'
  }));

  const futureStore = createPracticeProgressStore(createStorage());
  futureStore.saveGroup('lesson-1', 'write', groupProgress({
    roundCharacters: ['潮', '据'],
    remainingCharacters: ['潮', '据'],
    currentCharacter: '潮',
    currentPhase: 'guided'
  }));
  futureStore.recordCharacterOutcome('据', 'needs-practice');
  futureStore.markGroupCharacterCompleted('lesson-1', 'write', '据', 'needs-practice');

  assert.deepEqual(futureStore.getGroup('lesson-1', 'write'), groupProgress({
    completedCharacters: ['据'],
    roundCharacters: ['潮', '据'],
    roundCompletedCharacters: ['据'],
    remainingCharacters: ['潮'],
    needsPracticeCharacters: ['据'],
    currentCharacter: '潮',
    currentPhase: 'guided'
  }));
});

test('round newly-mastered progress is explicit, validated, and not credited to cross-scope success', () => {
  const store = createPracticeProgressStore(createStorage());
  store.recordCharacterOutcome('潮', 'mastered');
  store.saveGroup('lesson-1', 'write', groupProgress({
    completedCharacters: ['潮'],
    roundCharacters: ['潮', '据'],
    roundCompletedCharacters: ['潮'],
    remainingCharacters: ['据'],
    roundNewlyMasteredCharacters: ['潮'],
    currentCharacter: '据',
    currentPhase: 'guided'
  }));

  store.recordCharacterOutcome('据', 'mastered');
  store.markGroupCharacterCompleted('lesson-1', 'write', '据', 'mastered');
  assert.deepEqual(
    store.getGroup('lesson-1', 'write').roundNewlyMasteredCharacters,
    ['潮']
  );

  store.recordCharacterOutcome('潮', 'needs-practice');
  store.markGroupCharacterCompleted('lesson-1', 'write', '潮', 'needs-practice');
  assert.deepEqual(store.getGroup('lesson-1', 'write').roundNewlyMasteredCharacters, []);

  assert.throws(() => store.saveGroup('lesson-2', 'write', groupProgress({
    roundCharacters: ['潮'],
    remainingCharacters: ['潮'],
    roundNewlyMasteredCharacters: ['潮'],
    currentCharacter: '潮',
    currentPhase: 'guided'
  })), TypeError);
  assert.throws(() => store.saveGroup('lesson-2', 'write', groupProgress({
    completedCharacters: ['潮'],
    roundCharacters: ['潮'],
    roundCompletedCharacters: ['潮'],
    roundInitialMasteredCharacters: ['潮'],
    roundNewlyMasteredCharacters: ['潮']
  })), TypeError);
});

test('recordPracticeOutcome commits character and group reconciliation in one write', () => {
  const storage = createStorage();
  const store = createPracticeProgressStore(storage);
  store.saveGroup('lesson-1', 'write', groupProgress({
    roundCharacters: ['潮', '据'],
    remainingCharacters: ['潮', '据'],
    currentCharacter: '潮',
    currentPhase: 'guided'
  }));
  storage.calls.length = 0;

  store.recordPracticeOutcome(
    'lesson-1', 'write', 'single', '潮', 'needs-practice', null
  );

  assert.equal(storage.calls.filter(([name]) => name === 'setItem').length, 1);
  assert.deepEqual(store.getCharacter('潮'), {
    attemptCount: 1, lastOutcome: 'needs-practice', mastered: false
  });
  assert.deepEqual(store.getGroup('lesson-1', 'write'), groupProgress({
    completedCharacters: ['潮'],
    roundCharacters: ['潮', '据'],
    roundCompletedCharacters: ['潮'],
    remainingCharacters: ['潮', '据'],
    currentCharacter: '潮',
    currentPhase: 'independent'
  }));
});

test('recordPracticeOutcome atomically rejects group snapshots that contradict the outcome', () => {
  const storage = createStorage();
  const store = createPracticeProgressStore(storage);
  storage.calls.length = 0;

  assert.throws(() => store.recordPracticeOutcome(
    'lesson-1', 'write', 'group', '潮', 'mastered', groupProgress({
      roundCharacters: ['潮'],
      remainingCharacters: ['潮'],
      currentCharacter: '潮',
      currentPhase: 'guided'
    })
  ), TypeError);
  assert.throws(() => store.recordPracticeOutcome(
    'lesson-1', 'write', 'group', '潮', 'needs-practice', groupProgress({
      completedCharacters: ['潮'],
      roundCharacters: ['潮'],
      roundCompletedCharacters: ['潮']
    })
  ), TypeError);
  assert.throws(() => store.recordPracticeOutcome(
    'lesson-1', 'write', 'group', '潮', 'needs-practice', groupProgress({
      roundCharacters: ['潮'],
      roundCompletedCharacters: ['潮'],
      remainingCharacters: ['潮'],
      roundNewlyMasteredCharacters: ['潮'],
      currentCharacter: '潮',
      currentPhase: 'independent'
    })
  ), TypeError);
  assert.throws(() => store.recordPracticeOutcome(
    'lesson-1', 'write', 'group', '潮', 'mastered', groupProgress({
      roundCharacters: ['潮'],
      roundCompletedCharacters: ['潮']
    })
  ), TypeError);

  assert.equal(storage.calls.filter(([name]) => name === 'setItem').length, 0);
  assert.deepEqual(store.getCharacter('潮'), {
    attemptCount: 0, lastOutcome: null, mastered: false
  });
  assert.equal(store.getGroup('lesson-1', 'write'), null);
});

test('schema v1 stored under the v2 key resets without disabling persistence', () => {
  const storage = createStorage({
    [PRACTICE_STORAGE_KEY]: JSON.stringify({ schemaVersion: 1, characters: {}, groups: {} })
  });
  const store = createPracticeProgressStore(storage);

  assert.deepEqual(store.getSnapshot(), { schemaVersion: 2, characters: {}, groups: {} });
  assert.equal(store.isPersistent(), true);
  store.recordCharacterOutcome('潮', 'mastered');
  assert.equal(JSON.parse(storage.value(PRACTICE_STORAGE_KEY)).schemaVersion, 2);
});

test('persists global and group progress for a subsequent frozen store instance', () => {
  const storage = createStorage();
  const first = createPracticeProgressStore(storage);
  const expectedGroup = groupProgress({
    completedCharacters: ['潮'],
    remainingCharacters: ['据'],
    needsPracticeCharacters: ['潮'],
    currentCharacter: '据',
    currentPhase: 'independent'
  });

  first.recordCharacterOutcome('潮', 'mastered');
  first.saveGroup('lesson-1', 'write', expectedGroup);
  const second = createPracticeProgressStore(storage);

  assert.deepEqual(second.getCharacter('潮'), { attemptCount: 1, lastOutcome: 'mastered', mastered: true });
  assert.deepEqual(second.getGroup('lesson-1', 'write'), expectedGroup);
  assertFrozen(second.getCharacter('潮'));
  assertFrozen(second.getGroup('lesson-1', 'write'));
  assertFrozen(second.getSnapshot());
  assert.deepEqual(
    storage.calls.map(([method, key]) => [method, key]),
    [
      ['getItem', PRACTICE_STORAGE_KEY],
      ['setItem', PRACTICE_STORAGE_KEY],
      ['setItem', PRACTICE_STORAGE_KEY],
      ['getItem', PRACTICE_STORAGE_KEY]
    ]
  );
});

test('accepts a completed group with no queue and null current state', () => {
  const store = createPracticeProgressStore();
  const completed = groupProgress({ completedCharacters: ['潮'] });

  store.saveGroup('lesson-1', 'write', completed);

  assert.deepEqual(store.getGroup('lesson-1', 'write'), completed);
});

test('single character completion outside the active round preserves its queue fields', () => {
  const store = createPracticeProgressStore();
  const active = groupProgress({
    remainingCharacters: ['潮', '据'],
    currentCharacter: '潮',
    currentPhase: 'guided'
  });
  store.saveGroup('lesson-1', 'write', active);

  store.markGroupCharacterCompleted('lesson-1', 'write', '熟', 'mastered');

  assert.deepEqual(store.getGroup('lesson-1', 'write'), groupProgress({
    completedCharacters: ['熟'],
    remainingCharacters: ['潮', '据'],
    currentCharacter: '潮',
    currentPhase: 'guided'
  }));
});

test('a later failed independent outcome downgrades global mastery', () => {
  const store = createPracticeProgressStore();
  store.recordCharacterOutcome('潮', 'mastered');

  const result = store.recordCharacterOutcome('潮', 'needs-practice');

  assert.deepEqual(result, { attemptCount: 2, lastOutcome: 'needs-practice', mastered: false });
});

test('invalid JSON loads an empty schema but leaves readable storage persistent and untouched', () => {
  const storage = createStorage({
    [PRACTICE_STORAGE_KEY]: '{bad json',
    unrelated: 'retain me'
  });

  const store = createPracticeProgressStore(storage);

  assert.deepEqual(store.getSnapshot(), { schemaVersion: 2, characters: {}, groups: {} });
  assert.equal(store.isPersistent(), true);
  assert.equal(storage.value('unrelated'), 'retain me');
  assert.deepEqual(storage.calls, [['getItem', PRACTICE_STORAGE_KEY]]);
});

test('a storage write failure retains the mutation in memory and disables persistence', () => {
  const storage = createStorage();
  let writes = 0;
  storage.setItem = () => {
    writes += 1;
    throw new Error('quota');
  };
  const store = createPracticeProgressStore(storage);

  store.recordCharacterOutcome('潮', 'mastered');
  store.recordCharacterOutcome('据', 'needs-practice');

  assert.deepEqual(store.getCharacter('潮'), { attemptCount: 1, lastOutcome: 'mastered', mastered: true });
  assert.deepEqual(store.getCharacter('据'), { attemptCount: 1, lastOutcome: 'needs-practice', mastered: false });
  assert.equal(store.isPersistent(), false);
  assert.equal(writes, 1);
});

test('validates group arrays and current state rules plus IDs groups characters and outcomes', () => {
  const store = createPracticeProgressStore();
  const active = groupProgress({
    remainingCharacters: ['据'],
    currentCharacter: '据',
    currentPhase: 'guided'
  });

  assert.throws(() => store.saveGroup('lesson-1', 'write', groupProgress({ remainingCharacters: ['据'] })), TypeError);
  assert.throws(() => store.saveGroup('lesson-1', 'write', groupProgress({ currentCharacter: '据', currentPhase: 'guided' })), TypeError);
  assert.throws(() => store.saveGroup('lesson-1', 'write', groupProgress({ completedCharacters: ['潮', '潮'] })), TypeError);
  assert.throws(() => store.saveGroup('lesson-1', 'write', groupProgress({ remainingCharacters: ['A'] })), TypeError);
  assert.throws(() => store.saveGroup('lesson-1', 'write', { ...active, extra: true }), TypeError);
  assert.throws(() => store.saveGroup('', 'write', active), TypeError);
  assert.throws(() => store.saveGroup('lesson 1', 'write', active), TypeError);
  assert.throws(() => store.saveGroup('lesson-1', 'other', active), TypeError);
  assert.throws(() => store.recordCharacterOutcome('两个', 'mastered'), TypeError);
  assert.throws(() => store.recordCharacterOutcome('A', 'mastered'), TypeError);
  assert.throws(() => store.recordCharacterOutcome('潮', 'passed'), TypeError);
  assert.throws(() => store.markGroupCharacterCompleted('lesson-1', 'write', '潮'), TypeError);
  assert.throws(() => store.markGroupCharacterCompleted(
    'lesson-1', 'write', '潮', 'passed'
  ), TypeError);
  assert.throws(() => store.recordPracticeOutcome(
    'lesson-1', 'write', 'other', '潮', 'mastered', null
  ), TypeError);
  assert.throws(() => store.recordPracticeOutcome(
    'lesson-1', 'write', 'single', '潮', 'mastered', active
  ), TypeError);
  assert.throws(() => store.recordPracticeOutcome(
    'lesson-1', 'write', 'group', '潮', 'mastered', null
  ), TypeError);
  assert.throws(() => store.getCharacter('A'), TypeError);
  assert.throws(() => store.getGroup('lesson-1', 'other'), TypeError);
});

test('enforces the public plain own-field boundary without invoking hostile getters', () => {
  const store = createPracticeProgressStore();
  let getterCalls = 0;
  const inheritedRequired = Object.assign(Object.create({ currentCharacter: null }), {
    completedCharacters: [],
    remainingCharacters: [],
    needsPracticeCharacters: [],
    currentPhase: null
  });
  const accessorRequired = groupProgress();
  Object.defineProperty(accessorRequired, 'currentCharacter', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return null;
    }
  });
  const symbolField = groupProgress();
  symbolField[Symbol('hostile')] = true;
  const extraField = groupProgress({ extra: true });
  const sparseArray = groupProgress({ completedCharacters: new Array(1) });
  const arrayWithExtraProperty = groupProgress();
  arrayWithExtraProperty.completedCharacters.note = 'hostile';

  [
    ['inherited required field', inheritedRequired],
    ['accessor required field', accessorRequired],
    ['symbol field', symbolField],
    ['extra field', extraField],
    ['sparse array', sparseArray],
    ['array extra property', arrayWithExtraProperty]
  ].forEach(([, progress]) => {
    assert.throws(() => store.saveGroup('lesson-1', 'write', progress), TypeError);
  });

  const nullPrototype = Object.assign(Object.create(null), groupProgress());
  assert.deepEqual(store.saveGroup('lesson-1', 'write', nullPrototype), groupProgress());
  assert.equal(getterCalls, 0);
});

test('freezes returned values recursively and never mutates caller input', () => {
  const store = createPracticeProgressStore();
  const input = groupProgress({
    completedCharacters: ['潮'],
    remainingCharacters: ['据'],
    needsPracticeCharacters: ['潮'],
    currentCharacter: '据',
    currentPhase: 'independent'
  });
  const before = structuredClone(input);

  store.saveGroup('lesson-1', 'write', input);
  const group = store.getGroup('lesson-1', 'write');
  const snapshot = store.getSnapshot();

  assert.deepEqual(input, before);
  assert.notEqual(group, input);
  assert.notEqual(group.completedCharacters, input.completedCharacters);
  assertFrozen(group);
  assertFrozen(snapshot);
  assertFrozen(store.getCharacter('潮'));
  assertFrozen(store);
});

test('corrupt, wrong-version, and nested-invalid stored state all fall back to the empty schema', () => {
  const invalidValues = [
    JSON.stringify({ schemaVersion: 3, characters: {}, groups: {} }),
    JSON.stringify({ schemaVersion: 2, characters: { 潮: { attemptCount: 1, lastOutcome: 'mastered', mastered: false } }, groups: {} }),
    JSON.stringify({ schemaVersion: 2, characters: { 潮: { attemptCount: 0, lastOutcome: 'mastered', mastered: true } }, groups: {} }),
    JSON.stringify({ schemaVersion: 2, characters: {}, groups: {
      'lesson-1:write': groupProgress({ remainingCharacters: ['据'], currentCharacter: '潮', currentPhase: 'guided' })
    } })
  ];

  invalidValues.forEach((value) => {
    const storage = createStorage({ [PRACTICE_STORAGE_KEY]: value });
    const store = createPracticeProgressStore(storage);
    assert.deepEqual(store.getSnapshot(), { schemaVersion: 2, characters: {}, groups: {} });
    assert.equal(store.isPersistent(), true);
  });
});

test('rejects hostile persisted state dictionaries and unsafe character counts', () => {
  const validRecord = { attemptCount: 1, lastOutcome: 'mastered', mastered: true };
  const invalidValues = [
    ['prototype-shaped character key', `{"schemaVersion":2,"characters":{"__proto__":${JSON.stringify(validRecord)}},"groups":{}}`],
    ['prototype-shaped group key', `{"schemaVersion":2,"characters":{},"groups":{"constructor":${JSON.stringify(groupProgress())}}}`],
    ['unsafe count', JSON.stringify({
      schemaVersion: 2,
      characters: { 潮: { attemptCount: Number.MAX_SAFE_INTEGER + 1, lastOutcome: 'mastered', mastered: true } },
      groups: {}
    })]
  ];

  invalidValues.forEach(([, value]) => {
    const storage = createStorage({ [PRACTICE_STORAGE_KEY]: value });
    const store = createPracticeProgressStore(storage);
    assert.deepEqual(store.getSnapshot(), { schemaVersion: 2, characters: {}, groups: {} });
    assertFrozen(store.getSnapshot());
    assert.equal(store.isPersistent(), true);
    assert.deepEqual(storage.calls, [['getItem', PRACTICE_STORAGE_KEY]]);
  });
});

test('rejects an independent attempt that would overflow a safe attempt count without writing', () => {
  const storage = createStorage({
    [PRACTICE_STORAGE_KEY]: JSON.stringify({
      schemaVersion: 2,
      characters: {
        潮: { attemptCount: Number.MAX_SAFE_INTEGER, lastOutcome: 'mastered', mastered: true }
      },
      groups: {}
    })
  });
  const store = createPracticeProgressStore(storage);
  const before = store.getSnapshot();
  const callCount = storage.calls.length;

  assert.throws(() => store.recordCharacterOutcome('潮', 'needs-practice'), TypeError);

  assert.equal(store.getSnapshot(), before);
  assert.deepEqual(store.getCharacter('潮'), {
    attemptCount: Number.MAX_SAFE_INTEGER,
    lastOutcome: 'mastered',
    mastered: true
  });
  assert.equal(storage.calls.length, callCount);
});

test('clears only the selected lesson group', () => {
  const store = createPracticeProgressStore();
  store.saveGroup('lesson-1', 'write', groupProgress({ completedCharacters: ['潮'] }));
  store.saveGroup('lesson-1', 'recognize', groupProgress({ completedCharacters: ['据'] }));

  store.clearGroup('lesson-1', 'write');

  assert.equal(store.getGroup('lesson-1', 'write'), null);
  assert.deepEqual(store.getGroup('lesson-1', 'recognize'), groupProgress({ completedCharacters: ['据'] }));
});

test('a storage read failure falls back to a functional in-memory store', () => {
  const storage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('must not be called'); }
  };
  const store = createPracticeProgressStore(storage);

  store.markGroupCharacterCompleted('lesson-1', 'recognize', '潮', 'mastered');

  assert.equal(store.isPersistent(), false);
  assert.deepEqual(store.getGroup('lesson-1', 'recognize'), groupProgress({ completedCharacters: ['潮'] }));
});

test('missing or non-callable storage writers start in functional memory mode', () => {
  [
    { getItem: () => null },
    { getItem: () => null, setItem: false }
  ].forEach((storage) => {
    const store = createPracticeProgressStore(storage);

    assert.equal(store.isPersistent(), false);

    const record = store.recordCharacterOutcome('潮', 'mastered');

    assert.equal(store.isPersistent(), false);
    assert.deepEqual(record, { attemptCount: 1, lastOutcome: 'mastered', mastered: true });
  });
});

test('missing or non-callable storage readers start in functional memory mode', () => {
  [
    { setItem() {} },
    { getItem: false, setItem() {} }
  ].forEach((storage) => {
    const store = createPracticeProgressStore(storage);

    assert.equal(store.isPersistent(), false);
    assert.deepEqual(store.recordCharacterOutcome('潮', 'mastered'), {
      attemptCount: 1,
      lastOutcome: 'mastered',
      mastered: true
    });
  });
});

test('non-string non-null storage reads immediately disable persistence', () => {
  [0, { state: 'not a string' }].forEach((result) => {
    let reads = 0;
    let writes = 0;
    const store = createPracticeProgressStore({
      getItem() {
        reads += 1;
        return result;
      },
      setItem() {
        writes += 1;
      }
    });

    assert.equal(store.isPersistent(), false);
    assert.deepEqual(store.getSnapshot(), { schemaVersion: 2, characters: {}, groups: {} });
    assert.deepEqual(store.recordCharacterOutcome('潮', 'mastered'), {
      attemptCount: 1,
      lastOutcome: 'mastered',
      mastered: true
    });
    assert.equal(reads, 1);
    assert.equal(writes, 0);
  });
});

test('classic browser scripts merge the API without DOM or fetch and preserve HanziApp', async () => {
  const source = await readFile(new URL('../js/practice-progress-store.js', import.meta.url), 'utf8');
  const sentinel = Object.freeze({ preserved: true });
  const context = { window: { HanziApp: { sentinel } } };

  vm.runInNewContext(source, context, { filename: 'js/practice-progress-store.js' });

  assert.equal(context.window.HanziApp.sentinel, sentinel);
  assert.equal(context.window.HanziApp.PRACTICE_STORAGE_KEY, 'hanzi-tracking:practice-progress:v2');
  assert.equal(typeof context.window.HanziApp.createPracticeProgressStore, 'function');
});
