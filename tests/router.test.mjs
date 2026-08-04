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
      { view: 'lesson', lessonId: 'g4f-01', group: 'write' },
      '#/lesson?lesson=g4f-01&group=write'
    ],
    [
      { view: 'character', lessonId: 'g4f-01', group: 'write', character: '宵' },
      '#/character?lesson=g4f-01&group=write&character=%E5%AE%B5'
    ],
    [
      { view: 'practice', lessonId: 'g4f-01', group: 'write', scope: 'group', character: '宵' },
      '#/practice?lesson=g4f-01&group=write&scope=group&character=%E5%AE%B5'
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
  const repeated = parseHash('#/lesson?lesson=g4f-01&group=write&group=recognize');
  const unknown = parseHash('#/lesson?lesson=g4f-01&group=write&extra=1');
  const unknownView = parseHash('#/unknown?lesson=g4f-01&group=write');

  assert.equal(repeated.lessonId, 'g4f-01');
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
    view: 'practice', lessonId: 'g4f-01', group: 'write', scope: 'group', character: '宵'
  };
  const repeated = parseHash('#/practice?lesson=g4f-01&group=write&scope=group&scope=single&character=%E5%AE%B5');
  const unknown = parseHash('#/practice?lesson=g4f-01&group=write&scope=group&character=%E5%AE%B5&extra=1');

  assert.equal(serializeHash(route), '#/practice?lesson=g4f-01&group=write&scope=group&character=%E5%AE%B5');
  assert.deepEqual(parseHash(serializeHash(route)), route);
  assert.equal(repeated._invalid, true);
  assert.equal(unknown._invalid, true);
  assert.deepEqual(normalizeRoute(repeated, store), { view: 'directory' });
  assert.deepEqual(normalizeRoute(unknown, store), { view: 'directory' });
});

test('normalizes practice routes with strict hierarchy and selected group entries', async () => {
  const store = createDataStore(await loadRuntimeLibrary());
  const lessonRoute = { view: 'lesson', lessonId: 'g4f-01', group: 'write' };
  const groupRoute = {
    view: 'practice', lessonId: 'g4f-01', group: 'write', scope: 'group', character: '宵'
  };

  assert.deepEqual(normalizeRoute({
    view: 'practice', lessonId: 'g4f-01', group: 'write', scope: 'single', character: '宵'
  }, store), {
    view: 'practice', lessonId: 'g4f-01', group: 'write', scope: 'single', character: '宵'
  });
  assert.deepEqual(normalizeRoute({
    view: 'practice', lessonId: 'g4f-01', group: 'write', scope: 'group', character: '盐'
  }, store), groupRoute);

  for (const scope of [undefined, '', 'unknown']) {
    const route = { view: 'practice', lessonId: 'g4f-01', group: 'write', character: '宵' };
    if (scope !== undefined) route.scope = scope;
    assert.deepEqual(normalizeRoute(route, store), lessonRoute);
  }
  assert.deepEqual(normalizeRoute({
    view: 'practice', lessonId: 'missing', group: 'write', scope: 'single', character: '宵'
  }, store), { view: 'directory' });
  assert.deepEqual(normalizeRoute({
    view: 'practice', lessonId: 'missing', group: 'write', scope: 'group', character: '宵'
  }, store), { view: 'directory' });
  assert.deepEqual(normalizeRoute({
    view: 'practice', lessonId: 'g4f-01', scope: 'group', character: '宵'
  }, store), lessonRoute);
  assert.deepEqual(normalizeRoute({
    view: 'practice', lessonId: 'g4f-01', group: '', scope: 'single', character: '宵'
  }, store), lessonRoute);
  assert.deepEqual(normalizeRoute({
    view: 'practice', lessonId: 'g4f-01', group: '', scope: 'group', character: '宵'
  }, store), lessonRoute);
  assert.deepEqual(normalizeRoute({
    view: 'practice', lessonId: 'g4f-01', group: 'bad', scope: 'single', character: '宵'
  }, store), lessonRoute);
  assert.deepEqual(normalizeRoute({
    view: 'practice', lessonId: 'g4f-01', group: 'bad', scope: 'group', character: '宵'
  }, store), lessonRoute);
  assert.deepEqual(normalizeRoute({
    view: 'practice', lessonId: 'g4f-01', group: 'write', scope: 'single', character: '盐'
  }, store), lessonRoute);
  assert.deepEqual(normalizeRoute({
    view: 'practice', lessonId: 'g4f-01', group: 'write', scope: 'group', character: '盐'
  }, store), groupRoute);
});

test('practice routing never accepts inherited or accessor fields', async () => {
  const store = createDataStore(await loadRuntimeLibrary());
  const inheritedScope = Object.assign(Object.create({ scope: 'group' }), {
    view: 'practice', lessonId: 'g4f-01', group: 'write', character: '宵'
  });
  let getterCalls = 0;
  const accessorRoute = {
    lessonId: 'g4f-01', group: 'write', scope: 'group', character: '宵'
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
    view: 'lesson', lessonId: 'g4f-01', group: 'write'
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
      view: 'practice', lessonId: 'g4f-01', group: 'write', scope: 'group', character: '宵'
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
      view: 'practice', lessonId: 'g4f-01', group: 'write', scope: 'group', character: '宵'
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
    { view: 'lesson', lessonId: 'g4f-01', group: 'other' },
    { view: 'character', lessonId: 'g4f-01', group: 'write', character: '' },
    { view: 'character', lessonId: 'g4f-01', group: 'write', character: '两个' },
    { view: 'practice', lessonId: 'g4f-01', group: 'write', scope: 'single' },
    { view: 'practice', lessonId: 'g4f-01', group: 'write', character: '宵' },
    { view: 'practice', lessonId: 'g4f-01', group: 'write', scope: 'other', character: '宵' },
    { view: 'practice', lessonId: 'g4f-01', group: 'write', scope: 'single', character: '两个' },
    { view: 'practice', lessonId: 'g4f-01', group: 'write', scope: 'single', character: '宵', extra: true },
    Object.defineProperty({
      view: 'practice', lessonId: 'g4f-01', group: 'write', scope: 'single', character: '宵'
    }, 'extra', { value: true })
  ];

  for (const route of invalidRoutes) assert.equal(serializeHash(route), '#/');
});

test('serializeHash never accepts required route fields inherited from a prototype', () => {
  const inheritedRoute = Object.create({
    view: 'character', lessonId: 'g4f-01', group: 'write', character: '宵'
  });
  const inheritedLesson = Object.assign(Object.create({ lessonId: 'g4f-01' }), {
    view: 'lesson', group: 'write'
  });
  const inheritedGroup = Object.assign(Object.create({ group: 'write' }), {
    view: 'lesson', lessonId: 'g4f-01'
  });
  const inheritedCharacter = Object.assign(Object.create({ character: '宵' }), {
    view: 'character', lessonId: 'g4f-01', group: 'write'
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
  assert.deepEqual(normalizeRoute({ view: 'lesson', lessonId: 'g4f-01' }, store), {
    view: 'lesson', lessonId: 'g4f-01', group: 'write'
  });
  assert.deepEqual(normalizeRoute({ view: 'lesson', lessonId: 'g4f-03', group: 'recognize' }, store), {
    view: 'lesson', lessonId: 'g4f-03', group: 'write'
  });
  assert.deepEqual(normalizeRoute({ view: 'lesson', lessonId: 'g4f-02', group: 'bad' }, store), {
    view: 'lesson', lessonId: 'g4f-02', group: 'write'
  });
  assert.deepEqual(normalizeRoute({
    view: 'lesson', lessonId: 'g4f-01', group: 'write', character: '宵'
  }, store), {
    view: 'lesson', lessonId: 'g4f-01', group: 'write'
  });
});

test('normalizes character routes only when the selected character exists in a non-empty group', async () => {
  const store = createDataStore(await loadRuntimeLibrary());

  assert.deepEqual(normalizeRoute({
    view: 'character', lessonId: 'g4f-01', group: 'write', character: '宵'
  }, store), {
    view: 'character', lessonId: 'g4f-01', group: 'write', character: '宵'
  });
  assert.deepEqual(normalizeRoute({
    view: 'character', lessonId: 'g4f-01', group: 'write', character: '盐'
  }, store), {
    view: 'lesson', lessonId: 'g4f-01', group: 'write'
  });
  assert.deepEqual(normalizeRoute({
    view: 'character', lessonId: 'g4f-03', group: 'write', character: '邮'
  }, store), {
    view: 'character', lessonId: 'g4f-03', group: 'write', character: '邮'
  });
  assert.deepEqual(normalizeRoute({
    view: 'character', lessonId: 'g4f-01', group: 'bad', character: '宵'
  }, store), {
    view: 'lesson', lessonId: 'g4f-01', group: 'write'
  });
  assert.deepEqual(normalizeRoute({
    view: 'character', lessonId: 'g4f-02', group: 'write', character: '砂'
  }, store), {
    view: 'character', lessonId: 'g4f-02', group: 'write', character: '砂'
  });
});

test('normalization ignores inherited route fields and retains hierarchical fallbacks', async () => {
  const store = createDataStore(await loadRuntimeLibrary());
  const inheritedRoute = Object.create({
    view: 'character', lessonId: 'g4f-01', group: 'write', character: '宵'
  });
  const inheritedLesson = Object.assign(Object.create({ lessonId: 'g4f-01' }), {
    view: 'lesson', group: 'write'
  });
  const inheritedGroup = Object.assign(Object.create({ group: 'recognize' }), {
    view: 'lesson', lessonId: 'g4f-01'
  });
  const inheritedCharacter = Object.assign(Object.create({ character: '宵' }), {
    view: 'character', lessonId: 'g4f-01', group: 'write'
  });

  assert.deepEqual(normalizeRoute(inheritedRoute, store), { view: 'directory' });
  assert.deepEqual(normalizeRoute(inheritedLesson, store), { view: 'directory' });
  assert.deepEqual(normalizeRoute(inheritedGroup, store), {
    view: 'lesson', lessonId: 'g4f-01', group: 'write'
  });
  assert.deepEqual(normalizeRoute(inheritedCharacter, store), {
    view: 'lesson', lessonId: 'g4f-01', group: 'write'
  });
});

test('normalization outputs frozen plain objects and drops unknown fields', async () => {
  const store = createDataStore(await loadRuntimeLibrary());
  const normalized = normalizeRoute({
    view: 'character', lessonId: 'g4f-01', group: 'write', character: '宵', extra: 'reject'
  }, store);

  assert.deepEqual(normalized, { view: 'directory' });
  assert.ok(Object.isFrozen(normalized));
  assert.equal(Object.getPrototypeOf(normalized), Object.prototype);
  assert.equal(Object.hasOwn(normalized, 'extra'), false);
});

test('round-trips and normalizes all 225 independent catalog entry and practice routes', async () => {
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

  assert.equal(count, 225);
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
