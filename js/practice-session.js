(function (root, factory) {
  'use strict';

  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.window) {
    root.window.HanziApp = Object.assign(root.window.HanziApp || {}, api);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var HAN_CHARACTER = /^\p{Script=Han}$/u;
  var LESSON_ID = /^[a-z][a-z0-9-]*$/;
  var GROUP_FIELDS = Object.freeze([
    'completedCharacters',
    'remainingCharacters',
    'needsPracticeCharacters',
    'currentCharacter',
    'currentPhase'
  ]);
  var PROGRESS_METHODS = Object.freeze([
    'getCharacter',
    'getGroup',
    'recordCharacterOutcome',
    'saveGroup',
    'markGroupCharacterCompleted'
  ]);

  function reject(path, requirement) {
    throw new TypeError(path + ': ' + requirement);
  }

  function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    try {
      var prototype = Object.getPrototypeOf(value);
      return prototype === Object.prototype || prototype === null;
    } catch (_error) {
      return false;
    }
  }

  function requirePlainObject(value, path) {
    if (!isPlainObject(value)) reject(path, 'must be a plain object');
  }

  function ownDataValue(value, key, path) {
    var descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (_error) {
      reject(path + '.' + key, 'must be an own data property');
    }
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      reject(path + '.' + key, 'must be an own data property');
    }
    return descriptor.value;
  }

  function requireOwnAllowedFields(value, required, allowed, path) {
    requirePlainObject(value, path);
    var names;
    var symbols;
    try {
      names = Object.getOwnPropertyNames(value);
      symbols = Object.getOwnPropertySymbols(value);
    } catch (_error) {
      reject(path, 'must expose own fields');
    }
    if (symbols.length !== 0) reject(path, 'must not contain symbol fields');
    names.forEach(function (name) {
      if (allowed.indexOf(name) === -1) reject(path + '.' + name, 'is not allowed');
      ownDataValue(value, name, path);
    });
    required.forEach(function (name) { ownDataValue(value, name, path); });
  }

  function requireRegularArray(value, path) {
    if (!Array.isArray(value)) reject(path, 'must be an array');
    var names;
    var symbols;
    try {
      names = Object.getOwnPropertyNames(value);
      symbols = Object.getOwnPropertySymbols(value);
    } catch (_error) {
      reject(path, 'must be a regular array');
    }
    if (symbols.length !== 0 || names.length !== value.length + 1 || names.indexOf('length') === -1) {
      reject(path, 'must contain only own array elements');
    }
    for (var index = 0; index < value.length; index += 1) {
      if (names.indexOf(String(index)) === -1) reject(path + '[' + index + ']', 'must be an own array element');
    }
  }

  function requireCharacter(value, path) {
    if (typeof value !== 'string' || !HAN_CHARACTER.test(value)) {
      reject(path, 'must be one Unicode Han character');
    }
    return value;
  }

  function cloneEntries(value) {
    requireRegularArray(value, 'options.entries');
    if (value.length === 0) reject('options.entries', 'must not be empty');
    var copied = [];
    var seen = new Set();
    for (var index = 0; index < value.length; index += 1) {
      var path = 'options.entries[' + index + ']';
      var entry = ownDataValue(value, String(index), 'options.entries');
      requirePlainObject(entry, path);
      var character = ownDataValue(entry, 'character', path);
      var pinyin = ownDataValue(entry, 'pinyin', path);
      requireCharacter(character, path + '.character');
      if (typeof pinyin !== 'string' || pinyin.trim() === '') {
        reject(path + '.pinyin', 'must be a non-blank string');
      }
      if (seen.has(character)) reject(path + '.character', 'must not repeat a character');
      seen.add(character);
      copied.push(Object.freeze({ character: character, pinyin: pinyin }));
    }
    return Object.freeze(copied);
  }

  function requireProgress(value) {
    requirePlainObject(value, 'options.progress');
    PROGRESS_METHODS.forEach(function (method) {
      if (typeof ownDataValue(value, method, 'options.progress') !== 'function') {
        reject('options.progress.' + method, 'must be a function');
      }
    });
    return value;
  }

  function cloneCharacterList(value, path, allowedCharacters) {
    requireRegularArray(value, path);
    var copied = [];
    var seen = new Set();
    for (var index = 0; index < value.length; index += 1) {
      var character = ownDataValue(value, String(index), path);
      requireCharacter(character, path + '[' + index + ']');
      if (seen.has(character) || allowedCharacters.indexOf(character) === -1) {
        reject(path + '[' + index + ']', 'must be a unique session character');
      }
      seen.add(character);
      copied.push(character);
    }
    return copied;
  }

  function isOrderedSubset(characters, source) {
    var previous = -1;
    for (var index = 0; index < characters.length; index += 1) {
      var position = source.indexOf(characters[index]);
      if (position <= previous) return false;
      previous = position;
    }
    return true;
  }

  function cloneCompatibleGroup(value, orderedCharacters) {
    try {
      requirePlainObject(value, 'stored group');
      var names = Object.getOwnPropertyNames(value);
      var symbols = Object.getOwnPropertySymbols(value);
      if (symbols.length !== 0 || names.length !== GROUP_FIELDS.length) return null;
      GROUP_FIELDS.forEach(function (field) {
        if (names.indexOf(field) === -1) throw new TypeError('missing field');
      });
      var completed = cloneCharacterList(
        ownDataValue(value, 'completedCharacters', 'stored group'),
        'stored group.completedCharacters', orderedCharacters
      );
      var remaining = cloneCharacterList(
        ownDataValue(value, 'remainingCharacters', 'stored group'),
        'stored group.remainingCharacters', orderedCharacters
      );
      var needsPractice = cloneCharacterList(
        ownDataValue(value, 'needsPracticeCharacters', 'stored group'),
        'stored group.needsPracticeCharacters', orderedCharacters
      );
      if (!isOrderedSubset(remaining, orderedCharacters)
          || !isOrderedSubset(needsPractice, orderedCharacters)) return null;
      var currentCharacter = ownDataValue(value, 'currentCharacter', 'stored group');
      var currentPhase = ownDataValue(value, 'currentPhase', 'stored group');
      if (remaining.length === 0) {
        if (currentCharacter !== null || currentPhase !== null) return null;
      } else if (remaining.indexOf(currentCharacter) === -1
          || currentCharacter !== remaining[0]
          || (currentPhase !== 'guided' && currentPhase !== 'independent')) {
        return null;
      }
      return {
        completedCharacters: completed,
        remainingCharacters: remaining,
        needsPracticeCharacters: needsPractice,
        currentCharacter: currentCharacter,
        currentPhase: currentPhase
      };
    } catch (_error) {
      return null;
    }
  }

  function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.getOwnPropertyNames(value).forEach(function (name) { deepFreeze(value[name]); });
      Object.getOwnPropertySymbols(value).forEach(function (symbol) { deepFreeze(value[symbol]); });
      Object.freeze(value);
    }
    return value;
  }

  function addUnique(list, character) {
    return list.indexOf(character) === -1 ? list.concat([character]) : list.slice();
  }

  function createPracticeSession(options) {
    requireOwnAllowedFields(
      options,
      ['lessonId', 'group', 'scope', 'entries', 'startCharacter', 'progress'],
      ['lessonId', 'group', 'scope', 'entries', 'startCharacter', 'progress', 'resume'],
      'options'
    );
    var lessonId = ownDataValue(options, 'lessonId', 'options');
    if (typeof lessonId !== 'string' || !LESSON_ID.test(lessonId)) {
      reject('options.lessonId', 'must be a non-empty safe lesson id');
    }
    var group = ownDataValue(options, 'group', 'options');
    if (group !== 'write' && group !== 'recognize') reject('options.group', 'must equal write or recognize');
    var scope = ownDataValue(options, 'scope', 'options');
    if (scope !== 'single' && scope !== 'group') reject('options.scope', 'must equal single or group');
    var entries = cloneEntries(ownDataValue(options, 'entries', 'options'));
    var startCharacter = requireCharacter(ownDataValue(options, 'startCharacter', 'options'), 'options.startCharacter');
    var progress = requireProgress(ownDataValue(options, 'progress', 'options'));
    var resume = Object.hasOwn(options, 'resume') ? ownDataValue(options, 'resume', 'options') : true;
    if (typeof resume !== 'boolean') reject('options.resume', 'must be a boolean');

    var orderedCharacters = entries.map(function (entry) { return entry.character; });
    if (orderedCharacters.indexOf(startCharacter) === -1) {
      reject('options.startCharacter', 'must occur in options.entries');
    }
    if (scope === 'single') orderedCharacters = [startCharacter];
    orderedCharacters = Object.freeze(orderedCharacters.slice());

    function phaseFor(character) {
      var record = progress.getCharacter(character);
      return record && typeof record === 'object' && record.mastered === true ? 'independent' : 'guided';
    }

    var state = {
      status: 'active',
      phase: phaseFor(orderedCharacters[0]),
      character: orderedCharacters[0],
      mistakes: 0,
      completedCharacters: [],
      remainingCharacters: orderedCharacters.slice(),
      needsPracticeCharacters: []
    };
    var singleMarked = false;
    var destroyed = false;

    if (scope === 'group' && resume) {
      var restored = cloneCompatibleGroup(progress.getGroup(lessonId, group), orderedCharacters);
      if (restored !== null) {
        state = {
          status: restored.remainingCharacters.length === 0 ? 'complete' : 'active',
          phase: restored.currentPhase,
          character: restored.currentCharacter,
          mistakes: 0,
          completedCharacters: restored.completedCharacters,
          remainingCharacters: restored.remainingCharacters,
          needsPracticeCharacters: restored.needsPracticeCharacters
        };
      }
    }

    function assertAlive() {
      if (destroyed) throw new Error('Practice session has been destroyed');
    }

    function currentIndex(nextState) {
      return nextState.character === null ? orderedCharacters.length : orderedCharacters.indexOf(nextState.character);
    }

    function snapshot(nextState) {
      return deepFreeze({
        status: nextState.status,
        phase: nextState.phase,
        character: nextState.character,
        index: currentIndex(nextState),
        total: orderedCharacters.length,
        mistakes: nextState.mistakes,
        completedCharacters: nextState.completedCharacters.slice(),
        remainingCharacters: nextState.remainingCharacters.slice(),
        needsPracticeCharacters: nextState.needsPracticeCharacters.slice()
      });
    }

    function groupSnapshot(nextState) {
      return deepFreeze({
        completedCharacters: nextState.completedCharacters.slice(),
        remainingCharacters: nextState.remainingCharacters.slice(),
        needsPracticeCharacters: nextState.needsPracticeCharacters.slice(),
        currentCharacter: nextState.character,
        currentPhase: nextState.phase
      });
    }

    function saveGroup(nextState) {
      if (scope === 'group') progress.saveGroup(lessonId, group, groupSnapshot(nextState));
    }

    function commit(nextState, shouldSave) {
      if (shouldSave) saveGroup(nextState);
      state = nextState;
    }

    function getState() {
      assertAlive();
      return snapshot(state);
    }

    function recordStrokeMistake() {
      assertAlive();
      if (state.status !== 'active') return;
      state = Object.assign({}, state, { mistakes: state.mistakes + 1 });
    }

    function completeCharacter(input) {
      assertAlive();
      requireOwnAllowedFields(input, ['totalMistakes'], ['totalMistakes'], 'completion');
      var totalMistakes = ownDataValue(input, 'totalMistakes', 'completion');
      if (!Number.isSafeInteger(totalMistakes) || totalMistakes < 0) {
        reject('completion.totalMistakes', 'must be a non-negative safe integer');
      }
      if (state.status !== 'active') throw new Error('Practice session is not active');
      if (state.phase === 'guided') {
        commit(Object.assign({}, state, { phase: 'independent', mistakes: 0 }), true);
        return;
      }

      var character = state.character;
      var completed = addUnique(state.completedCharacters, character);
      if (scope === 'single' && !singleMarked) {
        progress.markGroupCharacterCompleted(lessonId, group, character);
        singleMarked = true;
      }
      if (totalMistakes > 0) {
        progress.recordCharacterOutcome(character, 'needs-practice');
        commit({
          status: 'needs-retry', phase: 'independent', character: character, mistakes: totalMistakes,
          completedCharacters: completed, remainingCharacters: state.remainingCharacters.slice(),
          needsPracticeCharacters: state.needsPracticeCharacters.slice()
        }, true);
        return;
      }

      progress.recordCharacterOutcome(character, 'mastered');
      var remaining = state.remainingCharacters.filter(function (item) { return item !== character; });
      if (remaining.length === 0) {
        commit({
          status: 'complete', phase: null, character: null, mistakes: 0,
          completedCharacters: completed, remainingCharacters: [],
          needsPracticeCharacters: state.needsPracticeCharacters.slice()
        }, true);
        return;
      }
      var nextCharacter = remaining[0];
      commit({
        status: 'active', phase: phaseFor(nextCharacter), character: nextCharacter, mistakes: 0,
        completedCharacters: completed, remainingCharacters: remaining,
        needsPracticeCharacters: state.needsPracticeCharacters.slice()
      }, true);
    }

    function retry() {
      assertAlive();
      if (state.status !== 'needs-retry') throw new Error('Practice session is not in needs-retry state');
      commit(Object.assign({}, state, { status: 'active', phase: 'independent', mistakes: 0 }), true);
    }

    function defer() {
      assertAlive();
      if (scope !== 'group') throw new Error('Only group practice sessions can defer a character');
      if (state.status !== 'needs-retry') throw new Error('Practice session is not in needs-retry state');
      var deferredCharacter = state.character;
      var remaining = state.remainingCharacters.filter(function (item) { return item !== deferredCharacter; });
      var needsPractice = addUnique(state.needsPracticeCharacters, deferredCharacter);
      if (remaining.length === 0) {
        commit({
          status: 'complete', phase: null, character: null, mistakes: 0,
          completedCharacters: state.completedCharacters.slice(), remainingCharacters: [],
          needsPracticeCharacters: needsPractice
        }, true);
        return;
      }
      var nextCharacter = remaining[0];
      commit({
        status: 'active', phase: phaseFor(nextCharacter), character: nextCharacter, mistakes: 0,
        completedCharacters: state.completedCharacters.slice(), remainingCharacters: remaining,
        needsPracticeCharacters: needsPractice
      }, true);
    }

    function restart() {
      assertAlive();
      if (state.status !== 'active') throw new Error('Practice session is not active');
      state = Object.assign({}, state, { mistakes: 0 });
    }

    function destroy() {
      if (destroyed) return;
      if (scope === 'group' && state.status === 'active') saveGroup(state);
      destroyed = true;
    }

    return Object.freeze({
      getState: getState,
      recordStrokeMistake: recordStrokeMistake,
      completeCharacter: completeCharacter,
      retry: retry,
      defer: defer,
      restart: restart,
      destroy: destroy
    });
  }

  return Object.freeze({ createPracticeSession: createPracticeSession });
}));
