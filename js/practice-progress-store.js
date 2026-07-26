(function (root, factory) {
  'use strict';

  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.window) {
    root.window.HanziApp = Object.assign(root.window.HanziApp || {}, api);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var PRACTICE_STORAGE_KEY = 'hanzi-tracking:practice-progress:v1';
  var SCHEMA_VERSION = 1;
  var STATE_FIELDS = Object.freeze(['schemaVersion', 'characters', 'groups']);
  var CHARACTER_FIELDS = Object.freeze(['attemptCount', 'lastOutcome', 'mastered']);
  var GROUP_FIELDS = Object.freeze([
    'completedCharacters',
    'remainingCharacters',
    'needsPracticeCharacters',
    'currentCharacter',
    'currentPhase'
  ]);
  var DEFAULT_CHARACTER = Object.freeze({ attemptCount: 0, lastOutcome: null, mastered: false });
  var HAN_CHARACTER = /^\p{Script=Han}$/u;
  var LESSON_ID = /^[a-z][a-z0-9-]*$/;

  function reject(path, requirement) {
    throw new TypeError(path + ': ' + requirement);
  }

  function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    var prototype;
    try {
      prototype = Object.getPrototypeOf(value);
    } catch (_error) {
      return false;
    }
    return prototype === Object.prototype || prototype === null;
  }

  function requirePlainObject(value, path) {
    if (!isPlainObject(value)) reject(path, 'must be a plain object');
  }

  function requireExactOwnFields(record, fields, path) {
    var names;
    var symbols;
    try {
      names = Object.getOwnPropertyNames(record);
      symbols = Object.getOwnPropertySymbols(record);
    } catch (_error) {
      reject(path, 'must expose own fields');
    }
    if (symbols.length !== 0 || names.length !== fields.length) reject(path, 'must have exactly the required fields');
    fields.forEach(function (field) {
      if (names.indexOf(field) === -1) reject(path + '.' + field, 'must be an own property');
    });
  }

  function ownValue(record, field, path) {
    var descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(record, field);
    } catch (_error) {
      reject(path + '.' + field, 'must be an own property');
    }
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      reject(path + '.' + field, 'must be an own data property');
    }
    return descriptor.value;
  }

  function requireCharacter(character, path) {
    if (typeof character !== 'string' || !HAN_CHARACTER.test(character)) {
      reject(path, 'must be one Unicode Han character');
    }
    return character;
  }

  function requireLessonId(lessonId, path) {
    if (typeof lessonId !== 'string' || !LESSON_ID.test(lessonId)) {
      reject(path, 'must be a non-empty safe lesson id');
    }
    return lessonId;
  }

  function requireGroup(group, path) {
    if (group !== 'write' && group !== 'recognize') reject(path, 'must be write or recognize');
    return group;
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

  function cloneCharacterList(value, path) {
    requireRegularArray(value, path);
    var copied = [];
    var seen = new Set();
    for (var index = 0; index < value.length; index += 1) {
      var character = ownValue(value, String(index), path + '[' + index + ']');
      requireCharacter(character, path + '[' + index + ']');
      if (seen.has(character)) reject(path + '[' + index + ']', 'must not repeat a character');
      seen.add(character);
      copied.push(character);
    }
    return copied;
  }

  function cloneCharacterRecord(value, path) {
    requirePlainObject(value, path);
    requireExactOwnFields(value, CHARACTER_FIELDS, path);
    var attemptCount = ownValue(value, 'attemptCount', path);
    var lastOutcome = ownValue(value, 'lastOutcome', path);
    var mastered = ownValue(value, 'mastered', path);
    if (!Number.isInteger(attemptCount) || attemptCount < 0) {
      reject(path + '.attemptCount', 'must be a non-negative integer');
    }
    if (lastOutcome !== null && lastOutcome !== 'mastered' && lastOutcome !== 'needs-practice') {
      reject(path + '.lastOutcome', 'must be null, mastered, or needs-practice');
    }
    if ((attemptCount === 0) !== (lastOutcome === null)) {
      reject(path + '.lastOutcome', 'must be null only before the first attempt');
    }
    if (typeof mastered !== 'boolean' || mastered !== (lastOutcome === 'mastered')) {
      reject(path + '.mastered', 'must match lastOutcome');
    }
    return { attemptCount: attemptCount, lastOutcome: lastOutcome, mastered: mastered };
  }

  function cloneGroupProgress(value, path) {
    requirePlainObject(value, path);
    requireExactOwnFields(value, GROUP_FIELDS, path);
    var completedCharacters = cloneCharacterList(
      ownValue(value, 'completedCharacters', path), path + '.completedCharacters'
    );
    var remainingCharacters = cloneCharacterList(
      ownValue(value, 'remainingCharacters', path), path + '.remainingCharacters'
    );
    var needsPracticeCharacters = cloneCharacterList(
      ownValue(value, 'needsPracticeCharacters', path), path + '.needsPracticeCharacters'
    );
    var currentCharacter = ownValue(value, 'currentCharacter', path);
    var currentPhase = ownValue(value, 'currentPhase', path);
    if (remainingCharacters.length === 0) {
      if (currentCharacter !== null || currentPhase !== null) {
        reject(path, 'must use null current state without remaining characters');
      }
    } else {
      requireCharacter(currentCharacter, path + '.currentCharacter');
      if (remainingCharacters.indexOf(currentCharacter) === -1) {
        reject(path + '.currentCharacter', 'must occur in remainingCharacters');
      }
      if (currentPhase !== 'guided' && currentPhase !== 'independent') {
        reject(path + '.currentPhase', 'must be guided or independent');
      }
    }
    return {
      completedCharacters: completedCharacters,
      remainingCharacters: remainingCharacters,
      needsPracticeCharacters: needsPracticeCharacters,
      currentCharacter: currentCharacter,
      currentPhase: currentPhase
    };
  }

  function groupKey(lessonId, group) {
    return lessonId + ':' + group;
  }

  function cloneState(value, path) {
    requirePlainObject(value, path);
    requireExactOwnFields(value, STATE_FIELDS, path);
    if (ownValue(value, 'schemaVersion', path) !== SCHEMA_VERSION) {
      reject(path + '.schemaVersion', 'must equal ' + SCHEMA_VERSION);
    }
    var characters = ownValue(value, 'characters', path);
    var groups = ownValue(value, 'groups', path);
    requirePlainObject(characters, path + '.characters');
    requirePlainObject(groups, path + '.groups');
    var copiedCharacters = {};
    Object.keys(characters).forEach(function (character) {
      requireCharacter(character, path + '.characters key');
      copiedCharacters[character] = cloneCharacterRecord(
        ownValue(characters, character, path + '.characters'), path + '.characters.' + character
      );
    });
    var copiedGroups = {};
    Object.keys(groups).forEach(function (key) {
      var match = /^([a-z][a-z0-9-]*):(write|recognize)$/.exec(key);
      if (!match || key !== groupKey(match[1], match[2])) {
        reject(path + '.groups key', 'must be a lesson id and group key');
      }
      copiedGroups[key] = cloneGroupProgress(
        ownValue(groups, key, path + '.groups'), path + '.groups.' + key
      );
    });
    return { schemaVersion: SCHEMA_VERSION, characters: copiedCharacters, groups: copiedGroups };
  }

  function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.getOwnPropertyNames(value).forEach(function (name) { deepFreeze(value[name]); });
      Object.getOwnPropertySymbols(value).forEach(function (symbol) { deepFreeze(value[symbol]); });
      Object.freeze(value);
    }
    return value;
  }

  function emptyState() {
    return deepFreeze({ schemaVersion: SCHEMA_VERSION, characters: {}, groups: {} });
  }

  function freezeState(state) {
    return deepFreeze(state);
  }

  function hasStorageInterface(candidate) {
    if (candidate === null || candidate === undefined
      || (typeof candidate !== 'object' && typeof candidate !== 'function')) {
      return false;
    }
    try {
      return typeof candidate.getItem === 'function' && typeof candidate.setItem === 'function';
    } catch (_error) {
      return false;
    }
  }

  function createPracticeProgressStore(storage) {
    var storageEnabled = hasStorageInterface(storage);
    var state = emptyState();

    function disableStorage() {
      storageEnabled = false;
    }

    function readStorage() {
      if (!storageEnabled) return null;
      try {
        var method = storage.getItem;
        if (typeof method !== 'function') {
          disableStorage();
          return null;
        }
        return method.call(storage, PRACTICE_STORAGE_KEY);
      } catch (_error) {
        disableStorage();
        return null;
      }
    }

    function loadState() {
      var source = readStorage();
      if (source === null) return emptyState();
      if (typeof source !== 'string') return emptyState();
      try {
        return freezeState(cloneState(JSON.parse(source), 'stored state'));
      } catch (_error) {
        return emptyState();
      }
    }

    function persistState() {
      if (!storageEnabled) return;
      try {
        var method = storage.setItem;
        if (typeof method !== 'function') {
          disableStorage();
          return;
        }
        method.call(storage, PRACTICE_STORAGE_KEY, JSON.stringify(state));
      } catch (_error) {
        disableStorage();
      }
    }

    function commit(nextState) {
      state = freezeState(nextState);
      persistState();
      return state;
    }

    state = loadState();

    function getCharacter(character) {
      requireCharacter(character, 'character');
      return Object.hasOwn(state.characters, character) ? state.characters[character] : DEFAULT_CHARACTER;
    }

    function recordCharacterOutcome(character, outcome) {
      requireCharacter(character, 'character');
      if (outcome !== 'mastered' && outcome !== 'needs-practice') {
        reject('outcome', 'must be mastered or needs-practice');
      }
      var prior = getCharacter(character);
      var record = {
        attemptCount: prior.attemptCount + 1,
        lastOutcome: outcome,
        mastered: outcome === 'mastered'
      };
      var characters = Object.assign({}, state.characters);
      characters[character] = record;
      commit({ schemaVersion: SCHEMA_VERSION, characters: characters, groups: state.groups });
      return state.characters[character];
    }

    function getGroup(lessonId, group) {
      requireLessonId(lessonId, 'lessonId');
      requireGroup(group, 'group');
      var key = groupKey(lessonId, group);
      return Object.hasOwn(state.groups, key) ? state.groups[key] : null;
    }

    function saveGroup(lessonId, group, progress) {
      requireLessonId(lessonId, 'lessonId');
      requireGroup(group, 'group');
      var key = groupKey(lessonId, group);
      var groups = Object.assign({}, state.groups);
      groups[key] = cloneGroupProgress(progress, 'progress');
      commit({ schemaVersion: SCHEMA_VERSION, characters: state.characters, groups: groups });
      return state.groups[key];
    }

    function markGroupCharacterCompleted(lessonId, group, character) {
      requireLessonId(lessonId, 'lessonId');
      requireGroup(group, 'group');
      requireCharacter(character, 'character');
      var key = groupKey(lessonId, group);
      var existing = Object.hasOwn(state.groups, key) ? state.groups[key] : null;
      var completed = existing ? existing.completedCharacters.slice() : [];
      if (completed.indexOf(character) === -1) completed.push(character);
      var progress = existing
        ? {
          completedCharacters: completed,
          remainingCharacters: existing.remainingCharacters.slice(),
          needsPracticeCharacters: existing.needsPracticeCharacters.slice(),
          currentCharacter: existing.currentCharacter,
          currentPhase: existing.currentPhase
        }
        : {
          completedCharacters: completed,
          remainingCharacters: [],
          needsPracticeCharacters: [],
          currentCharacter: null,
          currentPhase: null
        };
      var groups = Object.assign({}, state.groups);
      groups[key] = progress;
      commit({ schemaVersion: SCHEMA_VERSION, characters: state.characters, groups: groups });
      return state.groups[key];
    }

    function clearGroup(lessonId, group) {
      requireLessonId(lessonId, 'lessonId');
      requireGroup(group, 'group');
      var key = groupKey(lessonId, group);
      var groups = Object.assign({}, state.groups);
      delete groups[key];
      commit({ schemaVersion: SCHEMA_VERSION, characters: state.characters, groups: groups });
      return null;
    }

    return Object.freeze({
      getCharacter: getCharacter,
      recordCharacterOutcome: recordCharacterOutcome,
      getGroup: getGroup,
      saveGroup: saveGroup,
      markGroupCharacterCompleted: markGroupCharacterCompleted,
      clearGroup: clearGroup,
      getSnapshot: function () { return state; },
      isPersistent: function () { return storageEnabled; }
    });
  }

  return Object.freeze({ PRACTICE_STORAGE_KEY: PRACTICE_STORAGE_KEY, createPracticeProgressStore: createPracticeProgressStore });
}));
