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

test('serializeHash safely returns the directory hash for invalid route objects', () => {
  const invalidRoutes = [
    null,
    {},
    { view: 'unknown' },
    { view: 'directory', extra: true },
    { view: 'lesson', lessonId: '', group: 'write' },
    { view: 'lesson', lessonId: 'lesson-1', group: 'other' },
    { view: 'character', lessonId: 'lesson-1', group: 'write', character: '' },
    { view: 'character', lessonId: 'lesson-1', group: 'write', character: '两个' }
  ];

  for (const route of invalidRoutes) assert.equal(serializeHash(route), '#/');
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

test('round-trips and normalizes all 521 real curriculum entry routes', async () => {
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
