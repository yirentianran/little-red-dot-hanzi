(function (root, factory) {
  'use strict';

  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.window) {
    root.window.HanziApp = Object.assign(root.window.HanziApp || {}, api);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var GROUPS = Object.freeze(['write', 'recognize']);
  var ANIMATION_STATUSES = Object.freeze([
    'idle', 'playing', 'paused', 'between-strokes', 'completed'
  ]);
  var ANIMATION_MODES = Object.freeze(['continuous', 'step']);
  var SPEEDS = Object.freeze(['slow', 'normal', 'fast']);
  var AUDIO_STATES = Object.freeze(['ready', 'loading', 'unavailable', 'error']);
  var PRACTICE_STATUSES = Object.freeze(['active', 'needs-retry', 'complete']);
  var PRACTICE_PHASES = Object.freeze(['guided', 'independent']);
  var PRACTICE_FEEDBACK_KINDS = Object.freeze(['neutral', 'success', 'error', 'hint']);
  var HAN_CHARACTER = /^\p{Script=Han}$/u;
  var ANIMATION_LABELS = Object.freeze({
    idle: '准备开始',
    playing: '正在书写',
    paused: '已暂停',
    'between-strokes': '准备下一笔',
    completed: '书写完成'
  });
  var MODE_LABELS = Object.freeze({
    continuous: '连续播放',
    step: '单笔练习'
  });
  var SPEED_LABELS = Object.freeze({
    slow: '慢速',
    normal: '适中',
    fast: '快速'
  });
  var STORE_METHODS = Object.freeze([
    'getUnits', 'getUnit', 'getLesson', 'getEntries'
  ]);

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function reject(path, requirement) {
    throw new TypeError(path + ': ' + requirement);
  }

  function requireRecord(value, path) {
    if (!isRecord(value)) reject(path, 'must be an object');
    return value;
  }

  function requireFunction(value, path) {
    if (typeof value !== 'function') reject(path, 'must be a function');
    return value;
  }

  function requireNonBlankString(value, path) {
    if (typeof value !== 'string' || value.trim() === '') {
      reject(path, 'must be a non-blank string');
    }
    return value;
  }

  function requireOwn(record, field, path) {
    if (!Object.hasOwn(record, field)) reject(path + '.' + field, 'must be an own property');
    return record[field];
  }

  function requireInteger(value, path, minimum) {
    if (!Number.isInteger(value) || value < minimum) {
      reject(path, 'must be an integer greater than or equal to ' + minimum);
    }
    return value;
  }

  function requireOneOf(value, allowed, path) {
    if (allowed.indexOf(value) === -1) reject(path, 'has an unsupported value');
    return value;
  }

  function isPlainObject(value) {
    if (!isRecord(value)) return false;
    try {
      var prototype = Object.getPrototypeOf(value);
      if (prototype === null || prototype === Object.prototype) return true;
      if (Object.getPrototypeOf(prototype) !== null) return false;
      var constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
      var constructorPrototype = constructor && Object.hasOwn(constructor, 'value')
        ? Object.getOwnPropertyDescriptor(constructor.value, 'prototype')
        : null;
      return Boolean(constructorPrototype && Object.hasOwn(constructorPrototype, 'value')
        && constructorPrototype.value === prototype
        && typeof constructor.value === 'function'
        && Function.prototype.toString.call(constructor.value)
          === 'function Object() { [native code] }');
    } catch (_error) {
      return false;
    }
  }

  function requirePlainObject(value, path) {
    if (!isPlainObject(value)) reject(path, 'must be a plain object');
    return value;
  }

  function ownDataValue(value, field, path) {
    var descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, field);
    } catch (_error) {
      reject(path + '.' + field, 'must be an own data property');
    }
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      reject(path + '.' + field, 'must be an own data property');
    }
    return descriptor.value;
  }

  function ownNames(value, path) {
    var names;
    var symbols;
    try {
      names = Object.getOwnPropertyNames(value);
      symbols = Object.getOwnPropertySymbols(value);
    } catch (_error) {
      reject(path, 'must expose own fields');
    }
    if (symbols.length !== 0) reject(path, 'must not contain symbol fields');
    return names;
  }

  function requireOwnDataFields(value, path) {
    requirePlainObject(value, path);
    var names = ownNames(value, path);
    names.forEach(function (name) { ownDataValue(value, name, path); });
    return names;
  }

  function requireExactOwnFields(value, fields, path) {
    var names = requireOwnDataFields(value, path);
    if (names.length !== fields.length) reject(path, 'must contain exactly the supported fields');
    fields.forEach(function (field) {
      if (names.indexOf(field) === -1) reject(path + '.' + field, 'must be an own data property');
    });
  }

  function requireRegularArray(value, path) {
    if (!Array.isArray(value)) reject(path, 'must be an array');
    var names = ownNames(value, path);
    if (names.length !== value.length + 1 || names.indexOf('length') === -1) {
      reject(path, 'must contain only own array elements');
    }
    for (var index = 0; index < value.length; index += 1) {
      if (names.indexOf(String(index)) === -1) {
        reject(path + '[' + index + ']', 'must be an own array element');
      }
      ownDataValue(value, String(index), path);
    }
  }

  function requireSafeInteger(value, path, minimum) {
    if (!Number.isSafeInteger(value) || value < minimum) {
      reject(path, 'must be a safe integer greater than or equal to ' + minimum);
    }
    return value;
  }

  function requireHanCharacter(value, path) {
    if (typeof value !== 'string' || !HAN_CHARACTER.test(value)) {
      reject(path, 'must be one Unicode Han character');
    }
    return value;
  }

  function cloneCharacterList(value, path) {
    requireRegularArray(value, path);
    var result = [];
    var seen = new Set();
    for (var index = 0; index < value.length; index += 1) {
      var character = requireHanCharacter(
        ownDataValue(value, String(index), path), path + '[' + index + ']'
      );
      if (seen.has(character)) reject(path + '[' + index + ']', 'must not repeat a character');
      seen.add(character);
      result.push(character);
    }
    return result;
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

  function copyUnitStrict(unit, path) {
    requireOwnDataFields(unit, path);
    return {
      id: requireNonBlankString(ownDataValue(unit, 'id', path), path + '.id'),
      title: requireNonBlankString(ownDataValue(unit, 'title', path), path + '.title')
    };
  }

  function copyLessonStrict(lesson, path) {
    requireOwnDataFields(lesson, path);
    var kind = requireOneOf(
      ownDataValue(lesson, 'kind', path), ['lesson', 'garden'], path + '.kind'
    );
    var copy = {
      kind: kind,
      id: requireNonBlankString(ownDataValue(lesson, 'id', path), path + '.id'),
      title: requireNonBlankString(ownDataValue(lesson, 'title', path), path + '.title')
    };
    if (kind === 'lesson') {
      copy.number = requireSafeInteger(ownDataValue(lesson, 'number', path), path + '.number', 1);
    }
    return copy;
  }

  function copyPracticeSnapshot(practice) {
    if (practice === undefined) {
      return { mastered: new Set(), completed: new Set() };
    }
    requireExactOwnFields(practice, ['characters', 'group'], 'practice');
    var characters = ownDataValue(practice, 'characters', 'practice');
    requireOwnDataFields(characters, 'practice.characters');
    var mastered = new Set();
    ownNames(characters, 'practice.characters').forEach(function (character) {
      requireHanCharacter(character, 'practice.characters key');
      var record = ownDataValue(characters, character, 'practice.characters');
      requireOwnDataFields(record, 'practice.characters.' + character);
      var value = ownDataValue(record, 'mastered', 'practice.characters.' + character);
      if (typeof value !== 'boolean') {
        reject('practice.characters.' + character + '.mastered', 'must be a boolean');
      }
      if (value) mastered.add(character);
    });
    var group = ownDataValue(practice, 'group', 'practice');
    var completed = [];
    if (group !== null) {
      requireOwnDataFields(group, 'practice.group');
      completed = cloneCharacterList(
        ownDataValue(group, 'completedCharacters', 'practice.group'),
        'practice.group.completedCharacters'
      );
    }
    return { mastered: mastered, completed: new Set(completed) };
  }

  function freezeTree(value, seen) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    var visited = seen || new Set();
    if (visited.has(value)) return value;
    visited.add(value);
    Object.keys(value).forEach(function (key) { freezeTree(value[key], visited); });
    return Object.freeze(value);
  }

  function requireStore(store) {
    requireRecord(store, 'store');
    STORE_METHODS.forEach(function (method) {
      requireFunction(store[method], 'store.' + method);
    });
    return store;
  }

  function copyUnit(unit, path) {
    requireRecord(unit, path);
    return {
      id: requireNonBlankString(requireOwn(unit, 'id', path), path + '.id'),
      title: requireNonBlankString(requireOwn(unit, 'title', path), path + '.title')
    };
  }

  function copyLesson(lesson, path) {
    requireRecord(lesson, path);
    var kind = requireOneOf(requireOwn(lesson, 'kind', path), ['lesson', 'garden'], path + '.kind');
    var copy = {
      kind: kind,
      id: requireNonBlankString(requireOwn(lesson, 'id', path), path + '.id'),
      title: requireNonBlankString(requireOwn(lesson, 'title', path), path + '.title')
    };
    if (kind === 'lesson') {
      copy.number = requireInteger(requireOwn(lesson, 'number', path), path + '.number', 1);
    }
    return copy;
  }

  function copyDirectoryLesson(section, path) {
    var lesson = copyLesson(section, path);
    var recognizeDisplayed = requireInteger(
      requireOwn(section, 'recognizeDisplayed', path), path + '.recognizeDisplayed', 0
    );
    var recognizeCounted = requireInteger(
      requireOwn(section, 'recognizeCounted', path), path + '.recognizeCounted', 0
    );
    var polyphonicReviews = requireInteger(
      requireOwn(section, 'polyphonicReviews', path), path + '.polyphonicReviews', 0
    );
    var write = requireInteger(requireOwn(section, 'write', path), path + '.write', 0);
    var defaultGroup = requireOneOf(
      requireOwn(section, 'defaultGroup', path), GROUPS, path + '.defaultGroup'
    );
    if (recognizeCounted + polyphonicReviews !== recognizeDisplayed) {
      reject(path, 'recognize counts must be internally consistent');
    }
    lesson.recognizeDisplayed = recognizeDisplayed;
    lesson.recognize = recognizeDisplayed;
    lesson.recognizeCounted = recognizeCounted;
    lesson.polyphonicReviews = polyphonicReviews;
    lesson.write = write;
    lesson.total = lesson.recognize + write;
    lesson.defaultGroup = defaultGroup;
    return lesson;
  }

  function copyEntry(entry, index, path) {
    requireRecord(entry, path);
    var character = requireNonBlankString(requireOwn(entry, 'character', path), path + '.character');
    if (Array.from(character).length !== 1) reject(path + '.character', 'must be one code point');
    return {
      character: character,
      pinyin: requireNonBlankString(requireOwn(entry, 'pinyin', path), path + '.pinyin'),
      audioId: requireNonBlankString(requireOwn(entry, 'audio', path), path + '.audio'),
      index: index,
      isReview: Object.hasOwn(entry, 'counted') && entry.counted === false
    };
  }

  function createDirectoryModel(store) {
    requireStore(store);
    var sourceUnits = store.getUnits();
    if (!Array.isArray(sourceUnits)) reject('store.getUnits()', 'must return an array');
    var units = sourceUnits.map(function (sourceUnit, unitIndex) {
      var path = 'store.getUnits()[' + unitIndex + ']';
      var unit = copyUnit(sourceUnit, path);
      var sections = requireOwn(sourceUnit, 'sections', path);
      if (!Array.isArray(sections)) reject(path + '.sections', 'must be an array');
      unit.lessons = sections.map(function (section, sectionIndex) {
        return copyDirectoryLesson(section, path + '.sections[' + sectionIndex + ']');
      });
      return unit;
    });
    return freezeTree({ units: units });
  }

  function createLessonModel(store, options, practice) {
    requireStore(store);
    requireRecord(options, 'options');
    var practiceState = copyPracticeSnapshot(practice);
    var lessonId = requireNonBlankString(
      requireOwn(options, 'lessonId', 'options'), 'options.lessonId'
    );
    var group = requireOneOf(requireOwn(options, 'group', 'options'), GROUPS, 'options.group');
    var sourceLesson = store.getLesson(lessonId);
    if (!sourceLesson) reject('options.lessonId', 'must identify a known lesson');
    var sourceUnit = store.getUnit(sourceLesson.unitId);
    if (!sourceUnit) reject('store.getUnit()', 'must return the lesson unit');
    var writeEntries = store.getEntries(lessonId, 'write');
    var recognizeEntries = store.getEntries(lessonId, 'recognize');
    if (!Array.isArray(writeEntries) || !Array.isArray(recognizeEntries)) {
      reject('store.getEntries()', 'must return both lesson groups');
    }
    var selected = group === 'write' ? writeEntries : recognizeEntries;
    var lesson = copyLesson(sourceLesson, 'store.getLesson()');
    var declaredWrite = requireInteger(
      requireOwn(sourceLesson, 'write', 'store.getLesson()'),
      'store.getLesson().write',
      0
    );
    var recognizeDisplayed = requireInteger(
      requireOwn(sourceLesson, 'recognizeDisplayed', 'store.getLesson()'),
      'store.getLesson().recognizeDisplayed',
      0
    );
    var recognizeCounted = requireInteger(
      requireOwn(sourceLesson, 'recognizeCounted', 'store.getLesson()'),
      'store.getLesson().recognizeCounted',
      0
    );
    var reviews = requireInteger(
      requireOwn(sourceLesson, 'polyphonicReviews', 'store.getLesson()'),
      'store.getLesson().polyphonicReviews',
      0
    );
    if (declaredWrite !== writeEntries.length) {
      reject('store.getLesson().write', 'must match store.getEntries() write length');
    }
    if (recognizeDisplayed !== recognizeEntries.length) {
      reject(
        'store.getLesson().recognizeDisplayed',
        'must match store.getEntries() recognize length'
      );
    }
    if (recognizeCounted + reviews !== recognizeEntries.length) {
      reject(
        'store.getLesson().recognizeCounted + store.getLesson().polyphonicReviews',
        'must match store.getEntries() recognize length'
      );
    }
    var groups = {
      write: {
        id: 'write',
        label: '会写',
        count: writeEntries.length,
        available: writeEntries.length > 0
      },
      recognize: {
        id: 'recognize',
        label: '会认',
        count: recognizeEntries.length,
        counted: recognizeCounted,
        reviews: reviews,
        available: recognizeEntries.length > 0
      }
    };
    var entries = selected.map(function (entry, index) {
      var copy = copyEntry(entry, index, 'store.getEntries()[' + index + ']');
      copy.mastered = practiceState.mastered.has(copy.character);
      copy.completedHere = practiceState.completed.has(copy.character);
      return copy;
    });
    var completedCount = entries.filter(function (entry) { return entry.completedHere; }).length;
    var masteredCount = entries.filter(function (entry) { return entry.mastered; }).length;
    return freezeTree({
      unit: copyUnit(sourceUnit, 'store.getUnit()'),
      lesson: lesson,
      group: group,
      groups: groups,
      entries: entries,
      practice: {
        completed: completedCount,
        mastered: masteredCount,
        total: entries.length
      }
    });
  }

  function copyNeighbor(entry, path) {
    if (entry === null) return null;
    requireRecord(entry, path);
    return {
      character: requireNonBlankString(requireOwn(entry, 'character', path), path + '.character'),
      pinyin: requireNonBlankString(requireOwn(entry, 'pinyin', path), path + '.pinyin')
    };
  }

  function copyWords(value, character, path) {
    if (!Array.isArray(value)) return null;
    var copy = value.map(function (word, index) {
      requireNonBlankString(word, path + '[' + index + ']');
      if (word.indexOf(character) === -1) reject(path + '[' + index + ']', 'must include ' + character);
      return word;
    });
    return Object.freeze(copy);
  }

  function createCharacterModel(resolved, practice) {
    requireRecord(resolved, 'resolved');
    var practiceState = copyPracticeSnapshot(practice);
    var unit = copyUnit(requireOwn(resolved, 'unit', 'resolved'), 'resolved.unit');
    var lesson = copyLesson(requireOwn(resolved, 'lesson', 'resolved'), 'resolved.lesson');
    var group = requireOneOf(requireOwn(resolved, 'group', 'resolved'), GROUPS, 'resolved.group');
    var entry = requireRecord(requireOwn(resolved, 'entry', 'resolved'), 'resolved.entry');
    var geometry = requireRecord(requireOwn(resolved, 'geometry', 'resolved'), 'resolved.geometry');
    var index = requireInteger(requireOwn(resolved, 'index', 'resolved'), 'resolved.index', 0);
    var total = requireInteger(requireOwn(resolved, 'total', 'resolved'), 'resolved.total', 1);
    if (index >= total) reject('resolved.index', 'must be less than resolved.total');
    var character = requireNonBlankString(
      requireOwn(entry, 'character', 'resolved.entry'), 'resolved.entry.character'
    );
    if (Array.from(character).length !== 1) {
      reject('resolved.entry.character', 'must be one code point');
    }
    var words = copyWords(entry.words, character, 'resolved.entry.words');
    var previous = copyNeighbor(requireOwn(resolved, 'previous', 'resolved'), 'resolved.previous');
    var next = copyNeighbor(requireOwn(resolved, 'next', 'resolved'), 'resolved.next');
    return freezeTree({
      unit: unit,
      lesson: lesson,
      group: group,
      character: character,
      pinyin: requireNonBlankString(
        requireOwn(entry, 'pinyin', 'resolved.entry'), 'resolved.entry.pinyin'
      ),
      audioId: requireNonBlankString(
        requireOwn(entry, 'audio', 'resolved.entry'), 'resolved.entry.audio'
      ),
      words: words,
      strokeCount: requireInteger(
        requireOwn(geometry, 'strokeCount', 'resolved.geometry'), 'resolved.geometry.strokeCount', 1
      ),
      index: index,
      total: total,
      isReview: Object.hasOwn(entry, 'counted') && entry.counted === false,
      mastered: practiceState.mastered.has(character),
      completedHere: practiceState.completed.has(character),
      previous: previous,
      next: next,
      previousDisabled: previous === null,
      nextDisabled: next === null
    });
  }

  function copyResolvedPractice(resolved) {
    var fields = [
      'unit', 'lesson', 'group', 'entries', 'entry', 'index', 'total',
      'previous', 'next', 'geometry', 'audio', 'scope'
    ];
    requireExactOwnFields(resolved, fields, 'resolved');
    var unit = copyUnitStrict(ownDataValue(resolved, 'unit', 'resolved'), 'resolved.unit');
    var lesson = copyLessonStrict(
      ownDataValue(resolved, 'lesson', 'resolved'), 'resolved.lesson'
    );
    var group = requireOneOf(
      ownDataValue(resolved, 'group', 'resolved'), GROUPS, 'resolved.group'
    );
    var scope = requireOneOf(
      ownDataValue(resolved, 'scope', 'resolved'), ['single', 'group'], 'resolved.scope'
    );
    var entry = ownDataValue(resolved, 'entry', 'resolved');
    requireOwnDataFields(entry, 'resolved.entry');
    var character = requireHanCharacter(
      ownDataValue(entry, 'character', 'resolved.entry'), 'resolved.entry.character'
    );
    var pinyin = requireNonBlankString(
      ownDataValue(entry, 'pinyin', 'resolved.entry'), 'resolved.entry.pinyin'
    );
    var geometry = ownDataValue(resolved, 'geometry', 'resolved');
    requireOwnDataFields(geometry, 'resolved.geometry');
    var strokeCount = requireSafeInteger(
      ownDataValue(geometry, 'strokeCount', 'resolved.geometry'),
      'resolved.geometry.strokeCount',
      1
    );
    var index = requireSafeInteger(ownDataValue(resolved, 'index', 'resolved'), 'resolved.index', 0);
    var total = requireSafeInteger(ownDataValue(resolved, 'total', 'resolved'), 'resolved.total', 1);
    if (index >= total) reject('resolved.index', 'must be less than resolved.total');
    var previous = copyNeighbor(
      ownDataValue(resolved, 'previous', 'resolved'), 'resolved.previous'
    );
    var next = copyNeighbor(ownDataValue(resolved, 'next', 'resolved'), 'resolved.next');
    var entries = ownDataValue(resolved, 'entries', 'resolved');
    requireRegularArray(entries, 'resolved.entries');
    if (entries.length !== total) reject('resolved.entries', 'must match resolved.total');
    var characters = [];
    var pinyins = [];
    var seenCharacters = new Set();
    for (var entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      var entryPath = 'resolved.entries[' + entryIndex + ']';
      var sourceEntry = ownDataValue(entries, String(entryIndex), 'resolved.entries');
      requireOwnDataFields(sourceEntry, entryPath);
      var sourceCharacter = requireHanCharacter(
        ownDataValue(sourceEntry, 'character', entryPath), entryPath + '.character'
      );
      if (seenCharacters.has(sourceCharacter)) {
        reject(entryPath + '.character', 'must not repeat a character');
      }
      var sourcePinyin = requireNonBlankString(
        ownDataValue(sourceEntry, 'pinyin', entryPath), entryPath + '.pinyin'
      );
      seenCharacters.add(sourceCharacter);
      characters.push(sourceCharacter);
      pinyins.push(sourcePinyin);
    }
    if (characters[index] !== character || pinyins[index] !== pinyin) {
      reject('resolved.entry', 'must match resolved.entries at resolved.index');
    }
    return {
      unit: unit,
      lesson: lesson,
      group: group,
      scope: scope,
      character: character,
      pinyin: pinyin,
      strokeCount: strokeCount,
      index: index,
      total: total,
      previous: previous,
      next: next,
      characters: characters
    };
  }

  function copyPracticeState(state) {
    var fields = [
      'status', 'phase', 'character', 'index', 'total', 'mistakes',
      'newlyMasteredCount', 'completedCharacters', 'remainingCharacters',
      'needsPracticeCharacters', 'masteredCount'
    ];
    requireExactOwnFields(state, fields, 'state');
    return {
      status: requireOneOf(
        ownDataValue(state, 'status', 'state'), PRACTICE_STATUSES, 'state.status'
      ),
      phase: ownDataValue(state, 'phase', 'state'),
      character: ownDataValue(state, 'character', 'state'),
      index: requireSafeInteger(ownDataValue(state, 'index', 'state'), 'state.index', 0),
      total: requireSafeInteger(ownDataValue(state, 'total', 'state'), 'state.total', 1),
      mistakes: requireSafeInteger(
        ownDataValue(state, 'mistakes', 'state'), 'state.mistakes', 0
      ),
      newlyMasteredCount: requireSafeInteger(
        ownDataValue(state, 'newlyMasteredCount', 'state'), 'state.newlyMasteredCount', 0
      ),
      completedCharacters: cloneCharacterList(
        ownDataValue(state, 'completedCharacters', 'state'), 'state.completedCharacters'
      ),
      remainingCharacters: cloneCharacterList(
        ownDataValue(state, 'remainingCharacters', 'state'), 'state.remainingCharacters'
      ),
      needsPracticeCharacters: cloneCharacterList(
        ownDataValue(state, 'needsPracticeCharacters', 'state'),
        'state.needsPracticeCharacters'
      ),
      masteredCount: requireSafeInteger(
        ownDataValue(state, 'masteredCount', 'state'), 'state.masteredCount', 0
      )
    };
  }

  function validatePracticeState(resolved, state) {
    if (state.index > state.total) reject('state.index', 'must not exceed state.total');
    if (state.completedCharacters.length > state.total) {
      reject('state.completedCharacters', 'must not exceed state.total');
    }
    if (state.remainingCharacters.length > state.total) {
      reject('state.remainingCharacters', 'must not exceed state.total');
    }
    if (state.needsPracticeCharacters.length > state.total) {
      reject('state.needsPracticeCharacters', 'must not exceed state.total');
    }
    if (state.masteredCount > state.total) reject('state.masteredCount', 'must not exceed state.total');
    if (state.newlyMasteredCount > state.masteredCount) {
      reject('state.newlyMasteredCount', 'must not exceed state.masteredCount');
    }
    if (resolved.scope === 'group' && state.total > resolved.total) {
      reject('state.total', 'must not exceed resolved.total for group practice');
    }
    if (resolved.scope === 'single' && state.total !== 1) {
      reject('state.total', 'must equal 1 for single-character practice');
    }
    if (resolved.scope === 'single' && state.needsPracticeCharacters.length !== 0) {
      reject('state.needsPracticeCharacters', 'must be empty for single-character practice');
    }
    var sourceCharacters = resolved.scope === 'single'
      ? [resolved.character]
      : resolved.characters;
    [
      ['completedCharacters', state.completedCharacters],
      ['remainingCharacters', state.remainingCharacters],
      ['needsPracticeCharacters', state.needsPracticeCharacters]
    ].forEach(function (item) {
      if (!isOrderedSubset(item[1], sourceCharacters)) {
        reject('state.' + item[0], 'must be an ordered subset of the practice characters');
      }
    });
    var completed = new Set(state.completedCharacters);
    var remaining = new Set(state.remainingCharacters);
    if (state.needsPracticeCharacters.some(function (character) {
      return remaining.has(character);
    })) {
      reject('state.needsPracticeCharacters', 'must not occur in state.remainingCharacters');
    }
    var overlaps = state.completedCharacters.filter(function (character) {
      return remaining.has(character);
    });
    var allowsCurrentOverlap = overlaps.length === 1
      && overlaps[0] === state.character
      && (state.status === 'needs-retry'
        || (state.status === 'active' && state.phase === 'independent'));
    if (overlaps.length > 0 && !allowsCurrentOverlap) {
      reject('state', 'only the current retry character may be completed and remaining');
    }
    var covered = new Set(state.completedCharacters.concat(
      state.remainingCharacters, state.needsPracticeCharacters
    ));
    if (covered.size !== state.total) {
      reject('state', 'completed, remaining, and needs-practice characters must cover state.total');
    }
    if (state.status === 'complete') {
      if (state.phase !== null || state.character !== null || state.index !== state.total
          || state.mistakes !== 0 || state.remainingCharacters.length !== 0) {
        reject('state', 'complete state must use null current fields and final counts');
      }
      if (!completed.has(resolved.character)
          && state.needsPracticeCharacters.indexOf(resolved.character) === -1) {
        reject('resolved.entry.character', 'must occur in completed or needs-practice characters');
      }
      return;
    }
    requireOneOf(state.phase, PRACTICE_PHASES, 'state.phase');
    requireHanCharacter(state.character, 'state.character');
    if (state.character !== resolved.character) {
      reject('state.character', 'must match resolved.entry.character');
    }
    if (state.remainingCharacters.length === 0
        || state.remainingCharacters[0] !== state.character) {
      reject('state.remainingCharacters', 'must start with state.character');
    }
    if (state.index !== state.total - state.remainingCharacters.length) {
      reject('state.index', 'must match completed practice queue progress');
    }
    if (state.index >= state.total) reject('state.index', 'must be less than state.total');
    if (state.status === 'needs-retry'
        && (state.phase !== 'independent' || state.mistakes === 0
          || !completed.has(state.character))) {
      reject('state', 'needs-retry requires independent phase and at least one mistake');
    }
  }

  function createPracticeModel(resolved, state, persistent) {
    if (typeof persistent !== 'boolean') reject('persistent', 'must be a boolean');
    var resolvedCopy = copyResolvedPractice(resolved);
    var stateCopy = copyPracticeState(state);
    validatePracticeState(resolvedCopy, stateCopy);
    return freezeTree({
      unit: resolvedCopy.unit,
      lesson: resolvedCopy.lesson,
      group: resolvedCopy.group,
      scope: resolvedCopy.scope,
      character: resolvedCopy.character,
      pinyin: resolvedCopy.pinyin,
      strokeCount: resolvedCopy.strokeCount,
      groupIndex: resolvedCopy.index,
      groupTotal: resolvedCopy.total,
      previous: resolvedCopy.previous,
      next: resolvedCopy.next,
      status: stateCopy.status,
      phase: stateCopy.phase,
      index: stateCopy.index,
      total: stateCopy.total,
      mistakes: stateCopy.mistakes,
      completedCount: stateCopy.completedCharacters.length,
      masteredCount: stateCopy.masteredCount,
      newlyMasteredCount: stateCopy.newlyMasteredCount,
      needsPracticeCharacters: stateCopy.needsPracticeCharacters.slice(),
      persistent: persistent
    });
  }

  function requireContainer(container) {
    if (!container || typeof container !== 'object') reject('container', 'must be an element');
    requireFunction(container.replaceChildren, 'container.replaceChildren');
    var documentObject = container.ownerDocument;
    if (!documentObject || typeof documentObject !== 'object') {
      reject('container.ownerDocument', 'must be a document');
    }
    requireFunction(documentObject.createElement, 'container.ownerDocument.createElement');
    return documentObject;
  }

  function node(documentObject, tagName, attributes, text, children) {
    var result = documentObject.createElement(tagName);
    Object.keys(attributes || {}).forEach(function (name) {
      if (attributes[name] !== null && attributes[name] !== undefined) {
        result.setAttribute(name, attributes[name]);
      }
    });
    if (children) result.replaceChildren.apply(result, children);
    else if (text !== undefined) result.textContent = text;
    return result;
  }

  function setBooleanAttribute(element, name, enabled) {
    if (enabled) element.setAttribute(name, '');
    else element.removeAttribute(name);
  }

  function setHidden(element, hidden) {
    setBooleanAttribute(element, 'hidden', hidden);
  }

  function setDisabled(element, disabled) {
    setBooleanAttribute(element, 'disabled', disabled);
  }

  function viewHeading(documentObject, text) {
    return node(documentObject, 'h1', {
      'class': 'view-heading',
      'data-view-heading': '',
      'tabindex': '-1'
    }, text);
  }

  function icon(documentObject, symbol) {
    return node(documentObject, 'span', {
      'class': 'button-icon',
      'aria-hidden': 'true'
    }, symbol);
  }

  function lessonAccessibleName(lesson) {
    var name = lesson.kind === 'lesson'
      ? '第' + lesson.number + '课《' + lesson.title + '》'
      : lesson.title;
    name += '，会认' + lesson.recognizeDisplayed + '个';
    if (lesson.polyphonicReviews > 0) {
      name += '，其中复习' + lesson.polyphonicReviews + '个';
    }
    return name + '，会写' + lesson.write + '个';
  }

  function renderDirectory(container, model) {
    var documentObject = requireContainer(container);
    requireRecord(model, 'model');
    if (!Array.isArray(model.units)) reject('model.units', 'must be an array');
    var root = node(documentObject, 'div', {
      'class': 'view view--directory',
      'data-view': 'directory'
    });
    var heading = viewHeading(documentObject, '课程目录');
    var resumeButton = node(documentObject, 'button', {
      'class': 'button button--primary directory-resume',
      'type': 'button',
      'data-action': 'resume-learning',
      'hidden': ''
    }, '继续上次学习');
    var intro = node(documentObject, 'div', { 'class': 'directory-heading' }, undefined, [
      heading,
      resumeButton
    ]);
    var unitBands = model.units.map(function (unit, unitIndex) {
      var headingId = 'unit-heading-' + (unitIndex + 1);
      var unitHeading = node(documentObject, 'h2', {
        'class': 'unit-heading',
        'id': headingId
      }, unit.title);
      var lessonRows = unit.lessons.map(function (lesson) {
        var titleText = lesson.kind === 'lesson'
          ? lesson.number + '  ' + lesson.title
          : lesson.title;
        var title = node(documentObject, 'span', { 'class': 'lesson-row__title' }, titleText);
        var counts = node(documentObject, 'span', { 'class': 'lesson-row__counts' }, undefined, [
          node(documentObject, 'span', { 'class': 'count count--recognize' },
            '会认 ' + lesson.recognizeDisplayed),
          node(documentObject, 'span', { 'class': 'count count--write' },
            '会写 ' + lesson.write)
        ]);
        var button = node(documentObject, 'button', {
          'class': 'lesson-row',
          'type': 'button',
          'data-action': 'open-lesson',
          'data-lesson-id': lesson.id,
          'data-group': lesson.defaultGroup,
          'aria-label': lessonAccessibleName(lesson)
        }, undefined, [title, counts]);
        return node(documentObject, 'li', { 'class': 'lesson-list__item' }, undefined, [button]);
      });
      return node(documentObject, 'section', {
        'class': 'unit-band',
        'data-unit-band': unit.id,
        'aria-labelledby': headingId
      }, undefined, [
        unitHeading,
        node(documentObject, 'ul', { 'class': 'lesson-list' }, undefined, lessonRows)
      ]);
    });
    root.replaceChildren.apply(root, [intro].concat(unitBands));
    container.replaceChildren(root);

    function setResumeAvailable(available) {
      if (typeof available !== 'boolean') reject('available', 'must be a boolean');
      setHidden(resumeButton, !available);
    }

    return Object.freeze({
      root: root,
      heading: heading,
      resumeButton: resumeButton,
      setResumeAvailable: setResumeAvailable
    });
  }

  function groupButton(documentObject, model, group) {
    var groupModel = model.groups[group];
    var button = node(documentObject, 'button', {
      'class': 'segmented-control__button',
      'type': 'button',
      'data-action': 'select-group',
      'data-lesson-id': model.lesson.id,
      'data-group': group,
      'aria-pressed': String(model.group === group)
    }, groupModel.label + ' ' + groupModel.count);
    setDisabled(button, !groupModel.available);
    return button;
  }

  function characterButton(documentObject, model, entry, extraClass, label) {
    var accessibleName = label
      ? label + '，' + entry.character + '，' + entry.pinyin
      : entry.character + '，' + entry.pinyin + (entry.isReview ? '，复习' : '');
    if (entry.mastered === true) accessibleName += '，已掌握';
    if (entry.completedHere === true) accessibleName += '，本组已完成';
    var attributes = {
      'class': extraClass,
      'type': 'button',
      'data-action': 'open-character',
      'data-lesson-id': model.lesson.id,
      'data-group': model.group,
      'data-character': entry.character,
      'data-practice-mastered': String(entry.mastered === true),
      'data-practice-completed-here': String(entry.completedHere === true),
      'aria-label': accessibleName
    };
    if (label) return node(documentObject, 'button', attributes, label);
    var pieces = [
      node(documentObject, 'span', { 'class': 'character-card__pinyin' }, entry.pinyin),
      node(documentObject, 'span', { 'class': 'character-card__hanzi' }, entry.character)
    ];
    if (entry.isReview) {
      pieces.push(node(documentObject, 'span', { 'class': 'character-card__review' }, '复习'));
    }
    if (entry.mastered === true) {
      pieces.push(node(documentObject, 'span', {
        'class': 'character-card__mastered',
        'aria-hidden': 'true'
      }, '✓'));
    }
    return node(documentObject, 'button', attributes, undefined, pieces);
  }

  function renderLesson(container, model) {
    var documentObject = requireContainer(container);
    requireRecord(model, 'model');
    requireRecord(model.unit, 'model.unit');
    requireRecord(model.lesson, 'model.lesson');
    requireRecord(model.groups, 'model.groups');
    if (!Array.isArray(model.entries)) reject('model.entries', 'must be an array');
    var root = node(documentObject, 'div', {
      'class': 'view view--lesson',
      'data-view': 'lesson'
    });
    var back = node(documentObject, 'button', {
      'class': 'button button--quiet back-button',
      'type': 'button',
      'data-action': 'go-directory',
      'aria-label': '返回课程目录'
    }, undefined, [icon(documentObject, '←'), node(documentObject, 'span', {}, '课程目录')]);
    var lessonTitle = model.lesson.kind === 'lesson'
      ? model.lesson.number + '  ' + model.lesson.title
      : model.lesson.title;
    var heading = viewHeading(documentObject, lessonTitle);
    var eyebrow = node(documentObject, 'p', { 'class': 'view-eyebrow' }, model.unit.title);
    var groupControl = node(documentObject, 'div', {
      'class': 'segmented-control',
      'role': 'group',
      'aria-label': '选择学习类型'
    }, undefined, GROUPS.map(function (group) {
      return groupButton(documentObject, model, group);
    }));
    var practice = isRecord(model.practice) ? model.practice : {
      completed: 0, mastered: 0, total: model.entries.length
    };
    var practiceSummary = node(documentObject, 'section', {
      'class': 'lesson-practice-summary',
      'aria-label': '本组练习进度'
    }, undefined, [
      node(documentObject, 'p', { 'class': 'lesson-practice-summary__counts' },
        '本组已完成 ' + practice.completed + ' / ' + practice.total
          + '，当前掌握 ' + practice.mastered + ' 个'),
      node(documentObject, 'button', {
        'class': 'button button--primary lesson-practice-start',
        'type': 'button',
        'data-action': 'start-group-practice',
        'data-lesson-id': model.lesson.id,
        'data-group': model.group
      }, '练习本组')
    ]);
    setDisabled(practiceSummary.childNodes[1], model.entries.length === 0);
    var header = node(documentObject, 'div', { 'class': 'lesson-heading' }, undefined, [
      back,
      eyebrow,
      heading,
      groupControl,
      practiceSummary
    ]);
    var grid = node(documentObject, 'ul', {
      'class': 'character-grid',
      'aria-label': model.groups[model.group].label + '字表'
    }, undefined, model.entries.map(function (entry) {
      return node(documentObject, 'li', { 'class': 'character-grid__item' }, undefined, [
        characterButton(documentObject, model, entry, 'character-card')
      ]);
    }));
    var first = model.entries.length > 0 ? model.entries[0] : null;
    var start = first
      ? characterButton(
        documentObject,
        model,
        first,
        'button button--primary lesson-start',
        '从第一个字开始学习'
      )
      : node(documentObject, 'button', {
        'class': 'button button--primary lesson-start',
        'type': 'button',
        'disabled': ''
      }, '暂无可学习的汉字');
    root.replaceChildren(header, start, grid);
    container.replaceChildren(root);
    return Object.freeze({ root: root, heading: heading });
  }

  function actionIconButton(documentObject, action, symbol, label, title) {
    return node(documentObject, 'button', {
      'class': 'icon-button',
      'type': 'button',
      'data-action': action,
      'aria-label': label,
      'title': title || label
    }, undefined, [icon(documentObject, symbol)]);
  }

  function characterNavigationButton(documentObject, model, direction) {
    var isPrevious = direction === 'previous';
    var neighbor = isPrevious ? model.previous : model.next;
    var action = isPrevious ? 'previous-character' : 'next-character';
    var label = isPrevious ? '上一个字' : '下一个字';
    var symbol = isPrevious ? '←' : '→';
    if (neighbor) label += '：' + neighbor.character + '，' + neighbor.pinyin;
    var attributes = {
      'class': 'button character-navigation__button',
      'type': 'button',
      'data-action': action,
      'data-lesson-id': model.lesson.id,
      'data-group': model.group,
      'aria-label': label
    };
    if (neighbor) attributes['data-character'] = neighbor.character;
    else attributes.disabled = '';
    return node(documentObject, 'button', attributes, undefined, [
      icon(documentObject, symbol),
      node(documentObject, 'span', {}, neighbor ? neighbor.character + ' ' + neighbor.pinyin : label)
    ]);
  }

  function renderCharacter(container, model) {
    var documentObject = requireContainer(container);
    requireRecord(model, 'model');
    requireRecord(model.unit, 'model.unit');
    requireRecord(model.lesson, 'model.lesson');
    requireNonBlankString(model.character, 'model.character');
    requireInteger(model.strokeCount, 'model.strokeCount', 1);
    requireInteger(model.index, 'model.index', 0);
    requireInteger(model.total, 'model.total', 1);

    var root = node(documentObject, 'div', {
      'class': 'view view--character',
      'data-view': 'character'
    });
    var back = node(documentObject, 'button', {
      'class': 'button button--quiet back-button',
      'type': 'button',
      'data-action': 'back-lesson',
      'data-lesson-id': model.lesson.id,
      'data-group': model.group,
      'aria-label': '返回《' + model.lesson.title + '》字表'
    }, undefined, [icon(documentObject, '←'), node(documentObject, 'span', {}, model.lesson.title)]);
    var position = node(documentObject, 'p', {
      'class': 'character-position',
      'data-slot': 'character-position'
    }, '第 ' + (model.index + 1) + ' 个，共 ' + model.total + ' 个');
    var topbar = node(documentObject, 'div', { 'class': 'character-topbar' }, undefined, [back, position]);
    var heading = viewHeading(documentObject, '学习“' + model.character + '”');
    var boardError = node(documentObject, 'p', {
      'class': 'board-error',
      'data-slot': 'board-error',
      'hidden': ''
    }, '该字数据待补充，可先学习读音或切换前后字。');
    var board = node(documentObject, 'div', {
      'class': 'character-board',
      'data-slot': 'character-board',
      'role': 'img',
      'aria-label': model.character + '，笔顺演示，准备开始'
    }, undefined, [boardError]);
    var boardColumn = node(documentObject, 'div', { 'class': 'board-column' }, undefined, [board]);

    var pinyin = node(documentObject, 'p', { 'class': 'character-pinyin' }, model.pinyin);
    var vocabulary = Array.isArray(model.words) && model.words.length > 0
      ? node(documentObject, 'p', {
        'class': 'character-words',
        'data-slot': 'vocabulary-words'
      }, '组词：' + model.words.join('  '))
      : null;
    var hanzi = node(documentObject, 'p', { 'class': 'character-display' }, model.character);
    var strokeCount = node(documentObject, 'p', { 'class': 'stroke-count' },
      '共 ' + model.strokeCount + ' 笔');
    var practiceStatusText = model.mastered === true
      ? '练习状态：已掌握'
      : (model.completedHere === true ? '练习状态：本组已完成' : '练习状态：尚未完成');
    var practiceStatus = node(documentObject, 'p', {
      'class': 'character-practice-status',
      'data-slot': 'character-practice-status'
    }, practiceStatusText);
    var practiceButton = node(documentObject, 'button', {
      'class': 'button button--primary character-practice-start',
      'type': 'button',
      'data-action': 'start-character-practice',
      'data-lesson-id': model.lesson.id,
      'data-group': model.group,
      'data-character': model.character
    }, '练习这个字');
    var audioButton = node(documentObject, 'button', {
      'class': 'button button--audio',
      'type': 'button',
      'data-action': 'play-audio',
      'aria-label': '听读音，' + model.character + '，' + model.pinyin
    }, undefined, [icon(documentObject, '♪'), node(documentObject, 'span', {}, '听读音')]);
    var audioFeedback = node(documentObject, 'p', {
      'class': 'control-feedback',
      'data-slot': 'audio-feedback',
      'hidden': ''
    }, '');
    var animationStatus = node(documentObject, 'p', {
      'class': 'animation-status',
      'data-slot': 'animation-status'
    }, '');

    var previousStroke = actionIconButton(
      documentObject, 'previous-stroke', '↤', '上一笔', '上一笔'
    );
    var togglePlay = actionIconButton(
      documentObject, 'toggle-play', '▶', '播放笔顺', '播放笔顺'
    );
    var toggleIcon = togglePlay.childNodes[0];
    var replay = actionIconButton(
      documentObject, 'replay', '↻', '重新播放笔顺', '重新播放笔顺'
    );
    var nextStroke = actionIconButton(
      documentObject, 'next-stroke', '↦', '下一笔', '下一笔'
    );
    var strokeControls = [previousStroke, togglePlay, replay, nextStroke];
    var controls = node(documentObject, 'div', {
      'class': 'stroke-controls',
      'role': 'group',
      'aria-label': '笔顺控制'
    }, undefined, strokeControls);

    var speedButtons = SPEEDS.map(function (speed) {
      return node(documentObject, 'button', {
        'class': 'segmented-control__button speed-button',
        'type': 'button',
        'data-action': 'set-speed',
        'data-speed': speed,
        'aria-pressed': String(speed === 'normal')
      }, SPEED_LABELS[speed]);
    });
    var speedGroup = node(documentObject, 'div', {
      'class': 'segmented-control speed-control',
      'data-slot': 'speed-group',
      'role': 'group',
      'aria-label': '笔顺播放速度'
    }, undefined, speedButtons);
    var toolChildren = [pinyin];
    if (vocabulary) toolChildren.push(vocabulary);
    toolChildren.push(
      hanzi,
      strokeCount,
      practiceStatus,
      practiceButton,
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
    var workSurface = node(documentObject, 'div', { 'class': 'character-work-surface' }, undefined, [
      boardColumn,
      tools
    ]);
    var characterNavigation = node(documentObject, 'nav', {
      'class': 'character-navigation',
      'aria-label': '前后汉字'
    }, undefined, [
      characterNavigationButton(documentObject, model, 'previous'),
      characterNavigationButton(documentObject, model, 'next')
    ]);
    root.replaceChildren(topbar, heading, workSurface, characterNavigation);
    container.replaceChildren(root);

    var boardFailed = false;
    var animationKey = null;
    var lastAudioState = null;

    function setAnimationState(state) {
      requireRecord(state, 'animation state');
      var status = requireOneOf(state.status, ANIMATION_STATUSES, 'animation state.status');
      var mode = requireOneOf(state.mode, ANIMATION_MODES, 'animation state.mode');
      var speed = requireOneOf(state.speed, SPEEDS, 'animation state.speed');
      var strokeIndex = requireInteger(state.strokeIndex, 'animation state.strokeIndex', 0);
      if (strokeIndex >= model.strokeCount) {
        reject('animation state.strokeIndex', 'must be within the character stroke count');
      }
      var nextKey = [status, mode, speed, strokeIndex].join('|');
      if (nextKey === animationKey) return;
      animationKey = nextKey;

      var statusLabel = ANIMATION_LABELS[status];
      animationStatus.textContent = statusLabel + '，第 ' + (strokeIndex + 1) + ' / '
        + model.strokeCount + ' 笔，' + MODE_LABELS[mode];
      if (!boardFailed) {
        board.setAttribute('aria-label', model.character + '，笔顺演示，第 '
          + (strokeIndex + 1) + ' 笔，' + statusLabel);
      }
      var isPlaying = status === 'playing'
        || status === 'between-strokes'
        || (status === 'completed' && mode === 'continuous');
      toggleIcon.textContent = isPlaying ? '⏸' : '▶';
      togglePlay.setAttribute('aria-label', isPlaying ? '暂停笔顺' : '播放笔顺');
      togglePlay.setAttribute('title', isPlaying ? '暂停笔顺' : '播放笔顺');
      setDisabled(previousStroke, boardFailed || strokeIndex === 0);
      setDisabled(nextStroke, boardFailed || strokeIndex === model.strokeCount - 1);
      setDisabled(togglePlay, boardFailed);
      setDisabled(replay, boardFailed);
      speedButtons.forEach(function (button, index) {
        button.setAttribute('aria-pressed', String(SPEEDS[index] === speed));
        setDisabled(button, boardFailed);
      });
    }

    function setAudioState(state) {
      requireOneOf(state, AUDIO_STATES, 'audio state');
      if (state === lastAudioState) return;
      lastAudioState = state;
      var message = '';
      if (state === 'loading') message = '正在准备读音…';
      if (state === 'unavailable') message = '该字读音暂不可用';
      if (state === 'error') message = '读音播放失败';
      audioFeedback.textContent = message;
      setHidden(audioFeedback, state === 'ready');
      setDisabled(audioButton, state === 'loading' || state === 'unavailable');
      if (state === 'loading') audioButton.setAttribute('aria-busy', 'true');
      else audioButton.removeAttribute('aria-busy');
    }

    function showBoardError() {
      if (boardFailed) return;
      boardFailed = true;
      setHidden(boardError, false);
      board.replaceChildren(boardError);
      board.setAttribute('aria-label', model.character + '，该字笔画数据待补充');
      strokeControls.forEach(function (button) { setDisabled(button, true); });
      speedButtons.forEach(function (button) { setDisabled(button, true); });
    }

    setAnimationState({
      status: 'idle',
      mode: 'continuous',
      strokeIndex: 0,
      speed: 'normal'
    });
    setAudioState('ready');

    return Object.freeze({
      root: root,
      heading: heading,
      board: board,
      setAnimationState: setAnimationState,
      setAudioState: setAudioState,
      showBoardError: showBoardError
    });
  }

  function copyPracticeViewModel(model) {
    var fields = [
      'unit', 'lesson', 'group', 'scope', 'character', 'pinyin', 'strokeCount',
      'groupIndex', 'groupTotal', 'previous', 'next',
      'status', 'phase', 'index', 'total', 'mistakes', 'completedCount',
      'masteredCount', 'newlyMasteredCount', 'needsPracticeCharacters', 'persistent'
    ];
    requireExactOwnFields(model, fields, 'model');
    var copy = {
      unit: copyUnitStrict(ownDataValue(model, 'unit', 'model'), 'model.unit'),
      lesson: copyLessonStrict(ownDataValue(model, 'lesson', 'model'), 'model.lesson'),
      group: requireOneOf(ownDataValue(model, 'group', 'model'), GROUPS, 'model.group'),
      scope: requireOneOf(
        ownDataValue(model, 'scope', 'model'), ['single', 'group'], 'model.scope'
      ),
      character: requireHanCharacter(
        ownDataValue(model, 'character', 'model'), 'model.character'
      ),
      pinyin: requireNonBlankString(ownDataValue(model, 'pinyin', 'model'), 'model.pinyin'),
      strokeCount: requireSafeInteger(
        ownDataValue(model, 'strokeCount', 'model'), 'model.strokeCount', 1
      ),
      groupIndex: requireSafeInteger(
        ownDataValue(model, 'groupIndex', 'model'), 'model.groupIndex', 0
      ),
      groupTotal: requireSafeInteger(
        ownDataValue(model, 'groupTotal', 'model'), 'model.groupTotal', 1
      ),
      previous: copyNeighbor(ownDataValue(model, 'previous', 'model'), 'model.previous'),
      next: copyNeighbor(ownDataValue(model, 'next', 'model'), 'model.next'),
      status: requireOneOf(
        ownDataValue(model, 'status', 'model'), PRACTICE_STATUSES, 'model.status'
      ),
      phase: ownDataValue(model, 'phase', 'model'),
      index: requireSafeInteger(ownDataValue(model, 'index', 'model'), 'model.index', 0),
      total: requireSafeInteger(ownDataValue(model, 'total', 'model'), 'model.total', 1),
      mistakes: requireSafeInteger(
        ownDataValue(model, 'mistakes', 'model'), 'model.mistakes', 0
      ),
      completedCount: requireSafeInteger(
        ownDataValue(model, 'completedCount', 'model'), 'model.completedCount', 0
      ),
      masteredCount: requireSafeInteger(
        ownDataValue(model, 'masteredCount', 'model'), 'model.masteredCount', 0
      ),
      newlyMasteredCount: requireSafeInteger(
        ownDataValue(model, 'newlyMasteredCount', 'model'), 'model.newlyMasteredCount', 0
      ),
      needsPracticeCharacters: cloneCharacterList(
        ownDataValue(model, 'needsPracticeCharacters', 'model'),
        'model.needsPracticeCharacters'
      ),
      persistent: ownDataValue(model, 'persistent', 'model')
    };
    if (typeof copy.persistent !== 'boolean') reject('model.persistent', 'must be a boolean');
    if (copy.groupIndex >= copy.groupTotal) {
      reject('model.groupIndex', 'must be less than model.groupTotal');
    }
    if ((copy.groupIndex === 0) !== (copy.previous === null)) {
      reject('model.previous', 'must match the group position');
    }
    if ((copy.groupIndex === copy.groupTotal - 1) !== (copy.next === null)) {
      reject('model.next', 'must match the group position');
    }
    if (copy.index > copy.total) reject('model.index', 'must not exceed model.total');
    if (copy.completedCount > copy.total) reject('model.completedCount', 'must not exceed model.total');
    if (copy.masteredCount > copy.total) reject('model.masteredCount', 'must not exceed model.total');
    if (copy.newlyMasteredCount > copy.masteredCount) {
      reject('model.newlyMasteredCount', 'must not exceed model.masteredCount');
    }
    if (copy.needsPracticeCharacters.length > copy.total) {
      reject('model.needsPracticeCharacters', 'must not exceed model.total');
    }
    if (copy.scope === 'single' && copy.total !== 1) {
      reject('model.total', 'must equal 1 for single-character practice');
    }
    if (copy.status === 'complete') {
      if (copy.phase !== null || copy.index !== copy.total || copy.mistakes !== 0) {
        reject('model', 'complete state must use null phase and final counts');
      }
    } else {
      requireOneOf(copy.phase, PRACTICE_PHASES, 'model.phase');
      if (copy.index >= copy.total) reject('model.index', 'must be less than model.total');
      if (copy.status === 'needs-retry'
          && (copy.phase !== 'independent' || copy.mistakes === 0)) {
        reject('model', 'needs-retry requires independent phase and at least one mistake');
      }
    }
    return freezeTree(copy);
  }

  function practiceContextAttributes(model, action) {
    return {
      'class': 'button',
      'type': 'button',
      'data-action': action,
      'data-lesson-id': model.lesson.id,
      'data-group': model.group,
      'data-scope': model.scope,
      'data-character': model.character
    };
  }

  function practiceBoardLabel(model, current) {
    var phaseLabel = model.phase === 'guided' ? '引导描写' : '独立描写';
    return model.character + '，' + phaseLabel + '，第' + current + '笔，共'
      + model.strokeCount + '笔';
  }

  function practiceNavigationButton(documentObject, model, direction) {
    var button = characterNavigationButton(documentObject, model, direction);
    button.setAttribute(
      'class', 'button character-navigation__button practice-navigation__button'
    );
    if (model.status !== 'complete') button.setAttribute('disabled', '');
    return button;
  }

  function renderPractice(container, model) {
    var documentObject = requireContainer(container);
    var viewModel = copyPracticeViewModel(model);
    var groupLabel = viewModel.group === 'write' ? '会写' : '会认';
    var lessonTitle = viewModel.lesson.kind === 'lesson'
      ? '第' + viewModel.lesson.number + '课  ' + viewModel.lesson.title
      : viewModel.lesson.title;
    var root = node(documentObject, 'div', {
      'class': 'view view--practice',
      'data-view': 'practice',
      'data-practice-status': viewModel.status
    });
    var backAttributes = practiceContextAttributes(viewModel, 'practice-back');
    backAttributes['class'] = 'button button--quiet back-button'
      + (viewModel.scope === 'single' ? ' practice-back--single' : '');
    var backLabel = viewModel.scope === 'single'
      ? '返回“' + viewModel.character + '”字的学习页'
      : '返回《' + viewModel.lesson.title + '》' + groupLabel + '字表';
    var backText = viewModel.scope === 'single'
      ? '学习“' + viewModel.character + '”'
      : viewModel.lesson.title;
    backAttributes['aria-label'] = backLabel;
    var back = node(documentObject, 'button', backAttributes, undefined, [
      icon(documentObject, '←'),
      node(documentObject, 'span', {}, backText)
    ]);
    var positionText = viewModel.scope === 'single'
      ? '第 ' + (viewModel.groupIndex + 1) + ' 个，共 ' + viewModel.groupTotal + ' 个'
      : '第 ' + Math.min(viewModel.index + 1, viewModel.total) + ' / '
        + viewModel.total + ' 个';
    var position = node(documentObject, 'p', {
      'class': 'practice-round-position',
      'data-slot': 'practice-round-position'
    }, positionText);
    var navigation = null;
    if (viewModel.scope === 'single') {
      navigation = node(documentObject, 'nav', {
        'class': 'character-navigation practice-navigation',
        'aria-label': '前后汉字'
      }, undefined, [
        practiceNavigationButton(documentObject, viewModel, 'previous'),
        practiceNavigationButton(documentObject, viewModel, 'next')
      ]);
    }
    var topbar = node(documentObject, 'div', {
      'class': 'practice-topbar'
        + (viewModel.scope === 'single' ? ' practice-topbar--single' : '')
    }, undefined, [back, position]);
    var lesson = node(documentObject, 'p', { 'class': 'practice-lesson-title' }, lessonTitle);
    var group = node(documentObject, 'p', { 'class': 'practice-group-label' }, groupLabel);
    var heading = viewHeading(documentObject, '练习“' + viewModel.character + '”');
    var common = [topbar, lesson, group, heading];
    if (!viewModel.persistent) {
      common.push(node(documentObject, 'p', {
        'class': 'practice-persistence-warning',
        'role': 'status'
      }, '本次进度不会保存'));
    }

    var board = null;
    var feedback = null;
    var strokePosition = null;
    var progress = null;
    var hint = null;
    var skipUnavailable = null;
    var content = [];
    if (viewModel.status === 'active') {
      board = node(documentObject, 'div', {
        'class': 'practice-board',
        'data-slot': 'practice-board',
        'role': 'img',
        'aria-label': practiceBoardLabel(viewModel, 1)
      });
      var phaseLabel = viewModel.phase === 'guided' ? '引导描写' : '独立描写';
      strokePosition = node(documentObject, 'p', {
        'class': 'practice-stroke-position',
        'data-slot': 'practice-stroke-position'
      }, '第 1 / ' + viewModel.strokeCount + ' 笔');
      feedback = node(documentObject, 'p', {
        'class': 'practice-feedback',
        'data-slot': 'practice-feedback',
        'data-kind': 'neutral',
        'aria-live': 'polite',
        'aria-atomic': 'true'
      }, '准备书写');
      progress = node(documentObject, 'progress', {
        'class': 'practice-progress',
        'max': viewModel.strokeCount,
        'value': 0,
        'aria-label': viewModel.character + '书写进度'
      }, '');
      hint = actionIconButton(
        documentObject, 'practice-hint', '?', '提示当前笔', '提示当前笔'
      );
      var restartAttributes = practiceContextAttributes(viewModel, 'practice-restart');
      restartAttributes['class'] = 'button practice-restart';
      var restart = node(documentObject, 'button', restartAttributes, '重写这个字');
      var activeActions = [hint, restart];
      if (viewModel.scope === 'group') {
        var skipAttributes = practiceContextAttributes(viewModel, 'practice-skip-unavailable');
        skipAttributes['class'] = 'button';
        skipAttributes.hidden = '';
        skipUnavailable = node(documentObject, 'button', skipAttributes, '跳过这个字');
        activeActions.push(skipUnavailable);
      }
      var tools = node(documentObject, 'section', {
        'class': 'practice-tools',
        'aria-label': viewModel.character + '的书写练习工具'
      }, undefined, [
        node(documentObject, 'p', { 'class': 'practice-character' }, viewModel.character),
        node(documentObject, 'p', { 'class': 'practice-pinyin' }, viewModel.pinyin),
        node(documentObject, 'p', { 'class': 'practice-phase' }, phaseLabel),
        strokePosition,
        feedback,
        progress,
        node(documentObject, 'div', {
          'class': 'practice-actions',
          'role': 'group',
          'aria-label': '练习操作'
        }, undefined, activeActions)
      ]);
      content = [board, tools];
    } else if (viewModel.status === 'needs-retry') {
      var retryAttributes = practiceContextAttributes(viewModel, 'practice-retry');
      retryAttributes['class'] = 'button button--primary';
      var retryActions = [node(documentObject, 'button', retryAttributes, '立即再练')];
      if (viewModel.scope === 'group') {
        var deferAttributes = practiceContextAttributes(viewModel, 'practice-defer');
        deferAttributes['class'] = 'button';
        retryActions.push(node(documentObject, 'button', deferAttributes, '稍后再练'));
      }
      content = [node(documentObject, 'section', {
        'class': 'practice-retry-result',
        'aria-labelledby': 'practice-retry-heading'
      }, undefined, [
        node(documentObject, 'h2', { 'id': 'practice-retry-heading' }, '需要再练'),
        node(documentObject, 'p', {}, '本次出现 ' + viewModel.mistakes + ' 次需要调整的笔画。'),
        node(documentObject, 'div', { 'class': 'practice-actions' }, undefined, retryActions)
      ])];
    } else {
      var resultChildren = [
        node(documentObject, 'h2', { 'id': 'practice-result-heading' }, '本轮练习完成'),
        node(documentObject, 'p', {}, '本轮完成 ' + viewModel.completedCount + ' 个'),
        node(documentObject, 'p', {}, '当前掌握 ' + viewModel.masteredCount + ' 个'),
        node(documentObject, 'p', {}, '本次新掌握 ' + viewModel.newlyMasteredCount + ' 个'),
        node(documentObject, 'p', {}, '需要再练 '
          + viewModel.needsPracticeCharacters.length + ' 个')
      ];
      var resultActions = [];
      if (viewModel.needsPracticeCharacters.length > 0) {
        var reviewAttributes = practiceContextAttributes(viewModel, 'practice-review-needs');
        reviewAttributes['class'] = 'button button--primary';
        resultActions.push(node(documentObject, 'button', reviewAttributes, '练习需要再练的字'));
      }
      var returnAttributes = practiceContextAttributes(viewModel, 'practice-return-lesson');
      returnAttributes['class'] = 'button';
      resultActions.push(node(documentObject, 'button', returnAttributes, '返回字表'));
      resultChildren.push(node(documentObject, 'div', {
        'class': 'practice-actions'
      }, undefined, resultActions));
      content = [node(documentObject, 'section', {
        'class': 'practice-complete-result',
        'aria-labelledby': 'practice-result-heading'
      }, undefined, resultChildren)];
    }

    var pageContent = common.concat(content);
    if (navigation) pageContent.push(navigation);
    root.replaceChildren.apply(root, pageContent);
    container.replaceChildren(root);

    function requireActiveHandle() {
      if (viewModel.status !== 'active') {
        throw new Error('Practice view mutators are only available in the active state');
      }
    }

    function setFeedback(message, kind) {
      requireActiveHandle();
      if (typeof message !== 'string') reject('message', 'must be a string');
      requireOneOf(kind, PRACTICE_FEEDBACK_KINDS, 'feedback kind');
      feedback.textContent = message;
      feedback.setAttribute('data-kind', kind);
    }

    function setStrokePosition(current, total) {
      requireActiveHandle();
      requireSafeInteger(current, 'current stroke', 1);
      requireSafeInteger(total, 'total strokes', 1);
      if (total !== viewModel.strokeCount || current > total) {
        reject('stroke position', 'must be within the model stroke count');
      }
      strokePosition.textContent = '第 ' + current + ' / ' + total + ' 笔';
      progress.setAttribute('value', current - 1);
      board.setAttribute('aria-label', practiceBoardLabel(viewModel, current));
    }

    function setUnavailable() {
      requireActiveHandle();
      setFeedback('这个字暂时无法练习', 'error');
      setDisabled(hint, true);
      if (skipUnavailable) setHidden(skipUnavailable, false);
    }

    return Object.freeze({
      root: root,
      heading: heading,
      board: board,
      setFeedback: setFeedback,
      setStrokePosition: setStrokePosition,
      setUnavailable: setUnavailable
    });
  }

  return Object.freeze({
    createDirectoryModel: createDirectoryModel,
    createLessonModel: createLessonModel,
    createCharacterModel: createCharacterModel,
    createPracticeModel: createPracticeModel,
    renderDirectory: renderDirectory,
    renderLesson: renderLesson,
    renderCharacter: renderCharacter,
    renderPractice: renderPractice
  });
}));
