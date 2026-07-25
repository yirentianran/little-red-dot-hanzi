import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

import routerModule from '../js/router.js';

const require = createRequire(import.meta.url);
const STORAGE_KEY = 'hanzi-tracking:last-route:v1';

function loadApp() {
  return require('../js/app.js');
}

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
    this.added = [];
    this.removed = [];
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
    this.added.push([type, listener]);
  }

  removeEventListener(type, listener) {
    if (this.listeners.has(type)) this.listeners.get(type).delete(listener);
    this.removed.push([type, listener]);
  }

  emit(type, event = {}) {
    for (const listener of Array.from(this.listeners.get(type) || [])) listener(event);
  }

  listenerCount(type) {
    return (this.listeners.get(type) || new Set()).size;
  }
}

class FakeElement extends FakeEventTarget {
  constructor(name = 'div') {
    super();
    this.name = name;
    this.attributes = new Map();
    this.parentNode = null;
    this.childNodes = [];
    this.focusCalls = 0;
    this.textContent = '';
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  replaceChildren(...children) {
    for (const child of this.childNodes) {
      if (child && typeof child === 'object') child.parentNode = null;
    }
    this.childNodes = children;
    for (const child of children) {
      if (child && typeof child === 'object') child.parentNode = this;
    }
  }

  focus() {
    this.focusCalls += 1;
  }
}

function createLocation(initialHash, log) {
  let hash = initialHash;
  return {
    get hash() {
      return hash;
    },
    set hash(value) {
      hash = String(value);
      log.push('location.hash=' + hash);
    },
    replace(value) {
      hash = String(value);
      log.push('location.replace=' + hash);
    },
    setRaw(value) {
      hash = String(value);
    }
  };
}

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    calls: [],
    getItem(key) {
      this.calls.push(['get', key]);
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      this.calls.push(['set', key, value]);
      values.set(key, String(value));
    },
    removeItem(key) {
      this.calls.push(['remove', key]);
      values.delete(key);
    },
    value(key) {
      return values.get(key);
    }
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createHarness(options = {}) {
  const log = [];
  const root = new FakeElement('main');
  const announcer = { textContent: '' };
  const windowObject = new FakeEventTarget();
  const documentObject = new FakeEventTarget();
  documentObject.hidden = options.hidden === true;
  const location = createLocation(options.hash ?? '#/', log);
  windowObject.location = location;
  const storage = options.storage === undefined ? createStorage() : options.storage;

  const entries = {
    write: Object.freeze([
      Object.freeze({ character: '郭', pinyin: 'guō', audio: 'guo1' }),
      Object.freeze({ character: '城', pinyin: 'chéng', audio: 'cheng2' })
    ]),
    recognize: Object.freeze([
      Object.freeze({ character: '识', pinyin: 'shí', audio: 'shi2' }),
      Object.freeze({ character: '字', pinyin: 'zì', audio: 'zi4' })
    ])
  };
  const lesson = Object.freeze({
    id: 'lesson-1', unitId: 'unit-1', kind: 'lesson', number: 1, title: '示例课',
    defaultGroup: 'write', write: 2, recognizeDisplayed: 2,
    recognizeCounted: 2, polyphonicReviews: 0
  });
  const unit = Object.freeze({ id: 'unit-1', title: '第一单元', sections: [lesson] });
  const store = Object.freeze({
    getUnits: () => [unit],
    getUnit: (id) => (id === unit.id ? unit : null),
    getLesson: (id) => (id === lesson.id ? lesson : null),
    getEntries: (lessonId, group) => (
      lessonId === lesson.id && Object.hasOwn(entries, group) ? entries[group] : null
    ),
    getDefaultGroup: (id) => (id === lesson.id ? 'write' : null),
    hasLesson: (id) => id === lesson.id,
    resolve(selector) {
      if (!selector || selector.lessonId !== lesson.id || !Object.hasOwn(entries, selector.group)) {
        return null;
      }
      const groupEntries = entries[selector.group];
      const index = Object.hasOwn(selector, 'character')
        ? groupEntries.findIndex((entry) => entry.character === selector.character)
        : selector.index;
      if (!Number.isInteger(index) || index < 0 || index >= groupEntries.length) return null;
      const entry = groupEntries[index];
      return Object.freeze({
        unit,
        lesson,
        group: selector.group,
        entries: groupEntries,
        entry,
        index,
        total: groupEntries.length,
        previous: index > 0 ? groupEntries[index - 1] : null,
        next: index + 1 < groupEntries.length ? groupEntries[index + 1] : null,
        geometry: Object.freeze({ strokeCount: 3, strokes: ['a', 'b', 'c'], medians: [] }),
        audio: Object.freeze({ file: 'audio/' + entry.audio + '.mp3' })
      });
    }
  });

  const state = {
    log,
    store,
    views: [],
    renderCounts: { directory: 0, lesson: 0, character: 0 },
    renderHandles: [],
    renderers: [],
    animations: [],
    audioPlays: [],
    unavailable: new Set(),
    audioPlay: (id) => Promise.resolve(!state.unavailable.has(id)),
    app: null
  };

  function heading(name) {
    return new FakeElement(name + '-heading');
  }

  function installView(kind, handle) {
    const viewRoot = new FakeElement(kind + '-view');
    root.replaceChildren(viewRoot);
    handle.root = viewRoot;
    state.views.push(kind);
    state.renderHandles.push(handle);
    state.renderCounts[kind] += 1;
    log.push('render.' + kind);
    return Object.freeze(handle);
  }

  const audio = Object.freeze({
    play(id) {
      state.audioPlays.push(id);
      log.push('audio.play=' + id);
      return state.audioPlay(id);
    },
    stop() {
      log.push('audio.stop');
      if (options.throwAudioStop) throw new Error('audio stop failed');
    },
    isAvailable(id) {
      return !state.unavailable.has(id);
    },
    destroy() {
      log.push('audio.destroy');
    }
  });

  const api = {
    ...routerModule,
    createDataStore(candidate) {
      assert.equal(candidate, options.library || library);
      return store;
    },
    createDirectoryModel: () => Object.freeze({ units: [] }),
    createLessonModel: (_store, selector) => Object.freeze({ ...selector, lesson, unit }),
    createCharacterModel(resolved) {
      return Object.freeze({
        unit: resolved.unit,
        lesson: resolved.lesson,
        group: resolved.group,
        character: resolved.entry.character,
        pinyin: resolved.entry.pinyin,
        audioId: resolved.entry.audio,
        strokeCount: resolved.geometry.strokeCount,
        index: resolved.index,
        total: resolved.total,
        previous: resolved.previous,
        next: resolved.next,
        previousDisabled: resolved.previous === null,
        nextDisabled: resolved.next === null,
        isReview: false
      });
    },
    renderDirectory() {
      let resumeAvailable = null;
      const handle = {
        heading: heading('directory'),
        get resumeAvailable() {
          return resumeAvailable;
        },
        setResumeAvailable(value) {
          resumeAvailable = value;
          log.push('resume=' + value);
        }
      };
      return installView('directory', handle);
    },
    renderLesson(_root, model) {
      return installView('lesson', { heading: heading('lesson'), model });
    },
    renderCharacter(_root, model) {
      let boardErrors = 0;
      const handle = {
        heading: heading('character'),
        board: new FakeElement('board'),
        model,
        animationStates: [],
        audioStates: ['ready'],
        get boardErrors() {
          return boardErrors;
        },
        setAnimationState(value) {
          this.animationStates.push(value);
          log.push('view.animation=' + value.status + ':' + value.strokeIndex);
          if (state.onSetAnimationState) state.onSetAnimationState(value, this);
        },
        setAudioState(value) {
          this.audioStates.push(value);
          log.push('view.audio=' + value);
        },
        showBoardError() {
          boardErrors += 1;
          log.push('view.board-error');
        }
      };
      return installView('character', handle);
    },
    createSvgRenderer() {
      log.push('renderer.create');
      if (options.throwRenderer) throw new Error('renderer failed');
      const renderer = {
        showFullCharacter() {
          log.push('renderer.showFullCharacter');
        },
        destroy() {
          log.push('renderer.destroy');
          if (state.onRendererDestroy) state.onRendererDestroy();
          if (options.throwRendererDestroy) throw new Error('renderer destroy failed');
        }
      };
      state.renderers.push(renderer);
      return Object.freeze(renderer);
    },
    createAnimationController(_renderer, animationOptions) {
      log.push('animation.create');
      if (options.throwAnimation) throw new Error('animation failed');
      let current = Object.freeze({
        status: 'idle', mode: 'continuous', strokeIndex: 0, progress: 0, speed: 'normal'
      });
      const publish = (overrides) => {
        current = Object.freeze({ ...current, ...overrides });
        animationOptions.onStateChange(current);
      };
      const animation = {
        emit: publish,
        replay() {
          log.push('animation.replay');
          publish({ status: 'playing', mode: 'continuous', strokeIndex: 0, progress: 0 });
        },
        play() {
          log.push('animation.play');
          publish({ status: 'playing' });
        },
        pause() {
          log.push('animation.pause');
          publish({ status: 'paused' });
        },
        previousStroke() {
          log.push('animation.previousStroke');
          publish({ status: 'playing', mode: 'step', strokeIndex: Math.max(0, current.strokeIndex - 1) });
        },
        nextStroke() {
          log.push('animation.nextStroke');
          publish({ status: 'playing', mode: 'step', strokeIndex: Math.min(2, current.strokeIndex + 1) });
        },
        setSpeed(speed) {
          log.push('animation.setSpeed=' + speed);
          publish({ speed });
        },
        handleVisibilityChange(hidden) {
          log.push('animation.visibility=' + hidden);
        },
        getState() {
          return current;
        },
        destroy() {
          log.push('animation.destroy');
          if (state.onAnimationDestroy) state.onAnimationDestroy();
          if (options.throwAnimationDestroy) throw new Error('animation destroy failed');
        }
      };
      state.animations.push(animation);
      return Object.freeze(animation);
    },
    createAudioController(manifest, createAudio) {
      assert.equal(manifest, (options.library || library).audio);
      assert.equal(typeof createAudio, 'function');
      return audio;
    }
  };

  const library = options.library || Object.freeze({
    audio: Object.freeze({
      format: 'audio/mpeg',
      readings: Object.freeze({
        guo1: Object.freeze({ file: 'audio/guo1.mp3' }),
        cheng2: Object.freeze({ file: 'audio/cheng2.mp3' }),
        shi2: Object.freeze({ file: 'audio/shi2.mp3' }),
        zi4: Object.freeze({ file: 'audio/zi4.mp3' })
      })
    })
  });
  const createAudio = () => ({ play() {}, pause() {} });
  const createOptions = {
    api,
    library,
    root,
    announcer,
    windowObject,
    documentObject,
    location,
    storage,
    createAudio,
    reducedMotion: options.reducedMotion === true
  };
  if (Object.hasOwn(options, 'initialRoute')) createOptions.initialRoute = options.initialRoute;

  function click(action, attributes = {}, clickOptions = {}) {
    const actionNode = new FakeElement(action);
    actionNode.setAttribute('data-action', action);
    for (const [name, value] of Object.entries(attributes)) actionNode.setAttribute(name, value);
    if (clickOptions.disabled) actionNode.setAttribute('disabled', '');
    const target = clickOptions.nested ? new FakeElement('nested') : actionNode;
    if (clickOptions.nested) {
      actionNode.replaceChildren(target);
    }
    if (!clickOptions.outside) {
      const currentView = root.childNodes[0] || root;
      currentView.replaceChildren(actionNode);
    }
    root.emit('click', { target });
    return actionNode;
  }

  return {
    api,
    library,
    root,
    announcer,
    windowObject,
    documentObject,
    location,
    storage,
    state,
    createOptions,
    click
  };
}

function currentHandle(harness) {
  return harness.state.renderHandles.at(-1);
}

function characterRoute(character = '郭', group = 'write') {
  return { view: 'character', lessonId: 'lesson-1', group, character };
}

function characterHash(character = '郭', group = 'write') {
  return routerModule.serializeHash(characterRoute(character, group));
}

test('exports the complete frozen application integration API', () => {
  const app = loadApp();

  assert.deepEqual(Object.keys(app).sort(), ['bootstrapApp', 'createApp']);
  assert.ok(Object.isFrozen(app));
});

test('explicit initial route wins, renders synchronously, canonicalizes hash, and never steals focus', () => {
  const harness = createHarness({
    hash: '#/lesson?lesson=lesson-1&group=recognize',
    initialRoute: characterRoute()
  });
  const app = loadApp().createApp(harness.createOptions);
  harness.state.app = app;

  assert.deepEqual(app.getRoute(), characterRoute());
  assert.equal(currentHandle(harness).heading.focusCalls, 0);
  assert.equal(harness.state.renderCounts.character, 1);
  assert.ok(harness.state.log.includes('animation.replay'));
  assert.equal(harness.state.audioPlays.length, 0);
  assert.equal(harness.location.hash, characterHash());
  assert.ok(Object.isFrozen(app));
  assert.ok(Object.isFrozen(app.debugControllers()));
});

test('empty hash stays on directory, exposes resume without auto-navigation, and repairs hash', () => {
  const storage = createStorage({ [STORAGE_KEY]: characterHash() });
  const harness = createHarness({ hash: '', storage });
  const app = loadApp().createApp(harness.createOptions);

  assert.deepEqual(app.getRoute(), { view: 'directory' });
  assert.equal(currentHandle(harness).resumeAvailable, true);
  assert.equal(harness.state.renderCounts.character, 0);
  assert.equal(harness.location.hash, '#/');

  harness.click('resume-learning', {}, { nested: true });
  assert.deepEqual(app.getRoute(), characterRoute());
  assert.equal(currentHandle(harness).heading.focusCalls, 1);
});

test('hashchange supports canonical back navigation, invalid fallbacks, and same-route dedupe', () => {
  const harness = createHarness({ hash: characterHash() });
  const app = loadApp().createApp(harness.createOptions);
  const firstAnimation = harness.state.animations[0];

  harness.location.setRaw('#/lesson?lesson=lesson-1&group=write');
  harness.windowObject.emit('hashchange');
  assert.deepEqual(app.getRoute(), { view: 'lesson', lessonId: 'lesson-1', group: 'write' });
  assert.equal(currentHandle(harness).heading.focusCalls, 1);
  assert.ok(harness.state.log.includes('animation.destroy'));

  const renders = { ...harness.state.renderCounts };
  app.navigate({ view: 'lesson', lessonId: 'lesson-1', group: 'write' });
  harness.windowObject.emit('hashchange');
  assert.deepEqual(harness.state.renderCounts, renders);

  harness.location.setRaw('#/lesson?lesson=lesson-1');
  harness.windowObject.emit('hashchange');
  assert.equal(harness.location.hash, '#/lesson?lesson=lesson-1&group=write');
  assert.deepEqual(harness.state.renderCounts, renders);

  harness.location.setRaw('#/not-a-route');
  harness.windowObject.emit('hashchange');
  assert.deepEqual(app.getRoute(), { view: 'directory' });
  assert.equal(harness.location.hash, '#/');
  assert.equal(firstAnimation, harness.state.animations[0]);
});

test('navigate renders before writing hash and the resulting hashchange is a no-op', () => {
  const harness = createHarness({ hash: '#/' });
  const app = loadApp().createApp(harness.createOptions);
  harness.state.log.length = 0;

  app.navigate({ view: 'lesson', lessonId: 'lesson-1', group: 'write' });
  assert.ok(harness.state.log.indexOf('render.lesson') < harness.state.log.indexOf(
    'location.hash=#/lesson?lesson=lesson-1&group=write'
  ));
  const renderCount = harness.state.renderCounts.lesson;
  harness.windowObject.emit('hashchange');
  assert.equal(harness.state.renderCounts.lesson, renderCount);
});

test('#app skip-link hash focuses main then restores the current canonical route without cleanup', () => {
  const harness = createHarness({ hash: characterHash() });
  const app = loadApp().createApp(harness.createOptions);
  const before = app.debugControllers();
  harness.state.log.length = 0;

  harness.location.setRaw('#app');
  harness.windowObject.emit('hashchange');

  assert.equal(harness.root.focusCalls, 1);
  assert.deepEqual(app.getRoute(), characterRoute());
  assert.equal(app.debugControllers().renderer, before.renderer);
  assert.equal(app.debugControllers().animation, before.animation);
  assert.equal(harness.state.renderCounts.character, 1);
  assert.deepEqual(harness.state.log, ['location.replace=' + characterHash()]);
});

test('page cleanup clears controller refs first and isolates destroy failures in fixed order', () => {
  const harness = createHarness({
    hash: characterHash(),
    throwAnimationDestroy: true,
    throwRendererDestroy: true,
    throwAudioStop: true
  });
  const app = loadApp().createApp(harness.createOptions);
  harness.state.app = app;
  const snapshots = [];
  harness.state.onAnimationDestroy = () => snapshots.push(app.debugControllers());
  harness.state.log.length = 0;

  assert.doesNotThrow(() => app.navigate({
    view: 'lesson', lessonId: 'lesson-1', group: 'write'
  }));

  assert.deepEqual(harness.state.log.slice(0, 4), [
    'animation.destroy', 'renderer.destroy', 'audio.stop', 'render.lesson'
  ]);
  assert.equal(snapshots[0].renderer, null);
  assert.equal(snapshots[0].animation, null);
  assert.equal(app.getRoute().view, 'lesson');
});

test('partial listener installation rolls back in reverse order and destroys shared audio', () => {
  const harness = createHarness({ hash: '#/' });
  const rootRemove = harness.root.removeEventListener;
  const windowRemove = harness.windowObject.removeEventListener;
  harness.root.removeEventListener = function (...args) {
    harness.state.log.push('rollback.root');
    return rootRemove.apply(this, args);
  };
  harness.windowObject.removeEventListener = function (...args) {
    harness.state.log.push('rollback.window');
    return windowRemove.apply(this, args);
  };
  harness.documentObject.addEventListener = function (type) {
    assert.equal(type, 'visibilitychange');
    throw new Error('listener setup failed');
  };

  assert.throws(
    () => loadApp().createApp(harness.createOptions),
    /listener setup failed/
  );
  assert.equal(harness.root.listenerCount('click'), 0);
  assert.equal(harness.windowObject.listenerCount('hashchange'), 0);
  assert.equal(harness.documentObject.listenerCount('visibilitychange'), 0);
  assert.deepEqual(harness.state.log.slice(-3), [
    'rollback.window', 'rollback.root', 'audio.destroy'
  ]);
});

test('listener rollback removes the current registration when add registers then throws', () => {
  const harness = createHarness({ hash: '#/' });
  const documentAdd = harness.documentObject.addEventListener;
  harness.documentObject.addEventListener = function (...args) {
    documentAdd.apply(this, args);
    throw new Error('listener threw after registering');
  };

  assert.throws(
    () => loadApp().createApp(harness.createOptions),
    /listener threw after registering/
  );
  assert.equal(harness.root.listenerCount('click'), 0);
  assert.equal(harness.windowObject.listenerCount('hashchange'), 0);
  assert.equal(harness.documentObject.listenerCount('visibilitychange'), 0);
  assert.equal(
    harness.state.log.filter((entry) => entry === 'audio.destroy').length,
    1
  );
});

test('pre-handle character model failures propagate through complete createApp rollback', () => {
  const harness = createHarness({ hash: characterHash() });
  harness.api.createCharacterModel = () => {
    throw new Error('character model failed');
  };

  assert.throws(
    () => loadApp().createApp(harness.createOptions),
    /character model failed/
  );
  assert.equal(harness.root.listenerCount('click'), 0);
  assert.equal(harness.windowObject.listenerCount('hashchange'), 0);
  assert.equal(harness.documentObject.listenerCount('visibilitychange'), 0);
  assert.equal(
    harness.state.log.filter((entry) => entry === 'audio.destroy').length,
    1
  );
});

test('a nested navigate from old-controller destroy owns the final route and controllers', () => {
  const harness = createHarness({ hash: characterHash() });
  const app = loadApp().createApp(harness.createOptions);
  const oldAnimation = harness.state.animations[0];
  harness.state.onAnimationDestroy = () => {
    harness.state.onAnimationDestroy = null;
    app.navigate(characterRoute('城'));
  };
  harness.state.log.length = 0;

  const changed = app.navigate({ view: 'lesson', lessonId: 'lesson-1', group: 'write' });

  assert.equal(changed, false);
  assert.deepEqual(app.getRoute(), characterRoute('城'));
  assert.equal(harness.location.hash, characterHash('城'));
  assert.equal(app.debugControllers().animation, harness.state.animations[1]);
  assert.equal(app.debugControllers().renderer, harness.state.renderers[1]);
  assert.equal(oldAnimation, harness.state.animations[0]);
  assert.ok(
    harness.state.log.lastIndexOf('animation.destroy')
      < harness.state.log.lastIndexOf('animation.create')
  );
});

test('character render reentrancy cannot split the nested route from URL or stored resume state', () => {
  const storage = createStorage();
  const harness = createHarness({ hash: '#/', storage, reducedMotion: true });
  const app = loadApp().createApp(harness.createOptions);
  harness.state.onSetAnimationState = () => {
    harness.state.onSetAnimationState = null;
    app.navigate(characterRoute('城'));
  };
  harness.state.log.length = 0;

  const changed = app.navigate(characterRoute());

  assert.equal(changed, false);
  assert.deepEqual(app.getRoute(), characterRoute('城'));
  assert.equal(harness.location.hash, characterHash('城'));
  assert.equal(storage.value(STORAGE_KEY), characterHash('城'));
  assert.equal(app.debugControllers().animation, harness.state.animations.at(-1));
  assert.equal(app.debugControllers().renderer, harness.state.renderers.at(-1));
});

test('a superseded storage write is reconciled to the nested winning character route', () => {
  const storage = createStorage();
  const harness = createHarness({ hash: '#/', storage, reducedMotion: true });
  const app = loadApp().createApp(harness.createOptions);
  const setItem = storage.setItem;
  let nested = false;
  storage.setItem = function (key, value) {
    if (!nested && value === characterHash()) {
      nested = true;
      app.navigate(characterRoute('城'));
    }
    setItem.call(this, key, value);
  };

  const changed = app.navigate(characterRoute());

  assert.equal(changed, false);
  assert.deepEqual(app.getRoute(), characterRoute('城'));
  assert.equal(harness.location.hash, characterHash('城'));
  assert.equal(storage.value(STORAGE_KEY), characterHash('城'));
});

test('stale animation callbacks cannot update or announce into a later view', () => {
  const harness = createHarness({ hash: characterHash() });
  const app = loadApp().createApp(harness.createOptions);
  const oldAnimation = harness.state.animations[0];
  const oldHandle = currentHandle(harness);

  app.navigate({ view: 'lesson', lessonId: 'lesson-1', group: 'write' });
  const announcement = harness.announcer.textContent;
  const updates = oldHandle.animationStates.length;
  oldAnimation.emit({ status: 'completed', strokeIndex: 2, progress: 1 });

  assert.equal(oldHandle.animationStates.length, updates);
  assert.equal(harness.announcer.textContent, announcement);
});

test('write auto-plays while recognize and reduced-motion characters stay static until manual replay', () => {
  const writeHarness = createHarness({ hash: characterHash() });
  loadApp().createApp(writeHarness.createOptions);
  assert.ok(writeHarness.state.log.includes('animation.replay'));
  assert.equal(writeHarness.state.log.includes('renderer.showFullCharacter'), false);

  const recognizeHarness = createHarness({ hash: characterHash('识', 'recognize') });
  loadApp().createApp(recognizeHarness.createOptions);
  assert.ok(recognizeHarness.state.log.includes('renderer.showFullCharacter'));
  assert.equal(recognizeHarness.state.log.includes('animation.replay'), false);

  const reducedHarness = createHarness({ hash: characterHash(), reducedMotion: true });
  loadApp().createApp(reducedHarness.createOptions);
  assert.ok(reducedHarness.state.log.includes('renderer.showFullCharacter'));
  assert.equal(reducedHarness.state.log.includes('animation.replay'), false);
  reducedHarness.click('toggle-play', {}, { nested: true });
  assert.ok(reducedHarness.state.log.includes('animation.replay'));
});

test('toggle pauses active continuous completion, resumes paused state, and dispatches stroke tools', () => {
  const harness = createHarness({ hash: characterHash() });
  loadApp().createApp(harness.createOptions);
  const animation = harness.state.animations[0];
  harness.state.log.length = 0;

  animation.emit({ status: 'completed', mode: 'continuous', strokeIndex: 2, progress: 1 });
  harness.click('toggle-play');
  assert.ok(harness.state.log.includes('animation.pause'));
  harness.click('toggle-play');
  assert.ok(harness.state.log.includes('animation.play'));
  harness.click('previous-stroke');
  harness.click('next-stroke');
  harness.click('set-speed', { 'data-speed': 'fast' });
  assert.ok(harness.state.log.includes('animation.previousStroke'));
  assert.ok(harness.state.log.includes('animation.nextStroke'));
  assert.ok(harness.state.log.includes('animation.setSpeed=fast'));
});

test('a nested same-view next-stroke callback keeps ownership of the final announcement', () => {
  const harness = createHarness({ hash: characterHash(), reducedMotion: true });
  const app = loadApp().createApp(harness.createOptions);
  const animation = harness.state.animations[0];
  harness.state.onSetAnimationState = (state) => {
    if (state.status !== 'playing' || state.mode !== 'continuous' || state.strokeIndex !== 0) return;
    harness.state.onSetAnimationState = null;
    app.dispatch({ action: 'next-stroke' });
  };

  animation.emit({ status: 'playing', mode: 'continuous', strokeIndex: 0, progress: 0.25 });

  assert.equal(currentHandle(harness).animationStates.at(-1).strokeIndex, 1);
  assert.equal(harness.announcer.textContent, '正在书写第2笔');
});

test('a state setter that navigates then throws cannot announce into the winning view', () => {
  const harness = createHarness({ hash: characterHash(), reducedMotion: true });
  const app = loadApp().createApp(harness.createOptions);
  const animation = harness.state.animations[0];
  const announcement = harness.announcer.textContent;
  harness.state.onSetAnimationState = () => {
    harness.state.onSetAnimationState = null;
    app.navigate({ view: 'lesson', lessonId: 'lesson-1', group: 'write' });
    throw new Error('old state setter failed');
  };

  animation.emit({ status: 'playing', mode: 'continuous', strokeIndex: 0, progress: 0.25 });

  assert.equal(app.getRoute().view, 'lesson');
  assert.equal(harness.announcer.textContent, announcement);
});

test('public dispatch accepts own-field command objects without weakening delegated actions', () => {
  const harness = createHarness({ hash: characterHash(), reducedMotion: true });
  const app = loadApp().createApp(harness.createOptions);

  assert.equal(app.dispatch({ action: 'toggle-play' }), true);
  assert.ok(harness.state.log.includes('animation.replay'));
  assert.equal(app.dispatch({ action: 'set-speed', speed: 'fast' }), true);
  assert.ok(harness.state.log.includes('animation.setSpeed=fast'));
  assert.equal(app.dispatch({
    action: 'next-character',
    lessonId: 'lesson-1',
    group: 'write',
    character: '城'
  }), true);
  assert.equal(app.getRoute().character, '城');
  assert.equal(app.dispatch(Object.create({ action: 'go-directory' })), false);
});

test('initial and later visibility state are delivered only to the current animation', () => {
  const harness = createHarness({ hash: characterHash(), hidden: true });
  const app = loadApp().createApp(harness.createOptions);
  const animation = harness.state.animations[0];
  assert.ok(harness.state.log.indexOf('animation.visibility=true')
    < harness.state.log.indexOf('animation.replay'));

  harness.documentObject.hidden = false;
  harness.documentObject.emit('visibilitychange');
  assert.equal(harness.state.log.at(-1), 'animation.visibility=false');

  app.navigate({ view: 'lesson', lessonId: 'lesson-1', group: 'write' });
  harness.documentObject.hidden = true;
  const count = harness.state.log.filter((item) => item === 'animation.visibility=true').length;
  harness.documentObject.emit('visibilitychange');
  assert.equal(harness.state.log.filter((item) => item === 'animation.visibility=true').length, count);
  assert.equal(animation, harness.state.animations[0]);
});

test('storage accepts only canonical character routes and contains corrupt or throwing adapters', () => {
  const corrupt = createStorage({
    [STORAGE_KEY]: '#/lesson?lesson=lesson-1&group=write'
  });
  const corruptHarness = createHarness({ hash: '#/', storage: corrupt });
  assert.doesNotThrow(() => loadApp().createApp(corruptHarness.createOptions));
  assert.equal(currentHandle(corruptHarness).resumeAvailable, false);
  assert.ok(corrupt.calls.some(([operation]) => operation === 'remove'));

  const reentrantRemoval = createStorage();
  const reentrantHarness = createHarness({
    hash: characterHash(),
    storage: reentrantRemoval,
    reducedMotion: true
  });
  const reentrantApp = loadApp().createApp(reentrantHarness.createOptions);
  reentrantRemoval.setItem(STORAGE_KEY, 'corrupt');
  const removeItem = reentrantRemoval.removeItem;
  let resumedDuringRemoval = null;
  reentrantRemoval.removeItem = function (key) {
    resumedDuringRemoval = reentrantApp.dispatch('resume-learning');
    removeItem.call(this, key);
  };

  reentrantApp.navigate({ view: 'directory' });

  assert.equal(resumedDuringRemoval, false);
  assert.deepEqual(reentrantApp.getRoute(), { view: 'directory' });
  assert.equal(currentHandle(reentrantHarness).resumeAvailable, false);

  const throwing = {};
  Object.defineProperty(throwing, 'getItem', {
    get() {
      throw new Error('blocked');
    }
  });
  const throwingHarness = createHarness({ hash: '#/', storage: throwing });
  assert.doesNotThrow(() => loadApp().createApp(throwingHarness.createOptions));
  assert.equal(currentHandle(throwingHarness).resumeAvailable, false);

  const throwingRemove = createStorage({ [STORAGE_KEY]: 'corrupt' });
  Object.defineProperty(throwingRemove, 'removeItem', {
    get() {
      throw new Error('removal blocked');
    }
  });
  const removeHarness = createHarness({ hash: '#/', storage: throwingRemove });
  assert.doesNotThrow(() => loadApp().createApp(removeHarness.createOptions));
  assert.equal(currentHandle(removeHarness).resumeAvailable, false);

  const setFailure = createStorage();
  setFailure.setItem = () => { throw new Error('quota'); };
  const setHarness = createHarness({ hash: characterHash(), storage: setFailure });
  const setApp = loadApp().createApp(setHarness.createOptions);
  setApp.navigate({ view: 'directory' });
  assert.equal(currentHandle(setHarness).resumeAvailable, false);
});

test('audio maps transient and permanent failures and ignores stale promises after navigation', async () => {
  const harness = createHarness({ hash: characterHash(), reducedMotion: true });
  const app = loadApp().createApp(harness.createOptions);
  const firstHandle = currentHandle(harness);
  const pending = deferred();
  harness.state.audioPlay = () => pending.promise;

  harness.click('play-audio');
  assert.equal(firstHandle.audioStates.at(-1), 'loading');
  app.navigate(characterRoute('城'));
  const secondHandle = currentHandle(harness);
  pending.resolve(true);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(secondHandle.audioStates, ['ready']);

  const transient = new Error('gesture required');
  transient.name = 'NotAllowedError';
  harness.state.audioPlay = () => Promise.reject(transient);
  harness.click('play-audio');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(secondHandle.audioStates.at(-1), 'error');

  harness.state.unavailable.add('cheng2');
  harness.state.audioPlay = () => Promise.reject(new Error('decode failed'));
  harness.click('play-audio');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(secondHandle.audioStates.at(-1), 'unavailable');
});

test('false audio outcomes remain retryable unless the reading became unavailable', async () => {
  const harness = createHarness({ hash: characterHash(), reducedMotion: true });
  loadApp().createApp(harness.createOptions);
  const handle = currentHandle(harness);
  harness.state.audioPlay = () => Promise.resolve(false);

  harness.click('play-audio');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(handle.audioStates.at(-1), 'error');

  harness.state.unavailable.add('guo1');
  harness.click('play-audio');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(handle.audioStates.at(-1), 'unavailable');
});

test('a superseded audio request on the same character cannot overwrite the latest result', async () => {
  const harness = createHarness({ hash: characterHash(), reducedMotion: true });
  loadApp().createApp(harness.createOptions);
  const handle = currentHandle(harness);
  const first = deferred();
  const second = deferred();
  const requests = [first, second];
  harness.state.audioPlay = () => requests.shift().promise;

  harness.click('play-audio');
  harness.click('play-audio');
  second.resolve(true);
  await Promise.resolve();
  await Promise.resolve();
  const stateCount = handle.audioStates.length;
  const announcement = harness.announcer.textContent;
  assert.equal(handle.audioStates.at(-1), 'ready');

  first.reject(Object.assign(new Error('late failure'), { name: 'NotAllowedError' }));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(handle.audioStates.length, stateCount);
  assert.equal(handle.audioStates.at(-1), 'ready');
  assert.equal(harness.announcer.textContent, announcement);
});

test('renderer and animation construction failures degrade the board without losing the route', () => {
  const rendererHarness = createHarness({ hash: characterHash(), throwRenderer: true });
  const rendererApp = loadApp().createApp(rendererHarness.createOptions);
  assert.deepEqual(rendererApp.getRoute(), characterRoute());
  assert.equal(currentHandle(rendererHarness).boardErrors, 1);
  assert.equal(rendererApp.debugControllers().renderer, null);
  assert.match(rendererHarness.announcer.textContent, /笔画/);

  const animationHarness = createHarness({ hash: characterHash(), throwAnimation: true });
  const animationApp = loadApp().createApp(animationHarness.createOptions);
  assert.equal(currentHandle(animationHarness).boardErrors, 1);
  assert.equal(animationApp.debugControllers().renderer, null);
  assert.equal(animationApp.debugControllers().animation, null);
  assert.ok(animationHarness.state.log.includes('renderer.destroy'));
});

test('single delegated listener handles nested known actions and ignores disabled, unknown, outside, or incomplete actions', () => {
  const harness = createHarness({ hash: '#/' });
  const app = loadApp().createApp(harness.createOptions);
  assert.equal(harness.root.listenerCount('click'), 1);

  harness.click('open-lesson', {
    'data-lesson-id': 'lesson-1', 'data-group': 'write'
  }, { nested: true });
  assert.equal(app.getRoute().view, 'lesson');

  const renders = { ...harness.state.renderCounts };
  harness.click('open-character', { 'data-lesson-id': 'lesson-1' });
  harness.click('unknown-action');
  harness.click('go-directory', {}, { disabled: true });
  harness.click('go-directory', {}, { outside: true });
  assert.deepEqual(harness.state.renderCounts, renders);

  harness.click('open-character', {
    'data-lesson-id': 'lesson-1', 'data-group': 'write', 'data-character': '郭'
  });
  assert.equal(app.getRoute().view, 'character');
  harness.click('next-character', {
    'data-lesson-id': 'lesson-1', 'data-group': 'write', 'data-character': '城'
  });
  assert.equal(app.getRoute().character, '城');
  harness.click('back-lesson', { 'data-lesson-id': 'lesson-1', 'data-group': 'write' });
  assert.equal(app.getRoute().view, 'lesson');
  harness.click('go-directory');
  assert.equal(app.getRoute().view, 'directory');
});

test('destroy is idempotent, removes all listeners, cleans current controllers, and stops future work', () => {
  const harness = createHarness({ hash: characterHash() });
  const app = loadApp().createApp(harness.createOptions);
  harness.state.log.length = 0;

  app.destroy();
  app.destroy();
  assert.deepEqual(harness.state.log, [
    'animation.destroy', 'renderer.destroy', 'audio.stop', 'audio.destroy'
  ]);
  assert.equal(harness.root.listenerCount('click'), 0);
  assert.equal(harness.windowObject.listenerCount('hashchange'), 0);
  assert.equal(harness.documentObject.listenerCount('visibilitychange'), 0);

  const renders = { ...harness.state.renderCounts };
  harness.location.setRaw('#/');
  harness.windowObject.emit('hashchange');
  harness.root.emit('click', { target: new FakeElement('outside') });
  assert.deepEqual(harness.state.renderCounts, renders);
  assert.equal(app.navigate({ view: 'directory' }), false);
});

test('bootstrap uses window globals, contains optional browser API getter failures, and reuses one instance', () => {
  const harness = createHarness({ hash: '#/' });
  const appModule = loadApp();
  const documentObject = harness.documentObject;
  documentObject.getElementById = (id) => (id === 'app' ? harness.root : harness.announcer);
  harness.windowObject.document = documentObject;
  harness.windowObject.HANZI_LIBRARY = harness.library;
  harness.windowObject.HanziApp = Object.assign({}, harness.api, appModule);
  Object.defineProperty(harness.windowObject, 'localStorage', {
    get() { throw new Error('privacy mode'); }
  });
  Object.defineProperty(harness.windowObject, 'Audio', {
    get() { throw new Error('audio blocked'); }
  });
  Object.defineProperty(harness.windowObject, 'matchMedia', {
    get() { throw new Error('unsupported'); }
  });

  const first = appModule.bootstrapApp(harness.windowObject);
  const second = appModule.bootstrapApp(harness.windowObject);

  assert.equal(first, second);
  assert.deepEqual(first.getRoute(), { view: 'directory' });
  assert.equal(harness.root.listenerCount('click'), 1);
});

test('classic script merges without DOM access and index boots in offline dependency order', async () => {
  const [source, html] = await Promise.all([
    readFile(new URL('../js/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8')
  ]);
  const prior = function prior() {};
  const windowObject = { HanziApp: { prior } };
  Object.defineProperty(windowObject, 'document', {
    get() { throw new Error('must not read DOM at module load'); }
  });

  vm.runInNewContext(source, { window: windowObject }, { filename: 'js/app.js' });
  assert.equal(windowObject.HanziApp.prior, prior);
  assert.equal(typeof windowObject.HanziApp.createApp, 'function');
  assert.equal(typeof windowObject.HanziApp.bootstrapApp, 'function');

  const scripts = Array.from(
    html.matchAll(/<script defer src="([^"]+)"><\/script>/g),
    (match) => match[1]
  );
  assert.deepEqual(scripts.slice(-2), ['js/views.js', 'js/app.js']);
  assert.match(html, /href="#app"/);
  assert.match(html, /DOMContentLoaded/);
  assert.match(html, /HanziApp\.bootstrapApp/);
  assert.doesNotMatch(html, /<script[^>]+type="module"|https?:\/\/|\bfetch\s*\(/);
  scripts.forEach((path) => assert.doesNotMatch(path, /^(?:\/|[a-z]+:)/i));
});
