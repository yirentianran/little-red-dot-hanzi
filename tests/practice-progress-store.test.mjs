import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

import practiceProgressModule from '../js/practice-progress-store.js';

const { PRACTICE_STORAGE_KEY, createPracticeProgressStore } = practiceProgressModule;

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

test('accepts a completed group with no queue and null current state', () => {
  const store = createPracticeProgressStore();
  const completed = groupProgress({ completedCharacters: ['潮'] });

  store.saveGroup('lesson-1', 'write', completed);

  assert.deepEqual(store.getGroup('lesson-1', 'write'), completed);
});

test('single character completion preserves active group queue fields', () => {
  const store = createPracticeProgressStore();
  const active = groupProgress({
    remainingCharacters: ['潮', '据'],
    needsPracticeCharacters: ['潮'],
    currentCharacter: '潮',
    currentPhase: 'guided'
  });
  store.saveGroup('lesson-1', 'write', active);

  store.markGroupCharacterCompleted('lesson-1', 'write', '据');

  assert.deepEqual(store.getGroup('lesson-1', 'write'), {
    completedCharacters: ['据'],
    remainingCharacters: ['潮', '据'],
    needsPracticeCharacters: ['潮'],
    currentCharacter: '潮',
    currentPhase: 'guided'
  });
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

  assert.deepEqual(store.getSnapshot(), { schemaVersion: 1, characters: {}, groups: {} });
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
  assert.throws(() => store.getCharacter('A'), TypeError);
  assert.throws(() => store.getGroup('lesson-1', 'other'), TypeError);
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
    JSON.stringify({ schemaVersion: 2, characters: {}, groups: {} }),
    JSON.stringify({ schemaVersion: 1, characters: { 潮: { attemptCount: 1, lastOutcome: 'mastered', mastered: false } }, groups: {} }),
    JSON.stringify({ schemaVersion: 1, characters: { 潮: { attemptCount: 0, lastOutcome: 'mastered', mastered: true } }, groups: {} }),
    JSON.stringify({ schemaVersion: 1, characters: {}, groups: {
      'lesson-1:write': groupProgress({ remainingCharacters: ['据'], currentCharacter: '潮', currentPhase: 'guided' })
    } })
  ];

  invalidValues.forEach((value) => {
    const storage = createStorage({ [PRACTICE_STORAGE_KEY]: value });
    const store = createPracticeProgressStore(storage);
    assert.deepEqual(store.getSnapshot(), { schemaVersion: 1, characters: {}, groups: {} });
    assert.equal(store.isPersistent(), true);
  });
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

  store.markGroupCharacterCompleted('lesson-1', 'recognize', '潮');

  assert.equal(store.isPersistent(), false);
  assert.deepEqual(store.getGroup('lesson-1', 'recognize'), groupProgress({ completedCharacters: ['潮'] }));
});

test('classic browser scripts merge the API without DOM or fetch and preserve HanziApp', async () => {
  const source = await readFile(new URL('../js/practice-progress-store.js', import.meta.url), 'utf8');
  const sentinel = Object.freeze({ preserved: true });
  const context = { window: { HanziApp: { sentinel } } };

  vm.runInNewContext(source, context, { filename: 'js/practice-progress-store.js' });

  assert.equal(context.window.HanziApp.sentinel, sentinel);
  assert.equal(context.window.HanziApp.PRACTICE_STORAGE_KEY, 'hanzi-tracking:practice-progress:v1');
  assert.equal(typeof context.window.HanziApp.createPracticeProgressStore, 'function');
});
