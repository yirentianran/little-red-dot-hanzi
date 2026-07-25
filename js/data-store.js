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

  function copyEntry(entry, path) {
    requireRecord(entry, path);
    if (!isSingleCodePoint(entry.character)) reject(path + '.character', 'must be one code point');
    requireNonBlankString(entry.pinyin, path + '.pinyin');
    requireNonBlankString(entry.audio, path + '.audio');
    if (Object.hasOwn(entry, 'counted') && entry.counted !== false) {
      reject(path + '.counted', 'must equal false when present');
    }

    var copy = {
      character: entry.character,
      pinyin: entry.pinyin,
      audio: entry.audio
    };
    if (entry.counted === false) copy.counted = false;
    return Object.freeze(copy);
  }

  function countEntries(recognizeEntries, writeEntries) {
    var recognizeCounted = 0;
    for (var index = 0; index < recognizeEntries.length; index += 1) {
      if (recognizeEntries[index].counted !== false) recognizeCounted += 1;
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
    if (library.schemaVersion !== 1) reject('library.schemaVersion', 'must equal 1');
    requireRecord(library.curriculum, 'library.curriculum');
    if (library.curriculum.schemaVersion !== 1) {
      reject('library.curriculum.schemaVersion', 'must equal 1');
    }
    requireRecord(library.curriculum.book, 'library.curriculum.book');
    if (!Array.isArray(library.curriculum.units) || library.curriculum.units.length === 0) {
      reject('library.curriculum.units', 'must be a non-empty array');
    }
    requireRecord(library.characters, 'library.characters');
    requireRecord(library.audio, 'library.audio');
    if (library.audio.format !== 'audio/mpeg') {
      reject('library.audio.format', 'must equal audio/mpeg');
    }
    requireRecord(library.audio.readings, 'library.audio.readings');
    requireRecord(library.notices, 'library.notices');

    var geometryIndex = new Map();
    Object.keys(library.characters).forEach(function (character) {
      var geometry = library.characters[character];
      requireRecord(geometry, 'library.characters.' + character);
      geometryIndex.set(character, geometry);
    });

    var audioIndex = new Map();
    Object.keys(library.audio.readings).forEach(function (readingId) {
      var path = 'library.audio.readings.' + readingId;
      var record = library.audio.readings[readingId];
      requireRecord(record, path);
      requireNonBlankString(record.file, path + '.file');
      audioIndex.set(readingId, Object.freeze({ file: record.file }));
    });

    var noticeCopy = {};
    NOTICE_KEYS.forEach(function (key) {
      requireNonBlankString(library.notices[key], 'library.notices.' + key);
      noticeCopy[key] = library.notices[key];
    });
    var notices = Object.freeze(noticeCopy);
    var unitIds = new Set();
    var sectionIds = new Set();
    var unitIndex = new Map();
    var sectionIndex = new Map();
    var sectionDataIndex = new Map();
    var unitModels = [];

    library.curriculum.units.forEach(function (unit, unitPosition) {
      var unitPath = 'library.curriculum.units[' + unitPosition + ']';
      requireRecord(unit, unitPath);
      requireNonBlankString(unit.id, unitPath + '.id');
      requireNonBlankString(unit.title, unitPath + '.title');
      if (unitIds.has(unit.id)) reject(unitPath + '.id', 'duplicate unit id ' + unit.id);
      unitIds.add(unit.id);
      if (!Array.isArray(unit.lessons) || unit.lessons.length === 0) {
        reject(unitPath + '.lessons', 'must be a non-empty array');
      }

      var unitCounts = {
        recognizeDisplayed: 0,
        recognizeCounted: 0,
        polyphonicReviews: 0,
        write: 0
      };
      var sectionModels = [];

      unit.lessons.forEach(function (section, sectionPosition) {
        var sectionPath = unitPath + '.lessons[' + sectionPosition + ']';
        requireRecord(section, sectionPath);
        if (section.kind !== 'lesson' && section.kind !== 'garden') {
          reject(sectionPath + '.kind', 'must equal lesson or garden');
        }
        requireNonBlankString(section.id, sectionPath + '.id');
        requireNonBlankString(section.title, sectionPath + '.title');
        if (section.kind === 'lesson' && (!Number.isInteger(section.number) || section.number <= 0)) {
          reject(sectionPath + '.number', 'must be a positive integer for a lesson');
        }
        if (sectionIds.has(section.id)) reject(sectionPath + '.id', 'duplicate section id ' + section.id);
        sectionIds.add(section.id);

        var copiedGroups = {};
        var characterIndexes = {};
        GROUPS.forEach(function (group) {
          if (!Array.isArray(section[group])) reject(sectionPath + '.' + group, 'must be an array');
          var charactersInGroup = new Map();
          var entries = section[group].map(function (entry, entryPosition) {
            var entryPath = sectionPath + '.' + group + '[' + entryPosition + ']';
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
            return copy;
          });
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
          kind: section.kind,
          id: section.id,
          title: section.title,
          unitId: unit.id,
          recognizeDisplayed: counts.recognizeDisplayed,
          recognizeCounted: counts.recognizeCounted,
          polyphonicReviews: counts.polyphonicReviews,
          write: counts.write,
          writeCount: counts.write,
          defaultGroup: copiedGroups.write.length > 0 ? 'write' : 'recognize',
          groups: groups
        };
        if (section.kind === 'lesson') sectionModelData.number = section.number;
        var sectionModel = Object.freeze(sectionModelData);
        sectionModels.push(sectionModel);
        sectionIndex.set(section.id, sectionModel);
        sectionDataIndex.set(section.id, {
          model: sectionModel,
          unitId: unit.id,
          groups: groups,
          characterIndexes: characterIndexes
        });
      });

      var frozenSections = Object.freeze(sectionModels);
      var unitModel = Object.freeze({
        id: unit.id,
        title: unit.title,
        sections: frozenSections,
        sectionCount: frozenSections.length,
        recognizeDisplayed: unitCounts.recognizeDisplayed,
        recognizeCounted: unitCounts.recognizeCounted,
        polyphonicReviews: unitCounts.polyphonicReviews,
        write: unitCounts.write,
        writeCount: unitCounts.write
      });
      unitModels.push(unitModel);
      unitIndex.set(unit.id, unitModel);
    });

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
      var section = sectionIndex.get(lessonId);
      return section ? section.defaultGroup : null;
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
      if (!isRecord(selector)) return null;
      var sectionData = sectionDataIndex.get(selector.lessonId);
      if (!sectionData || (selector.group !== 'recognize' && selector.group !== 'write')) return null;
      var entries = sectionData.groups[selector.group];
      var index;
      if (Object.hasOwn(selector, 'character')) {
        index = sectionData.characterIndexes[selector.group].get(selector.character);
        if (index === undefined) return null;
      } else {
        index = selector.index;
        if (!Number.isInteger(index) || index < 0 || index >= entries.length) return null;
      }

      var entry = entries[index];
      return Object.freeze({
        unit: unitIndex.get(sectionData.unitId),
        lesson: sectionData.model,
        group: selector.group,
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
