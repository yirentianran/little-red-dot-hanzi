import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

import dataStoreModule from '../js/data-store.js';
import routerModule from '../js/router.js';

const { createDataStore } = dataStoreModule;
const { normalizeRoute, parseHash, serializeHash } = routerModule;

async function loadRuntimeLibrary() {
  const source = await readFile(new URL('../data/library-data.js', import.meta.url), 'utf8');
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename: 'data/library-data.js' });
  return context.window.HANZI_LIBRARY;
}

test('parses and serializes all canonical route shapes in fixed parameter order', () => {
  const routes = [
    [{ view: 'directory' }, '#/'],
    [
      { view: 'lesson', lessonId: 'lesson-1', group: 'write' },
      '#/lesson?lesson=lesson-1&group=write'
    ],
    [
      { view: 'character', lessonId: 'lesson-1', group: 'write', character: '潮' },
      '#/character?lesson=lesson-1&group=write&character=%E6%BD%AE'
    ],
    [
      { view: 'practice', lessonId: 'lesson-1', group: 'write', scope: 'group', character: '潮' },
      '#/practice?lesson=lesson-1&group=write&scope=group&character=%E6%BD%AE'
    ]
  ];

  for (const [route, hash] of routes) {
    assert.equal(serializeHash(route), hash);
    assert.deepEqual(parseHash(hash), route);
    assert.equal(Object.getPrototypeOf(parseHash(hash)), Object.prototype);
  }
});

test('uses URLSearchParams encoding semantics for Chinese and special values', () => {
  const route = {
    view: 'character',
    lessonId: '课文 &?=/% 1',
    group: 'recognize',
    character: '郭'
  };
  const hash = serializeHash(route);

  assert.equal(
    hash,
    '#/character?lesson=%E8%AF%BE%E6%96%87+%26%3F%3D%2F%25+1&group=recognize&character=%E9%83%AD'
  );
  assert.deepEqual(parseHash(hash), route);
});

test('parseHash never throws for malformed encoding, arbitrary strings, or prototype-shaped parameters', () => {
  const hashes = [
    '', '#', '#/%', '#/character?character=%E0%A4%A', '#/lesson?lesson=%',
    '#/character?__proto__=polluted&constructor=bad', 'not-a-hash', null, undefined, 42
  ];

  for (const hash of hashes) {
    let parsed;
    assert.doesNotThrow(() => {
      parsed = parseHash(hash);
    });
    assert.equal(Object.getPrototypeOf(parsed), Object.prototype);
    assert.equal({}.polluted, undefined);
  }
});

test('parse candidates preserve recognized values while normalization rejects unknown or repeated parameters', async () => {
  const store = createDataStore(await loadRuntimeLibrary());
  const repeated = parseHash('#/lesson?lesson=lesson-1&group=write&group=recognize');
  const unknown = parseHash('#/lesson?lesson=lesson-1&group=write&extra=1');
  const unknownView = parseHash('#/unknown?lesson=lesson-1&group=write');

  assert.equal(repeated.lessonId, 'lesson-1');
  assert.equal(repeated.group, 'write');
  assert.equal(repeated._invalid, true);
  assert.equal(unknown._invalid, true);
  assert.equal(unknownView._invalid, true);
  assert.deepEqual(normalizeRoute(repeated, store), { view: 'directory' });
  assert.deepEqual(normalizeRoute(unknown, store), { view: 'directory' });
  assert.deepEqual(normalizeRoute(unknownView, store), { view: 'directory' });
});

test('practice routes preserve canonical fields and reject repeated or unknown parameters', async () => {
  const store = createDataStore(await loadRuntimeLibrary());
  const route = {
    view: 'practice', lessonId: 'lesson-1', group: 'write', scope: 'group', character: '潮'
  };
  const repeated = parseHash('#/practice?lesson=lesson-1&group=write&scope=group&scope=single&character=%E6%BD%AE');
  const unknown = parseHash('#/practice?lesson=lesson-1&group=write&scope=group&character=%E6%BD%AE&extra=1');

  assert.equal(serializeHash(route), '#/practice?lesson=lesson-1&group=write&scope=group&character=%E6%BD%AE');
  assert.deepEqual(parseHash(serializeHash(route)), route);
  assert.equal(repeated._invalid, true);
  assert.equal(unknown._invalid, true);
  assert.deepEqual(normalizeRoute(repeated, store), { view: 'directory' });
  assert.deepEqual(normalizeRoute(unknown, store), { view: 'directory' });
});

test('normalizes practice routes with strict hierarchy and selected group entries', async () => {
  const store = createDataStore(await loadRuntimeLibrary());
  const lessonRoute = { view: 'lesson', lessonId: 'lesson-1', group: 'write' };
  const groupRoute = {
    view: 'practice', lessonId: 'lesson-1', group: 'write', scope: 'group', character: '潮'
  };

  assert.deepEqual(normalizeRoute({
    view: 'practice', lessonId: 'lesson-1', group: 'recognize', scope: 'single', character: '盐'
  }, store), {
    view: 'practice', lessonId: 'lesson-1', group: 'recognize', scope: 'single', character: '盐'
  });
  assert.deepEqual(normalizeRoute({
    view: 'practice', lessonId: 'lesson-1', group: 'write', scope: 'group', character: '盐'
  }, store), groupRoute);

  for (const scope of [undefined, '', 'unknown']) {
    const route = { view: 'practice', lessonId: 'lesson-1', group: 'write', character: '潮' };
    if (scope !== undefined) route.scope = scope;
    assert.deepEqual(normalizeRoute(route, store), lessonRoute);
  }
  assert.deepEqual(normalizeRoute({
    view: 'practice', lessonId: 'missing', group: 'write', scope: 'single', character: '潮'
  }, store), { view: 'directory' });
  assert.deepEqual(normalizeRoute({
    view: 'practice', lessonId: 'missing', group: 'write', scope: 'group', character: '潮'
  }, store), { view: 'directory' });
  assert.deepEqual(normalizeRoute({
    view: 'practice', lessonId: 'lesson-1', scope: 'group', character: '潮'
  }, store), lessonRoute);
  assert.deepEqual(normalizeRoute({
    view: 'practice', lessonId: 'lesson-1', group: '', scope: 'single', character: '潮'
  }, store), lessonRoute);
  assert.deepEqual(normalizeRoute({
    view: 'practice', lessonId: 'lesson-1', group: '', scope: 'group', character: '潮'
  }, store), lessonRoute);
  assert.deepEqual(normalizeRoute({
    view: 'practice', lessonId: 'lesson-1', group: 'bad', scope: 'single', character: '潮'
  }, store), lessonRoute);
  assert.deepEqual(normalizeRoute({
    view: 'practice', lessonId: 'lesson-1', group: 'bad', scope: 'group', character: '潮'
  }, store), lessonRoute);
  assert.deepEqual(normalizeRoute({
    view: 'practice', lessonId: 'lesson-1', group: 'write', scope: 'single', character: '盐'
  }, store), lessonRoute);
  assert.deepEqual(normalizeRoute({
    view: 'practice', lessonId: 'lesson-1', group: 'write', scope: 'group', character: '盐'
  }, store), groupRoute);
});

test('practice routing never accepts inherited or accessor fields', async () => {
  const store = createDataStore(await loadRuntimeLibrary());
  const inheritedScope = Object.assign(Object.create({ scope: 'group' }), {
    view: 'practice', lessonId: 'lesson-1', group: 'write', character: '潮'
  });
  let getterCalls = 0;
  const accessorRoute = {
    lessonId: 'lesson-1', group: 'write', scope: 'group', character: '潮'
  };
  Object.defineProperty(accessorRoute, 'view', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('route getter must not run');
    }
  });

  assert.equal(serializeHash(inheritedScope), '#/');
  assert.deepEqual(normalizeRoute(inheritedScope, store), {
    view: 'lesson', lessonId: 'lesson-1', group: 'write'
  });
  assert.equal(serializeHash(accessorRoute), '#/');
  assert.deepEqual(normalizeRoute(accessorRoute, store), { view: 'directory' });
  assert.equal(getterCalls, 0);
});

test('practice required fields must be own data properties without invoking accessors', async () => {
  const store = createDataStore(await loadRuntimeLibrary());
  const fields = ['lessonId', 'group', 'scope', 'character'];

  for (const field of fields) {
    const route = {
      view: 'practice', lessonId: 'lesson-1', group: 'write', scope: 'group', character: '潮'
    };
    let getterCalls = 0;
    Object.defineProperty(route, field, {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error(field + ' getter must not run');
      }
    });

    assert.doesNotThrow(() => serializeHash(route));
    assert.equal(serializeHash(route), '#/');
    assert.doesNotThrow(() => normalizeRoute(route, store));
    assert.equal(getterCalls, 0);
  }

  for (const field of fields) {
    const inherited = {
      view: 'practice', lessonId: 'lesson-1', group: 'write', scope: 'group', character: '潮'
    };
    const value = inherited[field];
    delete inherited[field];
    const route = Object.assign(Object.create({ [field]: value }), inherited);

    assert.equal(serializeHash(route), '#/');
  }
});

test('serializeHash safely returns the directory hash for invalid route objects', () => {
  const invalidRoutes = [
    null,
    {},
    { view: 'unknown' },
    { view: 'directory', extra: true },
    { view: 'lesson', lessonId: '', group: 'write' },
    { view: 'lesson', lessonId: 'lesson-1', group: 'other' },
    { view: 'character', lessonId: 'lesson-1', group: 'write', character: '' },
    { view: 'character', lessonId: 'lesson-1', group: 'write', character: '两个' },
    { view: 'practice', lessonId: 'lesson-1', group: 'write', scope: 'single' },
    { view: 'practice', lessonId: 'lesson-1', group: 'write', character: '潮' },
    { view: 'practice', lessonId: 'lesson-1', group: 'write', scope: 'other', character: '潮' },
    { view: 'practice', lessonId: 'lesson-1', group: 'write', scope: 'single', character: '两个' },
    { view: 'practice', lessonId: 'lesson-1', group: 'write', scope: 'single', character: '潮', extra: true },
    Object.defineProperty({
      view: 'practice', lessonId: 'lesson-1', group: 'write', scope: 'single', character: '潮'
    }, 'extra', { value: true })
  ];

  for (const route of invalidRoutes) assert.equal(serializeHash(route), '#/');
});

test('serializeHash never accepts required route fields inherited from a prototype', () => {
  const inheritedRoute = Object.create({
    view: 'character', lessonId: 'lesson-1', group: 'write', character: '潮'
  });
  const inheritedLesson = Object.assign(Object.create({ lessonId: 'lesson-1' }), {
    view: 'lesson', group: 'write'
  });
  const inheritedGroup = Object.assign(Object.create({ group: 'write' }), {
    view: 'lesson', lessonId: 'lesson-1'
  });
  const inheritedCharacter = Object.assign(Object.create({ character: '潮' }), {
    view: 'character', lessonId: 'lesson-1', group: 'write'
  });

  assert.equal(serializeHash(inheritedRoute), '#/');
  assert.equal(serializeHash(inheritedLesson), '#/');
  assert.equal(serializeHash(inheritedGroup), '#/');
  assert.equal(serializeHash(inheritedCharacter), '#/');
});

test('normalizes lesson and garden routes with canonical default-group behavior', async () => {
  const store = createDataStore(await loadRuntimeLibrary());

  assert.deepEqual(normalizeRoute({ view: 'lesson', lessonId: 'missing', group: 'write' }, store), {
    view: 'directory'
  });
  assert.deepEqual(normalizeRoute({ view: 'lesson', lessonId: 'lesson-1' }, store), {
    view: 'lesson', lessonId: 'lesson-1', group: 'write'
  });
  assert.deepEqual(normalizeRoute({ view: 'lesson', lessonId: 'lesson-3', group: 'write' }, store), {
    view: 'lesson', lessonId: 'lesson-3', group: 'recognize'
  });
  assert.deepEqual(normalizeRoute({ view: 'lesson', lessonId: 'garden-2', group: 'bad' }, store), {
    view: 'lesson', lessonId: 'garden-2', group: 'recognize'
  });
  assert.deepEqual(normalizeRoute({
    view: 'lesson', lessonId: 'lesson-1', group: 'write', character: '潮'
  }, store), {
    view: 'lesson', lessonId: 'lesson-1', group: 'write'
  });
});

test('normalizes character routes only when the selected character exists in a non-empty group', async () => {
  const store = createDataStore(await loadRuntimeLibrary());

  assert.deepEqual(normalizeRoute({
    view: 'character', lessonId: 'lesson-1', group: 'write', character: '潮'
  }, store), {
    view: 'character', lessonId: 'lesson-1', group: 'write', character: '潮'
  });
  assert.deepEqual(normalizeRoute({
    view: 'character', lessonId: 'lesson-1', group: 'write', character: '盐'
  }, store), {
    view: 'lesson', lessonId: 'lesson-1', group: 'write'
  });
  assert.deepEqual(normalizeRoute({
    view: 'character', lessonId: 'lesson-3', group: 'write', character: '巢'
  }, store), {
    view: 'lesson', lessonId: 'lesson-3', group: 'recognize'
  });
  assert.deepEqual(normalizeRoute({
    view: 'character', lessonId: 'lesson-1', group: 'bad', character: '潮'
  }, store), {
    view: 'lesson', lessonId: 'lesson-1', group: 'write'
  });
  assert.deepEqual(normalizeRoute({
    view: 'character', lessonId: 'garden-2', group: 'recognize', character: '驻'
  }, store), {
    view: 'character', lessonId: 'garden-2', group: 'recognize', character: '驻'
  });
});

test('normalization ignores inherited route fields and retains hierarchical fallbacks', async () => {
  const store = createDataStore(await loadRuntimeLibrary());
  const inheritedRoute = Object.create({
    view: 'character', lessonId: 'lesson-1', group: 'write', character: '潮'
  });
  const inheritedLesson = Object.assign(Object.create({ lessonId: 'lesson-1' }), {
    view: 'lesson', group: 'write'
  });
  const inheritedGroup = Object.assign(Object.create({ group: 'recognize' }), {
    view: 'lesson', lessonId: 'lesson-1'
  });
  const inheritedCharacter = Object.assign(Object.create({ character: '潮' }), {
    view: 'character', lessonId: 'lesson-1', group: 'write'
  });

  assert.deepEqual(normalizeRoute(inheritedRoute, store), { view: 'directory' });
  assert.deepEqual(normalizeRoute(inheritedLesson, store), { view: 'directory' });
  assert.deepEqual(normalizeRoute(inheritedGroup, store), {
    view: 'lesson', lessonId: 'lesson-1', group: 'write'
  });
  assert.deepEqual(normalizeRoute(inheritedCharacter, store), {
    view: 'lesson', lessonId: 'lesson-1', group: 'write'
  });
});

test('normalization outputs frozen plain objects and drops unknown fields', async () => {
  const store = createDataStore(await loadRuntimeLibrary());
  const normalized = normalizeRoute({
    view: 'character', lessonId: 'lesson-1', group: 'write', character: '潮', extra: 'reject'
  }, store);

  assert.deepEqual(normalized, { view: 'directory' });
  assert.ok(Object.isFrozen(normalized));
  assert.equal(Object.getPrototypeOf(normalized), Object.prototype);
  assert.equal(Object.hasOwn(normalized, 'extra'), false);
});

test('round-trips and normalizes all 521 real curriculum entry and practice routes', async () => {
  const library = await loadRuntimeLibrary();
  const store = createDataStore(library);
  let count = 0;

  for (const unit of library.curriculum.units) {
    for (const lesson of unit.lessons) {
      for (const group of ['recognize', 'write']) {
        for (const entry of lesson[group]) {
          const route = { view: 'character', lessonId: lesson.id, group, character: entry.character };
          const parsed = parseHash(serializeHash(route));
          assert.deepEqual(parsed, route);
          assert.deepEqual(normalizeRoute(parsed, store), route);
          for (const scope of ['single', 'group']) {
            const practiceRoute = {
              view: 'practice', lessonId: lesson.id, group, scope, character: entry.character
            };
            const practiceParsed = parseHash(serializeHash(practiceRoute));
            assert.deepEqual(practiceParsed, practiceRoute);
            assert.deepEqual(normalizeRoute(practiceParsed, store), practiceRoute);
          }
          count += 1;
        }
      }
    }
  }

  assert.equal(count, 521);
});

test('classic scripts merge both public APIs into window.HanziApp without DOM or fetch', async () => {
  const [storeSource, routerSource] = await Promise.all([
    readFile(new URL('../js/data-store.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/router.js', import.meta.url), 'utf8')
  ]);
  const context = { window: {} };

  vm.runInNewContext(storeSource, context, { filename: 'js/data-store.js' });
  vm.runInNewContext(routerSource, context, { filename: 'js/router.js' });

  assert.equal(typeof context.window.HanziApp.createDataStore, 'function');
  assert.equal(typeof context.window.HanziApp.parseHash, 'function');
  assert.equal(typeof context.window.HanziApp.serializeHash, 'function');
  assert.equal(typeof context.window.HanziApp.normalizeRoute, 'function');
  assert.doesNotMatch(`${storeSource}\n${routerSource}`, /\b(?:fetch|document)\b/);
});
