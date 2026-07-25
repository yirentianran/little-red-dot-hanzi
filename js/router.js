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
    character: 'character'
  });
  var PATH_VIEWS = Object.freeze({
    '/': 'directory',
    '/lesson': 'lesson',
    '/character': 'character'
  });

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function isNonBlankString(value) {
    return typeof value === 'string' && value.trim() !== '';
  }

  function hasOnlyKeys(value, allowed) {
    return Object.keys(value).every(function (key) { return allowed.indexOf(key) !== -1; });
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
    if (!isRecord(route) || !Object.hasOwn(route, 'view')) return '#/';
    var view = route.view;
    if (view === 'directory') return '#/';
    if (view !== 'lesson' && view !== 'character') return '#/';
    var allowed = view === 'lesson'
      ? ['view', 'lessonId', 'group']
      : ['view', 'lessonId', 'group', 'character'];
    if (!hasOnlyKeys(route, allowed)
      || !Object.hasOwn(route, 'lessonId')
      || !Object.hasOwn(route, 'group')
      || !isNonBlankString(route.lessonId)
      || (route.group !== 'write' && route.group !== 'recognize')) {
      return '#/';
    }
    if (view === 'character'
      && (!Object.hasOwn(route, 'character')
        || typeof route.character !== 'string'
        || Array.from(route.character).length !== 1)) {
      return '#/';
    }

    try {
      var parameters = new URLSearchParams();
      parameters.append('lesson', route.lessonId);
      parameters.append('group', route.group);
      if (view === 'character') parameters.append('character', route.character);
      return '#/' + view + '?' + parameters.toString();
    } catch (_error) {
      return '#/';
    }
  }

  function normalizeRoute(route, store) {
    if (!isRecord(route)
      || (Object.hasOwn(route, '_invalid') && route._invalid === true)
      || !Object.hasOwn(route, 'view')) {
      return directoryRoute();
    }
    var view = route.view;
    if (view === 'directory') return directoryRoute();
    if (view !== 'lesson' && view !== 'character') return directoryRoute();
    var allowed = ['view', 'lessonId', 'group', 'character'];
    if (!hasOnlyKeys(route, allowed)) return directoryRoute();
    if (!Object.hasOwn(route, 'lessonId')
      || !isNonBlankString(route.lessonId)
      || !store.hasLesson(route.lessonId)) {
      return directoryRoute();
    }

    var lessonId = route.lessonId;
    var defaultGroup = store.getDefaultGroup(lessonId);
    var group = Object.hasOwn(route, 'group') ? route.group : undefined;
    var groupIsNamed = group === 'write' || group === 'recognize';
    var selectedEntries = groupIsNamed ? store.getEntries(lessonId, group) : null;
    var groupIsUsable = selectedEntries !== null && selectedEntries.length > 0;
    if (!groupIsUsable) {
      return Object.freeze({ view: 'lesson', lessonId: lessonId, group: defaultGroup });
    }
    if (view === 'lesson') {
      return Object.freeze({ view: 'lesson', lessonId: lessonId, group: group });
    }
    if (!Object.hasOwn(route, 'character')
      || typeof route.character !== 'string'
      || Array.from(route.character).length !== 1
      || store.resolve({
        lessonId: lessonId,
        group: group,
        character: route.character
      }) === null) {
      return Object.freeze({ view: 'lesson', lessonId: lessonId, group: group });
    }
    return Object.freeze({
      view: 'character',
      lessonId: lessonId,
      group: group,
      character: route.character
    });
  }

  return Object.freeze({
    parseHash: parseHash,
    serializeHash: serializeHash,
    normalizeRoute: normalizeRoute
  });
}));
