import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

import routerModule from '../js/router.js';
import practiceProgressModule from '../js/practice-progress-store.js';
import practiceSessionModule from '../js/practice-session.js';

const require = createRequire(import.meta.url);
const STORAGE_KEY = 'hanzi-tracking:last-route:v1';

function loadApp() {
  return require('../js/app.js');
}

function loadViews() {
  return require('../js/views.js');
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
  const announcements = [];
  let announcedText = '';
  const announcer = {
    get textContent() { return announcedText; },
    set textContent(value) {
      announcedText = String(value);
      announcements.push(announcedText);
    }
  };
  const windowObject = new FakeEventTarget();
  const documentObject = new FakeEventTarget();
  documentObject.hidden = options.hidden === true;
  const location = createLocation(options.hash ?? '#/', log);
  windowObject.location = location;
  const storage = options.storage === undefined ? createStorage() : options.storage;

  const entries = {
    write: Object.freeze([
      Object.freeze({ character: '郭', pinyin: 'guō', audio: 'guo1', words: Object.freeze(['城郭', '郭外']) }),
      Object.freeze({ character: '城', pinyin: 'chéng', audio: 'cheng2', words: Object.freeze(['城市', '城墙']) })
    ]),
    recognize: Object.freeze([
      Object.freeze({ character: '识', pinyin: 'shí', audio: 'shi2', words: Object.freeze(['认识', '识字']) }),
      Object.freeze({ character: '字', pinyin: 'zì', audio: 'zi4', words: Object.freeze(['汉字', '写字']) })
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
    announcements,
    store,
    views: [],
    renderCounts: { directory: 0, lesson: 0, character: 0, practice: 0 },
    renderHandles: [],
    renderers: [],
    animations: [],
    audioPlays: [],
    lessonModelCalls: [],
    characterModelCalls: [],
    practiceModelCalls: [],
    practiceSessions: [],
    practiceEngines: [],
    practiceProgress: null,
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
    createLessonModel: (_store, selector, practice) => {
      state.lessonModelCalls.push({ selector, practice });
      if (options.realViewModels) return loadViews().createLessonModel(_store, selector, practice);
      return Object.freeze({ ...selector, lesson, unit, practice });
    },
    createCharacterModel(resolved, practice) {
      state.characterModelCalls.push({ resolved, practice });
      if (options.realViewModels) return loadViews().createCharacterModel(resolved, practice);
      return Object.freeze({
        unit: resolved.unit,
        lesson: resolved.lesson,
        group: resolved.group,
        character: resolved.entry.character,
        pinyin: resolved.entry.pinyin,
        audioId: resolved.entry.audio,
        words: resolved.entry.words,
        strokeCount: resolved.geometry.strokeCount,
        index: resolved.index,
        total: resolved.total,
        previous: resolved.previous,
        next: resolved.next,
        previousDisabled: resolved.previous === null,
        nextDisabled: resolved.next === null,
        isReview: false,
        practice
      });
    },
    createPracticeProgressStore(candidateStorage) {
      const progress = practiceProgressModule.createPracticeProgressStore(candidateStorage);
      state.practiceProgress = progress;
      return progress;
    },
    createPracticeSession(sessionOptions) {
      const session = practiceSessionModule.createPracticeSession(sessionOptions);
      state.practiceSessions.push({ options: sessionOptions, session });
      return session;
    },
    createPracticeModel(resolved, sessionState, persistent) {
      if (options.realViewModels) {
        const model = loadViews().createPracticeModel(resolved, sessionState, persistent);
        state.practiceModelCalls.push(model);
        return model;
      }
      const model = Object.freeze({
        resolved, state: sessionState, persistent, strokeCount: resolved.geometry.strokeCount
      });
      state.practiceModelCalls.push(model);
      return model;
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
    renderPractice(_root, model) {
      const status = model.state ? model.state.status : model.status;
      let unavailableCalls = 0;
      const handle = {
        heading: heading('practice'),
        board: status === 'active' ? new FakeElement('practice-board') : null,
        model,
        feedback: [],
        strokePositions: [],
        get unavailableCalls() {
          return unavailableCalls;
        },
        setFeedback(message, kind) {
          this.feedback.push([message, kind]);
          log.push('practice.feedback=' + kind + ':' + message);
        },
        setStrokePosition(current, total) {
          this.strokePositions.push([current, total]);
          log.push('practice.stroke=' + current + '/' + total);
        },
        setUnavailable() {
          unavailableCalls += 1;
          this.setFeedback('这个字暂时无法练习', 'error');
          log.push('practice.unavailable');
        }
      };
      return installView('practice', handle);
    },
    createPracticeEngine(engineOptions) {
      log.push('practice-engine.create');
      if (state.onPracticeEngineCreate) state.onPracticeEngineCreate(engineOptions);
      if (engineOptions.HanziWriter === null) throw new Error('Hanzi Writer unavailable');
      if (options.throwPracticeEngineCreate) throw new Error('practice engine create failed');
      const engine = {
        options: engineOptions,
        starts: [],
        restartCalls: 0,
        hintCalls: 0,
        resizeCalls: 0,
        destroyed: false,
        start(value) {
          this.starts.push(value);
          log.push('practice-engine.start=' + value.phase + ':' + value.strokeIndex);
          if (state.onPracticeEngineStart) state.onPracticeEngineStart(this);
          if (options.throwPracticeEngineStart) throw new Error('practice engine start failed');
        },
        restart() {
          this.restartCalls += 1;
          log.push('practice-engine.restart');
          if (state.onPracticeEngineRestart) state.onPracticeEngineRestart(this);
        },
        showHint() {
          this.hintCalls += 1;
          log.push('practice-engine.hint');
          if (state.onPracticeEngineHint) state.onPracticeEngineHint(this);
        },
        resize() {
          this.resizeCalls += 1;
          log.push('practice-engine.resize');
          if (state.onPracticeEngineResize) state.onPracticeEngineResize(this);
          if (options.throwPracticeEngineResize) throw new Error('resize failed');
        },
        emit(event) {
          engineOptions.onEvent(event);
        },
        destroy() {
          this.destroyed = true;
          log.push('practice-engine.destroy');
        }
      };
      state.practiceEngines.push(engine);
      return engine;
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
    HanziWriter: Object.hasOwn(options, 'HanziWriter')
      ? options.HanziWriter
      : Object.freeze({ create() {} }),
    createAudio,
    reducedMotion: options.reducedMotion === true
  };
  windowObject.HanziWriter = createOptions.HanziWriter;
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

function practiceRoute(character = '郭', group = 'write', scope = 'group') {
  return { view: 'practice', lessonId: 'lesson-1', group, scope, character };
}

function practiceHash(character = '郭', group = 'write', scope = 'group') {
  return routerModule.serializeHash(practiceRoute(character, group, scope));
}

test('exports the complete frozen application integration API', () => {
  const app = loadApp();

  assert.deepEqual(Object.keys(app).sort(), ['bootstrapApp', 'createApp']);
  assert.ok(Object.isFrozen(app));
});

test('starts group practice from both lesson groups and replaces hashes between characters', () => {
  for (const [group, first, second] of [
    ['write', '郭', '城'],
    ['recognize', '识', '字']
  ]) {
    const harness = createHarness({ hash: '#/' });
    const app = loadApp().createApp(harness.createOptions);
    harness.click('open-lesson', {
      'data-lesson-id': 'lesson-1', 'data-group': group
    });
    harness.click('start-group-practice', {
      'data-lesson-id': 'lesson-1', 'data-group': group
    });

    assert.deepEqual(app.getRoute(), practiceRoute(first, group, 'group'));
    assert.equal(harness.state.views.at(-1), 'practice');
    assert.equal(harness.state.practiceSessions.at(-1).options.scope, 'group');
    assert.equal(harness.location.hash, practiceHash(first, group, 'group'));
    assert.ok(harness.state.log.includes('location.hash=' + practiceHash(first, group, 'group')));

    let engine = harness.state.practiceEngines.at(-1);
    engine.emit({ type: 'character-complete', totalMistakes: 0 });
    engine = harness.state.practiceEngines.at(-1);
    engine.emit({ type: 'character-complete', totalMistakes: 0 });

    assert.equal(app.getRoute().character, second);
    assert.equal(harness.location.hash, practiceHash(second, group, 'group'));
    assert.ok(harness.state.log.includes('location.replace=' + practiceHash(second, group, 'group')));
  }
});

test('resumed group practice pushes its canonical current character after the lesson entry', () => {
  const savedProgress = JSON.stringify({
    schemaVersion: 2,
    characters: {
      郭: { attemptCount: 1, lastOutcome: 'mastered', mastered: true }
    },
    groups: {
      'lesson-1:write': {
        completedCharacters: ['郭'],
        roundCharacters: ['郭', '城'],
        roundCompletedCharacters: ['郭'],
        remainingCharacters: ['城'],
        needsPracticeCharacters: [],
        roundInitialMasteredCharacters: ['郭'],
        currentCharacter: '城',
        currentPhase: 'guided'
      }
    }
  });
  const storage = createStorage({
    [practiceProgressModule.PRACTICE_STORAGE_KEY]: savedProgress
  });
  const lessonHash = '#/lesson?lesson=lesson-1&group=write';
  const harness = createHarness({ hash: lessonHash, storage });
  const app = loadApp().createApp(harness.createOptions);
  harness.state.log.length = 0;

  harness.click('start-group-practice', {
    'data-lesson-id': 'lesson-1', 'data-group': 'write'
  });

  assert.deepEqual(app.getRoute(), practiceRoute('城', 'write', 'group'));
  assert.equal(harness.location.hash, practiceHash('城', 'write', 'group'));
  assert.ok(harness.state.log.includes('location.hash=' + practiceHash('城', 'write', 'group')));
  assert.equal(
    harness.state.log.includes('location.replace=' + practiceHash('城', 'write', 'group')),
    false
  );
});

test('group start resumes incomplete filtered rounds but starts completed rounds fresh', () => {
  const incompleteStorage = createStorage({
    [practiceProgressModule.PRACTICE_STORAGE_KEY]: JSON.stringify({
      schemaVersion: 2,
      characters: {
        '郭': { attemptCount: 1, lastOutcome: 'mastered', mastered: true }
      },
      groups: {
        'lesson-1:write': {
          completedCharacters: ['郭'],
          roundCharacters: ['城'],
          roundCompletedCharacters: [],
          remainingCharacters: ['城'],
          needsPracticeCharacters: [],
          roundInitialMasteredCharacters: [],
          currentCharacter: '城',
          currentPhase: 'guided'
        }
      }
    })
  });
  const incomplete = createHarness({
    hash: '#/lesson?lesson=lesson-1&group=write', storage: incompleteStorage
  });
  const incompleteApp = loadApp().createApp(incomplete.createOptions);
  incomplete.click('start-group-practice', {
    'data-lesson-id': 'lesson-1', 'data-group': 'write'
  });
  assert.equal(incomplete.state.practiceSessions.at(-1).options.resume, true);
  assert.deepEqual(incompleteApp.debugControllers().practiceSession.getState(), {
    status: 'active', phase: 'guided', character: '城', index: 0, total: 1,
    mistakes: 0, newlyMasteredCount: 0,
    completedCharacters: [], remainingCharacters: ['城'], needsPracticeCharacters: []
  });
  assert.equal(incomplete.state.practiceModelCalls.at(-1).state.masteredCount, 0);

  const completeState = JSON.stringify({
    schemaVersion: 2,
    characters: {
      '郭': { attemptCount: 1, lastOutcome: 'mastered', mastered: true },
      '城': { attemptCount: 1, lastOutcome: 'mastered', mastered: true }
    },
    groups: {
      'lesson-1:write': {
        completedCharacters: ['郭', '城'],
        roundCharacters: ['郭', '城'],
        roundCompletedCharacters: ['郭', '城'],
        remainingCharacters: [],
        needsPracticeCharacters: [],
        roundInitialMasteredCharacters: [],
        currentCharacter: null,
        currentPhase: null
      }
    }
  });
  const fresh = createHarness({
    hash: '#/lesson?lesson=lesson-1&group=write',
    storage: createStorage({ [practiceProgressModule.PRACTICE_STORAGE_KEY]: completeState })
  });
  const freshApp = loadApp().createApp(fresh.createOptions);
  fresh.click('start-group-practice', {
    'data-lesson-id': 'lesson-1', 'data-group': 'write'
  });
  assert.equal(fresh.state.practiceSessions.at(-1).options.resume, false);
  assert.equal(freshApp.debugControllers().practiceSession.getState().status, 'active');
  assert.deepEqual(freshApp.debugControllers().practiceSession.getState().remainingCharacters, ['郭', '城']);
  assert.deepEqual(fresh.state.practiceProgress.getGroup('lesson-1', 'write').completedCharacters, ['郭', '城']);

  const direct = createHarness({
    hash: practiceHash(),
    storage: createStorage({ [practiceProgressModule.PRACTICE_STORAGE_KEY]: completeState })
  });
  const directApp = loadApp().createApp(direct.createOptions);
  assert.equal(direct.state.practiceSessions.at(-1).options.resume, true);
  assert.equal(directApp.debugControllers().practiceSession.getState().status, 'complete');

  const filteredCompleteState = JSON.stringify({
    schemaVersion: 2,
    characters: {
      '郭': { attemptCount: 1, lastOutcome: 'mastered', mastered: true },
      '城': { attemptCount: 1, lastOutcome: 'mastered', mastered: true }
    },
    groups: {
      'lesson-1:write': {
        completedCharacters: ['郭', '城'],
        roundCharacters: ['城'],
        roundCompletedCharacters: ['城'],
        remainingCharacters: [],
        needsPracticeCharacters: [],
        roundInitialMasteredCharacters: [],
        currentCharacter: null,
        currentPhase: null
      }
    }
  });
  const filteredDirect = createHarness({
    hash: practiceHash('郭'),
    realViewModels: true,
    storage: createStorage({
      [practiceProgressModule.PRACTICE_STORAGE_KEY]: filteredCompleteState
    })
  });
  const filteredDirectApp = loadApp().createApp(filteredDirect.createOptions);
  assert.equal(filteredDirectApp.debugControllers().practiceSession.getState().status, 'complete');
  assert.equal(filteredDirect.state.practiceModelCalls.at(-1).character, '城');
});

test('missing Hanzi Writer boots learning views and degrades only practice', () => {
  const harness = createHarness({ HanziWriter: null });
  let app;

  assert.doesNotThrow(() => { app = loadApp().createApp(harness.createOptions); });
  assert.equal(app.getRoute().view, 'directory');
  assert.equal(app.navigate(characterRoute()), true);
  assert.equal(app.getRoute().view, 'character');
  assert.equal(app.navigate(practiceRoute()), true);
  assert.equal(app.getRoute().view, 'practice');
  assert.equal(currentHandle(harness).unavailableCalls, 1);
  assert.deepEqual(currentHandle(harness).feedback.at(-1), ['这个字暂时无法练习', 'error']);
  assert.equal(app.debugControllers().practiceEngine, null);
  assert.equal(app.dispatch('practice-back'), true);
  assert.equal(app.getRoute().view, 'lesson');
});

test('group unavailable skip advances and completes without attempts or cumulative completion', () => {
  const harness = createHarness({ hash: practiceHash(), HanziWriter: null });
  const app = loadApp().createApp(harness.createOptions);

  assert.equal(currentHandle(harness).unavailableCalls, 1);
  assert.equal(app.dispatch('practice-skip-unavailable'), true);
  assert.equal(app.debugControllers().practiceSession.getState().character, '城');
  assert.deepEqual(app.debugControllers().practiceSession.getState().needsPracticeCharacters, ['郭']);
  assert.deepEqual(harness.state.practiceProgress.getCharacter('郭'), {
    attemptCount: 0, lastOutcome: null, mastered: false
  });

  assert.equal(app.dispatch('practice-skip-unavailable'), true);
  const result = app.debugControllers().practiceSession.getState();
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.needsPracticeCharacters, ['郭', '城']);
  assert.deepEqual(
    harness.state.practiceProgress.getGroup('lesson-1', 'write').completedCharacters,
    []
  );

  const single = createHarness({
    hash: practiceHash('字', 'recognize', 'single'), HanziWriter: null
  });
  const singleApp = loadApp().createApp(single.createOptions);
  assert.equal(singleApp.dispatch('practice-skip-unavailable'), false);
});

test('quiz events drive guided, independent, retry and exactly-once progress updates', () => {
  const harness = createHarness({ hash: practiceHash() });
  loadApp().createApp(harness.createOptions);
  const firstEngine = harness.state.practiceEngines.at(-1);

  firstEngine.emit({ type: 'stroke-correct', strokeNum: 0, strokesRemaining: 2 });
  firstEngine.emit({ type: 'stroke-mistake', strokeNum: 1, totalMistakes: 1, isBackwards: true });
  assert.deepEqual(currentHandle(harness).strokePositions.at(-1), [2, 3]);
  assert.deepEqual(currentHandle(harness).feedback.at(-1), ['方向反了，再试一次', 'error']);
  assert.equal(harness.state.practiceSessions.at(-1).session.getState().mistakes, 1);

  firstEngine.emit({ type: 'character-complete', totalMistakes: 1 });
  assert.equal(firstEngine.destroyed, true);
  assert.equal(harness.state.practiceSessions.at(-1).session.getState().phase, 'independent');
  const independentEngine = harness.state.practiceEngines.at(-1);
  independentEngine.emit({ type: 'stroke-mistake', strokeNum: 0, totalMistakes: 1, isBackwards: false });
  independentEngine.emit({ type: 'character-complete', totalMistakes: 1 });

  assert.equal(harness.state.practiceSessions.at(-1).session.getState().status, 'needs-retry');
  assert.equal(harness.state.views.at(-1), 'practice');
  assert.equal(harness.state.practiceProgress.getCharacter('郭').attemptCount, 1);
  assert.equal(harness.state.practiceProgress.getCharacter('郭').lastOutcome, 'needs-practice');
  assert.equal(independentEngine.destroyed, true);

  harness.click('practice-retry');
  const retryEngine = harness.state.practiceEngines.at(-1);
  assert.deepEqual(retryEngine.starts, [{ phase: 'independent', strokeIndex: 0 }]);
  retryEngine.emit({ type: 'character-complete', totalMistakes: 0 });
  assert.equal(harness.state.practiceProgress.getCharacter('郭').attemptCount, 2);
  assert.equal(harness.state.practiceProgress.getCharacter('郭').lastOutcome, 'mastered');
});

test('practice hint, restart and return actions target only the current practice resources', () => {
  const harness = createHarness({ hash: practiceHash() });
  const app = loadApp().createApp(harness.createOptions);
  const engine = harness.state.practiceEngines.at(-1);
  engine.emit({ type: 'stroke-mistake', strokeNum: 0, totalMistakes: 1, isBackwards: false });

  harness.click('practice-hint');
  assert.equal(engine.hintCalls, 1);
  assert.deepEqual(currentHandle(harness).feedback.at(-1), ['请看当前笔的提示', 'hint']);
  harness.click('practice-restart');
  assert.equal(engine.restartCalls, 1);
  assert.equal(harness.state.practiceSessions.at(-1).session.getState().mistakes, 0);
  assert.deepEqual(currentHandle(harness).feedback.at(-1), ['已经重新开始', 'neutral']);

  harness.click('practice-return-lesson');
  assert.deepEqual(app.getRoute(), { view: 'lesson', lessonId: 'lesson-1', group: 'write' });
  assert.equal(engine.destroyed, true);
  assert.equal(app.dispatch('practice-hint'), false);
});

test('reentrant practice commands never write feedback into a replacement view', () => {
  const harness = createHarness({ hash: practiceHash() });
  const app = loadApp().createApp(harness.createOptions);
  const firstHandle = currentHandle(harness);
  const firstEngine = harness.state.practiceEngines.at(-1);
  harness.state.onPracticeEngineHint = (engine) => {
    harness.state.onPracticeEngineHint = null;
    engine.emit({ type: 'character-complete', totalMistakes: 0 });
  };

  assert.equal(app.dispatch('practice-hint'), false);
  assert.equal(firstEngine.destroyed, true);
  assert.notEqual(currentHandle(harness), firstHandle);
  assert.equal(currentHandle(harness).feedback.length, 0);
});

test('window resize updates only the current practice engine without restarting its session', () => {
  const harness = createHarness({ hash: practiceHash() });
  const app = loadApp().createApp(harness.createOptions);
  const engine = harness.state.practiceEngines.at(-1);
  const session = harness.state.practiceSessions.at(-1).session;
  const engineCount = harness.state.practiceEngines.length;
  const renderCount = harness.state.renderCounts.practice;

  assert.equal(harness.windowObject.listenerCount('resize'), 1);
  harness.windowObject.emit('resize');
  assert.equal(engine.resizeCalls, 1);
  assert.equal(harness.state.practiceEngines.length, engineCount);
  assert.equal(harness.state.renderCounts.practice, renderCount);
  assert.equal(app.debugControllers().practiceSession, session);

  app.destroy();
  assert.equal(harness.windowObject.listenerCount('resize'), 0);
  harness.windowObject.emit('resize');
  assert.equal(engine.resizeCalls, 1);
});

test('resize failures announce safely and reentrant resize cannot affect a replacement view', () => {
  const failing = createHarness({ hash: practiceHash(), throwPracticeEngineResize: true });
  loadApp().createApp(failing.createOptions);
  failing.windowObject.emit('resize');
  assert.equal(failing.announcer.textContent, '练习画板尺寸暂时无法更新');
  assert.deepEqual(currentHandle(failing).feedback.at(-1), [
    '练习画板尺寸暂时无法更新', 'error'
  ]);

  const reentrant = createHarness({ hash: practiceHash() });
  const app = loadApp().createApp(reentrant.createOptions);
  const engine = reentrant.state.practiceEngines.at(-1);
  reentrant.state.onPracticeEngineResize = () => {
    reentrant.state.onPracticeEngineResize = null;
    app.navigate({ view: 'lesson', lessonId: 'lesson-1', group: 'write' });
  };
  const announcements = reentrant.state.announcements.length;
  reentrant.windowObject.emit('resize');
  assert.equal(app.getRoute().view, 'lesson');
  assert.equal(engine.destroyed, true);
  assert.equal(reentrant.state.announcements.length, announcements);
  assert.equal(reentrant.state.practiceEngines.length, 1);
});

test('practice engine constructor failure keeps a direct group practice route recoverable', () => {
  const config = { hash: practiceHash(), throwPracticeEngineCreate: true };
  const harness = createHarness(config);
  let app;

  assert.doesNotThrow(() => { app = loadApp().createApp(harness.createOptions); });
  assert.deepEqual(app.getRoute(), practiceRoute());
  assert.deepEqual(currentHandle(harness).feedback.at(-1), ['这个字暂时无法练习', 'error']);
  assert.equal(harness.announcer.textContent, '这个字暂时无法练习');
  assert.equal(app.debugControllers().practiceEngine, null);
  assert.ok(app.debugControllers().practiceSession);
  assert.equal(harness.root.listenerCount('click'), 1);
  assert.equal(harness.windowObject.listenerCount('resize'), 1);

  const unavailableHandle = currentHandle(harness);
  const renderCount = harness.state.renderCounts.practice;
  config.throwPracticeEngineCreate = false;
  assert.equal(app.dispatch('practice-restart'), true);
  assert.equal(harness.state.renderCounts.practice, renderCount + 1);
  assert.notEqual(currentHandle(harness), unavailableHandle);
  assert.equal(harness.state.practiceEngines.length, 1);
  assert.equal(app.debugControllers().practiceEngine, harness.state.practiceEngines[0]);
  assert.deepEqual(currentHandle(harness).feedback.at(-1), ['已经重新开始', 'neutral']);

  harness.click('practice-back');
  assert.deepEqual(app.getRoute(), { view: 'lesson', lessonId: 'lesson-1', group: 'write' });
});

test('practice engine start failure destroys its candidate and can retry without resetting session', () => {
  const config = {
    hash: practiceHash('字', 'recognize', 'single'),
    throwPracticeEngineStart: true
  };
  const harness = createHarness(config);
  let app;

  assert.doesNotThrow(() => { app = loadApp().createApp(harness.createOptions); });
  const failedEngine = harness.state.practiceEngines[0];
  const session = app.debugControllers().practiceSession;
  assert.equal(failedEngine.destroyed, true);
  assert.equal(app.debugControllers().practiceEngine, null);
  assert.deepEqual(currentHandle(harness).feedback.at(-1), ['这个字暂时无法练习', 'error']);
  assert.equal(harness.announcer.textContent, '这个字暂时无法练习');

  config.throwPracticeEngineStart = false;
  assert.equal(app.dispatch('practice-restart'), true);
  const recoveredEngine = harness.state.practiceEngines.at(-1);
  assert.notEqual(recoveredEngine, failedEngine);
  assert.deepEqual(recoveredEngine.starts, [{ phase: 'guided', strokeIndex: 0 }]);
  assert.equal(app.debugControllers().practiceSession, session);
  assert.deepEqual(session.getState(), {
    status: 'active', phase: 'guided', character: '字', index: 0, total: 1, mistakes: 0,
    newlyMasteredCount: 0,
    completedCharacters: [], remainingCharacters: ['字'], needsPracticeCharacters: []
  });

  harness.click('practice-back');
  assert.deepEqual(app.getRoute(), characterRoute('字', 'recognize'));
});

test('reentrant practice engine start failure cannot degrade a replacement view', () => {
  const config = { hash: practiceHash(), throwPracticeEngineCreate: true };
  const harness = createHarness(config);
  const app = loadApp().createApp(harness.createOptions);
  const announcements = harness.state.announcements.length;

  config.throwPracticeEngineCreate = false;
  config.throwPracticeEngineStart = true;
  harness.state.onPracticeEngineStart = () => {
    harness.state.onPracticeEngineStart = null;
    app.navigate({ view: 'lesson', lessonId: 'lesson-1', group: 'write' });
  };

  assert.equal(app.dispatch('practice-restart'), false);
  assert.deepEqual(app.getRoute(), { view: 'lesson', lessonId: 'lesson-1', group: 'write' });
  assert.equal(harness.state.practiceEngines.at(-1).destroyed, true);
  assert.equal(app.debugControllers().practiceEngine, null);
  assert.equal(harness.state.announcements.length, announcements);
});

test('practice preserves the last learning route and returns to remembered or direct-url origins', () => {
  const harness = createHarness({ hash: characterHash('字', 'recognize') });
  const app = loadApp().createApp(harness.createOptions);
  const savedLearningRoute = harness.storage.value(STORAGE_KEY);
  harness.click('start-character-practice', {
    'data-lesson-id': 'lesson-1', 'data-group': 'recognize', 'data-character': '字'
  });
  assert.deepEqual(app.getRoute(), practiceRoute('字', 'recognize', 'single'));
  assert.equal(harness.storage.value(STORAGE_KEY), savedLearningRoute);
  harness.click('practice-back');
  assert.deepEqual(app.getRoute(), characterRoute('字', 'recognize'));

  const directSingle = createHarness({ hash: practiceHash('城', 'write', 'single') });
  const singleApp = loadApp().createApp(directSingle.createOptions);
  directSingle.click('practice-back');
  assert.deepEqual(singleApp.getRoute(), characterRoute('城', 'write'));

  const directGroup = createHarness({ hash: practiceHash('城', 'write', 'group') });
  const groupApp = loadApp().createApp(directGroup.createOptions);
  directGroup.click('practice-back');
  assert.deepEqual(groupApp.getRoute(), { view: 'lesson', lessonId: 'lesson-1', group: 'write' });
});

test('injects current practice snapshots into lesson and character models', () => {
  const harness = createHarness({
    hash: '#/lesson?lesson=lesson-1&group=write', realViewModels: true
  });
  const app = loadApp().createApp(harness.createOptions);
  harness.state.practiceProgress.recordCharacterOutcome('郭', 'mastered');
  harness.state.practiceProgress.markGroupCharacterCompleted('lesson-1', 'write', '城');
  app.navigate({ view: 'directory' });
  app.navigate({ view: 'lesson', lessonId: 'lesson-1', group: 'write' });

  const lessonModel = currentHandle(harness).model;
  assert.equal(lessonModel.entries[0].mastered, true);
  assert.equal(lessonModel.entries[1].completedHere, true);

  app.navigate(characterRoute('城', 'write'));
  const characterModel = currentHandle(harness).model;
  assert.equal(characterModel.mastered, false);
  assert.equal(characterModel.completedHere, true);
});

test('real practice models accept every app-generated active, retry and complete snapshot', () => {
  const harness = createHarness({ hash: practiceHash(), realViewModels: true });
  loadApp().createApp(harness.createOptions);
  assert.equal(currentHandle(harness).model.status, 'active');
  harness.state.practiceEngines.at(-1).emit({ type: 'character-complete', totalMistakes: 0 });
  harness.state.practiceEngines.at(-1).emit({ type: 'character-complete', totalMistakes: 1 });
  assert.equal(currentHandle(harness).model.status, 'needs-retry');
  harness.click('practice-defer');
  harness.state.practiceEngines.at(-1).emit({ type: 'character-complete', totalMistakes: 0 });
  harness.state.practiceEngines.at(-1).emit({ type: 'character-complete', totalMistakes: 0 });
  assert.equal(currentHandle(harness).model.status, 'complete');
});

test('defers failed group characters and reviews only the resulting needs list without resume', () => {
  const harness = createHarness({ hash: practiceHash() });
  loadApp().createApp(harness.createOptions);
  harness.state.practiceEngines.at(-1).emit({ type: 'character-complete', totalMistakes: 0 });
  harness.state.practiceEngines.at(-1).emit({ type: 'character-complete', totalMistakes: 2 });
  harness.click('practice-defer');
  harness.state.practiceEngines.at(-1).emit({ type: 'character-complete', totalMistakes: 0 });
  harness.state.practiceEngines.at(-1).emit({ type: 'character-complete', totalMistakes: 0 });
  assert.equal(harness.state.practiceSessions.at(-1).session.getState().status, 'complete');
  assert.deepEqual(harness.state.practiceSessions.at(-1).session.getState().needsPracticeCharacters, ['郭']);

  harness.click('practice-review-needs');
  const review = harness.state.practiceSessions.at(-1);
  assert.equal(review.options.resume, false);
  assert.deepEqual(review.options.entries.map((entry) => entry.character), ['郭']);
  assert.equal(review.options.startCharacter, '郭');
});

test('practice cleanup rejects stale engine events and storage degradation is announced once', () => {
  const storage = createStorage();
  const originalSetItem = storage.setItem;
  storage.setItem = function (key, value) {
    if (key === practiceProgressModule.PRACTICE_STORAGE_KEY) throw new Error('quota');
    return originalSetItem.call(this, key, value);
  };
  const harness = createHarness({ hash: practiceHash(), storage });
  const app = loadApp().createApp(harness.createOptions);
  const sessionRecord = harness.state.practiceSessions.at(-1);
  const staleEngine = harness.state.practiceEngines.at(-1);
  staleEngine.emit({ type: 'character-complete', totalMistakes: 0 });
  assert.equal(harness.state.practiceProgress.isPersistent(), false);
  assert.equal(harness.state.announcements.filter((message) => message === '本次进度不会保存').length, 1);

  app.navigate({ view: 'lesson', lessonId: 'lesson-1', group: 'write' });
  assert.equal(staleEngine.destroyed, true);
  assert.throws(() => sessionRecord.session.getState(), /destroyed/);
  const renderCount = harness.state.renderCounts.practice;
  staleEngine.emit({ type: 'character-complete', totalMistakes: 0 });
  assert.equal(harness.state.renderCounts.practice, renderCount);

  app.navigate(practiceRoute());
  harness.state.practiceEngines.at(-1).emit({ type: 'character-complete', totalMistakes: 0 });
  assert.equal(harness.state.announcements.filter((message) => message === '本次进度不会保存').length, 1);
  app.destroy();
  assert.equal(harness.state.practiceEngines.at(-1).destroyed, true);
});

test('a progress write that navigates reentrantly cannot leak the superseded practice session', () => {
  const storage = createStorage();
  const harness = createHarness({ hash: practiceHash(), storage });
  const app = loadApp().createApp(harness.createOptions);
  const session = harness.state.practiceSessions.at(-1).session;
  const engine = harness.state.practiceEngines.at(-1);
  const originalSetItem = storage.setItem;
  let redirected = false;
  storage.setItem = function (key, value) {
    const result = originalSetItem.call(this, key, value);
    if (!redirected && key === practiceProgressModule.PRACTICE_STORAGE_KEY) {
      redirected = true;
      app.navigate({ view: 'lesson', lessonId: 'lesson-1', group: 'write' });
    }
    return result;
  };

  engine.emit({ type: 'character-complete', totalMistakes: 0 });

  assert.equal(app.getRoute().view, 'lesson');
  assert.equal(engine.destroyed, true);
  assert.throws(() => session.getState(), /destroyed/);
  assert.equal(harness.state.renderCounts.practice, 1);
});

test('retry and defer clean sessions superseded by reentrant progress writes', async (context) => {
  for (const action of ['practice-retry', 'practice-defer']) {
    await context.test(action, () => {
      const storage = createStorage();
      const harness = createHarness({ hash: practiceHash(), storage });
      const app = loadApp().createApp(harness.createOptions);
      harness.state.practiceEngines.at(-1).emit({ type: 'character-complete', totalMistakes: 0 });
      harness.state.practiceEngines.at(-1).emit({ type: 'character-complete', totalMistakes: 1 });
      const session = harness.state.practiceSessions.at(-1).session;
      const originalSetItem = storage.setItem;
      let redirected = false;
      storage.setItem = function (key, value) {
        const result = originalSetItem.call(this, key, value);
        if (!redirected && key === practiceProgressModule.PRACTICE_STORAGE_KEY) {
          redirected = true;
          app.navigate({ view: 'lesson', lessonId: 'lesson-1', group: 'write' });
        }
        return result;
      };

      harness.click(action);

      assert.equal(app.getRoute().view, 'lesson');
      assert.throws(() => session.getState(), /destroyed/);
    });
  }
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

test('a superseded character save restores the resume intent loaded from storage', () => {
  const storage = createStorage({ [STORAGE_KEY]: characterHash('城') });
  const harness = createHarness({ hash: '#/', storage, reducedMotion: true });
  const app = loadApp().createApp(harness.createOptions);
  const setItem = storage.setItem;
  let nested = false;
  storage.setItem = function (key, value) {
    if (!nested && value === characterHash()) {
      nested = true;
      app.navigate({ view: 'lesson', lessonId: 'lesson-1', group: 'write' });
    }
    setItem.call(this, key, value);
  };

  const changed = app.navigate(characterRoute());

  assert.equal(changed, false);
  assert.deepEqual(app.getRoute(), {
    view: 'lesson', lessonId: 'lesson-1', group: 'write'
  });
  assert.equal(
    harness.location.hash,
    '#/lesson?lesson=lesson-1&group=write'
  );
  assert.equal(storage.value(STORAGE_KEY), characterHash('城'));
});

test('reentrant character saves use one bounded non-recursive storage flush', () => {
  const storage = createStorage();
  const harness = createHarness({ hash: '#/', storage, reducedMotion: true });
  const app = loadApp().createApp(harness.createOptions);
  const setItem = storage.setItem;
  let writeCount = 0;
  let writeDepth = 0;
  let maximumWriteDepth = 0;
  storage.setItem = function (key, value) {
    writeCount += 1;
    writeDepth += 1;
    maximumWriteDepth = Math.max(maximumWriteDepth, writeDepth);
    try {
      if (writeCount < 40) {
        const nextCharacter = value === characterHash() ? '城' : '郭';
        app.navigate(characterRoute(nextCharacter));
      }
      setItem.call(this, key, value);
    } finally {
      writeDepth -= 1;
    }
  };

  app.navigate(characterRoute());

  assert.equal(maximumWriteDepth, 1);
  assert.ok(writeCount <= 16, `expected at most 16 writes, received ${writeCount}`);
  assert.equal(harness.location.hash, characterHash(app.getRoute().character));
  app.navigate({ view: 'directory' });
  assert.equal(currentHandle(harness).resumeAvailable, false);
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

test('a corrupt removal reentry preserves the nested character winner in storage', () => {
  const storage = createStorage();
  const harness = createHarness({
    hash: characterHash(),
    storage,
    reducedMotion: true
  });
  const app = loadApp().createApp(harness.createOptions);
  storage.setItem(STORAGE_KEY, 'corrupt');
  const removeItem = storage.removeItem;
  let nested = false;
  storage.removeItem = function (key) {
    if (!nested) {
      nested = true;
      app.navigate(characterRoute('城'));
    }
    removeItem.call(this, key);
  };

  const changed = app.navigate({ view: 'directory' });

  assert.equal(changed, false);
  assert.deepEqual(app.getRoute(), characterRoute('城'));
  assert.equal(harness.location.hash, characterHash('城'));
  assert.equal(storage.value(STORAGE_KEY), characterHash('城'));
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
  assert.deepEqual(currentHandle(harness).model.words, ['城郭', '郭外']);
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
  assert.deepEqual(scripts.slice(-6), [
    'vendor/hanzi-writer.min.js',
    'js/practice-progress-store.js',
    'js/practice-session.js',
    'js/practice-engine.js',
    'js/views.js',
    'js/app.js'
  ]);
  assert.match(html, /href="#app"/);
  assert.match(html, /DOMContentLoaded/);
  assert.match(html, /HanziApp\.bootstrapApp/);
  assert.doesNotMatch(html, /<script[^>]+type="module"|https?:\/\/|\bfetch\s*\(/);
  scripts.forEach((path) => assert.doesNotMatch(path, /^(?:\/|[a-z]+:)/i));
});
