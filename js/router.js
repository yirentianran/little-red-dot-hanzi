(function (root, factory) {
  'use strict';

  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.window) {
    root.window.HanziApp = Object.assign(root.window.HanziApp || {}, api);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var PARAMETER_FIELDS = Object.freeze({
    lesson: 'lessonId',
    group: 'group',
    scope: 'scope',
    character: 'character'
  });
  var PATH_VIEWS = Object.freeze({
    '/': 'directory',
    '/lesson': 'lesson',
    '/character': 'character',
    '/practice': 'practice'
  });

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function isNonBlankString(value) {
    return typeof value === 'string' && value.trim() !== '';
  }

  function hasOnlyKeys(value, allowed) {
    return Reflect.ownKeys(value).every(function (key) {
      return typeof key === 'string' && allowed.indexOf(key) !== -1;
    });
  }

  function getOwnDataValue(record, field) {
    if (!Object.hasOwn(record, field)) return { present: false };
    var descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(record, field);
    } catch (_error) {
      return { present: false };
    }
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return { present: false };
    return { present: true, value: descriptor.value };
  }

  function directoryRoute() {
    return Object.freeze({ view: 'directory' });
  }

  function parseHash(hash) {
    var source;
    try {
      source = String(hash === undefined ? '' : hash);
    } catch (_error) {
      return { view: 'directory', _invalid: true };
    }
    if (source.charAt(0) === '#') source = source.slice(1);
    var queryPosition = source.indexOf('?');
    var path = queryPosition === -1 ? source : source.slice(0, queryPosition);
    var query = queryPosition === -1 ? '' : source.slice(queryPosition + 1);
    var view = Object.hasOwn(PATH_VIEWS, path) ? PATH_VIEWS[path] : 'directory';
    var candidate = { view: view };
    var invalid = !Object.hasOwn(PATH_VIEWS, path);

    try {
      var parameters = new URLSearchParams(query);
      var seen = new Set();
      parameters.forEach(function (value, name) {
        if (!Object.hasOwn(PARAMETER_FIELDS, name)) {
          invalid = true;
          return;
        }
        if (seen.has(name)) {
          invalid = true;
          return;
        }
        seen.add(name);
        candidate[PARAMETER_FIELDS[name]] = value;
      });
    } catch (_error) {
      invalid = true;
    }
    if (invalid) candidate._invalid = true;
    return candidate;
  }

  function serializeHash(route) {
    if (!isRecord(route)) return '#/';
    var viewField = getOwnDataValue(route, 'view');
    if (!viewField.present) return '#/';
    var view = viewField.value;
    if (view === 'directory') return '#/';
    if (view !== 'lesson' && view !== 'character' && view !== 'practice') return '#/';
    var allowed = view === 'lesson'
      ? ['view', 'lessonId', 'group']
      : view === 'character'
        ? ['view', 'lessonId', 'group', 'character']
        : ['view', 'lessonId', 'group', 'scope', 'character'];
    var lessonField = getOwnDataValue(route, 'lessonId');
    var groupField = getOwnDataValue(route, 'group');
    if (!hasOnlyKeys(route, allowed)
      || !lessonField.present
      || !groupField.present
      || !isNonBlankString(lessonField.value)
      || (groupField.value !== 'write' && groupField.value !== 'recognize')) {
      return '#/';
    }
    var characterField = getOwnDataValue(route, 'character');
    if ((view === 'character' || view === 'practice')
      && (!characterField.present
        || typeof characterField.value !== 'string'
        || Array.from(characterField.value).length !== 1)) {
      return '#/';
    }
    var scopeField = getOwnDataValue(route, 'scope');
    if (view === 'practice'
      && (!scopeField.present || (scopeField.value !== 'single' && scopeField.value !== 'group'))) {
      return '#/';
    }

    try {
      var parameters = new URLSearchParams();
      parameters.append('lesson', lessonField.value);
      parameters.append('group', groupField.value);
      if (view === 'practice') parameters.append('scope', scopeField.value);
      if (view === 'character' || view === 'practice') {
        parameters.append('character', characterField.value);
      }
      return '#/' + view + '?' + parameters.toString();
    } catch (_error) {
      return '#/';
    }
  }

  function normalizeRoute(route, store) {
    if (!isRecord(route)) {
      return directoryRoute();
    }
    var invalidField = getOwnDataValue(route, '_invalid');
    var viewField = getOwnDataValue(route, 'view');
    if ((invalidField.present && invalidField.value === true) || !viewField.present) {
      return directoryRoute();
    }
    var view = viewField.value;
    if (view === 'directory') return directoryRoute();
    if (view !== 'lesson' && view !== 'character' && view !== 'practice') return directoryRoute();
    var allowed = view === 'practice'
      ? ['view', 'lessonId', 'group', 'scope', 'character']
      : ['view', 'lessonId', 'group', 'character'];
    if (!hasOnlyKeys(route, allowed)) return directoryRoute();
    var lessonField = getOwnDataValue(route, 'lessonId');
    if (!lessonField.present
      || !isNonBlankString(lessonField.value)
      || !store.hasLesson(lessonField.value)) {
      return directoryRoute();
    }

    var lessonId = lessonField.value;
    var defaultGroup = store.getDefaultGroup(lessonId);
    var groupField = getOwnDataValue(route, 'group');
    var group = groupField.present ? groupField.value : undefined;
    var groupIsNamed = group === 'write' || group === 'recognize';
    var selectedEntries = groupIsNamed ? store.getEntries(lessonId, group) : null;
    var groupIsUsable = selectedEntries !== null && selectedEntries.length > 0;
    if (!groupIsUsable) {
      return Object.freeze({ view: 'lesson', lessonId: lessonId, group: defaultGroup });
    }
    if (view === 'lesson') {
      return Object.freeze({ view: 'lesson', lessonId: lessonId, group: group });
    }
    var characterField = getOwnDataValue(route, 'character');
    if (view === 'practice') {
      var scopeField = getOwnDataValue(route, 'scope');
      if (!scopeField.present || (scopeField.value !== 'single' && scopeField.value !== 'group')) {
        return Object.freeze({ view: 'lesson', lessonId: lessonId, group: group });
      }
      var practiceCharacter = characterField.present ? characterField.value : undefined;
      var practiceResolved = typeof practiceCharacter === 'string'
        && Array.from(practiceCharacter).length === 1
        ? store.resolve({ lessonId: lessonId, group: group, character: practiceCharacter })
        : null;
      if (practiceResolved === null && scopeField.value === 'single') {
        return Object.freeze({ view: 'lesson', lessonId: lessonId, group: group });
      }
      return Object.freeze({
        view: 'practice',
        lessonId: lessonId,
        group: group,
        scope: scopeField.value,
        character: practiceResolved === null ? selectedEntries[0].character : practiceCharacter
      });
    }
    if (!characterField.present
      || typeof characterField.value !== 'string'
      || Array.from(characterField.value).length !== 1
      || store.resolve({
        lessonId: lessonId,
        group: group,
        character: characterField.value
      }) === null) {
      return Object.freeze({ view: 'lesson', lessonId: lessonId, group: group });
    }
    return Object.freeze({
      view: 'character',
      lessonId: lessonId,
      group: group,
      character: characterField.value
    });
  }

  return Object.freeze({
    parseHash: parseHash,
    serializeHash: serializeHash,
    normalizeRoute: normalizeRoute
  });
}));
