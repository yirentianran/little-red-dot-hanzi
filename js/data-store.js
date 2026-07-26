(function (root, factory) {
  'use strict';

  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.window) {
    root.window.HanziApp = Object.assign(root.window.HanziApp || {}, api);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var GROUPS = Object.freeze(['recognize', 'write']);
  var GEOMETRY_FIELDS = Object.freeze(['strokeCount', 'strokes', 'medians']);
  var GEOMETRY_NOTICE_FIELDS = Object.freeze(['date', 'source', 'license', 'changes']);
  var BOOK_FIELDS = Object.freeze(['publisher', 'approvalYear', 'grade', 'volume']);
  var NOTICE_KEYS = Object.freeze([
    'geometryLicense',
    'geometrySource',
    'audioAttribution',
    'audioLicense'
  ]);

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function isNonBlankString(value) {
    return typeof value === 'string' && value.trim() !== '';
  }

  function isSingleCodePoint(value) {
    return typeof value === 'string' && Array.from(value).length === 1;
  }

  function reject(path, requirement) {
    throw new TypeError(path + ': ' + requirement);
  }

  function requireRecord(value, path) {
    if (!isRecord(value)) reject(path, 'must be an object');
  }

  function requireNonBlankString(value, path) {
    if (!isNonBlankString(value)) reject(path, 'must be a non-blank string');
  }

  function requireOwn(record, field, path) {
    if (!Object.hasOwn(record, field)) reject(path + '.' + field, 'must be an own property');
    return record[field];
  }

  function requireOwnArrayElement(array, index, path) {
    if (!Object.hasOwn(array, index)) reject(path + '[' + index + ']', 'must be an own array element');
    return array[index];
  }

  function requireExactOwnKeys(record, allowed, path) {
    Object.keys(record).forEach(function (field) {
      if (allowed.indexOf(field) === -1) reject(path + '.' + field, 'unknown field');
    });
  }

  function validateGeometryNotice(notice, path) {
    requireRecord(notice, path);
    requireExactOwnKeys(notice, GEOMETRY_NOTICE_FIELDS, path);
    GEOMETRY_NOTICE_FIELDS.slice(0, 3).forEach(function (field) {
      requireNonBlankString(requireOwn(notice, field, path), path + '.' + field);
    });
    var changes = requireOwn(notice, 'changes', path);
    if (!Array.isArray(changes) || changes.length === 0) {
      reject(path + '.changes', 'must be a non-empty array');
    }
    for (var index = 0; index < changes.length; index += 1) {
      requireNonBlankString(
        requireOwnArrayElement(changes, index, path + '.changes'),
        path + '.changes[' + index + ']'
      );
    }
  }

  function validateBook(book, path) {
    requireRecord(book, path);
    BOOK_FIELDS.forEach(function (field) { requireOwn(book, field, path); });
    requireNonBlankString(book.publisher, path + '.publisher');
    if (!Number.isInteger(book.approvalYear)) reject(path + '.approvalYear', 'must be an integer');
    if (!Number.isInteger(book.grade) || book.grade <= 0) {
      reject(path + '.grade', 'must be a positive integer');
    }
    requireNonBlankString(book.volume, path + '.volume');
  }

  function validateAndFreezeGeometry(geometry, path) {
    requireRecord(geometry, path);
    requireExactOwnKeys(geometry, GEOMETRY_FIELDS, path);
    var strokeCount = requireOwn(geometry, 'strokeCount', path);
    var strokes = requireOwn(geometry, 'strokes', path);
    var medians = requireOwn(geometry, 'medians', path);
    if (!Number.isInteger(strokeCount) || strokeCount <= 0) {
      reject(path + '.strokeCount', 'must be a positive integer');
    }
    if (!Array.isArray(strokes)) reject(path + '.strokes', 'must be an array');
    if (!Array.isArray(medians)) reject(path + '.medians', 'must be an array');
    if (strokes.length !== strokeCount || medians.length !== strokeCount) {
      reject(path + '.strokeCount', 'must match strokes and medians lengths');
    }

    for (var strokeIndex = 0; strokeIndex < strokes.length; strokeIndex += 1) {
      requireNonBlankString(
        requireOwnArrayElement(strokes, strokeIndex, path + '.strokes'),
        path + '.strokes[' + strokeIndex + ']'
      );
    }
    for (var medianIndex = 0; medianIndex < medians.length; medianIndex += 1) {
      var medianPath = path + '.medians[' + medianIndex + ']';
      var median = requireOwnArrayElement(medians, medianIndex, path + '.medians');
      if (!Array.isArray(median) || median.length < 2) {
        reject(medianPath, 'must contain at least two coordinate points');
      }
      for (var pointIndex = 0; pointIndex < median.length; pointIndex += 1) {
        var pointPath = medianPath + '[' + pointIndex + ']';
        var point = requireOwnArrayElement(median, pointIndex, medianPath);
        if (!Array.isArray(point) || point.length !== 2) {
          reject(pointPath, 'must contain exactly two coordinates');
        }
        var x = requireOwnArrayElement(point, 0, pointPath);
        var y = requireOwnArrayElement(point, 1, pointPath);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          reject(pointPath, 'coordinates must be finite numbers');
        }
        Object.freeze(point);
      }
      Object.freeze(median);
    }

    // Geometry stays zero-copy; freezing marks the caller's shared records as read-only.
    Object.freeze(strokes);
    Object.freeze(medians);
    return Object.freeze(geometry);
  }

  function copyWords(value, character, path) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
      reject(path, 'must be an array with 1 to 3 words');
    }
    var copy = [];
    for (var index = 0; index < value.length; index += 1) {
      var word = requireOwnArrayElement(value, index, path);
      requireNonBlankString(word, path + '[' + index + ']');
      if (word.indexOf(character) === -1) {
        reject(path + '[' + index + ']', 'must include ' + character);
      }
      copy.push(word);
    }
    return Object.freeze(copy);
  }

  function copyEntry(entry, path) {
    requireRecord(entry, path);
    var character = requireOwn(entry, 'character', path);
    var pinyin = requireOwn(entry, 'pinyin', path);
    var audio = requireOwn(entry, 'audio', path);
    if (!isSingleCodePoint(character)) reject(path + '.character', 'must be one code point');
    requireNonBlankString(pinyin, path + '.pinyin');
    requireNonBlankString(audio, path + '.audio');
    var words = copyWords(requireOwn(entry, 'words', path), character, path + '.words');
    var hasCounted = Object.hasOwn(entry, 'counted');
    if (hasCounted && entry.counted !== false) {
      reject(path + '.counted', 'must equal false when present');
    }

    var copy = { character: character, pinyin: pinyin, audio: audio, words: words };
    if (hasCounted) copy.counted = false;
    return Object.freeze(copy);
  }

  function countEntries(recognizeEntries, writeEntries) {
    var recognizeCounted = 0;
    for (var index = 0; index < recognizeEntries.length; index += 1) {
      if (!Object.hasOwn(recognizeEntries[index], 'counted')) recognizeCounted += 1;
    }
    return {
      recognizeDisplayed: recognizeEntries.length,
      recognizeCounted: recognizeCounted,
      polyphonicReviews: recognizeEntries.length - recognizeCounted,
      write: writeEntries.length
    };
  }

  function addCounts(target, counts) {
    target.recognizeDisplayed += counts.recognizeDisplayed;
    target.recognizeCounted += counts.recognizeCounted;
    target.polyphonicReviews += counts.polyphonicReviews;
    target.write += counts.write;
  }

  function createDataStore(library) {
    requireRecord(library, 'library');
    if (requireOwn(library, 'schemaVersion', 'library') !== 1) {
      reject('library.schemaVersion', 'must equal 1');
    }
    validateGeometryNotice(
      requireOwn(library, 'geometryNotice', 'library'),
      'library.geometryNotice'
    );
    var curriculum = requireOwn(library, 'curriculum', 'library');
    requireRecord(curriculum, 'library.curriculum');
    if (requireOwn(curriculum, 'schemaVersion', 'library.curriculum') !== 1) {
      reject('library.curriculum.schemaVersion', 'must equal 1');
    }
    validateBook(requireOwn(curriculum, 'book', 'library.curriculum'), 'library.curriculum.book');
    var units = requireOwn(curriculum, 'units', 'library.curriculum');
    if (!Array.isArray(units) || units.length === 0) {
      reject('library.curriculum.units', 'must be a non-empty array');
    }
    var characters = requireOwn(library, 'characters', 'library');
    requireRecord(characters, 'library.characters');
    var audio = requireOwn(library, 'audio', 'library');
    requireRecord(audio, 'library.audio');
    if (requireOwn(audio, 'format', 'library.audio') !== 'audio/mpeg') {
      reject('library.audio.format', 'must equal audio/mpeg');
    }
    var readings = requireOwn(audio, 'readings', 'library.audio');
    requireRecord(readings, 'library.audio.readings');
    var inputNotices = requireOwn(library, 'notices', 'library');
    requireRecord(inputNotices, 'library.notices');

    var geometryIndex = new Map();
    Object.keys(characters).forEach(function (character) {
      var geometryPath = 'library.characters.' + character;
      var geometry = validateAndFreezeGeometry(characters[character], geometryPath);
      geometryIndex.set(character, geometry);
    });

    var audioIndex = new Map();
    Object.keys(readings).forEach(function (readingId) {
      var path = 'library.audio.readings.' + readingId;
      var record = readings[readingId];
      requireRecord(record, path);
      var file = requireOwn(record, 'file', path);
      requireNonBlankString(file, path + '.file');
      audioIndex.set(readingId, Object.freeze({ file: file }));
    });

    var noticeCopy = {};
    NOTICE_KEYS.forEach(function (key) {
      var value = requireOwn(inputNotices, key, 'library.notices');
      requireNonBlankString(value, 'library.notices.' + key);
      noticeCopy[key] = value;
    });
    var notices = Object.freeze(noticeCopy);
    var unitIds = new Set();
    var sectionIds = new Set();
    var unitIndex = new Map();
    var sectionIndex = new Map();
    var sectionDataIndex = new Map();
    var unitModels = [];

    for (var unitPosition = 0; unitPosition < units.length; unitPosition += 1) {
      var unitPath = 'library.curriculum.units[' + unitPosition + ']';
      var unit = requireOwnArrayElement(units, unitPosition, 'library.curriculum.units');
      requireRecord(unit, unitPath);
      var unitId = requireOwn(unit, 'id', unitPath);
      var unitTitle = requireOwn(unit, 'title', unitPath);
      var lessons = requireOwn(unit, 'lessons', unitPath);
      requireNonBlankString(unitId, unitPath + '.id');
      requireNonBlankString(unitTitle, unitPath + '.title');
      if (unitIds.has(unitId)) reject(unitPath + '.id', 'duplicate unit id ' + unitId);
      unitIds.add(unitId);
      if (!Array.isArray(lessons) || lessons.length === 0) {
        reject(unitPath + '.lessons', 'must be a non-empty array');
      }

      var unitCounts = {
        recognizeDisplayed: 0,
        recognizeCounted: 0,
        polyphonicReviews: 0,
        write: 0
      };
      var sectionModels = [];

      for (var sectionPosition = 0; sectionPosition < lessons.length; sectionPosition += 1) {
        var sectionPath = unitPath + '.lessons[' + sectionPosition + ']';
        var section = requireOwnArrayElement(lessons, sectionPosition, unitPath + '.lessons');
        requireRecord(section, sectionPath);
        var kind = requireOwn(section, 'kind', sectionPath);
        var sectionId = requireOwn(section, 'id', sectionPath);
        var sectionTitle = requireOwn(section, 'title', sectionPath);
        if (kind !== 'lesson' && kind !== 'garden') {
          reject(sectionPath + '.kind', 'must equal lesson or garden');
        }
        requireNonBlankString(sectionId, sectionPath + '.id');
        requireNonBlankString(sectionTitle, sectionPath + '.title');
        var number;
        if (kind === 'lesson') {
          number = requireOwn(section, 'number', sectionPath);
          if (!Number.isInteger(number) || number <= 0) {
            reject(sectionPath + '.number', 'must be a positive integer for a lesson');
          }
        }
        if (sectionIds.has(sectionId)) reject(sectionPath + '.id', 'duplicate section id ' + sectionId);
        sectionIds.add(sectionId);

        var copiedGroups = {};
        var characterIndexes = {};
        GROUPS.forEach(function (group) {
          var sourceEntries = requireOwn(section, group, sectionPath);
          if (!Array.isArray(sourceEntries)) reject(sectionPath + '.' + group, 'must be an array');
          var charactersInGroup = new Map();
          var entries = [];
          for (var entryPosition = 0; entryPosition < sourceEntries.length; entryPosition += 1) {
            var entryPath = sectionPath + '.' + group + '[' + entryPosition + ']';
            var entry = requireOwnArrayElement(sourceEntries, entryPosition, sectionPath + '.' + group);
            var copy = copyEntry(entry, entryPath);
            if (charactersInGroup.has(copy.character)) {
              reject(entryPath + '.character', 'duplicate character ' + copy.character + ' in group');
            }
            if (!geometryIndex.has(copy.character)) {
              reject(entryPath + '.character', 'missing geometry for ' + copy.character);
            }
            if (!audioIndex.has(copy.audio)) {
              reject(entryPath + '.audio', 'missing audio reading ' + copy.audio);
            }
            charactersInGroup.set(copy.character, entryPosition);
            entries.push(copy);
          }
          copiedGroups[group] = Object.freeze(entries);
          characterIndexes[group] = charactersInGroup;
        });
        if (copiedGroups.recognize.length === 0 && copiedGroups.write.length === 0) {
          reject(sectionPath, 'must contain at least one recognize or write entry');
        }

        var counts = countEntries(copiedGroups.recognize, copiedGroups.write);
        addCounts(unitCounts, counts);
        var groups = Object.freeze({
          recognize: copiedGroups.recognize,
          write: copiedGroups.write
        });
        var sectionModelData = {
          kind: kind,
          id: sectionId,
          title: sectionTitle,
          unitId: unitId,
          recognizeDisplayed: counts.recognizeDisplayed,
          recognizeCounted: counts.recognizeCounted,
          polyphonicReviews: counts.polyphonicReviews,
          write: counts.write,
          writeCount: counts.write,
          defaultGroup: copiedGroups.write.length > 0 ? 'write' : 'recognize',
          groups: groups
        };
        if (kind === 'lesson') sectionModelData.number = number;
        var sectionModel = Object.freeze(sectionModelData);
        sectionModels.push(sectionModel);
        sectionIndex.set(sectionId, sectionModel);
        sectionDataIndex.set(sectionId, {
          model: sectionModel,
          unitId: unitId,
          groups: groups,
          characterIndexes: characterIndexes
        });
      }

      var frozenSections = Object.freeze(sectionModels);
      var unitModel = Object.freeze({
        id: unitId,
        title: unitTitle,
        sections: frozenSections,
        sectionCount: frozenSections.length,
        recognizeDisplayed: unitCounts.recognizeDisplayed,
        recognizeCounted: unitCounts.recognizeCounted,
        polyphonicReviews: unitCounts.polyphonicReviews,
        write: unitCounts.write,
        writeCount: unitCounts.write
      });
      unitModels.push(unitModel);
      unitIndex.set(unitId, unitModel);
    }

    var frozenUnits = Object.freeze(unitModels);

    function getUnits() {
      return frozenUnits;
    }

    function getUnit(id) {
      return unitIndex.get(id) || null;
    }

    function getLesson(id) {
      return sectionIndex.get(id) || null;
    }

    function getEntries(lessonId, group) {
      var sectionData = sectionDataIndex.get(lessonId);
      if (!sectionData || (group !== 'recognize' && group !== 'write')) return null;
      return sectionData.groups[group];
    }

    function getDefaultGroup(lessonId) {
      var sectionModel = sectionIndex.get(lessonId);
      return sectionModel ? sectionModel.defaultGroup : null;
    }

    function hasLesson(id) {
      return sectionIndex.has(id);
    }

    function getGeometry(character) {
      return geometryIndex.get(character) || null;
    }

    function getAudio(readingId) {
      return audioIndex.get(readingId) || null;
    }

    function getNotices() {
      return notices;
    }

    function resolve(selector) {
      if (!isRecord(selector)
        || !Object.hasOwn(selector, 'lessonId')
        || !Object.hasOwn(selector, 'group')) {
        return null;
      }
      var lessonId = selector.lessonId;
      var group = selector.group;
      var sectionData = sectionDataIndex.get(lessonId);
      if (!sectionData || (group !== 'recognize' && group !== 'write')) return null;
      var entries = sectionData.groups[group];
      var index;
      if (Object.hasOwn(selector, 'character')) {
        index = sectionData.characterIndexes[group].get(selector.character);
        if (index === undefined) return null;
      } else {
        if (!Object.hasOwn(selector, 'index')) return null;
        index = selector.index;
        if (!Number.isInteger(index) || index < 0 || index >= entries.length) return null;
      }

      var entry = entries[index];
      return Object.freeze({
        unit: unitIndex.get(sectionData.unitId),
        lesson: sectionData.model,
        group: group,
        entries: entries,
        entry: entry,
        index: index,
        total: entries.length,
        previous: index > 0 ? entries[index - 1] : null,
        next: index + 1 < entries.length ? entries[index + 1] : null,
        geometry: geometryIndex.get(entry.character),
        audio: audioIndex.get(entry.audio)
      });
    }

    return Object.freeze({
      getUnits: getUnits,
      getUnit: getUnit,
      getLesson: getLesson,
      getEntries: getEntries,
      getDefaultGroup: getDefaultGroup,
      hasLesson: hasLesson,
      resolve: resolve,
      getGeometry: getGeometry,
      getAudio: getAudio,
      getNotices: getNotices
    });
  }

  return Object.freeze({ createDataStore: createDataStore });
}));
